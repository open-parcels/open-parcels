import type { Selectable, Transaction } from "kysely";
import type { Database, OrderTable } from "../db/schema.js";
import { PAYMENT_SHOPS } from "../domain/order.js";
import type { PaymentRef } from "../provider/snapshot.js";

type Trx = Transaction<Database>;
export type OrderRow = Selectable<OrderTable>;

export interface OrderKey {
  readonly shop: string;
  readonly orderNumber: string;
}

/**
 * The stored order a report is about, deleted ones included (callers decide what a tombstone
 * means). Orders merge by shop and order number, with one exception for payment receipts
 * (`PAYMENT_SHOPS`), which quote the shop's reference without naming the shop:
 * - a receipt joins the one shop's order with that number; with none (or several, which cannot be
 *   told apart) it keeps a stand-in order under the payment service;
 * - a shop's report finding no order of its own adopts such a stand-in, which becomes the shop's
 *   order with everything linked to it.
 */
export async function findOrder(trx: Trx, key: OrderKey): Promise<OrderRow | undefined> {
  if (PAYMENT_SHOPS.has(key.shop)) {
    const rows = await trx
      .selectFrom("orders")
      .selectAll()
      .where("order_number", "=", key.orderNumber)
      .execute();
    const shops = rows.filter((row) => !PAYMENT_SHOPS.has(row.shop));
    return (shops.length === 1 ? shops[0] : undefined) ?? rows.find((row) => row.shop === key.shop);
  }
  const exact = await trx
    .selectFrom("orders")
    .selectAll()
    .where("shop", "=", key.shop)
    .where("order_number", "=", key.orderNumber)
    .executeTakeFirst();
  if (exact !== undefined) return exact;
  const standIn = await trx
    .selectFrom("orders")
    .selectAll()
    .where("shop", "in", [...PAYMENT_SHOPS])
    .where("order_number", "=", key.orderNumber)
    .where("deleted_at", "is", null)
    .orderBy("created_at")
    .executeTakeFirst();
  if (standIn === undefined) return undefined;
  await trx.updateTable("orders").set({ shop: key.shop }).where("id", "=", standIn.id).execute();
  return { ...standIn, shop: key.shop };
}

/** How far back a refund's purchase is looked for. */
const PAYMENT_WINDOW_MS = 400 * 24 * 60 * 60 * 1000;

/** Letters and digits only, lower case: "www.Example-Games.com" → "wwwexamplegamescom". */
function squeeze(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Whether a payee ("www.steampowered.com", "Example Market Ltd") names the shop (`steam`). */
function payeeNames(payee: string, shop: string): boolean {
  const word = squeeze(shop.replace(/\.[a-z]{2,}$/u, ""));
  return word.length >= 3 && squeeze(payee).includes(word);
}

/**
 * The order a payment service's refund without a reference is about: the one whose stated
 * total is the purchase's, placed before the refund (at most 400 days), and paid to the payee.
 * One whose shop the payee names wins; without such, only a single order of that total counts.
 * Never a deleted order, and undefined when it cannot be told apart.
 */
export async function findOrderByPayment(
  trx: Trx,
  payment: PaymentRef,
): Promise<OrderRow | undefined> {
  // An email without a date bounds nothing.
  const before = payment.paidBefore ?? "9999-12-31T23:59:59.999Z";
  const since =
    payment.paidBefore === null
      ? ""
      : new Date(Date.parse(payment.paidBefore) - PAYMENT_WINDOW_MS).toISOString();
  const rows = (
    await trx
      .selectFrom("orders")
      .selectAll()
      .where("deleted_at", "is", null)
      .where("total_currency", "=", payment.total.currency)
      .where("total_amount", ">", payment.total.amount - 0.005)
      .where("total_amount", "<", payment.total.amount + 0.005)
      .execute()
  ).filter((row) => {
    const at = row.placed_at ?? row.created_at;
    return at <= before && at >= since;
  });
  const payee = payment.payee;
  const named = payee === null ? [] : rows.filter((row) => payeeNames(payee, row.shop));
  if (named.length > 0) return named.length === 1 ? named[0] : undefined;
  return rows.length === 1 ? rows[0] : undefined;
}

/** Stores a new order and returns its id. */
export async function createOrder(
  trx: Trx,
  key: OrderKey,
  now: string,
  values: {
    readonly placedAt?: string | null;
    readonly returnUntil?: string | null;
    /** Set when an import job creates the order. */
    readonly importedAt?: string | null;
  } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await trx
    .insertInto("orders")
    .values({
      id,
      shop: key.shop,
      order_number: key.orderNumber,
      placed_at: values.placedAt ?? null,
      return_until: values.returnUntil ?? null,
      imported_at: values.importedAt ?? null,
      status: null,
      created_at: now,
      updated_at: now,
    })
    .execute();
  return id;
}
