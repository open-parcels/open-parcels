import type { z } from "zod";
import type { ProviderContext } from "./api.js";
import type { OrderSnapshot, ParcelSnapshot, ReturnSnapshot } from "./snapshot.js";

/**
 * Connection actions that run provider code as a job (`docs/connection-actions-and-jobs.md` §2).
 * What an action is (label, kinds, weight) is in the manifest; what it does is here.
 */

/** How far a job has come; every field optional, a missing one keeps its last value. */
export interface JobProgress {
  readonly done?: number;
  /** Null: the total is not known. */
  readonly total?: number | null;
  /** Short and free of personal values: "2023: page 4". */
  readonly phase?: string;
}

/** Results a job writes as it goes, reconciled at once like a run's (merged, never "gone"). */
export interface ActionBatch {
  readonly snapshots?: readonly ParcelSnapshot[];
  readonly orders?: readonly OrderSnapshot[];
  readonly returns?: readonly ReturnSnapshot[];
}

/** The job's resumable state: what the last leg saved, encrypted, at most 256 KB as JSON. */
export interface CheckpointStore {
  /** Undefined on the first leg, and after "Start over". */
  load(): unknown;
  save(value: unknown): Promise<void>;
}

export interface ActionContext<Config, Secret> extends ProviderContext<Config, Secret> {
  /** Aborted on cancel, and at the job's time ceiling: save a checkpoint and return soon. */
  readonly signal: AbortSignal;
  readonly checkpoint: CheckpointStore;
  progress(update: JobProgress): void;
  emit(batch: ActionBatch): Promise<void>;
  /**
   * Rests `ms` between pages (a paced import's delay), holding no lock. Ends early, without an
   * error, when the job is cancelled: check `signal` after it.
   */
  wait(ms: number): Promise<void>;
}

/**
 * How a leg ended: `done`; `partial` (stopped early on purpose, a resume continues); or `pause`,
 * to rest `seconds` before the next leg starts on its own (a paced import's break).
 */
export type ActionResult =
  | { readonly status: "done" | "partial"; readonly summary: string }
  | { readonly status: "pause"; readonly seconds: number; readonly summary?: string };

/** A task action's code, with its input erased; build one with `defineAction`. */
export interface ProviderAction<Config, Secret> {
  /** The input the action takes; every field defaulted means the action needs none. */
  readonly input: z.ZodType;
  run(context: ActionContext<Config, Secret>, input: unknown): Promise<ActionResult>;
}

/** Keeps the input's type for `run`; the core has validated it against `input` already. */
export function defineAction<Config, Secret, Input>(action: {
  readonly input: z.ZodType<Input>;
  run(context: ActionContext<Config, Secret>, input: Input): Promise<ActionResult>;
}): ProviderAction<Config, Secret> {
  return {
    input: action.input,
    run: (context, input) => action.run(context, action.input.parse(input)),
  };
}
