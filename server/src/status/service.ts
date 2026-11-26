import { sql } from "kysely";
import type { ConnectionRow } from "../db/schema.js";
import type { BackupError } from "../data/backup.js";
import { databaseError, type DatabaseError } from "./database-error.js";
import { SCHEDULER_STALL_MS, type SchedulerError } from "../engine/scheduler.js";
import type { Services } from "../services.js";
import { COMMIT, VERSION } from "../version.js";

/** When this process started, for the status page and diagnostics. */
export const STARTED_AT = new Date();

/**
 * `ok`; `degraded`: the service answers but something needs attention (a connection in error, a
 * failing backup); `unavailable`: it cannot work (the database does not answer).
 */
export const CHECK_STATES = ["ok", "degraded", "unavailable"] as const;
type CheckState = (typeof CHECK_STATES)[number];

export const CHECK_NAMES = [
  "database",
  "connections",
  "inboxes",
  "scheduler",
  "event_stream",
  "backups",
  "consumers",
] as const;
export type CheckName = (typeof CHECK_NAMES)[number];

interface ConnectionStatus {
  readonly id: string;
  readonly provider: string;
  readonly label: string;
  readonly kind: ConnectionRow["kind"];
  readonly state: ConnectionRow["state"];
  readonly state_reason: ConnectionRow["state_reason"];
  readonly carrier_message: string | null;
  readonly consecutive_failures: number;
  readonly last_run_at: string | null;
  readonly last_ok_at: string | null;
  readonly next_run_at: string | null;
  /** The carrier asked for a pause (rate limit, captcha) until then; manual syncs wait too. */
  readonly backoff_until: string | null;
}

/** A configured consumer's last delivery (`docs/consumers.md` §3). */
interface ConsumerStatusLine {
  readonly id: string;
  readonly consumer: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly last_attempt_at: string | null;
  readonly last_ok_at: string | null;
  readonly last_error: string | null;
  /** Notifications waiting to be delivered (due later, or retrying). */
  readonly pending: number;
  /** Notifications it gave up on. */
  readonly failed: number;
}

interface InboxStatus extends ConnectionStatus {
  readonly connected: boolean;
  readonly reconnect_at: string | null;
}

export interface StatusReport {
  readonly status: CheckState;
  readonly checked_at: string;
  readonly version: string;
  readonly commit: string | null;
  readonly install_id: string;
  readonly started_at: string;
  readonly checks: Readonly<Record<CheckName, CheckState>>;
  readonly database: { readonly error: DatabaseError | null };
  readonly connections: ConnectionStatus[];
  readonly inboxes: InboxStatus[];
  readonly scheduler: {
    readonly running: boolean;
    readonly in_flight: number;
    readonly last_cycle_at: string | null;
    readonly last_error: SchedulerError | null;
    /** The earliest planned run of any connection. */
    readonly next_run_at: string | null;
  };
  readonly event_stream: {
    readonly clients: number;
    readonly last_seq: number;
    /** Live events kept for replay. */
    readonly stored: number;
    readonly live_sessions: number;
  };
  readonly backups: {
    readonly enabled: boolean;
    readonly last_ok: boolean | null;
    readonly last_at: string | null;
    readonly last_error: BackupError | null;
    readonly next_at: string | null;
  };
  readonly consumers: ConsumerStatusLine[];
}

async function consumerLines(services: Services): Promise<ConsumerStatusLine[]> {
  const [list, queues] = await Promise.all([
    services.consumers.list(),
    services.notifications.status(),
  ]);
  return list.map((view) => ({
    id: view.id,
    consumer: view.consumer,
    label: view.label,
    enabled: view.enabled,
    last_attempt_at: view.lastAttemptAt,
    last_ok_at: view.lastOkAt,
    last_error: view.lastError,
    pending: queues.get(view.id)?.pending ?? 0,
    failed: queues.get(view.id)?.failed ?? 0,
  }));
}

/** States that need the owner: a run failing, or a sign-in the carrier refused. */
const TROUBLE: readonly ConnectionRow["state"][] = ["error", "needs_sign_in"];

const worst = (states: readonly CheckState[]): CheckState =>
  states.includes("unavailable") ? "unavailable" : states.includes("degraded") ? "degraded" : "ok";

const troubled = (rows: readonly { readonly state: ConnectionRow["state"] }[]): CheckState =>
  rows.some((row) => TROUBLE.includes(row.state)) ? "degraded" : "ok";

