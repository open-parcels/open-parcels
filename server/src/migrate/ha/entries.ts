import { z } from "zod";
import type { ConnectionKind } from "../../engine/connections.js";
import { asArray, asObject, isObject } from "../../provider/kit/json.js";
import { text } from "../shared.js";

/**
 * Turns the config entries of the Home Assistant parcel suite into open-parcels connection plans.
 * Pure: reads the parsed `core.config_entries` file, touches no database. `import.ts` writes the
 * plans.
 */

/** One config entry, as the importer needs it. */
interface HaEntry {
  readonly entryId: string;
  readonly domain: string;
  readonly title: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly options: Readonly<Record<string, unknown>>;
  readonly disabled: boolean;
}

interface ParcelPlan {
  readonly trackingNumber: string;
  readonly direction: "receiving" | "sending";
}

/** Where an entry's codes are tracked: by the entry's own connection, or by DHL's tracking connection. */
type ParcelTarget = "self" | "dhl_tracking";

export interface ConnectionPlan {
  readonly entryId: string;
  readonly domain: string;
  readonly provider: string;
  readonly kind: ConnectionKind;
  /** The HA entry title, so the HA integration's devices keep their names and entity ids. */
  readonly label: string;
  readonly config: Readonly<Record<string, unknown>>;
  /** Encrypted into `secret_blob`; null when the connection needs none. */
  readonly secret: unknown;
  /** Encrypted into `session_blob`; null when there is nothing to carry over. */
  readonly session: unknown;
  readonly state: "ok" | "needs_sign_in";
  /** For the import report only: why the connection needs a sign-in (not stored). */
  readonly signInNote: string | null;
  readonly parcels: readonly ParcelPlan[];
  readonly parcelTarget: ParcelTarget;
  /** HA settings with no open-parcels equivalent: names only, never values. */
  readonly notCarriedOver: readonly string[];
}

type EntryPlan =
  | { readonly type: "connection"; readonly plan: ConnectionPlan }
  | { readonly type: "covered"; readonly entry: HaEntry; readonly reason: string }
  | { readonly type: "skipped"; readonly entry: HaEntry; readonly reason: string }
  | { readonly type: "unrecognised"; readonly entry: HaEntry };

const entrySchema = z.object({
  entry_id: z.string().min(1),
  domain: z.string().min(1),
  title: z.string().nullish(),
  data: z.record(z.string(), z.unknown()).nullish(),
  options: z.record(z.string(), z.unknown()).nullish(),
  disabled_by: z.string().nullish(),
});

const fileSchema = z.object({
  data: z.object({ entries: z.array(z.unknown()) }),
});

/** The entries of HA's `.storage/core.config_entries`; entries without an id are dropped. */
export function parseConfigEntries(raw: unknown): HaEntry[] {
  const file = fileSchema.safeParse(raw);
  if (!file.success) {
    throw new Error("This is not Home Assistant's core.config_entries file (no data.entries).");
  }
  const entries: HaEntry[] = [];
  for (const item of file.data.data.entries) {
    const parsed = entrySchema.safeParse(item);
    if (!parsed.success) {
      continue;
    }
    const entry = parsed.data;
    entries.push({
      entryId: entry.entry_id,
      domain: entry.domain,
      title: entry.title ?? "",
      data: entry.data ?? {},
      options: entry.options ?? {},
      disabled: entry.disabled_by !== null && entry.disabled_by !== undefined,
    });
  }
  return entries;
}

/** Retention, history and polling settings the engine handles on its own terms. */
const ENGINE_OPTIONS = [
  "delivered_filter_type",
  "delivered_filter_amount",
  "include_history",
  "live_tracking",
  "hand_off",
];

function notCarried(options: Readonly<Record<string, unknown>>, keys: readonly string[]): string[] {
  return keys.filter((key) => key in options).sort();
}

