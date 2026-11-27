import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { addMs, isoNow, realSleep, type Clock, type Sleep } from "../clock.js";
import { DecryptionError, type SecretBox } from "../crypto/secrets.js";
import type { ConnectionRow, Database, JobRow } from "../db/schema.js";
import type { Kysely } from "kysely";
import type { z } from "zod";
import type { EventBus } from "../events/bus.js";
import {
  CaptchaError,
  PageChangedError,
  RateLimitedError,
  SignInRejectedError,
  TransientError,
  type ActionBatch,
  type ActionResult,
  type JobProgress,
} from "../provider/api.js";
import { abortableTransport, ProviderHttp } from "../provider/http.js";
import { linkUrl, type ManifestAction } from "../provider/manifest.js";
import type { Reconciler } from "../engine/reconciler.js";
import {
  InvalidConnectionConfigError,
  type ActionCall,
  type ProviderRegistry,
  type RegisteredProvider,
} from "../engine/registry.js";
import type { ConnectionRunner } from "../engine/runner.js";
import {
  checkpointAad,
  JobStore,
  NO_PROGRESS,
  RESUMABLE_STATES,
  type JobProgressBody,
  type JobState,
} from "./store.js";

/**
 * Runs connection actions (`docs/connection-actions-and-jobs.md`): links are answered at once,
 * tasks become jobs that run here, one per connection, heavy ones one at a time per server,
 * sharing the connection's lock with its runs and giving it up between pages.
 */

const MINUTE_MS = 60_000;
/** Wall time of one leg; then the job pauses (`ceiling`) and resuming continues. */
const LEG_CEILING_MS = 12 * 60 * MINUTE_MS;
/** How long a cancelled job may take to stop before it is recorded as cancelled anyway. */
const CANCEL_GRACE_MS = 30_000;
/** At most one `job.progress` (and progress write) per job this often. */
const PROGRESS_EVERY_MS = 5_000;
const CHECKPOINT_MAX_BYTES = 256 * 1024;
/** Waits before the first, second and third retry of a transient failure. */
const RETRY_MINUTES = [1, 5, 15] as const;
const WAITING_FOR_CARRIER_MS = 60 * MINUTE_MS;
const CAPTCHA_PAUSE_MS = 6 * 60 * MINUTE_MS;
const RATE_LIMIT_DEFAULT_S = 15 * 60;
/** The longest the service sleeps before looking for due paused jobs again. */
const MAX_TIMER_MS = 60 * MINUTE_MS;

export type JobErrorCode =
  | "connection_not_found"
  | "job_not_found"
  | "no_such_action"
  | "action_unavailable"
  | "job_running"
  | "action_cooldown"
  | "invalid_input"
  | "job_state";

export class JobError extends Error {
  override readonly name = "JobError";

