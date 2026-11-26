import type { FastifyInstance, FastifyRequest } from "fastify";
import { requestLanguage, type Language } from "../i18n/language.js";
import { MAIL_PROVIDER } from "../mail/types.js";
import type { Services } from "../services.js";

/**
 * Without a login the read-only view shows parcels, but not whose accounts they come from:
 * connection labels ("amazon.de · <name>", "Inbox <address> (<server>)"), connection settings and
 * consumers' labels and settings (recipient addresses, topics) are replaced by the provider's or
 * consumer's own name (owner decision 2026-11-26). A reader who logged in, an API token (Home
 * Assistant) and the admin see them as they are.
 */
function showsAccounts(request: Pick<FastifyRequest, "auth">): boolean {
  return request.auth?.kind !== "anonymous";
}

export interface AccountNames {
  /** The provider's name, e.g. "Amazon"; null when it is not installed. */
  readonly provider: (id: string) => string | null;
  /** The consumer's name, e.g. "ntfy"; null when it is not installed. */
  readonly consumer: (id: string) => string | null;
}

export function accountNames(
  services: Pick<Services, "registry" | "consumerCatalog">,
): AccountNames {
  return {
    provider: (id) => services.registry.get(id)?.info.name ?? null,
    consumer: (id) => services.consumerCatalog.get(id)?.describe().manifest.name ?? null,
  };
}

const INBOX_NAME: Readonly<Record<Language, string>> = { en: "Inbox", de: "Postfach" };

export type Masker = (value: unknown) => unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A function that copies a response or live event payload with every connection (an object with
 * a string `provider` and `label`) and every consumer (string `consumer` and `label`) masked.
 * Decided by shape, so new routes and live events are covered without opting in.
 */
export function accountMasker(names: AccountNames, language: Language): Masker {
  const providerName = (id: string): string =>
    id === MAIL_PROVIDER ? INBOX_NAME[language] : (names.provider(id) ?? id);
  const mask: Masker = (value) => {
    if (Array.isArray(value)) return value.map(mask);
    if (!isRecord(value)) return value;
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) copy[key] = mask(entry);
    const { label, provider, consumer } = value;
    if (typeof label !== "string") return copy;
    if (typeof provider === "string") {
      copy["label"] = providerName(provider);
    } else if (typeof consumer === "string") {
      copy["label"] = names.consumer(consumer) ?? consumer;
    } else {
      return copy;
    }
    if ("config" in value) copy["config"] = null;
    return copy;
  };
  return mask;
}

/** The masker for this request, or null when it may see accounts. */
export function maskerFor(
  request: Pick<FastifyRequest, "auth" | "headers">,
  names: AccountNames,
): Masker | null {
  return showsAccounts(request)
    ? null
    : accountMasker(names, requestLanguage(request.headers["accept-language"]));
}

/** Masks every JSON answer to a caller without a login (the live event stream masks its own). */
export function registerAccountMasking(app: FastifyInstance, names: AccountNames): void {
  app.addHook("preSerialization", (request, _reply, payload, done) => {
    const mask = maskerFor(request, names);
    done(null, mask === null ? payload : mask(payload));
  });
}
