import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CompiledQuery } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { migrateToLatest, openDatabase } from "../../src/db/database.js";
import { orderVisible, parcelVisible } from "../../src/db/visibility.js";
import { seedScale } from "../../src/tools/seed-scale.js";
import type { App } from "../../src/api/app.js";
import { createTestContext, type TestContext } from "../helpers.js";

/**
 * History-import scale (docs/performance.md): 10,000 parcels and 5,000 orders. The budgets are
 * about ten times what the NAS measures, so a slow machine passes and a lost index or a list that
 * loads everything per request fails.
 */
const BUDGET_MS = 2_000;

let context: TestContext;
let app: App;
let token: string;

beforeAll(async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "open-parcels-scale-"));
  const { db, sqlite } = openDatabase(loadConfig({ OPENPARCELS_DATA_DIR: dataDir }).databasePath);
  await migrateToLatest(db);
  seedScale(sqlite, { parcels: 10_000, orders: 5_000, now: new Date("2026-11-20T12:00:00Z") });
  await db.destroy();
  context = await createTestContext({ dataDir });
  app = await context.app();
  ({ token } = await context.services.auth.createToken("scale", ["read"], null));
}, 120_000);

afterAll(async () => {
  await context.close();
});

async function timed(url: string): Promise<{ ms: number; body: unknown }> {
  // The first call prepares the statements, as on a running server.
  await app.inject({ url, headers: { authorization: `Bearer ${token}` } });
  const start = performance.now();
  const response = await app.inject({ url, headers: { authorization: `Bearer ${token}` } });
  const ms = performance.now() - start;
  expect(response.statusCode, url).toBe(200);
  return { ms, body: response.json() };
}

describe("10,000 parcels and 5,000 orders", () => {
  it.each([
    "/api/v1/parcels?limit=100",
    "/api/v1/parcels?include_archived=true&limit=100&offset=5000",
    "/api/v1/parcels?include_archived=true&carrier=dhl&limit=100",
    "/api/v1/parcels?status=in_transit&limit=100",
    "/api/v1/parcels?include_archived=true&q=SC0000&sort=name&limit=200&offset=4000",
    "/api/v1/parcels?include_archived=true&sort=-expected&limit=200",
    "/api/v1/parcels/counts",
    "/api/v1/orders?limit=100",
    "/api/v1/orders?view=all&limit=100&offset=2000",
    "/api/v1/returns",
    "/api/v1/sync?since=50000",
  ])("answers %s within the budget", async (url) => {
    const { ms, body } = await timed(url);
    expect(Array.isArray(body) ? body.length : 1).toBeGreaterThan(0);
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});

describe("parcel counts at scale", () => {
  it("match the full list, per carrier and per connection", async () => {
    interface Listed {
      readonly carrier: string;
      readonly delivered: boolean;
      readonly archived_at: string | null;
      readonly connections: readonly { readonly connection_id: string }[];
    }
    const all: Listed[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { body } = await timed(
        `/api/v1/parcels?include_archived=true&limit=1000&offset=${String(offset)}`,
      );
      const page = body as Listed[];
      all.push(...page);
      if (page.length < 1000) break;
    }
    const isActive = (parcel: Listed) => !parcel.delivered && parcel.archived_at === null;
    const perCarrier = new Map<string, number>();
    const perConnection = new Map<string, { active: number; delivered: number; total: number }>();
    for (const parcel of all) {
      perCarrier.set(parcel.carrier, (perCarrier.get(parcel.carrier) ?? 0) + 1);
      for (const id of new Set(parcel.connections.map((entry) => entry.connection_id))) {
        const current = perConnection.get(id) ?? { active: 0, delivered: 0, total: 0 };
        perConnection.set(id, {
          active: current.active + (isActive(parcel) ? 1 : 0),
          delivered: current.delivered + (parcel.delivered ? 1 : 0),
          total: current.total + 1,
        });
      }
    }
    const { body } = await timed("/api/v1/parcels/counts");
    const counts = body as {
      active: number;
      delivered: number;
      archived: number;
      carriers: { carrier: string; parcels: number }[];
      connections: { connection_id: string; active: number; delivered: number; total: number }[];
    };
    expect(counts.active).toBe(all.filter(isActive).length);
    expect(counts.delivered).toBe(all.filter((parcel) => parcel.delivered).length);
    expect(counts.archived).toBe(all.filter((parcel) => parcel.archived_at !== null).length);
    expect(new Map(counts.carriers.map((entry) => [entry.carrier, entry.parcels]))).toEqual(
      perCarrier,
    );
    expect(
      new Map(counts.connections.map(({ connection_id: id, ...rest }) => [id, rest] as const)),
    ).toEqual(perConnection);
  }, 60_000);
});

describe("query plans at scale", () => {
  async function plan(query: { compile(): { sql: string; parameters: readonly unknown[] } }) {
    const { sql: text, parameters } = query.compile();
    const { rows } = await context.services.db.executeQuery<{ detail: string }>(
      CompiledQuery.raw(`explain query plan ${text}`, [...parameters]),
    );
    return rows.map((row) => row.detail).join("\n");
  }

  it("pages parcels along the sort index, without per-row visibility checks", async () => {
    const detail = await plan(
      context.services.db
        .selectFrom("parcels")
        .selectAll()
        .where(parcelVisible)
        .orderBy("updated_at", "desc")
        .orderBy("id", "asc")
        .limit(101)
        .offset(5000),
    );
    expect(detail).toContain("USING INDEX parcels_updated");
    expect(detail).not.toContain("TEMP B-TREE");
    // The hidden set is a list subquery computed once, not a check per parcel.
    expect(detail).toContain("LIST SUBQUERY");
  });

  it("checks order visibility once per query", async () => {
    const detail = await plan(
      context.services.db.selectFrom("orders").selectAll().where(orderVisible),
    );
    // Before: two correlated subqueries per order. Now the orders are scanned once and checked
    // against a list built from the disabled connections.
    expect(detail).toMatch(/^SCAN orders\nLIST SUBQUERY \d+\n/);
  });
});