  constructor(
    readonly code: JobErrorCode,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

/** One of a connection's actions, with whether it may start now. */
export interface ConnectionAction {
  readonly action: DeclaredAction;
  readonly available: boolean;
  readonly cooldownUntil: string | null;
}

export type StartOutcome = { readonly job: JobRow } | { readonly url: string };

/** A task the core declares for connections of its own (inboxes): a manifest task for `mail`. */
export type CoreAction = Omit<Extract<ManifestAction, { kind: "task" }>, "connection_kinds"> & {
  readonly connection_kinds: readonly ConnectionRow["kind"][];
};

/** An action as a provider's manifest or the core declares it. */
export type DeclaredAction = ManifestAction | CoreAction;

/**
 * Task actions of connections the core serves itself, not a provider (the inbox's "Read old
 * emails again"): declared like a manifest's, run in the server.
 */
export interface CoreActions {
  readonly actions: readonly CoreAction[];
  actionInput(actionId: string): z.ZodType | undefined;
  /** Runs one leg, like a provider's `runAction`; requests and errors are its own. */
  run(row: ConnectionRow, call: ActionCall, log: Logger): Promise<ActionResult>;
}

/** Whoever declares and runs a connection's actions: its provider, or the core. */
export interface ActionSource {
  readonly actions: readonly DeclaredAction[];
  actionInput(actionId: string): z.ZodType | undefined;
  /** Set for a provider: links are filled from its manifest, tasks run through its runtime. */
  readonly provider?: RegisteredProvider;
  readonly core?: CoreActions;
}

export interface JobDeps {
  readonly db: Kysely<Database>;
  readonly registry: ProviderRegistry;
  readonly runner: ConnectionRunner;
  readonly reconciler: Reconciler;
  readonly secrets: SecretBox;
  readonly bus: EventBus;
  readonly clock: Clock;
  readonly logger: Logger;
  /** How a job rests between pages (`ActionContext.wait`); tests pass a fast one. */
  readonly sleep?: Sleep;
  /** Actions the core runs itself, by the connections' provider id (`imap`). */
  readonly coreActions?: Readonly<Record<string, CoreActions>>;
}

interface Running {
  readonly controller: AbortController;
  readonly heavy: boolean;
  readonly done: Promise<void>;
  /** Why the signal was aborted, if it was. */
  why?: "cancel" | "ceiling";
  /** Set once a cancel's grace ran out: nothing of the job is accepted any more. */
  closed: boolean;
  grace?: NodeJS.Timeout;
}

/** The action of `source` with this id that applies to connections of `kind`. */
function actionOf(
  source: ActionSource | undefined,
  kind: string,
  actionId: string,
): DeclaredAction | undefined {
  return source?.actions.find(
    (action) =>
      action.id === actionId && (action.connection_kinds as readonly string[]).includes(kind),
  );
}

export class JobService {
  readonly store: JobStore;
  readonly #running = new Map<string, Running>();
  #ticking: Promise<void> | undefined;
  #again = false;
  #timer: NodeJS.Timeout | undefined;
  #started = false;
  #stopped = false;

  constructor(private readonly deps: JobDeps) {
    this.store = new JobStore(deps.db, deps.bus, deps.clock);
  }

  /** Puts interrupted jobs back in the queue and starts working through it. */
  async start(): Promise<void> {
    this.#started = true;
    await this.store.requeueInterrupted();
    this.wake();
  }

  /** Stops starting jobs; running ones are left `running` and continue after the next start. */
  stop(): void {
    this.#stopped = true;
    clearTimeout(this.#timer);
    for (const running of this.#running.values()) {
      clearTimeout(running.grace);
      running.controller.abort();
    }
  }

  /** Looks for jobs to start now. */
  wake(): void {
    if (this.#stopped) return;
    if (this.#ticking !== undefined) {
      this.#again = true;
      return;
    }
    this.#ticking = this.#tick()
      .catch((error: unknown) => {
        this.deps.logger.error({ err: error }, "Starting jobs failed.");
      })
      .finally(() => {
        this.#ticking = undefined;
      });
  }

  /** Resolves once no job is running or starting (tests, and a clean stop). */
  async settled(): Promise<void> {
    for (;;) {
      const pending = [this.#ticking, ...[...this.#running.values()].map((r) => r.done)];
      const waiting = pending.filter((entry) => entry !== undefined);
      if (waiting.length === 0) return;
      await Promise.all(waiting);
    }
  }

  /** Who declares and runs the actions of a provider id's connections. */
  sourceOf(providerId: string): ActionSource | undefined {
    const core = Object.hasOwn(this.deps.coreActions ?? {}, providerId)
      ? this.deps.coreActions?.[providerId]
      : undefined;
    if (core !== undefined) {
      return { actions: core.actions, actionInput: (id) => core.actionInput(id), core };
    }
    const provider = this.deps.registry.get(providerId);
    return provider === undefined
      ? undefined
      : {
          actions: provider.manifest.actions,
          actionInput: (id) => provider.actionInput(id),
          provider,
        };
  }

  async #connection(connectionId: string): Promise<ConnectionRow | undefined> {
    return this.deps.db
      .selectFrom("connections")
      .selectAll()
      .where("id", "=", connectionId)
      .executeTakeFirst();
  }

  async #cooldownUntil(row: ConnectionRow, action: DeclaredAction): Promise<string | null> {
    if (action.kind !== "task" || action.cooldown_minutes === 0) return null;
    const last = await this.store.lastDone(row.id, action.id);
    if (last === undefined) return null;
    const until = addMs(new Date(last), action.cooldown_minutes * MINUTE_MS);
    return until > this.deps.clock.now() ? until.toISOString() : null;
  }

  /** The actions of the connection's kind, each with whether it may start now. */
  async actionsOf(connectionId: string): Promise<ConnectionAction[] | undefined> {
    const row = await this.#connection(connectionId);
    if (row === undefined) return undefined;
    const source = this.sourceOf(row.provider);
    const provider = source?.provider;
    const active = await this.store.active(row.id);
    const actions = (source?.actions ?? []).filter((action) =>
      (action.connection_kinds as readonly string[]).includes(row.kind),
    );
    return Promise.all(
      actions.map(async (action) => {
        const cooldownUntil = await this.#cooldownUntil(row, action);
        const stateAllows = (action.when_state as readonly string[]).includes(row.state);
        const available =
          action.kind === "link"
            ? provider !== undefined &&
              linkUrl(provider.manifest, action.url, JSON.parse(row.config)) !== undefined
            : stateAllows && active === undefined && cooldownUntil === null;
        return { action, available, cooldownUntil };
      }),
    );
  }

  /** Starts an action: a link's URL, or a new queued job. */
  async startAction(
    connectionId: string,
    actionId: string,
    rawInput: unknown,
  ): Promise<StartOutcome> {
    const row = await this.#connection(connectionId);
    if (row === undefined) throw new JobError("connection_not_found", "No such connection.");
    const source = this.sourceOf(row.provider);
    const action = actionOf(source, row.kind, actionId);
    if (source === undefined || action === undefined) {
      throw new JobError("no_such_action", `This connection has no action ${actionId}.`);
    }
    if (action.kind === "link") {
      const url =
        source.provider === undefined
          ? undefined
          : linkUrl(source.provider.manifest, action.url, JSON.parse(row.config));
      if (url === undefined) {
        throw new JobError("action_unavailable", "This connection's settings give no address.");
      }
      return { url };
    }
    if (!(action.when_state as readonly string[]).includes(row.state)) {
      throw new JobError("action_unavailable", `Not while the connection is ${row.state}.`);
    }
    if ((await this.store.active(row.id)) !== undefined) {
      throw new JobError("job_running", "This connection has a job already.");
    }
    await this.#checkCooldown(row, action);
    const input = this.#validInput(source, action.id, rawInput);
    const now = isoNow(this.deps.clock);
    const job = await this.store.insert(
      {
        id: randomUUID(),
        connection_id: row.id,
        provider: row.provider,
        action: action.id,
        input: JSON.stringify(input),
        state: "queued",
        reason: null,
        progress: JSON.stringify(NO_PROGRESS),
        checkpoint_blob: null,
        summary: null,
        retries: 0,
        created_at: now,
        started_at: null,
        updated_at: now,
        finished_at: null,
        resume_at: null,
      },
      "job.queued",
    );
    this.wake();
    return { job };
  }

  async #checkCooldown(row: ConnectionRow, action: DeclaredAction): Promise<void> {
    const until = await this.#cooldownUntil(row, action);
    if (until === null) return;
    const seconds = Math.max(
      1,
      Math.ceil((Date.parse(until) - this.deps.clock.now().getTime()) / 1000),
    );
    throw new JobError("action_cooldown", "This action ran a short while ago.", seconds);
  }

  #validInput(source: ActionSource, actionId: string, raw: unknown): unknown {
    const schema = source.actionInput(actionId);
    const parsed = schema?.safeParse(raw ?? {});
    if (parsed?.success !== true) {
      const fields = parsed?.error.issues.map((issue) => issue.path.join(".") || "(root)");
      throw new JobError("invalid_input", `Invalid input at: ${(fields ?? []).join(", ")}.`);
    }
    return parsed.data;
  }

  /** Cancels a job: at once when it waits, by aborting its signal when it runs. */
  async cancel(id: string): Promise<JobRow> {
    const job = await this.#job(id);
    const running = this.#running.get(id);
    if (running !== undefined) {
      this.#abort(id, running, "cancel");
      return job;
    }
    const cancelled = await this.store.update(
      id,
      { state: "cancelled", finished_at: isoNow(this.deps.clock), resume_at: null },
      "job.finished",
      ["queued", "paused"],
    );
    if (cancelled === undefined) {
      throw new JobError("job_state", `A ${job.state} job cannot be cancelled.`);
    }
    return cancelled;
  }

  /** Queues a stopped job again; `fresh` (restart) drops its checkpoint and progress first. */
  async resume(id: string, fresh: boolean): Promise<JobRow> {
    const job = await this.#job(id);
    const from: readonly JobState[] = fresh ? [...RESUMABLE_STATES, "done"] : RESUMABLE_STATES;
    if (!from.includes(job.state) || this.#running.has(id)) {
      throw new JobError(
        "job_state",
        `A ${job.state} job cannot be ${fresh ? "restarted" : "resumed"}.`,
      );
    }
    const other = await this.store.active(job.connection_id);
    if (other !== undefined && other.id !== id) {
      throw new JobError("job_running", "This connection has another job.");
    }
    const row = await this.#connection(job.connection_id);
    const action = actionOf(this.sourceOf(job.provider), row?.kind ?? "", job.action);
    if (row !== undefined && action !== undefined && job.state === "done") {
      await this.#checkCooldown(row, action);
    }
    const queued = await this.store.update(
      id,
      {
        state: "queued",
        reason: null,
        resume_at: null,
        finished_at: null,
        retries: 0,
        ...(fresh
          ? { checkpoint_blob: null, progress: JSON.stringify(NO_PROGRESS), summary: null }
          : {}),
      },
      "job.queued",
      from,
    );
    if (queued === undefined) throw new JobError("job_state", "The job changed meanwhile.");
    this.wake();
    return queued;
  }

  async #job(id: string): Promise<JobRow> {
    const job = await this.store.get(id);
    if (job === undefined) throw new JobError("job_not_found", "No such job.");
    return job;
  }

