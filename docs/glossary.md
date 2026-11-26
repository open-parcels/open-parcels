# Glossary

One word for every concept, used the same way in code identifiers, API fields, database columns,
events, the web UI, Home Assistant, the website and every document. Chosen by the owner on
2026-11-24.

- **Use only the term in the first column** in the app, the API and the docs.
- The **alternatives** column is for communication only (owners, contributors, agents): it says what
  people may call the thing, so you can map their words to ours. Never use an alternative in the
  app, the API, code or docs.
- Carrier-specific words (Packstation, PaketShop, shipment in a carrier's API) may appear only as
  display labels or inside a provider's code that maps that carrier's own API.
- When a new concept appears, add it here first, then use it. Reviews check new code and text
  against this file.

| Term | Meaning | Alternatives (communication only, never in app/API/docs) |
| --- | --- | --- |
| Provider | Installable package that talks to one carrier, shop or other service (e.g. the Amazon provider, the DHL provider) | plugin, plug-in, integration, connector, carrier module |
| Consumer | Installable package that takes open-parcels' events out to a service the user chose (ntfy, email, webhook, Apprise); providers bring information in, consumers send it out (decision record 0005) | notifier, output, sink, channel, notification provider, event provider |
| Connection | One configured use of a provider: a signed-in account, a keyless tracking setup or a mailbox (e.g. "Amazon.de · Bluscream", "DHL tracking") | source, account, link, instance |
| Fallback service | A provider that is not a carrier but asks many of them (universal lookup, 17TRACK); asked only about parcels no built-in carrier follows or finds | aggregator, meta tracker, universal tracker, fallback provider |
| Parcel | One physical box or envelope travelling under one tracking number | shipment, package, consignment, Sendung, Paket |
| Tracking number | The code that identifies a parcel at its carrier (may contain letters) | barcode, tracking code, parcel number, tracking id, Sendungsnummer |
| Carrier | The company that transports a parcel (DHL, Hermes, DPD) | courier company, delivery company, shipping company, Paketdienst, Zusteller (company) |
| Courier | The person or vehicle doing the final delivery, shown on the live map | driver, delivery person, Fahrer, Zusteller (person) |
| Shop | The business you ordered from (Amazon, Reichelt, AliExpress) | store, merchant, retailer, vendor, Händler, Laden |
| Seller | The third-party merchant behind an order on a marketplace shop, when it differs from the shop | merchant, vendor, marketplace seller, Verkäufer |
| Storefront | One country site of a shop (amazon.de, amazon.com) | marketplace, region, domain |
| Event | One entry in a parcel's history ("handed to courier, Hamburg, 10:42"); a parcel's history is its list of events | scan, tracking event, status update, history entry, checkpoint |
| Live event | A message on the server's event stream (SSE) that clients such as Home Assistant receive; say "live event" wherever it could be confused with a parcel event | stream event, outbox event, SSE message |
| Notification | One message a consumer sends about a parcel state change (or a needed sign-in, a failed backup); one per state change, however many connections report it ([`consumers.md`](consumers.md)) | alert, push, message, Meldung |
| Notification rule | A consumer's settings for which notifications it sends and when: events, directions, connections, quiet hours, digest, language | filter, subscription, notification settings |
| Quiet hours | Notification rule: a daily time range in which nothing is sent; what falls into it waits until it ends. Not the scheduler's quiet window | do not disturb, night mode, Ruhezeit |
| Digest | Notification rule: several notifications sent together, hourly or daily, instead of one each | summary, batch, Zusammenfassung |
| Home Assistant event | An event on Home Assistant's bus fired by the integration (open_parcels_*); always named with "Home Assistant" | HA event, bus event |
| Inbox | A connection to an e-mail account folder that open-parcels reads (IMAP) | mailbox, mail source, mail account, Postfach |
| Email | One message in an inbox ("shipping email", "return email"); write "email" without a hyphen | mail, message, e-mail, Nachricht |
| Action | A button or command a provider offers on a connection ("Import history", "Open account page") | button, command, operation, task |
| Job | The long-running, resumable work an action starts, with progress and cancel | task, run, background task, process |
| Built-in (tier) | A provider shipped inside the open-parcels image | core, bundled, internal, first-party |
| Verified (tier) | A provider listed and reviewed in the open-parcels registry, pinned per version | official, reviewed, trusted |
| Custom (tier) | A provider the user added from any git URL or archive | manual, private, user-added |
| Community (tier) | A provider found by the `open-parcels-provider` topic search, not reviewed | public, third-party, unverified |
| Expected delivery | When a parcel is expected to arrive: a day or a range (from–to). UI: "Expected delivery" where there is room, "ETA" in tight spaces (table columns, badges) | delivery window, eta, planned, forecast, arrival, Zustellzeitraum |
| Pickup point | Umbrella for any place to collect or drop off a parcel (also the drop-off places of returns). Kinds: locker, parcel shop, post office. Carrier names (Packstation, PaketShop, Amazon Locker) appear only as display labels | service point, parcel shop, access point, collection point, drop-off point, Packstation, PaketShop, Filiale |
| Locker | Kind of pickup point: an automated locker (DHL Packstation, Amazon Locker, InPost) | packstation, parcel locker, Automat |
| Parcel shop | Kind of pickup point: a shop that accepts and hands out parcels (Hermes PaketShop, DPD Pickup shop) | PaketShop, partner shop, Annahmestelle |
| Post office | Kind of pickup point run by the postal carrier (DHL/Deutsche Post Filiale) | Filiale, branch |
| Item | One thing you bought: a line of an order or a thing in a parcel (name, picture, quantity, price) | product, article, line, order line, Artikel |
| Contents | Free-text description of what is in a parcel, when a carrier or sender provides it (e.g. Hermes "description") | description, content, Inhalt |
| Sign in | Authorising a connection at its carrier or shop ("Sign in to DHL", "Sign in again"); noun: sign-in | log in, login, authenticate, link account, connect |
| Log in | Entering the web UI with the reader or admin password; noun: login | sign in, authenticate, unlock |
| Archive | A parcel or order kept in the database but out of the default lists (automatic after delivery, or by hand) | done, hide, close, Archiv |
| Removed | State of a parcel its carrier or shop no longer lists while it was not yet delivered | vanished, gone, dropped, lost |
| Hidden | Not shown anywhere because every connection that reported it is disabled; comes back when one is enabled | suppressed, filtered, invisible |
| Delete | Gone from the database for good (by hand, Clear data, Data page) | remove, erase, purge, Löschen |
| Receiving / Sending | Direction of a parcel: receiving = coming to you, sending = going from you (returns create a sending parcel). UI: "Receiving", "Sending" | incoming, outgoing, inbound, outbound, sent |
| Order | One purchase at a shop, with its items and parcels. Status words use the participle form (ordered, shipped, delivered, …) | purchase, Bestellung |
| Return | Sending items back to a shop: return-by date, pickup points, cost, label, the sending parcel. Status words: requested, returning, returned, refunded, rejected, cancelled, expired | Rücksendung, Retoure, RMA |
| Refund | Money a shop pays back, with or without a return. Status word: refunded | reimbursement, Erstattung, credit |
| Backup | A complete copy of the database, taken on a schedule or by hand; restored with the server stopped. Does not contain the encryption key | snapshot, dump, export, Sicherung |
| Theme | An installable, declarative look for the whole web UI (colours, fonts, spacing, map style, logo); may come with a light and a dark variant | skin, style, look, Design |
| Mode | Light, dark or automatic (follow the device); chosen separately from the theme | colour scheme, appearance, dark mode, light mode |

## Repositories, projects and images

Every repository of the `open-parcels` GitHub organisation, the name to use for it in text, and
what it publishes. Use the short name in prose ("the server", "the HA integration"); use the
repository name in links, commands and code. "Planned" names take effect with decision record
0004 (TODO §11); until then the current name is still the real one.

| Repository (current → planned) | Short name (EN) | Short name (DE) | Publishes |
| --- | --- | --- | --- |
| `open-parcels` → **`open-parcels-server`** | the server | der Server | images `bluscream1/open-parcels` (today; planned: `open-parcels-server` server only, `open-parcels` all-in-one), `ghcr.io/open-parcels/…` |
| **`open-parcels-web`** (planned; the web UI lives in `open-parcels/web` today) | the web UI | die Weboberfläche | image `open-parcels-web`, static zip |
| `open-parcels-rules` | the rules | die Regeln | npm package `open-parcels-rules`, Python loader |
| `open-parcels-ha` | the HA integration (Home Assistant integration) | die HA-Integration | HACS integration `open_parcels` |
| `open-parcels-ha-apps` | the HA app (Home Assistant app) | die HA-App | image `bluscream1/open-parcels-ha-app` |
| `open-parcels-extension` | the extension (browser extension) | die Erweiterung | Firefox and Chromium zips |
| `open-parcels.github.io` | the website | die Website | open-parcels.github.io |
| `.github` | the org profile | das Organisationsprofil | issue forms, profile README |
| `open-parcels-client-typescript`, `-python`, `-csharp` (planned) | the TypeScript / Python / C# client | der TypeScript-/Python-/C#-Client | npm, PyPI, NuGet |
| `open-parcels-android` (planned) | the Android app | die Android-App | APK (GitHub Releases, F-Droid, IzzyOnDroid, Accrescent) |
| official providers repo and registry (planned, decision record 0002) | the official providers / the registry | die offiziellen Provider / das Verzeichnis | provider packages, signed index |

Never call the server "the backend", "the API" or "the app". Never write "app" on its own: always
"HA app" (Home Assistant app) or "Android app", so it is clear which one is meant. "Home Assistant
add-on" is the old name of the HA app.

## German UI terms

The web UI is in English and German (`web/src/i18n`). These are the official German words for the
terms above; use exactly these in German texts. Terms without a row here keep a plain German word
chosen once in `web/src/i18n/de/` and are added here when they matter.

**Provider and Consumer stay English** in German texts (owner decision 2026-11-26), so bug reports
and feature requests use the same word in every language and can be searched across them. They are
masculine and keep German grammar around them: "der Provider", "des Providers", "die Provider";
"der Consumer", "des Consumers", "die Consumer", "Consumer hinzufügen". A map's tile provider is a
different thing and stays "Kachelanbieter" ("eigener Anbieter").

| Term | German UI term |
| --- | --- |
| Parcel | Paket |
| Tracking number | Sendungsnummer |
| Carrier | Paketdienst |
| Courier | Zusteller |
| Shop | Shop |
| Pickup point | Abholstelle |
| Expected delivery | Voraussichtliche Zustellung |
| Connection | Verbindung |
| Inbox | Postfach |
| Email | E-Mail |
| Order | Bestellung |
| Return | Rücksendung |
| Refund | Erstattung |
| Item | Artikel |
| Event | Ereignis |
| Live event | Live-Ereignis |
| Provider | Provider (der Provider, die Provider) |
| Action | Aktion |
| Job | Auftrag |
| Fallback service | Ausweichdienst |
| Sign in / sign-in | Anmelden / Anmeldung |
| Log in / login | Einloggen / Login |
| Archive | Archivieren / Archiv |
| Delete | Löschen |
| Receiving / Sending | Empfang / Versand |
| Backup | Sicherung |
| Theme / Mode | Design / Modus |
| Consumer | Consumer (der Consumer, die Consumer) |
| Notification / Notification rule | Benachrichtigung / Benachrichtigungsregel |
| Quiet hours | Ruhezeit |
| Digest | Zusammenfassung |

## Renames this implies

The first pass over all code, docs and websites brings everything in line (`tasks/TODO.md` §3).
Old names are never kept next to new ones (owner decision 2026-11-24: migrate, don't keep legacy
code). A rename is done in one step: stored data is migrated automatically (a database migration),
or, where that cannot work, by a documented manual step in `CHANGELOG.md`. Clients that cross a
public boundary (the Home Assistant integration and app, the browser extension) are updated in
lockstep.

| Old | New | Where | How it was migrated |
| --- | --- | --- | --- |
| plugin, plug-in | provider | code, docs, API (`provider`) | renamed; DB via migration 0019 |
| source | connection | API (`/api/v1/connections`), DB, UI, live events (`connection.*`), HA devices | renamed; DB via migration 0019, HA import markers via 0020; HA entities keep their ids |
| barcode | tracking number (`tracking_number`) | API fields, DB, UI | renamed; DB via migration 0019 |
| direction `incoming` / `outgoing` | `receiving` / `sending` | API, DB, UI, HA sensors | renamed; DB via migration 0019; HA sensor entity ids kept |
| mailbox, mail | inbox, email | UI, docs, code | internal and UI only |
| eta, planned_from/to, forecast | expected delivery (UI), `expected_from` / `expected_to` (API) | API, UI, calendar | renamed; DB via migration 0019 |
| history entry, scan | event | UI, docs | outbox/SSE messages become "live events" in docs and UI text |
