import { isIP } from "node:net";
import { getPublicSuffix, type CookieJar } from "tough-cookie";
import type { Clock, Sleep } from "../clock.js";
import { isNonPublicHostLiteral } from "../net/address.js";
import { guardedFetch, privateNetworkFetch, type FetchLike } from "../net/guarded-fetch.js";
import { userAgent } from "../version.js";
import { RateLimitedError, RequestTimeoutError, TransientError } from "./errors.js";
import type { HostAllowList } from "./manifest.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

/** Pacing for one host: at most `burst` requests back to back, refilled one per `intervalMs`. */
export interface HostLimit {
  readonly intervalMs: number;
  readonly burst: number;
}

/** A pause a host asked for without saying how long (or for 0 s): as the scheduler's first backoff. */
const HOST_PAUSE_DEFAULT_S = 60;
/** The longest pause a host's Retry-After imposes, as the scheduler honours it. */
const HOST_PAUSE_MAX_S = 24 * 60 * 60;

/**
 * Token bucket per host, shared by every connection of the same carrier, plus the pause a host
 * asked for: after a 429 (or a 503 with Retry-After) no connection sends it anything until the
 * pause is over, so a second account or a live read cannot run into the same limit again.
 */
export class HostLimiter {
  readonly #buckets = new Map<
    string,
    { tokens: number; updatedAt: number; queue: Promise<void> }
  >();
  /** Host → end of its pause, in ms since the epoch. */
  readonly #pauses = new Map<string, number>();

  constructor(
    private readonly clock: Clock,
    private readonly sleep: Sleep,
  ) {}

  /** Seconds left of a pause `host` asked for; undefined when there is none. */
  pausedFor(host: string): number | undefined {
    const until = this.#pauses.get(host);
    if (until === undefined) return undefined;
    const left = until - this.clock.now().getTime();
    if (left <= 0) {
      this.#pauses.delete(host);
      return undefined;
    }
    return Math.ceil(left / 1000);
  }

  /** Records that `host` asked to be left alone; a shorter request never shortens a pause. */
  pause(host: string, retryAfterSeconds: number | undefined): void {
    const seconds = Math.min(
      Math.max(retryAfterSeconds ?? 0, HOST_PAUSE_DEFAULT_S),
      HOST_PAUSE_MAX_S,
    );
    const until = this.clock.now().getTime() + seconds * 1000;
    this.#pauses.set(host, Math.max(until, this.#pauses.get(host) ?? 0));
  }

  /** Resolves when a request to `host` may be sent. Calls for one host are served in order. */
  acquire(host: string, limit: HostLimit): Promise<void> {
    const bucket = this.#buckets.get(host) ?? {
      tokens: limit.burst,
      updatedAt: this.clock.now().getTime(),
      queue: Promise.resolve(),
    };
    this.#buckets.set(host, bucket);
    const turn = bucket.queue.then(async () => {
      const now = this.clock.now().getTime();
      bucket.tokens = Math.min(
        limit.burst,
        bucket.tokens + (now - bucket.updatedAt) / limit.intervalMs,
      );
      bucket.updatedAt = now;
      if (bucket.tokens < 1) {
        const waitMs = Math.ceil((1 - bucket.tokens) * limit.intervalMs);
        await this.sleep(waitMs);
        bucket.tokens = 1;
        bucket.updatedAt = this.clock.now().getTime();
      }
      bucket.tokens -= 1;
    });
    bucket.queue = turn;
    return turn;
  }
}

/** Parses Retry-After: either seconds or an HTTP date. */
export function parseRetryAfter(value: string | null, now: Date): number | undefined {
  if (value === null || value.trim() === "") {
    return undefined;
  }
  if (/^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now.getTime()) / 1000));
}

export interface HttpPolicy {
  /** Limits per host name; `*` applies to hosts not listed. */
  readonly limits: Readonly<Record<string, HostLimit>>;
  /**
   * Only set when the carrier refuses an honest client User-Agent. `reason` documents what the
   * carrier does without it; it is not shown to users.
   */
  readonly userAgent?: { readonly value: string; readonly reason: string };
}

export interface RequestOptions {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | URLSearchParams;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  /** How to decode the body when the carrier declares no charset. Defaults to UTF-8. */
  readonly encoding?: "utf8" | "latin1";
  /** Follow redirects automatically. Off when a provider has to inspect them (allow-listing). */
  readonly redirect?: "follow" | "manual";
  /** Send and store cookies through this jar, also those set by redirects along the way. */
  readonly jar?: CookieJar;
  /**
   * Which hosts a redirect may lead to. Default: the same site with a jar, any https host
   * without one.
   */
  readonly allowRedirect?: (target: URL) => boolean;
}

const MAX_REDIRECTS = 10;

/** Headers that carry a credential or a session, which must not follow a redirect elsewhere. */
const CREDENTIAL_HEADER =
  /^(?:authorization|proxy-authorization|cookie|x-[\w-]*(?:token|csrf|xsrf|key|auth|session)[\w-]*)$/i;