  #abort(id: string, running: Running, why: "cancel" | "ceiling"): void {
    running.why ??= why;
    running.controller.abort();
    if (why !== "cancel" || running.grace !== undefined) return;
    running.grace = setTimeout(() => {
      running.closed = true;
      void this.store
        .update(id, { state: "cancelled", finished_at: isoNow(this.deps.clock) }, "job.finished")
        .catch((error: unknown) => {
          this.deps.logger.error({ err: error }, "Recording a cancelled job failed.");
        });
    }, CANCEL_GRACE_MS);
    running.grace.unref();
  }

  async #tick(): Promise<void> {
    do {
      this.#again = false;
      const next = await this.store.resumeDue();
      let heavyBusy = [...this.#running.values()].some((running) => running.heavy);
      for (const job of await this.store.queued()) {
        if (this.#stopped || this.#running.has(job.id)) continue;
        const source = this.sourceOf(job.provider);
        const row = await this.#connection(job.connection_id);
        const action = actionOf(source, row?.kind ?? "", job.action);
        if (source === undefined || action?.kind !== "task") {
          await this.store.update(
            job.id,
            { state: "failed", reason: "action_missing", finished_at: isoNow(this.deps.clock) },
            "job.finished",
          );
          continue;
        }
        const heavy = action.weight === "heavy";
        if (heavy && heavyBusy) continue;
        heavyBusy ||= heavy;
        this.#launch(job, source, heavy);
      }
      this.#schedule(next);
    } while (this.#wokenMeanwhile());
  }

  /** Whether `wake()` was called while a tick ran (read through a call: it changes meanwhile). */
  #wokenMeanwhile(): boolean {
    return this.#again;
  }

  /** Wakes up when the next paused job is due (at most an hour away), once started. */
  #schedule(next: string | undefined): void {
    clearTimeout(this.#timer);
    if (!this.#started || this.#stopped || next === undefined) return;
    const wait = Math.min(
      MAX_TIMER_MS,
      Math.max(1_000, Date.parse(next) - this.deps.clock.now().getTime()),
    );
    this.#timer = setTimeout(() => {
      this.wake();
    }, wait);
    this.#timer.unref();
  }

  #launch(job: JobRow, source: ActionSource, heavy: boolean): void {
    const controller = new AbortController();
    let finish: () => void = () => undefined;
    const running: Running = {
      controller,
      heavy,
      closed: false,
      done: new Promise<void>((resolve) => {
        finish = resolve;
      }),
    };
    this.#running.set(job.id, running);
    const ceiling = setTimeout(() => {
      this.#abort(job.id, running, "ceiling");
    }, LEG_CEILING_MS);
    ceiling.unref();
    void this.#execute(job, source, running)
      .catch((error: unknown) => {
        this.deps.logger.error({ err: error, job: job.id }, "A job could not be recorded.");
      })
      .finally(() => {
        clearTimeout(ceiling);
        clearTimeout(running.grace);
        this.#running.delete(job.id);
        finish();
        // A heavy job's end lets the next one start.
        this.wake();
      });
  }

  async #execute(job: JobRow, source: ActionSource, running: Running): Promise<void> {
    const started = await this.store.update(
      job.id,
      { state: "running", started_at: job.started_at ?? isoNow(this.deps.clock) },
      "job.started",
      ["queued"],
    );
    if (started === undefined) return;
    const log = this.deps.logger.child({ provider: job.provider, connection: job.connection_id });
    let release = await this.deps.runner.acquire(job.connection_id);
    try {
      const row = await this.#connection(job.connection_id);
      if (row === undefined) return;
      const call = this.#call(started, running, {
        release: () => {
          release();
        },
        acquire: async () => {
          release = await this.deps.runner.acquire(job.connection_id);
        },
      });
      let outcome: unknown;
      try {
        outcome = await this.#run(source, row, call.hooks, running.controller.signal, log);
      } catch (error) {
        outcome = error;
      }
      if (running.closed || this.#stopped) return;
      await this.store.update(job.id, { progress: JSON.stringify(call.progress()) });
      await this.#record(job.id, running, outcome, log, call.retries());
    } finally {
      release();
    }
  }

  /** One leg: in the provider's runtime, or the core's own action. */
  async #run(
    source: ActionSource,
    row: ConnectionRow,
    hooks: ActionCall,
    signal: AbortSignal,
    log: Logger,
  ): Promise<ActionResult> {
    if (source.core !== undefined) return source.core.run(row, hooks, log);
    const provider = source.provider;
    if (provider === undefined) throw new Error("An action without a runtime.");
    const context = this.deps.runner.contextFor(row, provider, log);
    // A cancel drops the request in flight and refuses every further one at once.
    const base = {
      ...context.base,
      http: new ProviderHttp(abortableTransport(context.base.http.transport, signal)),
    };
    return provider.runAction(base, context.config, context.secret, hooks);
  }

  /** The job's side of the action context: checkpoint, progress and results. */
  #call(
    job: JobRow,
    running: Running,
    lock: { readonly release: () => void; readonly acquire: () => Promise<void> },
  ): { hooks: ActionCall; progress: () => JobProgressBody; retries: () => number } {
    const { secrets, clock } = this.deps;
    const sleep = this.deps.sleep ?? realSleep;
    const signal = running.controller.signal;
    const yieldLock = async (): Promise<void> => {
      lock.release();
      await lock.acquire();
    };
    let checkpoint =
      job.checkpoint_blob === null
        ? undefined
        : secrets.decryptJson(job.checkpoint_blob, checkpointAad(job.id));
    let progress: JobProgressBody = JSON.parse(job.progress) as JobProgressBody;
    let retries = job.retries;
    let reported = Number.NEGATIVE_INFINITY;
    const open = (): void => {
      if (running.closed || this.#stopped) {
        throw new Error("The job was stopped.");
      }
    };
    const hooks: ActionCall = {
      actionId: job.action,
      input: JSON.parse(job.input) as unknown,
      signal: running.controller.signal,
      checkpoint: {
        load: () => checkpoint,
        save: async (value) => {
          open();
          if (JSON.stringify(value).length > CHECKPOINT_MAX_BYTES) {
            throw new Error("The job's checkpoint is larger than 256 KB.");
          }
          const blob = secrets.encryptJson(value, checkpointAad(job.id));
          checkpoint = value;
          await this.store.update(job.id, {
            checkpoint_blob: blob,
            progress: JSON.stringify(progress),
          });
          await yieldLock();
        },
      },
      progress: (update: JobProgress) => {
        if (running.closed) return;
        progress = {
          done: update.done ?? progress.done,
          total: update.total === undefined ? progress.total : update.total,
          phase: update.phase?.slice(0, 120) ?? progress.phase,
        };
        const now = clock.now().getTime();
        if (now - reported < PROGRESS_EVERY_MS) return;
        reported = now;
        void this.store
          .update(job.id, { progress: JSON.stringify(progress) }, "job.progress", ["running"])
          .catch((error: unknown) => {
            this.deps.logger.warn({ err: error }, "Recording a job's progress failed.");
          });
      },
      emit: async (batch: ActionBatch) => {
        open();
        await this.deps.reconciler.ingest(
          job.connection_id,
          {
            snapshots: batch.snapshots ?? [],
            ...(batch.orders === undefined ? {} : { orders: batch.orders }),
            ...(batch.returns === undefined ? {} : { returns: batch.returns }),
            complete: false,
          },
          [],
          { imported: true },
        );
        retries = 0;
        await yieldLock();
      },
      wait: async (ms: number) => {
        if (signal.aborted) return;
        // The lock is given up for the rest, so the connection's runs go on meanwhile.
        lock.release();
        try {
          await untilAborted(sleep(Math.max(0, ms)), signal);
        } finally {
          await lock.acquire();
        }
      },
    };
    return { hooks, progress: () => progress, retries: () => retries };
  }

  /** Writes how a leg ended: finished, paused (with when it resumes) or failed. */
  async #record(
    id: string,
    running: Running,
    outcome: unknown,
    log: Logger,
    retries: number,
  ): Promise<void> {
    const now = this.deps.clock.now();
    const at = (ms: number): string => addMs(now, ms).toISOString();
    const finished = (state: JobState, changes: Partial<JobRow> = {}) =>
      this.store.update(id, { state, finished_at: now.toISOString(), ...changes }, "job.finished");
    const paused = (reason: string, resumeAt: string | null, changes: Partial<JobRow> = {}) =>
      this.store.update(
        id,
        { state: "paused", reason, resume_at: resumeAt, ...changes },
        "job.paused",
      );
    const result = isResult(outcome) ? outcome : undefined;
    if (running.why === "cancel") {
      await finished("cancelled", result?.summary === undefined ? {} : { summary: result.summary });
      return;
    }
    if (running.why === "ceiling") {
      await paused("ceiling", null);
      return;
    }
    if (result !== undefined) {
      if (result.status === "pause") {
        await paused("resting", at(Math.max(1, result.seconds) * 1000), {
          retries: 0,
          ...(result.summary === undefined ? {} : { summary: result.summary }),
        });
        return;
      }
      await finished(result.status, { summary: result.summary, reason: null, retries: 0 });
      return;
    }
    await this.#recordError(outcome, log, retries, { finished, paused, at });
  }

  async #recordError(
    error: unknown,
    log: Logger,
    retries: number,
    record: {
      finished: (state: JobState, changes?: Partial<JobRow>) => Promise<unknown>;
      paused: (reason: string, at: string | null, changes?: Partial<JobRow>) => Promise<unknown>;
      at: (ms: number) => string;
    },
  ): Promise<void> {
    const { finished, paused, at } = record;
    if (error instanceof RateLimitedError) {
      await paused("rate_limited", at((error.retryAfterSeconds ?? RATE_LIMIT_DEFAULT_S) * 1000));
    } else if (error instanceof CaptchaError) {
      await paused("captcha", at(CAPTCHA_PAUSE_MS));
    } else if (error instanceof SignInRejectedError || error instanceof DecryptionError) {
      // Never a new sign-in from here: the owner signs in, then resumes.
      await paused("needs_sign_in", null);
    } else if (error instanceof InvalidConnectionConfigError) {
      await finished("failed", { reason: "invalid_config" });
    } else if (error instanceof PageChangedError) {
      log.warn({ error: error.message }, "A job stopped: a page changed its shape.");
      await finished("failed", { reason: "page_changed" });
    } else if (error instanceof TransientError) {
      const attempt = retries + 1;
      const wait = RETRY_MINUTES[attempt - 1];
      log.warn({ attempt, error: error.message }, "A job's request failed; it waits.");
      await (wait === undefined
        ? paused("waiting_for_carrier", at(WAITING_FOR_CARRIER_MS), { retries: attempt })
        : paused("retrying", at(wait * MINUTE_MS), { retries: attempt }));
    } else {
      log.error({ err: error }, "A job failed unexpectedly.");
      await finished("failed", { reason: "unexpected" });
    }
  }
}

/** Resolves with `work`, or as soon as `signal` aborts, whichever comes first. */
async function untilAborted(work: Promise<void>, signal: AbortSignal): Promise<void> {
  let stop: () => void = () => undefined;
  const abort = new Promise<void>((resolve) => {
    stop = resolve;
  });
  signal.addEventListener("abort", stop, { once: true });
  try {
    await Promise.race([work, abort]);
  } finally {
    signal.removeEventListener("abort", stop);
  }
}

function isResult(value: unknown): value is ActionResult {
  return (
    value !== null &&
    typeof value === "object" &&
    !(value instanceof Error) &&
    "status" in value &&
    typeof value.status === "string"
  );
}
