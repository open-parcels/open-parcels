# Changelog

## Unreleased (2.0.0-dev)

### Changed: the built-in providers come from open-parcels-providers

The 89 built-in providers moved to their own repository,
[`open-parcels/open-parcels-providers`](https://github.com/open-parcels/open-parcels-providers)
(one folder each, listed by its repo manifest, one version for the repository). The server
vendors release `1.0.0` (`server/vendor/`, pinned by SHA-256 in `server/package.json`) and lays
it out with `npm run providers`, which `npm ci` runs. Nothing changes for users. Manual step for
existing checkouts: run `npm ci` (or `npm run providers`) after pulling, since
`server/src/carriers/` is no longer tracked.

### Added: the parcel list is searched, sorted and counted by the server

`GET /api/v1/parcels` takes `q` (every word must appear in the tracking number, label, carrier,
status, the carrier's status text, an item name or the order's shop, number or name) and `sort`
(`updated_at`, `name`, `status`, `lookup`, `carrier`, `expected`; `-` for descending; default
`-updated_at`). Without them it answers as before, so the Home Assistant integration's full sync
is unchanged. `GET /api/v1/parcels/counts` gives the parcels on the way, delivered and archived,
per carrier and per connection. The web UI's parcel table loads 200 parcels per "Show more" (the
count reads "200+"), the map loads only the parcels on the way, and the Connections page reads
the counts instead of every parcel. Sorting is by one column; links with `?sort=label` or
`?sort=eta` fall back to the newest change first (the columns are `name` and `expected` now).

### Changed: the Status page's database error is a code

`GET /api/v1/status` reports why the database does not answer as `database.error`, a code
(`busy`, `corrupt`, `no_space`, `read_only`, `cannot_open`, `failed`; the server log has the
details), instead of the driver's English message in `database.detail`, which is gone. The web
UI shows its own text in English or German. The Home Assistant integration does not read it.

### Fixed: dialogs announced a second page banner

A dialog's title bar was a `<header>`, which outside the main content is a banner landmark, so
screen readers listed two page banners while "Track a parcel" was open. It is a plain block now.

### Added: returns of other shops, PayPal refunds matched to orders (rules 2.0.0-dev.17)

What a return or refund email says about the return (return-by day, drop-off options, cost,
refund, label link, the shop's return id and reason, how far it is) is now read by the rules
(`EmailParseResult.return`), for every return rule and every provider's rules; the server's own
readers are gone. Return emails of shops no rule knows ("Return requested for order #1042") start
or update that order's return under the sender's domain. PayPal refunds that quote the shop's
invoice id join that order; those that name none are matched by the purchase's total and the
payee, and touch nothing when that is ambiguous. BerryBase delivery emails mark the order
delivered. A shop's order email whose tracking number belongs to a carrier no rule knows now
files the parcel under the first fallback service (dropped as before without one).

### Added: "Read old emails again" on inboxes

Every inbox has the action "Read old emails again" (input: days, default 365): a heavy,
resumable job that reads the inbox's emails of those days again in paced batches, so past
orders, parcels and returns appear (after "Clear data", or for an inbox added with a short first
sync). What it finds is stored as history, like an import. `GET /api/v1/inbox-form` gains
`actions`; `GET /api/v1/connections/{id}/actions` lists it for inboxes. Job batches may now carry
returns (`ActionBatch.returns`).

### Added: fallback services on your own network

The universal lookup's new setting "Allow an address on your own network" (off by default) lets
that connection reach its server at a LAN address; every other non-public address stays refused.
A manifest's `config` network entry declares such an opt-in with `private_network_opt_in`.

### Added: consumers and notification rules

Consumers send notifications about parcels to a service the user chooses
([`docs/consumers.md`](docs/consumers.md), decision record 0005): ntfy (with click link and view
action), email over SMTP (HTML and text), a webhook (JSON signed with HMAC-SHA256 in
`X-Open-Parcels-Signature`) and Apprise via `apprise-api`. Each has notification rules (events,
directions, connections, quiet hours, an hourly or daily digest, English or German) and a "Send
test notification" button on the new Consumers page. Notifications come from the live event
outbox, one per parcel state change however many connections report it, with retries and backoff
per consumer; the Status page shows each consumer's last delivery (`GET /api/v1/status` gains
`consumers` and the `consumers` check). Database migration 0031 adds the tables; nothing is sent
until a consumer is added, and the first start does not send old news.

