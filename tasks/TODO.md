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
      layers, connection state reasons, scheduler and backup error codes, calendar and ICS texts
      done, see `DONE.md`). Still English: the database check's own error text on the Status page
      and texts written by providers or carriers (`carrier_message`, provider rewrite, §3); the
      HA integration's return sensor attributes (`drop_off`, `cost` words)
- [ ] Accessibility pass: axe on every page and token contrast are tested (see `DONE.md`).
      Still to do by hand: keyboard walk of every page and dialog (focus order, focus return
      after dialogs, the map and calendar widgets), screen-reader pass (NVDA/Orca) of live
      updates and sign-in steps
- [ ] Mobile layout pass: phone CSS at 360–480 px done (nav on its own row, icons only; tables
      scroll inside their card; smaller paddings; dialogs nearly full width; calendar toolbar
      wraps and opens the list view on phones; map menu kept clear). Still to look at on a real
      phone: the parcels table (scrolls, maybe cards), the split map/list pages and Leaflet's
      controls, FullCalendar's week/day views, the sign-in dialog's steps, the Settings place
      picker map, and Safari's dialog height (`100dvh`)
- [ ] Performance follow-ups (`docs/performance.md`, "Left as it is"): re-measure the order list
      now paged in SQL; the web UI still loads every page of parcels, because the parcels table
      searches, sorts and counts in the browser and the map and connections pages use every parcel
      (~4 MB with "Include archived" at 10,000 parcels); paging them needs search and sort on the
      server; measure on the Pi
- [ ] Release 2.0.0: changelog, tags `2.0.0`, `2.0`, `latest` on Docker Hub and GHCR, website and
      Unraid template switched from `:dev` to `:latest`, HA app on the release
- [ ] Make `ghcr.io/open-parcels/open-parcels` public (owner click) and switch docs to it
- [ ] Backups: look at the Backups card and the Status page in a browser (built and tested, not
      yet seen); the HA app's `backup_exclude` may want `backups/` once backups are on by default

- [ ] Provider logos beyond the eight from simple-icons (`server/logos/manifest.json`): add
      carriers' official logos from their press/brand pages where the terms allow, recording the
      source per file; until then the picker shows monograms
- [ ] Connection picker: look at it on a real phone (full-height dialog via `:has(.picker)`)

## 2b. Early groundwork for decision record 0004 (do soon: shapes the API and data model)

Token login, CORS, token on the live event stream, delta sync, API versioning and the slimmer
image are shipped (see `DONE.md`). Left:

- [ ] Measure the arm64 image on the Pi at the next publish (`op-image-housekeeping.sh`)

## 3. Provider rewrite (decision record draft 0002, provider ecosystem)

- [ ] Themes: replace the light/dark-only setting with installable themes. Two separate settings:
      Theme (default, installed themes) and Mode (Automatic from device / Light / Dark); a theme
      may ship a light and a dark variant (Automatic follows the device), or one variant that
      fixes the mode. A theme is declarative only (design tokens: colours, fonts, radius, spacing,
      map style, logo/icons; no JS, no external URLs — bundled assets only, CSP stays strict), so
      community themes can't run code or leak data. Distributed standalone or inside a provider
      repo (the repo manifest lists themes), installed from the providers page with the same tiers
      and trust warnings. Precondition: the web UI must use design tokens (CSS custom properties)
      everywhere, no hard-coded colours.
- [x] Email routing: inboxes dispatch matching emails to providers' `parseEmail` (sender domain +
      DKIM/DMARC check, `OPENPARCELS_EMAIL_ROUTING` on by default); design note §3
- [ ] Email routing follow-ups (0002 §2.14): subject/body filters and priority, per-route switches
      on the inbox card, "found in email by" attribution, backfill job, consent screen's sender
      domains (per-inbox sender check switch shipped)
