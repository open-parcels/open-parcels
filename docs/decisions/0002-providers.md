# 0002: Installable providers with trust tiers

- **Status:** accepted 2026-11-24 with the owner's decisions at the end of this record, which
  take precedence over the proposal text where they differ (notably: several providers per repo in
  folders listed by a repo manifest, not tags per provider; community discovery on by default).
  Implementation is tracked in `tasks/TODO.md` §3.
- **Builds on:** [0001](0001-architecture.md), §2.3 (repositories) and §2.4 (provider contract).
  It changes one rule there: carrier code no longer has to ship inside the image.

## 1. Context

Today every carrier is a module under `server/src/carriers/` (88 folders, about 33k lines).
`engine/builtin-carriers.ts` imports each one and passes it to `register()`, and `PluginRegistry`
holds the result. The boundary is narrow already:

- ESLint lets carrier code import only `provider/api.ts`. In practice carriers use `zod`,
  `node:crypto` and the provider API, and nothing else.
- `PluginContext` is the whole world a provider sees: `config`, `secret`, `http` (`PluginHttp`,
  the only way out to the network, with per-host token buckets and a refusal of non-public
  addresses), `clock`, `logger`, `session` (an encrypted per-connection store) and `reportUnknown`.
- Providers return plain data (`ParcelSnapshot`, `SignInTurn`, `LiveReading`). They never touch
  the database and never send events.
- Shared knowledge comes from `open-parcels-rules` (a vendored tarball, `2.0.0-dev.8`). That covers
  carriers, keys, status tables, locales, tracking-number patterns and 33 declarative email rules.
  It is never downloaded at runtime (0001 §2.3).
- Inboxes are core code (`MAIL_PLUGIN = "imap"`). They run every email through the rules.
- The web UI's Connections page lists configured connections. "Add a connection" is a flat carrier
  dropdown, then a kind, then a form generated from the provider's zod schema.

The owner wants providers to become separately installable from the web UI. Each provider would
be its own git repo with a manifest, and the UI would show three trust tiers: verified (listed in
an org registry), custom (any git URL the user pastes) and community (GitHub topic
`open-parcels-provider`, with an org-maintained blocklist). The experience should feel like Home
Assistant's "Add integration".

The hard part is not packaging. **Provider code runs on the user's server, next to every
credential the user has stored.** Today that is acceptable because every line is reviewed in this
repo. Once code can be installed at runtime, it no longer is.

### Glossary

| Term | Meaning |
|---|---|
| **Provider** | The installable unit: a manifest plus data, and optionally code. Replaces "provider" in the UI |
| **Capability** | What a provider offers: `carrier`, `tracking`, `account`, `shop`, `live`, `mail-rules`, `status-table`, … |
| **Connection** | A configured instance of a provider's capability (unchanged: one row in `connections`) |
| **Registry** | The signed index in the org that lists verified providers, pinned versions and the blocklist |
| **Tier** | `bundled`, `verified`, `custom` or `community`: where an install came from and what vouches for it |

### Prior art

| System | What it does | What we take |
|---|---|---|
| **Home Assistant core integrations** | Reviewed and shipped with the core. Custom integrations load unsandboxed; core keeps a hard-coded list that blocks known-bad custom integration versions | A list that ships with the core and can block versions already installed |
| **HACS** | `hacs/default` holds per-category JSON lists of `owner/repo`. `blacklist` is a flat `["owner/repo"]` array; `removed` holds objects `{repository, removal_type: blacklist\|removed\|critical, reason, link}`. Custom repos are added by URL. No code review, no sandbox | Blocklist by `owner/repo` with type, reason and link; "critical" removes installed copies. Custom-URL tier. **Not** taken: no pinning (it installs the latest release) |
| **Obsidian** | `community-plugins.json` (`{id, name, author, description, repo}`) after a one-time review; installs `manifest.json` + `main.js` from the repo's releases. Separate deprecation list by version. "Restricted mode" turns all community code off. No sandbox | A one-time review is not enough: later releases are unreviewed. Per-version deprecation. A global off switch |
| **Jellyfin** | Repositories are JSON manifests: `versions[]` with `targetAbi`, `sourceUrl` and a checksum. Users add repo URLs | A version's compatibility comes from an ABI/API range, and each artifact carries a checksum in the index |
| **Grafana** | Signature levels: Grafana, Commercial, Community (reviewed, signed by Grafana) and Private (self-signed for listed URLs). `MANIFEST.txt` hashes every file; modified providers don't load; unsigned ones only behind an allow-list setting | **Per-file hashes over the whole package, checked on every load**, and tier labels that come from a signature, not from metadata |
| **VS Code Marketplace** | Verified publisher badge (domain ownership), marketplace-signed packages, a malicious-extension kill list, Workspace Trust | "Verified" says who published it, not that it is safe. The kill list is pushed to installed clients |
| **MetaMask Snaps** | Third-party code in a hardened JS sandbox (SES) inside an isolated process. The manifest declares permissions (network, storage, specific APIs) plus a `shasum` of the bundle. An allow-list of audited snaps for the main UI | **The closest analogue**: least-privilege manifest permissions shown at install, a digest in the manifest, and a reviewed list |
| **Backstage** | Providers are npm packages; "dynamic providers" load at runtime with no isolation | A warning: runtime-loaded JS without isolation is the default, and it is what we avoid |
| **npm / JSR provenance, Sigstore** | Build provenance through CI OIDC (Fulcio certificate + Rekor log entry); verifiable with `sigstore-js` | Useful as an *extra* badge for third parties with their own CI. It cannot be our root of trust, because workflows don't run under the owner's account |

## 2. Decision (proposed)

### 2.1 Two kinds of provider: declarative and code

**Declarative provider.** Data only, validated against the JSON Schemas `open-parcels-rules`
already has. It may contain:

- carrier entries (id, names, aliases, domains, tracking URL templates);
- status tables;
- tracking-number patterns;
- locale tables;
- email rules;
- fixed public keys.

It runs no code. The worst it can do is produce wrong parcels or a slow regular expression
(§2.7).

**Code provider.** A declarative part plus `entry`: a prebuilt ESM bundle that implements
`CarrierPlugin` (account, tracking, shop, live, sign-in flows). It always runs in the provider
sandbox (§2.7).

The split matters because most of what the community will contribute is email rules and status
tables, and those can be installed from any tier with almost no risk. Code is where the risk is,
so the UI keeps the two visibly apart.

**The inbox is in charge of email access, not the provider.** Inbox connections stay `imap` in the
core and decide which emails go to which provider. Each provider declares email filters in its
manifest. The core matches them and hands a provider **only the emails its filters selected**
(§2.14). No provider, of any tier, can ask for "all email": a provider that saw the whole inbox
would see password resets and bank email.

### 2.2 Capabilities

```
provider
├── data (declarative, any tier)
│   ├── carriers          carrier identities, aliases, domains, tracking URLs
│   ├── tracking-numbers  patterns (portable regex subset)
│   ├── status-tables     raw → canonical status
│   ├── locales           delivery-date phrases
│   ├── mail-rules        sender/subject/extract rules + test vectors
│   └── keys              fixed public carrier keys
└── code (sandboxed)
    ├── tracking          track(codes)                  → connection kind "tracking"
    ├── account           fetchAccount()                → connection kind "account"
    ├── shop              fetchAccount() with orders    → connection kind "shop"
    ├── live              readLive(target)
    ├── sign-in flows     none | credentials | api_key | interactive
    ├── mail              parseMail(mail) for emails its filters matched   (§2.14)
    └── actions           runAction(id, input) for buttons on its connections (§2.12)
```

These map one to one onto today's `CarrierPlugin` fields and `SOURCE_KINDS`, so the engine,
scheduler, reconciler and API stay as they are. `GET /carriers` becomes a view over
`GET /providers` (§2.9).

A provider may offer several carriers or shops; `id` names the package, not the carrier. One
example is a regional postal group. Carrier ids live in one global namespace, enforced at
install (§2.6).

### 2.3 Manifest

The manifest is `open-parcels-provider.yaml` at the provider root, which may be a subdirectory
(§2.5). Its JSON Schema lives in `open-parcels-rules/schema/provider.schema.json`, so the server,
the SDK's `validate` command and editors all use one schema. **A repo without a manifest that
validates is not a provider**: it is not offered, not installed and not listed.

