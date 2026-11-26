import path from "node:path";
import { z } from "zod";
import { isValidTimeZone } from "./engine/tz.js";
import {
  BASE_LAYER_CHOICES,
  OVERLAY_CHOICES,
  templateProblem,
  wmtsBaseProblem,
  type BuiltinUrls,
  type CustomProvider,
} from "./tiles/layers.js";
import { NOMINATIM_SEARCH } from "./geo/geocoder.js";
import { TILE_MAX_ZOOM_ANY } from "./tiles/proxy.js";

/**
 * Where the built-in providers run (`docs/provider-manifest-and-sandbox.md` §2): `off` in the
 * server's own process, `pool` in one sandbox child shared by all of them.
 */
const PROVIDER_ISOLATION = ["off", "pool"] as const;
type ProviderIsolation = (typeof PROVIDER_ISOLATION)[number];

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;

const booleanFlag = z
  .enum(["true", "false", "1", "0", "yes", "no"])
  .transform((value) => value === "true" || value === "1" || value === "yes");

const port = z.coerce.number().int().min(1).max(65535);

/** A tile URL template ({z}, {x}, {y}, optional {s}, {r}, {key}), checked like the custom one. */
const tileTemplate = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .superRefine((value, context) => {
    const problem = templateProblem(value);
    if (problem !== null) context.addIssue({ code: "custom", message: problem });
  })
  .optional();

/**
 * How a change made in the UI takes effect:
 * - `env`: only from the environment, because it is needed before the database (where UI changes
 *   are kept) opens, or because a wrong value would lock the UI out that could undo it.
 * - `restart`: saved now, used from the next start on.
 * - `live`: used at once by the running server.
 */
export type ApplyMode = "env" | "restart" | "live";
export type SettingValue = string | number | boolean;
export type SettingKind = "string" | "number" | "boolean";

/** Setting groups, by id: each is a card on the Settings page, its name a web UI text. */
export const SETTING_GROUPS = [
  "storage",
  "server",
  "security",
  "tracking",
  "retention",
  "backups",
  "map",
] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

interface SettingDef<S extends z.ZodType<SettingValue | undefined>> {
  readonly group: SettingGroup;
  readonly description: string;
  /** Parses the text form of the value, as it comes from the environment. */
  readonly schema: S;
  /** Used when the environment does not set the variable; undefined means unset. */
  readonly default: z.output<S>;
  readonly apply: ApplyMode;
  readonly kind: SettingKind;
  /** The value never leaves the server. */
  readonly secret?: boolean;
  /**
   * Changed in the UI through its own form, never the generic settings editor: the admin password
   * needs the current one and is saved hashed.
   */
  readonly ownForm?: boolean;
  readonly choices?: readonly string[];
}

/** Shortest admin password accepted, from the environment or the UI. */
export const MIN_ADMIN_PASSWORD = 10;
const MAX_PASSWORD = 256;

function setting<S extends z.ZodType<SettingValue | undefined>>(def: SettingDef<S>): SettingDef<S> {
  return def;
}

/**
 * Every environment variable the server reads, prefixed with OPENPARCELS_ so the container never
 * picks up unrelated variables by accident. The environment is the base layer (the Home Assistant
 * app passes its options this way); values saved on the Settings page win over it until reset.
 */
