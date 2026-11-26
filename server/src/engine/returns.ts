import type { Transaction } from "kysely";
import { isoNow, type Clock } from "../clock.js";
import type { Database, ReturnTable } from "../db/schema.js";
import { asReturnStatus, nextReturnStatus } from "../domain/return.js";
import { appendEvent } from "../events/bus.js";
import { snapshot, type ParcelSnapshot, type ReturnSnapshot } from "../provider/snapshot.js";
import { loadReturns, localDay } from "../returns/repository.js";
import { safeUrl } from "./links.js";
import { createOrder, findOrder, findOrderByPayment } from "./order-rows.js";
import { markRefunded, type OrderEnv } from "./orders.js";

type Trx = Transaction<Database>;
type ReturnRow = ReturnTable;

/** Statuses after which a report without the shop's id starts a new return instead. */
const CLOSED = new Set(["refunded", "rejected", "cancelled"]);

export interface ReturnEnv extends OrderEnv {
  readonly clock: Clock;
  /** The server's zone: return-by days are its local days. */
  readonly timeZone: string;
  /** Stores the return's own parcel (outgoing) and returns its id. */
  readonly trackParcel: (parcel: ParcelSnapshot) => Promise<string>;
}

/** The order the return belongs to; one is made for an order no connection listed yet. */
async function orderFor(
  trx: Trx,
  report: ReturnSnapshot,
  now: string,
): Promise<{ id: string } | null> {
  const key = report.order;
  if (!("orderNumber" in key)) {
    // A refund matched by what was paid never starts an order.
    const paid = await findOrderByPayment(trx, key);
    return paid === undefined ? null : { id: paid.id };
  }
  const existing = await findOrder(trx, key);
  if (existing !== undefined) {
    // The owner deleted the order: what belonged to it is not brought back.
    return existing.deleted_at === null ? { id: existing.id } : null;
  }
  if (!report.mayCreate) return null;
  return { id: await createOrder(trx, key, now) };
}

/**
 * The stored return a report is about: the one with the shop's id; else the order's newest open
 * one (one still without an id adopts the report's).
 */
