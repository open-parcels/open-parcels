import type { Kysely } from "kysely";
import type { Logger } from "pino";
import { addMs, isoNow, type Clock, DAY_MS } from "../clock.js";
import type { Database } from "../db/schema.js";
import type { EventBus } from "../events/bus.js";
import { EVENT_TYPES, type EventType, type OutboxEvent } from "../events/types.js";
import { HostNotAllowedError } from "../provider/http.js";
import type { Consumer, ConsumerCall, DeliveryOutcome, Message } from "./api.js";
import { consumerAllowList } from "./manifest.js";
import {
  buildMessage,
  notificationDataSchema,
  testMessage,
  toNotification,
  type NotificationCandidate,
  type Render,
  type StoredNotification,
} from "./notify.js";
import { dueAt, NOTIFICATION_EVENTS, quietUntil, wants, type NotificationEvent } from "./rules.js";
import { smtpSender } from "./smtp.js";
import type { ConsumerStore, ConsumerView } from "./store.js";
import { consumerHttp, type ConsumerFetch } from "./transport.js";

/**
 * Turns live events into notifications and delivers them (`docs/consumers.md` §2–3). Each
 * configured consumer works through its own queue, one delivery at a time; a slow or dead one
 * holds up nothing else.
 */

const CURSOR_KEY = "notifications.cursor";
const BATCH = 500;
const TICK_MS = 15_000;
const FIRST_RETRY_MS = 30_000;
const MAX_RETRY_MS = 6 * 60 * 60_000;
const MAX_ATTEMPTS = 10;
const EXPIRE_MS = 3 * DAY_MS;
/** Finished notifications are kept this long, so a state change repeated later stays quiet. */
const KEEP_MS = 30 * DAY_MS;
/** The most notifications one digest carries. */
const DIGEST_MAX = 50;

export interface DispatcherDeps {
  readonly db: Kysely<Database>;
  readonly bus: EventBus;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly store: ConsumerStore;
  readonly consumers: ReadonlyMap<string, Consumer>;
  readonly timeZone: string;
  readonly publicUrl: () => URL | undefined;
  /** A provider's display name (`Presentation.providerName`). */
  readonly providerName: (id: string) => string;
  readonly fetchImpl?: ConsumerFetch;
}

export interface ConsumerStatus {
  readonly pending: number;
  readonly failed: number;
}

/** Backoff for the n-th attempt (1-based), or what the service asked for. */
function retryDelay(attempt: number, retryAfterSeconds: number | undefined): number {
  if (retryAfterSeconds !== undefined) return Math.min(retryAfterSeconds * 1000, MAX_RETRY_MS);
  return Math.min(FIRST_RETRY_MS * 2 ** (attempt - 1), MAX_RETRY_MS);
}

/** A thrown error as an outcome: a refused host never works, anything else may next time. */
function thrownOutcome(error: unknown): DeliveryOutcome {
  const message = error instanceof Error ? error.message : String(error);
  return error instanceof HostNotAllowedError
    ? { kind: "failed", message }
    : { kind: "retry", message };
}

export class ConsumerDispatcher {
  #cursor = 0;
  #timer: NodeJS.Timeout | undefined;
  #unsubscribe: (() => void) | undefined;
  #ingesting: Promise<void> | undefined;
  #requested = 0;
  readonly #busy = new Map<string, Promise<void>>();

  constructor(private readonly deps: DispatcherDeps) {}

  /** Reads the cursor; on the very first start it begins at the newest live event. */
  async load(): Promise<void> {
    const row = await this.deps.db
      .selectFrom("settings")
      .select("value")
      .where("key", "=", CURSOR_KEY)
      .executeTakeFirst();
    if (row !== undefined) {
      this.#cursor = Number(JSON.parse(row.value));
      return;
    }
    this.#cursor = this.deps.bus.lastSeq;
    await this.#saveCursor(this.deps.db);
  }

