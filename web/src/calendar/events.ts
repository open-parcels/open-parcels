import type { EventInput } from "@fullcalendar/core";
import type { CalendarEntry } from "../api/types";
import { t } from "../i18n";
import { costLabel, dropOffLabel } from "../returns/parts";

/** A return's deadline says where to hand it in and what it costs. */
function returnDetails(entry: CalendarEntry, nameOf: (id: string) => string): string[] {
  const cost = costLabel(entry.cost);
  return [
    ...entry.drop_off.map((option) => `${t.returns.dropOff}: ${dropOffLabel(option, nameOf)}`),
    ...(cost === null ? [] : [cost]),
  ];
}

/**
 * One calendar entry as a FullCalendar event. All-day entries use the server's local days
 * (`2026-11-20`), never the instants, so they land on the right day whatever time zone the
 * browser reports (LibreWolf, for one, reports UTC).
 */
export function toCalendarEvent(entry: CalendarEntry, nameOf: (id: string) => string): EventInput {
  const span =
    entry.all_day && entry.start_date !== null && entry.end_date !== null
      ? { start: entry.start_date, end: entry.end_date, allDay: true }
      : { start: entry.start, end: entry.end, allDay: false };
  // The title is the label, first item or tracking number; the carrier is added here, once. A return's
  // deadline says so and lists where to hand it in and what it costs.
  const title =
    entry.kind === "return_by"
      ? [t.calendar.returnBy(entry.title), ...returnDetails(entry, nameOf)].join(" · ")
      : `${entry.title} · ${nameOf(entry.carrier)}`;
  return {
    id: entry.uid,
    title,
    ...span,
    classNames: [`cal-${entry.kind}`, ...(entry.late ? ["cal-late"] : [])],
    extendedProps: { parcelId: entry.parcel_id, orderId: entry.order_id },
  };
}