/** Codes from a list of strings or of `{<key>: code, direction?}` objects; duplicates dropped. */
function codes(value: unknown, key: string): ParcelPlan[] {
  const seen = new Map<string, ParcelPlan>();
  for (const item of asArray(value)) {
    const record = isObject(item) ? item : null;
    const trackingNumber = text(record === null ? item : record[key])
      ?.replace(/\s+/g, "")
      .toUpperCase();
    if (trackingNumber === undefined || seen.has(trackingNumber)) {
      continue;
    }
    const direction = record?.["direction"] === "outgoing" ? "sending" : "receiving";
    seen.set(trackingNumber, { trackingNumber, direction });
  }
  return [...seen.values()];
}

type Base = Pick<ConnectionPlan, "entryId" | "domain" | "label">;

function base(entry: HaEntry, fallback: string): Base {
  return { entryId: entry.entryId, domain: entry.domain, label: entry.title || fallback };
}

function signedIn(): Pick<ConnectionPlan, "state" | "signInNote"> {
  return { state: "ok", signInNote: null };
}

function needsSignIn(detail: string): Pick<ConnectionPlan, "state" | "signInNote"> {
  return { state: "needs_sign_in", signInNote: detail };
}

/**
 * Which storefronts and device serials the provider accepts is the provider's own schema's
 * business: the importer checks every plan against it (`planProblem`, `fittingSecret`), so it
 * keeps no copy of them (OP-139).
 */
function amazonPlan(entry: HaEntry): EntryPlan {
  const storefront = text(entry.data["country"])?.toLowerCase() ?? null;
  if (storefront === null) {
    return { type: "skipped", entry, reason: "The Home Assistant entry names no storefront." };
  }
  const refreshToken = text(entry.data["refresh_token"]);
  const deviceSerial = text(entry.data["device_serial"])?.toUpperCase() ?? null;
  const usable = refreshToken !== null && deviceSerial !== null;
  return {
    type: "connection",
    plan: {
      ...base(entry, `Amazon (${storefront})`),
      provider: "amazon",
      kind: "shop",
      config: { storefront },
      secret: usable ? { refreshToken, deviceSerial } : null,
      session: null,
      ...(usable
        ? signedIn()
        : needsSignIn("The Home Assistant entry holds no usable device registration; sign in.")),
      parcels: [],
      parcelTarget: "self",
      notCarriedOver: notCarried(entry.options, ENGINE_OPTIONS),
    },
  };
}

function dhlAccountPlan(entry: HaEntry): EntryPlan {
  const country = text(entry.data["country"])?.toUpperCase() ?? "DE";
  const parcels = codes(entry.options["tracked_codes"], "tracking_code");
  const common = {
    provider: "dhl",
    kind: "account" as const,
    session: null,
    parcels,
    parcelTarget: "dhl_tracking" as const,
    notCarriedOver: notCarried(entry.options, ENGINE_OPTIONS),
  };
  if (country === "PL") {
    return {
      type: "connection",
      plan: {
        ...base(entry, "Poland"),
        ...common,
        config: { account: "pl" },
        secret: null,
        ...needsSignIn("The Mój DHL session from Home Assistant cannot be carried over; sign in."),
        notCarriedOver: [...common.notCarriedOver, "pl_cookies", "pl_device_id"].sort(),
      },
    };
  }
  if (country !== "DE") {
    return {
      type: "skipped",
      entry,
      reason: `No DHL account connection for the country ${country}.`,
    };
  }
  const refreshToken = text(entry.data["refresh_token"]);
  return {
    type: "connection",
    plan: {
      ...base(entry, "Germany"),
      ...common,
      config: { account: "de" },
      secret: refreshToken === null ? null : { refreshToken },
      ...(refreshToken === null
        ? needsSignIn("The Home Assistant entry holds no DHL refresh token; sign in.")
        : signedIn()),
    },
  };
}

function dhlPlan(entry: HaEntry): EntryPlan {
  const kind = text(entry.data["source"]) ?? "account";
  if (kind === "account") {
    return dhlAccountPlan(entry);
  }
  if (kind !== "tracking") {
    return {
      type: "skipped",
      entry,
      reason: `DHL "${kind}" entries are not imported; add the connection by hand.`,
    };
  }
  return {
    type: "connection",
    plan: {
      ...base(entry, "DHL tracking"),
      provider: "dhl",
      kind: "tracking",
      config: {},
      secret: null,
      session: null,
      ...signedIn(),
      parcels: codes(entry.options["parcels"], "tracking_code"),
      parcelTarget: "self",
      notCarriedOver: notCarried(entry.options, ENGINE_OPTIONS),
    },
  };
}

