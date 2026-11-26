# To do

Everything that still has to happen before open-parcels is production-ready for thousands of
users. Work top to bottom; move an item to `WIP.md` when starting it and to `DONE.md` (with the
commit) when it is shipped. Ids refer to the audits (`OP-` server, `RU-` rules, `HA-` Home
Assistant integration, `AP-` Home Assistant app, `EX-` extension, `WS-` website, `GH-` org profile).

## 1. Core hardening (server + web, audit "Now" items not yet shipped)

Groups 1–24 are shipped (see `DONE.md`). Left, optional:

- [ ] `styles.css` per feature (2,343 lines; CSS is outside the line limits)

## 2. Production readiness

- [ ] Internationalisation leftovers (web UI EN/DE, error codes, settings, provider texts, map
      layers, connection state reasons, scheduler, backup and database error codes, calendar and
      ICS texts, the HA integration's return sensor attributes done, see `DONE.md`). Still
      English: texts written by providers or carriers (`carrier_message`), part of the provider
      rewrite (§3)
- [ ] Accessibility pass: axe on every page and in every add dialog, token contrast, and the
      dialogs from the keyboard (opened with Enter, modal, named, Escape closes, focus returns to
      the opener) are tested (see `DONE.md`). Still to do by hand, in a real browser: Tab order
      through the top bar, each page and each dialog (initial focus, focus kept inside the modal
      dialog), the edit dialogs and the job input dialog, the map (Leaflet's controls and
      markers) and the calendar (FullCalendar's toolbar and events) by keyboard, the connection
      picker's search and the sign-in steps; a screen-reader pass (NVDA/Orca) of live updates
      (the live badge, toasts, "Show more") and the sign-in steps
- [ ] Mobile layout pass: phone CSS at 360–480 px done (nav on its own row, icons only; tables
      scroll inside their card; smaller paddings; dialogs nearly full width; calendar toolbar
      wraps and opens the list view on phones; map menu kept clear). Still to look at on a real
      phone: the parcels table (scrolls, maybe cards), the split map/list pages and Leaflet's
      controls, FullCalendar's week/day views, the sign-in dialog's steps, the Settings place
      picker map, and Safari's dialog height (`100dvh`)
- [ ] Performance follow-ups (`docs/performance.md`, "Left as it is"): the parcel list is
      searched, sorted, counted and paged in SQL, the map and the Connections page read only what
      they show (NAS, 2026-11-26). Left: measure on the Pi
- [ ] Release 2.0.0: changelog, tags `2.0.0`, `2.0`, `latest` on Docker Hub and GHCR, website and
      Unraid template switched from `:dev` to `:latest`, HA app on the release
- [x] GHCR: `ghcr.io/open-parcels/open-parcels` is public; owner decision 2026-11-26: Docker Hub
      stays the main registry everywhere, GHCR is named only as the mirror (server README and
      Compose file, HA app README/DOCS, website)
- [ ] Backups: the Status page was looked at in the NAS browser (2026-11-26, read-only view: all
      parts, backups "next in 18 hours, last 6 hours ago (succeeded)"); the Backups card on
      Settings is for the admin only and still needs a look while signed in. The HA app's
      `backup_exclude` may want `backups/` once backups are on by default

- [ ] Provider logos beyond the eight from simple-icons (`server/logos/manifest.json`): add
      carriers' official logos from their press/brand pages where the terms allow, recording the
      source per file; until then the picker shows monograms. Checked 2026-11-26: simple-icons
      16.38.1 has no further mark of our providers (only Deutsche Post, covered by DHL). Left:
      each carrier's brand page, one by one; where the terms only allow use with permission, the
      carrier's written permission (owner)
- [ ] Connection picker: look at it on a real phone (full-height dialog via `:has(.picker)`)

## 2b. Early groundwork for decision record 0004 (do soon: shapes the API and data model)

Token login, CORS, token on the live event stream, delta sync, API versioning and the slimmer
image are shipped (see `DONE.md`). Left:

- [x] Measure the arm64 image on the Pi: `sha-34a60c0`, 324 MB unpacked, 99 MB to download
      (decision record 0004 §2)

## 3. Provider rewrite (decision record draft 0002, provider ecosystem)

- [ ] Themes: replace the light/dark-only setting with installable themes. Two separate settings:
      Theme (default, installed themes) and Mode (Automatic from device / Light / Dark); a theme
      may ship a light and a dark variant (Automatic follows the device), or one variant that
      fixes the mode. A theme is declarative only (design tokens: colours, fonts, radius, spacing,
      map style, logo/icons; no JS, no external URLs — bundled assets only, CSP stays strict), so
      community themes can't run code or leak data. Distributed standalone or inside a provider
      repo (the repo manifest lists themes), installed from the providers page with the same tiers
      and trust warnings. Precondition: the web UI must use design tokens (CSS custom properties)
      everywhere, no hard-coded colours. Built (`docs/themes.md`): tokens everywhere, the two
      settings with migration, manifest format 1 with contrast and file checks, the repo
      manifest's `themes:` list, the default and the example theme. Left: installing from repos
      on the providers page (waits for the registry).
- [x] Email routing: inboxes dispatch matching emails to providers' `parseEmail` (sender domain +
      DKIM/DMARC check, `OPENPARCELS_EMAIL_ROUTING` on by default); design note §3
- [ ] Email routing follow-ups (0002 §2.14): subject/body filters and priority, per-route switches
      on the inbox card, "found in email by" attribution, backfill job, consent screen's sender
      domains (per-inbox sender check switch shipped)
- [ ] Split `open-parcels-rules`: provider data into providers, slim shared core stays
      (`docs/rules-split.md`). Email rules of Amazon, DHL and Hermes (rules
      2.0.0-dev.15) and DPD Germany, UPS, FedEx, USPS, Evri, Canada Post (2.0.0-dev.16) moved;
      next: shops as declarative providers; status tables, keys and carrier entries later (P5)
- [x] One repo with a folder per provider for the official providers; repo manifest lists them
      (`open-parcels/open-parcels-providers`, release 1.0.0 vendored and pinned;
      `docs/official-providers-repo.md`)
- [ ] Providers repo, rest: the provider SDK package, the repo's own gate, bundles instead of
      sources (`docs/official-providers-repo.md` steps 2–3)
- [ ] Registry repo (verified tier, signed index, blocklist), custom git URLs, community discovery
      via the `open-parcels-provider` topic (on by default, yellow warning, review-prompt copy button)
- [ ] Providers page: installed / available tabs, tier badges, install from URL, auto-update
      (on for built-in and verified, opt-in for custom and community)
- [ ] Audit rewrite items, rest (item → test → status in `docs/audit-rewrite-items.md`):
  - OP-088: replace "401/403/400/422/409/redirect/missing list = not found" in Trunkrs, Paack,
    Colisweb, Hermes, DHL Iberia, GLS NA and BOX NOW by each carrier's own not-found marker from a
    recorded answer; one 403-page test per provider
  - OP-093: record one real answer per carrier (BRT history with `eventDateAndTimeZoneId`, GOFO's
    European routes, CTT, CTT Express, GLS DE/NA, Better Trucks, Poste Italiane, Pošta Slovenije,
    Posten Bring, Nova Post), decide the zone and write the evidence into the comment
  - OP-098: tests for the myDPD session ending mid-run and Mój DHL's missing observed list; DPD's
    reset-connection check by a code on `TransientError` that crosses the sandbox, not the message
  - OP-099, OP-116: status literals and tracking-link templates into `open-parcels-rules`
  - OP-101: `DETAIL_LIMIT` per account (active parcels first) for Canada Post, Cargus, PPL CZ,
    Vinted Go; `MAX_PAGES` for Posti; save sessions only on change (ACS, An Post); USPS reads its
    session once per run
  - OP-102: drop CTT's screen script after reading the versions; bound or move the Budbee, Swiss
    Post and Posti caches into the session store
  - OP-106: kit `reportKey(text)` (digits and text after a preposition or colon stripped, capped)
    in the 16 providers the audit lists
  - OP-107: README privacy note that tracking links of bpost, Colis Privé, DHL NL, GLS NL/ES, Paack
    and Trunkrs carry the recipient's postcode
  - OP-109: one contract test over every built-in provider: history newest first, `pickupPoint`
    only with `pickup`, `z.null()` secret for keyless providers, no interactive default flow for a
    tracking connection (InPost)
  - OP-110, OP-111, OP-112, OP-113, OP-114, OP-115: kit `oauthToken`/`BoundSession`,
    `trackEach`/`trackBatches` everywhere, `readTables` options, `readObject`/`mergeSnapshots`,
    time and unit helpers, `postcodeSchema` (with a config migration `postcode` → `postalCode`);
    best done while moving the providers into the official providers repository
  - OP-117: stop exporting provider internals; let knip check `carriers/`
  - OP-118: a `#provider` subpath import (or flat `dhl/de-*.ts` files) for the eight DHL files
  - OP-119: an Amazon test that serves an order line linking to another host and expects
    `UnexpectedResponseError`
  - OP-120: table-driven `kit-time`, `kit-html` and `kit-track` suites (clock changes in
    Europe/Berlin and America/New_York, 31 February, `24:00`, fractions, epoch seconds versus
    milliseconds)

- [x] Consumers (decision record 0005, [`docs/consumers.md`](../docs/consumers.md)): `consumers:`
      in the repo manifest, notification rules in the core (events, direction, connections,
      quiet hours, digest, language, no duplicates), delivery from the outbox with backoff per
      consumer, built-in ntfy, email (SMTP), webhook (HMAC-signed) and Apprise consumers, "Send
      test notification", last delivery on the Status page, the Consumers page
- [ ] Consumers, rest: installable consumers through the registry (they run in the sandbox,
      `sandboxedConsumer`), the return-by reminder (needs a schedule)

## 4. Returns follow-ups

- [x] Return mails of other shops (generic rules), PayPal refunds matched to orders (rules
      2.0.0-dev.17: `generic-return`; refunds by invoice id, else by purchase total and payee)
- [x] Move return detail reading (deadline, drop-off, cost) from the server into the rules/providers
      (`EmailParseResult.return`, rules `src/mail/returns.ts`)
- [ ] Verify the Amazon return-window parsing on a live account run (needs a live account run and
      the owner's go-ahead)
- [x] Re-read old emails on demand so past returns appear: the inbox job "Read old emails again"
      (`docs/connection-actions-and-jobs.md` §8)
- [x] PayPal refund emails name no order number (rule `return-paypal`): match them to orders by
      amount and payee, or have the rules extract the shop's reference (both)
- [x] Order emails whose shipping part has a tracking number but no carrier the rules detect are
      filed under the first fallback service (dropped without one)

## 5. New connections (from the email backup inventory)

- [x] Berrybase, sertronics.shop: email rules (orders, shipping, delivery; sertronics.shop is
      BerryBase's sender). Its credit notes ("Gutschrift GU-…") carry no order number in the
      text (PDF only), so they cannot be filed
- [ ] Banggood: needs sample emails before rules can be written. The live mail (2026-11-26) has
      only Banggood newsletters, no order email
- [x] Fallback services on a private network: per-connection opt-in "Allow an address on your
      own network" (universal lookup; manifest `private_network_opt_in`)
- [x] Unkeyed fingerprints of Home Assistant import markers: migration 0032 turns them into
      adopted markers (they cannot be re-keyed without the HA credentials); the fallback is gone

## 6. Home Assistant integration (open-parcels-ha)

- [x] Source actions as buttons/services once the server has them (HA integration 0.9.0)
- [x] HA-032 (fixed in open-parcels-ha 966da56, released with 0.5.0)
- [ ] Buttons for the inbox's "Read old emails again": the integration builds buttons from
      `GET /api/v1/carriers`, inbox actions come from `GET /api/v1/inbox-form` (the service
      `open_parcels.run_action` already works)

## 7. Home Assistant app (open-parcels-ha-apps)

- [ ] AP-017: run as non-root; needs testing on a real Home Assistant install
- [ ] Bump to every server release automatically (script)

## 8. Browser extension (open-parcels-extension)

- [x] Server follow-ups of extension 0.2.0: `docs/extension-protocol.md` (bridge only on sites
      enabled from the toolbar; enable + per-request approval with Allow once / Always allow /
      Deny and a 10-minute cool-down after Deny; cancel reasons `busy` and `error`; main-frame
      watching, results only to the requesting origin; stored state = approval choices, refused
      hosts, storage.session)
- [ ] Signed releases; store publishing (walk the owner through it)

## 9. Website and org profile

- [ ] Remaining WS and GH low findings

## 10. Owner actions

- [ ] Hermes password once in the Hermes connection
- [ ] DHL API key (approved?) into the DHL connection

## 11. After everything above: split, clients, Android app (decision record 0004)

- [ ] Rename `open-parcels` → `open-parcels-server` and every reference; split repositories: `open-parcels-web` (own image + static zip),
      Compose file for both, all-in-one image stays the default. The `Dockerfile` label
      `org.opencontainers.image.source` must follow the rename to `open-parcels-server`
- [ ] Unraid: all-in-one template (default) plus server-only and web-only templates; Compose
      Manager Plus documented (Unraid has no native Compose)
- [ ] Website "Install" chooser: all-in-one (Docker / Unraid / Home Assistant), server only, web
      only, apps, libraries
- [ ] Client libraries from the released OpenAPI: `open-parcels-client-typescript`, `-python`,
      `-csharp` (+ SSE helper), published to npm, PyPI, NuGet
- [ ] Native Android app `open-parcels-android` (Kotlin, Compose, Room offline copy, WorkManager
      sync, UnifiedPush via ntfy.sh by default with no personal data in pushes); GitHub Releases +
      Obtainium, F-Droid, IzzyOnDroid, Accrescent (no Google Play)
