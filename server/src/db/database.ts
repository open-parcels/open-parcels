import SQLite from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { Migrator, type Migration, type MigrationProvider } from "kysely/migration";
import * as m0001 from "./migrations/0001-initial.js";
import * as m0002 from "./migrations/0002-reconciler.js";
import * as m0003 from "./migrations/0003-sign-in-attempts.js";
import * as m0004 from "./migrations/0004-lookup-state.js";
import * as m0005 from "./migrations/0005-archive-reason.js";
import * as m0006 from "./migrations/0006-auto-created-sources.js";
import * as m0007 from "./migrations/0007-event-coordinates.js";
import * as m0008 from "./migrations/0008-order-items.js";
import * as m0009 from "./migrations/0009-idle-source-state.js";
import * as m0010 from "./migrations/0010-order-lifecycle.js";
import * as m0011 from "./migrations/0011-setting-overrides.js";
import * as m0012 from "./migrations/0012-session-roles.js";
import * as m0013 from "./migrations/0013-geocoded-events.js";
import * as m0014 from "./migrations/0014-place-candidates.js";
import * as m0015 from "./migrations/0015-order-sources.js";
import * as m0016 from "./migrations/0016-manual-at.js";
import * as m0017 from "./migrations/0017-join-indexes.js";
import * as m0018 from "./migrations/0018-returns.js";
import * as m0019 from "./migrations/0019-glossary-names.js";
import * as m0020 from "./migrations/0020-ha-import-markers.js";
import * as m0021 from "./migrations/0021-order-totals.js";
import * as m0022 from "./migrations/0022-live-state-connection.js";
import * as m0023 from "./migrations/0023-geocoding-opt-in.js";
import * as m0024 from "./migrations/0024-dead-schema.js";
import * as m0025 from "./migrations/0025-state-reasons.js";
import * as m0026 from "./migrations/0026-logins.js";
import * as m0027 from "./migrations/0027-sync-changes.js";
import * as m0028 from "./migrations/0028-list-order-index.js";
import * as m0029 from "./migrations/0029-jobs.js";
import * as m0030 from "./migrations/0030-imported.js";
import * as m0031 from "./migrations/0031-consumers.js";
import * as m0032 from "./migrations/0032-ha-marker-fingerprints.js";
import * as m0033 from "./migrations/0033-installs.js";
import type { Database } from "./schema.js";

/**
 * Migrations are listed explicitly rather than read from a folder: the build output stays
 * self-contained and a missing file is a compile error, not a silent skip.
 */
export const MIGRATIONS: Readonly<Record<string, Migration>> = {
  "0001-initial": m0001,
  "0002-reconciler": m0002,
  "0003-sign-in-attempts": m0003,
  "0004-lookup-state": m0004,
  "0005-archive-reason": m0005,
  "0006-auto-created-sources": m0006,
  "0007-event-coordinates": m0007,
  "0008-order-items": m0008,
  "0009-idle-source-state": m0009,
  "0010-order-lifecycle": m0010,
  "0011-setting-overrides": m0011,
  "0012-session-roles": m0012,
  "0013-geocoded-events": m0013,
  "0014-place-candidates": m0014,
  "0015-order-sources": m0015,
  "0016-manual-at": m0016,
  "0017-join-indexes": m0017,
  "0018-returns": m0018,
  "0019-glossary-names": m0019,
  "0020-ha-import-markers": m0020,
  "0021-order-totals": m0021,
  "0022-live-state-connection": m0022,
  "0023-geocoding-opt-in": m0023,
  "0024-dead-schema": m0024,
  "0025-state-reasons": m0025,
  "0026-logins": m0026,
  "0027-sync-changes": m0027,
  "0028-list-order-index": m0028,
  "0029-jobs": m0029,
  "0030-imported": m0030,
  "0031-consumers": m0031,
  "0032-ha-marker-fingerprints": m0032,
  "0033-installs": m0033,
};

const staticProvider: MigrationProvider = {
  getMigrations: () => Promise.resolve(MIGRATIONS),
};

class MigrationError extends Error {
  override readonly name = "MigrationError";
}

export interface OpenedDatabase {
  readonly db: Kysely<Database>;
  readonly sqlite: SQLite.Database;
}

/** Opens (or creates) the database file with the pragmas the server relies on. */
export function openDatabase(file: string): OpenedDatabase {
  const sqlite = new SQLite(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
  const db = new Kysely<Database>({ dialect: new SqliteDialect({ database: sqlite }) });
  return { db, sqlite };
}

/** Applies every pending migration; returns the names that ran. */
export async function migrateToLatest(db: Kysely<Database>): Promise<string[]> {
  const migrator = new Migrator({ db, provider: staticProvider });
  const { error, results } = await migrator.migrateToLatest();
  if (error !== undefined) {
    const failed = results?.find((result) => result.status === "Error")?.migrationName ?? "unknown";
    throw new MigrationError(`Database migration ${failed} failed.`, { cause: error });
  }
  return (results ?? [])
    .filter((result) => result.status === "Success")
    .map((result) => result.migrationName);
}
