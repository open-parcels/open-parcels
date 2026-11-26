import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/api/app.js";
import { demoCarrier } from "../../src/carriers/demo/index.js";
import { demoShop } from "../../src/carriers/demo_shop/index.js";
import type { Order } from "../../src/domain/order-lifecycle.js";
import type { Return } from "../../src/domain/return.js";
import { registerBuiltin } from "../manifests.js";
import { returnSnapshot, type ReturnSnapshot } from "../../src/provider/snapshot.js";
import { createTestContext, signIn, type TestContext } from "../helpers.js";

/** Made-up returns; the fake clock reads 2026-11-18. */
const ORDER = { shop: "example-shop.de", orderNumber: "RET-0001" };

let context: TestContext;
let app: App;
let headers: Record<string, string>;
let connectionId: string;

beforeEach(async () => {
  context = await createTestContext({
    providers: [registerBuiltin(demoCarrier), registerBuiltin(demoShop)],
  });
  app = await context.app();
  const session = await signIn(context, app);
  headers = { cookie: session.cookie, "x-csrf-token": session.csrf };
  const connection = await context.services.connections.create({
    provider: "demo_shop",
    kind: "shop",
    label: "Example shop",
    config: {},
    secret: null,
  });
  connectionId = connection.id;
});
afterEach(async () => {
  await context.close();
});

async function report(...returns: ReturnSnapshot[]): Promise<void> {
  await context.services.reconciler.ingest(connectionId, {
    snapshots: [],
    returns,
    complete: false,
  });
}

const requested = returnSnapshot({
  order: ORDER,
  externalRef: "R-1",
  status: "requested",
  returnBy: "2026-11-25",
  dropOff: [{ carrier: "dhl", kind: "any", description: "Any DHL drop-off point" }],
  cost: { free: true, amount: null, currency: null },
  labelUrl: "https://shop.example.invalid/returns/label/R-1",
  items: ["Example kettle..."],
});

async function list(view = "open"): Promise<Return[]> {
  const response = await app.inject({ url: `/api/v1/returns?view=${view}`, headers });
  expect(response.statusCode).toBe(200);
  return response.json<Return[]>();
}

async function outbox(): Promise<string[]> {
  const rows = await context.services.db.selectFrom("outbox").select("type").execute();
  return rows.map((row) => row.type).filter((type) => type.startsWith("return."));
}

describe("returns API", () => {
  it("stores a reported return with its order, deadline, drop-off and cost", async () => {
    await report(requested);
    const [entry] = await list();
    expect(entry).toMatchObject({
      shop: ORDER.shop,
      order_number: ORDER.orderNumber,
      status: "requested",
      return_by: "2026-11-25",
      drop_off: [{ carrier: "dhl", kind: "any", description: "Any DHL drop-off point" }],
      cost: { free: true, amount: null, currency: null },
      label_url: "https://shop.example.invalid/returns/label/R-1",
      items: [{ title: "Example kettle...", order_item_position: null }],
      refund: null,
      parcel_id: null,
    });
    const one = await app.inject({ url: `/api/v1/returns/${entry?.id ?? ""}`, headers });
    expect(one.json<Return>()).toEqual(entry);
    const order = await app.inject({ url: `/api/v1/orders/${entry?.order_id ?? ""}`, headers });
    expect(order.json<Order>().returns).toEqual([entry]);
    expect(await outbox()).toEqual(["return.created"]);
  });

  it("merges later reports, never moves back, and fires an update only on a change", async () => {
    await report(requested);
    await report(
      returnSnapshot({
        order: ORDER,
        status: "refunded",
        refund: { amount: 19.99, currency: "EUR", status: "issued" },
      }),
    );
    // A late mail about the drop-off changes nothing.
    await report(returnSnapshot({ order: ORDER, externalRef: "R-1", status: "dropped_off" }));
    await report(requested);
    const [entry] = await list("closed");
    expect(entry).toMatchObject({
      status: "refunded",
      return_by: "2026-11-25",
      cost: { free: true },
      refund: { amount: 19.99, currency: "EUR", status: "issued" },
    });
    expect(await list("open")).toEqual([]);
    expect(await outbox()).toEqual(["return.created", "return.updated"]);
  });

  it("tracks the return's parcel as an outgoing parcel", async () => {
    await report({
      ...requested,
      tracking: { carrier: "dhl", trackingNumber: "00340000000000000099" },
    });
    const [entry] = await list();
    const parcel = await app.inject({ url: `/api/v1/parcels/${entry?.parcel_id ?? ""}`, headers });
    expect(parcel.statusCode).toBe(200);
    expect(parcel.json<{ direction: string; tracking_number: string }>()).toMatchObject({
      direction: "sending",
      tracking_number: "00340000000000000099",
    });
  });

  it("lets a refund alone update a return but never start one", async () => {
    await report(returnSnapshot({ order: ORDER, status: "refunded", mayCreate: false }));
    expect(await list("all")).toEqual([]);
    const orders = await app.inject({ url: "/api/v1/orders?view=all", headers });
    expect(orders.json<Order[]>()).toEqual([]);
  });

  it("finds the order of a refund without a reference by its total and payee", async () => {
    const paid = { amount: 18.2, currency: "EUR" };
    const at = "2026-11-17T10:00:00.000Z";
    await context.services.reconciler.ingest(connectionId, {
      snapshots: [],
      orders: [
        { order: ORDER, status: "ordered", at, items: [], total: paid, payment: false },
        {
          order: { shop: "other-shop.de", orderNumber: "RET-0002" },
          status: "ordered",
          at,
          items: [],
          total: paid,
          payment: false,
        },
      ],
      complete: false,
    });
    const refund = (payee: string | null) =>
      returnSnapshot({
        order: { payee, total: paid, paidBefore: "2026-11-18T09:00:00.000Z" },
        status: "refunded",
        refund: { amount: 4.62, currency: "EUR", status: "issued" },
        mayCreate: false,
      });
    // Two orders of that total and a payee naming neither: nothing is touched.
    await report(refund("Someone Else Ltd"));
    const statuses = async () =>
      (await app.inject({ url: "/api/v1/orders?view=all", headers }))
        .json<Order[]>()
        .map((order) => [order.order_number, order.status]);
    expect(await statuses()).not.toContainEqual(["RET-0001", "refunded"]);
    await report(refund("Example-Shop GmbH"));
    expect(await statuses()).toContainEqual(["RET-0001", "refunded"]);
    expect(await statuses()).not.toContainEqual(["RET-0002", "refunded"]);
  });

  it("reads a return past its deadline as expired", async () => {
    await report(requested);
    context.clock.advance(8 * 24 * 60 * 60_000);
    const [entry] = await list("closed");
    expect(entry?.status).toBe("expired");
  });

  it("hides returns while their only connection is disabled", async () => {
    await report(requested);
    await context.services.connections.updateSettings(connectionId, { enabled: false });
    expect(await list("all")).toEqual([]);
    const entries = await context.services.calendar.entries(
      new Date("2026-11-01T00:00:00Z"),
      new Date("2026-12-31T00:00:00Z"),
    );
    expect(entries.filter((entry) => entry.kind === "return_by")).toEqual([]);
    await context.services.connections.updateSettings(connectionId, { enabled: true });
    expect(await list("all")).toHaveLength(1);
  });
});