  start(): void {
    this.#unsubscribe = this.deps.bus.subscribe(() => {
      this.#tick();
    });
    this.#timer = setInterval(() => {
      this.#tick();
    }, TICK_MS);
    this.#timer.unref();
    this.#tick();
  }

  stop(): void {
    this.#unsubscribe?.();
    clearInterval(this.#timer);
  }

  /** Reads new live events and delivers what is due; resolves when every consumer is done. */
  async runOnce(): Promise<void> {
    await this.ingest();
    await Promise.all(await this.#launch());
  }

  #tick(): void {
    this.runOnce().catch((error: unknown) => {
      this.deps.logger.error({ err: error }, "Delivering notifications failed.");
    });
  }

  /** Turns live events after the cursor into notifications. Safe to call concurrently. */
  ingest(): Promise<void> {
    this.#requested += 1;
    this.#ingesting ??= this.#ingestAll().finally(() => {
      this.#ingesting = undefined;
    });
    return this.#ingesting;
  }

  async #ingestAll(): Promise<void> {
    let handled = 0;
    while (handled < this.#requested) {
      handled = this.#requested;
      let more = true;
      while (more) more = await this.#ingestBatch();
    }
  }

  async #ingestBatch(): Promise<boolean> {
    const rows = await this.deps.db
      .selectFrom("outbox")
      .selectAll()
      .where("seq", ">", this.#cursor)
      .where("seq", "<=", this.deps.bus.lastSeq)
      .orderBy("seq")
      .limit(BATCH)
      .execute();
    if (rows.length === 0) return false;
    const consumers = (await this.deps.store.list()).filter((consumer) => consumer.enabled);
    await this.deps.db.transaction().execute(async (trx) => {
      for (const row of rows) {
        if (!EVENT_TYPES.includes(row.type as EventType)) continue;
        const event: OutboxEvent = {
          seq: row.seq,
          type: row.type as EventType,
          parcelId: row.parcel_id,
          payload: JSON.parse(row.payload) as unknown,
          createdAt: row.created_at,
        };
        const candidate = toNotification(event);
        if (candidate !== undefined) await this.#store(trx, candidate, consumers, row.created_at);
      }
      this.#cursor = rows.at(-1)?.seq ?? this.#cursor;
      await this.#saveCursor(trx);
    });
    return rows.length === BATCH;
  }

  async #store(
    trx: Kysely<Database>,
    candidate: NotificationCandidate,
    consumers: readonly ConsumerView[],
    createdAt: string,
  ): Promise<void> {
    const inserted = await trx
      .insertInto("notifications")
      .values({
        key: candidate.key,
        event: candidate.event,
        data: JSON.stringify(candidate.data),
        created_at: createdAt,
      })
      .onConflict((oc) => oc.column("key").doNothing())
      .returning("id")
      .executeTakeFirst();
    // Seen before: the same state change from another connection, a repair or a replay.
    if (inserted === undefined) return;
    const now = this.deps.clock.now();
    const rows = consumers
      .filter((consumer) => wants(consumer.rules, candidate))
      .map((consumer) => ({
        notification_id: inserted.id,
        consumer_id: consumer.id,
        state: "pending" as const,
        due_at: dueAt(consumer.rules, now, this.deps.timeZone).toISOString(),
        created_at: now.toISOString(),
      }));
    if (rows.length > 0) await trx.insertInto("notification_deliveries").values(rows).execute();
  }

  async #saveCursor(db: Kysely<Database>): Promise<void> {
    const value = JSON.stringify(this.#cursor);
    const now = isoNow(this.deps.clock);
    await db
      .insertInto("settings")
      .values({ key: CURSOR_KEY, value, updated_at: now })
      .onConflict((oc) => oc.column("key").doUpdateSet({ value, updated_at: now }))
      .execute();
  }

  /** Starts a delivery round for every enabled consumer that is not in one already. */
  async #launch(): Promise<Promise<void>[]> {
    const consumers = (await this.deps.store.list()).filter((consumer) => consumer.enabled);
    const started: Promise<void>[] = [];
    for (const consumer of consumers) {
      if (this.#busy.has(consumer.id)) continue;
      const round = this.#deliverDue(consumer)
        .catch((error: unknown) => {
          this.deps.logger.error({ err: error, consumer: consumer.id }, "A consumer failed.");
        })
        .finally(() => this.#busy.delete(consumer.id));
      this.#busy.set(consumer.id, round);
      started.push(round);
    }
    return started;
  }

  async #deliverDue(consumer: ConsumerView): Promise<void> {
    const { db } = this.deps;
    const now = this.deps.clock.now();
    await db
      .updateTable("notification_deliveries")
      .set({ state: "expired", finished_at: now.toISOString() })
      .where("consumer_id", "=", consumer.id)
      .where("state", "=", "pending")
      .where("created_at", "<", addMs(now, -EXPIRE_MS).toISOString())
      .execute();
    for (;;) {
      const due = await db
        .selectFrom("notification_deliveries")
        .innerJoin("notifications", "notifications.id", "notification_deliveries.notification_id")
        .select([
          "notification_deliveries.notification_id as id",
          "notification_deliveries.attempts",
          "notifications.event",
          "notifications.data",
          "notifications.created_at",
        ])
        .where("notification_deliveries.consumer_id", "=", consumer.id)
        .where("notification_deliveries.state", "=", "pending")
        .where("notification_deliveries.due_at", "<=", this.deps.clock.now().toISOString())
        .orderBy("notification_deliveries.due_at")
        .orderBy("notification_deliveries.notification_id")
        .limit(consumer.rules.digest === "immediately" ? 1 : DIGEST_MAX)
        .execute();
      if (due.length === 0) return;
      if (!(await this.#deliver(consumer, due))) return;
    }
  }

  /** One delivery of `rows`; true when the next may follow at once. */
  async #deliver(
    consumer: ConsumerView,
    rows: readonly {
      id: number;
      attempts: number;
      event: string;
      data: string;
      created_at: string;
    }[],
  ): Promise<boolean> {
    const ids = rows.map((row) => row.id);
    const quiet = quietUntil(consumer.rules, this.deps.clock.now(), this.deps.timeZone);
    if (quiet !== undefined) {
      await this.#reschedule(consumer.id, ids, quiet, false);
      return false;
    }
    const stored = rows.map((row): StoredNotification => ({
      event: NOTIFICATION_EVENTS.includes(row.event as NotificationEvent)
        ? (row.event as NotificationEvent)
        : "registered",
      data: notificationDataSchema.parse(JSON.parse(row.data)),
      createdAt: row.created_at,
    }));
    const implementation = this.deps.consumers.get(consumer.consumer);
    const outcome: DeliveryOutcome =
      implementation === undefined
        ? { kind: "failed", message: `The consumer ${consumer.consumer} is not installed.` }
        : await this.#call(implementation, consumer, (call) =>
            implementation.deliver(
              buildMessage(stored, this.#render(implementation, consumer)),
              call,
            ),
          );
    await this.deps.store.recordAttempt(
      consumer.id,
      outcome.kind === "ok" ? null : outcome.message,
    );
    const now = this.deps.clock.now();
    if (outcome.kind === "ok" || outcome.kind === "failed") {
      await this.deps.db
        .updateTable("notification_deliveries")
        .set((eb) => ({
          state: outcome.kind === "ok" ? "sent" : "failed",
          attempts: eb("attempts", "+", 1),
          finished_at: now.toISOString(),
        }))
        .where("consumer_id", "=", consumer.id)
        .where("notification_id", "in", ids)
        .execute();
      return outcome.kind === "ok";
    }
    const attempt = Math.max(...rows.map((row) => row.attempts)) + 1;
    if (attempt >= MAX_ATTEMPTS) {
      this.deps.logger.warn({ consumer: consumer.id }, "A notification failed too often; dropped.");
    }
    const next = addMs(now, retryDelay(attempt, outcome.retryAfterSeconds));
    await this.#reschedule(consumer.id, ids, next, true, attempt >= MAX_ATTEMPTS);
    return false;
  }

  async #reschedule(
    consumerId: string,
    ids: readonly number[],
    at: Date,
    attempted: boolean,
    giveUp = false,
  ): Promise<void> {
    await this.deps.db
      .updateTable("notification_deliveries")
      .set((eb) => ({
        due_at: at.toISOString(),
        ...(attempted ? { attempts: eb("attempts", "+", 1) } : {}),
        ...(giveUp ? { state: "failed" as const, finished_at: isoNow(this.deps.clock) } : {}),
      }))
      .where("consumer_id", "=", consumerId)
      .where("notification_id", "in", ids)
      .execute();
  }

  #render(consumer: Consumer, view: ConsumerView): Render {
    return {
      language: view.rules.language,
      timeZone: this.deps.timeZone,
      publicUrl: this.deps.publicUrl(),
      fields: consumer.describe().manifest.fields,
      providerName: this.deps.providerName,
    };
  }

  /** Runs one call with this consumer's config, its secret (for this call only) and network. */
  async #call(
    consumer: Consumer,
    view: ConsumerView,
    run: (call: ConsumerCall) => Promise<DeliveryOutcome>,
  ): Promise<DeliveryOutcome> {
    try {
      const { manifest } = consumer.describe();
      const secret = await this.deps.store.secretOf(view.id);
      const hosts = consumerAllowList(manifest, view.config);
      const call: ConsumerCall = {
        config: view.config,
        secret,
        http: consumerHttp(hosts, this.deps.fetchImpl),
        ...(manifest.permissions.smtp ? { smtp: smtpSender(view.config, secret, hosts) } : {}),
      };
      return await run(call);
    } catch (error) {
      return thrownOutcome(error);
    }
  }

  /** The "Send test notification" button: sends at once, past the rules and the queue. */
  async test(view: ConsumerView): Promise<DeliveryOutcome> {
    const consumer = this.deps.consumers.get(view.consumer);
    if (consumer === undefined) {
      return { kind: "failed", message: `The consumer ${view.consumer} is not installed.` };
    }
    const message: Message = testMessage(this.#render(consumer, view));
    return this.#call(consumer, view, (call) => consumer.test(message, call));
  }

  /** Queued and failed deliveries per configured consumer, for the Status page. */
  async status(): Promise<ReadonlyMap<string, ConsumerStatus>> {
    const rows = await this.deps.db
      .selectFrom("notification_deliveries")
      .select((eb) => ["consumer_id", "state", eb.fn.countAll<number>().as("n")])
      .where("state", "in", ["pending", "failed"])
      .groupBy(["consumer_id", "state"])
      .execute();
    const result = new Map<string, ConsumerStatus>();
    for (const row of rows) {
      const entry = result.get(row.consumer_id) ?? { pending: 0, failed: 0 };
      result.set(row.consumer_id, {
        ...entry,
        [row.state === "pending" ? "pending" : "failed"]: row.n,
      });
    }
    return result;
  }

  /** Drops notifications older than a month whose deliveries all finished. */
  async prune(): Promise<number> {
    const cutoff = addMs(this.deps.clock.now(), -KEEP_MS).toISOString();
    const result = await this.deps.db
      .deleteFrom("notifications")
      .where("created_at", "<", cutoff)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom("notification_deliveries")
              .select("notification_id")
              .whereRef("notification_deliveries.notification_id", "=", "notifications.id")
              .where("notification_deliveries.state", "=", "pending"),
          ),
        ),
      )
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }
}
