/**
 * Unpacks the built-in providers from the pinned release of `open-parcels/open-parcels-providers`
 * (`docs/official-providers-repo.md`). The release is vendored as
 * `server/vendor/open-parcels-providers-<version>.tgz` and pinned by `openParcelsProviders` in
 * `server/package.json` (version and SHA-256); a tarball with another digest is refused.
 *
 * Every provider folder the repo manifest lists is laid out where the server builds and tests it:
 *   providers/<name>/          -> server/src/carriers/<name>/        (code, manifest, email rules)
 *   providers/<name>/test/     -> server/test/carriers/<name>/       (its tests)
 *   providers/<name>/fixtures/ -> server/test/fixtures/<kind>/<name>/ (made-up fixtures)
 * These paths are git-ignored: the providers repo is the only source. `npm ci` runs this
 * (root `postinstall`); `OPENPARCELS_PROVIDERS_DIR=<checkout>` lays out a local checkout of the
 * providers repo instead, to work on providers against this server.
 *
 * Runs on plain Node (type stripping), before anything is compiled: node: built-ins only.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Server folders that stay in this repo: the demo providers (made-up data, used by tests). */
const KEPT_CARRIERS = new Set(["demo", "demo_shop"]);
const STAMP = ".providers-release";

interface Pin {
  readonly version: string;
  readonly sha256: string;
}

interface Entry {
  readonly id: string;
  readonly folder: string;
}

function readPin(serverDir: string): Pin {
  const raw: unknown = JSON.parse(readFileSync(path.join(serverDir, "package.json"), "utf8"));
  const pin = (raw as { openParcelsProviders?: Partial<Pin> }).openParcelsProviders;
  if (typeof pin?.version !== "string" || typeof pin.sha256 !== "string") {
    throw new Error("server/package.json has no openParcelsProviders { version, sha256 }");
  }
  return { version: pin.version, sha256: pin.sha256 };
}

function readEntries(root: string): readonly Entry[] {
  const raw: unknown = JSON.parse(readFileSync(path.join(root, "open-parcels-repo.json"), "utf8"));
  const providers = (raw as { providers?: unknown }).providers;
  if (!Array.isArray(providers)) throw new Error("the repo manifest lists no providers");
  return providers.map((entry: unknown) => {
    const { id, folder } = entry as Partial<Entry>;
    if (typeof id !== "string" || !/^[a-z0-9_]{2,40}$/.test(id)) {
      throw new Error(`bad provider id ${String(id)}`);
    }
    if (typeof folder !== "string" || !/^[a-z0-9][a-z0-9_/-]{0,120}$/.test(folder)) {
      throw new Error(`bad folder for ${id}`);
    }
    if (folder.split("/").includes("..")) throw new Error(`bad folder for ${id}`);
    return { id, folder };
  });
}

/** Removes everything a previous run laid out, and nothing else. */
function clean(serverDir: string): void {
  const carriers = path.join(serverDir, "src", "carriers");
  for (const name of existsSync(carriers) ? readdirSync(carriers) : []) {
    if (!KEPT_CARRIERS.has(name)) rmSync(path.join(carriers, name), { recursive: true });
  }
  const tests = path.join(serverDir, "test", "carriers");
  for (const entry of existsSync(tests) ? readdirSync(tests, { withFileTypes: true }) : []) {
    if (entry.isDirectory()) rmSync(path.join(tests, entry.name), { recursive: true });
  }
  rmSync(path.join(serverDir, "test", "fixtures"), { recursive: true, force: true });
}

function layOut(serverDir: string, root: string, stamp: string): number {
  const entries = readEntries(root);
  clean(serverDir);
  for (const { folder } of entries) {
    const name = path.basename(folder);
    if (KEPT_CARRIERS.has(name)) throw new Error(`${name} is a server provider`);
    const from = path.join(root, folder);
    if (!existsSync(path.join(from, "open-parcels-provider.json"))) {
      throw new Error(`${folder} has no open-parcels-provider.json`);
    }
    cpSync(from, path.join(serverDir, "src", "carriers", name), {
      recursive: true,
      filter: (file) => {
        const rel = path.relative(from, file).split(path.sep)[0];
        return rel !== "test" && rel !== "fixtures";
      },
    });
    const test = path.join(from, "test");
    if (existsSync(test)) {
      cpSync(test, path.join(serverDir, "test", "carriers", name), { recursive: true });
    }
    const fixtures = path.join(from, "fixtures");
    for (const kind of existsSync(fixtures) ? readdirSync(fixtures) : []) {
      cpSync(path.join(fixtures, kind), path.join(serverDir, "test", "fixtures", kind, name), {
        recursive: true,
      });
    }
  }
  const carriers = path.join(serverDir, "src", "carriers");
  cpSync(path.join(root, "open-parcels-repo.json"), path.join(carriers, "open-parcels-repo.json"));
  writeFileSync(path.join(carriers, STAMP), `${stamp}\n`);
  return entries.length;
}

function fromRelease(serverDir: string): string {
  const pin = readPin(serverDir);
  const tarball = path.join(serverDir, "vendor", `open-parcels-providers-${pin.version}.tgz`);
  const digest = createHash("sha256").update(readFileSync(tarball)).digest("hex");
  if (digest !== pin.sha256) {
    throw new Error(`${path.basename(tarball)} has SHA-256 ${digest}, pinned is ${pin.sha256}`);
  }
  const stamp = `${pin.version} ${digest}`;
  const stampFile = path.join(serverDir, "src", "carriers", STAMP);
  if (existsSync(stampFile) && readFileSync(stampFile, "utf8").trim() === stamp) {
    return `providers ${pin.version} already laid out`;
  }
  const temp = mkdtempSync(path.join(tmpdir(), "open-parcels-providers-"));
  try {
    execFileSync("tar", ["-xzf", tarball, "-C", temp]);
    const count = layOut(serverDir, path.join(temp, "open-parcels-providers"), stamp);
    return `laid out ${String(count)} providers from open-parcels-providers ${pin.version}`;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function main(): void {
  const serverDir = path.resolve(import.meta.dirname, "..", "..");
  const local = process.env["OPENPARCELS_PROVIDERS_DIR"];
  if (local !== undefined && local !== "") {
    const root = path.resolve(local);
    const count = layOut(serverDir, root, `dir ${root}`);
    process.stdout.write(`laid out ${String(count)} providers from ${root}\n`);
    return;
  }
  mkdirSync(path.join(serverDir, "src", "carriers"), { recursive: true });
  process.stdout.write(`${fromRelease(serverDir)}\n`);
}

main();