export const SETTINGS = {
  OPENPARCELS_DATA_DIR: setting({
    group: "storage",
    description: "Folder for the database, encryption key and caches.",
    schema: z.string().min(1),
    default: "/data",
    apply: "env",
    kind: "string",
  }),
  OPENPARCELS_SECRET_KEY: setting({
    group: "storage",
    description:
      "Base64 of 32 random bytes that encrypts stored credentials. Unset uses a key file in the data folder.",
    schema: z.string().min(1).optional(),
    default: undefined,
    apply: "env",
    kind: "string",
    secret: true,
  }),
  OPENPARCELS_WEB_DIR: setting({
    group: "server",
    description:
      "Folder with the built web UI. Unset uses web/dist next to the server; missing means API only.",
    schema: z.string().min(1).optional(),
    default: undefined,
    apply: "env",
    kind: "string",
  }),
  OPENPARCELS_HOST: setting({
    group: "server",
    description: "Address the server listens on.",
    schema: z.string().min(1),
    default: "0.0.0.0",
    apply: "env",
    kind: "string",
  }),
  OPENPARCELS_PORT: setting({
    group: "server",
    description: "Port of the web UI and API.",
    schema: port,
    default: 3000,
    apply: "env",
    kind: "number",
  }),
  OPENPARCELS_INGRESS_PORT: setting({
    group: "server",
    description: "Port of the separate Home Assistant ingress listener. Unset disables it.",
    schema: port.optional(),
    default: undefined,
    apply: "env",
    kind: "number",
  }),
  OPENPARCELS_TRUST_PROXY: setting({
    group: "server",
    description:
      "Reverse proxies whose X-Forwarded-For is believed, so the sign-in throttle sees real client addresses: comma-separated addresses or CIDR ranges. Unset trusts nobody; never list addresses clients could connect from directly.",
    schema: z
      .string()
      .trim()
      .min(1)
      .refine(
        (value) => value.split(",").every((part) => /^[\da-f.:]+(\/\d+)?$/i.test(part.trim())),
        "List proxy addresses or CIDR ranges, separated by commas.",
      )
      .optional(),
    default: undefined,
    apply: "restart",
    kind: "string",
  }),
  OPENPARCELS_CORS_ORIGINS: setting({
    group: "security",
    description:
      "Web pages on other addresses that may call the API, e.g. a web UI hosted elsewhere: exact origins (https://parcels-ui.example), separated by commas. They log in with tokens, never cookies. Unset allows none; * is never accepted.",
    schema: z
      .string()
      .trim()
      .min(1)
      .refine(
        (value) => value.split(",").every((part) => isOrigin(part.trim())),
        "List exact origins such as https://parcels-ui.example, separated by commas.",
      )
      .optional(),
    default: undefined,
    apply: "live",
    kind: "string",
  }),
  OPENPARCELS_SECURE_COOKIES: setting({
    group: "server",
    description:
      "Mark session cookies Secure. Turn on when served over HTTPS only. Environment only: " +
      "turned on over plain HTTP it would block the sign-in needed to turn it off again.",
    schema: booleanFlag,
    default: false,
    apply: "env",
    kind: "boolean",
  }),
  OPENPARCELS_ADMIN_PASSWORD: setting({
    group: "security",
    description:
      "Password to change anything: connections, parcels, orders, settings, tokens. A password changed on the Settings page replaces it until reset. Unset and never changed there: the first start asks for a setup code from the log.",
    schema: z.string().min(MIN_ADMIN_PASSWORD).max(MAX_PASSWORD).optional(),
    default: undefined,
    apply: "env",
    kind: "string",
    secret: true,
    ownForm: true,
  }),
  OPENPARCELS_PASSWORD: setting({
    group: "security",
    description:
      "Password to read: the web UI, the API, live updates, maps and images. Empty lets anyone who can reach the server read everything; changes always need the admin password.",
    schema: z.string().max(MAX_PASSWORD),
    default: "",
    apply: "live",
    kind: "string",
    secret: true,
  }),
  OPENPARCELS_PUBLIC_URL: setting({
    group: "server",
    description: "Public base URL, used for links in calendar feeds.",
    schema: z.url().optional(),
    default: undefined,
    apply: "live",
    kind: "string",
  }),
  OPENPARCELS_LOG_LEVEL: setting({
    group: "server",
    description: "How much the server logs.",
    schema: z.enum(LOG_LEVELS),
    default: "info",
    apply: "live",
    kind: "string",
    choices: LOG_LEVELS,
  }),
  OPENPARCELS_TIMEZONE: setting({
    group: "tracking",
    description:
      "IANA time zone (e.g. Europe/Berlin) for the night-time quiet window, mail dates and calendar days. Unset uses TZ / the system zone.",
    schema: z
      .string()
      .min(1)
      .refine(isValidTimeZone, "Unknown time zone; use an IANA name like Europe/Berlin.")
      .optional(),
    default: undefined,
    apply: "restart",
    kind: "string",
  }),
  OPENPARCELS_QUIET_WINDOW: setting({
    group: "tracking",
    description: "Pause carrier polling 00:00–06:00 local time. Turn off to poll all night.",
    schema: booleanFlag,
    default: true,
    apply: "live",
    kind: "boolean",
  }),
  OPENPARCELS_EMAIL_ROUTING: setting({
    group: "tracking",
    description:
      "Hand emails from a provider's own sender domains to that provider, once the receiving mail server confirmed the sender (DKIM or DMARC). Off: the shared email rules read every email.",
    schema: booleanFlag,
    default: true,
    apply: "live",
    kind: "boolean",
  }),
  OPENPARCELS_PROVIDER_ISOLATION: setting({
    group: "tracking",
    description:
      "Where the built-in providers run: off runs them in the server's own process; pool runs them together in one separate process under Node's permission model, which reaches the network, the sign-in data and the sessions only through the server, one call at a time. Pool costs one more process (about 60 MB).",
    schema: z.enum(PROVIDER_ISOLATION),
    default: "off",
    apply: "env",
    kind: "string",
    choices: PROVIDER_ISOLATION,
  }),
  OPENPARCELS_PROVIDERS_REMOTE: setting({
    group: "tracking",
    description:
      "Read the registry, search GitHub for community items and install or update providers, themes and consumers from git repositories. Off: nothing is fetched, for air-gapped installs; the built-in ones keep working.",
    schema: booleanFlag,
    default: true,
    apply: "env",
    kind: "boolean",
  }),
  OPENPARCELS_PROVIDERS_COMMUNITY: setting({
    group: "tracking",
    description:
      "List community items on the Providers page: GitHub repositories with the topic open-parcels-provider, which nobody at open-parcels has reviewed. They are marked and installing one asks first.",
    schema: booleanFlag,
    default: true,
    apply: "env",
    kind: "boolean",
  }),
  OPENPARCELS_REGISTRY_URL: setting({
    group: "tracking",
    description:
      "Where the signed registry index (index.json and index.json.sig) is read from; a mirror works, since only the signature counts.",
    schema: z.url({ protocol: /^https$/, error: "Use an https address." }),
    default: "https://raw.githubusercontent.com/open-parcels/open-parcels-registry/main/",
    apply: "env",
    kind: "string",
  }),
  OPENPARCELS_ARCHIVE_DAYS: setting({
    group: "retention",
    description:
      "Days after delivery before a parcel is archived and its raw carrier data dropped.",
    schema: z.coerce.number().int().min(1).max(3650),
    default: 30,
    apply: "live",
    kind: "number",
  }),
  OPENPARCELS_DELETE_DAYS: setting({
    group: "retention",
    description:
      "Days after archiving before a parcel, its history and raw carrier data are deleted; 0 never (the default). Deleting by hand is always possible on the Data page.",
    schema: z.coerce.number().int().min(0).max(36500),
    default: 0,
    apply: "live",
    kind: "number",
  }),
  OPENPARCELS_NOT_FOUND_ARCHIVE_DAYS: setting({
    group: "retention",
    description:
      "Days a carrier may answer “not found” for an undelivered parcel before it is archived; 0 never.",
    schema: z.coerce.number().int().min(0).max(3650),
    default: 30,
    apply: "live",
    kind: "number",
  }),
  OPENPARCELS_BACKUP_HOURS: setting({
    group: "backups",
    description:
      "Hours between automatic database backups, taken while the server runs; 0 turns them off. Back up now on the Settings page works either way.",
    schema: z.coerce.number().int().min(0).max(8760),
    default: 24,
    apply: "live",
    kind: "number",
  }),
  OPENPARCELS_BACKUP_KEEP: setting({
    group: "backups",
    description:
      "How many database backups to keep; the oldest are deleted after each new one. Counts every backup in the folder, also those taken by hand or before deleting everything.",
    schema: z.coerce.number().int().min(1).max(1000),
    default: 7,
    apply: "live",
    kind: "number",
  }),
  OPENPARCELS_BACKUP_DIR: setting({
    group: "backups",
    description:
      "Folder for database backups. Unset uses backups/ in the data folder; point it at another volume to keep backups off the disk the database is on. The encryption key is not part of a backup: keep a copy of it (secret.key in the data folder, or OPENPARCELS_SECRET_KEY) as well.",
    schema: z.string().trim().min(1).max(1000).optional(),
    default: undefined,
    apply: "live",
    kind: "string",
  }),
  OPENPARCELS_MAP_BASE_LAYER: setting({
    group: "map",
    description:
      "Map style shown until a user picks another on the map: map, topographic, satellite, borders only, a CARTO style (needs the CARTO key), or the custom provider.",
    schema: z.enum(BASE_LAYER_CHOICES),
    default: "osm",
    apply: "live",
    kind: "string",
    choices: BASE_LAYER_CHOICES,
  }),
  OPENPARCELS_MAP_OVERLAY: setting({
    group: "map",
    description: "Overlay drawn over the map style by default; labels suit satellite imagery.",
    schema: z.enum(OVERLAY_CHOICES),
    default: "none",
    apply: "live",
    kind: "string",
    choices: OVERLAY_CHOICES,
  }),
  OPENPARCELS_GEOCODING: setting({
    group: "map",
    description:
      "Background place lookup: look up the places named in carrier scans with the place search service below (OpenStreetMap Nominatim unless changed), so scans without coordinates still show on the map. This sends those place names (never codes or addresses of yours) to that service, one a second at most. Off by default; the address search on the Settings page works either way.",
    schema: booleanFlag,
    default: false,
    apply: "live",
    kind: "boolean",
  }),
  OPENPARCELS_GEOCODING_URL: setting({
    group: "map",
    description:
      "Search endpoint of a Nominatim-compatible place search service (`/search?q=…&format=jsonv2`), e.g. your own Nominatim. Used by the address search and the background place lookup. The public OpenStreetMap server allows at most one request a second and no heavy use.",
    schema: z.url({ protocol: /^https?$/, error: "Use an http or https address." }),
    default: NOMINATIM_SEARCH,
    apply: "live",
    kind: "string",
  }),
  OPENPARCELS_CONTACT_EMAIL: setting({
    group: "map",
    description:
      "Optional contact address added to the User-Agent sent to the place search and tile servers, so their operators can reach you instead of blocking this install.",
    schema: z.email().max(200).optional(),
    default: undefined,
    apply: "live",
    kind: "string",
  }),
  OPENPARCELS_MAP_CARTO_KEY: setting({
    group: "map",
    description:
      "CARTO API key (free for non-commercial use at carto.com/basemaps/apikey). Unlocks the CARTO styles: Dark Matter (the pre-rewrite look), Positron and Voyager. Stays on the server.",
    schema: z.string().trim().min(1).max(500).optional(),
    default: undefined,
    apply: "live",
    kind: "string",
    secret: true,
  }),
  OPENPARCELS_MAP_OSM_URL: setting({
    group: "map",
    description:
      "Tile address of the plain map layer, default https://tile.openstreetmap.org/{z}/{x}/{y}.png. Point it at a mirror or your own tile server if the public one is unsuitable.",
    schema: tileTemplate,
    default: undefined,
    apply: "live",
    kind: "string",
  }),
  OPENPARCELS_MAP_TOPO_URL: setting({
    group: "map",
    description:
      "Tile address of the topographic layer, default https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png.",
    schema: tileTemplate,
    default: undefined,
    apply: "live",
    kind: "string",
  }),
  OPENPARCELS_MAP_EOX_URL: setting({
    group: "map",
    description:
      "WMTS base address of the EOX layers (satellite, borders, labels), default https://tiles.maps.eox.at/wmts/1.0.0.",
    schema: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .superRefine((value, context) => {
        const problem = wmtsBaseProblem(value);
        if (problem !== null) context.addIssue({ code: "custom", message: problem });
      })
      .optional(),
    default: undefined,
    apply: "live",
    kind: "string",
  }),
  OPENPARCELS_MAP_CUSTOM_URL: setting({
    group: "map",
    description:
      "Custom tile provider, e.g. https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key={key}. Needs https and {z}, {x}, {y}; {s}, {r} and {key} are filled in by the server.",
    schema: tileTemplate,
    default: undefined,
    apply: "live",
    kind: "string",
  }),
  OPENPARCELS_MAP_CUSTOM_KEY: setting({
    group: "map",
    description: "API key for the custom provider's {key}. Stays on the server.",
    schema: z.string().trim().min(1).max(500).optional(),
    default: undefined,
    apply: "live",
    kind: "string",
    secret: true,
  }),
  OPENPARCELS_MAP_CUSTOM_ATTRIBUTION: setting({
    group: "map",
    description: "Credit shown on the map for the custom provider, as its terms require.",
    schema: z.string().trim().min(1).max(300).optional(),
    default: undefined,
    apply: "live",
    kind: "string",
  }),
  OPENPARCELS_MAP_CUSTOM_MAX_ZOOM: setting({
    group: "map",
    description: "Deepest zoom the custom provider serves; the map scales up beyond it.",
    schema: z.coerce.number().int().min(0).max(TILE_MAX_ZOOM_ANY),
    default: 19,
    apply: "live",
    kind: "number",
  }),
} as const;

