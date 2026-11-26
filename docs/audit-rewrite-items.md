# The audit's "rewrite" items

The code audit of 2026-11-19 (second and third pass) sorted its findings about providers, the
provider kit and their neighbours into "Rewrite" groups 25–29: fix them with the provider rewrite
instead of one by one. This note checks every item in OP-088 … OP-139 against the code as it is
after the manifest, sandbox, jobs, email routing and consumers work, and names the test that pins
the behaviour down. Items are written as the audit wrote them; "provider" is the audit's
"plug-in".

The same groups also list OP-035, OP-037, OP-050, OP-051 and OP-057; they are outside this range
and not checked here.

## Status

- **Fixed:** the behaviour the audit asked for holds, and the test fails without the fix.
- **Partly:** what is fixed has a test; the rest is a TODO entry (`tasks/TODO.md` §3, "Audit
  rewrite items, rest").
- **Open:** nothing changed yet; the TODO entry says what to do. Most open items need either a
  recorded real answer per carrier (which this repository may not guess) or a change across 20
  to 40 providers, which belongs to moving the official providers into their own repository.

`acceptance` is `server/test/unit/rewrite-acceptance.test.ts`.

| Item | What | Status | Test |
| --- | --- | --- | --- |
| OP-088 | Blocking or malformed answers (401/403, 400/422, 409, any redirect, a missing `data` list) read as "not found" in Trunkrs, Paack, Colisweb, Hermes, DHL Iberia, GLS NA, BOX NOW | Open | none yet: each needs the carrier's own not-found marker from a recorded answer |
| OP-089 | An expected delivery given only as its latest time was stored once and never updated | Fixed: the engine takes the window from a snapshot when either end is set | acceptance "OP-089" |
| OP-090 | A zone name the carrier sends made the kit throw and fail the whole run | Fixed: `zonedIso` (and so `isoTime`, `parseLocal`, `dayWindow`) gives null for a zone the runtime does not know | acceptance "OP-090" |
| OP-091 | `isoTime` took the `-2026` of `05-11-2026` for an offset and read the date in the server's zone | Fixed: an offset counts only after a time of day | acceptance "OP-091" |
| OP-092 | ICS Courier, Slovak Parcel Service and Slovenská pošta took "a z anywhere" for an offset | Fixed: all three hand anything that is not their local form to `isoTime` with `naive: "reject"` | acceptance "OP-092" |
| OP-093 | Times without an offset read in a zone the answer does not support (BRT history, GOFO, CTT, GLS, Better Trucks, Poste Italiane, Pošta Slovenije, Posten Bring, Nova Post) | Open | none yet: needs one recorded answer per carrier to decide the zone |
| OP-094 | Colis Privé built the end of a delivery day by adding 86,399 seconds | Fixed: `localDay` in Europe/Paris | acceptance "OP-094"; `colis_prive.test.ts` |
| OP-095 | Ampère paired history texts and times by position after dropping empty ones | Fixed: status and time are read inside the same row | acceptance "OP-095"; `ampere.test.ts` |
| OP-096 | DHL Germany reported a return as both delivered and returning | Fixed: a return is `returning`, never delivered | acceptance "OP-096" |
| OP-097 | Mój DHL's public lookup read a 422 that names no number as "none of these exist" | Fixed: `UnexpectedResponseError` | `dhl-pl.test.ts` "DHL Poland's public lookup (OP-097)" |
| OP-098 | Errors caught too widely or by their message text | Partly: myDPD stops when the session ends mid-run instead of reading signed-out pages; Mój DHL logs a missing observed list at `warn` | none yet for the two fixes; DPD's reset-connection check still reads the message (an error's `cause` does not cross the sandbox) |
| OP-099 | Status knowledge in provider code next to the shared tables (Dynalogic, Posten Bring, Česká pošta, single codes in 15 providers) | Open | none yet: moves into `open-parcels-rules` with the rules split |
| OP-100 | The kit copied an empty or re-spelled echo into `externalRef` | Fixed in `asTracked` and in the host's safety net (`fileUnderTracked`) | acceptance "OP-100"; `engine/tracked.test.ts` |
| OP-101 | Unbounded per-parcel requests and needless session writes (Canada Post, Cargus, PPL CZ, Vinted Go, Posti paging, ACS, An Post, USPS) | Open | none yet |
| OP-102 | Mutable module-level state in CTT, Budbee, Swiss Post, Posti | Open | none yet; the sandbox keeps it per process, not per connection |
| OP-103 | Pasted sign-in input parsed without a guard (DHL Germany, Vinted Go) | Fixed: both refuse it with `SignInRejectedError` | acceptance "OP-103" |
| OP-104 | Lookup tables indexed with carrier or user text without an own-property check | Fixed: `own(table, key)` in the kit, used in `unescapeHtml` and the eleven places the audit names | acceptance "OP-104 and OP-134" |
| OP-105 | Provider HTTP sent headers on cross-host redirects; the follow mode had no allow-list or own cap | Fixed by the manifest work: every hop goes through one loop with the manifest's allow-list, credential headers are dropped when the host changes | `unit/http.test.ts` "does not send credentials on to another host (OP-105)", "reaches only the hosts the manifest allows, on every redirect hop too" |
| OP-106 | Free carrier text passed to `reportUnknown` (16 providers) | Open | none yet: needs a kit `reportKey` and its use in each provider |
| OP-107 | Stored tracking links carry the recipient's postcode; PostNL stored a link the carrier chose | Partly: PostNL keeps its link only for `postnl.nl` over https | `postnl.test.ts` "lists the shipments …"; the postcode note for the README is open |
| OP-108 | The DHL Poland back end solves the carrier's proof-of-work challenge | Owner's decision, see below | `dhl-pl.test.ts` "Altcha proof of work" pins the bounds |
| OP-109 | Provider definitions differ where the contract expects one way | Partly: registration now checks the manifest against the code (kinds, secrets, live, User-Agent, hosts, email); history order, `pickupPoint` only with `pickup`, the secret of a keyless provider and InPost's tracking flow are not checked | `unit/manifest.test.ts`; the rest open |
| OP-110 | Token requests and session binding written out per provider | Open (L) | none yet; OP-085 and OP-086 themselves are fixed (`tasks/DONE.md`) |
| OP-111 | The tracking loop copied instead of `trackEach` in 35 providers; no batch variant | Open | none yet |
| OP-112 | HTML readers re-implemented next to the kit (Straightship, DPD, Hrvatska pošta, Colis Privé, Ampère) | Open | none yet |
| OP-113 | "Parse the body as JSON or throw" by hand in 16 places; two copies of the multi-back-end merge | Open | none yet |
| OP-114 | Date, time and unit handling repeated per provider | Open | none yet |
| OP-115 | Postcode checks repeated; `postalCode` and `postcode` for one field | Open | none yet; the rename needs a config migration |
| OP-116 | Tracking links built in code or missing although the rules have templates | Open | none yet; needs templates in `open-parcels-rules` |
| OP-117 | Unused exports and dead re-exports | Partly: `lookUpStatus`, `StatusTable` and Amazon's `isTimeZone` re-export are gone; provider internals are still exported freely (knip skips `carriers/`) | knip (gate) for the kit; providers open |
| OP-118 | Eight DHL files climb `../../../provider/api.js` | Open | none yet: a `#provider` subpath import or flattening the three folders |
| OP-119 | Tests that cannot fail for the reason they name | Partly: BRT, Cargus and GLS now expect `TransientError`; the Amazon "follows only links on the storefront" test and the tests that pin OP-080 and OP-087 are open | `brt.test.ts`, `cargus.test.ts`, `gls-national.test.ts` |
| OP-120 | The kit and several failure paths have no direct tests | Partly: unknown zone, `-YYYY`, a clock-change day, `&constructor;`, empty and re-spelled echoes are tested | acceptance; the table-driven `kit-time`, `kit-html` and `kit-track` suites are open |
| OP-126 | An email without a usable date got the wall clock as its event time | Fixed: such an email gives a parcel without an event | acceptance "OP-126"; `mail/interpret.test.ts` |
| OP-134 | Migration lookup tables indexed with old-database text | Fixed: own entries only in the legacy importer and `isPlausibleOrder` | acceptance "OP-104 and OP-134" |
| OP-139 | The HA importer kept its own copy of Amazon's storefronts and serial pattern | Fixed: the provider's config and secret schemas decide; a secret they refuse imports the connection as needing a sign-in | `migrate/ha.test.ts` "asks the provider's own schemas …" |

