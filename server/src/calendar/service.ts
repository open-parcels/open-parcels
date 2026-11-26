import type { Kysely } from "kysely";
import type { Clock } from "../clock.js";
import type { Database } from "../db/schema.js";
import { parcelVisible } from "../db/visibility.js";
import {
  effectiveDelivered,
  parseStatus,
  statusOrUnknown,
  type ParcelStatus,
} from "../domain/parcel.js";
import { localParts, nextLocalMidnight, zonedTime } from "../engine/tz.js";
import { awaitingDropOff, type Return, type ReturnStatus } from "../domain/return.js";
import { ParcelRepository, RAW_PRESENTATION, type Presentation } from "../parcels/repository.js";
import type { ReturnService } from "../returns/service.js";

/** How long a delivered parcel's marker lasts on the calendar. */
const DELIVERED_MARKER_MS = 30 * 60_000;

/**
 * One calendar entry. The Calendar tab and the ICS feed both read these, so they can never
 * disagree. `uid` is stable per parcel: when an all-day estimate narrows to a time window, the
 * same entry changes instead of a second one appearing.
 */
export interface CalendarEntry {
  readonly uid: string;
  /** Null for a return's deadline, which belongs to an order. */
  readonly parcelId: string | null;
  readonly returnId: string | null;
  readonly orderId: string | null;
  readonly title: string;
  /** For a return: its carrier, else the first drop-off option's, else the shop. */
  readonly carrier: string;
  /** For a return: the order number. */
  readonly trackingNumber: string;
  readonly status: ParcelStatus | ReturnStatus;
  /** `return_by`: the last day to hand a return in, all day. */
  readonly kind: "expected" | "delivered" | "return_by";
  /** For a return: where it may be handed in; empty for a parcel. */
  readonly dropOff: Return["drop_off"];
  /** For a return: what sending it back costs, when known; null for a parcel. */
  readonly cost: Return["cost"];
  readonly start: string;
  readonly end: string;
  readonly allDay: boolean;
  /**
   * For all-day entries, the local calendar days as `YYYY-MM-DD`, the end exclusive (as in ICS).
   * Readers use these instead of `start`/`end`, so the days never shift with the reader's zone.
   */
  readonly startDate: string | null;
  readonly endDate: string | null;
  /** Undelivered and its window has passed. */
  readonly late: boolean;
  readonly imageUrl: string | null;
  readonly url: string | null;
  readonly pickupPoint: string | null;
}

/**
 * A window counts as whole days when it starts at local midnight and ends at a later local
 * midnight (exclusive) or at 23:59(:59) of a day (inclusive).
 */
export function isWholeDays(start: Date, end: Date, timeZone: string): boolean {
  if (end <= start) {
    return false;
  }
  const from = localParts(start, timeZone);
  const to = localParts(end, timeZone);
  const startsAtMidnight = from.hour === 0 && from.minute === 0;
  const endsAtMidnight = to.hour === 0 && to.minute === 0;
  const endsAtDayEnd = to.hour === 23 && to.minute === 59;
  return startsAtMidnight && (endsAtMidnight || endsAtDayEnd);
}

/** A time at local midnight carries a date only: the connection knew the day, not the hour. */
function isDateOnly(at: Date, timeZone: string): boolean {
  const parts = localParts(at, timeZone);
  return parts.hour === 0 && parts.minute === 0;
}

function isoDay(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

/**
 * The local days an all-day entry covers, end exclusive. An end that is not at midnight (an
 * inclusive 23:59) belongs to its own day, so the exclusive end is the day after it.
 */
function allDayRange(
  start: Date,
  end: Date,
  timeZone: string,
): { startDate: string; endDate: string } {
  const from = localParts(start, timeZone);
  const to = localParts(end, timeZone);
  const startDate = isoDay(from.year, from.month, from.day);
  const endsAtMidnight = to.hour === 0 && to.minute === 0;
  let endDate = isoDay(to.year, to.month, to.day + (endsAtMidnight ? 0 : 1));
  if (endDate <= startDate) {
    endDate = isoDay(from.year, from.month, from.day + 1);
  }
  return { startDate, endDate };
}

/** Local midnight at the start of a `YYYY-MM-DD` day. */
function zonedDayStart(day: string, timeZone: string): Date {
  const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);
  return zonedTime({ year, month, day: date, hour: 0, minute: 0 }, timeZone);
}