export type SettingKey = keyof typeof SETTINGS;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];
export type SettingValues = {
  -readonly [K in SettingKey]: z.output<(typeof SETTINGS)[K]["schema"]>;
};

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTINGS, key);
}

/** Why a setting value was refused; clients show their own text per reason. */
export type SettingProblem =
  "unknown" | "own_form" | "env_only" | "required" | "too_short" | "wrong_type" | "invalid";

export interface SettingError {
  readonly key: string;
  readonly reason: SettingProblem;
  /** English, for logs and scripts. */
  readonly message: string;
  /** The validator's own words (`invalid`) or the minimum length (`too_short`). */
  readonly detail?: string;
  readonly min?: number;
}

export type ParseResult =
  | { readonly ok: true; readonly value: SettingValue | undefined }
  | { readonly ok: false; readonly error: SettingError };

/** Parses one value in its text form (environment) or typed form (saved in the UI). */
export function parseSetting(key: SettingKey, raw: unknown): ParseResult {
  if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") {
    return {
      ok: false,
      error: {
        key,
        reason: "wrong_type",
        message: `${key}: expected text, a number or true/false.`,
      },
    };
  }
  const parsed = SETTINGS[key].schema.safeParse(String(raw));
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => issue.message).join("; ");
    return { ok: false, error: { key, reason: "invalid", message: `${key}: ${detail}`, detail } };
  }
  return { ok: true, value: parsed.data };
}

