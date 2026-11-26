import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/api/app.js";
import { createTestContext, type TestContext } from "../helpers.js";

let context: TestContext;
let app: App;

beforeEach(async () => {
  context = await createTestContext();
  app = await context.app();
});
afterEach(async () => {
  await context.close();
});

interface ListedTheme {
  readonly id: string;
  readonly light: Record<string, string> | null;
  readonly dark: Record<string, string> | null;
  readonly logo: string | null;
}

describe("themes", () => {
  it("lists the installed themes without a login, the default theme first", async () => {
    const response = await app.inject({ url: "/api/v1/themes" });
    expect(response.statusCode).toBe(200);
    const themes = response.json<ListedTheme[]>();
    expect(themes.map((theme) => theme.id)).toEqual(["default", "paper"]);
    expect(themes[0]).toMatchObject({ logo: null });
    expect(themes[0]?.dark?.["bg"]).toBe("#0f172a");
    expect(themes[1]?.dark).toBeNull();
    expect(themes[1]?.logo).toMatch(/^\/api\/v1\/themes\/paper\/files\/logo\.svg\?v=[0-9a-f]{12}$/);
  });

  it("serves a theme's bundled files under their hash, and nothing else", async () => {
    const themes = (await app.inject({ url: "/api/v1/themes" })).json<ListedTheme[]>();
    const response = await app.inject({ url: themes[1]?.logo ?? "" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/svg+xml");
    expect(response.headers["cache-control"]).toContain("immutable");
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
    for (const url of [
      "/api/v1/themes/paper/files/open-parcels-theme.json",
      "/api/v1/themes/paper/files/..%2F..%2Fpackage.json",
      "/api/v1/themes/nope/files/logo.svg",
    ]) {
      expect((await app.inject({ url })).statusCode).toBe(404);
    }
  });
});
