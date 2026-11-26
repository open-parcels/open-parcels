import { z } from "zod";
import { DAY_MS, type Clock } from "../clock.js";
import type { FetchLike } from "../net/guarded-fetch.js";
import { getBytes, RemoteError } from "./remote.js";
import { parsePublicKey, verifySshSignature } from "./sshsig.js";

/**
 * The registry (`open-parcels/open-parcels-registry`, decision record 0002 §2.6.1): the verified
 * providers, themes and consumers and the blocklist, in one `index.json` signed with an SSH key
 * this server embeds. The transport is untrusted; only the signature counts.
 */

export const REGISTRY_NAMESPACE = "open-parcels-registry";
/** The keys allowed to sign the index; a new key ships with a server release. */
const REGISTRY_KEYS = [
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILfOsbwFZ9K1jJUo11LH2+fqyjz77Zr8Xh/LIM5QOXQZ open-parcels-registry-1",
];
/** Fetched again after this long; a failed fetch keeps the last good index. */
const REFRESH_MS = 12 * 60 * 60 * 1000;
const INDEX_CAP = 2_000_000;

export const INSTALL_KINDS = ["provider", "theme", "consumer"] as const;
export type InstallKind = (typeof INSTALL_KINDS)[number];

const commit = z.string().regex(/^[0-9a-f]{40}$/);

const entrySchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{2,40}$/),
  kind: z.enum(INSTALL_KINDS),
  name: z.string().min(1).max(100),
  repository: z.url({ protocol: /^https$/ }),
  path: z.string().regex(/^[a-z0-9][a-z0-9_/-]{0,120}$/),
  versions: z
    .array(z.object({ version: z.string().min(1).max(40), commit, reviewed: z.string() }).loose())
    .min(1)
    .describe("Newest first."),
});
export type RegistryEntry = z.infer<typeof entrySchema>;

const blockSchema = z.object({
  repo: z.string().optional().describe("host/owner/repo"),
  id: z.string().optional(),
  digest: z.string().optional(),
  versions: z.union([z.literal("*"), z.array(z.string())]).default("*"),
  severity: z.enum(["hidden", "block", "critical"]),
  reason: z.string(),
});
export type BlockEntry = z.infer<typeof blockSchema>;

const indexSchema = z.object({
  schema: z.literal(1),
  generated_at: z.iso.datetime(),
  expires: z.iso.datetime(),
  entries: z.array(entrySchema),
  blocklist: z.array(blockSchema),
});
type RegistryIndex = z.infer<typeof indexSchema>;

export interface RegistryState {
  readonly index: RegistryIndex | null;
  /** When the index was last read successfully. */
  readonly checkedAt: string | null;
  /** Why the last read failed; null after a success. */
  readonly error: string | null;
  /** Days past its `expires`; 0 while valid. A stale index is still used. */
  readonly staleDays: number;
}

/** `host/owner/repo` of a repository URL, lower case, for blocklist matches. */
export function repoKey(repository: string): string {
  const url = new URL(repository);
  return `${url.host}${url.pathname.replace(/\.git$/, "").replace(/\/+$/, "")}`.toLowerCase();
}

/** A blocklist `repo` without a host is on GitHub. */
function blockedRepo(repo: string): string {
  const key = repo.toLowerCase().replace(/\/+$/, "");
  return key.split("/").length === 2 ? `github.com/${key}` : key;
}

/** The worst blocklist entry for a repository, id, version or commit, or null. */
export function blocked(
  list: readonly BlockEntry[],
  what: { repository?: string; id?: string; version?: string },
): BlockEntry | null {
  const repo = what.repository === undefined ? undefined : repoKey(what.repository);
  const order = { hidden: 0, block: 1, critical: 2 } as const;
  let worst: BlockEntry | null = null;
  for (const entry of list) {
    const target =
      (entry.repo !== undefined && blockedRepo(entry.repo) === repo) ||
      (entry.id !== undefined && entry.id === what.id);
    const version =
      entry.versions === "*" ||
      (what.version !== undefined && entry.versions.includes(what.version));
    if (target && version && (worst === null || order[entry.severity] > order[worst.severity])) {
      worst = entry;
    }
  }
  return worst;
}

export class RegistryClient {
  private state: RegistryState = { index: null, checkedAt: null, error: null, staleDays: 0 };
  private readAt = 0;
  private pending: Promise<RegistryState> | null = null;
  private readonly keys: readonly Buffer[];
  private readonly fetch: FetchLike;
  private readonly clock: Clock;
  private readonly baseUrl: string;
  /** False: never fetched (OPENPARCELS_PROVIDERS_REMOTE off). */
  private readonly remote: boolean;

  constructor(
    fetch: FetchLike,
    clock: Clock,
    baseUrl: string,
    remote: boolean,
    keys: readonly string[] = REGISTRY_KEYS,
  ) {
    this.keys = keys.map(parsePublicKey);
    this.fetch = fetch;
    this.clock = clock;
    this.baseUrl = baseUrl;
    this.remote = remote;
  }

  /** The index, read again when older than 12 hours or when `force` is set. */
  async read(force = false): Promise<RegistryState> {
    if (!this.remote) return this.state;
    const now = this.clock.now().getTime();
    if (!force && this.readAt !== 0 && now - this.readAt < REFRESH_MS) return this.withAge();
    this.pending ??= this.fetchIndex().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private withAge(): RegistryState {
    const expires = this.state.index === null ? null : Date.parse(this.state.index.expires);
    const over = expires === null ? 0 : this.clock.now().getTime() - expires;
    return { ...this.state, staleDays: over > 0 ? Math.ceil(over / DAY_MS) : 0 };
  }

  private async fetchIndex(): Promise<RegistryState> {
    this.readAt = this.clock.now().getTime();
    try {
      const base = new URL(this.baseUrl);
      const body = await getBytes(this.fetch, new URL("index.json", base), INDEX_CAP);
      const signature = await getBytes(this.fetch, new URL("index.json.sig", base), 10_000);
      if (!verifySshSignature(body, signature.toString("utf8"), REGISTRY_NAMESPACE, this.keys)) {
        throw new RemoteError("the registry index is not signed by a known key");
      }
      const index = indexSchema.parse(JSON.parse(body.toString("utf8")));
      this.state = { index, checkedAt: this.clock.now().toISOString(), error: null, staleDays: 0 };
    } catch (error) {
      const message =
        error instanceof z.ZodError ? "the registry index is not valid" : (error as Error).message;
      this.state = { ...this.state, error: message };
    }
    return this.withAge();
  }
}
