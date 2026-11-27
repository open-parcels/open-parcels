import { InvalidConnectionConfigError, type InvalidConnectionReason } from "../engine/registry.js";
import {
  CaptchaError,
  InvalidConfigError,
  PageChangedError,
  ProviderError,
  RateLimitedError,
  RequestTimeoutError,
  SignInRejectedError,
  TransientError,
  UnexpectedResponseError,
} from "../provider/errors.js";
import { HostNotAllowedError } from "../provider/http.js";
import type {
  LiveTarget,
  ProviderConnectionKind,
  ProviderEmail,
  SignInInput,
} from "../provider/api.js";
import type { WireError } from "./child.js";

/**
 * What crosses the boundary between the core and the provider guest
 * (`docs/provider-manifest-and-sandbox.md` §2): the methods' arguments, the capabilities' names,
 * and the error classes rebuilt on either side, so the runner's classification is the same in
 * both isolation modes.
 */

/** Everything a provider call carries besides its own arguments. */
export interface CallBase {
  readonly provider: string;
  readonly connectionId: string;
  /** The core's time when the call started; the guest's clock moves with each answered hop. */
  readonly now: number;
}

/** A connection call: config, secret and session travel with it; the child keeps none. */
export interface ConnectionCall extends CallBase {
  readonly rawConfig: unknown;
  readonly rawSecret: unknown;
  /** What the session store held when the call started. */
  readonly session: unknown;
}

export interface TrackCall extends ConnectionCall {
  readonly trackingNumbers: readonly string[];
}

export interface LiveCall extends ConnectionCall {
  readonly target: LiveTarget;
}

/** One leg of a task action: its input and the checkpoint the last leg saved travel with it. */
export interface ActionWireCall extends ConnectionCall {
  readonly actionId: string;
  readonly input: unknown;
  readonly checkpoint: unknown;
}

/** One email to read: no config, secret or session travel with it, and no network is granted. */
export interface EmailCall extends CallBase {
  readonly email: ProviderEmail;
}

/** What every job capability answers: whether the job was cancelled meanwhile. */
export interface JobAnswer {
  readonly cancelled: boolean;
}

export interface SignInTurnCall extends CallBase {
  readonly action: "start" | "continue" | "poll";
  readonly flowId: string;
  readonly kind: ProviderConnectionKind;
  readonly rawConfig: unknown;
  readonly state?: unknown;
  readonly input?: SignInInput;
}

/** The capabilities a provider call may be granted, by name. */
export const CAPABILITY = {
  /** One HTTP hop; the answer carries the core's time as `now`. */
  http: "http",
  /** Saves the session store (only for a manifest with `session`). */
  sessionSave: "session.save",
  log: "log",
  reportUnknown: "report-unknown",
  /** A task action's progress, results and checkpoint (`runAction` only). */
  jobProgress: "job.progress",
  jobEmit: "job.emit",
  jobCheckpoint: "job.checkpoint",
  /** A rest between pages, timed by the core and ended early by a cancel. */
  jobWait: "job.wait",
} as const;

export interface LogRequest {
  readonly level: "debug" | "info" | "warn";
  readonly context: Readonly<Record<string, unknown>>;
  readonly message: string;
}

export interface UnknownRequest {
  readonly kind: string;
  readonly key: string;
}

const PLAIN: Readonly<Record<string, new (message: string) => Error>> = {
  ProviderError,
  SignInRejectedError,
  CaptchaError,
  InvalidConfigError,
  PageChangedError,
  TransientError,
  UnexpectedResponseError,
  RequestTimeoutError,
  HostNotAllowedError,
};

/**
 * Most specific first, so a subclass is found before its parent. Names as written, not the
 * classes' `name`: a bundler may rename a class.
 */
const KNOWN: readonly (readonly [string, abstract new (...args: never[]) => Error])[] = [
  ["RateLimitedError", RateLimitedError],
  ["InvalidConnectionConfigError", InvalidConnectionConfigError],
  ["UnexpectedResponseError", UnexpectedResponseError],
  ["RequestTimeoutError", RequestTimeoutError],
  ["SignInRejectedError", SignInRejectedError],
  ["CaptchaError", CaptchaError],
  ["InvalidConfigError", InvalidConfigError],
  ["PageChangedError", PageChangedError],
  ["TransientError", TransientError],
  ["ProviderError", ProviderError],
  ["HostNotAllowedError", HostNotAllowedError],
];

/**
 * Marks a provider's own error class (`BotGuardError extends TransientError`) with its nearest
 * class the core knows, as `kind`, so the core rebuilds that class and keeps the name.
 */
export function withKind(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const known = KNOWN.find(([, type]) => error instanceof type)?.[0];
  if (known === undefined || known === error.name) return error;
  return Object.assign(error, { kind: known });
}

function rebuilt(wire: WireError, name: string): Error | undefined {
  if (name === "RateLimitedError") {
    return new RateLimitedError(wire.message, wire.retryAfterSeconds);
  }
  if (name === "InvalidConnectionConfigError") {
    return new InvalidConnectionConfigError(
      wire.message,
      (wire.reason ?? "provider") as InvalidConnectionReason,
      wire.values ?? {},
    );
  }
  const Known = Object.hasOwn(PLAIN, name) ? PLAIN[name] : undefined;
  return Known === undefined ? undefined : new Known(wire.message);
}

/**
 * The provider API's (and the engine's) error class for an error that crossed the boundary, with
 * its name and message; a provider's own class becomes its known ancestor (`kind`) under its own
 * name. Anything unknown stays a plain `Error` of the same name, which the runner treats as
 * unexpected, as it would in-process.
 */
export function rebuildProviderError(wire: WireError): Error {
  const error = rebuilt(wire, wire.kind ?? wire.name);
  if (error === undefined) {
    return Object.assign(new Error(wire.message), { name: wire.name });
  }
  if (error.name !== wire.name) {
    Object.defineProperty(error, "name", { value: wire.name });
  }
  return error;
}
