import { createHash } from "node:crypto";
import {
  detectTrackingNumbers,
  mapStatus,
  parseEmail,
  type EmailEvent,
  type EmailParseResult,
  type Rules,
} from "open-parcels-rules";
import {
  isHostedShop,
  PAYMENT_SHOPS,
  isPlausibleOrder,
  shopFromDomain,
  shopFromName,
  shopOfRule,
  type ReportedOrderStatus,
} from "../domain/order.js";
import type { ParcelStatus } from "../domain/parcel.js";
import { redactText } from "../log/redact.js";
import { snapshot, type OrderSnapshot, type ParcelSnapshot } from "../provider/snapshot.js";
import type { MailInput, MailInterpreter, MailOrderInterpreter } from "./types.js";

/**
 * The order an email belongs to. A rule's shop is trusted only when the order number fits that
 * shop's format; otherwise the email came from another shop that merely mentioned it, and the
 * sender's domain names the shop. A platform that sends for many shops (Shopify) names the shop
 * after the sender's display name.
 */
export function orderOf(
  ruleId: string,
  orderNumber: string | undefined,
  domain: string | undefined,
  senderName: string | null = null,
): { shop: string; orderNumber: string; placedAt: null } | null {
  const ruled = shopOfRule(ruleId);
  if (ruled === null || orderNumber === undefined) {
    return null;
  }
  const shop = isHostedShop(ruled)
    ? (shopFromName(senderName) ?? ruled)
    : isPlausibleOrder(ruled, orderNumber)
      ? ruled
      : shopFromDomain(domain);
  return shop === null ? null : { shop, orderNumber, placedAt: null };
}

export function senderDomain(from: string): string | undefined {
  return /@([^>\s]+)>?\s*$/.exec(from)?.[1]?.toLowerCase();
}

/** The display name of a From header (`Example Store <shop@example.com>`), or null. */
export function senderName(from: string): string | null {
  const name = /^\s*"?([^"<]*?)"?\s*</.exec(from)?.[1]?.trim() ?? "";
  return name === "" ? null : name;
}

/** The rules' results for an email, in the server's time zone. */
export function emailResults(rules: Rules, mail: MailInput, timeZone: string): EmailParseResult[] {
  return [
    ...parseEmail(rules, {
      from: mail.from,
      subject: mail.subject,
      ...(mail.text === null ? {} : { text: mail.text }),
      ...(mail.html === null ? {} : { html: mail.html }),
      ...(mail.date === null ? {} : { date: mail.date }),
      timeZone,
    }),
  ];
}

/**
 * The order an order email names, for parcel results of the same email that name none: an eBay
 * update with the order number in one result and the carrier's tracking number in another.
 */
function emailOrder(
  results: readonly EmailParseResult[],
  from: string,
): { shop: string; orderNumber: string; placedAt: null } | null {
  for (const result of results) {
    if (result.kind !== "order") continue;
    const order = orderOf(
      result.ruleId,
      result.orderNumbers[0],
      senderDomain(from),
      senderName(from),
    );
    if (order !== null && !PAYMENT_SHOPS.has(order.shop)) return order;
  }
  return null;
}

/** The carrier of a tracking number in a mail: the rule's, else the best detected match. */
export function carrierFor(
  rules: Rules,
  result: EmailParseResult,
  trackingNumber: string,
  domain: string | undefined,
): string | null {
  if (result.carrier !== undefined) {
    return result.carrier;
  }
  const best = detectTrackingNumbers(
    rules,
    trackingNumber,
    domain === undefined ? undefined : { senderDomain: domain },
  )
    .filter((candidate) => candidate.trackingNumber === trackingNumber)
    .sort((a, b) => b.confidence - a.confidence)[0];
  return best === undefined || best.carrier === "upu" ? null : best.carrier;
}

/** The carrier's status table read on the subject, when the mail rule's keywords found none. */
function textStatus(rules: Rules, carrier: string, subject: string): ParcelStatus | null {
  return subject.trim() === ""
    ? null
    : (mapStatus(rules, carrier, { text: subject })?.status ?? null);
}

/**
 * One identity per mail: its Message-ID, else a digest of what it says. A mail seen twice (in two
 * folders, or again after the server reset its UIDs) then gives one history entry, not two.
 */
export function mailId(mail: MailInput): string {
  if (mail.messageId !== null && mail.messageId.trim() !== "") {
    return `mail:${mail.messageId.trim()}`;
  }
  const digest = createHash("sha256")
    .update([mail.from, mail.subject, mail.text ?? "", mail.html ?? ""].join("\u0000"))
    .digest("hex")
    .slice(0, 32);
  return `mail:${digest}`;
}

