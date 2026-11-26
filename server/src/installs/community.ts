import type { Clock } from "../clock.js";
import type { FetchLike } from "../net/guarded-fetch.js";
import { getJson, RemoteError } from "./remote.js";

/**
 * Community discovery (decision record 0002 §2.10): GitHub repositories with the topic
 * `open-parcels-provider`. The server asks, never the browser, so the blocklist is applied first
 * and one cache serves everyone. A hit is repository metadata only; its repo manifest is read
 * when the user checks it for installing.
 */

const COMMUNITY_TOPIC = "open-parcels-provider";
const CACHE_MS = 6 * 60 * 60 * 1000;
/** "Refresh" is allowed once a minute; GitHub allows 10 searches a minute without a token. */
const MIN_REFRESH_MS = 60 * 1000;

interface CommunityRepository {
  readonly repository: string;
  readonly fullName: string;
  readonly description: string | null;
  readonly stars: number;
  readonly updatedAt: string;
}

export interface CommunityState {
  readonly hits: readonly CommunityRepository[];
  readonly checkedAt: string | null;
  readonly error: string | null;
}

function hitOf(raw: unknown): CommunityRepository | null {
  if (typeof raw !== "object" || raw === null) return null;
  const item = raw as Record<string, unknown>;
  const { html_url: url, full_name: fullName, description, stargazers_count: stars } = item;
  const updatedAt = item["pushed_at"] ?? item["updated_at"];
  if (typeof url !== "string" || !url.startsWith("https://github.com/")) return null;
  if (typeof fullName !== "string" || typeof updatedAt !== "string") return null;
  return {
    repository: url,
    fullName,
    description: typeof description === "string" ? description.slice(0, 300) : null,
    stars: typeof stars === "number" ? stars : 0,
    updatedAt,
  };
}

/** Levenshtein distance, for the "looks similar to a verified provider" notice. */
export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current.push(
        Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

export class CommunitySearch {
  private state: CommunityState = { hits: [], checkedAt: null, error: null };
  private readAt = 0;
  private readonly fetch: FetchLike;
  private readonly clock: Clock;

  constructor(fetch: FetchLike, clock: Clock) {
    this.fetch = fetch;
    this.clock = clock;
  }

  /** The cached hits, searched again after 6 hours, or on `refresh` at most once a minute. */
  async read(refresh = false): Promise<CommunityState> {
    const now = this.clock.now().getTime();
    const age = now - this.readAt;
    if (this.readAt !== 0 && age < (refresh ? MIN_REFRESH_MS : CACHE_MS)) return this.state;
    this.readAt = now;
    const url = new URL("https://api.github.com/search/repositories");
    url.searchParams.set("q", `topic:${COMMUNITY_TOPIC} archived:false`);
    url.searchParams.set("sort", "updated");
    url.searchParams.set("per_page", "100");
    try {
      const raw = (await getJson(this.fetch, url, 3_000_000)) as { items?: unknown };
      if (!Array.isArray(raw.items)) throw new RemoteError("GitHub sent no search result");
      const hits = raw.items.map(hitOf).filter((hit) => hit !== null);
      this.state = { hits, checkedAt: this.clock.now().toISOString(), error: null };
    } catch (error) {
      const limited =
        error instanceof RemoteError && (error.status === 403 || error.status === 429);
      this.state = {
        ...this.state,
        error: limited ? "GitHub is limiting searches from this server" : (error as Error).message,
      };
    }
    return this.state;
  }
}