- [ ] Split `open-parcels-rules`: provider data into providers, slim shared core stays
      (`docs/rules-split.md`). Email rules of Amazon, DHL and Hermes (rules
      2.0.0-dev.15) and DPD Germany, UPS, FedEx, USPS, Evri, Canada Post (2.0.0-dev.16) moved;
      next: shops as declarative providers; status tables, keys and carrier entries later (P5)
- [ ] One repo with a folder per provider for the official providers; repo manifest lists them
      (plan: `docs/official-providers-repo.md`)
- [ ] Registry repo (verified tier, signed index, blocklist), custom git URLs, community discovery
      via the `open-parcels-provider` topic (on by default, yellow warning, review-prompt copy button)
- [ ] Providers page: installed / available tabs, tier badges, install from URL, auto-update
      (on for built-in and verified, opt-in for custom and community)
- [ ] Port the audit's "rewrite" items (OP-088 … OP-139) as acceptance tests of the new kit
- [ ] OP-108: decide on the DHL Poland proof-of-work

- [ ] Consumers (decision record 0005): `consumers:` in the repo manifest, notification rules in
      the core (events, direction, quiet hours, digest, no duplicates), built-in ntfy, email
      (SMTP), webhook (HMAC-signed) and Apprise consumers, "Send test notification", delivery
      status on the Status page; installable consumers through the registry

## 4. Returns follow-ups

- [ ] Return mails of other shops (generic rules), PayPal refunds matched to orders
- [ ] Move return detail reading (deadline, drop-off, cost) from the server into the rules/providers
- [ ] Verify the Amazon return-window parsing on a live account run
- [ ] Re-read old emails on demand so past returns appear (part of "Clear data" / history import)
- [ ] PayPal refund emails name no order number (rule `return-paypal`): match them to orders by
      amount and payee, or have the rules extract the shop's reference
- [ ] Order emails whose shipping part has a tracking number but no carrier the rules detect are
      dropped; with a fallback service they could become parcels filed under it

## 5. New connections (from the email backup inventory)

- [ ] Berrybase, sertronics.shop: order history where offered, else email rules
- [ ] Banggood: needs sample emails before rules can be written
- [ ] Fallback services on a private network: the HTTP layer refuses non-public addresses, so a
      universal-lookup service on the LAN cannot be used; decide on an opt-in per connection
- [ ] Unkeyed fingerprints of Home Assistant import markers (written before keyed ones) are still
      recognised (`legacyFingerprint`); they cannot be migrated without the HA credentials, so
      drop the fallback once no install has such markers

## 6. Home Assistant integration (open-parcels-ha)

- [ ] Source actions as buttons/services once the server has them
- [ ] HA-032 (the other lows shipped in 0.5.0)

## 7. Home Assistant app (open-parcels-ha-apps)

- [ ] AP-017: run as non-root; needs testing on a real Home Assistant install
- [ ] Bump to every server release automatically (script)

## 8. Browser extension (open-parcels-extension)

- [ ] Server follow-ups of extension 0.2.0: `docs/extension-protocol.md` (bridge only on sites
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
- [ ] Make `ghcr.io/open-parcels/open-parcels` public

## 11. After everything above: split, clients, Android app (decision record 0004)

- [ ] Rename `open-parcels` → `open-parcels-server` and every reference; split repositories: `open-parcels-web` (own image + static zip),
      Compose file for both, all-in-one image stays the default
- [ ] Unraid: all-in-one template (default) plus server-only and web-only templates; Compose
      Manager Plus documented (Unraid has no native Compose)
- [ ] Website "Install" chooser: all-in-one (Docker / Unraid / Home Assistant), server only, web
      only, apps, libraries
- [ ] Client libraries from the released OpenAPI: `open-parcels-client-typescript`, `-python`,
      `-csharp` (+ SSE helper), published to npm, PyPI, NuGet
- [ ] Native Android app `open-parcels-android` (Kotlin, Compose, Room offline copy, WorkManager
      sync, UnifiedPush via ntfy.sh by default with no personal data in pushes); GitHub Releases +
      Obtainium, F-Droid, IzzyOnDroid, Accrescent (no Google Play)
