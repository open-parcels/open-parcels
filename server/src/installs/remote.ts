import { readCapped } from "../net/body.js";
import type { FetchLike } from "../net/guarded-fetch.js";

/**
 * Reading from the registry, GitHub and other git forges: GET only, through the guarded fetch
 * (public addresses only), a time limit and a size cap. Redirects are not followed: a moved
 * repository is a failure to read, so the user sees the URL that was really installed. Every
 * failure is a `RemoteError` with a short reason.
 */

const TIMEOUT_MS = 15_000;
const USER_AGENT = "open-parcels";

export class RemoteError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "RemoteError";
    this.status = status;
  }
}

async function get(fetch: FetchLike, url: URL, accept: string, cap: number): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: { accept, "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new RemoteError(`${url.host} did not answer (${(error as Error).message})`);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new RemoteError(`${url.host} answered ${String(response.status)}`, response.status);
  }
  return readCapped(response, cap, () => new RemoteError(`${url.host} sent too much`));
}

/** A file's bytes (theme fonts and images, signatures). */
export async function getBytes(fetch: FetchLike, url: URL, cap: number): Promise<Buffer> {
  return get(fetch, url, "*/*", cap);
}

/** A JSON document; a body that is no JSON is a `RemoteError`. */
export async function getJson(fetch: FetchLike, url: URL, cap = 1_000_000): Promise<unknown> {
  const body = await get(fetch, url, "application/json", cap);
  try {
    return JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    throw new RemoteError(`${url.host} sent no JSON`);
  }
}