```yaml
# yaml-language-server: $schema=https://open-parcels.github.io/schema/provider-1.json
schema: 1                         # manifest format version
id: hermes_de                     # [a-z0-9_]{2,40}; unique; verified ids are reserved by the registry
name: Hermes Germany
version: 1.4.2                    # semver; must equal the git tag without "v"
description: Parcel tracking and myHermes accounts for Hermes Germany.
authors: ["Jane Example <jane@example.invalid>"]
license: MIT
repository: https://github.com/example/op-hermes-de
icon: assets/icon.svg             # SVG ≤ 32 KB, sanitised on install; PNG ≤ 64 KB
countries: [DE]

engine:
  api: "^1.3.0"                   # provider API range (§2.4), checked before install
  core: ">=2.4.0"                 # optional: minimum server version, for UI features

provides:
  carriers: [hermes]              # carrier ids this provider claims
  connections: [tracking, account]    # connection kinds; [] for a declarative provider
  live: false
  data:                           # paths are relative to the manifest; globs allowed
    carriers: data/carriers.yaml
    status: [data/status/hermes.yaml]
    tracking_numbers: [data/tracking-numbers/hermes.yaml]
    mail_rules: [data/mail/*.yaml]
    locales: []

entry: dist/provider.mjs          # omit for a declarative provider

permissions:                      # shown at install; anything not listed is refused
  network:
    - host: api.my-deliveries.de
      reason: Public tracking API used by the Hermes website.
    - host: .myhermes.de          # leading dot: subdomains too
      reason: myHermes account sign-in and parcel list.
  image_hosts: [.hermesworld.com] # what the image proxy may fetch for this provider
  secrets: [credentials]          # credentials | api_key | token (from interactive sign-in)
  session: true                   # per-connection encrypted session store
  user_agent: false               # true only with a reason; overriding the honest UA
  browser: false                  # reserved for the -browser image variant (0001 §2.4)

  mail:                           # §2.14; absent: the provider never receives email
    attachments: metadata         # metadata | content (content: ≤ 5 MB each, listed types only)

mail:                             # filters the core matches; see §2.14 for the rules
  - id: shipping
    from_domains: [hermes-europe.de, myhermes.de]
    subject: ["sendung|paket|zustellung|parcel"]
    parse: code                   # code: entry's parseMail; or a rule file (declarative)
  - id: notice
    from_domains: [myhermes.de]
    parse: data/mail/parcel-hermes.yaml

actions:                          # §2.12: buttons on this provider's connection cards
  - id: open_account
    label: Open myHermes
    kind: link
    url: "https://www.myhermes.de/empfangen/sendungsverfolgung/"
    connection_kinds: [account]

support:
  issues: https://github.com/example/op-hermes-de/issues
  min_poll_interval: 15m          # informational; the scheduler's floors still apply
```

**Validation on install:**

- Schema validation of the manifest and of every data file it lists.
- `version` must equal the tag.
- Every file referenced must exist inside the provider root; no `..` and no symlinks leaving it.
- `entry` must be a single file. Imports other than the SDK's virtual module are refused when the
  bundle is parsed.
- Data files are size-capped: 2 MB per file, 10 MB per provider.
- Every regular expression must pass the portable-subset lint, plus the linear-time check (§2.7).
- Email-rule test vectors must pass against the provider's own fixtures, if it ships any.

`permissions.network` already exists implicitly: today's `HttpPolicy.limits` lists hosts. It
becomes mandatory and enforced. A wildcard `*` host is accepted only for `custom` installs, with
a red warning, and never for `verified`.

### 2.4 Provider API versioning

- **The provider API gets its own semver**, independent of the server version. It starts at `1.0.0`
  when the IPC protocol (§2.7) is frozen.
  - Minor: added context methods, added optional fields.
  - Major: anything a working provider could notice.
- **The core supports the current major and the previous one** for at least six months after a
  major. A provider whose `engine.api` the core can't satisfy is installable only as "incompatible
  (disabled)", with the reason shown, so the user keeps its connections and config.
- **Types and tools ship as `@open-parcels/provider-sdk`.** That covers the `CarrierPlugin` types
  (moved from `server/src/provider/api.ts`), the `kit/` helpers, `defineCarrier`, an esbuild
  preset, `op-provider validate`, and a test harness that replays recorded fixtures through
  `MockAgent`. The ESLint boundary that exists today becomes the SDK's public surface.
- **The SDK is published from the owner's machine** (`npm publish`), because workflows don't run
  under the account. npm provenance is therefore not available for it; that is acceptable (§2.6).

### 2.5 Packaging and distribution

- **A version is a git tag** `vX.Y.Z` on a commit whose manifest says `X.Y.Z`. Releases are
  optional; the tag is what counts. That works the same on GitHub, GitLab, Gitea, Forgejo and a
  bare server.
- **The bundle is committed, not built on install.** `entry` points at a prebuilt
  `dist/provider.mjs` checked into the tagged commit, or attached as a release asset named in the
  manifest. **The server never runs `npm install`, a build or any script from a provider.** npm
  install scripts are the most common supply-chain attack path, and the root `package.json`'s
  `allowScripts` discipline would be meaningless if installs ran them.
- **Fetching uses `isomorphic-git` over smart HTTP**: a shallow fetch of exactly the pinned
  commit, without the `git` binary in the slim image and with no hooks. It works for any forge.
  Forge archive URLs (`/archive/<sha>.tar.gz`) are a faster fallback, but their bytes aren't
  stable, so the digest is never computed over the archive.
- **The provider digest** is `sha256` over a canonical listing (sorted path, mode, `sha256` of the
  content) of every file under the provider root. This is the same idea as Go's `h1:` dirhash
  and Grafana's `MANIFEST.txt`. It does not depend on how the bytes were fetched.
- **Subdirectories are allowed.** `repository` + `path` lets one repo hold many providers. That
  matters for the official providers (§3.1, push-back).
- **Air-gapped installs** use a provider archive (`.opp`, a tar with the files and a `digest`
  line), uploaded in the UI or dropped in `/data/providers/inbox/`. It is treated exactly like a
  custom git install.

**On disk:**

```
/data/providers/
  installed.json                 # mirror of the providers table, for recovery
  <id>/<version>-<digest12>/     # immutable once written; read-only to the sandbox
  <id>/current -> 1.4.2-3fa9…    # atomic switch on update
  cache/registry/                # last verified registry index + signature
```

### 2.6 Trust tiers and verification

Four tiers. The owner's three plus `bundled`, which the image needs anyway for offline first
start.

| Tier | Badge | Comes from | What vouches | Pinned by | Sandbox |
|---|---|---|---|---|---|
| **Bundled** | `Built in` (grey) | Shipped in the image | Release of the image itself | Image digest | Shared verified pool (§2.7) |
| **Verified** | `Verified` (green, shield) | Org registry | Owner review of exactly this commit; registry signature | Commit SHA + provider digest per version | Shared verified pool |
| **Custom** | `Custom` (blue) | URL the user pasted, or an uploaded `.opp` | The user's choice; optional tag signature (TOFU) | Commit SHA + digest recorded at install | **Own process** |
| **Community** | `Community · unreviewed` (amber, warning) | GitHub topic search | Nothing; not on the blocklist | Commit SHA + digest recorded at install | **Own process** |

**Wording:** the UI never says "safe". "Verified" means *the open-parcels maintainers reviewed
this exact version*; the detail view says what review covers (§2.6.3).

#### 2.6.1 The registry repo

A new repo, `open-parcels/open-parcels-registry`, holds:

```
providers/<id>.yaml   # one file per verified provider (reviewable diffs, few merge conflicts)
blocklist.yaml
keys/allowed_signers  # SSH public keys allowed to sign the index
index.json            # generated: everything above, flattened
index.json.sig        # SSH signature (ssh-keygen -Y sign -n open-parcels-registry)
```

A verified entry:

```yaml
id: hermes_de
repository: https://github.com/open-parcels/open-parcels-providers
path: providers/hermes_de
capabilities: [tracking, account, mail-rules, status-table]
owners: [open-parcels]            # who may propose new versions
versions:
  - version: 1.4.2
    commit: 3fa9c1e5d2b7…         # full 40-char SHA
    digest: sha256:7d1e…          # §2.5 provider digest
    api: "^1.3.0"
    reviewed: 2026-11-23
    reviewer: Bluscream
  - version: 1.4.1
    commit: 0b2e…
    digest: sha256:c044…
    api: "^1.3.0"
    reviewed: 2026-11-02
    reviewer: Bluscream
```

**Signing:** `index.json` is generated and signed **on the owner's machine** by a script in the
registry repo (`scripts/sign-index`), using an SSH key: the same mechanism as git's SSH commit
signing, no extra tool. The signed index is then pushed. The server embeds the allowed public
keys. Two keys from day one, one kept offline, so a lost key can be rotated by shipping a core
release.

- Sigstore keyless signing needs an OIDC identity flow, usually CI's; minisign is fine but is one
  more tool. SSH signatures are verifiable in pure JS with `node:crypto` (ed25519).
- The index carries `generated_at` and `expires` (180 days). A stale index is still used, with a
  "registry is N days old" notice, so a forgotten re-sign never breaks installs. The expiry stops
  a mirror from replaying an ancient index silently. This is a deliberately small subset of TUF;
  full TUF is not worth it at this scale.
- The index is fetched from `raw.githubusercontent.com` and, as a fallback, from the org's Pages
  site. Both are untrusted transports, because the signature is what counts. A user may point
  `OPENPARCELS_REGISTRY_URL` at a mirror.

#### 2.6.2 The blocklist

```yaml
schema: 1
entries:
  - repo: github.com/evil-example/op-dhl-plus   # host/owner/repo; host defaults to github.com
    versions: "*"                                # "*", a semver range, or a list of commits
    severity: critical                           # see below
    reason: Sends stored DHL credentials to a third-party host.
    link: https://github.com/open-parcels/open-parcels-registry/issues/12
    added: 2026-11-23
  - repo: github.com/someone/op-spam-rules
    versions: "*"
    severity: hidden
    reason: Not a provider; reuses the topic.
  - id: gls_unofficial                           # by provider id, wherever it comes from
    versions: "<1.0.3"
    severity: block
    reason: Logs tracking numbers in clear text; fixed in 1.0.3.
  - digest: sha256:ab12…                         # by content, catches re-uploads under new names
    severity: critical
    reason: Same payload as the first entry.
```

