import { useSyncExternalStore } from "react";

/**
 * The two appearance settings (`docs/themes.md`): the theme (an installed one; `default` is the
 * web UI's own stylesheet) and the mode. Both are preferences, not secrets, and the only things
 * besides the language the UI keeps in local storage.
 */
export type Mode = "automatic" | "light" | "dark";
export type ResolvedMode = "light" | "dark";

const DEFAULT_THEME = "default";
const THEME_KEY = "open-parcels.theme-id";
const MODE_KEY = "open-parcels.mode";
/** Where the light/dark-only setting lived before themes; `migrateStoredAppearance` moves it. */
const OLD_KEY = "open-parcels.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Moves the setting from before themes (`system`, `dark` or `light`) to the mode, once: the theme
 * becomes the default one, the old key is removed (CHANGELOG 2.0.0-dev).
 */
export function migrateStoredAppearance(): void {
  const old = localStorage.getItem(OLD_KEY);
  if (old === null) return;
  if (old === "dark" || old === "light") localStorage.setItem(MODE_KEY, old);
  localStorage.removeItem(OLD_KEY);
}

interface Appearance {
  readonly theme: string;
  readonly mode: Mode;
  /** Set while the theme in effect has one variant only: it fixes the mode. */
  readonly fixed: ResolvedMode | null;
  /** The theme's header logo, or null for the web UI's own. */
  readonly logo: string | null;
  /** Counts how often tokens were put on the page, so readers of computed values re-read. */
  readonly revision: number;
}

function storedMode(): Mode {
  const value = localStorage.getItem(MODE_KEY);
  return value === "dark" || value === "light" ? value : "automatic";
}

/**
 * One store for both settings, so every reader (the header, the maps) sees a change at once
 * instead of only on its next render (OP-150).
 */
let current: Appearance | null = null;
const listeners = new Set<() => void>();

function appearance(): Appearance {
  current ??= {
    theme: localStorage.getItem(THEME_KEY) ?? DEFAULT_THEME,
    mode: storedMode(),
    fixed: null,
    logo: null,
    revision: 0,
  };
  return current;
}

function update(change: Partial<Appearance>): void {
  current = { ...appearance(), ...change };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function remember(key: string, value: string, fallback: string): void {
  if (value === fallback) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
}

export function setTheme(theme: string): void {
  remember(THEME_KEY, theme, DEFAULT_THEME);
  update({ theme });
}

export function setMode(mode: Mode): void {
  remember(MODE_KEY, mode, "automatic");
  update({ mode });
}

/** What the theme applier found; it notifies readers only when something changed. */
export function settleAppearance(
  fixed: ResolvedMode | null,
  logo: string | null,
  applied: boolean,
): void {
  const now = appearance();
  if (now.fixed === fixed && now.logo === logo && !applied) return;
  update({ fixed, logo, revision: applied ? now.revision + 1 : now.revision });
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, appearance);
}

function subscribeDevice(listener: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", listener);
  return () => {
    query.removeEventListener("change", listener);
  };
}

function deviceDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
}

/** The mode in effect for a choice: the theme's only one, the chosen one, or the device's. */
export function resolveMode(mode: Mode, fixed: ResolvedMode | null, dark: boolean): ResolvedMode {
  if (fixed !== null) return fixed;
  if (mode === "automatic") return dark ? "dark" : "light";
  return mode;
}

/** Whether the device prefers dark, following its changes. */
export function useDeviceDark(): boolean {
  return useSyncExternalStore(subscribeDevice, deviceDark);
}

/** The mode in effect, following the settings, the theme and the device. */
export function useResolvedMode(): ResolvedMode {
  const { mode, fixed } = useAppearance();
  return resolveMode(mode, fixed, useDeviceDark());
}

/**
 * A token's value as the page has it now (for drawings that take a colour, not CSS: the map's
 * lines). Read again whenever the theme applier put tokens on the page or the mode changed.
 */
export function useTokenValue(name: string): string {
  useAppearance();
  useResolvedMode();
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  return value === "" ? "currentColor" : value;
}
