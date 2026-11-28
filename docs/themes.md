# Themes

Design note for TODO §3 "Themes". It narrows decision record [0002](decisions/0002-providers.md)
owner decision 10 to what is built now: the theme format, its checks, the built-in themes and the
two settings. Themes also install from git repositories on the Providers page (§4).

## 1. Two settings

- **Theme:** the default theme or an installed one. Chosen in the web UI's header when more than
  one is installed; kept in the browser's local storage (`open-parcels.theme-id`), like the
  language. A theme that is no longer installed falls back to the default one.
- **Mode:** Automatic (follows the device), Light or Dark (`open-parcels.mode`). A theme with one
  variant fixes the mode; the Mode picker then shows that variant and is disabled.
- **Migration:** the light/dark-only setting (`open-parcels.theme`: `system`, `light`, `dark`)
  became the mode on the first start of this version (`migrateStoredAppearance`), with the default
  theme; the old key is removed.

## 2. The theme manifest (format 1)

Every theme is a folder with `open-parcels-theme.json` and the files it names. The schema is
`server/src/themes/manifest.ts` (zod), the only parser; it refuses unknown keys.

```json
{
  "schema": 1,
  "id": "paper",
  "name": "Paper",
  "description": "Warm paper tones, serif type. Light only.",
  "variants": { "light": { "tokens": { "bg": "#f5f0e6", "text": "#2b2118" } } },
  "font": "Georgia, \"Palatino Linotype\", serif",
  "radius": "6px",
  "space": "18px",
  "fonts": [{ "family": "Example Sans", "file": "example-sans.woff2", "weight": "400 700" }],
  "logo": "logo.svg",
  "icon": "logo.svg"
}
```

- **Declarative only.** Design tokens, font stacks, bundled fonts (WOFF2), a bundled logo and
  icon (SVG or PNG). No code, no URLs: file names have no path, token values are plain colours
  (`#rrggbb`, `rgb()`, `rgba()`), single box shadows, or the map filter's functions; nothing that
  could close a rule, `url(…)`, `var(…)` or `@import`. The web UI's CSP stays as it is: fonts and
  pictures come from this server (`/api/v1/themes/<id>/files/<file>`).
- **Variants:** `light`, `dark` or both. Tokens a variant leaves out take the default theme's value
  for the same mode, as do unset `font`, `mono`, `radius` and `space`.
- **Tokens:** the custom properties in `web/src/styles/tokens.css`, by name without `--`:
  surfaces, text, accents, status colours, shadows, and the map style (`map-filter` for the tiles
  in dark mode, `map-route*` for lines, `map-*` for markers). The web UI's rules use nothing else.
- **Checked on load** (`server/src/themes/loader.ts`); a theme that fails is not loaded and the
  server logs why: the manifest parses; every variant passes the contrast check (WCAG 2.2 AA, as
  the web UI's own test: text 4.5:1 on the page and on panels, text on accent buttons 4.5:1, the
  focus ring 3:1); every named file exists, is at most 256 KiB (images) or 512 KiB (fonts), and is
  what its extension says; an SVG has no script, event handler, foreign content, entity, import,
  or link and `url()` other than to its own `#fragments`; the id matches the repo manifest's and
  is not `default`.

## 3. Built-in themes and the repo manifest

- `server/themes/open-parcels-repo.json` is a repo manifest (`server/src/provider/repo-manifest.ts`,
  format 1, `themes: [{ id, folder }]`), the same format a provider repository will use; it also
  takes `consumers: [{ id, folder }]` ([`consumers.md`](consumers.md)), and `providers` is added by
  the step that reads it ([`official-providers-repo.md`](official-providers-repo.md)).
- **`default`:** the web UI's own look. Its manifest holds the same values as the stylesheet, and a
  test keeps both equal; the stylesheet paints the page before the theme list arrives.
- **`paper`:** an example with one light variant, its own font stack, radius, spacing and logo.
- `GET /api/v1/themes` lists the loaded themes (public, like the web UI's files) with complete
  token sets; the web UI puts the chosen variant's tokens on the root element.

## 4. Installing from repositories

Installing themes from git repositories is built (2026-11-26, `docs/registry-and-installs.md`):
the Providers page checks a repository, downloads the theme's manifest and bundled files at the
pinned commit into `<data>/installs/themes/<id>/` and loads it with
`loadTheme(folder, defaultTheme)`, which runs every check above; a theme that fails is not
installed.
