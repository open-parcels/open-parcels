// Contrast of the default theme's design tokens (WCAG 2.2 AA), in dark and light mode. jsdom
// cannot compute colours, so the axe checks of the pages leave contrast to this test. Installed
// themes pass the same checks when the server loads them (server/src/themes/contrast.ts).
/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(path.join(import.meta.dirname, "../styles/tokens.css"), "utf8");

type Rgba = readonly [number, number, number, number];

function tokens(selector: string): Record<string, string> {
  const start = styles.indexOf(`${selector} {`);
  const body = styles.slice(styles.indexOf("{", start) + 1, styles.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1] ?? "", (m[2] ?? "").trim()]),
  );
}

function parse(value: string | undefined): Rgba {
  if (value?.startsWith("#") === true && value.length === 7) {
    const hex = value.slice(1);
    return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)).concat(1) as unknown as Rgba;
  }
  const parts = /^rgba?\(([^)]*)\)$/
    .exec(value ?? "")?.[1]
    ?.split(",")
    .map(Number);
  if (parts === undefined || parts.length < 3) throw new Error(`Not a colour: ${String(value)}`);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
}

/** A translucent colour over an opaque one. */
function over(top: Rgba, below: Rgba): Rgba {
  const a = top[3];
  return [0, 1, 2]
    .map((i) => (top[i] ?? 0) * a + (below[i] ?? 0) * (1 - a))
    .concat(1) as unknown as Rgba;
}

function luminance(colour: Rgba): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(colour[0]) + 0.7152 * channel(colour[1]) + 0.0722 * channel(colour[2]);
}

function contrast(a: Rgba, b: Rgba): number {
  const [dark, light] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

const dark = tokens(":root");
const MODES = { dark, light: { ...dark, ...tokens(':root[data-mode="light"]') } };

/** Tokens used as text colours. */
const TEXT = [
  "text",
  "text-soft",
  "muted",
  "accent-hover",
  "danger",
  "ok",
  "warn",
  "yellow",
  "info",
  "purple",
  "violet",
  "rose",
];

describe.each(Object.entries(MODES))("the %s mode", (_name, theme) => {
  const bg = parse(theme["bg"]);
  const panel = over(parse(theme["panel"]), bg);

  it.each(TEXT)("has readable --%s text on the page and on panels (4.5:1)", (token) => {
    const colour = parse(theme[token]);
    expect(contrast(colour, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colour, panel)).toBeGreaterThanOrEqual(4.5);
  });

  it("has readable text on accent buttons and a visible focus ring", () => {
    expect(contrast(parse(theme["accent-text"]), parse(theme["accent"]))).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrast(parse(theme["focus"]), bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(parse(theme["focus"]), panel)).toBeGreaterThanOrEqual(3);
  });
});

describe("light mode", () => {
  it("is the same whether the device or the user picked it", () => {
    expect(tokens(':root:not([data-mode="dark"])')).toEqual(tokens(':root[data-mode="light"]'));
  });
});