/** The environment's values and whether each came from the environment or the default. */
export interface ParsedEnv {
  readonly values: Readonly<SettingValues>;
  readonly sources: Readonly<Record<SettingKey, EnvSource>>;
}

/** `app`: an option of the Home Assistant app, passed in as a variable. */
type EnvSource = "env" | "default" | "ha_app";

export function parseEnv(
  env: NodeJS.ProcessEnv,
  appOptions: ReadonlySet<string> = new Set(),
): ParsedEnv {
  const values: Record<string, unknown> = {};
  const sources: Record<string, EnvSource> = {};
  const problems: string[] = [];
  for (const key of SETTING_KEYS) {
    const raw = env[key];
    if (raw === undefined) {
      values[key] = SETTINGS[key].default;
      sources[key] = "default";
      continue;
    }
    const parsed = parseSetting(key, raw);
    if (parsed.ok) {
      values[key] = parsed.value;
      sources[key] = appOptions.has(key) ? "ha_app" : "env";
    } else {
      problems.push(parsed.error.message);
    }
  }
  if (problems.length > 0) {
    throw new ConfigError(`Invalid configuration: ${problems.join("; ")}.`);
  }
  // Every value came through its own schema or is its declared default.
  return {
    values: values as SettingValues,
    sources: sources as Record<SettingKey, EnvSource>,
  };
}

