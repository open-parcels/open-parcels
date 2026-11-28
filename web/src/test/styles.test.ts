// The gate cannot see CSS: a class name with no rule renders as unstyled browser default.
/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Read from disk: with `css: false` the test run turns every CSS import into an empty module.
const partials = path.join(import.meta.dirname, "../styles");
const styles = readdirSync(partials)
  .filter((name) => name.endsWith(".css"))
  .map((name) => readFileSync(path.join(partials, name), "utf8"))
  .join("\n");
const index = readFileSync(path.join(import.meta.dirname, "../styles.css"), "utf8");

const sources = import.meta.glob<string>(["../**/*.tsx", "!../**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
});

function cssClasses(css: string): Set<string> {
  const withoutComments = css.replaceAll(/\/\*[\s\S]*?\*\//g, "");
  return new Set([...withoutComments.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1] ?? ""));
}

describe("styles.css", () => {
  it("imports every partial in styles/ exactly once", () => {
    const imported = [...index.matchAll(/@import "\.\/styles\/([\w-]+\.css)";/g)].map((m) => m[1]);
    const files = readdirSync(partials).filter((name) => name.endsWith(".css"));
    expect([...imported].sort()).toEqual([...files].sort());
    expect(new Set(imported).size).toBe(imported.length);
  });

  it("has a rule for every literal class name in the components", () => {
    const defined = cssClasses(styles);
    const missing = Object.entries(sources).flatMap(([file, source]) =>
      [...source.matchAll(/className="([^"]*)"/g)]
        .flatMap((m) => (m[1] ?? "").split(/\s+/))
        .filter((name) => name !== "" && !defined.has(name))
        .map((name) => `${file}: ${name}`),
    );
    expect(missing).toEqual([]);
  });
});
