import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Kysely } from "kysely";
import type { Clock } from "../clock.js";
import type { Database } from "../db/schema.js";
import type { FetchLike } from "../net/guarded-fetch.js";
import { parseThemeManifest } from "../themes/manifest.js";
import { loadTheme } from "../themes/loader.js";
import { CommunitySearch } from "./community.js";
import { parseRepositoryUrl, rawFileUrl, releaseTags, type Repository } from "./forge.js";
import { inspectRepository, type Offer, type OfferedItem } from "./inspect.js";
import {
  blocked,
  RegistryClient,
  type InstallKind,
  type RegistryEntry,
  type RegistryState,
} from "./registry.js";
import { getBytes, getJson } from "./remote.js";
import type { ThemeCatalog } from "./themes.js";

/**
 * Installing providers, themes and consumers from git repositories (decision record 0002 §2.8):
 * check a repository, install one item it lists at a pinned commit, switch auto-update, update and
 * uninstall. Themes are installed for real (declarative, checked by the theme loader); code
 * providers and consumers are refused with `needs_bundles` until bundles exist.
 */

/** Where an install was started; decides the tier unless the registry lists that commit. */
export type InstallSource = "url" | "community" | "verified";

export interface InstalledRecord {
  readonly kind: InstallKind;
  readonly id: string;
  readonly name: string;
  readonly tier: "verified" | "custom" | "community";
  readonly repository: string;
  readonly folder: string;
  readonly version: string;
  readonly commit: string;
  readonly autoUpdate: boolean;
  readonly installedAt: string;
  readonly updatedAt: string;
}

export class InstallError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = "InstallError";
    this.reason = reason;
  }
}

const FILE_CAP = 1_000_000;
/** Auto-update looks for new versions this often (with up to an hour of jitter). */
const UPDATE_EVERY_MS = 12 * 60 * 60 * 1000;
const JITTER_MS = 60 * 60 * 1000;

export interface InstallDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
  readonly fetch: FetchLike;
  readonly dataDir: string;
  readonly registryUrl: string;
  /** OPENPARCELS_PROVIDERS_REMOTE: off, nothing is fetched (air-gapped). */
  readonly remote: boolean;
  /** OPENPARCELS_PROVIDERS_COMMUNITY: GitHub topic search. */
  readonly community: boolean;
  readonly themes: ThemeCatalog;
  /** Built-in ids per kind, which installs may not take. */
  readonly builtinIds: (kind: InstallKind) => ReadonlySet<string>;
}

export class InstallService {
  readonly registry: RegistryClient;
  readonly communitySearch: CommunitySearch;
  private readonly deps: InstallDeps;
  private nextUpdate = 0;

  constructor(deps: InstallDeps) {
    this.deps = deps;
    this.registry = new RegistryClient(deps.fetch, deps.clock, deps.registryUrl, deps.remote);
    this.communitySearch = new CommunitySearch(deps.fetch, deps.clock);
  }

  get remote(): boolean {
    return this.deps.remote;
  }

  get community(): boolean {
    return this.deps.remote && this.deps.community;
  }

  async list(): Promise<readonly InstalledRecord[]> {
    const rows = await this.deps.db.selectFrom("installs").selectAll().orderBy("name").execute();
    return rows.map((row) => ({
      kind: row.kind as InstallKind,
      id: row.id,
      name: row.name,
      tier: row.tier as InstalledRecord["tier"],
      repository: row.repository,
      folder: row.folder,
      version: row.version,
      commit: row.commit,
      autoUpdate: row.auto_update === 1,
      installedAt: row.installed_at,
      updatedAt: row.updated_at,
    }));
  }

  private requireRemote(): void {
    if (!this.deps.remote) {
      throw new InstallError("remote_off", "Installing is off (OPENPARCELS_PROVIDERS_REMOTE).");
    }
  }

  private repository(url: string): Repository {
    try {
      return parseRepositoryUrl(url);
    } catch (error) {
      throw new InstallError("bad_url", (error as Error).message);
    }
  }

  /** What a repository offers at `ref` (default: its newest release tag). */
  async check(url: string, ref: string | undefined): Promise<Offer> {
    this.requireRemote();
    const repo = this.repository(url);
    const state = await this.registry.read();
    const block = blocked(state.index?.blocklist ?? [], { repository: repo.url });
    if (block !== null && block.severity !== "hidden") {
      throw new InstallError("blocked", block.reason);
    }
    try {
      return await inspectRepository(
        this.deps.fetch,
        repo,
        ref,
        (kind, id) => this.deps.builtinIds(kind).has(id),
        state.index?.blocklist ?? [],
      );
    } catch (error) {
      if (error instanceof InstallError) throw error;
      throw new InstallError("unreadable", (error as Error).message);
    }
  }

  /** The registry entry that lists this repository folder at this commit, if any. */
  private verifiedEntry(state: RegistryState, repository: string, folder: string, commit: string) {
    return state.index?.entries.find(
      (entry) =>
        parseRepositoryUrl(entry.repository).url === repository &&
        entry.path === folder &&
        entry.versions.some((version) => version.commit === commit),
    );
  }