function glsSession(entry: HaEntry, country: string): unknown {
  const instanceId = text(entry.data["de_app_instance_id"]);
  if (country !== "DE" || instanceId === null) {
    return null;
  }
  // The parcel numbers GLS Germany assigned, so adding a known code again never hits its 409.
  const parcels: Record<string, string> = {};
  for (const item of asArray(entry.options["parcels"])) {
    const record = asObject(item);
    const code = text(record["parcel_no"])?.replace(/\s+/g, "").toUpperCase();
    const number = text(record["de_parcel_number"]);
    if (code !== undefined && number !== null) {
      parcels[code] = number;
    }
  }
  // Token null: the next run validates the instance and gets a fresh token, registering nothing.
  return { de: { instanceId, token: null, expiresAt: null, parcels } };
}

function glsPlan(entry: HaEntry): EntryPlan {
  const country = text(entry.options["country"] ?? entry.data["country"])?.toUpperCase() ?? "NL";
  const postalCode = text(entry.options["postal_code"] ?? entry.data["postal_code"]);
  if (postalCode === null) {
    return { type: "skipped", entry, reason: "The GLS entry has no postcode." };
  }
  const parcels = codes(entry.options["parcels"], "parcel_no");
  const postcodes = new Set<string>();
  for (const item of asArray(entry.options["parcels"])) {
    const own = asObject(item);
    postcodes.add(text(own["postal_code"]) ?? postalCode);
  }
  const extra = postcodes.size > 1 ? ["per-parcel postal_code"] : [];
  return {
    type: "connection",
    plan: {
      ...base(entry, `GLS ${country}`),
      provider: "gls",
      kind: "tracking",
      config: { country, postalCode },
      secret: null,
      session: glsSession(entry, country),
      ...signedIn(),
      parcels,
      parcelTarget: "self",
      notCarriedOver: [...notCarried(entry.options, ENGINE_OPTIONS), ...extra],
    },
  };
}

function hermesPlan(entry: HaEntry): EntryPlan {
  const kind = text(entry.data["source"]) ?? "account";
  const common = {
    provider: "hermes",
    config: {},
    parcelTarget: "self" as const,
    notCarriedOver: notCarried(entry.options, ENGINE_OPTIONS),
  };
  if (kind === "tracking") {
    return {
      type: "connection",
      plan: {
        ...base(entry, "Hermes"),
        ...common,
        kind: "tracking",
        secret: null,
        session: null,
        ...signedIn(),
        parcels: codes(entry.options["parcels"], "tracking_code"),
      },
    };
  }
  const username = text(entry.data["username"]);
  const accessToken = text(entry.data["access_token"]);
  const refreshToken = text(entry.data["refresh_token"]);
  const tokens =
    accessToken === null || refreshToken === null ? null : { accessToken, refreshToken };
  const usable = username !== null && tokens !== null;
  return {
    type: "connection",
    plan: {
      ...base(entry, "Hermes account"),
      ...common,
      kind: "account",
      // No password: HA never stored one. The tokens carry the connection until Hermes refuses them.
      secret: username === null ? null : { username },
      session: usable ? tokens : null,
      ...(usable
        ? signedIn()
        : needsSignIn("Credentials missing: the Home Assistant entry holds no Hermes tokens.")),
      parcels: [],
    },
  };
}

/** The plan for one entry. */
export function planEntry(entry: HaEntry): EntryPlan {
  if (entry.disabled) {
    return { type: "skipped", entry, reason: "Disabled in Home Assistant." };
  }
  switch (entry.domain) {
    case "amazon_orders":
      return amazonPlan(entry);
    case "dhl":
      return dhlPlan(entry);
    case "gls":
      return glsPlan(entry);
    case "hermes":
      return hermesPlan(entry);
    case "parcel_aggregator":
      return {
        type: "covered",
        entry,
        reason: "The open-parcels engine aggregates parcels itself.",
      };
    default:
      return { type: "unrecognised", entry };
  }
}
