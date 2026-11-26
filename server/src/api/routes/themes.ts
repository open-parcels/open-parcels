import { z } from "zod";
import { loadBuiltInThemes } from "../../builtin-themes.js";
import { VARIANT_TOKENS } from "../../themes/manifest.js";
import type { Theme } from "../../themes/loader.js";
import type { Services } from "../../services.js";
import type { TypedApp } from "../app.js";
import { notFound } from "../errors.js";

const variantSchema = z
  .object(Object.fromEntries(VARIANT_TOKENS.map((token) => [token, z.string()])))
  .describe("Every token of the variant, by name without the leading `--`.");

const themeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  tokens: z
    .object({ font: z.string(), mono: z.string(), radius: z.string(), space: z.string() })
    .describe("The mode-independent tokens."),
  light: variantSchema.nullable().describe("The light variant; null when the theme has none."),
  dark: variantSchema.nullable().describe("The dark variant; null when the theme has none."),
  fonts: z.array(
    z.object({ family: z.string(), url: z.string(), weight: z.string(), style: z.string() }),
  ),
  logo: z.string().nullable().describe("URL of the header logo; null: the web UI's own."),
  icon: z.string().nullable().describe("URL of the browser tab icon; null: the web UI's own."),
});

function fileUrl(theme: Theme, file: string): string {
  const version = theme.files.get(file)?.version ?? "";
  return `/api/v1/themes/${encodeURIComponent(theme.id)}/files/${encodeURIComponent(file)}?v=${version}`;
}

function view(theme: Theme): z.infer<typeof themeSchema> {
  return {
    id: theme.id,
    name: theme.name,
    description: theme.description,
    tokens: theme.shared,
    light: theme.variants.light ?? null,
    dark: theme.variants.dark ?? null,
    fonts: theme.fonts.map((font) => ({
      family: font.family,
      url: fileUrl(theme, font.file),
      weight: font.weight,
      style: font.style,
    })),
    logo: theme.logo === null ? null : fileUrl(theme, theme.logo),
    icon: theme.icon === null ? null : fileUrl(theme, theme.icon),
  };
}

/**
 * The installed themes and their bundled files (`docs/themes.md`). Public like the web UI's own
 * files: the login page wears the theme too, and a theme says nothing about the user.
 */
export function registerThemeRoutes(app: TypedApp, services: Services): void {
  const loaded = loadBuiltInThemes();
  for (const { folder, error } of loaded.rejected) {
    services.logger.warn({ theme: folder, error }, "A theme failed its checks and is not loaded.");
  }
  const themes = loaded.themes;

  app.get(
    "/api/v1/themes",
    {
      schema: {
        tags: ["settings"],
        summary: "The installed themes, the default theme first.",
        security: [],
        response: { 200: z.array(themeSchema) },
      },
    },
    () => themes.map(view),
  );

  app.get(
    "/api/v1/themes/:id/files/:file",
    {
      schema: {
        tags: ["settings"],
        summary: "A file bundled with a theme (logo, icon, font); the theme list gives its URL.",
        security: [],
        params: z.object({ id: z.string(), file: z.string() }),
        querystring: z.object({ v: z.string().optional() }),
      },
    },
    (request, reply) => {
      const theme = themes.find((candidate) => candidate.id === request.params.id);
      const file = theme?.files.get(request.params.file);
      if (file === undefined) {
        throw notFound("route");
      }
      const immutable = request.query.v === file.version;
      return reply
        .header("content-type", file.contentType)
        .header("cache-control", immutable ? "public, max-age=31536000, immutable" : "no-cache")
        .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'")
        .send(file.body);
    },
  );
}
