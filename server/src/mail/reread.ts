import type { Logger } from "pino";
import { z } from "zod";
import { DAY_MS, type Clock } from "../clock.js";
import type { SecretBox } from "../crypto/secrets.js";
import type { ConnectionRow } from "../db/schema.js";
import type { ActionCall } from "../engine/registry.js";
import { secretAad } from "../engine/connections.js";
import { InvalidConnectionConfigError } from "../engine/registry.js";
import type { CoreAction, CoreActions } from "../jobs/service.js";
import { SignInRejectedError, TransientError, type ActionResult } from "../provider/api.js";
import type { OrderSnapshot, ParcelSnapshot, ReturnSnapshot } from "../provider/snapshot.js";
import {
  mailConfigSchema,
  mailSecretSchema,
  type MailboxClient,
  type MailboxClientFactory,
  type MailConfig,
} from "./types.js";
import { toMailInput, type MailWatcher } from "./watcher.js";

/**
 * The inbox's "Read old emails again" (`docs/connection-actions-and-jobs.md` §8): a job that reads
 * the inbox's emails of the last days again, so orders, parcels and returns of the past appear
 * (after "Clear data", or for an inbox added with a short first sync). Paced, in batches, and
 * resumable: the checkpoint holds the folder and the highest UID read.
 */

const REREAD_ACTION = "reread_emails";

/** Emails per batch; each batch is stored, checkpointed and followed by a rest. */
const BATCH = 25;
/** The rest between batches, so the mail server is never hurried. */
const REST_MS = 2_000;
/** Emails per leg; then the job rests a while and continues. */
const LEG = 2_000;
const LEG_REST_S = 300;

const inputSchema = z.object({
  days: z
    .number()
    .int()
    .min(1)
    .max(3650)
    .default(365)
    .meta({ title: "Days to read again", description: "How far back emails are read again." }),
});

const action: CoreAction = {
  id: REREAD_ACTION,
  kind: "task",
  label: "Read old emails again",
  description:
    "Reads this inbox's emails of the chosen number of days again, so past orders, parcels and returns appear.",
  connection_kinds: ["mail"],
  when_state: ["ok", "idle", "error"],
  weight: "heavy",
  confirm: "This reads many emails again, slowly. Parcels it finds are stored as history.",
  destructive: false,
  expose_to_ha: true,
  cooldown_minutes: 60,
};

/** Where a leg goes on: the folder by index, its UIDVALIDITY, and the highest UID read in it. */
const checkpointSchema = z.object({
  folder: z.number().int().nonnegative(),
  uidValidity: z.string().nullable(),
  afterUid: z.number().int().nonnegative(),
  emails: z.number().int().nonnegative(),
  parcels: z.number().int().nonnegative(),
  orders: z.number().int().nonnegative(),
  returns: z.number().int().nonnegative(),
});
type Checkpoint = z.infer<typeof checkpointSchema>;

const START: Checkpoint = {
  folder: 0,
  uidValidity: null,
  afterUid: 0,
  emails: 0,
  parcels: 0,
  orders: 0,
  returns: 0,
};

export interface RereadDeps {
  readonly secrets: SecretBox;
  readonly clock: Clock;
  readonly clientFactory: MailboxClientFactory;
  readonly watcher: MailWatcher;
}

function isAuthFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "authenticationFailed" in error &&
    error.authenticationFailed === true
  );
}

/**
 * The mail server's failures in the job's terms: a refused sign-in waits for the owner, a
 * network or protocol failure (an error with a `code`) is retried; anything else stays as it is.
 */
function asJobError(error: unknown): unknown {
  if (isAuthFailure(error)) return new SignInRejectedError("The mail server refused the sign-in.");
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return new TransientError(`The mail server failed: ${error.message}`);
  }
  return error;
}

function summary(at: Checkpoint): string {
  return `${String(at.emails)} emails: ${String(at.parcels)} parcels, ${String(at.orders)} orders, ${String(at.returns)} returns`;
}

