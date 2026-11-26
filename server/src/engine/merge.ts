import type { Direction, ParcelStatus } from "../domain/parcel.js";
import type { ParcelSnapshot, SnapshotEvent } from "../provider/snapshot.js";
import { compareTimes } from "./utc.js";

/** The parcel fields a snapshot can change. */
export interface ParcelState {
  readonly direction: Direction;
  readonly status: ParcelStatus;
  readonly rawStatus: string | null;
  readonly statusAt: string | null;
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
}

/**
 * `carrier`: the company carrying the parcel reports on its own parcel.
 * `secondary`: someone else's view of it, e.g. the shop after a hand-off, or a mail.
 */
export type Authority = "carrier" | "secondary";

function newest(events: readonly SnapshotEvent[]): SnapshotEvent | undefined {
  let best: SnapshotEvent | undefined;
  for (const event of events) {
    if (best === undefined || compareTimes(event.at, best.at) > 0) {
      best = event;
    }
  }
  return best;
}

/** The newest history entry that maps, across every connection's history given. */
function newestMapped(
  ...histories: readonly (readonly SnapshotEvent[])[]
): SnapshotEvent | undefined {
  return newest(histories.flat().filter((event) => event.status !== null));
}

/**
 * The status this snapshot itself signals: its mapped latest value, else its delivered flag,
 * else the newest of its own history entries that maps; null when it signals nothing.
 */
function ownSignal(snapshot: ParcelSnapshot): ParcelStatus | null {
  if (snapshot.status !== null) {
    return snapshot.status;
  }
  if (snapshot.delivered) {
    return "delivered";
  }
  return newestMapped(snapshot.history)?.status ?? null;
}

function newestEventAt(snapshot: ParcelSnapshot): string | null {
  return newest(snapshot.history)?.at ?? null;
}

/** May this snapshot set the status, given what is stored? Newer scans win; the carrier wins ties. */
function maySetStatus(
  current: ParcelState | null,
  authority: Authority,
  snapshotAt: string | null,
  signal: ParcelStatus,
): boolean {
  if (current === null || current.status === "unknown") {
    return true;
  }
  // A mail or a shop lags behind the carrier; it never takes a delivered parcel back.
  if (current.delivered && authority === "secondary" && signal !== "delivered") {
    return false;
  }
  if (snapshotAt !== null && current.statusAt !== null) {
    const order = compareTimes(snapshotAt, current.statusAt);
    return authority === "carrier" ? order >= 0 : order > 0;
  }
  // A connection without history cannot show that it is newer than a status set by a timed scan;
  // it may lag behind (DHL NL's account, the DHL PL lookup), so only its delivered stands.
  if (snapshotAt === null && current.statusAt !== null) {
    return authority === "carrier" && signal === "delivered";
  }
  return authority === "carrier";
}

interface StatusDecision {
  readonly setStatus: boolean;
  readonly status: ParcelStatus;
  readonly delivered: boolean;
  /** The history entry the status fell back to, when it came from the merged history. */
  readonly fallback?: SnapshotEvent;
}

/**
 * The canonical status is the newest mapped signal across all connections. A snapshot that signals
 * nothing never overrides a mapped status; with nothing mapped stored either, the merged history
 * (the stored events of every connection plus this snapshot's) gives the newest entry that maps.
 */
function decideStatus(
  current: ParcelState | null,
  snapshot: ParcelSnapshot,
  authority: Authority,
  storedHistory: readonly SnapshotEvent[],
): StatusDecision {
  const signal = ownSignal(snapshot);
  if (signal === null) {
    if (current !== null && current.status !== "unknown") {
      return { setStatus: false, status: current.status, delivered: current.delivered };
    }
    const fallback = newestMapped(snapshot.history, storedHistory);
    const status = fallback?.status ?? "unknown";
    return {
      setStatus: false,
      status,
      delivered: (current?.delivered ?? false) || status === "delivered",
      ...(fallback === undefined ? {} : { fallback }),
    };
  }
  if (!maySetStatus(current, authority, newestEventAt(snapshot), signal)) {
    return {
      setStatus: false,
      status: current?.status ?? signal,
      delivered: current?.delivered ?? false,
    };
  }
  return {
    setStatus: true,
    status: signal,
    delivered: snapshot.delivered || signal === "delivered",
  };
}

