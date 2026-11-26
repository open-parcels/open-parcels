import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { editDistance } from "../../src/installs/community.js";
import { parseRepositoryUrl, rawFileUrl, resolveRef } from "../../src/installs/forge.js";
import {
  blocked,
  REGISTRY_NAMESPACE,
  RegistryClient,
  repoKey,
} from "../../src/installs/registry.js";
import { parsePublicKey, verifySshSignature } from "../../src/installs/sshsig.js";
import { FakeClock } from "../helpers.js";
import { FakeRemote, REGISTRY, serveRealIndex, testSigner } from "./fake-remote.js";

const COMMIT = "a".repeat(40);

describe("SSH signatures", () => {
  it("accepts the registry's real signed index and nothing changed", () => {
    const index = readFileSync(new URL("./index.json", import.meta.url));
    const signature = readFileSync(new URL("./index.json.sig", import.meta.url), "utf8");
    const signers = readFileSync(new URL("./allowed_signers", import.meta.url), "utf8");
    const key = parsePublicKey(signers.slice(signers.indexOf(" ") + 1));
    expect(verifySshSignature(index, signature, REGISTRY_NAMESPACE, [key])).toBe(true);
    const changed = Buffer.concat([index, Buffer.from(" ")]);
    expect(verifySshSignature(changed, signature, REGISTRY_NAMESPACE, [key])).toBe(false);
    expect(verifySshSignature(index, signature, "another-namespace", [key])).toBe(false);
    const other = parsePublicKey(testSigner().publicKey);
    expect(verifySshSignature(index, signature, REGISTRY_NAMESPACE, [other])).toBe(false);
    expect(verifySshSignature(index, "not a signature", REGISTRY_NAMESPACE, [key])).toBe(false);
  });
});

describe("the registry client", () => {
  const index = (expires: string) => ({
    schema: 1,
    generated_at: "2026-11-18T00:00:00.000Z",
    expires,
    entries: [
      {
        id: "example_theme",
        kind: "theme",
        name: "Example",
        repository: "https://github.com/example/op-theme",
        path: "themes/example_theme",
        versions: [{ version: "v1.0.0", commit: COMMIT, reviewed: "2026-11-18" }],
      },
    ],
    blocklist: [{ repo: "evil-example/op-dhl-plus", severity: "critical", reason: "Steals." }],
  });

  function serve(remote: FakeRemote, body: unknown, signer = testSigner()) {
    const text = Buffer.from(JSON.stringify(body));
    remote.files.set(`${REGISTRY}index.json`, text);
    remote.files.set(`${REGISTRY}index.json.sig`, signer.sign(text, REGISTRY_NAMESPACE));
    return signer;
  }

  it("reads a signed index, caches it and says how stale it is", async () => {
    const remote = new FakeRemote();
    const clock = new FakeClock();
    const signer = serve(remote, index("2026-11-20T00:00:00.000Z"));
    const client = new RegistryClient(remote.fetch, clock, REGISTRY, true, [signer.publicKey]);
    const first = await client.read();
    expect(first.error).toBeNull();
    expect(first.index?.entries[0]?.id).toBe("example_theme");
    expect(first.staleDays).toBe(0);
    clock.advance(5 * 24 * 60 * 60 * 1000);
    expect((await client.read()).staleDays).toBe(4);
    expect(remote.asked.filter((url) => url.endsWith("index.json"))).toHaveLength(2);
  });

  it("refuses an index signed by an unknown key and keeps the last good one", async () => {
    const remote = new FakeRemote();
    const clock = new FakeClock();
    const signer = serve(remote, index("2027-01-01T00:00:00.000Z"));
    const client = new RegistryClient(remote.fetch, clock, REGISTRY, true, [signer.publicKey]);
    await client.read();
    serve(remote, { ...index("2027-01-01T00:00:00.000Z"), entries: [] });
    const state = await client.read(true);
    expect(state.error).toMatch(/not signed by a known key/);
    expect(state.index?.entries).toHaveLength(1);
  });

  it("fetches nothing with remote access off", async () => {
    const remote = new FakeRemote();
    serveRealIndex(remote);
    const client = new RegistryClient(remote.fetch, new FakeClock(), REGISTRY, false);
    expect((await client.read()).index).toBeNull();
    expect(remote.asked).toEqual([]);
  });

  it("reads the real published index with the embedded key", async () => {
    const remote = new FakeRemote();
    serveRealIndex(remote);
    const state = await new RegistryClient(remote.fetch, new FakeClock(), REGISTRY, true).read();
    expect(state.error).toBeNull();
    expect(state.index?.entries).toEqual([]);
  });
});

