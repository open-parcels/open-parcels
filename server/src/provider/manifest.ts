import { z } from "zod";
import { CONNECTION_KINDS } from "./api.js";

/**
 * The provider manifest, format 1 (`docs/provider-manifest-and-sandbox.md`): what a provider is and
 * what it may do. Every provider has one (`open-parcels-provider.json` in its folder); this schema
 * is the only parser.
 */

/** `api.example.com` exactly, or `.example.com` for the domain and every subdomain. */
const HOST_PATTERN = /^\.?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const reason = z.string().trim().min(3).max(200);

const networkEntry = z.union([
  z.strictObject({ host: z.string().regex(HOST_PATTERN), reason }),
  /** The host of a URL the user typed into this config field (a self-hosted server). */
  z.strictObject({
    config: z.string().regex(/^[a-z][a-z0-9_]*$/),
    reason,
    /**
     * A boolean config field: when the user turns it on, that host may be an address on their
     * own network (refused otherwise, like every non-public address).
     */
    private_network_opt_in: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .optional(),
  }),
]);

const SECRET_KINDS = ["credentials", "api_key", "token"] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

/** Connection states an action may start in (`when_state`); see `docs/connection-actions-and-jobs.md`. */
const ACTION_STATES = ["ok", "idle", "needs_sign_in", "error"] as const;

const actionText = z.string().trim().min(1).max(300);

const actionCommon = {
  id: z.string().regex(/^[a-z0-9_]{1,40}$/),
  label: z.string().trim().min(1).max(60),
  description: actionText.optional(),
  connection_kinds: z.array(z.enum(CONNECTION_KINDS)).min(1),
  when_state: z.array(z.enum(ACTION_STATES)).min(1).default(["ok", "idle"]),
};

/** A button on the provider's connection cards (`docs/connection-actions-and-jobs.md` §1). */
const actionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...actionCommon,
    kind: z.literal("task"),
    /** `heavy`: one at a time per server, the rest wait as queued. */
    weight: z.enum(["light", "heavy"]).default("light"),
    confirm: actionText.optional(),
    /** Never an HA button; the HA service needs `confirm: true`. */
    destructive: z.boolean().default(false),
    expose_to_ha: z.boolean().default(false),
    /** Earliest re-run after a finished (`done`) job, in minutes. */
    cooldown_minutes: z.number().int().min(0).max(525_600).default(0),
  }),
  z.strictObject({
    ...actionCommon,
    kind: z.literal("link"),
    /** https only; `{field}` placeholders take the connection's config values. */
    url: z
      .string()
      .regex(/^https:\/\/[^\s]+$/)
      .max(500),
  }),
]);
export type ManifestAction = z.infer<typeof actionSchema>;

/**
 * Domains that send email for anyone: a provider naming one would read the user's private email.
 * A provider must name the shop or carrier whose emails it reads.
 */
const WEBMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "aol.com",
  "gmail.com",
  "gmx.de",
  "gmx.net",
  "googlemail.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "mail.com",
  "me.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "t-online.de",
  "web.de",
  "yahoo.com",
]);

/** A sender domain: exact (`example.com`) or a leading-dot suffix (`.example.com`). */
const senderDomain = z
  .string()
  .regex(HOST_PATTERN)
  .refine((domain) => !WEBMAIL_DOMAINS.has(domain.replace(/^\./, "")), {
    message: "a webmail domain sends for anyone, not for one shop or carrier",
  });