describe("returns in the calendar", () => {
  it("shows an all-day 'return by' entry with drop-off and cost, also in the ICS feed", async () => {
    await report(requested);
    const response = await app.inject({
      url: "/api/v1/calendar?from=2026-11-01T00:00:00Z&to=2026-12-31T00:00:00Z",
      headers,
    });
    const entries = response.json<{ kind: string; all_day: boolean }[]>();
    expect(entries.filter((entry) => entry.kind === "return_by")).toEqual([
      expect.objectContaining({
        parcel_id: null,
        title: "Example kettle...",
        all_day: true,
        start_date: "2026-11-25",
        end_date: "2026-11-26",
        status: "requested",
        drop_off: [expect.objectContaining({ description: "Any DHL drop-off point" })],
        cost: expect.objectContaining({ free: true }) as unknown,
      }),
    ]);
    const created = await app.inject({ method: "POST", url: "/api/v1/calendar/feed", headers });
    const feed = (await app.inject({ url: created.json<{ path: string }>().path })).body.replace(
      /\r\n /g,
      "",
    );
    expect(feed).toContain("SUMMARY:Return by 2026-11-25: Example kettle...");
    expect(feed).toContain("DTSTART;VALUE=DATE:20261125");
    expect(feed).toContain("Drop off: Any DHL drop-off point\\nFree return");
    expect(feed).toContain("Status: Return requested");
    const german = (
      await app.inject({ url: `${created.json<{ path: string }>().path}?lang=de` })
    ).body.replace(/\r\n /g, "");
    expect(german).toContain("SUMMARY:Zurücksenden bis 2026-11-25: Example kettle...");
    expect(german).toContain("Abgabe: Any DHL drop-off point\\nKostenlose Rücksendung");
    expect(german).toContain("Status: Rücksendung angefragt");
    const byHeader = await app.inject({
      url: created.json<{ path: string }>().path,
      headers: { "accept-language": "de-DE,de;q=0.9" },
    });
    expect(byHeader.body).toContain("X-WR-CALNAME:Paketzustellungen");
  });

  it("drops the entry once the return is handed in", async () => {
    await report(requested);
    await report(returnSnapshot({ order: ORDER, externalRef: "R-1", status: "dropped_off" }));
    const entries = await context.services.calendar.entries(
      new Date("2026-11-01T00:00:00Z"),
      new Date("2026-12-31T00:00:00Z"),
    );
    expect(entries.filter((entry) => entry.kind === "return_by")).toEqual([]);
  });
});
