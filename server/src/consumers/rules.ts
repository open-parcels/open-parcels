import { z } from "zod";
import { LANGUAGES } from "../i18n/language.js";

/** Notification rules (`docs/consumers.md` §2): stored per configured consumer, applied in the core. */

export const NOTIFICATION_EVENTS = [
  "registered",
  "in_transit",
  "out_for_delivery",
  "at_pickup_point",
  "delivered",
  "delivery_time_changed",
  "returning",
  "problem",
  "refunded",
  "sign_in_needed",
  "backup_failed",
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

const DIGESTS = ["immediately", "hourly", "daily"] as const;
const DIRECTIONS = ["receiving", "sending"] as const;

const clockTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "HH:MM, 24-hour");

export const notificationRulesSchema = z.strictObject({
  events: z.array(z.enum(NOTIFICATION_EVENTS)).describe("The notification events to send."),
  directions: z.array(z.enum(DIRECTIONS)).min(1).describe("Parcels of these directions."),
  connections: z
    .array(z.uuid())
    .nullable()
    .describe("Only parcels reported by these connections; null: every connection."),
  quiet_hours: z
    .strictObject({ from: clockTime, to: clockTime })
    .nullable()
    .describe("Nothing is sent between these times (server time zone); held until they end."),
  digest: z
    .enum(DIGESTS)
    .describe("immediately; hourly (on the hour) or daily (08:00): all due ones in one message."),
  language: z.enum(LANGUAGES).describe("Language of the texts."),
});
export type NotificationRules = z.infer<typeof notificationRulesSchema>;

/** What a new configured consumer starts with: the parcel milestones, at once, in English. */
export const DEFAULT_RULES: NotificationRules = {
  events: [
    "registered",
    "out_for_delivery",
    "at_pickup_point",
    "delivered",
    "problem",
    "refunded",
    "sign_in_needed",
    "backup_failed",
  ],
  directions: ["receiving", "sending"],
  connections: null,
  quiet_hours: null,
  digest: "immediately",
  language: "en",
};

/** What the rules look at in a notification. */
export interface RuleSubject {
  readonly event: NotificationEvent;
  /** Null for notifications about no parcel (a sign-in, a backup). */
  readonly direction: "receiving" | "sending" | null;
  /** The connections that reported the parcel, or the connection itself; empty: none. */
  readonly connections: readonly string[];
}

/** Whether a configured consumer with these rules wants this notification. */
export function wants(rules: NotificationRules, subject: RuleSubject): boolean {
  if (!rules.events.includes(subject.event)) return false;
  if (subject.direction !== null && !rules.directions.includes(subject.direction)) return false;
  if (rules.connections === null || subject.connections.length === 0) return true;
  return subject.connections.some((id) => rules.connections?.includes(id) === true);
}

const DAILY_AT_MINUTES = 8 * 60;
const MINUTE_MS = 60_000;

/** Minutes since local midnight in `timeZone`, with the seconds left over in ms. */
function localMinutes(at: Date, timeZone: string): { minutes: number; restMs: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const value = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  return { minutes: value("hour") * 60 + value("minute"), restMs: at.getTime() % MINUTE_MS };
}

/** The next moment at or after `at` whose local time is `target` minutes after midnight. */
function nextLocal(at: Date, timeZone: string, target: number): Date {
  const { minutes, restMs } = localMinutes(at, timeZone);
  const ahead = (target - minutes + 1440) % 1440;
  if (ahead === 0 && restMs === 0) return at;
  return new Date(at.getTime() - restMs + (ahead === 0 ? 1440 : ahead) * MINUTE_MS);
}

const minutesOf = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

/** Whether `at` falls into the quiet hours (a range over midnight included). */
function inQuiet(at: Date, timeZone: string, quiet: NonNullable<NotificationRules["quiet_hours"]>) {
  const { minutes } = localMinutes(at, timeZone);
  const from = minutesOf(quiet.from);
  const to = minutesOf(quiet.to);
  return from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

/**
 * When a notification created at `at` is due for a consumer with these rules: at once, at the
 * next digest time, and in any case not before its quiet hours end.
 */
export function dueAt(rules: NotificationRules, at: Date, timeZone: string): Date {
  let due = at;
  if (rules.digest === "hourly") {
    const { minutes } = localMinutes(at, timeZone);
    due = nextLocal(at, timeZone, ((Math.floor(minutes / 60) + 1) * 60) % 1440);
  } else if (rules.digest === "daily") {
    due = nextLocal(at, timeZone, DAILY_AT_MINUTES);
  }
  return quietUntil(rules, due, timeZone) ?? due;
}

/** The end of the quiet hours `at` falls into, if it does: a retry inside them waits too. */
export function quietUntil(rules: NotificationRules, at: Date, timeZone: string): Date | undefined {
  if (rules.quiet_hours === null || !inQuiet(at, timeZone, rules.quiet_hours)) return undefined;
  return nextLocal(at, timeZone, minutesOf(rules.quiet_hours.to));
}
