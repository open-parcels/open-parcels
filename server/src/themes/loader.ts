import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseRepoManifest } from "../provider/repo-manifest.js";
import { contrastFailures } from "./contrast.js";
import {
  MODES,
  parseThemeManifest,
  VARIANT_TOKENS,
  type ThemeManifest,
  type ThemeMode,
} from "./manifest.js";

/**
 * Loads themes from folders (`docs/themes.md`): the manifest, the contrast of every variant and
 * every bundled file are checked, and a theme that fails any check is not loaded. Built-in themes
 * come from the server's `themes/` folder; the registry will hand installed ones to `loadTheme`.
 */

const MANIFEST = "open-parcels-theme.json";
const REPO_MANIFEST = "open-parcels-repo.json";
const DEFAULT_THEME = "default";

type VariantTokens = Readonly<Record<(typeof VARIANT_TOKENS)[number], string>>;

/** The mode-independent tokens. */
interface SharedTokens {
  readonly font: string;
  readonly mono: string;
  readonly radius: string;
  readonly space: string;
}

interface ThemeFile {
  readonly body: Buffer;
  readonly contentType: string;
  /** Short content hash: part of the file's URL, so it can be cached for good. */
  readonly version: string;
}

export interface Theme {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly shared: SharedTokens;
  /** Complete token sets: what the manifest leaves out is the default theme's. */
  readonly variants: Readonly<Partial<Record<ThemeMode, VariantTokens>>>;
  readonly fonts: readonly { family: string; file: string; weight: string; style: string }[];
  readonly logo: string | null;
  readonly icon: string | null;
  /** The bundled files the manifest names, by file name. */
  readonly files: ReadonlyMap<string, ThemeFile>;
}

export interface LoadedThemes {
  /** The default theme first. */
  readonly themes: readonly Theme[];
  /** Themes that failed a check, with the reason; the others load. */
  readonly rejected: readonly { readonly folder: string; readonly error: string }[];
}

const KIB = 1024;
const KINDS: Readonly<
  Record<string, { type: string; max: number; valid: (b: Buffer) => boolean }>
> = {
  svg: { type: "image/svg+xml", max: 256 * KIB, valid: (body) => safeSvg(body.toString("utf8")) },
  png: {
    type: "image/png",
    max: 256 * KIB,
    valid: (body) => body.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
  },
  woff2: {
    type: "font/woff2",
    max: 512 * KIB,
    valid: (body) => body.subarray(0, 4).toString("latin1") === "wOF2",
  },
};

/**
 * An SVG that cannot run code or reach anything: no scripts, event handlers, foreign content,
 * entities, style imports, or links and `url()`s other than to its own `#fragments`.
 */
const UNSAFE_SVG =
  /<script|<foreignObject|<!ENTITY|<!DOCTYPE|\son[a-z]+\s*=|javascript:|@import|href\s*=\s*["']?(?!#)|url\(\s*["']?(?!#)/i;

function safeSvg(text: string): boolean {
  return text.includes("<svg") && !UNSAFE_SVG.test(text);
}

function readFile(dir: string, file: string): ThemeFile {
  const kind = KINDS[file.slice(file.lastIndexOf(".") + 1)];
  const where = path.join(dir, file);
  if (kind === undefined || !existsSync(where)) throw new Error(`${file} is missing`);
  if (statSync(where).size > kind.max) {
    throw new Error(`${file} is larger than ${String(kind.max / KIB)} KiB`);
  }
  const body = readFileSync(where);
  if (!kind.valid(body)) throw new Error(`${file} is not a safe ${kind.type} file`);
  const version = createHash("sha256").update(body).digest("hex").slice(0, 12);
  return { body, contentType: kind.type, version };
}

function variantTokens(
  manifest: ThemeManifest,
  mode: ThemeMode,
  base: Theme | null,
): VariantTokens | undefined {
  const own = manifest.variants[mode]?.tokens;
  if (own === undefined) return undefined;
  const fallback = base?.variants[mode] ?? base?.variants.dark ?? base?.variants.light;
  const merged: Record<string, string> = {};
  for (const token of VARIANT_TOKENS) {
    const value = own[token] ?? fallback?.[token];
    if (value === undefined) throw new Error(`variants.${mode}.tokens.${token} is missing`);
    merged[token] = value;
  }
  const failures = contrastFailures(merged);
  if (failures.length > 0) {
    throw new Error(`the ${mode} variant fails the contrast check: ${failures.join("; ")}`);
  }
  return merged as VariantTokens;
}

function sharedTokens(manifest: ThemeManifest, base: Theme | null): SharedTokens {
  const pick = (key: keyof SharedTokens): string => {
    const value = manifest[key] ?? base?.shared[key];
    if (value === undefined) throw new Error(`${key} is missing`);
    return value;
  };
  return { font: pick("font"), mono: pick("mono"), radius: pick("radius"), space: pick("space") };
}

/**
 * Loads one theme folder. `base` is the default theme, whose tokens fill what this one leaves
 * out; only the default theme itself loads without one and must then set every token. Throws
 * with the reason when a check fails.
 */
export function loadTheme(dir: string, base: Theme | null): Theme {
  const manifestPath = path.join(dir, MANIFEST);
  if (!existsSync(manifestPath)) throw new Error(`${MANIFEST} is missing`);
  if (statSync(manifestPath).size > 64 * KIB) throw new Error(`${MANIFEST} is too large`);
  const manifest = parseThemeManifest(
    JSON.parse(readFileSync(manifestPath, "utf8")) as unknown,
    dir,
  );
  const variants: Partial<Record<ThemeMode, VariantTokens>> = {};
  for (const mode of MODES) {
    const tokens = variantTokens(manifest, mode, base);
    if (tokens !== undefined) variants[mode] = tokens;
  }
  const names = [
    ...manifest.fonts.map((font) => font.file),
    ...[manifest.logo, manifest.icon].filter((file) => file !== undefined),
  ];
  const files = new Map(names.map((file) => [file, readFile(dir, file)]));
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description ?? null,
    shared: sharedTokens(manifest, base),
    variants,
    fonts: manifest.fonts,
    logo: manifest.logo ?? null,
    icon: manifest.icon ?? null,
    files,
  };
}

/**
 * Loads the themes a repository's manifest lists. The default theme comes from `base`, or, for
 * the server's own themes, from this repository, where it must be listed and load.
 */
export function loadThemeRepo(dir: string, base: Theme | null): LoadedThemes {
  const repo = parseRepoManifest(
    JSON.parse(readFileSync(path.join(dir, REPO_MANIFEST), "utf8")) as unknown,
    dir,
  );
  let defaultTheme = base;
  if (defaultTheme === null) {
    const entry = repo.themes.find((theme) => theme.id === DEFAULT_THEME);
    if (entry === undefined) throw new Error(`${dir} does not list the default theme`);
    defaultTheme = loadTheme(path.join(dir, entry.folder), null);
  }
  const themes: Theme[] = base === null ? [defaultTheme] : [];
  const rejected: { folder: string; error: string }[] = [];
  for (const entry of repo.themes) {
    if (base === null && entry.id === DEFAULT_THEME) continue;
    try {
      if (entry.id === DEFAULT_THEME) throw new Error("the default theme is built in");
      const theme = loadTheme(path.join(dir, entry.folder), defaultTheme);
      if (theme.id !== entry.id) {
        throw new Error(`its id is ${theme.id}, the repo manifest says ${entry.id}`);
      }
      themes.push(theme);
    } catch (error) {
      rejected.push({ folder: entry.folder, error: (error as Error).message });
    }
  }
  return { themes, rejected };
}
