import type { Kysely } from "kysely";
import { simpleParser, type AddressObject } from "mailparser";
import type { Logger } from "pino";
import { ZodError } from "zod";
import { DAY_MS, isoNow, type Clock } from "../clock.js";
import { DecryptionError, type SecretBox } from "../crypto/secrets.js";
import type { Database, ConnectionRow } from "../db/schema.js";
import type { Reconciler } from "../engine/reconciler.js";
import { secretAad, sessionAad, type ConnectionService } from "../engine/connections.js";
import { cause, NO_CAUSE } from "../engine/state-reason.js";
import type { OrderSnapshot, ParcelSnapshot, ReturnSnapshot } from "../provider/snapshot.js";
import type { EmailRouter } from "./routing.js";
import {
  MAIL_PROVIDER,
  mailConfigSchema,
  mailProgressSchema,
  mailSecretSchema,
  type FetchedMessage,
  type MailboxClient,
  type MailboxClientFactory,
  type MailConfig,
  type MailInput,
  type MailInterpreter,
  type MailOrderInterpreter,
  type MailReturnInterpreter,
  type MailProgress,
  type MailSecret,
  TO_FALLBACK_SERVICE,
  isGenericInboxLabel,
  inboxLabel,
} from "./types.js";

const RESYNC_MS = 15 * 60_000;
const RECONNECT_BASE_MS = 30_000;
const RECONNECT_MAX_MS = 15 * 60_000;

export interface MailWatcherDeps {
  readonly db: Kysely<Database>;
  readonly secrets: SecretBox;
  readonly connections: ConnectionService;
  readonly reconciler: Reconciler;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly clientFactory: MailboxClientFactory;
  /** Hands emails from providers' sender domains to those providers (`./routing.ts`). */
  readonly router: EmailRouter;
  /** The shared email rules, for every email no provider read. */
  readonly interpret: MailInterpreter;
  /** Return and refund mails; unset in tests that only look at parcels. */
  readonly interpretReturns?: MailReturnInterpreter;
  /** Order emails without a parcel (confirmations, receipts, cancellations); unset likewise. */
  readonly interpretOrders?: MailOrderInterpreter;
  /** Links parcels found in mail to their carrier's tracking connection, so they get polled. */
  readonly followUp: (connectionId: string) => Promise<void>;
  /** The user's first fallback service, for parcels whose carrier no rule knows. */
  readonly fallbackCarrier: () => Promise<string | undefined>;
}

/** What one email gave. */
export interface MailReading {
  readonly snapshots: readonly ParcelSnapshot[];
  readonly returns: readonly ReturnSnapshot[];
  readonly orders: readonly OrderSnapshot[];
}

/** What the status page shows of one inbox. */
export interface InboxStatus {
  /** Connected and watching (IDLE). */
  readonly connected: boolean;
  /** When the next reconnect is tried after a failure; null when none is waiting. */
  readonly reconnectAt: string | null;
  /** Failed connects or syncs in a row. */
  readonly failures: number;
}

interface Connection {
  readonly client: MailboxClient;
  readonly config: MailConfig;
  progress: MailProgress;
  syncing: Promise<void>;
  resync: ReturnType<typeof setInterval> | undefined;
}

function isAuthFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "authenticationFailed" in error &&
    error.authenticationFailed === true
  );
}

function addressText(value: AddressObject | AddressObject[] | undefined): string {
  if (value === undefined) {
    return "";
  }
  const list = Array.isArray(value) ? value : [value];
  // "Name <address>" keeps the display name, which names the shop on platforms that send for
  // many shops from one address.
  return list
    .flatMap((entry) =>
      entry.value.map((address) =>
        address.name === ""
          ? (address.address ?? "")
          : `${address.name} <${address.address ?? ""}>`,
      ),
    )
    .join(", ");
}

/** A Date header this far ahead of now is a sender's wrong clock, not a time to trust. */
const FUTURE_SKEW_MS = 15 * 60_000;

/**
 * The time a mail stands for: its Date header when that is plausible, else when the server
 * received it. A missing header never becomes "now", and a future-dated one never becomes the
 * parcel's status time (which would block carrier updates until it passed).
 */
export function mailDate(header: Date | null, receivedAt: Date | null, now: Date): Date | null {
  const plausible = (date: Date | null): date is Date =>
    date !== null &&
    !Number.isNaN(date.getTime()) &&
    date.getTime() <= now.getTime() + FUTURE_SKEW_MS;
  if (plausible(header)) {
    return header;
  }
  return plausible(receivedAt) ? receivedAt : null;
}

