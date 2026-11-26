<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/open-parcels/open-parcels/main/docs/branding/banner-on-dark.png">
    <img alt="Open Parcels" src="https://raw.githubusercontent.com/open-parcels/open-parcels/main/docs/branding/banner-on-light.png" width="640">
  </picture>
</p>
<p align="center">
  <a href="https://hub.docker.com/r/bluscream1/open-parcels"><img alt="Docker Hub pulls" src="https://img.shields.io/docker/pulls/bluscream1/open-parcels?logo=docker&label=pulls"></a>
  <a href="https://github.com/open-parcels/open-parcels/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/open-parcels/open-parcels?include_prereleases&sort=semver"></a>
  <a href="https://github.com/open-parcels/open-parcels/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/open-parcels/open-parcels?style=flat"></a>
  <a href="https://github.com/open-parcels/open-parcels/issues"><img alt="Open issues" src="https://img.shields.io/github/issues/open-parcels/open-parcels"></a>
  <a href="https://github.com/open-parcels/open-parcels/commits"><img alt="Last commit" src="https://img.shields.io/github/last-commit/open-parcels/open-parcels"></a>
</p>

# Open Parcels

**Self-hosted parcel and order tracking.** One service on your own hardware follows about 95
carriers, signs in to carrier and shop accounts, reads shipping emails, shows the courier live on a
map and keeps a delivery calendar (also as an ICS feed).

> **Status:** early development, `2.0.0-dev`. Expect breaking changes.

This repository holds the server and the web UI: carrier providers, email parsing, the scheduler,
the REST API with its event stream, the Docker image and the Unraid template.