function withoutCredentials(
  headers: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers ?? {}).filter(([name]) => !CREDENTIAL_HEADER.test(name)),
  );
}

/** The registrable domain (`example.co.uk`); the host itself for IP literals. */
function registrableDomain(hostname: string): string {
  if (isIP(hostname.replace(/^\[|\]$/g, "")) !== 0) {
    return hostname;
  }
  try {
    return getPublicSuffix(hostname) ?? hostname;
  } catch {
    // tough-cookie refuses special-use names (`.invalid`, `.localhost`); those are not on the
    // public suffix list, so the last two labels are their registrable part.
    return hostname.split(".").slice(-2).join(".");
  }
}

/**
 * Same host, or a host under the same registrable domain (`www.example.de` → `login.example.de`).
 * The registrable domain comes from the public suffix list, so `a.example.co.uk` never matches
 * `other.co.uk`.
 */
export function sameSite(origin: URL): (target: URL) => boolean {
  const parent = registrableDomain(origin.hostname);
  return (target) =>
    target.protocol === "https:" &&
    (target.hostname === parent || target.hostname.endsWith(`.${parent}`));
}

/** A short, value-free name for why a request never got an answer: `timeout`, `ECONNRESET`… */
export function networkCause(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return "timeout";
  }
  const inner = error instanceof Error ? error.cause : undefined;
  const code =
    inner !== null && typeof inner === "object" && "code" in inner ? inner.code : undefined;
  if (typeof code === "string" && /^[A-Z_]+$/.test(code)) {
    return code;
  }
  return error instanceof Error ? error.name : "unknown error";
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly url: string;
  readonly body: string;
  json(): unknown;
}

const DEFAULT_LIMIT: HostLimit = { intervalMs: 2_000, burst: 3 };

/**
 * A request to a host the provider's manifest does not list. Deliberately not a `ProviderError`:
 * it is a bug in the provider (or a carrier moved), so the run is logged as unexpected, and it
 * never counts as a sign-in problem.
 */
export class HostNotAllowedError extends Error {
  override readonly name = "HostNotAllowedError";
}

/** One request, no redirects: what the client hands its transport for each hop. */
export interface HopRequest {
  readonly url: URL;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | URLSearchParams | undefined;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  /** Aborts the hop (a cancelled job): the request is refused, or dropped while in flight. */
  readonly signal?: AbortSignal;
}

/** A hop refused or dropped because the job that sent it was cancelled or reached its ceiling. */
class HopAbortedError extends Error {
  override readonly name = "HopAbortedError";
}

/** Whether a hop's signal has aborted (a call, so a check before a wait does not narrow it). */
const stopped = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;

/** Rejects once `signal` aborts; never settles otherwise. */
function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const fail = (): void => {
      reject(new HopAbortedError("The job was stopped; the request was dropped."));
    };
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
}

/**
 * `transport` bound to a job's signal: once it aborts, no hop is sent, and one waiting for its
 * host's turn or in flight is dropped at once instead of running to its end.
 */
export function abortableTransport(transport: HopTransport, signal: AbortSignal): HopTransport {
  return (hop) => {
    if (signal.aborted) {
      return Promise.reject(new HopAbortedError("The job was stopped; the request was refused."));
    }
    return Promise.race([transport({ ...hop, signal }), aborted(signal)]);
  };
}

/** A hop's answer, its body already read (and capped). */
export interface HopResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Buffer;
}

/**
 * Sends one hop. The core's transport (`coreTransport`) is where every rule about the network
 * lives; a sandboxed provider reaches it over IPC (`sandbox/http.ts`).
 */
export type HopTransport = (request: HopRequest) => Promise<HopResponse>;

