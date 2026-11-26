import type { ReportedOrderStatus } from "../domain/order.js";
import type { Direction, ParcelStatus } from "../domain/parcel.js";
import type { DropOffOption, RefundStatus, ReturnStatus } from "../domain/return.js";
import type { LiveTarget } from "./live.js";

/** One history entry as the carrier reports it. `status` is null when the raw value did not map. */
export interface SnapshotEvent {
  readonly at: string;
  readonly status: ParcelStatus | null;
  readonly rawStatus: string;
  readonly location: string | null;
  /** Where the scan happened, when the carrier gives coordinates (WGS 84). */
  readonly latitude?: number;
  readonly longitude?: number;
  /**
   * The connection's own identity for this entry (a mail's Message-ID), when it has one. The stored
   * entry is then deduplicated on it instead of on time and text, so one mail is one entry.
   */
  readonly id?: string;
}

export interface SnapshotItem {
  readonly title: string;
  /** Remote image URL; the server serves it through its image proxy, never directly. */
  readonly imageUrl: string | null;
  readonly url: string | null;
  readonly externalId: string | null;
  readonly quantity: number | null;
  readonly price: number | null;
  readonly currency: string | null;
}

/**
 * What a connection knows about one parcel at one moment. Providers return these; only the reconciler
 * turns them into stored parcels and events. Unknown values are null, never guessed.
 */
export interface ParcelSnapshot {
  /** Carrier id of the company physically carrying the parcel (`dhl`, `amazon`, …). */
  readonly carrier: string;
  readonly trackingNumber: string;
  readonly direction: Direction;
  /** Mapped status, or null when the carrier's latest value is unknown to us. */
  readonly status: ParcelStatus | null;
  readonly rawStatus: string | null;
  readonly delivered: boolean;
  readonly deliveredAt: string | null;
  readonly expectedFrom: string | null;
  readonly expectedTo: string | null;
  readonly pickup: boolean;
  readonly pickupPoint: string | null;
  readonly url: string | null;
  readonly sender: string | null;
  readonly receiver: string | null;
  readonly weightKg: number | null;
  readonly history: readonly SnapshotEvent[];
  /**
   * The history is everything this connection has for the parcel: entries it stored earlier and no
   * longer reports are dropped (only its own, never another connection's). For connections whose history
   * starts over, like the demo providers' loop.
   */
  readonly historyComplete?: boolean;
  /** Items known to be in this parcel. */
  readonly items: readonly SnapshotItem[];
  /**
   * Everything in the order, when the connection knows the order but not (for every item) which
   * parcel carries it, like a shop. Items also listed in `items` are linked to this parcel; the
   * rest belong to the order only. Unset: the order's items are left as they are.
   */
  readonly orderItems?: readonly SnapshotItem[];
  readonly order: {
    readonly shop: string;
    readonly orderNumber: string;
    readonly placedAt: string | null;
    /** Last day of the shop's return window (`YYYY-MM-DD`), when it lists one. */
    readonly returnUntil?: string | null;
  } | null;
  /** The connection's own reference for this parcel (order line, shipment id), if different from the tracking number. */
  readonly externalRef: string | null;
  /**
   * Set by shops when another carrier delivers the parcel. The reconciler then files this snapshot
   * under that carrier's parcel, so the shop and the carrier never produce two entries.
   */
  readonly handoff: { readonly carrier: string; readonly trackingNumber: string } | null;
  /** The raw payload, stored separately. Must not contain codes that open or sign in to anything. */
  readonly raw: unknown;
  /** Set when the carrier can show the courier on a map for this parcel. Kept in memory only. */
  readonly live: LiveTarget | null;
}

/**
 * What a connection knows about one return of an order. Unknown values are null and never erase what
 * another report said; `dropOff` replaces the stored options only when it lists some.
 */
/**
 * A payment service's refund that names no order: the order is the one that cost `total`, paid
 * to `payee` (as the email names it) before `paidBefore`. Such a report never starts an order.
 */
export interface PaymentRef {
  readonly payee: string | null;
  readonly total: { readonly amount: number; readonly currency: string };
  readonly paidBefore: string | null;
}

export interface ReturnSnapshot {
  readonly order: { readonly shop: string; readonly orderNumber: string } | PaymentRef;
  /**
   * The shop's own id for the return, when it gives one. Without it the report updates the
   * order's newest open return, or starts one.
   */
  readonly externalRef: string | null;
  /** Null: the report says something about the return, but not where it stands. */
  readonly status: ReturnStatus | null;
  readonly reason: string | null;
  /** The last local day to hand it in, `YYYY-MM-DD`. */
  readonly returnBy: string | null;
  readonly dropOff: readonly DropOffOption[];
  readonly cost: {
    readonly free: boolean;
    readonly amount: number | null;
    readonly currency: string | null;
  } | null;
  /** Label or QR-code page; only http(s) is kept. */
  readonly labelUrl: string | null;
  /** The return's own parcel, when the shop or carrier gives its tracking number. */
  readonly tracking: { readonly carrier: string; readonly trackingNumber: string } | null;
  readonly refund: {
    readonly amount: number | null;
    readonly currency: string | null;
    readonly status: RefundStatus;
  } | null;
  /** Item titles, matched to the order's lines where they agree. */
  readonly items: readonly string[];
  /**
   * Whether this report may start a return when the order has none open. A refund alone (which
   * can be for a cancelled order) only updates a return already known.
   */
  readonly mayCreate: boolean;
}

/**
 * What a connection knows about one order without a parcel to carry it: an order email's
 * confirmation, shipping or delivery notice, cancellation, or a payment receipt.
 */
export interface OrderSnapshot {
  readonly order: { readonly shop: string; readonly orderNumber: string };
  /** What the report says happened; null when it says nothing about where the order stands. */
  readonly status: ReportedOrderStatus | null;
  /** When the report was made (the email's date); dates the order when nothing else does. */
  readonly at: string | null;
  /** Item titles, added to the order's lines where they are new. */
  readonly items: readonly string[];
  /** What the whole order costs, as the email states it. */
  readonly total: { readonly amount: number; readonly currency: string } | null;
  /**
   * A payment service's receipt quoting the shop's reference: the shop is not known, so the
   * report joins the order with this number at whichever shop has it.
   */
  readonly payment: boolean;
}

/** Fills the optional parts of a return report, so connections only spell out what they know. */
export function returnSnapshot(
  required: Pick<ReturnSnapshot, "order" | "status"> & Partial<ReturnSnapshot>,
): ReturnSnapshot {
  return {
    externalRef: null,
    reason: null,
    returnBy: null,
    dropOff: [],
    cost: null,
    labelUrl: null,
    tracking: null,
    refund: null,
    items: [],
    mayCreate: true,
    ...required,
  };
}

/** Fills the optional parts of a snapshot with nulls, so providers only spell out what they know. */
export function snapshot(
  required: Pick<ParcelSnapshot, "carrier" | "trackingNumber" | "status" | "rawStatus"> &
    Partial<ParcelSnapshot>,
): ParcelSnapshot {
  return {
    direction: "receiving",
    delivered: required.status === "delivered",
    deliveredAt: null,
    expectedFrom: null,
    expectedTo: null,
    pickup: false,
    pickupPoint: null,
    url: null,
    sender: null,
    receiver: null,
    weightKg: null,
    history: [],
    items: [],
    order: null,
    externalRef: null,
    handoff: null,
    raw: null,
    live: null,
    ...required,
  };
}
