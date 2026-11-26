# Provider manifests and the sandbox

Design note for TODO §3 "Manifest format and capabilities model" and "Provider sandbox". It
narrows decision record [0002](decisions/0002-providers.md) (§2.2, §2.3, §2.7, §3.1 steps 1–3) to
what is built now, and says how consumers ([0005](decisions/0005-consumers.md)) reuse it.

## 1. The manifest (format 1)

Every provider has one manifest, `open-parcels-provider.json`, at the root of its folder. Built-in
providers keep theirs in `server/src/carriers/<id>/`; one folder is one provider (the demo shop
moves to its own folder). The schema is `server/src/provider/manifest.ts` (zod), the only parser.
Installed providers (P3) bring the same document; YAML is only another spelling of it and is
parsed into the same schema then. The schema moves to the engine package with the split (P5).

```json
{
  "schema": 1,
  "id": "hermes",
  "name": "Hermes",
  "countries": ["DE"],
  "aliases": ["myHermes"],
  "logo": "hermes.svg",
  "provides": { "connections": ["account", "tracking"], "live": false, "fallback": false },
  "permissions": {
    "network": [
      { "host": ".my-deliveries.de", "reason": "Public tracking API and myHermes account." }
    ],
    "image_hosts": [],
    "secrets": ["credentials"],
    "session": true,
    "user_agent": false
  }
}
```

- **The manifest is the one source of what a provider is and may do.** Name, countries,
  aliases, logo, connection kinds and image hosts leave the code (`defineCarrier`); the code keeps
  behaviour only (schemas, sign-in flows, pacing in `http.limits`, `fetchAccount`/`track`/
  `readLive`).
- **No `version` yet:** a built-in provider is versioned by the image it ships in. `version`,
  `engine` and `entry` come with installs (P3), as additions to format 1.
- **Capabilities** (`provides`): the connection kinds (`account`, `tracking`, `shop`), `live`
  (courier map) and `fallback` (a fallback service). Data capabilities (status tables, email
  rules, tracking-number patterns) are added to `provides` by the phases that build them (P2c,
  P5); format 1 refuses unknown keys, so a manifest cannot claim them early.
- **Email** (`email`, optional): `{ "from_domains": ["example-shop.de", ".example-shop.com"] }`,
  the sender domains whose emails the provider reads (§3), with `parseEmail` or with email rules
  (`emailRules`, [`rules-split.md`](rules-split.md)). Exact or a leading-dot suffix, as
  `network` hosts; webmail domains (`gmail.com`, `web.de`, …) are refused.
- **Actions** (`actions`, optional): buttons on the provider's connection cards, links and tasks
  that run as jobs ([`connection-actions-and-jobs.md`](connection-actions-and-jobs.md) §1).
  Registration checks that the manifest's tasks are exactly the code's `actions`.
