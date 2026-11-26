import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateToLatest, openDatabase } from "../../src/db/database.js";
import { migrateBefore } from "../helpers.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const BEFORE = "2026-11-18T12:00:00.000Z";
const AFTER = "2026-11-20T12:00:00.000Z";

describe("migration 0032-ha-marker-fingerprints", () => {
  it("turns markers with an unkeyed fingerprint into adopted ones and leaves the rest", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "open-parcels-migrate-"));
    dirs.push(dir);
    const { db } = openDatabase(path.join(dir, "db.sqlite"));
    try {
      await migrateBefore(db, "0032");
      const rows = {
        "ha_import:unkeyed": [{ connectionId: "c-1", credentials: "0123456789abcdef" }, BEFORE],
        "ha_import:adopted": [{ connectionId: "c-2", credentials: "aa", adopted: true }, BEFORE],
        "ha_import:keyed": [{ connectionId: "c-3", credentials: "fedcba9876543210" }, AFTER],
        "ha_import:shapeless": [{ credentials: "bb" }, BEFORE],
        other: [{ connectionId: "x", credentials: "cc" }, BEFORE],
      } as const;
      await db
        .insertInto("settings")
        .values([
          ...Object.entries(rows).map(([key, [value, at]]) => ({
            key,
            value: JSON.stringify(value),
            updated_at: at,
          })),
          { key: "ha_import:broken", value: "not json", updated_at: BEFORE },
        ])
        .execute();

      expect(await migrateToLatest(db)).toEqual(["0032-ha-marker-fingerprints"]);

      const stored = await db.selectFrom("settings").select(["key", "value"]).execute();
      const byKey = Object.fromEntries(stored.map((row) => [row.key, row.value]));
      expect(byKey["ha_import:unkeyed"]).toBe(
        JSON.stringify({ connectionId: "c-1", credentials: "", adopted: true }),
      );
      for (const key of [
        "ha_import:adopted",
        "ha_import:keyed",
        "ha_import:shapeless",
        "other",
      ] as const) {
        expect(byKey[key]).toBe(JSON.stringify(rows[key][0]));
      }
      expect(byKey["ha_import:broken"]).toBe("not json");
    } finally {
      await db.destroy();
    }
  });
});
