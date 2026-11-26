# 0004: Separate server and web, client libraries, native Android app

- **Status:** proposed 2026-11-25 (owner's request; brainstorm, not yet built). The items marked
  **early** in §6 are scheduled now because they shape the API; everything else waits until
  `tasks/TODO.md` §1–§10 are done.
- **Builds on:** 0001 (architecture), 0002 (providers), 0003 (accounts).

## 1. What the owner wants

1. The server (API, database, scheduler, providers) can be hosted alone, with as little memory and
   disk as possible.
2. The web UI can be hosted alone, pointed at any server.
3. Both together stay one easy install: a Compose file, an Unraid install, the Home Assistant app.
4. One repository per deliverable in the `open-parcels` organisation; the website explains what to
   get from where and how to install each combination.
5. Generated client libraries in their own repositories (`open-parcels-client-python`,
   `open-parcels-client-csharp`, …).
6. Later: a native Android app with notifications, a better mobile UI and a full offline copy that
   syncs back when the server is reachable again, published in as many stores as we can.

## 2. Facts measured first (server image `d83939f`, amd64, 426 MB)

| Part | Size | Note |
| --- | --- | --- |
| Node.js runtime (Debian `node:26-slim`) | 171 MB | biggest part |
| Debian base | 79 MB | |
| Tailscale (`tailscale`, `tailscaled`) | 78 MB | only needed by people who use the built-in Tailscale |
| `node_modules` | 93 MB | better-sqlite3 27 MB, sharp/@img 19 MB, zod 8 MB, … |
| npm / npx | 17 MB | not needed at run time |
| server `dist` | 4 MB | |
| **web `dist`** | **1.2 MB** | |

**Consequence:** splitting the web UI off saves almost nothing (1.2 MB, no memory: the server only
serves static files). The real savings are elsewhere:

- Tailscale downloaded only when switched on (§3.1): −78 MB for everyone.
- No npm/npx and a bundled server (esbuild bundle, only native modules kept): −17 MB and roughly
  −50 MB of `node_modules`.
- A smaller runtime base (Alpine/musl or distroless Node, checked against better-sqlite3 and sharp
  prebuilds on amd64 and arm64): tens of MB more.
- sharp (19 MB) is only used for collages and thumbnails; a "no pictures" build could drop it.

Estimated: a server-only image of roughly 150–200 MB, versus 426 MB today. **Measured after
Tailscale on demand, no npm/npx and the bundle (2026-11-25, amd64): 284 MB** (`node_modules`
22 MB). **arm64 on the Pi (`sha-34a60c0`, 2026-11-26): 324 MB unpacked, 99 MB to download**
(layers: Debian 110 MB, Node.js 179 MB, the server and web UI 34 MB; Docker's containerd store
lists 424 MB because it also keeps the packed layers). amd64 of the same commit: 285 MB unpacked.
Memory is dominated by Node itself and the providers, not by the web UI.

## 3. Proposed shape

### 3.1 Images

| Image | Contents | For |
| --- | --- | --- |
| `open-parcels-server` | API, database, scheduler, providers; no web UI, no Tailscale | headless installs, Home Assistant only, the Android app |
| `open-parcels-web` | the static web UI behind a tiny static server (e.g. `caddy`/`busybox httpd`, ~5–20 MB), or plain files for any web host | people who want the UI elsewhere |
| `open-parcels` (all-in-one) | server + web UI in one container (today's image) | the default, Unraid, the Home Assistant app |

**Tailscale on demand (owner's idea, preferred):** no Tailscale in any image. When Tailscale is
switched on (environment variable or setting), the server downloads the pinned Tailscale release
for its architecture from `pkgs.tailscale.com`, checks it against a SHA-256 pinned in our release
(never trust-on-first-use), unpacks it into the data folder (`tailscale/<version>/`) and starts it;
later starts reuse the cached copy, and a server release that pins a newer version replaces it.

- For: −78 MB for everyone, one image instead of a variant, still "one switch" for people who use it.
- Against: the first start with Tailscale on needs internet and takes a few seconds longer; we must
  bump the pinned version and hashes ourselves (a release-script step); an air-gapped install
  needs a way to place the files by hand (documented: drop the tarball into the folder).
- Rejected alternatives: a `-tailscale` image variant (two images to build, test and document) and
  a sidecar container (what we removed on 2026-11-23 because it was harder to set up).

The same "fetch on demand, pinned and verified" pattern could later apply to other heavy optional
parts (for example sharp for pictures), but only where the part is truly optional.

The all-in-one image stays the recommended install because it needs no second container, no
cross-origin setup and no reverse proxy. Splitting is an option, not a requirement.

### 3.2 Web UI on another origin (the hard part)

Today the web UI and the API share one origin: session cookie, CSRF token, `SameSite` cookies.
A web UI on another origin (`https://parcels-ui.example` talking to `https://parcels.example`)
needs:

- CORS on the server with an explicit allow-list of web origins (setting), never `*`;
- either cross-site cookies (`SameSite=None; Secure`, fragile, blocked by some browsers) or, better,
  a token login for the web UI (log in → short-lived access token + refresh token held in memory /
  storage, `Authorization: Bearer`). The same mechanism serves the Android app and the client
  libraries, so this is worth doing once, properly;
- a "server address" field in the web UI when it is not served by the server itself;
- the live event stream (SSE) with a token instead of a cookie.

### 3.3 Repositories

| Repository | Holds | Publishes |
| --- | --- | --- |
| `open-parcels-server` (rename of `open-parcels`, or keep the name for the all-in-one) | server, database, providers, OpenAPI document | server image, all-in-one image |
| `open-parcels-web` | React web UI | web image, static zip |
| `open-parcels-client-typescript`, `-python`, `-csharp` (later `-kotlin`, `-go`) | generated clients + thin hand-written helpers | npm, PyPI, NuGet |
| `open-parcels-android` | native Android app | APK/AAB to the stores below |
| `open-parcels-rules`, `-ha`, `-ha-apps`, `-extension`, `.github`, website | as today | as today |
| providers (0002) | official providers repo + registry | as decided in 0002 |

The OpenAPI document stays the single contract, owned by the server repo and versioned. The web UI,
the client libraries and the Android app are generated from a released OpenAPI version, so a
server release can be checked against them before it ships. Monorepo tooling we rely on today
(one gate, shared lockfile) moves to per-repo gates; cross-repo changes need a release order
(server first, then web/clients), which matches the owner's "migrate in lockstep" rule.

Alternative considered: keep one source repo and only publish separate images. Cheaper to run, but
the owner explicitly wants separate repositories, and separate repos make the contract (OpenAPI)
real instead of implicit. Proposed compromise: split once the API is stable (after §3 provider
rewrite), not before.

### 3.4 Installing both together

- **Docker Compose:** `compose.yaml` in the server repo with `server` + `web` (+ optional
  `tailscale`), and the all-in-one as the one-service variant.
- **Unraid:** Unraid still has no native Compose support (its docs say so; multi-container apps use
  the Compose Manager / Compose Manager Plus plugins, which don't integrate with the Docker page's
  update badges). So for Unraid we publish **single-container templates**: the all-in-one (the
  default, what we run ourselves), plus a server-only and a web-only template for people who want
  them, each a normal Community Applications template. A `compose.yaml` for Compose Manager Plus is
  documented as an alternative.
- **Home Assistant app:** keeps the all-in-one image (ingress needs the UI next to the API).
- **Website:** an "Install" chooser: all-in-one (Docker / Unraid / Home Assistant), server only,
  web only, apps and libraries, with the matching snippet for each.

## 4. Client libraries

- Generated from the released OpenAPI document (openapi-generator or Microsoft Kiota; choose by
  output quality for Python and C#), plus a hand-written live-event (SSE) helper, because generators
  don't cover SSE well.
- One repo each, versioned with the API version they were generated from; release scripts run
  locally or as `workflow_dispatch`-only workflows (owner rule: no automatic workflow triggers).
- Published to npm, PyPI and NuGet under the `open-parcels` name (accounts are owner actions).

## 5. Native Android app

- **Stack:** Kotlin + Jetpack Compose, Room (SQLite) as the offline copy, WorkManager for sync,
  generated Kotlin client. Kotlin Multiplatform keeps an iOS app possible later.
- **Offline first:** everything is read from the local database; the server is a sync source.
  Needs a **delta sync API** on the server (see §6): "everything changed since cursor X", including
  deletions (tombstones), for parcels, events, orders, returns, connections and pictures.
  Edits made offline are queued and replayed; conflicts resolved server-wins with a visible note.
- **Notifications:** no Google push servers for a self-hosted server by default. Options:
  UnifiedPush (works with ntfy, which the owner can self-host), plus a foreground/periodic sync
  fallback; Firebase Cloud Messaging only as an optional Play-Store flavour.
- **Stores:** GitHub Releases (+ Obtainium), F-Droid (needs a reproducible build without Google
  libraries), IzzyOnDroid, Accrescent, Google Play (owner account, one-time fee). Two flavours:
  `foss` (UnifiedPush) and `play` (optional FCM).
- **Live map, sign-ins:** sign-in flows that need a browser open the server's web flow in a custom
  tab; the live courier map uses the same SSE stream.

## 6. What to do early, and why

These change the API and the data model, so doing them later would mean migrating every client
twice:

1. **Token login for non-cookie clients** (access + refresh tokens, scoped, revocable), used by
   the web UI when it runs on another origin, by the Android app and by the client libraries.
   Fits 0003 (one household, admin/reader roles).
2. **CORS allow-list setting** and an SSE stream that accepts a token.
3. **Delta sync:** `updated_at` on every synced table (most have it), tombstones for deletions
   (a small `deletions` table written by the same transactions), and `GET /api/v1/sync?since=`
   with a cursor. Without tombstones, an offline client can never learn about deletions.
4. **API versioning and a published OpenAPI per release**, so clients generated from it can be
   checked in CI-less local scripts.
5. **Slimmer images now:** Tailscale on demand (§3.1), no npm/npx, a bundled server, and a
   server-only image (no web UI) from the same repo: cheap now, and it measures the real savings
   before any repo split.

Everything else (repo split, web image, client repos, Unraid templates for split installs,
Android app, store publishing) waits until TODO §1–§10 are done.

## 7. Owner decisions (2026-11-25)

1. **Server repo name:** `open-parcels-server` (rename of `open-parcels`; every reference in the
   other repos, the website, image names and docs has to follow). Three images stay: server only,
   web only, all-in-one. With two source repos, the web repo publishes the web image and a static
   zip per release; the server repo builds the server image and the all-in-one image, which takes
   the web zip of the matching web release.
2. **Web repo name:** `open-parcels-web` (owner, 2026-11-25). All names are listed in the
   glossary's "Repositories, projects and images" table.
3. **Client libraries first:** TypeScript, Python, C#.
4. **Android notifications:** default is the public **ntfy.sh** instance; users can switch to their
   own ntfy server (or other UnifiedPush distributors). Because ntfy.sh is a public third party, the
   push message carries no personal data: only a random per-device topic and a "sync now" ping (or
   an encrypted payload); the Android app then fetches the details from the user's own server.
5. **Stores:** npm, PyPI and NuGet accounts exist (owner). **No Google Play** (paid developer
   account; there is no legitimate way around the fee). Android distribution: GitHub Releases +
   Obtainium, F-Droid, IzzyOnDroid, Accrescent.
6. **Credentials** for npm, PyPI and NuGet: look in the NAS environment and on the owner's PC
   (Bazzite) first; ask the owner to unlock Bitwarden only if they can't be found. Needed only when
   the client libraries are published (TODO §11).
