import { z } from "zod";

/**
 * The theme manifest, format 1 (`docs/themes.md`): a declarative look for the web UI. Every
 * theme has one (`open-parcels-theme.json` in its folder); this schema is the only parser. A
 * theme holds design tokens, font stacks, bundled fonts and a bundled logo and icon: no code, no
 * URLs, nothing the page could load from anywhere but this server.
 */

/** Colour tokens: `#rrggbb`, `rgb(…)` or `rgba(…)`. The contrast check reads them. */
const COLOUR_TOKENS = [
  "bg",
  "glow-1",
  "glow-2",
  "panel",
  "panel-solid",
  "panel-border",
  "tint",
  "tint-strong",
  "field",
  "backdrop",
  "text",
  "text-soft",
  "muted",
  "accent",
  "accent-hover",
  "accent-soft",
  "accent-line",
  "accent-text",
  "monogram-text",
  "violet",
  "focus",
  "danger",
  "ok",
  "warn",
  "yellow",
  "info",
  "purple",
  "rose",
  "map-route",
  "map-route-reached",
  "map-marker-shadow",
  "map-home",
  "map-parcel",
  "map-truck",
  "map-van",
  "map-plane",
  "map-ship",
  "map-train",
  "map-heli",
  "map-bike",
  "map-start",
  "map-stop",
] as const;

/** Box shadows, one shadow each. */
const SHADOW_TOKENS = ["shadow", "shadow-raised", "shadow-overlay"] as const;

/** The map style: the filter on the map tiles in dark mode. */
const FILTER_TOKENS = ["map-filter"] as const;

/** Every token a variant may set. */
export const VARIANT_TOKENS = [...COLOUR_TOKENS, ...SHADOW_TOKENS, ...FILTER_TOKENS] as const;
type VariantToken = (typeof VARIANT_TOKENS)[number];

const BYTE = String.raw`(?:25[0-5]|2[0-4]\d|1\d\d|\d?\d)`;
const ALPHA = String.raw`(?:0|1|0?\.\d{1,3})`;
const COLOUR = String.raw`(?:#[0-9a-f]{6}|rgb\(${BYTE}, ${BYTE}, ${BYTE}\)|rgba\(${BYTE}, ${BYTE}, ${BYTE}, ${ALPHA}\))`;
const LENGTH = String.raw`(?:0|-?\d{1,3}(?:\.\d{1,2})?px)`;

const colour = z.string().regex(new RegExp(`^${COLOUR}$`), "a colour: #rrggbb, rgb() or rgba()");
const shadow = z
  .string()
  .regex(
    new RegExp(`^(?:inset )?${LENGTH}(?: ${LENGTH}){1,3} ${COLOUR}$`),
    "one box shadow: offsets, blur, spread in px and a colour",
  );
const filter = z
  .string()
  .regex(
    /^(?:none|(?:(?:invert|grayscale|sepia|saturate|brightness|contrast)\(\d{1,3}(?:\.\d{1,2})?%?\)|hue-rotate\(-?\d{1,3}deg\))(?: (?:(?:invert|grayscale|sepia|saturate|brightness|contrast)\(\d{1,3}(?:\.\d{1,2})?%?\)|hue-rotate\(-?\d{1,3}deg\))){0,5})$/,
    "none, or up to six of invert, grayscale, sepia, saturate, brightness, contrast, hue-rotate",
  );

function tokenSchema(token: VariantToken): z.ZodString {
  if ((SHADOW_TOKENS as readonly string[]).includes(token)) return shadow;
  if ((FILTER_TOKENS as readonly string[]).includes(token)) return filter;
  return colour;
}

const variantSchema = z.strictObject({
  /** Unset tokens take the default theme's value for the same mode. */
  tokens: z.strictObject(
    Object.fromEntries(
      VARIANT_TOKENS.map((token) => [token, tokenSchema(token).optional()]),
    ) as Record<VariantToken, z.ZodOptional<z.ZodString>>,
  ),
});

/** A bundled file in the theme's folder: no path, no URL. */
const fileName = (extensions: string) =>
  z.string().regex(new RegExp(`^[a-z0-9][a-z0-9_-]{0,60}\\.(?:${extensions})$`));

/** A font stack: family names, quoted or not, separated by commas. */
const fontStack = z
  .string()
  .max(300)
  .regex(
    /^(?:"[A-Za-z0-9 -]{1,60}"|-?[A-Za-z][A-Za-z0-9-]{0,60})(?:, (?:"[A-Za-z0-9 -]{1,60}"|-?[A-Za-z][A-Za-z0-9-]{0,60}))*$/,
    "font family names separated by commas",
  );

const length = z.string().regex(/^\d{1,2}(?:\.\d{1,2})?(?:px|rem)$/, "a length in px or rem");

export const MODES = ["light", "dark"] as const;
export type ThemeMode = (typeof MODES)[number];

const themeManifestSchema = z.strictObject({
  schema: z.literal(1),
  id: z.string().regex(/^[a-z0-9_]{2,40}$/),
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(300).optional(),
  /** A light and a dark variant, or one that fixes the mode. */
  variants: z
    .strictObject({ light: variantSchema.optional(), dark: variantSchema.optional() })
    .refine((variants) => variants.light !== undefined || variants.dark !== undefined, {
      message: "a theme needs a light or a dark variant",
    }),
  /** Mode-independent tokens; unset ones take the default theme's. */
  font: fontStack.optional(),
  mono: fontStack.optional(),
  radius: length.optional(),
  space: length.optional(),
  /** Fonts bundled with the theme (WOFF2), usable by name in `font` and `mono`. */
  fonts: z
    .array(
      z.strictObject({
        family: z.string().regex(/^[A-Za-z][A-Za-z0-9 -]{0,59}$/),
        file: fileName("woff2"),
        weight: z
          .string()
          .regex(/^[1-9]00(?: [1-9]00)?$/)
          .default("400"),
        style: z.enum(["normal", "italic"]).default("normal"),
      }),
    )
    .max(8)
    .default([]),
  /** Shown in the header next to the name. */
  logo: fileName("svg|png").optional(),
  /** The browser tab's icon. */
  icon: fileName("svg|png").optional(),
});
export type ThemeManifest = z.infer<typeof themeManifestSchema>;

/** Parses a theme manifest; the error names the theme's folder and every problem. */
export function parseThemeManifest(raw: unknown, where: string): ThemeManifest {
  const parsed = themeManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new Error(`Theme manifest of ${where} is not valid: ${problems.join("; ")}`);
  }
  return parsed.data;
}
