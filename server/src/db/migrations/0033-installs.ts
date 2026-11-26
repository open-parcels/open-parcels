import type { Kysely } from "kysely";
import { inTransaction } from "../atomic.js";

/**
 * Installed providers, themes and consumers (decision record 0002 §2.8): one row per item, pinned
 * to a commit of its repository, with its tier and auto-update switch. Built-in items have no row.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await inTransaction(db, async () => {
    await db.schema
      .createTable("installs")
      .addColumn("kind", "text", (c) => c.notNull())
      .addColumn("id", "text", (c) => c.notNull())
      .addColumn("name", "text", (c) => c.notNull())
      .addColumn("tier", "text", (c) => c.notNull())
      .addColumn("repository", "text", (c) => c.notNull())
      .addColumn("folder", "text", (c) => c.notNull())
      .addColumn("version", "text", (c) => c.notNull())
      .addColumn("commit", "text", (c) => c.notNull())
      .addColumn("auto_update", "integer", (c) => c.notNull())
      .addColumn("installed_at", "text", (c) => c.notNull())
      .addColumn("updated_at", "text", (c) => c.notNull())
      .addPrimaryKeyConstraint("installs_pk", ["kind", "id"])
      .execute();
  });
}