## OP-108: the DHL Poland proof-of-work

**For the owner to decide.** Nothing here is decided; the code is unchanged.

**What the code does.** Mój DHL puts an Altcha challenge in front of its public tracking lookup
and its SMS sign-in: the page fetches a salt and a SHA-256 target, the browser searches for the
number that matches and sends it as `captcha-payload`. The DHL provider does the same search
(`server/src/carriers/dhl/pl/altcha.ts`), bounded to 2,000,000 hashes and 4 s of CPU time,
yielding to the event loop between slices. The Polish region is off by default (`regions` in the
DHL tracking connection) and is used only when the user switches it on or signs in to a Polish
account.

**Why it is a question.** The provider API's contract for `CaptchaError` says "We never try to
solve it; we pause the connection instead." Altcha calls itself a captcha, yet it asks no person
anything: it is a cost every client pays, browser or not. The file argues it is the latter; the
audit asks the owner to say so, or not, once.

### Option A: allow proof of work, never human challenges (keep the code)

Write the rule into decision record 0002 (provider rules) and into the `CaptchaError` comment:
providers may compute a proof of work that every client computes, with a CPU and time bound; they
never solve, outsource or bypass a challenge that asks a person (image, audio, "I am not a robot"
checkbox with behaviour scoring) and pause the connection instead.

