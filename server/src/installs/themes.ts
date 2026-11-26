import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Logger } from "pino";
import { loadBuiltInThemes } from "../builtin-themes.js";
import { loadTheme, type Theme } from "../themes/loader.js";

/**
 * The themes the web UI can wear: the built-in ones, then those installed into
 * `<data>/installs/themes/<id>/` (`docs/themes.md`). Installed themes are checked again on every
 * load; one that fails is skipped with a warning.
 */
export class ThemeCatalog {
  readonly installDir: string;
  readonly defaultTheme: Theme;
  /** The default theme first. */
  readonly builtin: readonly Theme[];
  private readonly logger: Logger;
  private installed: readonly Theme[] = [];

  constructor(dataDir: string, logger: Logger) {
    this.installDir = path.join(dataDir, "installs", "themes");
    this.logger = logger;
    const loaded = loadBuiltInThemes();
    for (const { folder, error } of loaded.rejected) {
      logger.warn({ theme: folder, error }, "A theme failed its checks and is not loaded.");
    }
    this.builtin = loaded.themes;
    const first = loaded.themes[0];
    if (first === undefined) throw new Error("no default theme");
    this.defaultTheme = first;
    this.reload();
  }

  /** Reads the installed themes again (after an install, update or uninstall). */
  reload(): void {
    mkdirSync(this.installDir, { recursive: true });
    const taken = new Set(this.builtin.map((theme) => theme.id));
    const themes: Theme[] = [];
    for (const entry of readdirSync(this.installDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const dir = path.join(this.installDir, entry.name);
      try {
        const theme = loadTheme(dir, this.defaultTheme);
        if (theme.id !== entry.name || taken.has(theme.id)) throw new Error("its id does not fit");
        themes.push(theme);
      } catch (error) {
        this.logger.warn(
          { theme: entry.name, error: (error as Error).message },
          "An installed theme failed its checks and is not loaded.",
        );
      }
    }
    this.installed = themes;
  }

  /** The default theme first, then the other built-in ones, then the installed ones. */
  all(): readonly Theme[] {
    return [...this.builtin, ...this.installed];
  }

  builtinIds(): ReadonlySet<string> {
    return new Set(this.builtin.map((theme) => theme.id));
  }
}