### Changed: Home Assistant import markers with an unkeyed fingerprint become adopted

The HA importer no longer recognises the unkeyed credential fingerprint that versions before
2026-11-19 stored. Database migration 0032 rewrites such markers (last written before the keyed
fingerprint shipped) into adopted markers: they cannot be re-keyed, because the fingerprint hashes
the sign-in data as Home Assistant had it, which the database does not hold, and deleting them
would make a re-import create a second connection. A re-import now keeps those connections, labels
and tokens as they are; a Home Assistant sign-in changed since is not carried over, so sign in
again in the web UI if needed.

### Changed: themes, and the light/dark setting becomes the mode

The header's light/dark-only setting is replaced by two settings: Theme (the default theme or an
installed one) and Mode (Automatic, Light, Dark); see [`docs/themes.md`](docs/themes.md). The
stored choice moves to the mode by itself on the first start (`system` becomes Automatic) and the
old local-storage key is removed. Themes are declarative manifests checked on load (schema,
contrast, bundled files only); the server ships the default theme and the example theme Paper
(`GET /api/v1/themes`). The web UI's styles now use design tokens only, so status tags, map
markers and lines follow the theme.

### Changed: DPD Germany, UPS, FedEx, USPS, Evri and Canada Post read their own emails (rules 2.0.0-dev.16)

The next step of splitting the shared rules ([`docs/rules-split.md`](docs/rules-split.md)): the
shipping email rules of DPD Germany (`dpd.de`, `dpd.at`), UPS, FedEx, USPS, Evri (`evri.com`,
`myhermes.co.uk`) and Canada Post and their fixtures moved out of `open-parcels-rules` (released
as `2.0.0-dev.16`) into those providers, whose manifests now name their sender domains. Routed
emails read exactly as before; as with Amazon, DHL and Hermes, an email from those senders that
fails the DKIM/DMARC check is no longer read by their rules.

### Changed: Amazon, DHL and Hermes read their own emails (rules 2.0.0-dev.15)

