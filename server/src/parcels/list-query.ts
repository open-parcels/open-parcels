import { sql, type Kysely, type RawBuilder, type SelectQueryBuilder } from "kysely";
import type { Database, ParcelRow } from "../db/schema.js";
import { parcelVisible } from "../db/visibility.js";
import type { ParcelLabelMode, ParcelStatus } from "../domain/parcel.js";

/** The columns the parcel list can be sorted by; `-` before one sorts it descending. */
export const PARCEL_SORT_KEYS = [
  "updated_at",
  "name",
  "status",
  "lookup",
  "carrier",
  "expected",
] as const;
export type ParcelSortKey = (typeof PARCEL_SORT_KEYS)[number];

export interface ParcelFilter {
  readonly active?: boolean;
  readonly status?: ParcelStatus;
  readonly carrier?: string;
  readonly includeArchived?: boolean;
  /** Words to find in the tracking number, name, carrier, carrier's status, items or order. */
  readonly search?: string;
  readonly sort?: { readonly key: ParcelSortKey; readonly desc: boolean };
  readonly limit?: number;
  /** Rows to skip, for paging through more parcels than one page holds. */
  readonly offset?: number;
}

/** Parcels per page when no limit is given. */
export const PARCEL_PAGE_DEFAULT = 500;

type ParcelQuery = SelectQueryBuilder<Database, "parcels", ParcelRow>;

// A status set by hand wins over the carrier's, for filters and sorting as everywhere else.
const EFFECTIVE_STATUS = sql<string>`coalesce(parcels.manual_status, parcels.status)`;
const EFFECTIVE_DELIVERED = sql<number>`(case when parcels.manual_status is null
  then parcels.delivered else parcels.manual_status = 'delivered' end)`;

/** `text` for a LIKE pattern: its own `%`, `_` and `\` match only themselves. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Every word of the search appears somewhere in the parcel (SQLite's LIKE ignores ASCII case). */
function withSearch(query: ParcelQuery, search: string): ParcelQuery {
  const words = search
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");
  let result = query;
  for (const word of words) {
    const pattern = likePattern(word);
    const like = (column: RawBuilder<unknown>) =>
      sql<boolean>`${column} like ${pattern} escape '\\'`;
    result = result.where(
      sql<boolean>`(${like(sql`parcels.tracking_number`)}
        or ${like(sql`parcels.label`)}
        or ${like(sql`parcels.carrier`)}
        or ${like(sql`parcels.raw_status`)}
        or ${like(EFFECTIVE_STATUS)}
        or exists (select 1 from items where items.parcel_id = parcels.id
          and ${like(sql`items.title`)})
        or exists (select 1 from orders where orders.id = parcels.order_id
          and (${like(sql`orders.order_number`)} or ${like(sql`orders.shop`)}
            or ${like(sql`orders.label`)}))
        or exists (select 1 from order_items where order_items.order_id = parcels.order_id
          and ${like(sql`order_items.title`)}))`,
    );
  }
  return result;
}

/**
 * A parcel's name as the list shows it: its label, else (in the "Item names" label mode) its own
 * item names, else its tracking number. Names taken from its order's lines are left out here.
 */
function nameKey(mode: ParcelLabelMode): RawBuilder<string> {
  const items =
    mode === "items"
      ? sql`(select group_concat(trim(items.title), ', ') from items
          where items.parcel_id = parcels.id and trim(items.title) != '')`
      : sql`null`;
  return sql<string>`coalesce(parcels.label, ${items}, parcels.tracking_number) collate nocase`;
}

function sortKey(key: ParcelSortKey, mode: ParcelLabelMode): RawBuilder<unknown> {
  switch (key) {
    case "updated_at":
      return sql`parcels.updated_at`;
    case "name":
      return nameKey(mode);
    case "status":
      return EFFECTIVE_STATUS;
    case "lookup":
      return sql`parcels.lookup_state`;
    case "carrier":
      return sql`parcels.carrier`;
    case "expected":
      return sql`coalesce(parcels.expected_from, parcels.expected_to)`;
  }
}

