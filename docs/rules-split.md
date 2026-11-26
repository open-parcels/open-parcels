# Splitting the rules: email rules move into providers

Migration plan for TODO §3 "Split `open-parcels-rules`". It narrows decision record
[0002](decisions/0002-providers.md) §3.2 to the email rules and builds on email routing
([`provider-manifest-and-sandbox.md`](provider-manifest-and-sandbox.md) §3).

## What moves, what stays

- **Moves:** the email rules of a shop or carrier that has a provider, with their test vectors
  and `.eml` fixtures. They become the provider's `emailRules` (same format as the rules'
  `data/mail/*.yaml`, `schema/mail-rule.schema.json`), and its manifest names their sender
  domains in `email.from_domains`. Fixtures move to `server/test/fixtures/email/<provider>/` (since 2026-11-26 `providers/<name>/fixtures/email/` in `open-parcels-providers`).
- **Stays in the rules (the shared core):** the rule engine, tracking-number formats, carriers,
  status tables, locales, the `ignore` rules, schema.org and the format-detection fallback for
  unknown senders, and the email rules of shops and carriers without a provider. Rules for
  senders that relay for many shops (`allegromail.pl`, eBay member relays, Shopify) stay too:
  no single provider may claim those domains.
- **Not yet:** status tables, keys and carrier entries (0002 §3.2, P5), and shops without a
  provider, which wait for declarative providers.

## How a provider reads with rules

A provider declares either `parseEmail` (code) or `emailRules` (data), never both; its manifest
has `email` exactly when it has one of them. The core runs `emailRules` itself, as 0002 §2.14
asks for declarative rules: never in the sandbox, with no call to the provider. It reads the
email with `withEmailRules(rules, emailRules)` (the shared rules with the provider's email rules
in place of the shared ones; the `ignore` rules stay) through the same interpreters the inbox
uses for the shared rules (parcels, orders, returns).

## One email, never two parcels

- An email whose sender is routed to a provider is read by that provider only; when it gives
  anything, the shared rules never see it (`routing.ts`, unchanged).
- A moved rule leaves the rules package in the same release that the provider gains it, and the
  server bumps to that release in the same commit (no version of the server has both).
- A provider's rules see the email exactly as the shared rules saw it before: the same rules,
  the same `ignore` rules, the same schema.org reading and fallback, the same interpreters. So
  their reading is complete even when it finds nothing, and the email never falls through to
  the shared rules (which would run the fallback on an email a moved rule had already claimed).
- Sender domains of two providers never overlap (a test checks the built-ins).

## Unauthenticated senders

Routing needs the receiving server's DKIM or DMARC pass. An email from a moved sender that
fails it now goes to the shared rules, which no longer read it. That is wanted for forged
senders, but a mail server that adds no `Authentication-Results` would lose those emails. So
this split ships with the per-inbox switch from 0002 §2.14: "Check senders (DKIM/DMARC)", on
by default; off, that inbox routes by the sender's domain alone.

## Steps

1. **Engine:** `withEmailRules` and the `EmailRuleDefinition` type in the rules package.
2. **Per-inbox sender check** (above), before any rule moves.
3. **First providers, most common emails first:** Amazon (order, shipping, return and dunning
   emails), DHL and Hermes. Their rules and fixtures leave the rules package; it is released as
   `2.0.0-dev.15`, and the server moves to it in lockstep.
4. **Carriers with providers and one sender of their own:** DPD Germany, UPS, FedEx, USPS,
   Evri and Canada Post, released as rules `2.0.0-dev.16` with the server in lockstep.
5. **Next:** shops as declarative providers once those exist (eBay,
   AliExpress, Temu, Otto, Zalando, …).
