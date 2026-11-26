import { createHmac } from "node:crypto";
import { z } from "zod";
import {
  outcomeOf,
  type Consumer,
  type ConsumerCall,
  type DeliveryOutcome,
  type Message,
} from "../../api.js";
import { parseConsumerManifest } from "../../manifest.js";
import raw from "./open-parcels-consumer.json" with { type: "json" };

/**
 * A signed JSON POST (`docs/consumers.md` §5): `X-Open-Parcels-Signature: sha256=<hex>` is the
 * HMAC-SHA256 of `<timestamp>.<body>` with the configured secret, the timestamp (unix seconds) in
 * `X-Open-Parcels-Timestamp`.
 */

const manifest = parseConsumerManifest(raw, "webhook");

const configSchema = z.strictObject({
  url: z
    .url({ protocol: /^https?$/ })
    .meta({ title: "Address", description: "The address that receives the POST." }),
});

const secretSchema = z.strictObject({
  signing_secret: z.string().min(16).meta({
    title: "Signing secret",
    description: "Shared secret for the HMAC-SHA256 signature; at least 16 characters.",
  }),
});

const SIGNATURE_HEADER = "x-open-parcels-signature";
const TIMESTAMP_HEADER = "x-open-parcels-timestamp";

/** The signature header's value for `body` sent at `timestamp` (unix seconds). */
function signature(key: string, timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", key).update(`${timestamp}.${body}`).digest("hex")}`;
}

async function post(
  message: Message,
  call: ConsumerCall,
  now: () => Date,
): Promise<DeliveryOutcome> {
  const config = configSchema.parse(call.config);
  const secret = secretSchema.parse(call.secret);
  const sentAt = now();
  const body = JSON.stringify({
    type: message.type,
    sent_at: sentAt.toISOString(),
    language: message.language,
    title: message.title,
    body: message.body,
    url: message.url,
    notifications: message.items,
  });
  const timestamp = String(Math.floor(sentAt.getTime() / 1000));
  const response = await call.http({
    url: config.url,
    method: "POST",
    headers: {
      "content-type": "application/json",
      [TIMESTAMP_HEADER]: timestamp,
      [SIGNATURE_HEADER]: signature(secret.signing_secret, timestamp, body),
    },
    body,
  });
  return outcomeOf(response, "The webhook");
}

/** The webhook consumer; `now` stamps each request (the server's clock). */
export function webhookConsumer(now: () => Date): Consumer {
  return {
    describe: () => ({ manifest, configSchema, secretSchema }),
    deliver: (message, call) => post(message, call, now),
    test: (message, call) => post(message, call, now),
  };
}
