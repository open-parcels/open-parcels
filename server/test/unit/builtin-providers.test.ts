import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUILTIN_CARRIERS } from "../../src/engine/builtin-carriers.js";
import { parseRepoManifest } from "../../src/provider/repo-manifest.js";

/** Laid out from the pinned open-parcels-providers release by `npm run providers`. */
const CARRIERS = new URL("../../src/carriers/", import.meta.url);
/** The demo providers live in the server (made-up data), not in the providers repo. */
const SERVER_PROVIDERS = ["demo", "demo_shop"];

function vendored() {
  const raw: unknown = JSON.parse(
    readFileSync(new URL("open-parcels-repo.json", CARRIERS), "utf8"),
  );
  return parseRepoManifest(raw, "open-parcels-providers").providers;
}

describe("built-in providers from open-parcels-providers", () => {
  it("registers every provider the repo manifest lists, and no other", () => {
    const listed = vendored().map((entry) => entry.id);
    const registered = BUILTIN_CARRIERS.map((provider) => provider.manifest.id).filter(
      (id) => !SERVER_PROVIDERS.includes(id),
    );
    expect([...registered].sort()).toEqual([...listed].sort());
  });

  it("lays out exactly the listed folders, each a code provider", () => {
    const entries = vendored();
    const folders = readdirSync(CARRIERS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !SERVER_PROVIDERS.includes(entry.name))
      .map((entry) => entry.name);
    expect(folders.sort()).toEqual(entries.map((entry) => entry.folder.slice(10)).sort());
    for (const entry of entries) {
      expect(entry.kind).toBe("code");
      expect(entry.folder).toMatch(/^providers\//);
    }
  });

  const stamp = readFileSync(new URL(".providers-release", CARRIERS), "utf8").trim();
  // A local checkout laid out with OPENPARCELS_PROVIDERS_DIR; `npm ci` restores the release.
  it.skipIf(stamp.startsWith("dir "))("is the pinned release", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as {
      openParcelsProviders: { version: string; sha256: string };
    };
    const pin = pkg.openParcelsProviders;
    expect(stamp).toBe(`${pin.version} ${pin.sha256}`);
  });
});
