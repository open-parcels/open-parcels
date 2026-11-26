/**
 * WCAG 2.2 AA contrast of a theme variant's tokens. The same checks as the web UI's contrast test
 * of its stylesheet (`web/src/test/contrast.test.ts`); a theme that fails one is not loaded.
 */

type Rgba = readonly [number, number, number, number];

/** Tokens used as text colours, on the page and on panels. */
const TEXT_TOKENS = [
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
] as const;

const COLOUR = /^#([0-9a-f]{6})$|^rgba?\(([^)]*)\)$/i;

/** `#rrggbb`, `rgb(r, g, b)` or `rgba(r, g, b, a)`; the manifest schema allows no other form. */
function parseColour(value: string): Rgba {
  const match = COLOUR.exec(value);
  const hex = match?.[1];
  if (hex !== undefined) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      1,
    ];
  }
  const parts = (match?.[2] ?? "").split(",").map((part) => Number(part.trim()));
  if (parts.length < 3 || parts.length > 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`not a colour: ${value}`);
  }
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
}

/** A translucent colour over an opaque one. */
function over(top: Rgba, below: Rgba): Rgba {
  const a = top[3];
  const mix = (i: 0 | 1 | 2): number => top[i] * a + below[i] * (1 - a);
  return [mix(0), mix(1), mix(2), 1];
}

function luminance(colour: Rgba): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(colour[0]) + 0.7152 * channel(colour[1]) + 0.0722 * channel(colour[2]);
}

function ratio(a: Rgba, b: Rgba): number {
  const [dark, light] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/**
 * The contrast failures of one variant's complete token set, as readable messages; empty when it
 * passes: text tokens 4.5:1 on the page and on panels, text on accent buttons 4.5:1, the focus
 * ring 3:1 on both.
 */
export function contrastFailures(tokens: Readonly<Record<string, string>>): string[] {
  const read = (name: string): Rgba => parseColour(tokens[name] ?? "");
  const bg = over(read("bg"), [255, 255, 255, 1]);
  const panel = over(read("panel"), bg);
  const failures: string[] = [];
  const need = (what: string, colour: Rgba, below: Rgba, minimum: number): void => {
    const value = ratio(over(colour, below), below);
    if (value < minimum) {
      failures.push(`${what}: ${value.toFixed(2)}:1, needs ${String(minimum)}:1`);
    }
  };
  for (const name of TEXT_TOKENS) {
    need(`--${name} on --bg`, read(name), bg, 4.5);
    need(`--${name} on --panel`, read(name), panel, 4.5);
  }
  need("--accent-text on --accent", read("accent-text"), over(read("accent"), bg), 4.5);
  need("--focus on --bg", read("focus"), bg, 3);
  need("--focus on --panel", read("focus"), panel, 3);
  return failures;
}