/** False, or the proxy addresses and ranges whose X-Forwarded-For is believed. */
export type TrustProxy = false | readonly string[];

/** `scheme://host[:port]` exactly as browsers send it in `Origin`: no path, no wildcard. */
function isOrigin(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value;
}

function parseTrustProxy(value: string | undefined): TrustProxy {
  return value === undefined ? false : value.split(",").map((part) => part.trim());
}

export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * The server's configuration. One object is shared by every service, and `ConfigSettings` rewrites
 * its live settings in place when they are saved: read a field when it is needed, never copy it.
 */
export interface AppConfig {
  /** The environment as parsed at start-up; the base layer under settings saved in the UI. */
  readonly env: ParsedEnv;
  readonly dataDir: string;
  readonly databasePath: string;
  readonly host: string;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly secretKey: string | undefined;
  readonly publicUrl: URL | undefined;
  readonly ingressPort: number | undefined;
  readonly secureCookies: boolean;
  /** From the environment; a password saved in the UI (hashed, in `owner`) wins over it. */
  readonly adminPassword: string | undefined;
  /** Empty: reading needs no sign-in. */
  readonly readerPassword: string;
  readonly timeZone: string;
  readonly quietWindow: boolean;
  /** Inboxes hand providers the emails of their sender domains (OPENPARCELS_EMAIL_ROUTING). */
  readonly emailRouting: boolean;
  /** Where the built-in providers run (OPENPARCELS_PROVIDER_ISOLATION). */
  readonly providerIsolation: ProviderIsolation;
  /** Installs from git repositories (OPENPARCELS_PROVIDERS_REMOTE, _COMMUNITY, REGISTRY_URL). */
  readonly installs: {
    readonly remote: boolean;
    readonly community: boolean;
    readonly registryUrl: string;
  };
  /** Background lookup of scan place names (OPENPARCELS_GEOCODING). */
  readonly geocoding: boolean;
  /** Nominatim-compatible search endpoint (OPENPARCELS_GEOCODING_URL). */
  readonly geocodingUrl: string;
  /** Added to the User-Agent sent to OpenStreetMap-style services; unset adds none. */
  readonly contactEmail: string | undefined;
  readonly webDir: string | undefined;
  readonly trustProxy: TrustProxy;
  /** Origins allowed to call the API from a browser (OPENPARCELS_CORS_ORIGINS). */
  readonly corsOrigins: readonly string[];
  readonly retention: {
    readonly archiveAfterDays: number;
    readonly deleteAfterDays: number;
    readonly rawAfterDays: number;
    readonly notFoundArchiveDays: number;
  };
  readonly backup: {
    /** 0: no automatic backups. */
    readonly intervalHours: number;
    readonly keep: number;
    /** Absolute; `<dataDir>/backups` unless set. */
    readonly directory: string;
  };
  readonly map: {
    readonly baseLayer: (typeof BASE_LAYER_CHOICES)[number];
    readonly overlay: (typeof OVERLAY_CHOICES)[number];
    /** Unset without a template. */
    readonly custom: CustomProvider | undefined;
    /** Unlocks the CARTO styles; unset hides them. */
    readonly cartoKey: string | undefined;
    /** Other addresses for the built-in layers; unset keeps the providers' own. */
    readonly builtinUrls: BuiltinUrls;
  };
}