| Severity | Community list | Install | Already installed |
|---|---|---|---|
| `hidden` | not shown | allowed by URL, as custom | untouched |
| `block` | not shown | refused | warning banner; updates offered |
| `critical` | not shown | refused | **disabled at once**, its connections paused, a banner explains why. The user may re-enable it only by typing its id |

The blocklist applies to **every tier**, including custom installs (matched by host/owner/repo,
id and digest). A copy is bundled in each image, so even an offline install has a recent list.

#### 2.6.3 Review process (verified tier)

1. The author opens a PR to the registry with `providers/<id>.yaml` (or a new version entry).
2. The reviewer reads the diff **between the previously pinned commit and the new one**, not the
   whole repo. The bundle must be reproducible from connection: the registry's check script runs the
   SDK's esbuild preset at the commit and compares the digest.
3. Checklist (in the registry's `REVIEW.md`):
   - network hosts justified;
   - no `*` host;
   - no `user_agent` override without a reason;
   - secrets are used only toward the declared hosts;
   - no obfuscated code;
   - fixtures contain made-up data only;
   - the API range is honest;
   - email rules have test vectors.
4. The owner merges, then regenerates and signs the index locally.
5. Withdrawing a version: remove it from `versions`. If it is dangerous, add a blocklist entry.

Without Actions, the check script is run by hand. The PR template asks the author to paste its
output; the reviewer reruns it.

#### 2.6.4 Custom and community signatures

Signatures are optional. If the tagged commit or tag carries an SSH or GPG signature, the install
records the key fingerprint. Later updates signed by a **different** key, or unsigned where the
first was signed, get a "publisher key changed" warning before installing (trust on first use).
That is the most a non-reviewed tier can honestly offer. A Sigstore bundle attached to a release
can be verified with `sigstore-js` later and shown as a "build provenance" badge. It is never
required.

### 2.7 Security model and isolation (the core of this record)

#### What we protect

| Asset | Today | Threat from a hostile provider |
|---|---|---|
| Other connections' secrets and sessions | Encrypted in SQLite; key in `/data/secret.key` | Read the key or the DB, decrypt everything |
| The user's email | Only the core sees it | Read via an email capability or DB access |
| Admin/session tokens, API tokens | DB | Take over the instance |
| The LAN | `PluginHttp` refuses non-public addresses | SSRF into the home network (router, HA, NAS) |
| Its **own** connection's credentials | — | Exfiltrate them to its own server |
| Availability | — | Hang the event loop, exhaust memory, flood a carrier |

The last-but-one row cannot be prevented entirely: a tracking provider needs the credential it
signs in with. **It can be bounded:** the credential may only travel to the declared hosts,
which a reviewer or the user saw at install.

#### Options evaluated

| Option | Isolation | Cost on a Pi | Fit with today's code | Verdict |
|---|---|---|---|---|
| **In-process import** (today) | None | Lowest | Perfect | Bundled and verified **only during migration** |
| **`node:vm` / `vm.Module`** | None: not a security boundary (prototype escapes); 0001 already removed it | Low | Good | No |
| **`worker_threads`** | Separate heap, same process. The permission model is process-wide; a worker can't be confined more than its parent | Low | Good | Resource limits only, not security |
| **`isolated-vm`** (V8 isolates) | Strong memory isolation, no Node APIs | Low | Needs a host bridge for everything, a native addon (on `allowScripts`), and maintenance has slowed | Plausible, but a native dependency for the core's most sensitive path |
| **SES / Hardened JS (`lockdown` + Compartments)** | Capability-based isolation within one realm | Low | Good: providers already get only `PluginContext` | Good **second** layer, not alone: same process, so a single SES bypass exposes everything |
| **QuickJS compiled to WASM** | Strong: no ambient authority at all | Higher CPU; async bridging; `zod`/`node:crypto` must be re-provided | Weak: every provider and the SDK must target a non-Node runtime | Keep as the fallback if the process model proves leaky |
| **Extism / WASM components** | Strong | Medium | Providers in other languages, but a whole new SDK | Out of scope |
| **Deno subprocess** (`--allow-net=hosts`) | Good: host-scoped network permissions | A second ~100 MB runtime in the image | Medium | Not worth a second runtime: the network must be brokered anyway (rate limits, private-address checks) |
| **Child Node process + permission model + brokered I/O** | Separate address space; no fs writes, no network, no child processes, no addons; all I/O through IPC to the host | ~30–45 MB per process | **Very good**: `PluginContext` is already the only interface, and it serialises | **Recommended** |
| **Separate container per provider** | Strongest | Needs the Docker socket, which is worse than the risk itself | Poor | No |

#### Recommendation: the provider host

Each sandbox is a **child Node process** started by the core with:

```
node --permission
     --allow-fs-read=/app/provider-runtime,/data/providers/<id>/<version>   # nothing else
     # no --allow-fs-write, --allow-net, --allow-child-process, --allow-worker,
     # --allow-addons, --allow-wasi
     --max-old-space-size=96 --disallow-code-generation-from-strings
     /app/provider-runtime/host.mjs
```

- **No direct network at all.** `--allow-net` exists since Node 25 and is not passed. Every
  request goes over IPC to the core's `PluginHttp`, which:
  - enforces the provider's `permissions.network` (on every redirect hop too);
  - refuses non-public addresses before and at connect time, as the image proxy does;
  - applies the token buckets and the honest User-Agent;
  - caps body sizes.

  This is today's code path, with one more check.
- **Secrets are scoped per call.** The host sends exactly one connection's `config`, `secret` and
  `session` with each call, and the child keeps nothing between calls. That is a protocol rule; a
  provider may still cache in memory, which is harmless because it only ever sees its own
  connections. The child never sees `/data`, the secret key or the DB.
- **The session store is brokered** (`load`/`save` over IPC, size-capped at 256 KB), and so are
  `logger` (the core's scrubber runs on it) and `reportUnknown`. Cookie jars are serialised with
  `serializeJar`/`restoreJar`, which exist already.
- **Results are untrusted input.** Snapshots, sign-in turns and live readings are validated with
  zod in the core before the reconciler sees them, size-capped, and have their URLs checked:
  `url` must be https, and image URLs must be on `image_hosts`.
- **Resource limits:**
  - a hard timeout per call: track/fetch 120 s, sign-in step 60 s, live read 20 s;
  - on timeout the process is killed and restarted, and the run counts as a transient failure.
    A network error never triggers a new sign-in (0001's rule, unchanged);
  - three crashes in ten minutes disable the provider until the user re-enables it.
- **SES `lockdown()` runs inside the child** before the provider bundle is evaluated. It freezes
  intrinsics, so a provider can't monkey-patch the runtime's IPC code, and providers run in a
  Compartment whose only global is the SDK's endowment. Two independent layers: the permission
  model guards the OS, SES guards the IPC shim.

**Process layout, to keep memory sane on a Pi:**

- One **verified pool** process for `bundled` + `verified` providers. They are reviewed, so
  isolating them *from the core* is what matters; isolating them from each other is not.
- One process **per custom/community provider**.
- Every sandbox starts lazily, on the first connection that needs it, and stops after 10 minutes idle.
  A typical install with two community providers runs three extra processes, about 120 MB.
- Setting `OPENPARCELS_PROVIDER_ISOLATION=strict` gives every provider its own process.

**Honest limits.** Node's own documentation calls the permission model protection for trusted
code, not a sandbox for malicious code, and bypass CVEs have been fixed in it (Unix-socket
network bypass, January 2026). Mitigations:

- the child has no network permission *at all*, so there is no host allow-list to get wrong;
- the core refuses to start sandboxes on a Node release below a minimum patched version;
- the container's read-only root and non-root user still apply;
- the community tier is off by default (§2.8).

If an escape class appears that the core can't patch around, community providers move to the
QuickJS/WASM runtime. The IPC protocol is designed so the runtime is swappable.

**Declarative data is not free of risk either:**

- **Regular expressions** go through the existing portable-subset lint (no lookaround, no
  backreferences) and run on V8's linear-time engine (`--enable-experimental-regexp_engine`
  with the `l` flag, or `re2` if that stays experimental), so a crafted pattern can't hang email
  processing.
- **Tracking-number patterns from non-verified providers** only ever match for their own
  carrier ids and rank below bundled/verified patterns. A community pattern of `.*` must not
  claim every code the user adds.
- **Email rules from non-verified providers** can only produce snapshots tagged with their
  provider. Their extracted values pass the same plausibility checks as today
  (`isPlausibleOrder`), and they never mark email read.
- **Carrier ids** that a verified or bundled provider has registered are reserved. A custom or
  community provider claiming `dhl` is refused at install.

### 2.8 Install, update, uninstall

**Install (any tier):**

1. **Resolve.**
   - Verified: the registry entry → commit + digest.
   - Custom: the URL → list tags, pick the newest semver tag (or a tag/commit the user typed).
   - Community: the search hit → same as custom.
2. **Check the blocklist** (repo, id) before fetching.
3. **Fetch** the commit (§2.5) into `/data/providers/.staging/`.
4. **Verify.**
   - Digest: must equal the registry's for verified installs; recorded for the others.
   - Blocklist again, by digest.
   - Manifest and data validation (§2.3).
   - API compatibility.
   - Carrier-id collisions.
5. **Show the consent screen** (§4, wireframe D): tier, publisher, network hosts, secrets kinds,
   capabilities, and for code providers from the custom/community tiers a red notice.
6. **Commit.** Move to `<id>/<version>-<digest12>/`, switch `current`, insert into `providers`,
   reload the sandbox. Write a `provider.installed` event.

**Update:**

- **Checks:**
  - Verified: the registry index refresh, every 12 h, jittered.
  - Custom/community: `git ls-remote` for new tags every 24 h, only for installed providers.
- **Updates are offered, never applied silently**, except for verified providers with
  "auto-update verified providers" switched on (default on, matching the owner's HA update
  policy of notify, then apply).
- **If the new version asks for more** (new hosts, new secret kinds, new capabilities), the
  consent screen shows the diff and updating needs a click, even with auto-update on.
- **The previous version stays on disk.** "Roll back" switches `current` back.
- **Config compatibility:** a provider may export `migrateConfig(fromVersion, config)` (pure,
  run in the sandbox). A connection whose config no longer validates is set to `error` with "settings
  need attention", never dropped.

**Uninstall:**

- It is refused while connections use the provider. The dialog lists them and offers "remove the
  connections too".
- Parcels keep their history; their `parcel_connections` links go the way connection deletion already
  handles them.
- The files are deleted; the row is kept with `removed_at` so the audit trail survives.

**New table:**

| `providers` | id, tier, repository, path, version, commit, digest, api_range, manifest (JSON), permissions_granted (JSON), signer_fingerprint, state (enabled/disabled/incompatible/blocked), installed_at, updated_at, removed_at |
|---|---|

`connections.provider` keeps its meaning (a provider id), so existing connections need no migration. The
API gains:

- `GET /providers` (installed);
- `GET /providers/available?tier=verified|community&q=`;
- `POST /providers` (`{registry_id}`, `{url, ref?}`, or a multipart `.opp`);
- `POST /providers/{id}/update`, `POST /providers/{id}/rollback`, `DELETE /providers/{id}`;
- events `provider.installed`, `provider.updated`, `provider.removed` and `provider.blocked`.

All of them are admin-only, by the existing method rule.

**Global switches** (environment variables, mirrored as HA app options):

| Variable | Default | Effect |
|---|---|---|
| `OPENPARCELS_PROVIDERS_REMOTE` | `true` | `false`: no registry fetch, no search, no update checks (air-gapped) |
| `OPENPARCELS_PROVIDERS_CUSTOM` | `true` | Allow installs by URL/upload |
| `OPENPARCELS_PROVIDERS_COMMUNITY` | `false` | Show the community tab (and query GitHub) |
| `OPENPARCELS_PROVIDERS_LOCKED` | `false` | Nothing can be installed or updated from the UI. Kiosk/managed installs, and an Obsidian-style "restricted mode" |
| `OPENPARCELS_REGISTRY_URL` | org index | Mirror |
| `OPENPARCELS_GITHUB_TOKEN` | unset | Raises the search limit (§2.10). Stored as a secret, never logged |

### 2.9 Home Assistant

- **The HA app** keeps `/data` as its only writable path, so providers live in
  `/data/providers` and are included in HA backups. Downloaded caches go under `backup_exclude`.
  The HA app options above appear in the HA app's configuration tab, with the community tab off by
  default.
- **The ingress UI** is the same web UI, so the Providers page works unchanged under ingress. The
  ingress listener already counts as the owner, so installs from ingress are admin actions.
  This is right: whoever can reach the HA app page is an HA admin.
- **The `open-parcels-ha` integration is unaffected at the contract level.** It still gets a
  device per connection and reads `connection.provider`; it should show the provider's name and tier
  (from `GET /providers`) in the device's model and manufacturer fields, and listen for
  `provider.blocked` to raise an HA repair issue ("Open Parcels disabled provider X: reason").
  That puts a critical blocklist hit in the HA notification centre, where the user will see it.
- **Connection actions** appear as button entities, a job sensor and the services
  `open_parcels.run_action` / `cancel_job` (§2.12). Imported history is flagged so automations
  don't fire for it (§2.15).
- **The HA config flow does not install providers.** It links to the ingress Providers page.
  Installing code is something to do in one place, with the consent screen.

### 2.10 Community discovery and GitHub limits

- **The query** is `GET /search/repositories?q=topic:open-parcels-provider+archived:false&sort=updated&per_page=100`.
  Search is 10 requests/min unauthenticated and 30 with a token, in its own bucket apart from
  the 60/h core limit. One query covers up to 100 providers; pages are fetched only on scroll.
- **The server queries, never the browser**, so the blocklist is applied before anything reaches
  the UI and every user of one instance shares one cache. The cache is 6 h with the ETag;
  "Refresh" is allowed once a minute. A 403/429 shows "GitHub is rate-limiting this server; try
  again in N min" with the cached list.
- **A search hit is not yet a provider.** The list shows repo metadata only, labelled "manifest
  not checked". The manifest is fetched from `raw.githubusercontent.com` (not the API) when the
  user opens the detail view, at the newest tag's commit, and validated there. Hits without a
  valid manifest show "not a valid provider" and can't be installed. Validated results are cached
  by commit, so they are never fetched twice.
- **Only GitHub is searched.** GitLab/Gitea providers reach users by URL (custom) or by
  becoming verified. The registry may also carry a hand-curated `community.yaml` of non-GitHub
  repos later.
- **Typosquatting is checked.** A community hit whose name or id is within edit distance 2 of a
  verified provider gets a "looks similar to the verified X" notice.

### 2.11 Offline and air-gapped behaviour

- **First start works with no network.** Bundled providers, the bundled registry snapshot and
  the bundled blocklist are in the image.
- **`OPENPARCELS_PROVIDERS_REMOTE=false` turns off every outbound call this record adds.**
  Installs still work from `.opp` uploads and from `/data/providers/inbox/`, verified against the
  bundled registry: a verified provider's digest matches even offline.
- **Registry outages** fall back to the last cached signed index; installs of verified versions
  in it keep working. A failed fetch never disables anything.
- **An installed provider never needs the network to load.** Updates are the only thing that
  stops.

### 2.12 Connection actions

Providers may put buttons on their connection cards: "Import history", "Open account page",
"Re-register device", "Fetch delivery photos" and so on.

#### Kinds of action

| Kind | Runs | Example | Sandbox |
|---|---|---|---|
| `link` | Nothing on the server: the UI opens a URL | "Open myHermes" | None; the URL must be https and on the provider's `permissions.network` hosts |
| `task` | Provider code, `runAction()` in the sandbox, as a **job** | "Import history", "Refresh delivery photos" | Same process and broker as runs |

There is no third kind. A "quick" action is a task that happens to finish fast; one code path
keeps progress, cancellation and locking uniform.

#### Manifest declaration

```yaml
actions:
  - id: import_history                  # [a-z0-9_]+, unique within the provider
    label: Import order history
    description: Reads every order on the account, back to the first one. Can take hours.
    kind: task
    connection_kinds: [shop, account]
    when_state: [ok]                    # only offered while the connection is signed in and healthy
    input:                              # JSON Schema subset, rendered by the existing SchemaForm
      type: object
      properties:
        since_year: { type: integer, minimum: 1995, title: "Oldest year (empty: everything)" }
        include_digital: { type: boolean, default: false, title: "Include digital orders" }
    weight: heavy                       # light | heavy: heavy runs at most one at a time per instance
    confirm: >-
      This reads your whole order history from Amazon, slowly, one page at a time. It can take
      several hours and pauses whenever Amazon asks it to.
    destructive: false                  # true: the confirm dialog needs the connection label typed
    expose_to_ha: true                  # offered as an HA button (§2.12, Home Assistant)
    cooldown: 24h                       # earliest re-run after a completed run
  - id: open_orders
    label: Your orders on Amazon
    kind: link
    url: "{storefront_origin}/your-orders/orders"   # placeholders from the connection's config only
```

**Validation:**

- `link` URLs may use only placeholders the connection's config schema defines. They are filled
  server-side and checked against the network allow-list after substitution, so a config value
  can't turn into `javascript:` or an internal address.
- `input` is limited to the JSON Schema subset the web UI's `SchemaForm` already renders.
- Actions don't widen permissions. A task makes its requests through the same brokered http, on
  the same hosts, with the same token buckets as the connection's normal runs.

#### The task contract

```ts
interface ActionContext<Config, Secret> extends PluginContext<Config, Secret> {
  readonly input: unknown;                 // validated against the action's schema by the core
  readonly signal: AbortSignal;            // cancellation; checked between pages
  readonly checkpoint: CheckpointStore;    // load()/save(): resumable state, encrypted, ≤ 256 KB
  progress(update: {
    done?: number;
    total?: number | null;                 // null: unknown total
    phase?: string;                        // short, value-free text: "2023: page 4"
  }): void;
  emit(batch: ActionBatch): Promise<void>; // results are written as they come, not at the end
}

interface ActionBatch {
  readonly snapshots?: readonly ParcelSnapshot[];
  readonly orders?: readonly OrderSnapshot[];   // new: orders that have no parcel any more (§2.15)
}

type ActionResult =
  | { status: "done"; summary: string }             // "412 orders, 37 parcels, 2 skipped"
  | { status: "partial"; summary: string };         // stopped early on purpose; resume continues

// in CarrierPlugin:
runAction?(id: string, context: ActionContext<Config, Secret>): Promise<ActionResult>;
```

**Rules the host enforces:**

- **One job per connection at a time, and jobs share the connection lock** (0001: one request in flight
  per account). A scheduled run of the same connection waits for the job's current page, not the
  whole job. The job yields the lock between pages, so normal polling continues during a
  multi-hour import.
- **Heavy actions are serialised across the instance** (`weight: heavy`): one at a time, the
  rest queued.
- **Errors keep their meaning:**
  - `RateLimitedError` / `CaptchaError` pause the job with the `Retry-After` (or a captcha
    pause) and resume it on their own;
  - `SignInRejectedError` stops it as "needs sign-in". It never triggers a new sign-in;
  - `TransientError` retries with the scheduler's backoff, three times, then pauses as "waiting
    for the carrier";
  - anything unexpected fails the job and keeps the checkpoint.
- **Resumable by design.** The checkpoint is saved after every emitted batch. "Resume" or a
  server restart continues from it; "Start over" clears it.
- **Idempotent by design.** Everything goes through the reconciler, which already merges by
  (carrier, tracking number), history fingerprints and (shop, order_number). Re-importing the same
  page changes nothing.
- **Cancellation** aborts `signal`. The provider gets 30 s to save a checkpoint, then the sandbox
  call is killed. Results emitted so far stay.
- **A hard ceiling per job**, default 12 h of wall time. The job is then paused; resume
  continues.

#### Jobs, API and events

New table `jobs`: id, connection_id, provider, action, input (JSON), state
(queued/running/paused/done/partial/failed/cancelled), progress (JSON), checkpoint_blob (AES-GCM),
summary, error_type, created_at, started_at, updated_at, finished_at, resume_not_before.

| Route | Does |
|---|---|
| `GET /connections/{id}/actions` | The connection's actions that apply now (kind, state filter), with `cooldown_until` |
| `POST /connections/{id}/actions/{action}` | `{input}`; returns `202 {job}` for a task, or `200 {url}` for a link. `409 job_running`, `429 action_cooldown` with `Retry-After` |
| `GET /jobs?connection_id&state` / `GET /jobs/{id}` | State, progress and summary |
| `POST /jobs/{id}/cancel`, `/resume`, `/restart` | |

Events go through the outbox and SSE:

- `job.started`, `job.progress` (throttled to one every 5 s per job), `job.paused` (with
  `reason` and `resume_at`), `job.finished` (`status`, `summary`);
- parcels and orders created by the job fire their usual events, marked `imported: true`
  (§2.15).

Every action route needs the admin role, by the existing method rule; `GET` needs the reader.
API tokens need the `write` scope to start or cancel a job.

#### Home Assistant

The integration creates, per connection:

- **a `button` entity for each action with `expose_to_ha: true`** and no `input`, or with an
  input whose fields all have defaults. Pressing it runs the action with the defaults;
- **a `sensor` per connection with the current job** (state = job state, attributes = progress,
  phase, summary). It is updated from the `job.*` events;
- **the service `open_parcels.run_action`** (`connection` device/entity, `action`, `input`) and
  `open_parcels.cancel_job`, for automations and for actions with real inputs.

Confirmations can't be shown from HA. A `destructive: true` action is therefore never exposed as a
button, and the service requires `confirm: true` in its data. `link` actions are not exposed; HA
has no use for them.

### 2.13 Flagship example: Amazon "Import history"

**Today:** `fetchAccount` reads only the first orders page (`hasMoreOrderPages` is checked, not
followed) and loads at most `MAX_SHIPMENT_LOADS = 8` shipment pages per run. That is the right
behaviour for polling, and it stays.

**The action** walks the full history:

1. **Plan.** Read the orders page's time-filter options (the years the account has orders in).
   That gives a total of years, not of orders, so `total` is the number of years and `phase`
   reads "2021: page 3".
2. **Walk** each year, newest first, page by page (`startIndex`). For each order tile:
   - emit an `OrderSnapshot` (shop `amazon`, order number, placed date, items with title,
     quantity, price and image) **without opening anything else**;
   - if the tile links to a shipment that is **not delivered**, or was delivered within the
     polling lookback, queue it for a tracking-page read (as `fetchAccount` does), with the same
     page budget per batch;
   - for long-delivered shipments, emit a parcel snapshot only when the tile itself names the
     carrier and the tracking id. Opening years of shipment pages costs thousands of requests
     and yields little: Amazon's tracking pages for old shipments are often gone.
3. **Checkpoint** after every page: `{year, startIndex, pending_shipments[]}`.

**Pacing:** stricter than polling because the volume is larger.

- One page every 6–10 s, jittered, through the existing host token bucket.
- A 2-minute break every 25 pages.
- At most 300 pages per job leg; the job then pauses for 1 h and resumes on its own. A ten-year
  account is roughly 100–300 pages, so one to three legs.
- Polling of the same connection keeps priority between pages.
- Signs of trouble pause the job, never retry it fast:
  - a captcha (`looksLikeCaptcha`): pause 6 h, and one notice;
  - signed out (`looksSignedOut`): stop as "needs sign-in";
  - an unexpected page shape (`UnexpectedResponseError`), twice in a row: stop as failed,
    keeping the checkpoint.

**Results are idempotent:**

- Orders merge on (shop, order number); items on `external_id`; parcels on
  (carrier, tracking number).
- A second import over the same years only fills gaps.
- An import never overwrites a manual status or label.

**Not imported:**

- payment details;
- addresses beyond what `receiver` already holds;
- invoices;
- anything for which the user's storefront config doesn't apply.

Digital orders are skipped unless `include_digital` is set.

### 2.14 Email routing: inboxes dispatch to providers

**Today:** the core's email watcher runs every email through schema.org markup, then all
`open-parcels-rules` email rules, then tracking-number detection.

**Proposed:** the inbox becomes a *router*. Providers declare which emails they want. The core
matches, and hands each matching email to that provider's parser. The provider returns snapshots
through the normal reconciler.

#### Filters (manifest `mail:`)

```yaml
mail:
  - id: order_confirmation
    from_domains: [amazon.de, amazon.com, amazon.co.uk]   # required; exact or ".sub" suffix
    from_local: ["auto-confirm", "shipment-tracking"]      # optional local-part regexes
    subject: ["bestellung|order|versandt|shipped"]          # optional, any-of
    headers: { list-id: null }                              # optional: require/forbid headers
    body_contains: ["/gp/your-account/order-details"]       # optional, plain substrings
    authenticated: true                                     # default: require DMARC/DKIM pass
    parse: code                                             # or a rule-file path (declarative)
    priority: 50                                            # 0–100, see "multiple matches"
```

**Rules for filters**, enforced at install:

- **`from_domains` is required and may not be a public suffix or a webmail domain**
  (`gmail.com`, `outlook.com`, `gmx.de`, … from a list in `open-parcels-rules`). That forces a
  provider to name the shop or carrier it parses. A filter on subject alone would turn into
  "read my email".
- **Domains must relate to the provider.** For verified providers the reviewer checks them. For
  custom/community ones the consent screen lists them prominently ("will receive email from:
  amazon.de, amazon.com, …"). A filter domain overlapping a domain another installed provider
  declares shows "Amazon (verified) also reads these emails".
- **Sender spoofing is checked.** With `authenticated: true` (the default), an email only matches
  if the receiving server's `Authentication-Results` says DKIM or DMARC passed for the `From`
  domain. A email claiming to come from `amazon.de` without that never reaches the Amazon parser.
  Users whose server adds no such header can turn the check off per inbox; the UI then says
  so.

#### What a provider receives

```ts
interface MailMessage {
  readonly id: string;                   // stable hash of Message-ID (or of headers when none)
  readonly messageId: string | null;
  readonly date: string | null;
  readonly from: { address: string; name: string | null };
  readonly to: readonly string[];        // only the inbox's own addresses; no Cc/Bcc lists
  readonly subject: string;
  readonly headers: Readonly<Record<string, string>>;  // allow-listed headers only
  readonly text: string | null;
  readonly html: string | null;          // ≤ 2 MB, as received; the provider parses it
  readonly attachments: readonly {
    filename: string; contentType: string; size: number;
    content?: Uint8Array;                // only with permissions.mail.attachments: content
  }[];
  readonly schemaOrg: readonly unknown[];// ParcelDelivery/Order JSON-LD the core already found
  readonly matchedFilter: string;
}

// in CarrierPlugin:
parseMail?(context: MailContext, mail: MailMessage): Promise<MailParseResult>;
// MailParseResult = { snapshots, orders, ignored?: reason }
```

- `MailContext` is a `PluginContext` **without** `secret`, `session` and `http`. Parsing an email
  needs no network and no credentials. Removing them is what lets the core hand email to
  less-trusted code: there is no channel to send it anywhere. The sandbox has no network of its
  own (§2.7), so an email parser is a pure function.
- A provider that wants to *act* on an email (a "sign-in link" email completing an interactive
  sign-in, or a tracking code worth looking up) returns that in its result. The core then
  starts the provider's normal tracking for the code, or passes the link to the waiting sign-in
  attempt. That second case replaces today's paste-the-email-link step when the user opts in.
- **Declarative rules (`parse: <rule file>`) keep running in the core** with the existing rules
  engine. Most shops never need code.

#### Matching and multiple providers

1. **Filter.** Every filter of every enabled provider is evaluated on the headers first (cheap),
   then `body_contains`.
2. **All matching providers receive the email**, ordered by `priority`, then tier (bundled/verified
   before custom/community). Their results all go to the reconciler, which already merges
   several connections' views of one parcel. Usually this is the shop and the carrier both reading
   a shipping notice.
3. **Order claims.** A result's order is attributed by the reconciler's existing plausibility
   check (`isPlausibleOrder`). A community provider can't attach orders to a shop whose number
   format it doesn't match.
4. **Generic fallback, last.** If no provider matched, the core still runs schema.org markup and
   tracking-number detection constrained by sender and text (today's steps 1 and 3), so nothing
   is lost for unknown senders. These run in the core and pass nothing to a provider.
5. **Result attribution.** Each snapshot is filed under a per-provider email connection role, as
   today's `parcel_connections.role = mail`, plus the provider id. The UI can then show "found in
   email by Amazon".

#### Privacy

- A provider only ever sees emails its filters matched. Nothing else leaves the core.
- Emails are never stored. The core keeps Message-ID hashes for dedup, as today, and a
  per-provider count ("Amazon parsed 214 emails").
- Logs show the filter id and result counts, never the subject or the sender's local part.
- The inbox's connection card lists which providers receive which senders ("Routes: Amazon ← 3
  domains, DHL ← 2 domains, …") and can switch a route off per provider.

#### Backfill

- **An inbox action** (§2.12) re-reads old email: "Event old email" with `since` (date) and
  optionally `providers` (only route to these).
- **Installing or updating a provider with new email filters offers the same backfill for that
  provider only.** "Hermes can read email you already have. Event the last 180 days?"
- It is a job: resumable by IMAP UID per folder (the checkpoint is the existing
  `mailProgressSchema` shape), paced at a configurable messages/second, using IMAP `SEARCH FROM`
  for the filter domains so the server does the filtering and unrelated email is never
  downloaded.
- Idempotent: Message-ID dedup is per (email, provider), so a backfill for a new provider doesn't
  skip emails other providers already saw.

### 2.15 REST API impact

`/api/v1/parcels` and `/api/v1/orders` stay the integration surface. Providers and actions need a
few additions:

- **Orders without parcels.** Today orders are created from a parcel snapshot's `order`. History
  import and email parsing need `OrderSnapshot` (order + items, no parcel), so the reconciler
  gains an order-only path. `GET /orders` already lists orders whose parcels are gone, so no
  route changes.
- **Imported, historical data is not news.**
  - Parcels and orders a job creates carry `imported_at`, and their events carry
    `imported: true`. The HA integration and other clients use that to skip notifications.
  - Long-delivered parcels from an import are written **directly archived**, and
    `parcel.registered`/`parcel.delivered` are not fired for parcels delivered more than 30 days
    ago.
  - `parcel.imported` (one per batch, with counts) replaces them, so HA doesn't fire hundreds
    of "delivered" automations after an import.
- **Retention vs. history.** The 365-day delete for delivered parcels would erase an import of
  older years. Proposed: retention deletes the *parcel tracking detail* (history, raw) but keeps
  the order, its items and a stub parcel row (carrier, tracking number, delivered_at). Open question 11.
- **Filters:**
  - `GET /orders?shop=&placed_from=&placed_to=&q=` (shop and date range, for a decade of
    orders);
  - `GET /parcels?provider=` and `?connection_id=`.
- **Provenance in responses.**
  - `connections[]` entries in a parcel gain `provider` and `tier`.
  - Orders gain `connections[]`: which connection or email provider reported them.
- **Unchanged:** auth, scopes, SSE, ICS. Actions and jobs are new routes (§2.12), not changes
  to these.

## 3. Migration

### 3.1 The in-repo carriers

1. **Manifests in place.** Each `server/src/carriers/<id>/` gains `open-parcels-provider.yaml`
   (generated from the provider's metadata and `http.limits`, then reviewed). `permissions.network`
   is derived from the hosts each carrier calls. A test asserts the manifest and the code agree:
   a request to a host not in the manifest fails in the fixture suite. **This is the most
   valuable step on its own:** it documents every carrier's reach.
2. **`builtin-carriers.ts` becomes a generated list** of bundled providers with tier `bundled`.
   They are still in-process at this step.
3. **The provider host is built** (§2.7), and bundled providers move into the verified pool
   behind `OPENPARCELS_PROVIDER_ISOLATION=pool`. The recorded-fixture suites run against both
   modes until the pool is the default.
4. **Extraction** to `open-parcels/open-parcels-providers`: one repository, one folder per
   provider (`providers/<name>/`), each with its own manifest, listed by the repo manifest. The
   registry points at `repository + path + commit`. The image keeps a pinned release of it, so
   the HA Pi and air-gapped users get every official carrier without installing anything.
   **Owner decisions (2026-11-26):** the name is `open-parcels-providers` in the GitHub
   organisation `open-parcels`; the repository starts fresh, without history (the history stays
   in the server repository); every change is tagged as a release, with one version `vX.Y.Z`
   for the whole repository (no per-provider versions or tags such as `hermes_de@1.4.2`). Done
   on 2026-11-26 with release `1.0.0`, vendored and pinned by digest
   ([`official-providers-repo.md`](../official-providers-repo.md)).

### 3.2 `open-parcels-rules`: shrink it to a shared library

**The owner's requirement:** everything specific to one provider (its regexes, status tables,
email rules and keys) moves into that provider's package. This record agrees, with one exception
(the vendored upstream tracking-number dataset), and recommends **keeping the repo as a small
shared library rather than deleting it.**

#### Inventory (main, `2.0.0-dev.8`, read on 2026-11-23)

| Part | Size | Specific to one provider? | Goes to |
|---|---|---|---|
| `data/status/*.yaml` | 86 files, 6,349 lines; one table per carrier | **Yes** | Each provider's `data/status/` |
| `data/keys.yaml` | 74 keys for 32 carriers, 453 lines | **Yes** (one carrier's app/web keys each) | Each provider's `data/keys.yaml` |
| `data/mail/*.yaml` (shop/carrier rules) | 31 files, ~1,250 lines | **Yes** | The shop's or carrier's provider, as `mail:` routes (§2.14). Shops without code (Otto, Zalando, Berrybase, JLCPCB, eBay, Shopify, PayPal returns, …) become declarative providers |
| `data/mail/ignore-*.yaml` | 2 files, 42 lines | No: generic noise suppression | Core (email router fallback) |
| `data/carriers.yaml` | 95 carriers, 811 lines: names, aliases, domains, tracking URLs, UPU countries, cross-references | **Yes**, per entry | `provides.carriers` data in each provider. The core builds the union from installed providers. The 7 carriers without a provider get declarative providers |
| `data/tracking-numbers/*.json` (our EU overlay) | 6 files, 229 lines | **Yes** | Each provider's `data/tracking-numbers/` |
| `vendor/tracking_number_data/couriers/*.json` | 18 courier files, ~3,200 lines; a pinned **upstream** dataset | Per courier, but upstream's, not ours | **Stays shared** (see below). `s10.json` (UPU S10, every postal operator) is cross-carrier anyway |
| `data/locales/{de,en}.yaml` | 593 lines: months, weekdays, relative days, window phrases | No: used by Amazon, email rules and several carriers | Shared library |
| `src/arrival/` | Delivery-date grammar and zoned parsing | No | Shared library |
| `src/tracking/` | Detection, compile, check-digit algorithms (mod 7/10/11, S10, Luhn…), validation | No | Shared library |
| `src/mail/` | Declarative email-rule engine, extractors, HTML-to-text, schema.org reader | No: runs every provider's declarative rules | Shared library |
| `src/status.ts`, canonical `PARCEL_STATUSES` | Status vocabulary and the mapping engine | No | Shared library |
| `schema/*.json` + `src/schema/` | 7 JSON Schemas, ~3,300 lines, zod mirrors | No | Shared library, plus the new `provider.schema.json` |
| `src/portability.ts`, `scripts/` | Portable-regex lint, bundle build | No | Shared library (the SDK's `validate` uses them) |
| `python/` | Stdlib-only loader + vector runner, 560 lines | No | Shared library |
| `test/` | 73 files; `.eml` fixtures for email rules, vectors | Mostly per rule | Fixtures move with their rules; engine tests stay |

#### What remains shared

- **Data:** about 700 lines (two locale files, two ignore rules, the canonical status list),
  plus the vendored upstream dataset (~3,200 lines, maintained by syncing, not by hand).
- **Code, schemas and tooling:** about 7,000 lines (engine ~3,100, schemas ~3,300, Python ~560,
  scripts ~240).
- **Moving out:** roughly 9,000 of about 9,700 hand-maintained data lines, **over 90 %**.

The repo therefore stops being "the knowledge" and becomes "the engine and the formats".

#### Recommendation: keep it as a shared library, don't fold it into the core

Folding the remainder into the core looks simpler, but it breaks the provider model:

- **Providers outside this repo need the engine at build and test time.** Declarative email
  rules, status mapping, arrival parsing, check digits and schema validation are what the SDK's
  `validate` and test harness run. If those live in the server, every provider would depend on
  the whole server package, or the SDK would copy them.
- **The sandbox runtime needs them too.** Code providers call `mapStatus`, `parseArrival` and
  `carrierPattern` through the provider API. The child process must load the engine without
  loading the server.
- **Non-JS consumers.** The Python loader and the portable-regex rule only make sense in a
  package that isn't the TypeScript server.
- **The upstream dataset needs one home.** Splitting the vendored files across 18 providers
  would turn every upstream sync into 18 changes. Providers name the upstream couriers they
  use (`tracking_numbers: { upstream: [dhl] }`) and add their own overlay.

So: **keep the repo, narrow its purpose, and give the provider SDK the same home.**

- Rename it to `open-parcels-sdk` (with a redirect from the old name), or keep the name. This is
  open question 12; the rename is cosmetic.
- Two packages in one npm workspace:
  - **`open-parcels-rules` (engine):** schemas, canonical statuses, engine, locales, upstream
    dataset, Python loader. **No carrier-specific data.**
  - **`@open-parcels/provider-sdk`:** types, kit, test harness, esbuild preset, `validate`. It
    depends on the engine.
- **The aggregated bundle moves to the server.** `GET /api/v1/rules/bundle` returns the merged
  data of the installed providers in today's `bundle.json` format. That is how Python and HA
  consumers get the full knowledge after the split, matching what that instance actually uses.

#### Migration steps (recommended path)

1. **Provider schema first.** Add `provider.schema.json` and a `providers/` loader to the engine
   that merges carrier, status, key, tracking and email files from several roots, with provider
   namespacing and the override rules of §2.7. Tests: loading today's monolithic data through the
   new loader gives a bit-identical `bundle.json`.
2. **Split mechanically, by script.** For each carrier id, move its status file, keys, carrier
   entry, overlay patterns, email rules and their `.eml` fixtures into
   `open-parcels-providers/providers/<id>/data/`, and generate its manifest. Shops with only
   email rules become declarative providers. Check: the merged bundle from all providers equals
   the old bundle (same test as step 1).
3. **Server consumes providers.** The bundled-provider snapshot (P1/P5) feeds the loader. The
   server stops reading the engine package's data directory. `provider/rules.ts` keeps its
   functions, now backed by the merged registry.
4. **Strip the data from the engine.** Delete the moved files, keep the engine, locales,
   schemas, ignore rules (or move those two to the core), the upstream dataset and the tooling.
   Release the engine as `3.0.0`: a major, because the data is gone.
5. **Add `GET /api/v1/rules/bundle`** to the server, and point the Python loader's docs at it.
6. **Update the AGENT.md rule.** "Carrier knowledge goes to `open-parcels-rules`" becomes
   "carrier knowledge goes to the carrier's provider; formats, engines and cross-carrier data go
   to the engine".

#### If the owner prefers deleting the repo

1. Same steps 1–3 as above.
2. Move `src/`, `schema/`, `locales`, `python/` and the upstream dataset into the open-parcels
   repo as workspace packages (`packages/engine`, `packages/provider-sdk`), keeping history with
   `git subtree add`/`git filter-repo --to-subdirectory-filter`.
3. Publish the two packages from the open-parcels repo, so providers still depend on packages,
   not on the server.
4. Archive `open-parcels-rules` with a README pointing at the new locations; don't delete it,
   so old links and the tarball the server vendors today stay resolvable.

This works too. It trades one repo less for coupling the engine's release cadence to the
server's, and it puts a Python package in a TypeScript server repo. The recommendation stays
"keep it small and separate", but the difference is modest.

### 3.3 Other repos

- **`open-parcels-extension`:** no change. It captures the final sign-in address for whatever
  flow asks. If a later version needs host permissions per carrier, they come from the
  provider's `permissions.network`.
- **`.github`:** add a `PROVIDER_TEMPLATE` repo (or template directory) with the manifest, SDK
  setup, a fixture test, `CONTRIBUTING` on the review checklist, and the `open-parcels-provider`
  topic preset. Its workflow, if any, keeps only `workflow_dispatch` with the reason above the
  commented-out triggers.
- **`open-parcels.github.io`:** a "Providers" page generated from the signed index (built
  locally), the manifest JSON Schema at a stable URL, and the review policy.

## 4. UI

The page is named **Providers**, alongside Connections in the navigation. The Connections page's
"Add a connection" becomes the HA-style picker (B).

### A. Providers page

```
┌ Providers ──────────────────────────────────────────────────────────────────────┐
│ [ Installed (91) ]  [ Available ]                [ + Install from URL ]  [⟳]    │
│ Search providers…  ________________   Type: (All ▾)  Tier: (All ▾)  Country: (▾)│
│─────────────────────────────────────────────────────────────────────────────────│
│ ⚠ 1 update needs your approval: Hermes Germany 1.5.0 asks for a new host.  [Review]│
│─────────────────────────────────────────────────────────────────────────────────│
│ [icon] DHL                      [Built in]        v2.6.3    3 connections ● [⋯] │
│        tracking · account · live · mail rules     DE NL PL SE …                 │
│ [icon] Hermes Germany           [✔ Verified]      v1.4.2 → 1.5.0  2 connections [Update]│
│        tracking · account · mail rules            DE                            │
│ [icon] Paket-Shop Rules DE      [Custom]          v0.3.0    —   data only  [⋯]  │
│        mail rules · status table                  DE  git.example.org/me/pkt     │
│ [icon] Gofo Unofficial          [⚠ Community]     v0.9.1    1 connection ● [⋯]  │
│        tracking                                   US  github.com/x/op-gofo      │
│ [icon] Shady Carrier            [⛔ Blocked]       v1.0.0    1 connection paused │
│        Disabled by the registry: sends credentials to a third-party host. [Details]│
└─────────────────────────────────────────────────────────────────────────────────┘

  Available tab:
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Show: (●) Verified   ( ) Community — unreviewed code from GitHub        [?]     │
│ Search…  ______________                                                         │
│ [icon] InPost Paczkomaty        [✔ Verified]  tracking · account   PL  [Install]│
│ [icon] Correos Express          [✔ Verified]  tracking             ES  [Install]│
│  … community view:                                                              │
│ [icon] op-ems-tracker  ★12      [⚠ Community] manifest not checked   [Details]  │
│        github.com/foo/op-ems-tracker · updated 3 days ago                       │
│ [icon] dhl-plus ★2              [⚠ Community] looks similar to verified "DHL"   │
│ Results from GitHub, cached 2 h ago · 7/10 searches left this minute            │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### B. Add-connection dialog (HA "Add integration" style)

```
┌ Add a connection ───────────────────────────────────────── [×] ┐
│ Search: [ her_______________ ]                                 │
│                                                                │
│  Installed providers                                           │
│   [icon] Hermes Germany   [✔ Verified]   tracking · account    │
│   [icon] Hermes UK (Evri) [Built in]     tracking              │
│   [icon] Mailbox (IMAP)   [Built in]     mail                  │
│                                                                │
│  Not installed                                                 │
│   [icon] Hermes Einrichtungs Service [✔ Verified]   [Install…] │
│                                                                │
│ ───────────────────────────────────────────────────────────── │
│ Can't find it?  [ Browse providers → ]   [ Install from URL ]  │
└────────────────────────────────────────────────────────────────┘
   → choosing an installed provider continues as today: kind → form → sign-in
   → "Install…" opens D, then returns here with the provider selected
```

### C. Install from URL

```
┌ Install a provider from a git repository ───────────────── [×] ┐
│ Repository URL                                                 │
│ [ https://git.example.org/me/op-paket-rules________________ ]  │
│ Version  ( ● newest tag  v0.3.0 ▾ )  ( ○ branch/commit: ____ ) │
│ Subdirectory (optional) [ ________ ]                           │
│                                                                │
│ Or upload a provider archive (.opp)  [ Choose file ]           │
│                                                                │
│ ℹ Custom providers are not reviewed by open-parcels. Install   │
│   only from people you trust. Code runs in an isolated process │
│   and can only reach the hosts it lists.                       │
│                                       [Cancel]  [Check repo →] │
└────────────────────────────────────────────────────────────────┘
   "Check repo" fetches, validates and computes the digest, then shows D.
   Errors are specific: "no open-parcels-provider.yaml at v0.3.0",
   "needs provider API ^2.0, this server has 1.4", "id 'dhl' is reserved".
```

### D. Provider detail / consent

```
┌ Gofo Unofficial  v0.9.1                        [⚠ Community · unreviewed] ┐
│ by foo · github.com/foo/op-gofo @ 9c1e5d2 · MIT · updated 2026-11-19       │
│ digest sha256:7d1e…a04c   signed: no                                        │
│─────────────────────────────────────────────────────────────────────────────│
│ ┌──────────────────────────────────────────────────────────────────────┐   │
│ │ ⚠ This provider runs code that nobody at open-parcels has reviewed.  │   │
│ │   It will receive the sign-in details you enter for its sources and  │   │
│ │   can send them to the hosts below. It cannot read your other        │   │
│ │   sources, your mail or this server's files.                         │   │
│ └──────────────────────────────────────────────────────────────────────┘   │
│ Provides       tracking (US)                                                │
│ Network        api.gofo.example      "tracking API"                         │
│                .gofo-cdn.example     "item images"                          │
│ Stores         a session (cookies) per source                               │
│ Asks for       nothing (public tracking)                                    │
│ API            ^1.2.0  ✔ compatible                                         │
│                                                                             │
│ [ README ▾ ]  [ Versions ▾ ]  [ View source ↗ ]                             │
│                                                                             │
│ ☐ I understand this code is unreviewed.            [Cancel]  [Install]      │
└─────────────────────────────────────────────────────────────────────────────┘
   Verified: green box "Reviewed by the open-parcels maintainers on 2026-11-23
   (this exact version). Review covers network use and credential handling; it
   is not a guarantee." No checkbox.
   Update with wider permissions: the Network/Asks-for rows show + / − diffs.
```

### E. Connection card with actions and a running job; inbox routes

```
┌ Amazon.de · Jane ──────────────────────── [✔ Verified] shop · ● ok ─┐
│ 23 parcels on the way · last run 4 min ago                          │
│ [⟳ Sync] [✎] [⏻] [🗑]     Actions: [Import order history] [Your orders ↗]│
│ ┌ Import order history ─────────────────────────────── running ──┐  │
│ │ 2021: page 3       ███████████░░░░░░░░  6 of 11 years           │  │
│ │ 1,204 orders · 61 parcels imported · paced, ~1 page / 8 s       │  │
│ │                                         [Pause] [Cancel]        │  │
│ └─────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
   paused state:  "Paused: Amazon showed a captcha. Resumes 21:40. [Resume now]"

┌ Mailbox jane@example.invalid (imap.example.invalid) ─── mail · ● ok ┐
│ Routes                                         mails (30 d)  on     │
│   Amazon          [✔] amazon.de, amazon.com +4      214      [■]    │
│   DHL             [Built in] dhl.de, dhl.com          38      [■]    │
│   Otto            [✔] otto.de                          6      [■]    │
│   Paket Rules DE  [Custom] versandpartner.example      2      [■]    │
│   Generic fallback (schema.org, tracking numbers)     11      [■]    │
│ Actions: [Scan old mail…]                                           │
└──────────────────────────────────────────────────────────────────────┘
```

## 5. Roadmap

Every phase is shippable and keeps the gate green.

| Phase | Delivers | Why this order |
|---|---|---|
| **P1. Manifests in-tree** | Manifest schema in the engine package; a manifest per carrier; the host allow-list **enforced** in `PluginHttp`; `providers` table with `bundled` rows; read-only Providers page (Installed tab) | Value without any remote code: it documents and enforces every carrier's network reach, and fixes the model before anything is downloaded |
| **P2. Provider host** | IPC protocol, child process with the permission model + SES, brokered http/session/logger, result validation, timeouts and crash policy; bundled providers in the verified pool behind a flag, then by default | The sandbox has to exist before any foreign code. Running our own 88 carriers through it is the best test it can get |
| **P2b. Actions + jobs** | `jobs` table, action routes and SSE events, connection-card UI; Amazon "Import history" as the first task action; order-only reconciler path, `imported` flag, archived-on-import; HA buttons and job sensor | Usable on bundled providers right after P2, and independent of remote installs. It is also the owner's most visible feature |
| **P2c. Email routing** | `mail:` filters, DKIM/DMARC gate, router with fallback, `parseMail` in the sandbox, per-provider dedup, route list on inbox cards, "Event old email" backfill job | Needs the sandbox (P2) and jobs (P2b). Bundled email rules are converted to routes in place, before any split |
| **P3. SDK + custom installs** | `@open-parcels/provider-sdk`; `.opp` upload and git-URL install with isomorphic-git, digest, consent screen, update/rollback/uninstall; `PROVIDERS_CUSTOM`, `PROVIDERS_LOCKED` | The owner can install their own providers from Gitea, which proves the flow end to end |
| **P4. Registry + verified tier** | `open-parcels-registry` repo with signed index, blocklist and review checklist; verified install and auto-update; `provider.blocked` → HA repair issue | Needs P3's install path; adds trust on top |
| **P5. Extraction** | `open-parcels-providers` monorepo; per-provider data split out of `open-parcels-rules` by script (§3.2), the engine released as 3.0 without carrier data; `GET /rules/bundle`; the image bundles a pinned snapshot; the carriers leave `server/src/carriers/` | Only after the API has been stable through P2–P4 |
| **P6. Community tier** | GitHub topic search, caching, lazy manifest check, typosquat hints, blocklist filtering; off by default | Last, because it is the riskiest and the least needed |
| *Later* | QuickJS/WASM runtime for community code if needed; Sigstore provenance badges; a curated non-GitHub list; declarative HTTP-tracking providers (request template + JSONPath mapping, no code) | |

## 6. Open questions for the owner

1. **One repo per provider, or an official monorepo with per-provider tags?** This record
   recommends the monorepo for the org's own providers (§3.1); third parties use one repo each.
2. **Name and home of the registry:** `open-parcels-registry` as a new repo, or a directory in
   `.github`?
3. **Who reviews?** Only the owner, or a set of reviewers from the start? This decides how many
   keys are in `allowed_signers`.
4. **Auto-update for verified providers:** default on (recommended) or notify only?
5. **Community tier default:** off with an opt-in toggle (recommended), or on with the warning?
6. **Isolation default for bundled/verified:** the shared pool (recommended, ~40 MB) or strict
   per-provider (≈ 90 processes worst case, too heavy on a Pi)?
7. **Should custom installs allow a `*` network host** with a red warning, or refuse it outright?
8. **Wording of the verified badge:** "Verified" vs "Reviewed" (this record prefers "Reviewed" in
   the detail text either way).
9. **Licence requirement for verified providers** (any OSI licence? matching the core's, which is
   still undecided per 0001 §5)?
10. **Email sender authentication:** require DKIM/DMARC pass by default (recommended; some
    self-hosted email servers add no `Authentication-Results`, and those users must switch it off
    per inbox)?
11. **Retention vs. imported history:** keep orders and stub parcels indefinitely and drop only
    tracking detail after 365 days (recommended), or let retention delete imported years too?
12. **`open-parcels-rules`:** keep it as a slim engine + SDK repo (recommended), and if so,
    rename it to `open-parcels-sdk` or keep the name? Or fold it into the core and archive it?
13. **Connection actions in HA:** expose every action without required input as a button by
    default, or only those the provider marks `expose_to_ha`?

## Owner decisions (2026-11-23)

1. **Repos and providers:** a repository may hold several providers, one folder each. The repo-level manifest lists every provider (id, kind, folder). The official providers live in one org repo this way; third parties may ship one or many per repo. No per-provider tags: a repo release versions all providers in it.
2. **Auto-update:** available for every tier. On by default for built-in and verified providers; custom and community providers must have it enabled per provider in its settings. A new permission still needs a click.
3. **Community discovery:** on by default. Community providers are shown with a yellow background and a warning sign; installing one opens a dialog saying it is an unreviewed community add-on, linking to its source code (to check, or hand to an agent) before confirming.
4. **DKIM/DMARC:** on by default, as one global setting (not per provider) the user can turn off. Measured on the owner's local Betterbird cache: 81 of 81 order/shipping emails from shops (AliExpress, Amazon, Hermes, PayPal, DHL, eBay, two small shops) passed both. Re-check on the full IMAP inboxes when email routing is built.
5. **Clearing data:** every connection gets a "Clear data" action that removes everything it imported (parcels, orders, links, raw payloads) so it can re-sync or re-import from scratch. Retention of imported history (the 365-day cleanup) still needs designing: history imports must not be deleted again right after.
6. **Community install dialog:** besides "View source", a "Copy review prompt" button copies a ready-made prompt for any AI agent: repo URL plus the exact commit/digest that would be installed, the declared permissions (network hosts, email filters, secrets/session use), what to check (exfiltration to undeclared places, credential misuse, obfuscated or dynamic code, behaviour beyond the stated purpose), and a request for a clear verdict (safe / suspicious / do not install) with reasons.
   - UI detail: the button is a small copy icon (two overlapping documents) right next to the "give it to your agent" text in the warning; clicking it copies the templated audit prompt to the clipboard and shows a short "Copied" confirmation. Template draft:

     ```
     This is a community provider (integration) for open-parcels, a self-hosted parcel tracking
     server: {repo_url} at commit {commit} (bundle digest {digest}).
     It asks for: network access to {hosts}; mail matching {mail_filters}; secrets: {secrets};
     session storage: {session}.
     Please audit its code for security before I install it:
     1. Does it send data anywhere other than the declared hosts, or more data than it needs?
     2. Could it misuse or leak my login, session or mail contents?
     3. Is any code obfuscated, minified without source, dynamically loaded or evaluated?
     4. Does it do anything beyond tracking parcels/orders for {provider_name}?
     Answer with a verdict (looks safe / suspicious / do not install) and the reasons, citing files
     and lines.
     ```
7. **DKIM/DMARC measured on the full backup** (`backups/Timo/mails`, 48,248 mails 2008–2026, 4,461 shop/carrier mails, all with Authentication-Results): dkim=pass 98.6 %, dmarc=pass 94.9 %. Both above the owner's 90 % bar, so the global check is on by default. Recommendation: require **DKIM aligned with the provider's declared sender domain** by default (98.6 %), not DMARC (several real shops publish weak DMARC: Steam 68 %, Humble 82 %, myhermes 63 %, MediaMarkt 60 %, gamivo 16 %, mmoga 0 %). Providers may declare their sender's known quirks; the global switch turns the check off entirely. Test corpus for filters: that folder plus its `mails.csv` index.
10. **Themes (2026-11-24):** installable themes replace the light/dark-only setting. Two settings: Theme (default or an installed one) and Mode (Automatic from the device, Light, Dark); a theme ships a light and a dark variant, or one variant that fixes the mode. Themes are declarative only (design tokens, fonts, radius, spacing, map style, bundled logo/icons; no JS, no external URLs, the CSP stays strict). They come standalone or inside a provider repo (listed in its repo manifest) and install from the providers page with the same tiers and trust warnings. Precondition: the web UI uses design tokens (CSS custom properties) everywhere.