describe("the blocklist", () => {
  const list = [
    {
      repo: "evil-example/op-dhl-plus",
      versions: "*" as const,
      severity: "critical" as const,
      reason: "a",
    },
    { id: "gls_unofficial", versions: ["v1.0.2"], severity: "block" as const, reason: "b" },
    {
      repo: "git.example.org/me/spam",
      versions: "*" as const,
      severity: "hidden" as const,
      reason: "c",
    },
  ];

  it("matches by repository (GitHub by default), id and version", () => {
    expect(
      blocked(list, { repository: "https://github.com/Evil-Example/op-dhl-plus.git" })?.severity,
    ).toBe("critical");
    expect(blocked(list, { repository: "https://git.example.org/me/spam" })?.severity).toBe(
      "hidden",
    );
    expect(blocked(list, { id: "gls_unofficial", version: "v1.0.2" })?.severity).toBe("block");
    expect(blocked(list, { id: "gls_unofficial", version: "v1.0.3" })).toBeNull();
    expect(blocked(list, { repository: "https://github.com/someone/fine" })).toBeNull();
    expect(repoKey("https://github.com/A/b/")).toBe("github.com/a/b");
  });
});

describe("git forges", () => {
  it("parses repository URLs and refuses others", () => {
    expect(parseRepositoryUrl("https://github.com/o/r.git")).toMatchObject({
      forge: "github",
      url: "https://github.com/o/r",
    });
    expect(parseRepositoryUrl("https://gitlab.com/o/r").forge).toBe("gitlab");
    expect(parseRepositoryUrl("https://git.example.org/o/r").forge).toBe("gitea");
    for (const bad of [
      "http://github.com/o/r",
      "https://u:p@github.com/o/r",
      "https://github.com/o",
      "https://github.com/o/r/tree/x",
      "nope",
    ]) {
      expect(() => parseRepositoryUrl(bad), bad).toThrow();
    }
  });

  it("builds raw file URLs per forge", () => {
    const at = (url: string) =>
      rawFileUrl(parseRepositoryUrl(url), COMMIT, "a b/c.json").toString();
    expect(at("https://github.com/o/r")).toBe(
      `https://raw.githubusercontent.com/o/r/${COMMIT}/a%20b/c.json`,
    );
    expect(at("https://gitlab.com/o/r")).toBe(
      `https://gitlab.com/o/r/-/raw/${COMMIT}/a%20b/c.json`,
    );
    expect(at("https://git.example.org/o/r")).toBe(
      `https://git.example.org/o/r/raw/commit/${COMMIT}/a%20b/c.json`,
    );
  });

  it("resolves the newest release tag, a named tag or a commit", async () => {
    const remote = new FakeRemote();
    const sha = (n: string) => n.repeat(40);
    remote.json("https://api.github.com/repos/o/r/tags?per_page=100", [
      { name: "v1.2.0", commit: { sha: sha("b") } },
      { name: "v1.10.0", commit: { sha: sha("c") } },
      { name: "nightly", commit: { sha: sha("d") } },
    ]);
    const repo = parseRepositoryUrl("https://github.com/o/r");
    expect(await resolveRef(remote.fetch, repo, undefined)).toEqual({
      version: "v1.10.0",
      commit: sha("c"),
    });
    expect(await resolveRef(remote.fetch, repo, "v1.2.0")).toEqual({
      version: "v1.2.0",
      commit: sha("b"),
    });
    expect(await resolveRef(remote.fetch, repo, sha("e"))).toEqual({
      version: "commit-eeeeeee",
      commit: sha("e"),
    });
    await expect(resolveRef(remote.fetch, repo, "nightly")).rejects.toThrow(/no release tag/);
  });
});

describe("similar names", () => {
  it("counts edits", () => {
    expect(editDistance("dhl", "dhll")).toBe(1);
    expect(editDistance("hermes", "hremes")).toBe(2);
    expect(editDistance("ups", "usps")).toBe(1);
    expect(editDistance("amazon", "postnl")).toBeGreaterThan(2);
  });
});