/** Runs of this many digits or more in a subject are masked: pickup codes, PINs, numbers. */
const SUBJECT_DIGITS = /\d{5,}/gu;

/**
 * A mail subject as the parcel's status text, which is stored, sent in events and shown to every
 * client: email addresses, tracking and order numbers and other digit runs are masked, and a
 * mail that carries a pickup code gives no subject at all, since some services put the code that
 * opens the locker into it. Names cannot be told apart reliably and stay.
 */
export function subjectAsStatus(subject: string, carriesPickupCode: boolean): string | null {
  if (carriesPickupCode) return null;
  const masked = redactText(subject).replace(SUBJECT_DIGITS, "…").trim();
  return masked === "" ? null : masked;
}

/**
 * Turns shipping mails into parcel snapshots using the shared rules. Only mails that name a
 * tracking number produce a parcel; pickup codes are never carried over, because codes that open
 * a locker must not end up in stored data or events.
 */
export function createMailInterpreter(rules: Rules, timeZone: string): MailInterpreter {
  return (mail: MailInput): readonly ParcelSnapshot[] => {
    const results = emailResults(rules, mail, timeZone);
    const domain = senderDomain(mail.from);
    // An email without a plausible date gives no event: "now" would outrank newer scans (OP-126).
    const at = mail.date?.toISOString() ?? null;
    const id = mailId(mail);
    const fromOrderEmail = emailOrder(results, mail.from);
    const snapshots: ParcelSnapshot[] = [];
    for (const result of results) {
      if (result.kind !== "parcel") {
        continue;
      }
      const order =
        orderOf(result.ruleId, result.orderNumbers[0], domain, senderName(mail.from)) ??
        fromOrderEmail;
      for (const trackingNumber of result.trackingNumbers) {
        const carrier = carrierFor(rules, result, trackingNumber, domain);
        if (carrier === null) {
          continue;
        }
        const status = result.status ?? textStatus(rules, carrier, mail.subject);
        const rawStatus = subjectAsStatus(mail.subject, result.pickupCode !== undefined);
        snapshots.push(
          snapshot({
            carrier,
            trackingNumber: trackingNumber,
            status,
            rawStatus,
            expectedFrom: result.arrival?.from ?? null,
            expectedTo: result.arrival?.to ?? null,
            url: result.trackingUrl ?? null,
            // A history entry needs a text: a neutral one when the subject must not be kept.
            history:
              at === null
                ? []
                : [{ at, status, rawStatus: rawStatus ?? "Shipping mail", location: null, id }],
            items: (result.items ?? []).map((title) => ({
              title,
              imageUrl: null,
              url: null,
              externalId: null,
              quantity: null,
              price: null,
              currency: null,
            })),
            order,
          }),
        );
      }
    }
    return snapshots;
  };
}

/** What an order email's event says, in the order's status words; null for other events. */
const ORDER_EVENTS: Partial<Record<EmailEvent, ReportedOrderStatus>> = {
  order_placed: "ordered",
  order_confirmed: "ordered",
  order_shipped: "shipped",
  order_delivered: "delivered",
  order_cancelled: "cancelled",
};

/**
 * Turns order emails (the shared rules' `order` kind) into order reports: confirmations,
 * shipping and delivery notices without a tracking number, cancellations, and payment receipts
 * that quote the shop's reference. A shipping email that states the order's total reports it
 * too (its parcel comes from the parcel interpreter). An email needs an order number; one
 * without is skipped.
 */
export function createOrderInterpreter(rules: Rules, timeZone: string): MailOrderInterpreter {
  return (mail: MailInput): readonly OrderSnapshot[] => {
    const domain = senderDomain(mail.from);
    const name = senderName(mail.from);
    const reports: OrderSnapshot[] = [];
    for (const result of emailResults(rules, mail, timeZone)) {
      const ordered = result.kind === "order";
      if (!ordered && (result.kind !== "parcel" || result.total === undefined)) continue;
      const order = orderOf(result.ruleId, result.orderNumbers[0], domain, name);
      if (order === null) continue;
      reports.push({
        order: { shop: order.shop, orderNumber: order.orderNumber },
        status:
          !ordered || result.event === undefined ? null : (ORDER_EVENTS[result.event] ?? null),
        at: mail.date?.toISOString() ?? null,
        items: ordered ? (result.items ?? []) : [],
        total: result.total ?? null,
        payment: PAYMENT_SHOPS.has(order.shop),
      });
    }
    return reports;
  };
}
