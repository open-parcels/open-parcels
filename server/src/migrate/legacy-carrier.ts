import { findCarrier, loadRules } from "open-parcels-rules";
import { BUILTIN_CARRIERS } from "../engine/builtin-carriers.js";
import { detectCarrier, isProvider, trackable } from "../engine/detect.js";
import { text } from "./shared.js";

/**
 * Old courier values that name no carrier: the old app's placeholders, aggregators it looked
 * codes up through, and the country it guessed from the code.
 */
const GENERIC_COURIERS: ReadonlySet<string> = new Set([
  "",
  "unknown",
  "other",
  "none",
  "auto",
  "china",
  "17track",
  "seventeen_track",
  "aliexpress",
]);

/** Shops whose parcels go through one logistics network when nothing else identifies the carrier. */
const SHOP_CARRIER: Readonly<Record<string, string>> = {
  aliexpress: "cainiao",
  amazon: "amazon",
};

const UNKNOWN = "unknown";

/** Lower-case, accent-free, words joined by `_`: the shape of every provider id. */
function snakeCase(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

let providersByName: ReadonlyMap<string, string> | undefined;

/** Built-in provider ids by the snake_case of their display name, e.g. `box_now` for "BOX NOW". */
function providerIdByName(name: string): string | undefined {
  providersByName ??= new Map(
    BUILTIN_CARRIERS.map(({ info }) => [snakeCase(info.name), info.id] as const),
  );
  return providersByName.get(snakeCase(name));
}

/**
 * The provider id for an old courier name such as "DHL", "Canada Post" or "Swiss Post": the
 * shared rules' name or alias first, then a built-in provider's display name, else snake_case.
 * Names that identify no carrier ("china", "17track") give "unknown".
 */
export function carrierId(courier: unknown): string {
  const name = text(courier);
  if (name === null || GENERIC_COURIERS.has(snakeCase(name))) {
    return UNKNOWN;
  }
  const id = findCarrier(loadRules(), name)?.id ?? providerIdByName(name) ?? snakeCase(name);
  return id === "" || GENERIC_COURIERS.has(id) ? UNKNOWN : id;
}

/** True when `next` is a provider id that should replace a stored id no provider serves. */
export function fixesCarrier(stored: string, next: string): boolean {
  return stored !== next && !isProvider(stored) && isProvider(next);
}

export interface LegacyCarrierInput {
  /** The old `courier` column, possibly empty or generic. */
  readonly courier: unknown;
  readonly trackingNumber: string;
  /** The old order's `connection` (shop), when the parcel belonged to one. */
  readonly shop: string | null;
}

/**
 * Resolves an old parcel to a provider id, in order: the named courier when a provider tracks it;
 * the code's format by the shared detection (with the named courier as a hint); the shop's own
 * network (AliExpress → Cainiao, Amazon → Amazon); a named carrier no provider tracks yet, kept so a
 * later provider picks it up; otherwise "unknown".
 */
export function resolveLegacyCarrier(input: LegacyCarrierInput): string {
  const named = carrierId(input.courier);
  const namedProvider = named === UNKNOWN ? undefined : trackable(named);
  if (namedProvider !== undefined) {
    return namedProvider;
  }
  const detected = detectCarrier(
    input.trackingNumber,
    named === UNKNOWN ? null : text(input.courier),
  );
  if (detected !== undefined) {
    return detected;
  }
  const shopKey = input.shop === null ? null : snakeCase(input.shop);
  // Own entries only: text from the old database must not find inherited names (OP-134).
  const shop =
    shopKey !== null && Object.hasOwn(SHOP_CARRIER, shopKey) ? SHOP_CARRIER[shopKey] : undefined;
  if (shop !== undefined) {
    return shop;
  }
  // "china" names a country, not a carrier, but the old app used it for Chinese postal codes.
  if (snakeCase(text(input.courier) ?? "") === "china") {
    return trackable("china_post") ?? UNKNOWN;
  }
  return named;
}