export class CalendarService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly clock: Clock,
    private readonly timeZone: string,
    /** Remote pictures become the server's image-proxy addresses, as everywhere else. */
    private readonly presentation: Presentation = RAW_PRESENTATION,
    /** Adds each return's "return by" day; without it the calendar shows parcels only. */
    private readonly returns?: ReturnService,
  ) {}

  async entries(from: Date, to: Date): Promise<CalendarEntry[]> {
    const [parcels, returns] = await Promise.all([
      this.#parcelEntries(from, to),
      this.#returnEntries(from, to),
    ]);
    return [...parcels, ...returns].sort((a, b) => a.start.localeCompare(b.start));
  }

  /**
   * Returns still to be handed in (or no longer, `expired`) on their return-by day. Once handed
   * in, the deadline no longer matters and the entry goes.
   */
  async #returnEntries(from: Date, to: Date): Promise<CalendarEntry[]> {
    if (this.returns === undefined) return [];
    const all = await this.returns.list("all");
    const entries: CalendarEntry[] = [];
    for (const entry of all) {
      if (entry.return_by === null) continue;
      if (!awaitingDropOff(entry.status) && entry.status !== "expired") continue;
      const start = zonedDayStart(entry.return_by, this.timeZone);
      const end = nextLocalMidnight(start, this.timeZone);
      if (end <= from || start >= to) continue;
      entries.push(this.#returnEntry(entry, start, end));
    }
    return entries;
  }

  #returnEntry(entry: Return, start: Date, end: Date): CalendarEntry {
    const item = entry.items[0]?.title;
    return {
      uid: `return-${entry.id}@open-parcels`,
      parcelId: null,
      returnId: entry.id,
      orderId: entry.order_id,
      title: item ?? `${this.presentation.providerName(entry.shop)} ${entry.order_number}`,
      carrier:
        entry.carrier ?? entry.drop_off.find((o) => o.carrier !== null)?.carrier ?? entry.shop,
      trackingNumber: entry.order_number,
      status: entry.status,
      kind: "return_by",
      dropOff: entry.drop_off,
      cost: entry.cost,
      late: entry.status === "expired",
      imageUrl: null,
      url: entry.label_url,
      pickupPoint: null,
      ...this.#span(start, end, true),
    };
  }

  async #parcelEntries(from: Date, to: Date): Promise<CalendarEntry[]> {
    const fromIso = from.toISOString();
    const toIso = to.toISOString();
    const rows = await this.db
      .selectFrom("parcels")
      .select([
        "id",
        "carrier",
        "tracking_number",
        "status",
        "manual_status",
        "manual_at",
        "delivered",
        "delivered_at",
        "expected_from",
        "expected_to",
        "label",
        "url",
        "pickup_point",
        "archived_at",
      ])
      // A calendar is a history too: archived deliveries stay (decided per row below). Deleted
      // parcels are gone from the table; removed ones (vanished undelivered) never show.
      .where("removed_at", "is", null)
      .where(parcelVisible)
      // Candidates only; whether a parcel counts as delivered (a manual status wins) is decided
      // below, per row.
      .where((eb) =>
        eb.or([
          eb.and([
            eb("expected_from", "is not", null),
            eb("expected_from", "<", toIso),
            eb(eb.fn.coalesce("expected_to", "expected_from"), ">=", fromIso),
          ]),
          eb.and([eb("delivered_at", ">=", fromIso), eb("delivered_at", "<", toIso)]),
          // Marked delivered by hand: delivered when the owner said so.
          eb.and([
            eb("manual_status", "=", "delivered"),
            eb("manual_at", ">=", fromIso),
            eb("manual_at", "<", toIso),
          ]),
        ]),
      )
      .execute();
    // Named and pictured exactly as in the lists and Home Assistant: the label, else the "Default
    // parcel label" setting (item names or the code), with order lines as items when needed.
    const parcels = await new ParcelRepository(this.db, this.presentation).byIds(
      rows.map((row) => row.id),
    );
    const now = this.clock.now();
    return rows
      .map((row): CalendarEntry | undefined => {
        const parcel = parcels.get(row.id);
        const base = {
          uid: `${row.id}@open-parcels`,
          parcelId: row.id,
          returnId: null,
          orderId: null,
          dropOff: [],
          cost: null,
          // The carrier is shown next to the title by each reader, so it is not repeated here.
          title: parcel?.display_name ?? row.label ?? row.tracking_number,
          carrier: row.carrier,
          trackingNumber: row.tracking_number,
          status: statusOrUnknown(row.manual_status ?? row.status),
          imageUrl: parcel?.items[0]?.image_url ?? null,
          url: row.url,
          pickupPoint: row.pickup_point,
        };
        const delivered = effectiveDelivered(row.delivered === 1, parseStatus(row.manual_status));
        if (delivered) {
          const at = row.delivered_at ?? row.manual_at;
          if (at === null || at < fromIso || at >= toIso) {
            return undefined;
          }
          const start = new Date(at);
          // A delivery known only by its day is that whole day, not half an hour at midnight.
          const dateOnly = isDateOnly(start, this.timeZone);
          // The next local midnight, not 24 hours on: a daylight-saving day has 23 or 25.
          const end = dateOnly
            ? nextLocalMidnight(start, this.timeZone)
            : new Date(start.getTime() + DELIVERED_MARKER_MS);
          return { ...base, kind: "delivered", late: false, ...this.#span(start, end, dateOnly) };
        }
        // Archived parcels stay in the calendar only as past deliveries.
        if (row.archived_at !== null || row.expected_from === null || row.expected_from >= toIso) {
          return undefined;
        }
        const start = new Date(row.expected_from);
        // A date without a time is that whole day; another single point estimate is an hour.
        const pointIsDay = row.expected_to === null && isDateOnly(start, this.timeZone);
        const end =
          row.expected_to !== null
            ? new Date(row.expected_to)
            : pointIsDay
              ? nextLocalMidnight(start, this.timeZone)
              : new Date(start.getTime() + 60 * 60_000);
        if (end.toISOString() < fromIso) {
          return undefined;
        }
        return {
          ...base,
          kind: "expected",
          late: end < now,
          ...this.#span(start, end, pointIsDay || isWholeDays(start, end, this.timeZone)),
        };
      })
      .filter((entry): entry is CalendarEntry => entry !== undefined);
  }

  #span(start: Date, end: Date, allDay: boolean) {
    const days = allDay ? allDayRange(start, end, this.timeZone) : null;
    return {
      start: start.toISOString(),
      end: end.toISOString(),
      allDay,
      startDate: days?.startDate ?? null,
      endDate: days?.endDate ?? null,
    };
  }
}