async function readBody(response: Response, maxBytes: number, url: URL): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return Buffer.alloc(0);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    const chunk: unknown = result.value;
    if (!(chunk instanceof Uint8Array)) {
      throw new TransientError(`Unexpected body chunk from ${url.hostname}.`);
    }
    total += chunk.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new TransientError(`Response from ${url.hostname} exceeded ${maxBytes} bytes.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * The core's transport for one provider: the manifest's hosts, no non-public addresses, the host
 * token buckets and pauses, the honest User-Agent, a timeout and a body cap, for every hop.
 */
export function coreTransport(
  policy: HttpPolicy,
  /** The hosts the provider's manifest allows. */
  hosts: HostAllowList,
  limiter: HostLimiter,
  clock: Clock,
  fetchImpl: FetchLike = guardedFetch,
): HopTransport {
  // For a host the user allowed on their own network; a test's own fetch serves both.
  const privateFetchImpl = fetchImpl === guardedFetch ? privateNetworkFetch : fetchImpl;
  return async (hop) => {
    const url = hop.url;
    if (!hosts.allows(url.hostname)) {
      throw new HostNotAllowedError(`${url.hostname} is not in the provider's manifest.`);
    }
    // Providers build some URLs from carrier data (links, redirects); none may point inward,
    // except the host the user allowed on their own network.
    const inward = hosts.allowsPrivate?.(url.hostname) === true;
    if (!inward && isNonPublicHostLiteral(url.hostname)) {
      throw new TransientError("Refusing a request to a non-public address.");
    }
    const paused = limiter.pausedFor(url.hostname);
    if (paused !== undefined) {
      throw new RateLimitedError(
        `${url.hostname} asked us to slow down; waiting ${String(paused)} s more before asking again.`,
        paused,
      );
    }
    await limiter.acquire(
      url.hostname,
      policy.limits[url.hostname] ?? policy.limits["*"] ?? DEFAULT_LIMIT,
    );
    if (stopped(hop.signal)) {
      throw new HopAbortedError("The job was stopped; the request was refused.");
    }
    const timeout = AbortSignal.timeout(hop.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const headers = new Headers(hop.headers);
    if (!headers.has("user-agent")) {
      headers.set("user-agent", policy.userAgent?.value ?? userAgent());
    }
    let response: Response;
    try {
      response = await (inward ? privateFetchImpl : fetchImpl)(url, {
        method: hop.method,
        headers,
        ...(hop.body === undefined ? {} : { body: hop.body }),
        redirect: "manual",
        signal: hop.signal === undefined ? timeout : AbortSignal.any([timeout, hop.signal]),
      });
    } catch (error) {
      if (stopped(hop.signal)) {
        throw new HopAbortedError("The job was stopped; the request was dropped.", {
          cause: error,
        });
      }
      const cause = networkCause(error);
      const message = `Request to ${url.hostname} failed (${cause}).`;
      throw cause === "timeout"
        ? new RequestTimeoutError(message, { cause: error })
        : new TransientError(message, { cause: error });
    }
    const retryAfter = parseRetryAfter(response.headers.get("retry-after"), clock.now());
    if (response.status === 429 || (response.status === 503 && retryAfter !== undefined)) {
      await response.body?.cancel();
      limiter.pause(url.hostname, retryAfter);
      throw new RateLimitedError(
        `${url.hostname} asked us to slow down (HTTP ${response.status}).`,
        retryAfter,
      );
    }
    const isRedirect = response.status >= 300 && response.status < 400;
    if (isRedirect && response.headers.has("location")) {
      await response.body?.cancel();
      return { status: response.status, headers: response.headers, body: Buffer.alloc(0) };
    }
    const body = await readBody(response, hop.maxBytes ?? DEFAULT_MAX_BYTES, url);
    return { status: response.status, headers: response.headers, body };
  };
}

/** The only way providers reach the network: redirects, cookies and decoding over a transport. */
export class ProviderHttp {
  /** The transport every hop goes through; a sandboxed provider's hops are answered by it. */
  constructor(readonly transport: HopTransport) {}

  /**
   * Sends a request. Redirects are followed here, hop by hop (never by the runtime), so every hop
   * goes through the transport (paced, checked against the manifest and for non-public
   * addresses) and the chain is capped at MAX_REDIRECTS; with a cookie jar, cookies set along the
   * way are kept. Headers that carry credentials are not sent on to another host.
   */
  async request(url: URL, options: RequestOptions = {}): Promise<HttpResponse> {
    const jar = options.jar;
    // A jar's session stays on the site by default. Without one nothing of a session travels
    // along, so any https host may be visited (non-public addresses are refused on every hop).
    const allow =
      options.allowRedirect ??
      (jar === undefined
        ? (target: URL) => target.protocol === "https:" || target.origin === url.origin
        : sameSite(url));
    let current = url;
    let method = options.method ?? "GET";
    let body = options.body;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const cookie = jar === undefined ? "" : await jar.getCookieString(current);
      const own = current.host === url.host ? options.headers : withoutCredentials(options.headers);
      const response = await this.transport({
        url: current,
        method,
        headers: { ...own, ...(cookie === "" ? {} : { cookie }) },
        body,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
      });
      if (jar !== undefined) {
        for (const setCookie of response.headers.getSetCookie()) {
          await jar.setCookie(setCookie, current, { ignoreError: true });
        }
      }
      const location = response.headers.get("location");
      if (
        response.status < 300 ||
        response.status >= 400 ||
        location === null ||
        options.redirect === "manual"
      ) {
        const text = response.body.toString(options.encoding ?? "utf8");
        return {
          status: response.status,
          headers: response.headers,
          url: current.toString(),
          body: text,
          json: () => JSON.parse(text) as unknown,
        };
      }
      const next = new URL(location, current);
      if (!allow(next)) {
        throw new TransientError(
          `${current.hostname} redirected to a host that is not allowed (${next.hostname}).`,
        );
      }
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && method === "POST")
      ) {
        method = "GET";
        body = undefined;
      }
      current = next;
    }
    throw new TransientError(`Too many redirects from ${url.hostname}.`);
  }
}

/** A provider's HTTP client in the core: `ProviderHttp` over `coreTransport`. */
export function coreHttp(
  policy: HttpPolicy,
  hosts: HostAllowList,
  limiter: HostLimiter,
  clock: Clock,
  fetchImpl: FetchLike = guardedFetch,
): ProviderHttp {
  return new ProviderHttp(coreTransport(policy, hosts, limiter, clock, fetchImpl));
}