  /** Installs (or updates) one item; returns the record. */
  async install(input: {
    url: string;
    ref?: string | undefined;
    kind: InstallKind;
    id: string;
    source: InstallSource;
  }): Promise<InstalledRecord> {
    const offer = await this.check(input.url, input.ref);
    const item = offer.items.find((entry) => entry.kind === input.kind && entry.id === input.id);
    if (item === undefined) {
      throw new InstallError(
        "not_listed",
        `${offer.repository} does not list ${input.kind} ${input.id}`,
      );
    }
    if (item.refusal !== null) throw new InstallError(item.refusal, item.detail ?? item.refusal);
    const state = await this.registry.read();
    const verified = this.verifiedEntry(state, offer.repository, item.folder, offer.commit);
    if (input.source === "verified" && verified === undefined) {
      throw new InstallError("not_verified", "The registry does not list this version.");
    }
    const tier =
      verified !== undefined ? "verified" : input.source === "community" ? "community" : "custom";
    if (item.kind === "theme") {
      await this.placeTheme(this.repository(offer.repository), offer.commit, item);
    }
    const now = this.deps.clock.now().toISOString();
    const existing = await this.deps.db
      .selectFrom("installs")
      .select(["auto_update", "installed_at"])
      .where("kind", "=", item.kind)
      .where("id", "=", item.id)
      .executeTakeFirst();
    const row = {
      kind: item.kind,
      id: item.id,
      name: item.name,
      tier,
      repository: offer.repository,
      folder: item.folder,
      version: offer.version,
      commit: offer.commit,
      auto_update: existing?.auto_update ?? (tier === "verified" ? 1 : 0),
      installed_at: existing?.installed_at ?? now,
      updated_at: now,
    };
    await this.deps.db
      .insertInto("installs")
      .values(row)
      .onConflict((conflict) => conflict.columns(["kind", "id"]).doUpdateSet(row))
      .execute();
    this.deps.themes.reload();
    const record = (await this.list()).find(
      (entry) => entry.kind === item.kind && entry.id === item.id,
    );
    if (record === undefined) throw new Error("the install was not recorded");
    return record;
  }

  /** Downloads a theme's manifest and files into a staging folder, checks it, then swaps it in. */
  private async placeTheme(repo: Repository, commit: string, item: OfferedItem): Promise<void> {
    const root = this.deps.themes.installDir;
    const staging = path.join(root, `.staging-${randomBytes(6).toString("hex")}`);
    mkdirSync(staging, { recursive: true });
    try {
      const raw = await getJson(
        this.deps.fetch,
        rawFileUrl(repo, commit, `${item.folder}/open-parcels-theme.json`),
        64 * 1024,
      );
      const manifest = parseThemeManifest(raw, item.folder);
      writeFileSync(path.join(staging, "open-parcels-theme.json"), JSON.stringify(raw));
      const files = [...manifest.fonts.map((font) => font.file), manifest.logo, manifest.icon];
      for (const file of files) {
        if (file === undefined) continue;
        const body = await getBytes(
          this.deps.fetch,
          rawFileUrl(repo, commit, `${item.folder}/${file}`),
          FILE_CAP,
        );
        writeFileSync(path.join(staging, file), body);
      }
      try {
        loadTheme(staging, this.deps.themes.defaultTheme);
      } catch (error) {
        throw new InstallError("invalid", (error as Error).message);
      }
      const target = path.join(root, item.id);
      rmSync(target, { recursive: true, force: true });
      renameSync(staging, target);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  async setAutoUpdate(kind: InstallKind, id: string, on: boolean): Promise<boolean> {
    const result = await this.deps.db
      .updateTable("installs")
      .set({ auto_update: on ? 1 : 0 })
      .where("kind", "=", kind)
      .where("id", "=", id)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  async uninstall(kind: InstallKind, id: string): Promise<boolean> {
    const result = await this.deps.db
      .deleteFrom("installs")
      .where("kind", "=", kind)
      .where("id", "=", id)
      .executeTakeFirst();
    if (kind === "theme") {
      const dir = path.join(this.deps.themes.installDir, id);
      if (existsSync(dir)) rmSync(dir, { recursive: true });
      this.deps.themes.reload();
    }
    return result.numDeletedRows > 0n;
  }

  /** The newest version an install could move to: the registry's newest reviewed one for verified installs, the newest release tag otherwise. */
  async newestVersion(
    record: InstalledRecord,
  ): Promise<{ version: string; commit: string } | null> {
    if (record.tier === "verified") {
      const entry: RegistryEntry | undefined = (await this.registry.read()).index?.entries.find(
        (candidate) => candidate.kind === record.kind && candidate.id === record.id,
      );
      const newest = entry?.versions[0];
      return newest === undefined ? null : { version: newest.version, commit: newest.commit };
    }
    const tag = (await releaseTags(this.deps.fetch, this.repository(record.repository)))[0];
    return tag === undefined ? null : { version: tag.name, commit: tag.commit };
  }

  /** `updateAll` when 12 hours (jittered) have passed since the last pass; called hourly. */
  async updateIfDue(): Promise<readonly { id: string; error: string | null }[]> {
    const now = this.deps.clock.now().getTime();
    if (now < this.nextUpdate) return [];
    this.nextUpdate = now + UPDATE_EVERY_MS + Math.floor(Math.random() * JITTER_MS);
    return this.updateAll();
  }

  /**
   * Auto-update (owner decision 2): every install with auto-update on moves to its newest version.
   * Failures are returned, never thrown: one broken repository must not stop the others.
   */
  async updateAll(): Promise<readonly { id: string; error: string | null }[]> {
    if (!this.deps.remote) return [];
    const results: { id: string; error: string | null }[] = [];
    for (const record of await this.list()) {
      if (!record.autoUpdate) continue;
      try {
        const newest = await this.newestVersion(record);
        if (newest === null || newest.commit === record.commit) continue;
        await this.install({
          url: record.repository,
          ref: newest.commit,
          kind: record.kind,
          id: record.id,
          source:
            record.tier === "verified"
              ? "verified"
              : record.tier === "community"
                ? "community"
                : "url",
        });
        results.push({ id: record.id, error: null });
      } catch (error) {
        results.push({ id: record.id, error: (error as Error).message });
      }
    }
    return results;
  }
}