function connectionStatus(row: ConnectionRow): ConnectionStatus {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    kind: row.kind,
    state: row.state,
    state_reason: row.state_reason,
    carrier_message: row.carrier_message,
    consecutive_failures: row.consecutive_failures,
    last_run_at: row.last_run_at,
    last_ok_at: row.last_ok_at,
    next_run_at: row.next_run_at,
    backoff_until: row.backoff_until,
  };
}

async function databaseCheck(services: Services): Promise<DatabaseError | null> {
  try {
    await sql`select 1`.execute(services.db);
    return null;
  } catch (error) {
    services.logger.error({ err: error }, "Status check: the database does not answer.");
    return databaseError(error);
  }
}

/** One report covering every part that runs in the background, for the status page and health. */
export async function collectStatus(services: Services): Promise<StatusReport> {
  const now = services.clock.now();
  const base = {
    checked_at: now.toISOString(),
    version: VERSION,
    commit: COMMIT,
    install_id: services.installId,
    started_at: STARTED_AT.toISOString(),
  };
  const databaseFailure = await databaseCheck(services);
  if (databaseFailure !== null) {
    const checks = Object.fromEntries(CHECK_NAMES.map((name) => [name, "unavailable"])) as Record<
      CheckName,
      CheckState
    >;
    return {
      ...base,
      status: "unavailable",
      checks,
      database: { error: databaseFailure },
      connections: [],
      inboxes: [],
      scheduler: {
        running: services.scheduler.status().running,
        in_flight: 0,
        last_cycle_at: null,
        last_error: null,
        next_run_at: null,
      },
      event_stream: {
        clients: services.bus.subscriberCount,
        last_seq: 0,
        stored: 0,
        live_sessions: 0,
      },
      backups: { enabled: false, last_ok: null, last_at: null, last_error: null, next_at: null },
      consumers: [],
    };
  }

  const rows = await services.db
    .selectFrom("connections")
    .selectAll()
    .where("state", "!=", "disabled")
    .orderBy("created_at")
    .execute();
  const [stored, live, backups, consumers] = await Promise.all([
    services.db
      .selectFrom("outbox")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .executeTakeFirst(),
    services.db
      .selectFrom("live_state")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .executeTakeFirst(),
    services.backups.status(),
    consumerLines(services),
  ]);
  const carriers = rows.filter((row) => row.kind !== "mail");
  const inboxes = rows
    .filter((row) => row.kind === "mail")
    .map((row): InboxStatus => {
      const watched = services.mail.status(row.id);
      return {
        ...connectionStatus(row),
        connected: watched.connected,
        reconnect_at: watched.reconnectAt,
      };
    });
  const nextRuns = carriers
    .map((row) => row.next_run_at)
    .filter((at): at is string => at !== null)
    .sort();
  const scheduler = services.scheduler.status();
  const lastCycle = scheduler.lastCycleAt === null ? undefined : Date.parse(scheduler.lastCycleAt);
  // The first cycle starts at once; afterwards one follows at least every five minutes.
  const stalled = lastCycle !== undefined && now.getTime() - lastCycle > SCHEDULER_STALL_MS;

  const checks: Record<CheckName, CheckState> = {
    database: "ok",
    connections: troubled(carriers),
    inboxes: troubled(inboxes),
    scheduler: !scheduler.running || stalled || scheduler.lastError !== null ? "degraded" : "ok",
    event_stream: "ok",
    backups: backups.failing ? "degraded" : "ok",
    consumers: consumers.some((line) => line.enabled && line.last_error !== null)
      ? "degraded"
      : "ok",
  };
  return {
    ...base,
    status: worst(Object.values(checks)),
    checks,
    database: { error: null },
    connections: carriers.map(connectionStatus),
    inboxes,
    scheduler: {
      running: scheduler.running,
      in_flight: scheduler.inFlight,
      last_cycle_at: scheduler.lastCycleAt,
      last_error: scheduler.lastError,
      next_run_at: nextRuns[0] ?? null,
    },
    event_stream: {
      clients: services.bus.subscriberCount,
      last_seq: services.bus.lastSeq,
      stored: stored?.n ?? 0,
      live_sessions: live?.n ?? 0,
    },
    backups: {
      enabled: backups.interval_hours > 0,
      last_ok: backups.last?.ok ?? null,
      last_at: backups.last?.at ?? null,
      last_error: backups.last?.error ?? null,
      next_at: backups.next_at,
    },
    consumers,
  };
}
