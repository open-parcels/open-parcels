import { parseConsumerManifest } from "../consumers/manifest.js";
import type { FetchLike } from "../net/guarded-fetch.js";
import { parseManifest } from "../provider/manifest.js";
import { parseRepoManifest } from "../provider/repo-manifest.js";
import { parseThemeManifest, type ThemeManifest } from "../themes/manifest.js";
import { rawFileUrl, resolveRef, type Repository } from "./forge.js";
import { blocked, type BlockEntry, type InstallKind } from "./registry.js";
import { getJson } from "./remote.js";

/**
 * Reads what a repository offers at one commit (decision record 0002 §2.8 "Resolve" and "Verify"):
 * its repo manifest, then each listed provider's, theme's and consumer's own manifest, so the
 * consent screen can show names and hosts before anything is installed.
 */

/** Why an item cannot be installed. */
type Refusal =
  /** Code runs only from bundles, which this server cannot load yet (`docs/official-providers-repo.md`). */
  | "needs_bundles"
  /** Its manifest failed the checks. */
  | "invalid"
  /** The id is a built-in one. */
  | "reserved"
  /** On the registry's blocklist. */
  | "blocked";

export interface OfferedItem {
  readonly kind: InstallKind;
  readonly id: string;
  readonly folder: string;
  readonly name: string;
  readonly description: string | null;
  /** Hosts it may reach (providers and consumers; a theme reaches none). */
  readonly hosts: readonly string[];
  readonly refusal: Refusal | null;
  /** What failed, for `invalid` and `blocked`. */
  readonly detail: string | null;
}

export interface Offer {
  readonly repository: string;
  readonly version: string;
  readonly commit: string;
  readonly items: readonly OfferedItem[];
}

const MANIFEST_FILE: Record<InstallKind, string> = {
  provider: "open-parcels-provider.json",
  theme: "open-parcels-theme.json",
  consumer: "open-parcels-consumer.json",
};

/** One repository is read in one go; more than this is not a provider repository. */
const MAX_ITEMS = 120;

interface Context {
  readonly fetch: FetchLike;
  readonly repo: Repository;
  readonly commit: string;
  /** Ids already taken by built-in items, per kind. */
  readonly reserved: (kind: InstallKind, id: string) => boolean;
  readonly blocklist: readonly BlockEntry[];
}

function describe(kind: InstallKind, raw: unknown, where: string) {
  switch (kind) {
    case "provider": {
      const manifest = parseManifest(raw, where);
      return {
        id: manifest.id,
        name: manifest.name,
        description: null,
        hosts: manifest.permissions.network.map((entry) =>
          "host" in entry ? entry.host : `config:${entry.config}`,
        ),
      };
    }
    case "consumer": {
      const manifest = parseConsumerManifest(raw, where);
      return {
        id: manifest.id,
        name: manifest.name,
        description: manifest.description,
        hosts: manifest.permissions.network.map((entry) =>
          "host" in entry ? entry.host : `config:${entry.config}`,
        ),
      };
    }
    case "theme": {
      const manifest: ThemeManifest = parseThemeManifest(raw, where);
      return {
        id: manifest.id,
        name: manifest.name,
        description: manifest.description ?? null,
        hosts: [],
      };
    }
  }
}

async function offerOne(
  context: Context,
  kind: InstallKind,
  entry: { id: string; folder: string },
): Promise<OfferedItem> {
  const base = { kind, id: entry.id, folder: entry.folder, name: entry.id, description: null };
  const block = blocked(context.blocklist, { repository: context.repo.url, id: entry.id });
  if (block !== null && block.severity !== "hidden") {
    return { ...base, hosts: [], refusal: "blocked", detail: block.reason };
  }
  let described;
  try {
    const url = rawFileUrl(context.repo, context.commit, `${entry.folder}/${MANIFEST_FILE[kind]}`);
    described = describe(kind, await getJson(context.fetch, url, 64 * 1024), entry.folder);
    if (described.id !== entry.id) throw new Error(`its id is ${described.id}`);
  } catch (error) {
    return { ...base, hosts: [], refusal: "invalid", detail: (error as Error).message };
  }
  const refusal: Refusal | null = context.reserved(kind, entry.id)
    ? "reserved"
    : kind === "theme"
      ? null
      : "needs_bundles";
  return { ...base, ...described, refusal, detail: null };
}

/** What `repo` offers at `ref` (a release tag or full commit; default: the newest release tag). */
export async function inspectRepository(
  fetch: FetchLike,
  repo: Repository,
  ref: string | undefined,
  reserved: Context["reserved"],
  blocklist: readonly BlockEntry[],
): Promise<Offer> {
  const { version, commit } = await resolveRef(fetch, repo, ref);
  const manifest = parseRepoManifest(
    await getJson(fetch, rawFileUrl(repo, commit, "open-parcels-repo.json"), 256 * 1024),
    repo.url,
  );
  const count = manifest.providers.length + manifest.themes.length + manifest.consumers.length;
  if (count > MAX_ITEMS)
    throw new Error(`the repo manifest lists more than ${String(MAX_ITEMS)} items`);
  const context: Context = { fetch, repo, commit, reserved, blocklist };
  const items = await Promise.all([
    ...manifest.providers.map((entry) => offerOne(context, "provider", entry)),
    ...manifest.themes.map((entry) => offerOne(context, "theme", entry)),
    ...manifest.consumers.map((entry) => offerOne(context, "consumer", entry)),
  ]);
  return { repository: repo.url, version, commit, items };
}