- **Permissions:**
  - `network`: every host the provider may reach, each with a reason. `host` is exact
    (`api.example.com`) or a leading-dot suffix (`.example.com`: the domain and its subdomains).
    `{ "config": "<field>", "reason": … }` allows the host of a URL the user typed into that
    config field (the universal lookup's server). There is no `*`.
  - `image_hosts`: what the image proxy may fetch for this provider (as today's `imageHosts`).
  - `secrets`: the secret kinds its sign-in flows produce: `credentials`, `api_key`, `token`
    (interactive).
  - `session`: whether it keeps a per-connection session store.
  - `user_agent`: whether it overrides the honest User-Agent (the reason stays next to the value
    in the code).
- **Checked at registration** (start-up fails, and a test registers every built-in): the
  manifest parses; its `id` equals the code's; `provides.connections` covers exactly the kinds the
  code implements (`account`/`shop` need `fetchAccount`, `tracking` needs `track`); `live` iff
  `readLive`; `secrets` equals what the sign-in flows produce; `user_agent` iff the code sets one;
  every host in `http.limits` is covered by `network`; `email` iff `parseEmail` or `emailRules`
  (never both); the logo exists.
- **Enforced at run time:** `ProviderHttp` refuses any request, and any redirect hop, to a host
  the manifest does not list (`HostNotAllowedError`: not a transient error, so the run is logged
  as a bug, and never a sign-in problem). A session store of a provider without `session` refuses
  to save. The image proxy takes its hosts from the manifests.

## 2. The sandbox

A generic host for untrusted modules, `server/src/sandbox/`, that knows nothing about carriers.
Providers are its first user; consumers its second.

- **Process:** `child_process.fork` of `sandbox/child.js` with
  `--permission --allow-fs-read=<the runtime's files>,<the package folder>` (no write, no network,
  no child processes, no workers, no addons, no WASI), `--max-old-space-size`, and
  `--disallow-code-generation-from-strings`. The core refuses to start a sandbox on a Node release
  without the permission model's network flag.
- **Protocol** (IPC, structured clone): the host sends `call {id, method, args}`; the child answers
  `result {id, value}` or `error {id, error}`; while a call runs the child may send
  `request {id, call, capability, args}` and the host answers `reply {id, value | error}`. Errors
  cross as `{name, message, retryAfter?}` and are rebuilt into the provider API's error classes,
  so the runner's classification does not change.
- **Broker:** each call carries its own capability handlers on the host side. A request for a
  capability the call did not grant is refused. Nothing is ambient: no handler outlives its call.
- **Secrets per call:** config, secret and session travel with the call that needs them; the
  child holds no store. Its memory only ever holds connections of the provider(s) it hosts.
- **HTTP:** `ProviderHttp` is split into the client (redirect loop, cookie jar, `allowRedirect`,
  decoding; runs where the provider runs) and the hop transport (allow-list, non-public address
  check, host token buckets, pauses, User-Agent, body cap; always in the core). In the sandbox the
  client sends each hop over IPC, so the allow-list is checked by the core for every hop and the
  child never holds a socket.
- **Limits:** a timeout per call (kill and restart the child, the call fails as transient), and
  three crashes in ten minutes disable the sandbox until it is started again.
- **Providers in it:** the provider guest (`sandbox/provider-guest.ts`) holds the built-in
  providers and serves `fetchAccount`, `track`, `readLive` and sign-in turns; the core keeps a
  `RegisteredProvider` per provider whose four calls go to the guest (`sandbox/providers.ts`),
  while what a provider is (manifest, schemas, flows) is answered without a call. Each call
  carries config, secret and the session as loaded, and is granted `http` (one hop, answered with
  the core's time, which is the guest's clock until the next hop), `log`, `report-unknown` and,
  only with `permissions.session`, `session.save`. A task action's leg (`runAction`) is also
  granted `job.progress`, `job.emit`, `job.checkpoint` and `job.wait`. A finished sign-in's secret is
  validated again by the core against the provider's schema before it is stored. Errors keep their class across: a provider's
  own subclass (`BotGuardError extends TransientError`) travels with its nearest known class as
  `kind` and is rebuilt as that class under its own name; request timeouts are their own class
  (`RequestTimeoutError`), since an error's `cause` does not cross.
- **The switch:** `OPENPARCELS_PROVIDER_ISOLATION=off|pool` (environment only) runs the built-ins
  in-process or in one pool child for all of them. With `pool` the server starts the child at
  start-up and refuses to start unless it comes up under the permission model and its guest
  serves exactly the core's built-in providers; the image build starts the bundled server once
  in each mode (`Dockerfile`, smoke test). The bundle builds `dist/sandbox/child.js` on its own
  (in a shared chunk it would not be the entry module) and `dist/sandbox/provider-guest.js` with
  the server's chunks; the child may read `dist/` and `package.json`, nothing else. `pool` needs
  the built server; from the sources (`tsx`) the server refuses it.
- **Default `off`, and why:** the fixture suites pass in both modes (vitest project
  `providers-pool` runs every carrier suite through a sandbox child), so correctness no longer
  holds it back. It stays `off` because built-in providers are reviewed code shipped in the same
  image as the core, so isolating them guards against a bug, not against a stranger; `pool` costs
  a second Node process (about 60 MB), which counts on the HA app's Raspberry Pi; and a 10-minute
  run or 2-minute turn timeout now kills the one child for every provider at once. The sandbox's
  real job is installed providers (P3): those always run in it, whatever the switch says. Owners
  who want the defence in depth for the built-ins turn on `pool`.
- **Consumers (0005) reuse it unchanged:** a consumer module exports `deliver`/`test`, its manifest
  lists `network` hosts like a provider's, and its calls are brokered with `http` (and nothing
  else): the same process, protocol, allow-list and limits.

## 3. Email routing

Narrows decision record 0002 §2.14 to what is built now.

- **Match:** an inbox hands an email to every registered provider whose
  `email.from_domains` covers the domain of its `From` address, if the receiving server
  authenticated the sender: the topmost `Authentication-Results` header (the one the receiving
  server added; any below it may be the sender's own) says `dkim=pass` for a signer aligned with
  that domain (the same domain, a parent or a child of it), or `dmarc=pass` with
  `header.from` equal to it. An email whose sender is not authenticated goes to no provider.
  An inbox whose mail server adds no `Authentication-Results` turns the check off (inbox setting
  "Check senders (DKIM/DMARC)", `checkSenders`, on by default); it then routes by the domain alone.
- **What the provider gets:** `parseEmail(context, email)`. `email` holds an id (Message-ID, else
  a digest; the id for the events it gives), Message-ID, date, sender address and name, subject,
  text and HTML: no other headers, no attachments. `context` has the clock, the log and
  `reportUnknown`, no network, sign-in data or session. In `pool` mode it is the guest's
  `parseEmail` method, granted `log` and `report-unknown` only, with a 30-second timeout.
- **No email read twice:** a result without `ignored` means the provider read the email in full;
  the shared email rules (`open-parcels-rules`, which today read the email of most shops and
  carriers) then never see it. An email every matching provider ignored or failed on, or one no
  provider matches, goes to the rules as before. Several matching providers all read it; their
  parcels merge in the reconciler like any two connections' views of one parcel. So a provider that
  declares a shop's domain takes that shop's emails over from the rules completely: it must read
  every kind of email the rules read from there (shipping, order, return), or ignore those it does
  not.
- **Email rules:** a provider may bring email rules (`emailRules`, the rules' email rule format)
  instead of `parseEmail`. The core runs them itself, never in the sandbox: the shared rules with
  the provider's email rules in place of the shared ones (the `ignore` rules stay), through the
  same interpreters as unrouted email. Their reading is complete even when it finds nothing, so a
  routed email never reaches the shared rules too ([`rules-split.md`](rules-split.md)). Amazon,
  DHL, Hermes, DPD Germany, UPS, FedEx, USPS, Evri and Canada Post read their emails this way.
- **Filed under the inbox:** results are ingested under the inbox connection (role `mail`), as the
  rules' results are.
- **The switch:** `OPENPARCELS_EMAIL_ROUTING` (live, on by default). Off: the rules read every
  email, as before routing existed.
- **Not built yet (0002 §2.14):** subject, local-part, header and body filters, `priority`,
  per-route switches on the inbox card, attribution to the provider (`found in email by …`), backfill, and the consent
  screen's list of sender domains for installed providers.
