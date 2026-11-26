import { z } from "zod";
import type { OutboxEvent } from "../events/types.js";
import type { Language } from "../i18n/language.js";
import type { Message, MessageItem } from "./api.js";
import type { ConsumerField } from "./manifest.js";
import type { NotificationEvent } from "./rules.js";
import { formatWhen, texts } from "./texts.js";

/**
 * From live event to notification (`docs/consumers.md` §2): which live events notify, the key that
 * keeps each state change to one notification, and the texts written for a consumer.
 */

/** What is stored of a notification: no courier position, nothing a consumer could not ask for. */
export const notificationDataSchema = z.object({
  name: z.string(),
  status: z.string().nullable(),
  url: z.string().nullable(),
  parcel_id: z.string().nullable(),
  tracking_number: z.string().nullable(),
  carrier: z.string().nullable(),
  items: z.array(z.string()),
  shop: z.string().nullable(),
  pickup_point: z.string().nullable(),
  expected_from: z.string().nullable(),
  expected_to: z.string().nullable(),
  amount: z.string().nullable(),
});
type NotificationData = z.infer<typeof notificationDataSchema>;

export interface NotificationCandidate {
  readonly key: string;
  readonly event: NotificationEvent;
  readonly direction: "receiving" | "sending" | null;
  readonly connections: readonly string[];
  readonly data: NotificationData;
}

const STATUS_EVENTS: Readonly<Record<string, NotificationEvent | undefined>> = {
  in_transit: "in_transit",
  out_for_delivery: "out_for_delivery",
  at_pickup_point: "at_pickup_point",
  returning: "returning",
  problem: "problem",
};

const EMPTY: NotificationData = {
  name: "",
  status: null,
  url: null,
  parcel_id: null,
  tracking_number: null,
  carrier: null,
  items: [],
  shop: null,
  pickup_point: null,
  expected_from: null,
  expected_to: null,
  amount: null,
};

const parcelPayload = z.object({
  parcel: z.object({
    id: z.string(),
    display_name: z.string(),
    status: z.string(),
    direction: z.enum(["receiving", "sending"]),
    url: z.string().nullable(),
    tracking_number: z.string(),
    carrier: z.string(),
    items: z.array(z.object({ title: z.string() })),
    order: z.object({ shop: z.string() }).nullable(),
    pickup_point: z.string().nullable(),
    expected_from: z.string().nullable(),
    expected_to: z.string().nullable(),
    expected_days: z.object({ from: z.string(), to: z.string() }).nullable(),
    connections: z.array(z.object({ connection_id: z.string() })),
  }),
});

/** The parcel live events that notify; `status_changed` by its new status. */
const PARCEL_EVENTS: Partial<Readonly<Record<OutboxEvent["type"], NotificationEvent>>> = {
  "parcel.registered": "registered",
  "parcel.sending_registered": "registered",
  "parcel.delivered": "delivered",
  "parcel.sending_delivered": "delivered",
  "parcel.delivery_time_changed": "delivery_time_changed",
};

function parcelEvent(type: OutboxEvent["type"], status: string): NotificationEvent | undefined {
  return type === "parcel.status_changed" ? STATUS_EVENTS[status] : PARCEL_EVENTS[type];
}

function fromParcel(event: OutboxEvent): NotificationCandidate | undefined {
  const parsed = parcelPayload.safeParse(event.payload);
  if (!parsed.success) return undefined;
  const { parcel } = parsed.data;
  const kind = parcelEvent(event.type, parcel.status);
  if (kind === undefined) return undefined;
  // Whole days stay days; times are kept as they are.
  const from = parcel.expected_days?.from ?? parcel.expected_from;
  const to = parcel.expected_days?.to ?? parcel.expected_to;
  const key =
    kind === "delivery_time_changed"
      ? `parcel:${parcel.id}:expected:${from ?? ""}/${to ?? ""}`
      : `parcel:${parcel.id}:status:${kind}`;
  return {
    key,
    event: kind,
    direction: parcel.direction,
    connections: parcel.connections.map((ref) => ref.connection_id),
    data: {
      ...EMPTY,
      name: parcel.display_name,
      status: parcel.status,
      url: parcel.url,
      parcel_id: parcel.id,
      tracking_number: parcel.tracking_number,
      carrier: parcel.carrier,
      items: parcel.items.map((item) => item.title),
      shop: parcel.order?.shop ?? null,
      pickup_point: parcel.pickup_point,
      expected_from: from,
      expected_to: to,
    },
  };
}

const returnPayload = z.object({
  return: z.object({
    id: z.string(),
    shop: z.string(),
    status: z.string(),
    parcel_id: z.string().nullable(),
    refund: z.object({ amount: z.number().nullable(), currency: z.string().nullable() }).nullable(),
  }),
});

const statePayload = z.object({
  connection: z.object({ id: z.string(), label: z.string() }),
  new_state: z.string(),
});

const backupPayload = z.object({ ok: z.boolean(), at: z.string() });

