import type { z } from "zod";
import type { Language } from "../i18n/language.js";
import type { ConsumerManifest } from "./manifest.js";
import type { NotificationEvent } from "./rules.js";

/**
 * The consumer API (`docs/consumers.md` §4): what a consumer gets and answers. Consumers only
 * format and deliver; which notification goes where, and when, is decided in the core.
 */

/** One HTTP request a consumer sends; no redirects are followed. */
interface ConsumerRequest {
  readonly url: string;
  readonly method: "GET" | "POST" | "PUT";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
}

export interface ConsumerResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** Sends one request through the core, which holds it to the consumer's hosts. */
export type ConsumerHttp = (request: ConsumerRequest) => Promise<ConsumerResponse>;

/** One email, for the built-in email consumer only (`permissions.smtp`). */
interface ConsumerEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}
export type ConsumerSmtp = (email: ConsumerEmail) => Promise<DeliveryOutcome>;

/** What each call carries: the config and secret of this configured consumer, and the network. */
export interface ConsumerCall {
  readonly config: unknown;
  /** Decrypted for this call only; null when none is stored. */
  readonly secret: unknown;
  readonly http: ConsumerHttp;
  /** Only for a consumer whose manifest has `permissions.smtp`. */
  readonly smtp?: ConsumerSmtp;
}

/** One notification as a consumer sees it: the core's texts and the fields the manifest asked for. */
export interface MessageItem {
  readonly event: NotificationEvent;
  readonly title: string;
  readonly body: string;
  /** The parcel's page (with OPENPARCELS_PUBLIC_URL), else its carrier's tracking page. */
  readonly url: string | null;
  readonly at: string;
  readonly parcel: Readonly<Record<string, unknown>> | null;
}

/** What one delivery sends: one notification, a digest of several, or a test. */
export interface Message {
  readonly type: "notification" | "digest" | "test";
  readonly language: Language;
  readonly title: string;
  readonly body: string;
  readonly url: string | null;
  readonly items: readonly MessageItem[];
}

/** ok; try again (after the given seconds, when the service said); or never (bad token, say). */
export type DeliveryOutcome =
  | { readonly kind: "ok" }
  | { readonly kind: "retry"; readonly message: string; readonly retryAfterSeconds?: number }
  | { readonly kind: "failed"; readonly message: string };

export interface ConsumerDescription {
  readonly manifest: ConsumerManifest;
  /** The settings form; secret fields are not in it. */
  readonly configSchema: z.ZodType;
  /** The secret form (token, password, HMAC key); null when the consumer has none. */
  readonly secretSchema: z.ZodType | null;
}

export interface Consumer {
  describe(): ConsumerDescription;
  deliver(message: Message, call: ConsumerCall): Promise<DeliveryOutcome>;
  test(message: Message, call: ConsumerCall): Promise<DeliveryOutcome>;
}

/** The usual reading of an HTTP answer: 2xx ok, 429/5xx again later, other 4xx never. */
export function outcomeOf(response: ConsumerResponse, service: string): DeliveryOutcome {
  if (response.status >= 200 && response.status < 300) return { kind: "ok" };
  const detail = `${service} answered HTTP ${String(response.status)}.`;
  if (response.status === 429 || response.status >= 500 || response.status === 408) {
    const retryAfter = Number(response.headers["retry-after"]);
    return Number.isFinite(retryAfter) && retryAfter > 0
      ? { kind: "retry", message: detail, retryAfterSeconds: retryAfter }
      : { kind: "retry", message: detail };
  }
  return { kind: "failed", message: detail };
}
