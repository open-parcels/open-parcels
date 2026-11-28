import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadBuiltInThemes } from "../../src/builtin-themes.js";
import { loadTheme, loadThemeRepo, type Theme } from "../../src/themes/loader.js";

const STYLES = readFileSync(new URL("../../../web/src/styles/tokens.css", import.meta.url), "utf8");

/** The custom properties a rule of the web UI's stylesheet sets. */
function cssTokens(selector: string): Record<string, string> {
  const start = STYLES.indexOf(`${selector} {`);
  const body = STYLES.slice(STYLES.indexOf("{", start) + 1, STYLES.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1] ?? "", (m[2] ?? "").trim()]),
  );
}

function builtIn(): Theme {
  const theme = loadBuiltInThemes().themes[0];
  if (theme === undefined) throw new Error("no default theme");
  return theme;
}

describe("the built-in themes", () => {
  it("all load, the default theme first", () => {
    const loaded = loadBuiltInThemes();
    expect(loaded.rejected).toEqual([]);
    expect(loaded.themes.map((theme) => theme.id)).toEqual(["default", "paper"]);
    const paper = loaded.themes[1];
    expect(paper?.variants.dark).toBeUndefined();
    expect(paper?.variants.light?.bg).toBe("#f5f0e6");
    // What the example leaves out is the default theme's light value.
    expect(paper?.variants.light?.["map-home"]).toBe(builtIn().variants.light?.["map-home"]);
    expect(paper?.files.get("logo.svg")?.contentType).toBe("image/svg+xml");
  });

  it("has a default theme equal to the web UI's stylesheet", () => {
    const dark = cssTokens(":root");
    const { font, mono, radius, space, ...darkVariant } = dark;
    const theme = builtIn();
    expect(theme.shared).toEqual({ font, mono, radius, space });
    expect(theme.variants.dark).toEqual(darkVariant);
    expect(theme.variants.light).toEqual({
      ...darkVariant,
      ...cssTokens(':root[data-mode="light"]'),
    });
  });
});

describe("theme checks", () => {
  let dir: string;
  const valid = {
    schema: 1,
    id: "sample",
    name: "Sample",
    variants: { dark: { tokens: { accent: "#1d4ed8" } } },
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "op-themes-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** One theme in a repo of its own; the error it was rejected with, or null. */
  function check(manifest: unknown, files: Record<string, string | Buffer> = {}): string | null {
    mkdirSync(path.join(dir, "sample"), { recursive: true });
    writeFileSync(
      path.join(dir, "open-parcels-repo.json"),
      JSON.stringify({ schema: 1, themes: [{ id: "sample", folder: "sample" }] }),
    );
    writeFileSync(path.join(dir, "sample", "open-parcels-theme.json"), JSON.stringify(manifest));
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(path.join(dir, "sample", name), body);
    }
    const loaded = loadThemeRepo(dir, builtIn());
    return loaded.rejected[0]?.error ?? null;
  }

  it("loads a valid theme, filling what it leaves out from the default theme", () => {
    expect(check(valid)).toBeNull();
  });

  it("refuses unknown keys, unknown tokens and anything that is not a plain value", () => {
    expect(check({ ...valid, script: "main.js" })).toMatch(/script/);
    expect(check({ ...valid, variants: { dark: { tokens: { brand: "#000000" } } } })).toMatch(
      /brand/,
    );
    for (const bg of [
      "url(https://example.com/x.png)",
      "#0f172a; background: red",
      "var(--text)",
      "red",
    ]) {
      expect(check({ ...valid, variants: { dark: { tokens: { bg } } } })).toMatch(/bg/);
    }
    expect(check({ ...valid, font: "x; } body { display: none" })).toMatch(/font/);
    expect(check({ ...valid, variants: {} })).toMatch(/light or a dark/);
  });

  it("refuses a variant that fails the contrast check", () => {
    expect(check({ ...valid, variants: { dark: { tokens: { muted: "#334155" } } } })).toMatch(
      /contrast.*--muted on --bg/,
    );
  });

  it("takes bundled files only, and only safe ones", () => {
    expect(check({ ...valid, logo: "https://example.com/logo.svg" })).toMatch(/logo/);
    expect(check({ ...valid, logo: "../logo.svg" })).toMatch(/logo/);
    expect(check({ ...valid, logo: "logo.svg" })).toMatch(/logo\.svg is missing/);
    expect(
      check({ ...valid, logo: "logo.svg" }, { "logo.svg": "<svg><script>alert(1)</script></svg>" }),
    ).toMatch(/not a safe/);
    expect(
      check(
        { ...valid, logo: "logo.svg" },
        { "logo.svg": '<svg><image href="https://example.com/x.png"/></svg>' },
      ),
    ).toMatch(/not a safe/);
    expect(
      check(
        { ...valid, fonts: [{ family: "Sample", file: "sample.woff2" }] },
        { "sample.woff2": "not a font" },
      ),
    ).toMatch(/not a safe/);
    expect(
      check(
        { ...valid, fonts: [{ family: "Sample", file: "sample.woff2" }] },
        { "sample.woff2": Buffer.from("wOF2rest") },
      ),
    ).toBeNull();
  });

  it("loads a standalone theme folder the same way", () => {
    expect(check(valid)).toBeNull();
    expect(loadTheme(path.join(dir, "sample"), builtIn()).variants.dark?.accent).toBe("#1d4ed8");
    writeFileSync(
      path.join(dir, "sample", "open-parcels-theme.json"),
      JSON.stringify({ ...valid, variants: { dark: { tokens: { text: "#1e293b" } } } }),
    );
    expect(() => loadTheme(path.join(dir, "sample"), builtIn())).toThrow(/contrast/);
  });

  it("refuses a theme whose id differs from the repo manifest's, and the default theme's id", () => {
    expect(check({ ...valid, id: "other" })).toMatch(/other/);
    writeFileSync(
      path.join(dir, "open-parcels-repo.json"),
      JSON.stringify({ schema: 1, themes: [{ id: "default", folder: "sample" }] }),
    );
    expect(loadThemeRepo(dir, builtIn()).rejected[0]?.error).toMatch(/built in/);
  });
});