class Reread {
  readonly #batch: {
    snapshots: ParcelSnapshot[];
    orders: OrderSnapshot[];
    returns: ReturnSnapshot[];
  } = {
    snapshots: [],
    orders: [],
    returns: [],
  };

  constructor(
    private readonly deps: RereadDeps,
    private readonly row: ConnectionRow,
    private readonly config: MailConfig,
    private readonly client: MailboxClient,
    private readonly call: ActionCall,
  ) {}

  async run(days: number): Promise<ActionResult> {
    const stored = checkpointSchema.safeParse(this.call.checkpoint.load());
    let at = stored.success ? stored.data : START;
    const since = new Date(this.deps.clock.now().getTime() - days * DAY_MS);
    let leg = 0;
    while (at.folder < this.config.folders.length) {
      const folder = this.config.folders[at.folder] ?? "INBOX";
      const { uidValidity } = await this.client.open(folder);
      // A folder whose UIDs were renumbered is read again from its start.
      const afterUid = at.uidValidity === uidValidity ? at.afterUid : 0;
      const uids = (await this.client.searchSince(since))
        .filter((uid) => uid > afterUid)
        .sort((a, b) => a - b);
      at = { ...at, uidValidity, afterUid };
      for (let index = 0; index < uids.length; index += BATCH) {
        if (this.call.signal.aborted) return { status: "partial", summary: summary(at) };
        if (leg >= LEG) {
          return { status: "pause", seconds: LEG_REST_S, summary: summary(at) };
        }
        const chunk = uids.slice(index, index + BATCH);
        at = await this.#readBatch(chunk, at);
        leg += chunk.length;
        this.call.progress({
          done: index + chunk.length,
          total: uids.length,
          phase: `${folder}: ${String(index + chunk.length)} of ${String(uids.length)}`,
        });
        await this.call.wait(REST_MS);
      }
      at = { ...at, folder: at.folder + 1, uidValidity: null, afterUid: 0 };
      await this.call.checkpoint.save(at);
    }
    return { status: "done", summary: summary(at) };
  }

  async #readBatch(uids: readonly number[], at: Checkpoint): Promise<Checkpoint> {
    let next = at;
    for await (const message of this.client.fetchUids(uids)) {
      const mail = await toMailInput(
        message.source,
        message.receivedAt ?? null,
        this.deps.clock.now(),
      );
      const read = await this.deps.watcher.read(this.row.id, mail, this.config.checkSenders);
      this.#batch.snapshots.push(...read.snapshots);
      this.#batch.orders.push(...read.orders);
      this.#batch.returns.push(...read.returns);
      next = { ...next, emails: next.emails + 1, afterUid: Math.max(next.afterUid, message.uid) };
    }
    const snapshots = await this.deps.watcher.withFallbackCarrier(this.#batch.snapshots);
    const { orders, returns } = this.#batch;
    if (snapshots.length > 0 || orders.length > 0 || returns.length > 0) {
      await this.call.emit({ snapshots, orders, returns });
    }
    next = {
      ...next,
      parcels: next.parcels + snapshots.length,
      orders: next.orders + orders.length,
      returns: next.returns + returns.length,
    };
    this.#batch.snapshots = [];
    this.#batch.orders = [];
    this.#batch.returns = [];
    await this.call.checkpoint.save(next);
    return next;
  }
}

/** The inbox's core actions, for the job service (`CoreActions`). */
export function inboxActions(deps: RereadDeps): CoreActions {
  return {
    actions: [action],
    actionInput: (actionId) => (actionId === REREAD_ACTION ? inputSchema : undefined),
    async run(row, call, log: Logger) {
      const parsedConfig = mailConfigSchema.safeParse(JSON.parse(row.config));
      if (!parsedConfig.success || row.secret_blob === null) {
        throw new InvalidConnectionConfigError("The inbox's settings cannot be read.", "provider", {
          detail: "inbox",
        });
      }
      // A key that no longer decrypts the sign-in pauses the job until the owner signs in.
      const secret = mailSecretSchema.parse(
        deps.secrets.decryptJson(row.secret_blob, secretAad(row.id)),
      );
      const { days } = inputSchema.parse(call.input);
      // A connection of its own: the watcher's stays in IDLE meanwhile.
      const client = deps.clientFactory(parsedConfig.data, secret);
      try {
        await client.connect();
        return await new Reread(deps, row, parsedConfig.data, client, call).run(days);
      } catch (error) {
        throw asJobError(error);
      } finally {
        await client.close().catch((error: unknown) => {
          log.debug({ err: error }, "Closing the mail connection failed.");
        });
      }
    },
  };
}
