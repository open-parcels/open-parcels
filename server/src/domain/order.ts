/**
 * Order numbers whose format a shop always uses. A number in another format cannot be that shop's,
 * which catches mails that merely mention the shop (paid with Amazon Pay, say) and were
 * attributed to it.
 */
const ORDER_NUMBER_FORMATS: Readonly<Record<string, RegExp>> = {
  // 123-1234567-1234567, and D01-1234567-1234567 for digital orders.
  amazon: /^(?:\d{3}|D\d{2})-\d{7}-\d{7}$/,
};

/** False when the shop has a known order-number format and the number does not match it. */
export function isPlausibleOrder(shop: string, orderNumber: string): boolean {
  // Own entries only: a shop named `constructor` must not find Object (OP-134).
  const format = Object.hasOwn(ORDER_NUMBER_FORMATS, shop) ? ORDER_NUMBER_FORMATS[shop] : undefined;
  return format === undefined || format.test(orderNumber.trim());
}

/** A shop named by its web address ("example-shop.de"), as labels and senders often are. */
export function shopFromDomain(value: string | null | undefined): string | null {
  const text =
    value
      ?.trim()
      .toLowerCase()
      .replace(/^www\./, "") ?? "";
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(text) ? text : null;
}

/**
 * Shops whose rule id has more than one word (`order-netto-online`); every other shop is the
 * rule id's first word after its kind (`parcel-ebay-relay` is eBay).
 */
const MULTI_WORD_SHOPS = ["instant-gaming", "netto-online"] as const;

/** Shops known by another name than their rule id's word. */
const SHOP_NAMES: Readonly<Record<string, string>> = { boykisser: "Boykisser.gg" };

/** Shop id from a rule id such as `parcel-amazon`, `order-netto-online` or `return-steam`. */
export function shopOfRule(ruleId: string): string | null {
  const rest = /^(?:parcel|order|return|dunning)-([a-z0-9-]+)$/.exec(ruleId)?.[1];
  if (rest === undefined) return null;
  const multi = MULTI_WORD_SHOPS.find((shop) => rest === shop || rest.startsWith(`${shop}-`));
  const word = multi ?? rest.split("-")[0];
  return word === undefined ? null : (SHOP_NAMES[word] ?? word);
}

/**
 * Payment services whose receipts quote the shop's own order reference. An order under such a
 * "shop" is a stand-in: it joins the shop's order with the same number as soon as one is known.
 */
export const PAYMENT_SHOPS: ReadonlySet<string> = new Set(["paypal"]);

/**
 * Platforms that send email for many independent shops from one address. The shop is then named
 * after the sender's display name, so two shops' order "#1042" never merge.
 */
const HOSTED_SHOPS: ReadonlySet<string> = new Set(["shopify"]);

export function isHostedShop(shop: string): boolean {
  return HOSTED_SHOPS.has(shop);
}

/** A display name ("Example Store") as a shop id (`example-store`), or null when it has none. */
export function shopFromName(name: string | null | undefined): string | null {
  const slug = (name ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? null : slug.slice(0, 64);
}

/** Shops that sell only digital goods: an order is delivered when it is placed (no parcel). */
const DIGITAL_SHOPS: ReadonlySet<string> = new Set([
  "eneba",
  "fanatical",
  "gamivo",
  "gog",
  "humble",
  "instant-gaming",
  "mmoga",
  "steam",
]);

export function isDigitalShop(shop: string): boolean {
  return DIGITAL_SHOPS.has(shop);
}

/**
 * What an email says about an order, in the order's status words. `ordered` covers placed and
 * confirmed; `refunded` means the money came back without a return.
 */
const REPORTED_ORDER_STATUSES = [
  "ordered",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
] as const;
export type ReportedOrderStatus = (typeof REPORTED_ORDER_STATUSES)[number];

export function asReportedOrderStatus(value: string | null): ReportedOrderStatus | null {
  return REPORTED_ORDER_STATUSES.find((status) => status === value) ?? null;
}

/**
 * The stored status after a report: a status never goes back (an older confirmation read after
 * the delivery email changes nothing), and cancelled or refunded close the order.
 */
export function nextReportedStatus(
  stored: ReportedOrderStatus | null,
  reported: ReportedOrderStatus,
): ReportedOrderStatus {
  if (stored === null) return reported;
  const rank = (status: ReportedOrderStatus) => REPORTED_ORDER_STATUSES.indexOf(status);
  return rank(reported) > rank(stored) ? reported : stored;
}
