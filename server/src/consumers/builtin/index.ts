import { parseRepoManifest } from "../../provider/repo-manifest.js";
import type { Clock } from "../../clock.js";
import type { Consumer } from "../api.js";
import { apprise } from "./apprise/index.js";
import { email } from "./email/index.js";
import { ntfy } from "./ntfy/index.js";
import { webhookConsumer } from "./webhook/index.js";
import repo from "./open-parcels-repo.json" with { type: "json" };

/**
 * The built-in consumers, listed by this folder's repo manifest (`consumers:`, format 1). The start
 * fails when the manifest and the code disagree, or a folder's manifest names another id.
 */
export function builtinConsumers(clock: Clock): ReadonlyMap<string, Consumer> {
  const code: readonly Consumer[] = [apprise, email, ntfy, webhookConsumer(() => clock.now())];
  const listed = parseRepoManifest(repo, "the built-in consumers").consumers;
  const byId = new Map(code.map((consumer) => [consumer.describe().manifest.id, consumer]));
  for (const entry of listed) {
    if (entry.id !== entry.folder || !byId.has(entry.id)) {
      throw new Error(`The built-in consumer ${entry.id} in the repo manifest has no code.`);
    }
  }
  if (listed.length !== byId.size) {
    throw new Error("The repo manifest of the built-in consumers does not list every one.");
  }
  return byId;
}
