import { fileURLToPath } from "node:url";
import { loadThemeRepo, type LoadedThemes } from "./themes/loader.js";

/**
 * The built-in themes (`server/themes/`, listed by its `open-parcels-repo.json`). This module sits
 * at the top of `src`, like `logos.ts`, so `../themes` resolves the same from `src`, `dist` and the
 * bundle (`tools/bundle.ts` copies the folder).
 */
const THEME_DIR = fileURLToPath(new URL("../themes/", import.meta.url));

/** Loads them once at start-up; a broken default theme stops the start. */
export function loadBuiltInThemes(dir: string = THEME_DIR): LoadedThemes {
  return loadThemeRepo(dir, null);
}