/** `AppConfig` as its one writer, `ConfigSettings`, sees it. */
export type LiveAppConfig = { -readonly [K in keyof AppConfig]: AppConfig[K] };

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

/** Builds the config the server reads from a full set of setting values. */
export function toConfig(values: Readonly<SettingValues>, env: ParsedEnv): AppConfig {
  const dataDir = path.resolve(values.OPENPARCELS_DATA_DIR);
  return {
    env,
    dataDir,
    databasePath: path.join(dataDir, "openparcels.db"),
    host: values.OPENPARCELS_HOST,
    port: values.OPENPARCELS_PORT,
    logLevel: values.OPENPARCELS_LOG_LEVEL,
    secretKey: values.OPENPARCELS_SECRET_KEY,
    publicUrl:
      values.OPENPARCELS_PUBLIC_URL === undefined
        ? undefined
        : new URL(values.OPENPARCELS_PUBLIC_URL),
    ingressPort: values.OPENPARCELS_INGRESS_PORT,
    secureCookies: values.OPENPARCELS_SECURE_COOKIES,
    adminPassword: values.OPENPARCELS_ADMIN_PASSWORD,
    readerPassword: values.OPENPARCELS_PASSWORD,
    timeZone: values.OPENPARCELS_TIMEZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    quietWindow: values.OPENPARCELS_QUIET_WINDOW,
    emailRouting: values.OPENPARCELS_EMAIL_ROUTING,
    providerIsolation: values.OPENPARCELS_PROVIDER_ISOLATION,
    installs: {
      remote: values.OPENPARCELS_PROVIDERS_REMOTE,
      community: values.OPENPARCELS_PROVIDERS_COMMUNITY,
      registryUrl: values.OPENPARCELS_REGISTRY_URL,
    },
    geocoding: values.OPENPARCELS_GEOCODING,
    geocodingUrl: values.OPENPARCELS_GEOCODING_URL,
    contactEmail: values.OPENPARCELS_CONTACT_EMAIL,
    webDir:
      values.OPENPARCELS_WEB_DIR === undefined
        ? undefined
        : path.resolve(values.OPENPARCELS_WEB_DIR),
    trustProxy: parseTrustProxy(values.OPENPARCELS_TRUST_PROXY),
    corsOrigins:
      values.OPENPARCELS_CORS_ORIGINS === undefined
        ? []
        : values.OPENPARCELS_CORS_ORIGINS.split(",").map((part) => part.trim()),
    retention: {
      archiveAfterDays: values.OPENPARCELS_ARCHIVE_DAYS,
      deleteAfterDays: values.OPENPARCELS_DELETE_DAYS,
      rawAfterDays: values.OPENPARCELS_ARCHIVE_DAYS,
      notFoundArchiveDays: values.OPENPARCELS_NOT_FOUND_ARCHIVE_DAYS,
    },
    backup: {
      intervalHours: values.OPENPARCELS_BACKUP_HOURS,
      keep: values.OPENPARCELS_BACKUP_KEEP,
      directory: path.resolve(dataDir, values.OPENPARCELS_BACKUP_DIR ?? "backups"),
    },
    map: {
      baseLayer: values.OPENPARCELS_MAP_BASE_LAYER,
      overlay: values.OPENPARCELS_MAP_OVERLAY,
      custom:
        values.OPENPARCELS_MAP_CUSTOM_URL === undefined
          ? undefined
          : {
              url: values.OPENPARCELS_MAP_CUSTOM_URL,
              apiKey: values.OPENPARCELS_MAP_CUSTOM_KEY,
              attribution: values.OPENPARCELS_MAP_CUSTOM_ATTRIBUTION,
              maxZoom: values.OPENPARCELS_MAP_CUSTOM_MAX_ZOOM,
            },
      cartoKey: values.OPENPARCELS_MAP_CARTO_KEY,
      builtinUrls: {
        osm: values.OPENPARCELS_MAP_OSM_URL,
        topo: values.OPENPARCELS_MAP_TOPO_URL,
        eox: values.OPENPARCELS_MAP_EOX_URL,
      },
    },
  };
}

/** Parses the environment once at start-up; any invalid value stops the process with a clear message. */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  appOptions: ReadonlySet<string> = new Set(),
): AppConfig {
  const parsed = parseEnv(env, appOptions);
  return toConfig(parsed.values, parsed);
}