- **Pro:** Polish DHL tracking and sign-in keep working as they do now; no user-visible change.
- **Pro:** a clear, testable line for every future provider, including community providers
  reviewed later, instead of a per-case argument.
- **Pro:** the cost is bounded and measured (2,000,000 hashes, 4 s, yields between slices).
- **Con:** the carrier deployed the challenge to slow automated clients; computing it is working
  through a measure aimed at us, even if any browser does the same.
- **Con:** DHL may read it as automation and block the client or the user's account; that risk
  falls on users who switched the region on.
- **Con:** a proof of work can be made heavier at any time; the bound then makes lookups fail
  instead of costing more, which the code already handles as a transient error.

### Option B: no challenge of any kind (remove the solver)

Delete `altcha.ts`; a challenge raises `CaptchaError` and the connection pauses, as the contract
says today.

- **Pro:** the simplest rule ("we never work through a challenge") with no judgement calls.
- **Pro:** the least exposure towards DHL Poland and the least CPU on small hosts (the HA app on a
  Raspberry Pi).
- **Con:** Polish DHL parcels have no public lookup and Polish accounts cannot sign in: the region
  stops working entirely, since every call carries the challenge.
- **Con:** users who rely on it lose it; the release notes must say so.

### Option C: keep it, off by default, with a stated opt-in

Keep the code and the rule of option A, but say it where the user switches the region on: the
setting's description names the proof of work and its CPU cost, and the README's privacy and
third-party section lists it.

- **Pro:** no silent behaviour: the user chooses knowingly, and the default install never
  computes a challenge.
- **Pro:** keeps Polish tracking for those who want it.
- **Con:** the same exposure as option A for those users; the wording has to be kept up to date in
  two places.
- **Con:** "off by default" is already the case today, so C differs from A only in the text.

### Option D: ask DHL for API access

Apply for DHL's official Polish tracking API (as for the DHL API key in TODO §10) and drop the
public lookup once a key works.

- **Pro:** no challenge at all, on terms DHL sets.
- **Con:** needs the owner's application and approval, and a key per install or a shared one;
  Polish account sign-in has no such API, so the SMS sign-in question stays.
- **Con:** weeks of waiting; A, B or C still applies until then.