/**
 * The parcel list's page as one query: visible parcels, filtered, searched and sorted by the
 * database, `limit` rows from `offset`. The newest change first is the default and walks the
 * `parcels_updated` index; other sorts end on it, then the id, so pages never repeat or skip a
 * parcel.
 */
export function parcelPageQuery(
  db: Kysely<Database>,
  filter: ParcelFilter,
  mode: ParcelLabelMode,
): ParcelQuery {
  let query: ParcelQuery = db.selectFrom("parcels").selectAll("parcels").where(parcelVisible);
  if (filter.includeArchived !== true) {
    query = query.where("parcels.archived_at", "is", null);
  }
  if (filter.active !== undefined) {
    query = query.where(sql<boolean>`${EFFECTIVE_DELIVERED} = ${filter.active ? 0 : 1}`);
  }
  if (filter.status !== undefined) {
    query = query.where(sql<boolean>`${EFFECTIVE_STATUS} = ${filter.status}`);
  }
  if (filter.carrier !== undefined) {
    query = query.where("parcels.carrier", "=", filter.carrier);
  }
  if (filter.search !== undefined) {
    query = withSearch(query, filter.search);
  }
  const sort = filter.sort ?? { key: "updated_at", desc: true };
  if (sort.key !== "updated_at") {
    const key = sortKey(sort.key, mode);
    // Parcels without a value come last either way.
    query = query.orderBy(sql`${key} is null`).orderBy(key, sort.desc ? "desc" : "asc");
  }
  return query
    .orderBy("parcels.updated_at", sort.key === "updated_at" && !sort.desc ? "asc" : "desc")
    .orderBy("parcels.id", "asc")
    .limit(filter.limit ?? PARCEL_PAGE_DEFAULT)
    .offset(filter.offset ?? 0);
}

export interface ParcelCounts {
  readonly active: number;
  readonly delivered: number;
  readonly archived: number;
  readonly carriers: { readonly carrier: string; readonly parcels: number }[];
  readonly connections: {
    readonly connection_id: string;
    readonly active: number;
    readonly delivered: number;
    readonly total: number;
  }[];
}

/**
 * How many visible parcels there are, archived ones included: on the way (not delivered, not
 * archived), delivered and archived; per carrier; and per connection that reported them.
 */
export async function parcelCounts(db: Kysely<Database>): Promise<ParcelCounts> {
  const active = sql<number>`coalesce(sum(not ${EFFECTIVE_DELIVERED}
    and parcels.archived_at is null), 0)`;
  const delivered = sql<number>`coalesce(sum(${EFFECTIVE_DELIVERED}), 0)`;
  const [totals, carriers, connections] = await Promise.all([
    db
      .selectFrom("parcels")
      .where(parcelVisible)
      .select([
        active.as("active"),
        delivered.as("delivered"),
        sql<number>`coalesce(sum(parcels.archived_at is not null), 0)`.as("archived"),
      ])
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("parcels")
      .where(parcelVisible)
      .select(["parcels.carrier", sql<number>`count(*)`.as("parcels")])
      .groupBy("parcels.carrier")
      .orderBy("parcels.carrier")
      .execute(),
    db
      .selectFrom("parcels")
      .innerJoin(
        db
          .selectFrom("parcel_connections")
          .select(["parcel_id", "connection_id"])
          .distinct()
          .as("pc"),
        "pc.parcel_id",
        "parcels.id",
      )
      .where(parcelVisible)
      .select([
        "pc.connection_id",
        active.as("active"),
        delivered.as("delivered"),
        sql<number>`count(*)`.as("total"),
      ])
      .groupBy("pc.connection_id")
      .execute(),
  ]);
  return { ...totals, carriers, connections };
}
