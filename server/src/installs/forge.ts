import type { FetchLike } from "../net/guarded-fetch.js";
import { getJson, RemoteError } from "./remote.js";

/**
 * A git repository on GitHub, GitLab or a Gitea/Forgejo server, read through the forge's HTTP API
 * and raw file URLs (the image has no git). Installs pin a full commit: a tag is resolved once,
 * at install time, and the commit is what is recorded.
 */

type ForgeKind = "github" | "gitlab" | "gitea";

export interface Repository {
  readonly forge: ForgeKind;
  readonly host: string;
  readonly owner: string;
  readonly name: string;
  /** `https://host/owner/name`, the form that is stored and shown. */
  readonly url: string;
}

export interface Tag {
  readonly name: string;
  readonly commit: string;
}

const COMMIT = /^[0-9a-f]{40}$/;
const SEGMENT = /^[A-Za-z0-9_.-]{1,100}$/;

class RepositoryUrlError extends Error {}

/** Parses `https://host/owner/name[.git]`; anything else is a `RepositoryUrlError`. */
export function parseRepositoryUrl(raw: string): Repository {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new RepositoryUrlError("not a URL");
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    throw new RepositoryUrlError("only https URLs without credentials");
  }
  const parts = url.pathname
    .replace(/\.git$/, "")
    .split("/")
    .filter(Boolean);
  const [owner, name] = parts;
  if (parts.length !== 2 || owner === undefined || name === undefined) {
    throw new RepositoryUrlError("expected https://host/owner/repository");
  }
  if (
    !SEGMENT.test(owner) ||
    !SEGMENT.test(name) ||
    owner.startsWith(".") ||
    name.startsWith(".")
  ) {
    throw new RepositoryUrlError("expected https://host/owner/repository");
  }
  const host = url.host.toLowerCase();
  const forge: ForgeKind =
    host === "github.com"
      ? "github"
      : host === "gitlab.com" || host.startsWith("gitlab.")
        ? "gitlab"
        : "gitea";
  return { forge, host, owner, name, url: `https://${host}/${owner}/${name}` };
}

function tagsUrl(repo: Repository): URL {
  const path = `${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  switch (repo.forge) {
    case "github":
      return new URL(`https://api.github.com/repos/${path}/tags?per_page=100`);
    case "gitlab":
      return new URL(
        `https://${repo.host}/api/v4/projects/${encodeURIComponent(`${repo.owner}/${repo.name}`)}/repository/tags?per_page=100`,
      );
    case "gitea":
      return new URL(`https://${repo.host}/api/v1/repos/${path}/tags?limit=50`);
  }
}

function tagOf(raw: unknown): Tag | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { name, commit } = raw as { name?: unknown; commit?: { sha?: unknown; id?: unknown } };
  const sha = commit?.sha ?? commit?.id;
  return typeof name === "string" && typeof sha === "string" && COMMIT.test(sha)
    ? { name, commit: sha }
    : null;
}

/** `v1.2.3` or `1.2.3` as numbers; other tags are not releases. */
function semver(tag: string): readonly number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  return match === null ? null : match.slice(1).map(Number);
}

/** The repository's release tags (`vX.Y.Z`), newest first. */
export async function releaseTags(fetch: FetchLike, repo: Repository): Promise<readonly Tag[]> {
  const raw = await getJson(fetch, tagsUrl(repo));
  if (!Array.isArray(raw)) throw new RemoteError(`${repo.host} sent no tag list`);
  const tags = raw
    .map(tagOf)
    .filter((tag): tag is Tag => tag !== null && semver(tag.name) !== null);
  return tags.sort((a, b) => {
    const x = semver(a.name) ?? [];
    const y = semver(b.name) ?? [];
    for (let i = 0; i < 3; i += 1) {
      const diff = (y[i] ?? 0) - (x[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });
}

/**
 * The tag or commit to install: `ref` names a release tag or is a full commit; without it, the
 * newest release tag. A commit that is no tag has the version `commit-<first 7>`.
 */
export async function resolveRef(
  fetch: FetchLike,
  repo: Repository,
  ref: string | undefined,
): Promise<{ version: string; commit: string }> {
  if (ref !== undefined && COMMIT.test(ref)) {
    const tag = (await releaseTags(fetch, repo)).find((entry) => entry.commit === ref);
    return { version: tag?.name ?? `commit-${ref.slice(0, 7)}`, commit: ref };
  }
  const tags = await releaseTags(fetch, repo);
  const tag = ref === undefined ? tags[0] : tags.find((entry) => entry.name === ref);
  if (tag === undefined) {
    throw new RemoteError(
      ref === undefined ? "the repository has no release tag (vX.Y.Z)" : `no release tag ${ref}`,
    );
  }
  return { version: tag.name, commit: tag.commit };
}

/** The URL of a file at a commit. */
export function rawFileUrl(repo: Repository, commit: string, file: string): URL {
  const path = file.split("/").map(encodeURIComponent).join("/");
  switch (repo.forge) {
    case "github":
      return new URL(
        `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${commit}/${path}`,
      );
    case "gitlab":
      return new URL(`https://${repo.host}/${repo.owner}/${repo.name}/-/raw/${commit}/${path}`);
    case "gitea":
      return new URL(
        `https://${repo.host}/${repo.owner}/${repo.name}/raw/commit/${commit}/${path}`,
      );
  }
}