export async function toMailInput(
  source: Buffer,
  receivedAt: Date | null = null,
  now: Date = new Date(),
): Promise<MailInput> {
  const parsed = await simpleParser(source, { skipImageLinks: true });
  return {
    messageId: parsed.messageId ?? null,
    from: addressText(parsed.from),
    subject: parsed.subject ?? "",
    text: parsed.text ?? null,
    html: typeof parsed.html === "string" ? parsed.html : null,
    date: mailDate(parsed.date ?? null, receivedAt, now),
    // Header lines come in the order of the message: the first was added last, on receipt.
    authentication:
      parsed.headerLines
        .find((header) => header.key === "authentication-results")
        ?.line.replace(/^[^:]*:\s*/, "") ?? null,
  };
}

/** Watches every inbox connection over IMAP IDLE and feeds what it finds to the reconciler. */
export class MailWatcher {
  readonly #connections = new Map<string, Connection>();
  readonly #retries = new Map<string, number>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #reconnectAt = new Map<string, string>();
  #stopped = true;

  constructor(private readonly deps: MailWatcherDeps) {}

  status(connectionId: string): InboxStatus {
    return {
      connected: this.#connections.has(connectionId),
      reconnectAt: this.#reconnectAt.get(connectionId) ?? null,
      failures: this.#retries.get(connectionId) ?? 0,
    };
  }

