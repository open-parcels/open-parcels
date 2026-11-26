# One repo for the official providers

TODO §3 "One repo with a folder per provider for the official providers; repo manifest lists
them". It narrows decision record [0002](decisions/0002-providers.md) §3.1 step 4 and P5 to the
owner decisions of 2026-11-23 (one repo, one folder per provider, a repo manifest, no
per-provider tags) and 2026-11-26 (below). **Built on 2026-11-26:** the repository exists, the
built-in providers live only there, and the server takes a pinned release.

## Owner decisions (2026-11-26)

1. **Name:** `open-parcels-providers` in the GitHub organisation `open-parcels`
   (<https://github.com/open-parcels/open-parcels-providers>).
2. **Fresh start, no history:** the repository starts with one commit; the providers' history
   stays in this repository (everything before the commit that removed `server/src/carriers/`).
3. **A release on every change, one version for the whole repository:** each change to `main` is
   tagged `vX.Y.Z` with its tarball attached; a provider carries no version of its own.

## What it is

- **`open-parcels/open-parcels-providers`**: one folder per official provider
  (`providers/<name>/`), each with its `open-parcels-provider.json`, code, email rules, `test/`
  and made-up `fixtures/<kind>/`. The demo providers (`demo`, `demo_shop`) stay in this server:
  they serve made-up data for tests and the demo mode.
- **The repo manifest** (`open-parcels-repo.json` at the root) lists every provider (`id`,
  `kind` (`code` or `declarative`), `folder`), themes and consumers (0002 owner decision 10,
  0005). Its schema is `server/src/provider/repo-manifest.ts`; a folder may be two segments
  (`providers/dhl`). The id is the provider's manifest id, so `17track` lives in
  `providers/seventeen_track`.
- **One version for the repo**, tags `vX.Y.Z` (`tools/release.sh` there tags and builds the
  tarball with `git archive --prefix=open-parcels-providers/`). GitHub Actions: one release
  workflow, `workflow_dispatch` only.
- **Built-in tier stays.** The image takes a pinned release, so the HA app, the HA Pi and
  air-gapped installs keep every official carrier without installing anything.

## How the server takes them (mechanism)

- **A vendored, pinned release:** `server/vendor/open-parcels-providers-<version>.tgz`, pinned by
  `openParcelsProviders: { version, sha256 }` in `server/package.json`, the same way the rules
  package is vendored. A tarball with another digest is refused.
- **`npm run providers`** (`server/src/tools/providers.ts`, plain Node, run by the root
  `postinstall`, so every `npm ci` does it, and again in the Dockerfile after the sources are
  copied) lays the release out where the server builds and tests it: `providers/<name>/` to
  `server/src/carriers/<name>/`, `test/` to `server/test/carriers/<name>/`, `fixtures/<kind>/` to
  `server/test/fixtures/<kind>/<name>/`. Those paths are git-ignored; nothing of the providers
  is committed here. `server/test/unit/builtin-providers.test.ts` checks that every listed
  provider is registered, none is missing, and the layout is the pinned release.
- **Checks:** format (`--ignore-path .prettierignore`, so the git-ignored layout is checked),
  ESLint (the provider API boundary), knip (`--no-gitignore`), tsc and vitest cover the providers
  as before: the server's gate is the providers' gate.
- **Working on a provider:** `OPENPARCELS_PROVIDERS_DIR=../open-parcels-providers npm run
  providers` lays out a local checkout instead; the pin test is skipped until `npm ci` restores
  the release.
- **Updating:** in the providers repo, commit, `tools/release.sh X.Y.Z`, push the tag, create the
  GitHub release with the tarball; here, copy the tarball to `server/vendor/`, set the version and
  SHA-256, remove the old tarball, run the gate, commit.

**Why not the plan's bundles yet:** bundles need the provider SDK package (precondition 2 below)
so that a bundle shares the core's error classes and kit instead of carrying copies. Until then
the providers compile with the server against `src/provider/api.ts`, which keeps one source of
truth and the full gate now; switching the release's content from sources to bundles later
changes only the tarball and the layout step. A git submodule was the other option; it was not
taken because every clone, worktree and gate copy would need `git submodule update`, while the
tarball travels with the files like the rules package.

## Preconditions left for bundles (in this order)

1. **Providers import only the provider API.** Done for the code (ESLint); their tests still reach
   into `server/src/` and `server/test/` (harness, registry, guarded fetch) by relative path.
2. **The provider API as a package** (`@open-parcels/provider-sdk`, P3): the API, kit, manifest
   schema and test helpers, versioned, so the providers repo builds and tests on its own.
3. **Bundles, not sources** (0002 §2): each provider builds to a `dist/provider.mjs`; the server
   loads built-in providers from bundles in both `in-process` and `pool` mode.
4. **Status tables, keys and carrier entries** of `open-parcels-rules` move into the providers
   (P5, rules 3.0).

## Steps

1. Done: repo manifest with `providers`, the repository, the move (one commit pair), the pinned
   release `1.0.0`, the server test.
2. Next: the SDK package and the providers' imports switched to it in one step (no alias kept),
   then the providers repo's own gate (format, ESLint, knip, tsc, vitest per provider).
3. Then bundles (precondition 3), with a check that `dist/` matches the sources.
4. **Done 2026-11-26:** installs from git URLs read the same repo manifest; the registry pins
   `repository + path + commit`; auto-update is on for built-in and verified providers
   ([`registry-and-installs.md`](registry-and-installs.md)). Installed code waits for step 3.

## Risks

- **Gate time:** the providers run in the server's gate; the full run stays on the NAS SSD copy
  with one test worker.
- **Shared helpers** that several carriers use today (`kit/`) belong to the SDK, not to one
  provider; a helper only one provider uses moves into it.
- **Two commits for one change:** a provider change and the server change that needs it land as
  a release there and a pin bump here.
