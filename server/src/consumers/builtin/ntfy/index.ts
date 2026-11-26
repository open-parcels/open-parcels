import { z } from "zod";
import {
  outcomeOf,
  type Consumer,
  type ConsumerCall,
  type DeliveryOutcome,
  type Message,
} from "../../api.js";
import { parseConsumerManifest } from "../../manifest.js";
import type { NotificationEvent } from "../../rules.js";
import raw from "./open-parcels-consumer.json" with { type: "json" };

/** ntfy (https://docs.ntfy.sh/publish/): one JSON message per notification, published to a topic. */

const manifest = parseConsumerManifest(raw, "ntfy");

const configSchema = z.strictObject({
  server: z
    .url({ protocol: /^https?$/ })
    .meta({ title: "Server", description: "The ntfy server, e.g. https://ntfy.example.com." }),
  topic: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, "letters, digits, - and _")
    .meta({ title: "Topic", description: "The topic to publish to." }),
  priority: z
    .number()
    .int()
    .min(1)
    .max(5)
    .default(3)
    .meta({ title: "Priority", description: "1 (min) to 5 (max)." }),
});

const secretSchema = z.strictObject({
  token: z
    .string()
    .min(1)
    .meta({ title: "Access token", description: "For a server or topic that needs one." }),
});

/** ntfy shows these tag names as emoji. */
const TAGS: Readonly<Record<NotificationEvent, string>> = {
  registered: "package",
  in_transit: "truck",
  out_for_delivery: "truck",
  at_pickup_point: "post_office",
  delivered: "white_check_mark",
  delivery_time_changed: "calendar",
  returning: "leftwards_arrow_with_hook",
  problem: "warning",
  refunded: "moneybag",
  sign_in_needed: "key",
  backup_failed: "floppy_disk",
};

const VIEW_LABEL = { en: "View parcel", de: "Paket ansehen" } as const;

async function publish(message: Message, call: ConsumerCall): Promise<DeliveryOutcome> {
  const config = configSchema.parse(call.config);
  const secret = call.secret === null ? null : secretSchema.parse(call.secret);
  const first = message.items[0];
  const tags = message.type === "test" ? ["bell"] : first === undefined ? [] : [TAGS[first.event]];
  const body = {
    topic: config.topic,
    title: message.title,
    message: message.body,
    priority: config.priority,
    tags,
    ...(message.url === null
      ? {}
      : {
          click: message.url,
          actions: [{ action: "view", label: VIEW_LABEL[message.language], url: message.url }],
        }),
  };
  const response = await call.http({
    url: config.server,
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret === null ? {} : { authorization: `Bearer ${secret.token}` }),
    },
    body: JSON.stringify(body),
  });
  return outcomeOf(response, "The ntfy server");
}

export const ntfy: Consumer = {
  describe: () => ({ manifest, configSchema, secretSchema }),
  deliver: publish,
  test: publish,
};