function fromOther(event: OutboxEvent): NotificationCandidate | undefined {
  const day = event.createdAt.slice(0, 10);
  if (event.type === "return.updated") {
    const parsed = returnPayload.safeParse(event.payload);
    if (!parsed.success || parsed.data.return.status !== "refunded") return undefined;
    const { id, shop, refund, parcel_id: parcelId } = parsed.data.return;
    const value = refund?.amount ?? null;
    const amount = value === null ? null : `${value.toFixed(2)} ${refund?.currency ?? ""}`.trim();
    const data = { ...EMPTY, name: shop, shop, amount, parcel_id: parcelId };
    return {
      key: `return:${id}:refunded`,
      event: "refunded",
      direction: "sending",
      connections: [],
      data,
    };
  }
  if (event.type === "connection.state_changed") {
    const parsed = statePayload.safeParse(event.payload);
    if (!parsed.success || parsed.data.new_state !== "needs_sign_in") return undefined;
    const { id, label } = parsed.data.connection;
    return {
      key: `connection:${id}:sign_in:${day}`,
      event: "sign_in_needed",
      direction: null,
      connections: [id],
      data: { ...EMPTY, name: label },
    };
  }
  if (event.type === "backup.finished") {
    const parsed = backupPayload.safeParse(event.payload);
    if (!parsed.success || parsed.data.ok) return undefined;
    return {
      key: `backup:${day}`,
      event: "backup_failed",
      direction: null,
      connections: [],
      data: { ...EMPTY, name: "open-parcels" },
    };
  }
  return undefined;
}

/** The notification a live event makes, if any. */
export function toNotification(event: OutboxEvent): NotificationCandidate | undefined {
  return event.type.startsWith("parcel.") ? fromParcel(event) : fromOther(event);
}

export interface Render {
  readonly language: Language;
  readonly timeZone: string;
  /** OPENPARCELS_PUBLIC_URL, for links to the parcel's page. */
  readonly publicUrl: URL | undefined;
  /** The fields the consumer's manifest asks for. */
  readonly fields: readonly ConsumerField[];
  /** A carrier id or shop key as its provider's display name, for the texts (fields keep ids). */
  providerName(id: string): string;
}

function link(data: NotificationData, render: Render): string | null {
  if (render.publicUrl !== undefined && data.parcel_id !== null) {
    return new URL(`parcels/${data.parcel_id}`, render.publicUrl.href.replace(/\/?$/, "/")).href;
  }
  return data.url;
}

function bodyOf(event: NotificationEvent, data: NotificationData, render: Render): string {
  const text = texts(render.language);
  const when = (iso: string): string => formatWhen(iso, render.language, render.timeZone);
  if (event === "sign_in_needed") return text.signIn(data.name);
  if (event === "backup_failed") return text.backupFailed;
  if (event === "refunded")
    return text.refunded(
      data.shop === null ? data.name : render.providerName(data.shop),
      data.amount,
    );
  const carrier = data.carrier === null ? "" : render.providerName(data.carrier);
  const lines = [`${carrier} ${data.tracking_number ?? ""}`.trim()];
  if (data.expected_from !== null && event !== "delivered") {
    const to = data.expected_to === null ? null : when(data.expected_to);
    lines.push(text.expected(when(data.expected_from), to));
  }
  if (data.pickup_point !== null && event === "at_pickup_point") {
    lines.push(text.pickupPoint(data.pickup_point));
  }
  return lines.filter((line) => line !== "").join("\n");
}

/** The parcel fields the consumer asked for, nothing else. */
function fieldsOf(data: NotificationData, fields: readonly ConsumerField[]) {
  if (data.parcel_id === null) return null;
  const all: Readonly<Record<ConsumerField, unknown>> = {
    tracking_number: data.tracking_number,
    carrier: data.carrier,
    items: data.items,
    shop: data.shop,
    pickup_point: data.pickup_point,
    expected_delivery:
      data.expected_from === null ? null : { from: data.expected_from, to: data.expected_to },
  };
  return Object.fromEntries([
    ["id", data.parcel_id],
    ["status", data.status],
    ...fields.map((field) => [field, all[field]]),
  ]) as Record<string, unknown>;
}

export interface StoredNotification {
  readonly event: NotificationEvent;
  readonly data: NotificationData;
  readonly createdAt: string;
}

function messageItem(stored: StoredNotification, render: Render): MessageItem {
  const { event, data } = stored;
  return {
    event,
    title: texts(render.language).title[event](data.name),
    body: bodyOf(event, data, render),
    url: link(data, render),
    at: stored.createdAt,
    parcel: fieldsOf(data, render.fields),
  };
}

/** One message for one notification, or a digest of several. */
export function buildMessage(stored: readonly StoredNotification[], render: Render): Message {
  const items = stored.map((entry) => messageItem(entry, render));
  const [first] = items;
  if (items.length === 1 && first !== undefined) {
    return {
      type: "notification",
      language: render.language,
      title: first.title,
      body: first.body,
      url: first.url,
      items,
    };
  }
  return {
    type: "digest",
    language: render.language,
    title: texts(render.language).digest(items.length),
    body: items.map((item) => `• ${item.title}`).join("\n"),
    url: render.publicUrl?.href ?? null,
    items,
  };
}

/** The "Send test notification" message. */
export function testMessage(render: Render): Message {
  const text = texts(render.language);
  return {
    type: "test",
    language: render.language,
    title: text.testTitle,
    body: text.testBody,
    url: render.publicUrl?.href ?? null,
    items: [],
  };
}
