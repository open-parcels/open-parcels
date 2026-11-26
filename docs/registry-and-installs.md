# Registry, installs and the Providers page

What TODO §3 "Registry repo …" and "Providers page …" built on 2026-11-26, narrowing decision
record [0002](decisions/0002-providers.md) §2.6, §2.8, §2.10 and §4 A–D. Code:
`server/src/installs/`, `server/src/api/routes/installs.ts`, `web/src/providers/`.

## The registry

- **`open-parcels/open-parcels-registry`**: `providers/<id>.json` (one verified entry each:
  `id`, `kind` (`provider`, `theme`, `consumer`), `name`, `repository`, `path`, reviewed
  `versions` newest first, each with its full commit), `blocklist.json`, `keys/allowed_signers`,
  and the generated `index.json` with its SSH signature `index.json.sig`
  (`scripts/sign-index <key>`, namespace `open-parcels-registry`). JSON rather than 0002's YAML:
  the server has no YAML parser and the files are small.
- **Signing key:** `registry-1` (Ed25519), embedded in `server/src/installs/registry.ts`. Its
  private half is on the NAS in `~/.config/open-parcels-registry/` (t3code container). The second,
  offline key from 0002 is not made yet; a new key ships with a server release.
- **The server** reads the index from `OPENPARCELS_REGISTRY_URL` (default the repository's raw
  `main`), verifies the signature with `node:crypto` (`installs/sshsig.ts`), re-reads it after
  12 hours, keeps the last good index when a read fails, and still uses an index past its
  `expires` with a notice of how many days it is over.
- **The blocklist** matches `repo` (host/owner/repo; GitHub without a host), `id` and versions
  (`*` or a list). `hidden` drops community hits, `block` and `critical` also refuse installs.
  Disabling an already installed `critical` item is not built yet.

## Installs

- **From a git URL** (`https://host/owner/repository`): GitHub, GitLab and Gitea/Forgejo, read
  through their HTTP API and raw file URLs (the image has no git), through the guarded fetch
  (public addresses only, no redirects, size and time limits). A release tag (`vX.Y.Z`) or a full
  commit; default the newest release tag. The commit is what is recorded.
- **Check, then install:** `POST /api/v1/providers/check` reads the repo manifest and every listed
  item's own manifest and answers names, hosts and why an item cannot be installed;
  `POST /api/v1/providers/install` installs one item. Tiers: `verified` when the registry lists
  that repository folder at that commit, else `community` (found by the topic search) or
  `custom` (typed URL).
- **Themes install for real:** the manifest and its bundled files at the pinned commit go to a
  staging folder, are checked by the theme loader, then replace `<data>/installs/themes/<id>/`.
  `GET /api/v1/themes` lists them after the built-in ones.
- **Code providers and consumers are refused** with `needs_bundles`: the server cannot load
  installed code until bundles and the per-tier sandbox exist
  ([`official-providers-repo.md`](official-providers-repo.md)). The check still shows them with
  their hosts.
- **Auto-update** (owner decision 2): on by default for verified installs, off for custom and
  community; built-in items update with open-parcels itself (the switch shows on and fixed). The
  hourly maintenance runs a pass every 12 hours (jittered): verified installs move to the
  registry's newest reviewed commit, the others to the newest release tag.
- **Table `installs`** (migration 0033): `kind`, `id`, `name`, `tier`, `repository`, `folder`,
  `version`, `commit`, `auto_update`, `installed_at`, `updated_at`; built-in items have no row.
- **Settings** (environment, `apply: env`): `OPENPARCELS_PROVIDERS_REMOTE` (default on; off
  fetches nothing), `OPENPARCELS_PROVIDERS_COMMUNITY` (default on, owner decision 3),
  `OPENPARCELS_REGISTRY_URL`.

## Community discovery

- GitHub search `topic:open-parcels-provider archived:false`, sorted by update, 100 per page,
  asked by the server (cached 6 hours, "Refresh" at most once a minute), the blocklist applied,
  repositories the registry lists left out. A hit whose name (without an `op-` prefix) is within
  two edits of a built-in or verified id says "Looks similar to …".
- **Community items are yellow with a warning sign** and installing one needs the "I understand
  this code is unreviewed" box; the warning links to the source at the exact commit and has the
  copy button for the review prompt of owner decision 6.

### Why the official providers repo has no `open-parcels-provider` topic

The topic is the community channel: everything it finds is shown as "Community · unreviewed",
yellow, with a warning. The official providers are the built-in tier, shipped in every image
and pinned by digest, so listing them there would label reviewed code as unreviewed and offer to
install copies of providers that are already built in (refused as `reserved` anyway). Verified
third-party items are reached through the registry, not the topic. So the topic stays off
`open-parcels/open-parcels-providers` (and off the registry repository).

## The Providers page

`/providers`, in the navigation after Consumers. Tabs Installed and Available (Verified or
Community), tier badges (Built in, Verified, Custom, Community · unreviewed), search, "Install
from URL" (URL, optional version, check, then install per item, with hosts and refusals),
auto-update switches and uninstall. Texts in English and German; "Provider" and "Consumer" stay
untranslated in German.

## Not built yet

Running installed code providers and consumers, the consent diff when an update asks for more,
rollback, `.opp` uploads, disabling installed `critical` items, the offline second key, the HA
app options and the `provider.*` live events.
