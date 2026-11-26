import type { Kysely, Selectable } from "kysely";
import { isoNow, type Clock } from "../clock.js";
import type { Database, OrderTable } from "../db/schema.js";
import { orderVisible } from "../db/visibility.js";
import {
  orderArchivedAt,
  orderStatus,
  orderTotal,
  type Order,
  type OrderStatus,
  type OrderView,
  type ParcelState as OrderParcelState,
} from "../domain/order-lifecycle.js";
import { asReportedOrderStatus, isDigitalShop } from "../domain/order.js";
import type { OrderItem, Parcel } from "../domain/parcel.js";
import { appendEvent, type EventBus } from "../events/bus.js";
import {
  groupBy,
  ParcelRepository,
  RAW_PRESENTATION,
  type Presentation,
} from "../parcels/repository.js";
import type { Return } from "../domain/return.js";
import type { ReturnService } from "../returns/service.js";
import { orderPage } from "./list-query.js";

export interface OrderFilter {
  readonly view: OrderView;
  readonly limit: number;
  readonly offset: number;
}

export interface OrderPatch {
  readonly label?: string | null;
  /** True archives, false keeps it out of the archive, null returns to automatic archiving. */
  readonly archived?: boolean | null;
}

type OrderRow = Selectable<OrderTable>;

/** Orders per page when no limit is given. */
export const ORDER_PAGE_DEFAULT = 100;

interface OrderParts {
  readonly items: OrderItem[];
  readonly parcels: readonly Parcel[];
  readonly returns: Return[];
}

/** Status and archive time of an order row with its parcels' states. */
function orderState(
  row: OrderRow,
  parcels: readonly OrderParcelState[],
  now: Date,
): { status: OrderStatus; archivedAt: string | null } {
  const status = orderStatus(parcels, asReportedOrderStatus(row.status));
  const archivedAt = orderArchivedAt(row.archive_mode, row.archived_at, parcels, {
    placedAt: row.placed_at ?? row.created_at,
    now,
    closed: { status, at: row.updated_at },
  });
  return { status, archivedAt };
}