  async start(): Promise<void> {
    this.#stopped = false;
    const rows = await this.deps.db
      .selectFrom("connections")
      .selectAll()
      .where("kind", "=", "mail")
      .where("state", "in", ["ok", "error"])
      .execute();
    const results = await Promise.allSettled(rows.map((row) => this.connect(row.id)));
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        // One inbox must never keep the server from starting.
        this.deps.logger.error(
          { err: result.reason, connection: rows[index]?.id },
          "Starting an inbox failed.",
        );
      }
    });
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    for (const timer of this.#timers.values()) {
      clearTimeout(timer);
    }
    this.#timers.clear();
    this.#reconnectAt.clear();
    await Promise.all([...this.#connections.keys()].map((id) => this.disconnect(id)));
  }

  /** (Re)connects one inbox connection; safe to call after its settings or sign-in changed. */
  async connect(connectionId: string): Promise<void> {
    await this.disconnect(connectionId);
    const row = await this.deps.db
      .selectFrom("connections")
      .selectAll()
      .where("id", "=", connectionId)
      .executeTakeFirst();
    if (
      row?.kind !== "mail" ||
      row.provider !== MAIL_PROVIDER ||
      row.secret_blob === null ||
      this.#stopped
    ) {
      return;
    }
    const opened = await this.#open(row, row.secret_blob);
    if (opened === undefined) {
      return;
    }
    const { config, secret, progress } = opened;
    if (isGenericInboxLabel(row.label, config.host)) {
      await this.deps.db
        .updateTable("connections")
        .set({ label: inboxLabel(secret.username, config.host) })
        .where("id", "=", row.id)
        .execute();
    }
    const client = this.deps.clientFactory(config, secret);
    const connection: Connection = {
      client,
      config,
      progress,
      syncing: Promise.resolve(),
      resync: undefined,
    };
    try {
      await client.connect();
    } catch (error) {
      await this.#failed(connectionId, error);
      return;
    }
    this.#connections.set(connectionId, connection);
    client.onClose((error) => {
      if (this.#connections.get(connectionId) === connection) {
        this.#connections.delete(connectionId);
        this.#failed(
          connectionId,
          error ?? new Error("The mail server closed the connection."),
        ).catch((failure: unknown) => {
          this.deps.logger.error(
            { err: failure, connection: connectionId },
            "Handling a closed inbox failed.",
          );
        });
      }
    });
    client.onNewMail(() => {
      this.#queueSync(connectionId, connection, [config.folders[0] ?? "INBOX"]);
    });
    connection.resync = setInterval(() => {
      this.#queueSync(connectionId, connection, config.folders);
    }, RESYNC_MS);
    connection.resync.unref();
    // The first sync (up to `initialDays` of mail) runs on in the background: adding an inbox or
    // starting the server does not wait for it. Its failures go to #failed like any other.
    this.#queueSync(connectionId, connection, config.folders);
  }

  /** Resolves once the syncs queued so far on this inbox have run. */
  async settled(connectionId: string): Promise<void> {
    await this.#connections.get(connectionId)?.syncing;
  }

  async disconnect(connectionId: string): Promise<void> {
    const connection = this.#connections.get(connectionId);
    this.#connections.delete(connectionId);
    if (connection === undefined) {
      return;
    }
    if (connection.resync !== undefined) {
      clearInterval(connection.resync);
    }
    // Let a sync that is already running finish; its own failures are handled inside the chain.
    await connection.syncing;
    await connection.client.close().catch((error: unknown) => {
      this.deps.logger.debug(
        { err: error, connection: connectionId },
        "Closing the mail connection failed.",
      );
    });
  }

  /**
   * Reads an inbox's stored settings and sign-in. A connection that cannot be read (a changed
   * encryption key, settings in a bad shape) is marked and skipped, never allowed to stop the
   * other inboxes or the server's start.
   */
  async #open(
    row: ConnectionRow,
    secretBlob: Buffer,
  ): Promise<{ config: MailConfig; secret: MailSecret; progress: MailProgress } | undefined> {
    try {
      const config = mailConfigSchema.parse(JSON.parse(row.config));
      const secret = mailSecretSchema.parse(
        this.deps.secrets.decryptJson(secretBlob, secretAad(row.id)),
      );
      return { config, secret, progress: this.#progress(row) };
    } catch (error) {
      if (error instanceof DecryptionError) {
        await this.deps.connections.setState(row.id, "needs_sign_in", cause("sign_in_unreadable"));
      } else if (error instanceof ZodError || error instanceof SyntaxError) {
        await this.deps.connections.setState(row.id, "error", cause("inbox_settings_invalid"));
      } else {
        throw error;
      }
      this.deps.logger.warn(
        { connection: row.id, error: error.name },
        "An inbox connection could not be read.",
      );
      return undefined;
    }
  }

  #progress(row: ConnectionRow): MailProgress {
    if (row.session_blob === null) {
      return {};
    }
    let stored: unknown;
    try {
      stored = this.deps.secrets.decryptJson(row.session_blob, sessionAad(row.id));
    } catch (error) {
      if (!(error instanceof DecryptionError)) {
        throw error;
      }
      // Only the read position is lost: the inbox is read again from its first-sync window.
      return {};
    }
    const parsed = mailProgressSchema.safeParse(stored);
    return parsed.success ? parsed.data : {};
  }

  #queueSync(connectionId: string, connection: Connection, folders: readonly string[]): void {
    connection.syncing = connection.syncing
      .then(() => this.#sync(connectionId, connection, folders))
      .catch((error: unknown) => this.#failed(connectionId, error));
  }

  async #sync(
    connectionId: string,
    connection: Connection,
    folders: readonly string[],
  ): Promise<void> {
    const snapshots: ParcelSnapshot[] = [];
    const returns: ReturnSnapshot[] = [];
    const orders: OrderSnapshot[] = [];
    // Built on a copy and committed only once the mails are stored: a failed batch is read again
    // on the next sync, whatever else runs on the connection in between.
    let progress = connection.progress;
    // The first folder is opened last so it stays selected for IDLE.
    for (const folder of [...folders].reverse()) {
      const { uidValidity } = await connection.client.open(folder);
      const known = progress[folder];
      let lastUid = known?.uidValidity === uidValidity ? known.lastUid : 0;
      const readUpTo = lastUid;
      const messages: AsyncIterable<FetchedMessage> =
        known?.uidValidity === uidValidity
          ? connection.client.fetchAfter(lastUid)
          : connection.client.fetchUids(
              await connection.client.searchSince(
                new Date(this.deps.clock.now().getTime() - connection.config.initialDays * DAY_MS),
              ),
            );
      for await (const message of messages) {
        // `UID FETCH n:*` returns the newest message even when nothing newer exists (`*` is the
        // highest UID, so the range turns around); it was read already.
        if (message.uid <= readUpTo) continue;
        lastUid = Math.max(lastUid, message.uid);
        const mail = await toMailInput(
          message.source,
          message.receivedAt ?? null,
          this.deps.clock.now(),
        );
        const read = await this.read(connectionId, mail, connection.config.checkSenders);
        snapshots.push(...read.snapshots);
        returns.push(...read.returns);
        orders.push(...read.orders);
      }
      progress = { ...progress, [folder]: { uidValidity, lastUid } };
    }
    if (snapshots.length > 0 || returns.length > 0 || orders.length > 0) {
      await this.deps.reconciler.ingest(connectionId, {
        snapshots: await this.withFallbackCarrier(snapshots),
        returns,
        orders,
        complete: false,
      });
      await this.deps.followUp(connectionId);
    }
    connection.progress = progress;
    await this.deps.db
      .updateTable("connections")
      .set({
        session_blob: this.deps.secrets.encryptJson(progress, sessionAad(connectionId)),
        last_run_at: isoNow(this.deps.clock),
        last_ok_at: isoNow(this.deps.clock),
      })
      .where("id", "=", connectionId)
      .execute();
    // Only a whole sync resets the reconnect backoff: a server that accepts the connection and
    // drops it straight away must not be reconnected to every 30 seconds.
    this.#retries.delete(connectionId);
    await this.deps.connections.setState(connectionId, "ok", NO_CAUSE);
  }

  /**
   * What one email says: read by the providers of its sender's domain, else by the shared rules
   * (never both, so no parcel twice). Parcels of carriers no rule knows are still unresolved
   * (`withFallbackCarrier`).
   */
  async read(connectionId: string, mail: MailInput, checkSenders: boolean): Promise<MailReading> {
    const routed = await this.deps.router.read(connectionId, mail, checkSenders);
    if (routed !== null) return routed;
    return {
      snapshots: this.#interpret(connectionId, mail, this.deps.interpret),
      returns: this.#interpret(connectionId, mail, this.deps.interpretReturns),
      orders: this.#interpret(connectionId, mail, this.deps.interpretOrders),
    };
  }

  /** Files parcels without a known carrier under the first fallback service; drops them without. */
  async withFallbackCarrier(
    snapshots: readonly ParcelSnapshot[],
  ): Promise<readonly ParcelSnapshot[]> {
    if (!snapshots.some((parcel) => parcel.carrier === TO_FALLBACK_SERVICE)) return snapshots;
    const fallback = await this.deps.fallbackCarrier();
    return snapshots.flatMap((parcel) =>
      parcel.carrier !== TO_FALLBACK_SERVICE
        ? [parcel]
        : fallback === undefined
          ? []
          : [{ ...parcel, carrier: fallback }],
    );
  }

  #interpret<T>(
    connectionId: string,
    mail: MailInput,
    interpret: ((mail: MailInput) => readonly T[]) | undefined,
  ): readonly T[] {
    try {
      return interpret?.(mail) ?? [];
    } catch (error) {
      // One odd mail must not stop the inbox; the content is never logged.
      this.deps.logger.warn(
        { connection: connectionId, error: error instanceof Error ? error.name : "unknown" },
        "A mail could not be interpreted.",
      );
      return [];
    }
  }

  async #failed(connectionId: string, error: unknown): Promise<void> {
    if (this.#stopped) {
      // Shutting down: connections closing now is expected, and the database may be gone.
      return;
    }
    if (isAuthFailure(error)) {
      await this.deps.connections.setState(
        connectionId,
        "needs_sign_in",
        cause("inbox_sign_in_rejected"),
      );
      return;
    }
    if (this.#timers.has(connectionId)) {
      // A reconnect is already on its way: another failure before it runs must not add a second
      // one, or a refusing server gets a burst of reconnects.
      return;
    }
    const attempt = (this.#retries.get(connectionId) ?? 0) + 1;
    this.#retries.set(connectionId, attempt);
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_MS);
    this.deps.logger.warn(
      {
        connection: connectionId,
        attempt,
        retryInMs: delay,
        error: error instanceof Error ? error.message : "unknown",
      },
      "Inbox connection failed.",
    );
    await this.deps.connections.setState(connectionId, "error", cause("inbox_unreachable"));
    this.#reconnectAt.set(
      connectionId,
      new Date(this.deps.clock.now().getTime() + delay).toISOString(),
    );
    const timer = setTimeout(() => {
      this.#timers.delete(connectionId);
      this.#reconnectAt.delete(connectionId);
      if (this.#stopped) {
        return;
      }
      this.connect(connectionId).catch((failure: unknown) => {
        this.deps.logger.error(
          { err: failure, connection: connectionId },
          "Reconnecting the inbox failed.",
        );
      });
    }, delay);
    timer.unref();
    this.#timers.set(connectionId, timer);
  }
}
