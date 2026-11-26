import { findCarrier, loadRules } from "open-parcels-rules";
import type { ParcelStatus } from "../domain/parcel.js";
import type { DropOffKind, DropOffOption, Return, ReturnStatus } from "../domain/return.js";
import type { Language } from "../i18n/language.js";

/**
 * The words of the ICS feed in one language. German uses the terms of `docs/glossary.md` and the
 * same words as the web UI (`web/src/i18n/de/`).
 */
export interface IcsTexts {
  readonly feedName: string;
  readonly delivered: (title: string) => string;
  readonly returnBy: (day: string, title: string) => string;
  readonly order: string;
  readonly carrier: string;
  readonly trackingNumber: string;
  readonly status: string;
  readonly label: string;
  readonly pickupPoint: string;
  readonly dropOff: string;
  readonly kinds: Readonly<Record<DropOffKind, string>>;
  readonly free: string;
  readonly costsMoney: string;
  readonly costs: (amount: string) => string;
  readonly parcelStatus: Readonly<Record<ParcelStatus, string>>;
  readonly returnStatus: Readonly<Record<ReturnStatus, string>>;
}

const EN: IcsTexts = {
  feedName: "Parcel deliveries",
  delivered: (title) => `Delivered: ${title}`,
  returnBy: (day, title) => `Return by ${day}: ${title}`,
  order: "Order",
  carrier: "Carrier",
  trackingNumber: "Tracking number",
  status: "Status",
  label: "Label",
  pickupPoint: "Pickup point",
  dropOff: "Drop off",
  kinds: {
    shop: "Shop",
    parcel_locker: "Parcel locker",
    post_office: "Post office",
    pickup: "Pickup",
    any: "Any drop-off point",
  },
  free: "Free return",
  costsMoney: "Return costs money",
  costs: (amount) => `Return costs ${amount}`,
  parcelStatus: {
    registered: "Registered",
    in_transit: "In transit",
    out_for_delivery: "Out for delivery",
    at_pickup_point: "At the pickup point",
    delivered: "Delivered",
    returning: "Returning",
    problem: "Problem",
    unknown: "Unknown",
  },
  returnStatus: {
    requested: "Return requested",
    label_created: "Label ready",
    dropped_off: "Dropped off",
    in_transit: "On its way back",
    received: "Received by the shop",
    refunded: "Refunded",
    rejected: "Rejected",
    cancelled: "Cancelled",
    expired: "Deadline passed",
  },
};

const DE: IcsTexts = {
  feedName: "Paketzustellungen",
  delivered: (title) => `Zugestellt: ${title}`,
  returnBy: (day, title) => `Zurücksenden bis ${day}: ${title}`,
  order: "Bestellung",
  carrier: "Paketdienst",
  trackingNumber: "Sendungsnummer",
  status: "Status",
  label: "Etikett",
  pickupPoint: "Abholstelle",
  dropOff: "Abgabe",
  kinds: {
    shop: "Shop",
    parcel_locker: "Paketautomat",
    post_office: "Postfiliale",
    pickup: "Abholung",
    any: "Beliebige Abgabestelle",
  },
  free: "Kostenlose Rücksendung",
  costsMoney: "Rücksendung kostenpflichtig",
  costs: (amount) => `Rücksendung kostet ${amount}`,
  parcelStatus: {
    registered: "Angemeldet",
    in_transit: "Unterwegs",
    out_for_delivery: "In Zustellung",
    at_pickup_point: "An der Abholstelle",
    delivered: "Zugestellt",
    returning: "Auf dem Rückweg",
    problem: "Problem",
    unknown: "Unbekannt",
  },
  returnStatus: {
    requested: "Rücksendung angefragt",
    label_created: "Etikett bereit",
    dropped_off: "Abgegeben",
    in_transit: "Auf dem Rückweg",
    received: "Beim Shop eingegangen",
    refunded: "Erstattet",
    rejected: "Abgelehnt",
    cancelled: "Storniert",
    expired: "Frist abgelaufen",
  },
};

export const ICS_TEXTS: Readonly<Record<Language, IcsTexts>> = { en: EN, de: DE };

/** One drop-off option in words: the shop's description, else its kind and carrier. */
export function dropOffText(texts: IcsTexts, option: DropOffOption): string {
  const name =
    option.carrier === null
      ? null
      : (findCarrier(loadRules(), option.carrier)?.name ?? option.carrier);
  const carrier = name === null ? "" : ` (${name})`;
  return option.description ?? `${texts.kinds[option.kind]}${carrier}`;
}

/** The cost in words, or null when it is not known. */
export function costText(texts: IcsTexts, language: Language, cost: Return["cost"]): string | null {
  if (cost === null) return null;
  if (cost.free) return texts.free;
  if (cost.amount === null) return texts.costsMoney;
  const amount = cost.amount.toLocaleString(language, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return texts.costs(cost.currency === null ? amount : `${amount} ${cost.currency}`);
}

/** A parcel's or a return's status in words. */
export function statusText(
  texts: IcsTexts,
  kind: "parcel" | "return",
  status: ParcelStatus | ReturnStatus,
): string {
  const table: Readonly<Record<string, string>> =
    kind === "return" ? texts.returnStatus : texts.parcelStatus;
  return table[status] ?? status;
}
