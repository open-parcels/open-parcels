import { HostNotAllowedError } from "../provider/http.js";
import type { HostAllowList } from "../provider/manifest.js";
import { userAgent } from "../version.js";
import type { ConsumerHttp, ConsumerResponse } from "./api.js";

/**
 * The core's network for consumers (`docs/consumers.md` §6): every request is held to the
 * consumer's allow-list, redirects are not followed, with a timeout and a body cap. Unlike a
 * provider's, the hosts may be private addresses: they are the user's own servers (an ntfy or
 * apprise-api container on the LAN), typed into the consumer's settings.
 */

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 64 * 1024;

export type ConsumerFetch = (url: URL, init: RequestInit) => Promise<Response>;

/** A thrown network failure; the dispatcher counts it as "try again". */
class ConsumerNetworkError extends Error {
  override readonly name = "ConsumerNetworkError";
}

async function cappedText(response: Response): Promise<string> {
  const reader = (response.body as ReadableStream<Uint8Array> | null)?.getReader();
  if (reader === undefined) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function consumerHttp(hosts: HostAllowList, fetchImpl: ConsumerFetch = fetch): ConsumerHttp {
  return async (request) => {
    const url = new URL(request.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new HostNotAllowedError(`${url.protocol} is not a web address.`);
    }
    if (!hosts.allows(url.hostname)) {
      throw new HostNotAllowedError(`${url.hostname} is not in the consumer's allowed hosts.`);
    }
    const headers = new Headers(request.headers);
    if (!headers.has("user-agent")) headers.set("user-agent", userAgent());
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: request.method,
        headers,
        ...(request.body === null ? {} : { body: request.body }),
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new ConsumerNetworkError(`Request to ${url.hostname} failed.`, { cause: error });
    }
    const answer: ConsumerResponse = {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await cappedText(response),
    };
    return answer;
  };
}
