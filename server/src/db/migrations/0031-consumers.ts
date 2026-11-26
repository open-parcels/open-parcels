import type { Kysely } from "kysely";
import { inTransaction } from "../atomic.js";

/**
 * Consumers (`docs/consumers.md`): the configured consumers with their notification rules and last
 * delivery, the notifications (one per state change, unique by key) and the delivery queue.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await inTransaction(db, async () => {
    await db.schema
      .createTable("consumers")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("consumer", "text", (c) => c.notNull())
      .addColumn("label", "text", (c) => c.notNull())
      .addColumn("config", "text", (c) => c.notNull())
      .addColumn("secret_blob", "blob")
      .addColumn("rules", "text", (c) => c.notNull())
      .addColumn("enabled", "integer", (c) => c.notNull().defaultTo(1))
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("updated_at", "text", (c) => c.notNull())
      .addColumn("last_attempt_at", "text")
      .addColumn("last_ok_at", "text")
      .addColumn("last_error", "text")
      .execute();
    await db.schema
      .createTable("notifications")
      .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
      .addColumn("key", "text", (c) => c.notNull().unique())
      .addColumn("event", "text", (c) => c.notNull())
      .addColumn("data", "text", (c) => c.notNull())
      .addColumn("created_at", "text", (c) => c.notNull())
      .execute();
    await db.schema
      .createTable("notification_deliveries")
      .addColumn("notification_id", "integer", (c) =>
        c.notNull().references("notifications.id").onDelete("cascade"),
      )
      .addColumn("consumer_id", "text", (c) =>
        c.notNull().references("consumers.id").onDelete("cascade"),
      )
      .addColumn("state", "text", (c) => c.notNull())
      .addColumn("attempts", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("due_at", "text", (c) => c.notNull())
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("finished_at", "text")
      .addPrimaryKeyConstraint("notification_deliveries_pk", ["notification_id", "consumer_id"])
      .execute();
    await db.schema
      .createIndex("notification_deliveries_due")
      .on("notification_deliveries")
      .columns(["consumer_id", "state", "due_at"])
      .execute();
  });
}