The first step of splitting the shared rules ([`docs/rules-split.md`](docs/rules-split.md)):
providers may bring email rules (`emailRules`, the rules' email rule format) instead of
`parseEmail`, which the core runs with the shared engine. Amazon's order, shipping, return and
dunning rules, DHL's and Hermes' shipping rules and their fixtures moved out of
`open-parcels-rules` (released as `2.0.0-dev.15`, with the new `withEmailRules`) into those
providers, whose manifests now name their sender domains. Routed emails read exactly as before;
an email from those senders that fails the DKIM/DMARC check is no longer read by their rules
(turn the inbox's sender check off for a mail server that adds no `Authentication-Results`).

### Added: per-inbox sender check switch

Inboxes get the setting "Check senders (DKIM/DMARC)" (`checkSenders`, on by default). Off, for a
mail server that adds no `Authentication-Results` header, that inbox hands emails to the provider
of their sender's domain without the DKIM/DMARC check. Stored inboxes keep the check on.

### Added: email routing to providers

Inboxes hand an email to the providers whose manifest names its sender's domain
(`email.from_domains`, exact or `.suffix`; webmail domains are refused), once the receiving mail
server's topmost `Authentication-Results` header says DKIM (aligned with the sender) or DMARC
passed. The provider's `parseEmail` gets the email without network, sign-in data or session, in
both isolation modes (sandbox method `parseEmail`). An email a provider read is not read by the
shared email rules as well, so one email never gives a parcel twice; an email no provider read
(ignored, failed, unauthenticated, unknown sender) goes to the rules as before. The new live
setting `OPENPARCELS_EMAIL_ROUTING` (on by default) switches routing off. The demo shop is the
first provider that reads email ([`docs/provider-manifest-and-sandbox.md`](docs/provider-manifest-and-sandbox.md) §3).

### Added: Amazon "Import history"; imported history is flagged, quiet and kept

Amazon shop connections get the action "Import history": every year of the orders page, newest
first, paced (6–10 s a page, a 2-minute break every 25 pages, an hour's rest after 300), resumable
from a checkpoint after every batch, and the link "Your orders"
([`docs/connection-actions-and-jobs.md`](docs/connection-actions-and-jobs.md) §6, §7). What a job
stores is history: parcels and orders get `imported_at` (migration 0030), the live events of a
job's batch carry `imported: true`, new parcels delivered more than 30 days ago are stored
archived without events, each batch fires the new live event `parcel.imported`, and retention
never deletes imported parcels. The HA integration (updated in lockstep) fires no Home Assistant
event for imported live events and reloads after `parcel.imported`.

### Changed: cancelling a job drops its request in flight

A job's requests are bound to its cancel: the one waiting or in flight is dropped at once and every
further one refused, instead of the job stopping only at its next progress, results or checkpoint.
Providers get `ActionContext.wait(ms)` for paced rests (sandbox capability `job.wait`).

### Added: connection actions and jobs

Providers declare actions in their manifest (`actions`): links ("Your orders") and tasks that run
as resumable **jobs** with progress, cancel, resume and start over
([`docs/connection-actions-and-jobs.md`](docs/connection-actions-and-jobs.md)). New: table `jobs`
(migration 0029); `GET /api/v1/carriers` lists each provider's `actions`;
`GET /api/v1/connections/{id}/actions`, `POST /api/v1/connections/{id}/actions/{action}`,
`GET /api/v1/jobs`, `GET /api/v1/jobs/{id}`, `POST /api/v1/jobs/{id}/cancel|resume|restart`;
live events `job.queued`, `job.started`, `job.progress`, `job.paused`, `job.finished`; error codes
`no_such_action`, `action_unavailable`, `action_cooldown`, `invalid_input`, `job_running`,
`job_state`. The web UI shows actions and the newest job on each connection card; the HA
integration adds action buttons, a job sensor per connection, the services
`open_parcels.run_action` and `open_parcels.cancel_job`, and the Home Assistant events
`open_parcels_job_paused` and `open_parcels_job_finished` (HA integration updated in lockstep:
it reads `/jobs` on every load). The demo courier has "Import history" to try them.

### Changed: the pool checks a finished sign-in's secret itself

With `OPENPARCELS_PROVIDER_ISOLATION=pool`, the secret a sign-in finishes with is validated again
against the provider's schema in the server, not only in the sandbox child, before it is stored.

### Added: `OPENPARCELS_PROVIDER_ISOLATION` runs the built-in providers in a sandbox

`pool` runs every built-in provider in one separate Node process under the permission model: no
files beyond its own code, no network, no child processes. It reaches the carriers only through
the server, which checks every request against the provider's manifest, and gets a connection's
settings, sign-in data and session only for the call that needs them. The default, `off`, keeps
them in the server's process ([`docs/provider-manifest-and-sandbox.md`](docs/provider-manifest-and-sandbox.md)
§2 says why). Environment only; nothing changes in the API apart from the new setting key.

### Added: provider manifests; providers reach only the hosts they declare

Every built-in provider has a manifest (`server/src/carriers/<folder>/open-parcels-provider.json`,
format in [`docs/provider-manifest-and-sandbox.md`](docs/provider-manifest-and-sandbox.md)): its
name, countries, connection kinds, live and fallback capabilities, and its permissions (network
hosts with a reason, image hosts, secret kinds, session store, User-Agent override). The server
checks each manifest against its code at start-up and refuses every request, and every redirect
hop, to a host the manifest does not list. Nothing changes in the API.

### Added: live events `token.used` and `health.changed`

- `token.used` (`{kind: "token" | "login", id, last_used_at}`) when an API token or token login
  is used, at most once per touch interval; kept 15 minutes like other short-lived events.
- `health.changed` (`{status, checks}`) when the overall status, a check or an inbox's connection
  changes; the server compares once every 30 seconds.

The Tokens and Status pages no longer poll every 30 seconds; they refresh on these events.

### Added: the inbox forms come from the server

`GET /api/v1/inbox-form` returns the inbox's configuration and sign-in forms as JSON Schema, in
the language asked for, like a carrier's in `GET /api/v1/carriers`. The web UI no longer keeps
its own copy of them.

### Changed: faster lists at 10,000 parcels

Measured with 10,000 parcels and 5,000 orders in a 384 MB container
([`docs/performance.md`](docs/performance.md)): every list endpoint stays under 200 ms p95.
Migration `0028-list-order-index` adds an index for the parcel list's order; parcel and order
visibility is checked once per query instead of per row. The web UI's parcel table and order list
draw 200 entries at a time with a "Show 200 more" button; search and counts cover all of them.

### Fixed: the v1 import's dry run on a fresh installation

`import-legacy --dry-run` (README, "Migrating") failed with "There is no encryption key" until the
server had started once. On an installation without a key and without a database it now runs with
a throwaway key and still creates nothing. Checked on a copy of a real v1 database; a made-up v1
database of the same schema is now part of the tests.

### Added: a searchable connection picker with provider logos

"Add a connection" opens a picker like Home Assistant's "Add integration": a search over name,
aliases and countries (in the page's language, accents ignored), one row per provider with its
logo, country badges and a chevron, and the inbox and fallback services in their own section.
Arrow keys move between rows, Enter in the search picks the first match; on phones the picker
fills the screen.

- `GET /api/v1/carriers` lists `aliases` (other names to search for) and `logo`: the path of the
  provider's bundled logo with its content hash (`/api/v1/carriers/<id>/logo?v=<hash>`, cached for
  good, no login needed), or null; the web UI then draws a monogram tile.
- Logos live in `server/logos/` with their source and licence per file in `manifest.json`. The
  first ones come from simple-icons (CC0): DHL, DPD, FedEx, Hermes, Shopee Xpress, UPS, USPS and
  Vinted Go. Carrier marks identify the carrier only.

### Changed: a third smaller image, Tailscale on demand

The amd64 image went from 427 MB to 284 MB (−143 MB): Tailscale is no longer in the image, npm,
npx and corepack are removed, and the server and its tools are ESM bundles (`server/dist`) next to
only the native modules (better-sqlite3, sharp; 22 MB instead of the whole `node_modules`). The
build starts the bundled server once and fails if it does not answer ready.

**Tailscale users:** nothing to change. The first start with `TS_STATE_DIR` set downloads the
pinned Tailscale release (SHA-256 checked) into `tailscale/<version>/` in the data folder, so that
start needs internet access once; without it, place the archive there by hand (README, "Tailscale").
The tools keep their paths (`node server/dist/tools/restore-backup.js` and the importers).

### Added: token logins, CORS and delta sync for clients elsewhere (decision record 0004 §6)

- **Token logins** for clients without cookies (a web UI on another origin, the Android app,
  client libraries): `POST /api/v1/logins` with the admin or reader password returns a 15-minute
  access token and a refresh token; `POST /api/v1/logins/refresh` rotates both,
  `POST /api/v1/logins/logout` ends the login. A refresh token used twice ends its login. Logins
  are listed and ended on the Tokens page (`GET`/`DELETE /api/v1/logins`) and end when a password
  changes. API tokens are unchanged; how both relate: decision record 0003 §6.
- **`OPENPARCELS_CORS_ORIGINS`**: exact origins (never `*`) that may call the API from a browser,
  without cookies. Changeable on the Settings page.
- **Live event stream with a token login:** `GET /api/v1/events?access_token=<access token>` for
  browsers' EventSource; API tokens still go in the `Authorization` header only.
- **Delta sync:** `GET /api/v1/sync?since=<cursor>` returns the parcels, events, orders, returns
  and connections changed after the cursor and the deleted ones ([`docs/sync.md`](docs/sync.md)).
  Migration `0027-sync-changes` lists every existing row once, so a client's first sync gets
  everything. Events now carry `updated_at` in the database.
- Unchanged items and order lines are no longer rewritten on every provider run, so return items
  keep their link to the order line.
- `docs/openapi.json` is published with each release ([`AGENT.md`](AGENT.md), "The API contract").

### Changed (breaking): one word per concept ([`docs/glossary.md`](docs/glossary.md))

Code, API, database, live events, web UI and docs now use the glossary's terms. The old names are
**gone, not deprecated**: the server neither sends nor accepts them.

| Old (removed) | New |
| :--- | :--- |
| `/api/v1/sources…` | `/api/v1/connections…` |
| `plugin` (connection, connection ref; `POST /api/v1/connections` body) | `provider` (required when adding a connection) |
| `source_kinds` (`GET /api/v1/carriers`) | `connection_kinds` |
| parcel `sources` with `source_id` | `connections` with `connection_id` |
| `barcode` (parcels, orders' parcels, calendar entries; `POST /api/v1/parcels` body) | `tracking_number` (required when adding a parcel) |
| `planned_from` / `planned_to` | `expected_from` / `expected_to` |
| `direction` `incoming` / `outgoing`, `legacy_direction` | `direction` `receiving` / `sending` |
| live events `source.*` | `connection.*` |
| live events `parcel.outgoing_registered` / `parcel.outgoing_delivered` | `parcel.sending_registered` / `parcel.sending_delivered` |
| `positionAt` in `parcel.live_position` | `position_at` |
| `invalid_source`, `source_backing_off` error codes | `invalid_connection`, `connection_backing_off` (same HTTP statuses, 400 and 429) |
| web UI address `/sources` | `/connections` (no redirect) |

**Stored data is migrated on start:** migration `0019-glossary-names` renames tables, columns and
directions; `0020-ha-import-markers` rewrites Home Assistant import markers to the new shape. Live
events stored before the upgrade are dropped, so a client reconnecting with an older
`Last-Event-ID` gets `resync` once and reloads over REST.

**What clients must do:** use the new names above. The Home Assistant integration, the Home
Assistant app and the browser extension are released in lockstep with this server version; an
older Home Assistant integration stops seeing connections and live events until it is updated.
Scripts that call the API by hand must switch paths and fields; nothing else is needed.

### Added: the web UI in English and German

The web UI follows the browser's language (English or German) and can be set under
**Settings → Language**; dates, times, numbers and amounts are formatted in the user's locale.
German texts use the German terms in [`docs/glossary.md`](docs/glossary.md). Error texts written
by individual providers or carriers stay as they are.

### Changed (breaking): error bodies carry `params`, the UI shows its own texts

Every error body is now `{ error, message, params }`. `error` is one of a fixed list of codes (see
`docs/openapi.json`); `message` stays an English explanation for scripts and logs; `params` holds the
values a client's own text needs (`resource` for `not_found`, `seconds`, `reason`, `detail`, …). The
web UI shows an English or German text per code instead of the server's message.

- Fastify's own refusals (unknown content type, bad JSON, body too large) are `invalid_request`
  with the status they had, no longer `fst_err_…` codes.
- A failed backup before deleting everything is `delete_backup_failed` (was `backup_failed`).
- `DELETE /api/v1/settings/config/{key}` for a key that is no setting stays 404 `not_found`; other
  refusals of that call are 400 `invalid_setting` with a `reason`.

### Changed (breaking): server texts by language, setting groups as ids

- `GET /api/v1/settings/config`: `group` is an id (`storage`, `server`, `security`, `tracking`,
  `retention`, `backups`, `map`; was the English name, e.g. `Storage`) and `key` is a fixed list.
  `description` stays English; the web UI has its own text per setting key.
- The server reads `Accept-Language` (English or German, English otherwise) for the texts it
  writes itself: sign-in flow labels, sign-in step texts and field labels, the `title` and
  `description` of every field in `config_schema` and `secret_schema` (`GET /api/v1/carriers`,
  `GET /api/v1/connections/{id}/sign-in/flows`), and map layer `label` and `attribution`
  (`GET /api/v1/map/layers`). Every provider form field now has a `title`. A flow without its own
  label is named `No sign-in`, `Username and password` or `API key` (was its type).
- Calendar entries (`GET /api/v1/calendar`) add `drop_off` and `cost`, shaped as on the return
  (parcels: `[]` and `null`), for clients with their own texts.

**What clients must do:** read setting groups as ids. The Home Assistant integration does not use
them.

### Changed (breaking): codes instead of English texts for states and errors

- Calendar entries (`GET /api/v1/calendar`) lose `details` (the English drop-off and cost lines):
  clients build their own text from `drop_off` and `cost`. The ICS feed writes its summaries and
  descriptions in English or German, chosen by `?lang=en|de` on the feed address, else by
  `Accept-Language`, else English; statuses are words now (`Status: Out for delivery`, was
  `out for delivery`) and `Tracking:` reads `Tracking number:`.
- Connections (`GET /api/v1/connections`, `/api/v1/status`) and connection live events lose
  `state_detail` / `detail`. `state_reason` is a code (`not_run_yet`, `not_signed_in_yet`,
  `sign_in_rejected`, `sign_in_unreadable`, `imported_without_sign_in`, `rate_limited`, `captcha`,
  `invalid_config`, `provider_missing`, `update_failed`, `provider_idle`,
  `inbox_sign_in_rejected`, `inbox_settings_invalid`, `inbox_unreachable`); what a provider or
  carrier wrote (an HTTP status, why it did nothing, a settings complaint) comes as
  `carrier_message`, untranslated.
- `/api/v1/status`: `scheduler.last_error` is the code `cycle_failed` and `backups.last_error`, the
  backup result's `error` (`/api/v1/data/backups`, `backup.finished`) and the `error` param of
  `backup_failed` / `delete_backup_failed` (was `detail`) are `no_space`, `permission_denied`,
  `read_only`, `not_a_folder` or `failed`. The server log keeps the full error.
- The web UI shows its own English or German text for every code.
- `GET /api/v1/settings/config`: a setting's `source` `app` is now `ha_app` (an option of the HA
  app), so "app" never stands alone.

**Stored data is migrated on start:** migration `0025-state-reasons` maps the stored English texts
to codes (the provider's part of "The last update failed: …" moves to `carrier_message`), drops
`state_detail`, sets a stored failed backup's error to `failed`, and empties the outbox (clients
resync once).

**What clients must do:** read `state_reason` and `carrier_message` instead of `state_detail` /
`detail`, and build calendar texts from `drop_off` and `cost`. The Home Assistant integration 0.8.0
does both and is released in lockstep.

### Changed: backups are private, versions name their commit

- Backups (and the unfinished `.partial`) are written with mode 0600 and the backup folder with
  0700; on start, the server restricts backups written earlier the same way.
- Versions are `2.0.0-dev.<date>` until 2.0.0. The image bakes in its commit
  (`OPENPARCELS_COMMIT`, a build argument); `GET /api/v1/status` and diagnostics return it as
  `commit`, and the Status page shows `Version 2.0.0-dev.20261125 (abc1234)`.
- `GET /api/v1/status` returns `install_id`, a random id kept for the life of the install, so
  clients such as the Home Assistant integration can recognise the same server (HA-010).

### Changed: third-party services (OP-079)

- **Background place lookup is off by default** for new installs (`OPENPARCELS_GEOCODING`).
  Migration `0023-geocoding-opt-in` saves `true` as a Settings page value for an existing install
  that ran with the old default and does not set the variable in its environment, so nothing
  changes there until you switch it off under **Settings → Map**.
- New settings: `OPENPARCELS_GEOCODING_URL` (Nominatim-compatible search endpoint),
  `OPENPARCELS_CONTACT_EMAIL` (added to the User-Agent), and `OPENPARCELS_MAP_OSM_URL`,
  `OPENPARCELS_MAP_TOPO_URL`, `OPENPARCELS_MAP_EOX_URL` to move the built-in layers elsewhere.
- The tile cache honours `Cache-Control` / `Expires` (a week when absent) and refreshes stale tiles
  with conditional requests. Tiles cached before keep aging by their file time.
- The OpenStreetMap credit links "Report a map issue"; the satellite layer is labelled
  "non-commercial use only" and credits the imagery year it serves; the address search shows the
  OpenStreetMap/ODbL credit. Terms and switching: [`docs/third-party-services.md`](docs/third-party-services.md).

### Removed (breaking): unused older routes (OP-059)

- `GET /tiles/{z}/{x}/{y}.png` (use `GET /tiles/osm/{z}/{x}/{y}`), and
  `POST /api/v1/connections/{id}/sign-in/start` / `…/sign-in/finish` (use the sign-in attempts:
  `POST …/sign-in/attempts`, then `…/attempts/{attempt}/continue` with `{"input": {"pasted": "…"}}`). No
  client of ours called them.
- Migration `0024-dead-schema` drops the unused `image_cache` table and the never-read
  `parcels.dimensions` and `parcels.manual_until` columns.

### Fixed

- **A carrier host that answers 429 (or 503 with `Retry-After`) is left alone by every
  connection** until the pause it asked for is over (at least 60 s, at most 24 h). Before, only
  the connection that met the limit waited, and a second account, a live read or a sign-in step
  could ask the same host again at once. The pacing of every provider is documented in
  [`docs/third-party-services.md`](docs/third-party-services.md).
- An inbox whose mail server accepts the connection but fails every sync backs off up to 15
  minutes instead of reconnecting every 30 seconds: the backoff now resets only after a whole sync.
- The web UI refreshes when retention archives a parcel (`parcel.archived`) and when an email
  starts an order (`order.created`); it ignored both before. The stream's message types are now
  listed in the API document, so the UI's handling is checked against the server's list (OP-052).
- `X-Next-Offset` on `GET /api/v1/parcels` is sent only when another page really follows, not on
  every full page (OP-053).
- Diagnostics, the API document and every User-Agent report the running version from
  `server/package.json` instead of three hard-coded ones (OP-056).
- Folding a shop's parcel into its carrier's keeps the time the owner set a manual status
  (`manual_at`) with that status (OP-058).
- **Live courier sessions survive a restart.** A stored session now names the connection that
  follows it, so the first run of another connection of the same parcel no longer ends it
  (migration `0022-live-state-connection`; sessions stored before the upgrade are dropped once and
  start again on their connection's next poll).
- Connections leaving the quiet window poll a few minutes after 00:00 and 06:00 instead of on the
  hour; a stale map tile is served at once while it refreshes in the background; parcel collages
  are only cached when every picture loaded, and pruned after 30 days; API tokens record their use
  at most once a minute.

### Added

- **Scheduled database backups** while the server runs (`OPENPARCELS_BACKUP_HOURS`, default 24;
  `OPENPARCELS_BACKUP_KEEP`, default 7; `OPENPARCELS_BACKUP_DIR`, default `backups/` in the data
  folder; all three also under **Settings → Backups**). A Backups card on the Settings page shows
  the newest result and the files kept and has **Back up now**; `GET`/`POST /api/v1/data/backups`;
  live event `backup.finished` (`ok`, `reason`, `file`, `bytes`, `error`). A restore tool,
  `node server/dist/tools/restore-backup.js <file> [--dry-run] [--force]`, checks a backup and puts
  it in place with the server stopped (README, "Backups and restore"). "Delete everything" now uses
  the same backup and deletes nothing when it fails (500 `backup_failed`); its backups count
  towards the number kept.
- **Status of every part:** `GET /api/v1/status` (readers) lists every connection and inbox with
  its state, failures, next run and any pause a carrier asked for, the scheduler, the live event
  stream and backups; `GET /api/v1/health` (public, no details) answers `ok`, `degraded` (a
  connection or inbox in error or needing sign-in, failing backups, a stalled scheduler) or
  `unavailable` (503, the database does not answer). `/api/v1/health/ready`, which the Docker
  health check uses, still only checks the database, so a carrier's bad day never marks the
  container unhealthy. The Status page shows all of it and refreshes on live events.
- [`docs/decisions/0003-accounts.md`](docs/decisions/0003-accounts.md): one household per
  installation (admin and reader password, API tokens), no user accounts.

- **Orders from order emails.** Inbox connections now act on the rules' order emails
  (`order_placed`, `order_confirmed`, `order_shipped`, `order_delivered`, `order_cancelled`):
  confirmations of AliExpress, Temu, eBay, MediaMarkt, Mindfactory, reichelt, Netto Online,
  Rasppishop, KSP, Shopify shops and the digital stores start an order with its items and date,
  later emails move it on, and an order email's tracking numbers are filed under its order.
  Orders merge by shop and order number; a PayPal receipt that quotes a shop's reference joins
  that shop's order (whichever email comes first) and keeps its own order only while no shop
  claims the number. Shops on Shopify are named after the sender, so two shops' `#1042` differ.
- Order statuses `cancelled` (nothing of it arrived) and `refunded` (money back without a
  return); both archive the order. An order without parcels takes the shop's word for `shipped`
  and `delivered`.
- `digital` on orders: orders of digital stores (Steam, GOG, Humble, Fanatical, Eneba, GAMIVO,
  Instant Gaming, MMOGA) are delivered when bought and never wait for a parcel.
- Order totals as the emails state them (rules 2.0.0-dev.12): an order's `total` is the shop's
  stated total, else a payment receipt's until the shop states one, else the sum of its priced
  lines (migration `0021-order-totals`). Boykisser.gg order confirmations.
- **Fallback services** (optional connections, off until added): **Universal lookup** (a
  universal-lookup service's address) and **17TRACK** (your own API key, API v2.2). They are asked
  only about parcels no built-in carrier follows, or that their carrier has not found for a day,
  one service at a time, cached and paced (see the README); their answers are filed under the
  parcel's own carrier. A code no carrier recognises can be added while one exists.
  `GET /api/v1/carriers` says `fallback` per provider.
- Live event `order.created` when an email starts an order; its data is the order like
  `order.updated` (without parcels).

- `expected_days` on parcels (and orders' parcels): the expected delivery as local days
  (`YYYY-MM-DD`, server time zone) when it is whole days, else null. The web UI shows these days
  instead of guessing from the times in the browser's zone (OP-044).
