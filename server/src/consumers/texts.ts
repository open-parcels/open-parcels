import type { Language } from "../i18n/language.js";
import type { NotificationEvent } from "./rules.js";

/**
 * The texts the core writes for notifications, in English and German (German UI terms from
 * `docs/glossary.md`). Consumers send them as they are.
 */

interface Texts {
  readonly title: Readonly<Record<NotificationEvent, (name: string) => string>>;
  readonly expected: (from: string, to: string | null) => string;
  readonly pickupPoint: (place: string) => string;
  readonly signIn: (label: string) => string;
  readonly backupFailed: string;
  readonly refunded: (shop: string, amount: string | null) => string;
  readonly digest: (count: number) => string;
  readonly testTitle: string;
  readonly testBody: string;
  readonly viewParcel: string;
}

const en: Texts = {
  title: {
    registered: (name) => `New parcel: ${name}`,
    in_transit: (name) => `${name} is on its way`,
    out_for_delivery: (name) => `${name} is out for delivery`,
    at_pickup_point: (name) => `${name} is ready at the pickup point`,
    delivered: (name) => `${name} was delivered`,
    delivery_time_changed: (name) => `New expected delivery for ${name}`,
    returning: (name) => `${name} is going back to the sender`,
    problem: (name) => `Problem with ${name}`,
    refunded: (name) => `Refund from ${name}`,
    sign_in_needed: (name) => `${name} needs a new sign-in`,
    backup_failed: () => "Backup failed",
  },
  expected: (from, to) =>
    to === null || to === from ? `Expected ${from}` : `Expected ${from} – ${to}`,
  pickupPoint: (place) => `Pickup point: ${place}`,
  signIn: (label) => `Sign in to ${label} again to keep its parcels up to date.`,
  backupFailed: "The last backup of the open-parcels database failed. See the Status page.",
  refunded: (shop, amount) =>
    amount === null ? `${shop} refunded a return.` : `${shop} refunded ${amount}.`,
  digest: (count) => (count === 1 ? "1 parcel update" : `${String(count)} parcel updates`),
  testTitle: "Test notification",
  testBody: "open-parcels can reach this consumer.",
  viewParcel: "View parcel",
};

const de: Texts = {
  title: {
    registered: (name) => `Neues Paket: ${name}`,
    in_transit: (name) => `${name} ist unterwegs`,
    out_for_delivery: (name) => `${name} ist in der Zustellung`,
    at_pickup_point: (name) => `${name} liegt an der Abholstelle bereit`,
    delivered: (name) => `${name} wurde zugestellt`,
    delivery_time_changed: (name) => `Neue voraussichtliche Zustellung für ${name}`,
    returning: (name) => `${name} geht an den Absender zurück`,
    problem: (name) => `Problem mit ${name}`,
    refunded: (name) => `Erstattung von ${name}`,
    sign_in_needed: (name) => `${name} braucht eine neue Anmeldung`,
    backup_failed: () => "Sicherung fehlgeschlagen",
  },
  expected: (from, to) =>
    to === null || to === from ? `Voraussichtlich ${from}` : `Voraussichtlich ${from} – ${to}`,
  pickupPoint: (place) => `Abholstelle: ${place}`,
  signIn: (label) => `Melde dich wieder bei ${label} an, damit die Pakete aktuell bleiben.`,
  backupFailed:
    "Die letzte Sicherung der open-parcels-Datenbank ist fehlgeschlagen. Siehe Statusseite.",
  refunded: (shop, amount) =>
    amount === null
      ? `${shop} hat eine Rücksendung erstattet.`
      : `${shop} hat ${amount} erstattet.`,
  digest: (count) => (count === 1 ? "1 Paket-Neuigkeit" : `${String(count)} Paket-Neuigkeiten`),
  testTitle: "Testbenachrichtigung",
  testBody: "open-parcels erreicht diesen Consumer.",
  viewParcel: "Paket ansehen",
};

export function texts(language: Language): Texts {
  return language === "de" ? de : en;
}

/** A date or time for a notification, in the reader's language and the server's time zone. */
export function formatWhen(iso: string, language: Language, timeZone: string): string {
  const whole = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  return new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", {
    timeZone: whole ? "UTC" : timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(whole ? {} : { hour: "2-digit", minute: "2-digit" }),
  }).format(new Date(iso));
}