const providerManifestSchema = z.strictObject({
  schema: z.literal(1),
  id: z.string().regex(/^[a-z0-9_]{2,40}$/),
  name: z.string().trim().min(1).max(80),
  /** ISO 3166-1 alpha-2 codes, or `*` for worldwide. */
  countries: z.array(z.string().regex(/^(?:[A-Z]{2}|\*)$/)).min(1),
  /** Other names people search for (former names, sub-brands, local names). */
  aliases: z.array(z.string().trim().min(1)).optional(),
  /** File name of the logo in the server's `logos/` folder. Unset: the UI draws a monogram. */
  logo: z
    .string()
    .regex(/^[a-z0-9_.-]+\.(?:svg|png)$/)
    .optional(),
  provides: z.strictObject({
    connections: z.array(z.enum(CONNECTION_KINDS)).min(1),
    /** Reads the courier map (`readLive`). */
    live: z.boolean(),
    /**
     * A fallback service rather than a carrier: consulted only for parcels no built-in carrier
     * follows or finds; its answers are filed under the parcel's own carrier.
     */
    fallback: z.boolean(),
  }),
  permissions: z.strictObject({
    network: z.array(networkEntry),
    /** Hosts the image proxy may fetch this provider's pictures from (same patterns). */
    image_hosts: z.array(z.string().regex(HOST_PATTERN)),
    /** What its sign-in flows store: a password, an API key, or a token from an interactive sign-in. */
    secrets: z.array(z.enum(SECRET_KINDS)),
    /** Keeps a per-connection encrypted session store. */
    session: z.boolean(),
    /** Overrides the honest User-Agent (the value and its reason are in the code). */
    user_agent: z.boolean(),
  }),
  /**
   * The emails it reads (`parseEmail`): inboxes hand it the emails from these sender domains that
   * the receiving server authenticated (DKIM or DMARC). Unset: it never receives email.
   */
  email: z.strictObject({ from_domains: z.array(senderDomain).min(1) }).optional(),
  /** Buttons on its connection cards: links, and tasks that run as jobs. */
  actions: z
    .array(actionSchema)
    .default([])
    .refine((actions) => new Set(actions.map((action) => action.id)).size === actions.length, {
      message: "two actions share an id",
    }),
});
export type ProviderManifest = z.infer<typeof providerManifestSchema>;

/**
 * A link action's URL for one connection: its `{field}` placeholders filled from the config, or
 * undefined when a field is missing or the result is not an https URL the manifest allows.
 */
export function linkUrl(
  manifest: ProviderManifest,
  template: string,
  config: unknown,
): string | undefined {
  const values =
    config !== null && typeof config === "object" ? (config as Record<string, unknown>) : {};
  const missing: string[] = [];
  const filled = template.replace(/\{([a-z][a-z0-9_]*)\}/g, (_, field: string) => {
    const value = values[field];
    if (typeof value !== "string" && typeof value !== "number") {
      missing.push(field);
      return "";
    }
    return encodeURIComponent(String(value));
  });
  if (missing.length > 0 || !URL.canParse(filled)) return undefined;
  const url = new URL(filled);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return undefined;
  return networkAllowList(manifest, config).allows(url.hostname) ? url.toString() : undefined;
}

/** Parses a manifest; the error names the provider and every field that is wrong. */
export function parseManifest(raw: unknown, source: string): ProviderManifest {
  const parsed = providerManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const paths = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`The provider manifest ${source} is invalid: ${paths}.`);
  }
  return parsed.data;
}

/** True when `hostname` is `pattern`, or under it for a leading-dot pattern. */
export function hostMatches(pattern: string, hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return pattern.startsWith(".")
    ? host === pattern.slice(1) || host.endsWith(pattern)
    : host === pattern;
}

/** The hosts a provider may reach: the manifest's patterns plus those its config names. */
export interface HostAllowList {
  allows(hostname: string): boolean;
  /** Whether this host may be a non-public address (the user opted in); false when unset. */
  allowsPrivate?(hostname: string): boolean;
}

/**
 * The allow-list for one connection. A `config` entry adds the host of that config field's URL;
 * a field that is not a URL adds nothing.
 */
export function networkAllowList(manifest: ProviderManifest, config: unknown): HostAllowList {
  const patterns: string[] = [];
  const privateHosts = new Set<string>();
  const field = (name: string): unknown =>
    config !== null && typeof config === "object"
      ? (config as Record<string, unknown>)[name]
      : undefined;
  for (const entry of manifest.permissions.network) {
    if ("host" in entry) {
      patterns.push(entry.host);
      continue;
    }
    const value = field(entry.config);
    if (typeof value === "string" && URL.canParse(value)) {
      const hostname = new URL(value).hostname;
      patterns.push(hostname);
      const optIn = entry.private_network_opt_in;
      if (optIn !== undefined && field(optIn) === true) privateHosts.add(hostname);
    }
  }
  return {
    allows: (hostname) => patterns.some((pattern) => hostMatches(pattern, hostname)),
    allowsPrivate: (hostname) => privateHosts.has(hostname),
  };
}
