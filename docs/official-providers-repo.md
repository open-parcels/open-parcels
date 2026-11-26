# One repo for the official providers

Plan for TODO §3 "One repo with a folder per provider for the official providers; repo manifest
lists them". It narrows decision record [0002](decisions/0002-providers.md) §3.1 step 4 and P5
to the owner decision of 2026-11-23 (one repo, one folder per provider, a repo manifest, no
per-provider tags). Nothing here is built yet; no repository is created by this plan.

## What it is

- **`open-parcels/open-parcels-providers`**: one folder per official provider (`providers/<id>/`),
  each with its `open-parcels-provider.json`, code, email rules, logo, tests and fixtures, as
  today's `server/src/carriers/<id>/` plus `server/test/fixtures/email/<id>/`.
- **The repo manifest** (`open-parcels-repo.json` at the root) lists every provider (`id`,
  `kind`, `folder`), themes and, later, consumers (0002 owner decision 10, 0005). Its schema
  (`server/src/provider/repo-manifest.ts`, with the `themes:` list built for
  [`themes.md`](themes.md)) lives next to the provider manifest's and moves to the engine package
  with it.
- **One version for the repo.** A tag `vX.Y.Z` versions every provider in it; a provider's
  manifest carries no version of its own (0002 still shows per-provider tags such as
  `hermes_de@1.4.2`; the owner decision replaces them, and 0002 §3.1 step 4 is updated with
  this plan).
- **Built-in tier stays.** The image bundles a pinned snapshot of the repo (tag and digest), so
  the HA app, the HA Pi and air-gapped installs keep every official carrier without installing
  anything.

## Preconditions (in this order)

1. **Providers import only the provider API.** Already enforced by ESLint for
   `server/src/carriers/`; audit the remaining reaches into `server/src/` (test helpers, the
   `kit/`) and move what they need behind `provider/api.ts`.
2. **The provider API as a package** (`@open-parcels/provider-sdk`, P3): the API, kit, manifest
   schema and test helpers, versioned, so the providers repo builds against it, not against
   server sources.
3. **Bundles, not sources** (0002 §2): each provider builds to a committed `dist/provider.mjs`;
   the server never builds or installs provider code. The pool host (P2) already runs providers
   out of process; bundled providers must pass the recorded-fixture suites in `pool` mode.
4. **Email rules are in providers** (`docs/rules-split.md`, carriers done through rules
   `2.0.0-dev.16`). Status tables, keys and carrier entries follow (P5, rules 3.0).

## Steps

1. **Repo manifest in-tree first.** Add `open-parcels-repo.json` to `server/src/carriers/` with
   the schema and a test that it lists exactly the folders there; `builtin-carriers.ts` is read
   from it instead of the hand-written list. Ships alone, no move.
2. **Per-provider tests next to the provider.** Move each carrier's tests and fixtures from
   `server/test/` into its folder (`<id>/test/`, `<id>/fixtures/`), so a folder is complete on
   its own; vitest's projects pick them up from there.
3. **Build the SDK package** (precondition 2) and switch the providers' imports to it in one
   step (no alias kept).
4. **Bundle each provider** with a small script in the repo (esbuild, no install scripts); the
   server loads built-in providers from bundles in both `in-process` and `pool` mode.
5. **Create the repo** with the folders moved by script (`git filter-repo` keeping their history),
   its own gate (format, eslint, knip, tsc, vitest per provider, bundle check that `dist/`
   matches the sources), and the GitHub Actions rule (only `workflow_dispatch`).
6. **Server switches in lockstep:** `server/src/carriers/` is removed and the image takes the
   pinned snapshot (`vendor/open-parcels-providers-<version>.tgz`, as the rules package today),
   with a test that every provider in the repo manifest loads and none is missing. The demo shop
   provider stays in the server's tests.
7. **Later (P3, P4):** installs from git URLs read the same repo manifest; the registry pins
   `repository + path + commit`; auto-update is on for built-in and verified providers.

## Risks

- **88 carriers at once:** steps 1–4 happen in this repo and keep the gate green; only step 6
  moves code across repos, in one commit pair.
- **Gate time:** the providers repo's gate runs per changed folder; the full run stays on the
  NAS SSD copy with one test worker.
- **Shared helpers** that several carriers use today (`kit/`) belong to the SDK, not to one
  provider; a helper only one provider uses moves into it.

## Open questions for the owner

1. Repo name: `open-parcels-providers` (0002) or another?
2. Keep the history of each carrier folder on the move, or start the repo fresh?
3. Release cadence: tag the repo on every change, or with each server release?
