import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { isPrivateAddress } from "./address.js";

/**
 * DNS lookup for outgoing requests to addresses taken from data (carrier links, redirects, image
 * and tile hosts) that refuses private addresses at connect time. A check before the request is
 * not enough on its own: a host could resolve to a public address for the check and to a private
 * one for the connection (DNS rebinding).
 */
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error !== null) {
      callback(error, "", 0);
      return;
    }
    const allowed = addresses.filter((entry) => !isPrivateAddress(entry.address));
    const first = allowed[0];
    if (first === undefined || allowed.length !== addresses.length) {
      callback(new Error(`Refusing to connect to a non-public address for ${hostname}.`), "", 0);
      return;
    }
    if (options.all === true) {
      callback(null, allowed);
      return;
    }
    callback(null, first.address, first.family);
  });
};

/** The connection pool for such requests: every connection goes through `publicOnlyLookup`. */
export const guardedAgent = new Agent({ connect: { lookup: publicOnlyLookup } });

/** Statuses whose responses carry no body. */
const NULL_BODY = new Set([101, 103, 204, 205, 304]);

/**
 * `fetch` through `guardedAgent`, with undici's own fetch (the agent's library; the runtime's
 * built-in fetch bundles its own copy). Text and form bodies only. Redirects are the caller's to
 * follow, hop by hop, so each hop is checked again. The answer is handed back as a standard
 * Response, its body still streaming.
 */
/** `fetch` as the outbound clients call it; tests pass their own. */
export type FetchLike = (input: URL, init: RequestInit) => Promise<Response>;

export async function guardedFetch(input: URL, init: RequestInit): Promise<Response> {
  return fetchThrough(guardedAgent, input, init);
}

/**
 * The connection pool for the few hosts the user allowed on their own network (a fallback
 * service on the LAN): no address check, everything else as `guardedFetch`.
 */
const privateNetworkAgent = new Agent();

/** `guardedFetch` for a host the user allowed to be on their own network. */
export async function privateNetworkFetch(input: URL, init: RequestInit): Promise<Response> {
  return fetchThrough(privateNetworkAgent, input, init);
}

async function fetchThrough(agent: Agent, input: URL, init: RequestInit): Promise<Response> {
  const body = init.body ?? undefined;
  if (body !== undefined && typeof body !== "string" && !(body instanceof URLSearchParams)) {
    throw new TypeError("Only text and form bodies are sent through the guarded fetch.");
  }
  const response = await undiciFetch(input, {
    method: init.method ?? "GET",
    headers: [...new Headers(init.headers)],
    ...(body === undefined ? {} : { body }),
    redirect: "manual",
    ...(init.signal === undefined || init.signal === null ? {} : { signal: init.signal }),
    dispatcher: agent,
  });
  return new Response(NULL_BODY.has(response.status) ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers],
  });
}
