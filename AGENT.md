Be extra careful when talking to real-world services like Amazon: conservative rate limits, generous
delays, backoff, many failsafes, and stop fast when a response looks wrong. A network error must
never trigger a new sign-in.

# open-parcels: notes for agents

Read [`docs/decisions/0001-architecture.md`](docs/decisions/0001-architecture.md) first. It explains
what this service is, the stack, the data model, the API and event contract, and the roadmap.

## Layout

| Path | What |
|---|---|
| `server/` | The backend: Fastify API, engine, carrier providers (TypeScript, Node 26) |
| `server/src/carriers/` | Carrier providers, one folder each. They may import only the provider API; ESLint enforces it. Each folder's `open-parcels-provider.json` manifest says what the provider is and every host it may reach ([`docs/provider-manifest-and-sandbox.md`](docs/provider-manifest-and-sandbox.md)); a new host goes into the manifest with its reason, or requests to it are refused |
| `server/themes/` | Built-in themes, listed by `open-parcels-repo.json`; declarative manifests checked on load ([`docs/themes.md`](docs/themes.md)) |
| `server/test/` | vitest suites: `unit/`, `api/`, and recorded made-up fixtures |
| `web/` | The web UI (React + Vite) |
| `docs/decisions/` | Decision records |
| `Dockerfile`, `docker-compose.yml`, `unraid/` | Packaging |

The TypeScript implementation from before the rewrite is on branch `legacy-ts` (tag `v1-final`).

## The gate

Run it before every commit; it must pass with zero warnings:

```sh
npm run gate   # prettier check, eslint (strict type-checked + size limits), knip, tsc, vitest, build
```

- **knip** (`knip.json`) fails on unused files, dependencies and exports. Carrier providers'
  internals and the provider API (`server/src/provider/api.ts`, `kit/`) are left out until the
  provider rewrite; migrations are loaded as namespaces.
- **Build on NTFS (`G:\_TEMP\...`), never on the Btrfs drives** `D:`, `E:` or `F:` from Windows.
- **npm 11 runs install scripts only for packages listed in `allowScripts`** in the root
  `package.json`. Add a package there deliberately, never blanket-allow.
- **Install the pre-commit hook once per clone: `npm run hooks`** (points git at `tools/hooks`). It
  rejects database, key and `.env` files and literal strings assigned to `password` or `secret`
  keys, even in tests. Build made-up test values from parts, as `server/test/helpers.ts` does.
  Personal patterns (names, local paths) go one regex per line into the untracked
  `.git/info/pii-patterns`. Never bypass the hook with `--no-verify`.

## Versions

Until 2.0.0 the server and web packages are `2.0.0-dev.<YYYYMMDD>`, the day of the build that is
published (the Home Assistant app's `2.0.0-dev.<YYYYMMDD>.<n>` builds on it). Bump both
`package.json` files (and the lockfile's workspace entries) when publishing on a new day. The image
also carries its commit: `op-publish.sh` passes `--build-arg OPENPARCELS_COMMIT=<sha>`, and the
Status page shows `2.0.0-dev.<date> (<commit>)`.

### The API contract

- The API version is the path: `/api/v1`. Within it, changes follow the "migrate, don't keep
  legacy code" rule below: a breaking change ships with our clients in lockstep and is listed in
  `CHANGELOG.md`; a `/api/v2` would only come with a reason to serve two versions at once.
- `docs/openapi.json` is the contract. Its `info.version` is the server version, so it changes
  with every version bump; the gate fails while the committed document differs from the server
  (`--api` regenerates it and the web UI's `generated.ts`).
- **Per release:** bump the versions, run the gate with `--api`, commit, tag; once the GitHub
  release exists, `~/scripts/op-publish.sh attach-openapi <tag>` attaches `docs/openapi.json` as
  of that tag as `openapi-<version>.json` (it never creates a release). Client libraries
  (decision record 0004 §4) are generated from that file, never from a running server.
- **Tailscale pin:** `docker/tailscale-entrypoint.sh` pins the Tailscale version and one SHA-256
  per architecture. To bump, download `tailscale_<version>_{amd64,arm64}.tgz` from
  `pkgs.tailscale.com/stable/`, check each against its `.sha256` file and set all three values.
- **Image size:** `op-image-housekeeping.sh` (run by the publish scripts) records each
  image's size and warns when one grew more than 5 %.

## Rules that matter here

- **Test fixtures contain made-up values only.** Never commit real tracking numbers, order numbers,
  names, addresses, emails or coordinates. History was rewritten once to remove such data.
- **No secrets in logs or events.** Use the logger, which redacts. Event payloads go through
  `parcelForEvent`, which strips courier coordinates.
- **Carrier knowledge that other projects could reuse goes to `open-parcels-rules`, not here.**
  That covers regexes, status tables and locale tables, and the email rules of shops and carriers
  without a provider. The email rules of a shop or carrier with a provider live in that provider
  (`emailRules`, fixtures in `server/test/fixtures/email/<provider>/`; `docs/rules-split.md`).
- **Don't name the projects an endpoint was learned from** in code, docs or commit messages.
- **Migrate, don't keep legacy code.** A rename or format change is done in one step: no
  deprecated aliases, old fields next to new ones, old names accepted in requests or code that
  reads two shapes of stored data. Stored data is migrated once (a database migration), or by a
  documented manual step in `CHANGELOG.md` where that makes more sense. Our own clients (Home
  Assistant integration and app, extension) are updated in lockstep.
- **GitHub Actions never run under this account.** The repository has no workflow; one added later
  keeps only `workflow_dispatch` active, its automatic triggers commented out with the reason
  written above them.