async function findReturn(
  trx: Trx,
  orderId: string,
  report: ReturnSnapshot,
): Promise<ReturnRow | undefined> {
  const rows = await trx
    .selectFrom("returns")
    .selectAll()
    .where("order_id", "=", orderId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();
  if (report.externalRef !== null) {
    const same = rows.find((row) => row.external_ref === report.externalRef);
    if (same !== undefined) return same;
    return rows.find((row) => row.external_ref === null && !CLOSED.has(row.status));
  }
  return (
    rows.find((row) => !CLOSED.has(row.status)) ??
    // A refund for a return that is already complete (a second refund mail) still belongs to it.
    (report.status === "refunded" ? rows[0] : undefined)
  );
}

/** The columns after the report: what it does not say stays as it was. */
function merged(row: ReturnRow | undefined, report: ReturnSnapshot) {
  const refundStatus =
    row?.refund_status === "issued" ? "issued" : (report.refund?.status ?? row?.refund_status);
  return {
    external_ref: report.externalRef ?? row?.external_ref ?? null,
    status: nextReturnStatus(asReturnStatus(row?.status ?? null), report.status),
    reason: report.reason ?? row?.reason ?? null,
    return_by: report.returnBy ?? row?.return_by ?? null,
    drop_off: report.dropOff.length > 0 ? JSON.stringify(report.dropOff) : (row?.drop_off ?? "[]"),
    cost_free: report.cost === null ? (row?.cost_free ?? null) : report.cost.free ? 1 : 0,
    cost_amount: report.cost === null ? (row?.cost_amount ?? null) : report.cost.amount,
    cost_currency: report.cost === null ? (row?.cost_currency ?? null) : report.cost.currency,
    label_url: safeUrl(report.labelUrl) ?? row?.label_url ?? null,
    refund_amount: report.refund?.amount ?? row?.refund_amount ?? null,
    refund_currency: report.refund?.currency ?? row?.refund_currency ?? null,
    refund_status: refundStatus ?? null,
  } satisfies Partial<ReturnRow>;
}

type Columns = ReturnType<typeof merged> & {
  carrier: string | null;
  tracking_number: string | null;
  parcel_id: string | null;
};

function changed(row: ReturnRow, next: Columns): boolean {
  return (Object.keys(next) as (keyof Columns)[]).some((key) => row[key] !== next[key]);
}

/** An item title as mails shorten it: "Some product name..." matches "Some product name, red". */
function stem(title: string): string {
  return title
    .replace(/(?:\.{2,}|…)\s*$/u, "")
    .trim()
    .toLowerCase();
}

async function writeItems(
  trx: Trx,
  orderId: string,
  returnId: string,
  titles: readonly string[],
): Promise<void> {
  if (titles.length === 0) return;
  const [known, lines] = await Promise.all([
    trx
      .selectFrom("return_items")
      .select(["title", "position"])
      .where("return_id", "=", returnId)
      .execute(),
    trx.selectFrom("order_items").select(["id", "title"]).where("order_id", "=", orderId).execute(),
  ]);
  const seen = new Set(known.map((item) => stem(item.title)));
  let position = known.reduce((max, item) => Math.max(max, item.position + 1), 0);
  for (const title of titles) {
    const key = stem(title);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    const line = lines.find((entry) => entry.title.toLowerCase().startsWith(key));
    await trx
      .insertInto("return_items")
      .values({ return_id: returnId, position, title, order_item_id: line?.id ?? null })
      .execute();
    position += 1;
  }
}

/**
 * Stores one return report: finds or starts the return, merges what the report says, links the
 * connection, the items and (with a tracking number) an outgoing parcel, and fires `return.created`
 * or `return.updated` when anything changed. Null when the report belongs to nothing (an unknown
 * order it may not start, or a deleted one).
 */
async function applyReturn(
  trx: Trx,
  env: ReturnEnv,
  connectionId: string,
  report: ReturnSnapshot,
): Promise<{ id: string | null; events: number } | null> {
  const now = isoNow(env.clock);
  const order = await orderFor(trx, report, now);
  if (order === null) return null;
  const row = await findReturn(trx, order.id, report);
  if (row === undefined && !report.mayCreate) {
    // Money back with no return to file it under: the order itself is refunded.
    return report.refund?.status === "issued"
      ? { id: null, events: await markRefunded(trx, env, order.id) }
      : null;
  }
  await trx
    .insertInto("order_connections")
    .values({ order_id: order.id, connection_id: connectionId })
    .onConflict((oc) => oc.columns(["order_id", "connection_id"]).doNothing())
    .execute();
  const tracking = report.tracking;
  const sameParcel =
    tracking !== null &&
    (row?.parcel_id ?? null) !== null &&
    row?.carrier === tracking.carrier &&
    row.tracking_number === tracking.trackingNumber;
  const parcelId =
    tracking === null || sameParcel
      ? (row?.parcel_id ?? null)
      : await env.trackParcel(
          snapshot({
            carrier: tracking.carrier,
            trackingNumber: tracking.trackingNumber,
            direction: "sending",
            status: "registered",
            rawStatus: null,
          }),
        );
  const next: Columns = {
    ...merged(row, report),
    carrier: tracking?.carrier ?? row?.carrier ?? null,
    tracking_number: tracking?.trackingNumber ?? row?.tracking_number ?? null,
    parcel_id: parcelId,
  };
  const id = row?.id ?? crypto.randomUUID();
  if (row === undefined) {
    await trx
      .insertInto("returns")
      .values({ id, order_id: order.id, ...next, created_at: now, updated_at: now })
      .execute();
  } else if (changed(row, next)) {
    await trx
      .updateTable("returns")
      .set({ ...next, updated_at: now })
      .where("id", "=", id)
      .execute();
  }
  const itemsBefore = await countItems(trx, id);
  await writeItems(trx, order.id, id, report.items);
  await trx
    .insertInto("return_connections")
    .values({ return_id: id, connection_id: connectionId })
    .onConflict((oc) => oc.columns(["return_id", "connection_id"]).doNothing())
    .execute();
  const itemsChanged = (await countItems(trx, id)) !== itemsBefore;
  if (row !== undefined && !changed(row, next) && !itemsChanged) return { id, events: 0 };
  const today = localDay(env.clock.now(), env.timeZone);
  const [shown] = await loadReturns(trx, { ids: [id] }, today);
  if (shown === undefined) return { id, events: 0 };
  await appendEvent(trx, env.clock, {
    type: row === undefined ? "return.created" : "return.updated",
    parcelId: shown.parcel_id,
    payload: { return: shown },
  });
  return { id, events: 1 };
}

/** Stores a run's return reports; returns how many events fired. */
export async function applyReturns(
  trx: Trx,
  env: ReturnEnv,
  connectionId: string,
  reports: readonly ReturnSnapshot[],
): Promise<number> {
  let events = 0;
  for (const report of reports) {
    events += (await applyReturn(trx, env, connectionId, report))?.events ?? 0;
  }
  return events;
}

async function countItems(trx: Trx, returnId: string): Promise<number> {
  const row = await trx
    .selectFrom("return_items")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("return_id", "=", returnId)
    .executeTakeFirstOrThrow();
  return row.n;
}
