import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/api/app.js";
import { createTestContext, signIn, type TestContext } from "../helpers.js";
import { testManifest } from "../manifests.js";
import { FakeRemote, serveRealIndex } from "./fake-remote.js";

/** The Providers page's routes end to end, against a fake GitHub and the real signed index. */

const REPO = "https://github.com/example/op-extras";
const V1 = "1".repeat(40);
const V2 = "2".repeat(40);
const RAW = (commit: string, file: string) =>
  `https://raw.githubusercontent.com/example/op-extras/${commit}/${file}`;
const PAPER = new URL("../../themes/paper/", import.meta.url);

let remote: FakeRemote;
let context: TestContext;
let app: App;
let headers: Record<string, string>;

function serveRelease(commit: string, name: string): void {
  remote.json(RAW(commit, "open-parcels-repo.json"), {
    schema: 1,
    providers: [{ id: "extra_carrier", kind: "code", folder: "providers/extra_carrier" }],
    themes: [{ id: "paper_copy", folder: "themes/paper_copy" }],
  });
  remote.json(
    RAW(commit, "providers/extra_carrier/open-parcels-provider.json"),
    testManifest("extra_carrier", {
      permissions: { network: [{ host: "api.extra.example", reason: "Tracking." }] },
    }),
  );
  const theme = JSON.parse(
    readFileSync(new URL("open-parcels-theme.json", PAPER), "utf8"),
  ) as Record<string, unknown>;
  remote.json(RAW(commit, "themes/paper_copy/open-parcels-theme.json"), {
    ...theme,
    id: "paper_copy",
    name,
  });
  remote.files.set(
    RAW(commit, "themes/paper_copy/logo.svg"),
    readFileSync(new URL("logo.svg", PAPER)),
  );
}

beforeEach(async () => {
  remote = new FakeRemote();
  serveRealIndex(remote);
  remote.json("https://api.github.com/repos/example/op-extras/tags?per_page=100", [
    { name: "v1.0.0", commit: { sha: V1 } },
  ]);
  serveRelease(V1, "Paper copy");
  remote.json(
    "https://api.github.com/search/repositories?q=topic%3Aopen-parcels-provider+archived%3Afalse&sort=updated&per_page=100",
    {
      items: [
        {
          html_url: REPO,
          full_name: "example/op-extras",
          description: "Extras",
          stargazers_count: 3,
          pushed_at: "2026-11-17T00:00:00Z",
        },
      ],
    },
  );
  context = await createTestContext({ fetchImpl: remote.fetch });
  app = await context.app();
  const session = await signIn(context, app);
  headers = { cookie: session.cookie, "x-csrf-token": session.csrf };
});

afterEach(async () => {
  await context.close();
});

async function call(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: Record<string, unknown>,
) {
  return payload === undefined
    ? app.inject({ method, url, headers })
    : app.inject({ method, url, headers, payload });
}

