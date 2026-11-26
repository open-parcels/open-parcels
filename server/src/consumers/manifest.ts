import { z } from "zod";
import { hostMatches, type HostAllowList } from "../provider/manifest.js";

/**
 * The consumer manifest, format 1 (`open-parcels-consumer.json`, `docs/consumers.md` §6): what a
 * consumer is, the hosts it may reach and the parcel fields it gets. This schema is the only
 * parser; it refuses unknown keys.
 */

/** `api.example.com` exactly, or `.example.com` for the domain and every subdomain. */
const HOST_PATTERN = /^\.?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const reason = z.string().trim().min(3).max(200);

const networkEntry = z.union([
  z.strictObject({ host: z.string().regex(HOST_PATTERN), reason }),
  /** The host of a URL (or a bare host name) the user typed into this config field. */
  z.strictObject({ config: z.string().regex(/^[a-z][a-z0-9_]*$/), reason }),
]);

/** Parcel fields a consumer may ask for beyond the texts. Courier positions are not among them. */
export const CONSUMER_FIELDS = [
  "tracking_number",
  "carrier",
  "items",
  "shop",
  "pickup_point",
  "expected_delivery",
] as const;
export type ConsumerField = (typeof CONSUMER_FIELDS)[number];

const consumerManifestSchema = z.strictObject({
  schema: z.literal(1),
  id: z.string().regex(/^[a-z0-9_]{2,40}$/),
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(300),
  fields: z
    .array(z.enum(CONSUMER_FIELDS))
    .refine((fields) => new Set(fields).size === fields.length, { message: "a field twice" }),
  permissions: z.strictObject({
    network: z.array(networkEntry),
    /** Only the built-in email consumer: an SMTP connection to the host it is configured with. */
    smtp: z.boolean(),
  }),
});
export type ConsumerManifest = z.infer<typeof consumerManifestSchema>;

/** Parses a consumer manifest; the error names the consumer and every problem. */
export function parseConsumerManifest(raw: unknown, source: string): ConsumerManifest {
  const parsed = consumerManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new Error(`The consumer manifest ${source} is invalid: ${problems.join("; ")}.`);
  }
  return parsed.data;
}

/** The host a config value names: a URL's host, or a bare host name (an SMTP server). */
function hostOf(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  if (URL.canParse(value)) return new URL(value).hostname.toLowerCase();
  return /^[a-z0-9.-]+$/i.test(value) ? value.toLowerCase() : undefined;
}

/** The hosts a configured consumer may reach: the manifest's patterns plus those its config names. */
export function consumerAllowList(manifest: ConsumerManifest, config: unknown): HostAllowList {
  const patterns: string[] = [];
  for (const entry of manifest.permissions.network) {
    if ("host" in entry) {
      patterns.push(entry.host);
      continue;
    }
    const value: unknown =
      config !== null && typeof config === "object"
        ? (config as Record<string, unknown>)[entry.config]
        : undefined;
    const host = hostOf(value);
    if (host !== undefined) patterns.push(host);
  }
  return { allows: (hostname) => patterns.some((pattern) => hostMatches(pattern, hostname)) };
}
