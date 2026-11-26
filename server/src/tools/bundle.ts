/**
 * Bundles the server for the image (decision record 0004 §6): one ESM bundle per entry point with
 * every pure-JavaScript dependency inside, plus only the native modules and what they load at run
 * time. The image then needs no `node_modules` tree of the whole server.
 *
 * Usage, from `server/` after `npm run build`: node dist/tools/bundle.js <output folder>
 * The output folder mirrors the image's /app: `server/dist/…` and `node_modules/…`.
 */
import { cpSync, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";

/** Loaded from `node_modules` at run time: compiled code that cannot be bundled. */
const NATIVE = ["better-sqlite3", "sharp"];
/**
 * What better-sqlite3 loads at run time: its JavaScript and the addon, compiled here or the
 * prebuilt one for this (glibc) platform; not the SQLite sources and the other platforms' builds.
 */
function runtimeFile(dir: string, file: string): boolean {
  if (path.basename(dir) !== "better-sqlite3") return true;
  const relative = path.relative(dir, file);
  return (
    relative === "" ||
    relative === "package.json" ||
    relative === "lib" ||
    relative.startsWith(`lib${path.sep}`) ||
    relative === "build" ||
    relative === path.join("build", "Release") ||
    relative === path.join("build", "Release", "better_sqlite3.node") ||
    relative === "prebuilds" ||
    relative === path.join("prebuilds", `linux-${process.arch}.node`)
  );
}

/** Needed only to compile a native module, never at run time. */
const BUILD_ONLY = new Set(["node-addon-api"]);
/**
 * The server, the tools the README tells people to run inside the container, and the provider
 * guest of the sandbox (`OPENPARCELS_PROVIDER_ISOLATION=pool`), which the server finds at
 * `dist/sandbox/`.
 */
const ENTRIES = [
  "main",
  "tools/restore-backup",
  "tools/import-legacy",
  "tools/import-ha",
  "sandbox/provider-guest",
];
/**
 * The sandbox's child runtime, built on its own: the host imports its types and helpers, and
 * shared into a chunk it would no longer be the process's entry module (`import.meta.main`).
 */
const CHILD = "sandbox/child";

interface Manifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
}

/** The folder npm installed `name` into for a package in `from`: nested first, then hoisted. */
function packageDir(root: string, from: string, name: string): string | undefined {
  for (let dir = from; ;) {
    const candidate = path.join(dir, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    if (dir === root) return undefined;
    // Up to the package that holds the `node_modules` this one sits in (scopes included).
    let up = path.dirname(dir);
    while (path.basename(up) !== "node_modules") up = path.dirname(up);
    dir = path.dirname(up);
  }
}

/** Every package folder `names` need at run time; optional ones not installed are skipped. */
function runtimeClosure(root: string, names: readonly string[]): Set<string> {
  const found = new Set<string>();
  const visit = (from: string, name: string, optional: boolean): void => {
    if (BUILD_ONLY.has(name)) return;
    const dir = packageDir(root, from, name);
    if (dir === undefined) {
      if (optional) return;
      throw new Error(`${name} is not installed (needed by ${from}).`);
    }
    if (found.has(dir)) return;
    found.add(dir);
    const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as Manifest;
    for (const dependency of Object.keys(manifest.dependencies ?? {}))
      visit(dir, dependency, false);
    for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) {
      visit(dir, dependency, true);
    }
  };
  for (const name of names) visit(root, name, false);
  return found;
}

async function main(): Promise<void> {
  const target = process.argv[2];
  if (target === undefined) {
    process.stderr.write("Usage: node dist/tools/bundle.js <output folder>\n");
    process.exit(2);
  }
  const out = path.resolve(target);
  const serverDir = process.cwd();
  const root = path.dirname(serverDir);
  const outDir = path.join(out, "server", "dist");
  await build({
    entryPoints: [{ in: `src/${CHILD}.ts`, out: CHILD }],
    outdir: outDir,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node26",
    legalComments: "none",
    logLevel: "warning",
  });
  await build({
    entryPoints: ENTRIES.map((entry) => ({ in: `src/${entry}.ts`, out: entry })),
    outdir: outDir,
    bundle: true,
    splitting: true,
    // Shared chunks sit next to main.js, so `new URL("../package.json", import.meta.url)` in any
    // of them still finds server/package.json, as in the unbundled build.
    chunkNames: "[name]-[hash]",
    platform: "node",
    format: "esm",
    target: "node26",
    external: NATIVE,
    // Bundled CommonJS packages call require(); ESM has none of its own.
    banner: {
      js: "import { createRequire as __openParcelsRequire } from 'node:module'; const require = __openParcelsRequire(import.meta.url);",
    },
    legalComments: "none",
    logLevel: "warning",
  });
  // The rules read their bundle next to their own module, which is now one of these files.
  const resolver = createRequire(path.join(serverDir, "package.json"));
  cpSync(resolver.resolve("open-parcels-rules/bundle.json"), path.join(outDir, "bundle.json"));
  // The providers' logos, next to dist/ as in the source tree (src/logos.ts reads ../logos).
  cpSync(path.join(serverDir, "logos"), path.join(out, "server", "logos"), { recursive: true });
  // The built-in themes, the same way (src/builtin-themes.ts reads ../themes).
  cpSync(path.join(serverDir, "themes"), path.join(out, "server", "themes"), { recursive: true });
  for (const dir of runtimeClosure(root, NATIVE)) {
    cpSync(dir, path.join(out, path.relative(root, dir)), {
      recursive: true,
      filter: (file) => runtimeFile(dir, file),
    });
  }
}

await main();