describe("the Providers page's routes", () => {
  it("lists built-in items and the registry it read", async () => {
    const response = await call("GET", "/api/v1/providers/installed");
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<{
      items: {
        kind: string;
        id: string;
        tier: string;
        auto_update: boolean;
        auto_update_fixed: boolean;
      }[];
      registry: { error: string | null };
      community: boolean;
    }>();
    expect(body.registry.error).toBeNull();
    expect(body.community).toBe(true);
    expect(body.items).toContainEqual(
      expect.objectContaining({
        kind: "theme",
        id: "paper",
        tier: "builtin",
        auto_update: true,
        auto_update_fixed: true,
      }),
    );
    expect(body.items).toContainEqual(
      expect.objectContaining({ kind: "consumer", id: "ntfy", tier: "builtin" }),
    );
  });

  it("checks a repository: themes install, code waits for bundles", async () => {
    const response = await call("POST", "/api/v1/providers/check", { url: REPO });
    expect(response.statusCode, response.body).toBe(200);
    const offer = response.json<{
      version: string;
      commit: string;
      items: { id: string; refusal: string | null; hosts: string[] }[];
    }>();
    expect(offer).toMatchObject({ version: "v1.0.0", commit: V1 });
    expect(offer.items).toContainEqual(
      expect.objectContaining({ id: "paper_copy", refusal: null, hosts: [] }),
    );
    expect(offer.items).toContainEqual(
      expect.objectContaining({
        id: "extra_carrier",
        refusal: "needs_bundles",
        hosts: ["api.extra.example"],
      }),
    );
    const code = await call("POST", "/api/v1/providers/install", {
      url: REPO,
      kind: "provider",
      id: "extra_carrier",
      source: "url",
    });
    expect(code.statusCode).toBe(400);
    expect(code.json<{ params: { reason: string } }>().params.reason).toBe("needs_bundles");
  });

  it("installs a theme, switches auto-update, updates it and uninstalls it", async () => {
    const installed = await call("POST", "/api/v1/providers/install", {
      url: REPO,
      kind: "theme",
      id: "paper_copy",
      source: "community",
    });
    expect(installed.statusCode, installed.body).toBe(200);
    expect(installed.json()).toMatchObject({
      tier: "community",
      version: "v1.0.0",
      auto_update: false,
    });
    const themes = await call("GET", "/api/v1/themes");
    expect(themes.json<{ id: string }[]>().map((theme) => theme.id)).toContain("paper_copy");

    expect(
      (await call("PATCH", "/api/v1/providers/theme/paper_copy", { auto_update: true })).statusCode,
    ).toBe(204);
    remote.json("https://api.github.com/repos/example/op-extras/tags?per_page=100", [
      { name: "v1.1.0", commit: { sha: V2 } },
      { name: "v1.0.0", commit: { sha: V1 } },
    ]);
    serveRelease(V2, "Paper copy two");
    expect(await context.services.installs.updateAll()).toEqual([
      { id: "paper_copy", error: null },
    ]);
    const after = (await call("GET", "/api/v1/providers/installed")).json<{
      items: { id: string; version: string | null; name: string }[];
    }>();
    expect(after.items.find((item) => item.id === "paper_copy")).toMatchObject({
      version: "v1.1.0",
      name: "Paper copy two",
    });

    expect((await call("DELETE", "/api/v1/providers/theme/paper_copy")).statusCode).toBe(204);
    const gone = await call("GET", "/api/v1/themes");
    expect(gone.json<{ id: string }[]>().map((theme) => theme.id)).not.toContain("paper_copy");
  });

  it("refuses a built-in id, a broken theme and bad URLs", async () => {
    remote.json(RAW(V1, "open-parcels-repo.json"), {
      schema: 1,
      themes: [
        { id: "paper", folder: "themes/paper" },
        { id: "renamed", folder: "themes/paper_copy" },
      ],
    });
    remote.files.set(
      RAW(V1, "themes/paper/open-parcels-theme.json"),
      readFileSync(new URL("open-parcels-theme.json", PAPER)),
    );
    const offer = (await call("POST", "/api/v1/providers/check", { url: REPO })).json<{
      items: { refusal: string | null }[];
    }>();
    expect(offer.items.map((item) => item.refusal)).toEqual(["reserved", "invalid"]);
    const bad = await call("POST", "/api/v1/providers/check", { url: "http://github.com/x/y" });
    expect(bad.json<{ params: { reason: string } }>().params.reason).toBe("bad_url");
  });

  it("lists community repositories found by the topic", async () => {
    const response = await call("GET", "/api/v1/providers/available?source=community");
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<{ items: unknown[] }>().items).toEqual([
      expect.objectContaining({ repository: REPO, tier: "community", stars: 3, installed: false }),
    ]);
    const verified = await call("GET", "/api/v1/providers/available?source=verified");
    expect(verified.json<{ items: unknown[] }>().items).toEqual([]);
  });

  it("is admin-only for changes", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/providers/check",
      payload: { url: REPO },
    });
    expect(response.statusCode).toBe(401);
  });
});