/**
 * Repairs a state stored before the merge rules above: an `unknown` status takes the newest
 * history entry that maps, and a delivered status always counts as delivered. Returns null when
 * nothing needs repairing, so running it again changes nothing.
 */
export function healState(
  state: ParcelState,
  history: readonly SnapshotEvent[],
): ParcelState | null {
  const fallback = state.status === "unknown" ? newestMapped(history) : undefined;
  const status = fallback?.status ?? state.status;
  if (fallback === undefined && (status !== "delivered" || state.delivered)) {
    return null;
  }
  const delivered = state.delivered || status === "delivered";
  const statusAt = fallback?.at ?? state.statusAt;
  return {
    ...state,
    status,
    rawStatus: fallback?.rawStatus ?? state.rawStatus,
    statusAt,
    delivered,
    deliveredAt: delivered ? (state.deliveredAt ?? statusAt) : null,
    expectedFrom: delivered ? null : state.expectedFrom,
    expectedTo: delivered ? null : state.expectedTo,
  };
}

/**
 * Merges one snapshot into the stored state. Pure: no I/O, no clock. `storedHistory` is the
 * parcel's stored history from every connection, used only when nothing else maps.
 */
export function mergeParcel(
  current: ParcelState | null,
  snapshot: ParcelSnapshot,
  authority: Authority,
  storedHistory: readonly SnapshotEvent[] = [],
): ParcelState {
  const snapshotAt = newestEventAt(snapshot);
  const { setStatus, status, delivered, fallback } = decideStatus(
    current,
    snapshot,
    authority,
    storedHistory,
  );
  const prefer = <T>(fromSnapshot: T | null, stored: T | null | undefined): T | null =>
    authority === "carrier" ? (fromSnapshot ?? stored ?? null) : (stored ?? fromSnapshot ?? null);
  // A kept mapped status keeps its own raw value; a fallback shows the entry it came from.
  const keepRaw = !setStatus && current !== null && current.status !== "unknown";
  const rawStatus = keepRaw
    ? (current.rawStatus ?? snapshot.rawStatus)
    : (fallback?.rawStatus ?? snapshot.rawStatus);
  const statusAt = setStatus
    ? (snapshotAt ?? current?.statusAt ?? null)
    : (fallback?.at ?? current?.statusAt ?? null);
  // A carrier that reports its complete history (a story that starts over) also states the
  // pickup and the expected delivery as they are now, instead of keeping ones an earlier state set:
  // an estimate it withdrew after a missed delivery is gone (OP-022).
  const wholeTruth = setStatus && authority === "carrier" && snapshot.historyComplete === true;
  // Either end is an estimate: some carriers send only the latest time (OP-089).
  const windowFromSnapshot =
    setStatus && (snapshot.expectedFrom !== null || snapshot.expectedTo !== null || wholeTruth);
  return {
    direction: current?.direction ?? snapshot.direction,
    status,
    rawStatus,
    statusAt,
    delivered,
    deliveredAt: delivered
      ? setStatus
        ? (snapshot.deliveredAt ?? current?.deliveredAt ?? snapshotAt)
        : (current?.deliveredAt ?? fallback?.at ?? snapshotAt)
      : null,
    // A delivered parcel has no plan any more.
    expectedFrom: delivered
      ? null
      : windowFromSnapshot
        ? snapshot.expectedFrom
        : (current?.expectedFrom ?? snapshot.expectedFrom),
    expectedTo: delivered
      ? null
      : windowFromSnapshot
        ? snapshot.expectedTo
        : (current?.expectedTo ?? snapshot.expectedTo),
    pickup: wholeTruth
      ? snapshot.pickup
      : setStatus
        ? snapshot.pickup || (current?.pickup ?? false)
        : (current?.pickup ?? snapshot.pickup),
    pickupPoint: wholeTruth
      ? snapshot.pickupPoint
      : prefer(snapshot.pickupPoint, current?.pickupPoint),
    url: prefer(snapshot.url, current?.url),
    sender: prefer(snapshot.sender, current?.sender),
    receiver: prefer(snapshot.receiver, current?.receiver),
    weightKg: prefer(snapshot.weightKg, current?.weightKg),
  };
}
