import type { FetchResult, ProviderLogger } from "../provider/api.js";
import type { ParcelSnapshot } from "../provider/snapshot.js";

/** The warning logged when a provider files an answer under anything but a tracked code. */
export const NOT_FILED_AS_TRACKED = "A lookup answer was not filed under the tracked code.";

/** A code's comparable form: upper case, without spaces, dashes or dots. */
function canonical(code: string): string {
  return code.toUpperCase().replace(/[\s.-]/gu, "");
}

function refiled(found: ParcelSnapshot, tracked: string): ParcelSnapshot {
  // An empty echo or the same code spelled differently is no reference of its own (OP-100).
  const echo = found.trackingNumber.trim();
  const ownNumber = echo !== "" && canonical(echo) !== canonical(tracked);
  return {
    ...found,
    trackingNumber: tracked,
    externalRef: found.externalRef ?? (ownNumber ? echo : null),
  };
}

/**
 * Files every answer of a lookup under the code that was asked for. A provider should do this
 * itself (`trackEach` does); this is the host's safety net, so a carrier echoing its own number
 * can never make the tracked code read as not found and add a second parcel. An answer that
 * matches no asked code is filed under the only code when one was asked, and dropped otherwise.
 * Every correction is logged, so a provider that relies on it shows up in its tests.
 */
export function fileUnderTracked(
  providerId: string,
  trackingNumbers: readonly string[],
  result: FetchResult,
  logger: ProviderLogger,
): FetchResult {
  // A provider that asked for only some codes this run names them; its answers belong to those.
  const really = result.asked?.filter((code) => trackingNumbers.includes(code)) ?? trackingNumbers;
  const asked = new Set(really);
  const byCanonical = new Map(really.map((code) => [canonical(code), code]));
  const only = asked.size === 1 ? really[0] : undefined;
  const snapshots: ParcelSnapshot[] = [];
  for (const found of result.snapshots) {
    if (found.handoff !== null || asked.has(found.trackingNumber)) {
      snapshots.push(found);
      continue;
    }
    const tracked =
      byCanonical.get(canonical(found.trackingNumber)) ??
      (found.externalRef !== null ? byCanonical.get(canonical(found.externalRef)) : undefined) ??
      only;
    logger.warn({ provider: providerId, filedAs: tracked ?? null }, NOT_FILED_AS_TRACKED);
    if (tracked !== undefined) {
      snapshots.push(refiled(found, tracked));
    }
  }
  return { ...result, snapshots };
}
