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
 * apprise-api (https://github.com/caronc/apprise-api): `POST <server>/notify/<key>` for a
 * configuration stored there, or `POST <server>/notify` with the Apprise URLs themselves, which
 * hold the services' tokens and are kept as the secret.
 */

const manifest = parseConsumerManifest(raw, "apprise");

const configSchema = z.strictObject({
  server: z
    .url({ protocol: /^https?$/ })
    .meta({ title: "Server", description: "The apprise-api server, e.g. http://apprise:8000." }),
  key: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .optional()
    .meta({
      title: "Configuration key",
      description: "Key of a configuration saved in apprise-api; leave empty to send Apprise URLs.",
    }),
});

const secretSchema = z.strictObject({
  urls: z.string().min(3).meta({
    title: "Apprise URLs",
    description: "One per line, used when no configuration key is set.",
  }),
});

const TYPES = { notification: "info", digest: "info", test: "info" } as const;

async function notify(message: Message, call: ConsumerCall): Promise<DeliveryOutcome> {
  const config = configSchema.parse(call.config);
  const secret = call.secret === null ? null : secretSchema.parse(call.secret);
  if (config.key === undefined && secret === null) {
    return { kind: "failed", message: "Set a key or Apprise URLs." };
  }
  const base = config.server.replace(/\/+$/, "");
  const failure = message.items.some(
    (item) => item.event === "problem" || item.event.endsWith("_failed"),
  );
  const body = {
    title: message.title,
    body: message.url === null ? message.body : `${message.body}\n\n${message.url}`,
    type: failure ? "warning" : TYPES[message.type],
    format: "text",
    ...(config.key === undefined && secret !== null
      ? { urls: secret.urls.split(/\s+/).filter((url) => url !== "") }
      : {}),
  };
  const response = await call.http({
    url: config.key === undefined ? `${base}/notify` : `${base}/notify/${config.key}`,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return outcomeOf(response, "apprise-api");
}

export const apprise: Consumer = {
  describe: () => ({ manifest, configSchema, secretSchema }),
  deliver: notify,
  test: notify,
};
