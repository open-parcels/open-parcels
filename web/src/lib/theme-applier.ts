import { useEffect } from "react";
import { apiUrl } from "../api/fetcher";
import { useThemes, type ThemeView } from "../api/queries";
import {
  resolveMode,
  settleAppearance,
  useAppearance,
  useDeviceDark,
  type ResolvedMode,
} from "./theme";

/** The mode a theme fixes because it has one variant only, or null. */
function fixedMode(theme: ThemeView): ResolvedMode | null {
  if (theme.light === null) return "dark";
  if (theme.dark === null) return "light";
  return null;
}

const loadedFonts = new Set<string>();

/** Registers a theme's bundled fonts with the page (same origin, so the CSP allows them). */
function loadFonts(theme: ThemeView): void {
  if (typeof FontFace !== "function") return;
  for (const font of theme.fonts) {
    if (loadedFonts.has(font.url)) continue;
    loadedFonts.add(font.url);
    const face = new FontFace(font.family, `url("${apiUrl(font.url)}")`, {
      weight: font.weight,
      style: font.style,
    });
    document.fonts.add(face);
    void face.load().catch(() => undefined);
  }
}

/** Points the tab icons at the theme's icon, or back at the web UI's own. */
function setIcon(icon: string | null): void {
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')) {
    link.dataset["own"] ??= link.getAttribute("href") ?? "";
    link.href = icon === null ? link.dataset["own"] : apiUrl(icon);
  }
}

/**
 * Puts the chosen theme on the page: its tokens for the mode in effect on the root element (over
 * the stylesheet's), `data-mode` for the mode, its fonts and its icon. A theme no longer installed
 * falls back to the default one. Mounted once, at the top of the web UI.
 */
export function useThemeApplier(): void {
  const themes = useThemes();
  const { theme: chosen, mode } = useAppearance();
  const dark = useDeviceDark();
  const list = themes.data ?? [];
  const theme = list.find((candidate) => candidate.id === chosen) ?? list[0];
  const fixed = theme === undefined ? null : fixedMode(theme);
  const resolved = resolveMode(mode, fixed, dark);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset["mode"] = resolved;
    if (theme === undefined) {
      settleAppearance(null, null, false);
      return;
    }
    const tokens = { ...theme.tokens, ...(theme[resolved] ?? {}) };
    for (const [name, value] of Object.entries(tokens)) {
      root.style.setProperty(`--${name}`, value);
    }
    root.style.colorScheme = resolved;
    loadFonts(theme);
    setIcon(theme.icon);
    settleAppearance(fixed, theme.logo, true);
  }, [theme, resolved, fixed]);
}