- Website, install guides and the carrier list: <https://open-parcels.github.io>
- Home Assistant integration: [open-parcels-ha](https://github.com/open-parcels/open-parcels-ha)
- Home Assistant app (runs the server inside Home Assistant, in the sidebar): [open-parcels-ha-apps](https://github.com/open-parcels/open-parcels-ha-apps)
- Shared carrier and email rules: [open-parcels-rules](https://github.com/open-parcels/open-parcels-rules)
- Browser extension for app-only carrier sign-ins: [open-parcels-extension](https://github.com/open-parcels/open-parcels-extension)

## Quick start

```sh
docker compose up -d   # uses docker-compose.yml from this repository
```

Then open <http://localhost:3000> and finish the setup with the code from `docker compose logs open-parcels`. The website has guides for Unraid and Home Assistant. For something to look at before
you add real accounts, add the **Demo shop** and **Demo courier** connections: three made-up parcels
in two orders, with a live courier on the map.

### Images

The image is published to Docker Hub as `bluscream1/open-parcels`, the main registry that
`docker-compose.yml`, the Unraid template and the guides use. GHCR carries the same image as a
mirror, `ghcr.io/open-parcels/open-parcels` (same tags): use it only when Docker Hub has problems
(an outage or its pull limit), by replacing the image name, for example
`image: ghcr.io/open-parcels/open-parcels:latest`.

## Access

Two passwords, both optional settings (environment, or **Settings → Security**):

| Setting | Allows | Unset |
| :--- | :--- | :--- |
| `OPENPARCELS_PASSWORD` | Reading: the web UI, the API, live updates, maps, images. | Anyone who can reach the server reads everything. |
| `OPENPARCELS_ADMIN_PASSWORD` | Everything that changes something (every non-GET request): connections, sign-ins, sync, parcel and order edits, settings, tokens. | First start prints a setup code to the log; entering it in the web UI chooses the admin password. |

The admin password may also be changed in the UI (it needs the current one). It is then stored
scrypt-hashed and wins over the environment until **Reset to environment**; changing or resetting
it logs every session out. Changing the reader password logs readers out. Home Assistant ingress
counts as the admin. API tokens keep their scopes: `read` reads, `write` or `admin` may change
things, and only `admin` manages tokens and server settings.

**Without a login** (no `OPENPARCELS_PASSWORD`), the server answers parcels, orders and returns
but not whose accounts they come from: connections and consumers are named by their provider or
consumer ("Amazon", "Inbox"), without account names, inbox addresses or settings, in the API and
live events alike. A login (reader or admin) or an API token sees them.

**Upgrading** from a version with a single owner password: nothing to do. The owner password
becomes the admin password (still hashed, shown as "saved in UI"), open sessions stay logged in as
admin, and reading is open until `OPENPARCELS_PASSWORD` is set. To keep reading private as before,
set `OPENPARCELS_PASSWORD` (or set it on the Security card right after upgrading).

## Privacy

Open Parcels talks to the carriers and shops you add (and the hosts of their item pictures), and
otherwise only to these:

- **Address search** (Settings → Home location): the text you search for goes to the place search
  service, [OpenStreetMap Nominatim](https://nominatim.openstreetmap.org) unless
  `OPENPARCELS_GEOCODING_URL` names another Nominatim-compatible one, only when you press *Find*.
- **Background place lookup** (`OPENPARCELS_GEOCODING`, **off** by default): carrier events that
  name only a place ("Leipzig hub") are looked up on that service, so they can show on the map.
  Only those place names are sent, at most one a second, and each answer is cached. Turn it on
  under **Settings → Map** (admin only); preferably point it at your own Nominatim first.
- **Map tiles** are fetched by the server from the map provider you choose and cached. Built-in
  layers' addresses can be changed (`OPENPARCELS_MAP_OSM_URL`, `OPENPARCELS_MAP_TOPO_URL`,
  `OPENPARCELS_MAP_EOX_URL`); the satellite layer is for non-commercial use only.
- **DHL Poland** (region `PL` of a DHL tracking connection, **off** by default): Mój DHL's public
  lookup asks every client for a proof of work before it answers. open-parcels computes it (up to
  2,000,000 SHA-256 hashes, at most 4 seconds of CPU per lookup, a noticeable cost on a Raspberry
  Pi) and never answers a challenge meant for a person. With your own key for DHL's official
  tracking API (optional sign-in of the DHL tracking connection), Polish parcels come from that API
  instead and no proof of work is computed.

What each service receives, its terms and how to switch to your own:
[`docs/third-party-services.md`](docs/third-party-services.md). Set `OPENPARCELS_CONTACT_EMAIL`
to give their operators a way to reach you.

## Fallback services

Two optional connections ask about parcels the built-in carriers cannot follow: a code no carrier
recognises, a carrier without a provider (or whose provider needs settings you have not given),
or a parcel its carrier has not found for a day. Both are off until you add them under
**Connections**, and both may exist side by side:

| Service | What you enter | Notes |
| :--- | :--- | :--- |
| **Universal lookup** | The address of a universal-lookup service (`GET <url>/api/parcel/<tracking number>`), e.g. one you host yourself | Each code is asked at most every 3 hours, one request every 5 seconds, at most 20 codes a run. The address must be reachable on a public address (the server refuses private network addresses). |
| **17TRACK** | Your own API key of the [17TRACK tracking API](https://api.17track.net) (v2.2) | Each number is registered once (that uses one unit of your quota) and then read at most every 6 hours. The quota is checked before registering (at most every 12 hours), today's cap is respected, and registering pauses for 12 hours once the quota is used up; parcels waiting for a registration keep their state. |

They are asked one at a time: the universal lookup first, 17TRACK only when the one before has
not found the parcel for a day either. Their answers are filed under the parcel's own carrier, so
no second parcel appears, and once a parcel is handed to a fallback service, its answers decide
whether the parcel counts as found. A code no carrier recognises can be added by hand while a
fallback service exists; it is then filed under that service. Both services see the tracking
numbers they are asked about, and nothing else.

## Tailscale (built in)

The image can join your tailnet itself, so no sidecar container is needed. Set `TS_STATE_DIR`
(for example `/var/lib/tailscale`) and mount a persistent folder there, writable for uid 1000.
On the first start also set `TS_AUTHKEY`; later starts reuse the saved state. The web UI is then
served at `https://<TS_HOSTNAME>.<your-tailnet>.ts.net` (`TS_HOSTNAME` defaults to `open-parcels`).
Tailscale runs in userspace mode, as the same unprivileged user, so the container needs no extra
capabilities and no `/dev/net/tun`. Without `TS_STATE_DIR` the image behaves as before.
Tailscale is not part of the image: the first start with `TS_STATE_DIR` set downloads the release
the image pins from `pkgs.tailscale.com`, checks its SHA-256 against the pinned one and keeps it in
`tailscale/<version>/` in the data folder; later starts reuse it. Without internet access, put the
archive (`tailscale_<version>_amd64.tgz` or `_arm64.tgz`, the version named in the log) into
`tailscale/` in the data folder yourself; it is checked the same way.
Tailnet visitors reach the server through `tailscale serve` on 127.0.0.1, so the image then sets
`OPENPARCELS_TRUST_PROXY=127.0.0.1` itself (unless you set it), and the login throttle sees each
visitor's own address.
Set `OPENPARCELS_PUBLIC_URL` to the tailnet address so links point there.

## Backups and restore

open-parcels backs its database up by itself while it runs: every 24 hours
(`OPENPARCELS_BACKUP_HOURS`, 0 turns it off), keeping the newest 7 (`OPENPARCELS_BACKUP_KEEP`),
in `backups/` in the data folder unless `OPENPARCELS_BACKUP_DIR` names another folder (best on
another disk). All three can also be changed under **Settings → Backups**. Each backup is a
consistent copy taken with SQLite's `VACUUM INTO`, written as `.partial` and renamed when complete,
so a file named `openparcels-<UTC time>.db` is always whole. The Backups card on the Settings page
shows the newest result and the files kept and has **Back up now**; the Status page and
`/api/v1/health` report failing backups, and each result is sent as the live event `backup.finished`.

**The encryption key is not in the backup.** Keep a copy of `secret.key` from the data folder (or
your `OPENPARCELS_SECRET_KEY`) somewhere safe; without it a restored database has every sign-in
and inbox password locked, and each connection must be signed in again.

To restore, **stop open-parcels**, then run the restore tool in a one-off container with the same
data volume and environment (it refuses while the server has the database open):

```sh
# Docker Compose (the service is stopped)
docker compose run --rm --entrypoint node open-parcels \
  server/dist/tools/restore-backup.js openparcels-2026-11-25T03-00-00-000Z.db --dry-run
# then without --dry-run, and start the service again
```

On Unraid, stop the container and run the same `docker run --rm -v <your data path>:/data
--entrypoint node <image> server/dist/tools/restore-backup.js <file>` from the terminal. A bare
file name is looked up in the backup folder; a path is used as given. The tool checks the backup
(SQLite's integrity check, an open-parcels database, no newer version than the one installed),
says whether the installation's key opens its sign-ins, keeps the replaced database next to it as
`openparcels.db.before-restore-<time>`, and copies the backup into place. `--dry-run` only checks.
`--force` restores although a `-wal` file is left next to the database, which happens only when the
server did not shut down cleanly. Newer database migrations run when the server starts again.

## Migrating

Two one-time tools carry data over from earlier setups. Both read the server's own `OPENPARCELS_*`
environment (data directory, encryption key), so run them inside the open-parcels container, and
both accept `--dry-run`, which works on a temporary copy and changes nothing.

- **The pre-rewrite open-parcels database (v1):** copy the old `data.db` into the data volume as
  `old.db` (readable by the container's user; it is only read, never changed), then run
  `node server/dist/tools/import-legacy.js /data/old.db --dry-run`, check the counts it prints,
  and run it again without `--dry-run`. This works on a fresh installation too, before the first
  start. Running it twice imports nothing twice. Its IMAP inboxes come over only when the old
  encryption key is set as `OPENPARCELS_LEGACY_KEY` in the container's environment; it is never
  taken from the command line. Amazon and AliExpress connections are signed in again by hand.
- **The Home Assistant parcel suite:** `node server/dist/tools/import-ha.js - --dry-run` reads
  Home Assistant's `.storage/core.config_entries` from stdin (or a path instead of `-`).

With Docker Compose, prefix the command with `docker compose exec -T open-parcels`; on Unraid,
with `docker exec -i open-parcels` (or use the container's console). Restart open-parcels after a
real import, so it picks up the new connections and inboxes. Back up the data folder first.

## Development

```sh
npm install
npm run gate   # format check, lint, type check, tests, build
```

API reference: [`docs/openapi.json`](docs/openapi.json). Branding assets: [`docs/branding`](docs/branding).

## License

Released into the public domain under [The Unlicense](LICENSE).