function toOrder(
  row: OrderRow,
  { items, parcels, returns }: OrderParts,
  now: Date,
  shopName: string,
): Order {
  const { status, archivedAt } = orderState(row, parcels, now);
  return {
    id: row.id,
    shop: row.shop,
    order_number: row.order_number,
    label: row.label,
    display_name: row.label ?? `${shopName} ${row.order_number}`,
    placed_at: row.placed_at,
    status,
    digital: isDigitalShop(row.shop),
    archived: archivedAt !== null,
    archived_at: archivedAt,
    archive_mode: row.archive_mode ?? "automatic",
    parcel_count: parcels.length,
    delivered_count: parcels.filter((parcel) => parcel.delivered).length,
    // A total an email stated is the order's; else the sum of its priced lines.
    total:
      row.total_amount !== null && row.total_currency !== null
        ? { amount: row.total_amount, currency: row.total_currency, partial: false }
        : orderTotal(items),
    items,
    return_until: row.return_until,
    returns,
    parcels: parcels.map((parcel) => ({
      id: parcel.id,
      carrier: parcel.carrier,
      tracking_number: parcel.tracking_number,
      direction: parcel.direction,
      display_name: parcel.display_name,
      status: parcel.status,
      delivered: parcel.delivered,
      delivered_at: parcel.delivered_at,
      expected_from: parcel.expected_from,
      expected_to: parcel.expected_to,
      expected_days: parcel.expected_days,
      archived_at: parcel.archived_at,
      location: parcel.location,
      url: parcel.url,
    })),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Orders as their own resource. Status and archiving are derived from the parcels on every read
 * (see `order-lifecycle.ts`), so they can never drift from what the parcels say.
 */
export class OrderService {
  readonly #parcels: ParcelRepository;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly bus: EventBus,
    private readonly clock: Clock,
    private readonly presentation: Presentation = RAW_PRESENTATION,
    /** Embeds each order's returns; without it orders list none. */
    private readonly returns?: ReturnService,
  ) {
    this.#parcels = new ParcelRepository(db, presentation);
  }

  /**
   * Orders in the view, newest first; `more` says another page follows. The page is chosen in SQL
   * (`list-query.ts`); only its orders are built with their lines, parcels and returns.
   */
  async list(filter: OrderFilter): Promise<{ orders: Order[]; more: boolean }> {
    const page = await orderPage(this.db, filter, this.clock.now());
    const built = new Map((await this.byIds(page.ids)).map((order) => [order.id, order]));
    return {
      orders: page.ids.flatMap((id) => {
        const order = built.get(id);
        return order === undefined ? [] : [order];
      }),
      more: page.more,
    };
  }

  async get(id: string): Promise<Order | undefined> {
    const row = await this.db
      .selectFrom("orders")
      .selectAll()
      .where("id", "=", id)
      .where("deleted_at", "is", null)
      .where(orderVisible)
      .executeTakeFirst();
    if (row === undefined) return undefined;
    const [order] = await this.#build([row]);
    return order;
  }

  /** These orders as `get` shows them; ids deleted, hidden or unknown are left out. */
  async byIds(ids: readonly string[]): Promise<Order[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .selectFrom("orders")
      .selectAll()
      .where("id", "in", ids)
      .where("deleted_at", "is", null)
      .where(orderVisible)
      .execute();
    return this.#build(rows);
  }

  async update(id: string, patch: OrderPatch): Promise<Order | undefined> {
    if ((await this.get(id)) === undefined) return undefined;
    const now = isoNow(this.clock);
    await this.db
      .updateTable("orders")
      .set({
        updated_at: now,
        ...(patch.label === undefined ? {} : { label: patch.label }),
        ...(patch.archived === undefined
          ? {}
          : patch.archived === null
            ? { archive_mode: null, archived_at: null }
            : patch.archived
              ? { archive_mode: "archived", archived_at: now }
              : { archive_mode: "kept", archived_at: null }),
      })
      .where("id", "=", id)
      .execute();
    const after = await this.get(id);
    if (after === undefined) return undefined;
    await appendEvent(this.db, this.clock, {
      type: "order.updated",
      parcelId: null,
      payload: { ...after, parcels: [] },
    });
    await this.bus.notify();
    return after;
  }

  /**
   * Deletes the order but keeps its parcels, which lose the link. The row stays as a tombstone
   * (`deleted_at`), so a shop connection listing the order again does not bring it back: its parcels
   * are then tracked without an order.
   */
  async delete(id: string): Promise<boolean> {
    const order = await this.get(id);
    if (order === undefined) return false;
    const now = isoNow(this.clock);
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom("order_items").where("order_id", "=", id).execute();
      await trx
        .updateTable("parcels")
        .set({ order_id: null, updated_at: now })
        .where("order_id", "=", id)
        .execute();
      await trx
        .updateTable("orders")
        .set({ deleted_at: now, updated_at: now })
        .where("id", "=", id)
        .execute();
      await appendEvent(trx, this.clock, {
        type: "order.deleted",
        parcelId: null,
        payload: { id, parcel_ids: order.parcels.map((parcel) => parcel.id) },
      });
    });
    await this.bus.notify();
    return true;
  }

  async #build(rows: readonly OrderRow[]): Promise<Order[]> {
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return [];
    const [lines, parcels, returns] = await Promise.all([
      this.db
        .selectFrom("order_items")
        .selectAll()
        .where("order_id", "in", ids)
        .orderBy("order_id")
        .orderBy("position")
        .execute(),
      this.#parcels.byOrders(ids),
      this.returns?.byOrders(ids) ?? Promise.resolve([]),
    ]);
    const now = this.clock.now();
    const linesOf = groupBy(lines, (line) => line.order_id);
    const parcelsOf = groupBy(parcels, (entry) => entry.orderId);
    const returnsOf = groupBy(returns, (entry) => entry.order_id);
    return rows.map((row) =>
      toOrder(
        row,
        {
          items: (linesOf.get(row.id) ?? []).map((line) => ({
            title: line.title,
            image_url: this.presentation.imagePath(line.image_ref),
            url: line.url,
            quantity: line.quantity,
            price: line.price,
            currency: line.currency,
            parcel_id: line.parcel_id,
          })),
          parcels: (parcelsOf.get(row.id) ?? []).map((entry) => entry.parcel),
          returns: returnsOf.get(row.id) ?? [],
        },
        now,
        this.presentation.providerName(row.shop),
      ),
    );
  }
}
