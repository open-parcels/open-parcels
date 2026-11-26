# The extension: page protocol (v1)

Some carriers only offer a phone-app sign-in. Their last redirect goes to an address a browser
cannot open (`dhllogin://…?code=…`) or to a callback page the user would have to copy by hand. The
extension ([`open-parcels-extension`](https://github.com/open-parcels/open-parcels-extension))
catches that address in the sign-in tab and hands it to the web UI, which submits it like a pasted
address (`{ pasted: <address> }` to the sign-in step). The server checks `state`, so a stray code
is refused. The extension never sees or sends passwords; the user signs in on the carrier's or
shop's own page.

This document describes the protocol as of extension 0.2.0. The page side is
`web/src/connections/extension.ts` and `OpenUrlStep.tsx`; the extension side is `src/content.ts`,
`src/background.ts` and `src/lib/` in the extension's repository.

## Which sites: enabled from the toolbar only

The bridge does not run on every site. The user enables it per origin from the extension's toolbar
button ("Enable on this site"), which requests host access for that origin and only then registers
the bridge content script, dynamically, for exactly the enabled origins. Without that:

- the content script is not injected, so the page cannot detect the extension at all, and the web
  UI shows the manual guide with the hint to enable the extension on this site;
- other websites can neither detect the extension nor reach its background.

Rules for an origin to be enabled:

- `https:` origins, or plain `http:` on the local network (loopback, private IPv4/IPv6 addresses,
  single-label names like `http://nas:8080`, and `.local`, `.lan`, `.home.arpa`, `.internal`,
  `.localhost` names), the latter with a warning. Plain http anywhere else is refused.
- Content-script match patterns carry no port, so the background also checks the exact origin
  (scheme, host and port) of every message against the enabled list.
- Disabling an origin in the extension's options (or removing its host access in the browser)
  unregisters the bridge, forgets its "Always allow" choices and ends its open requests silently.

Even on an enabled origin the content script acts only on the web UI itself: the document must
carry `<meta name="open-parcels" content="web-ui">` (in `web/index.html`). It runs in the top frame
only (`allFrames: false`), so the web UI inside Home Assistant's ingress panel (a frame) cannot use
the extension; the web UI then offers to open itself in its own tab.

## Messages

All messages use `window.postMessage(message, window.location.origin)` in the web UI's tab. Every
receiver checks `event.source === window` and `event.origin === location.origin` and ignores
anything else (other frames, other windows, other sources) silently.

Page → extension (`source: "open-parcels-page"`):

| `type`    | Fields |
| --------- | ------ |
| `hello`   | – |
| `capture` | `requestId` (string, 1–200 characters), `url` (https), `redirectPrefix` (string), `resumeUrl` (https or `null`) |
| `cancel`  | `requestId` |

Extension → page (`source: "open-parcels-extension"`):

| `type`      | Fields |
| ----------- | ------ |
| `hello`     | `version` (the extension's version), `protocol: 1` |
| `captured`  | `requestId`, `url` (the full redirect address) |
| `cancelled` | `requestId`, `reason` (below) |

The page sends `hello` on load and treats the extension as present when an answer arrives within
500 ms. A `cancel` from the page ends that request without an answer.

Cancel reasons:

| `reason`  | Meaning |
| --------- | ------- |
| `closed`  | The user closed the sign-in window |
| `denied`  | The user chose Deny, or Deny was chosen for this origin less than 10 minutes ago |
| `invalid` | The `capture` fields failed validation (rule 2) |
| `timeout` | No answer in the approval window within 5 minutes, or no result within 15 minutes of sign-in |
| `busy`    | An approval window for this origin is already open, or the page's tab is not the active tab |
| `error`   | The extension could not open the approval or sign-in window, or load the sign-in page |

A page must accept reasons it does not know (the web UI shows a generic text); `busy` and `error`
were added in extension 0.2.0 without a protocol version change.

## Rules for `capture`

1. **Per-request approval.** Each `capture` opens an approval window naming the requesting origin,
   the sign-in host and the redirect target (scheme and host of `redirectPrefix`), with **Allow
   once**, **Always allow** and **Deny**. "Always allow" is remembered for exactly that origin +
   sign-in host + redirect target, and later matching requests skip the window. The window also
   asks for host access to the sign-in, resume and redirect hosts when the extension does not hold
   it yet; a refused host is remembered and not asked for again. **Deny** answers `denied`, and
   further captures from that origin are refused with `denied` without a prompt for 10 minutes.
2. **Validation.** `url` and `resumeUrl` must be `https:`. `redirectPrefix` must be an absolute
   prefix with a scheme (`javascript:`, `data:`, `blob:`, `file:` and `about:` are refused; http(s)
   prefixes need a host), and `url` must not already start with it. Otherwise → `invalid`.
3. **One at a time.** One request per page tab (a newer `capture` from the same tab replaces the
   older one silently), and one approval window per origin (another → `busy`). A request from a
   tab that is not active → `busy`.
4. **Watching.** The extension opens `url` in a new popup window (or tab) and watches **only that
   tab, main frame only**. The first address in it that starts with `redirectPrefix` (from
   `webRequest.onBeforeRedirect` `redirectUrl`, `webRequest.onBeforeRequest`,
   `webNavigation.onBeforeNavigate`/`onErrorOccurred`, or `tabs.onUpdated`; scheme compared
   case-insensitively) is the result: close the window, send `captured`, stop watching.
5. **Resume.** Some sign-in pages end on a blank page after a successful sign-in (DHL). When
   `resumeUrl` is set and a main-frame `POST` in the tab completes without a capture within
   3 seconds, the tab is sent to `resumeUrl` (at most 3 times per request).
6. **Results only to the requesting origin.** `captured` and `cancelled` go to the tab and
   document that asked (`frameId: 0`, its `documentId`), with `targetOrigin` set to the requesting
   origin, and only while that tab still shows that origin; otherwise the result is dropped.
7. The user closing the sign-in window → `closed`. Approval left open 5 minutes, or sign-in not
   finished within 15 minutes → `timeout`. The web UI also gives up after 15 minutes and sends
   `cancel`.

## Authentication

The protocol carries no token or password. What protects it:

- Only an origin the user enabled can talk to the extension at all, and each sign-in needs the
  user's approval (or an "Always allow" for exactly that origin, sign-in host and redirect target).
- The captured address is only useful to the server that started the sign-in: the server's sign-in
  step checks the `state` it issued, so an address from another sign-in or another page is
  refused. The page submits it with its own login session, like a pasted address.

## Stored state

- `storage.local`: the enabled origins, the "Always allow" choices, and the hosts whose access the
  user refused.
- `storage.session` (memory only, gone when the browser closes): open requests and the Deny
  cool-downs. Captured addresses are never stored; they live in memory until they are sent.

Deadlines are alarms, so a stopped Manifest V3 service worker picks up where it left off.
