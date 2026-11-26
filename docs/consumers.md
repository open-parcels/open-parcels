# Consumers and notification rules

Design note for TODO §3 "Consumers". It narrows decision record
[0005](decisions/0005-consumers.md) to what is built now: the rules in the core, delivery from the
outbox, the four built-in consumers, the consumer manifest and how an installed consumer will run
in the sandbox.

## 1. Pieces

| Piece | Where | Does |
| --- | --- | --- |
| Consumer | `server/src/consumers/builtin/<id>/` | `describe()`, `deliver()`, `test()`: formats one notification for its service and sends it |
| Consumer manifest | `open-parcels-consumer.json` in that folder | what the consumer is, the hosts it may reach, the parcel fields it gets |
| Repo manifest | `server/src/consumers/builtin/open-parcels-repo.json` | `consumers: [{ id, folder }]`, the same format 1 as the themes' |
| Configured consumer | table `consumers` | one use of a consumer: label, config, encrypted secret, notification rules, last delivery |
| Notification | table `notifications` | one parcel state change (or a sign-in or backup problem), stored once |
| Delivery | table `notification_deliveries` | one notification for one configured consumer: due time, attempts, outcome |

The web UI says "consumer" for both the package and a configured one, as it says "provider" and
"connection"; the API keeps them apart (`/api/v1/consumers/available` lists packages,
`/api/v1/consumers` the configured ones, whose `consumer` field names the package).

## 2. From live event to notification

The dispatcher (`consumers/dispatcher.ts`) reads the event outbox after its own cursor (setting
`notifications.cursor`; on the first start it begins at the newest row, so an upgrade never sends
old news). Each live event is turned into at most one notification:

| Notification event | From |
| --- | --- |
| `registered` | `parcel.registered`, `parcel.sending_registered` |
| `in_transit`, `out_for_delivery`, `at_pickup_point`, `returning`, `problem` | `parcel.status_changed` to that status |
| `delivered` | `parcel.delivered`, `parcel.sending_delivered` |
| `delivery_time_changed` | `parcel.delivery_time_changed` |
| `refunded` | `return.updated` whose return is now `refunded` |
| `sign_in_needed` | `connection.state_changed` to `needs_sign_in` |
| `backup_failed` | `backup.finished` that failed |

**No duplicates:** each notification has a key (`parcel:<id>:status:<status>`,
`parcel:<id>:expected:<from>/<to>`, `return:<id>:refunded`, `connection:<id>:sign_in:<day>`,
`backup:<day>`) that is unique in `notifications`. The reconciler already merges what several
connections and providers say about one parcel into one parcel and one live event; the key also
catches a status that flips back and forth between two connections, a parcel registered again by
a repair, and a replayed outbox row. Imported history fires no live events, so it never notifies.

**Rules** are stored per configured consumer (`rules`, checked by `notificationRulesSchema`):

- `events`: the notification events above it wants;
- `directions`: `receiving`, `sending` or both;
- `connections`: null for all, or the connection ids a parcel must have been reported by;
- `quiet_hours`: null, or `{ from: "22:00", to: "07:00" }` in the server's time zone; a
  notification due inside them waits until they end;
- `digest`: `immediately`, `hourly` (on the hour) or `daily` (at 08:00); a digest sends every
  notification due by then in one message;
- `language`: `en` or `de`, the language of the texts the core writes.

## 3. Delivery

`notification_deliveries` is the queue; every configured consumer works through its own rows, one
delivery at a time, independently of the others. A consumer's `deliver` answers one of:

- `ok`: the rows are `sent`;
- `retry` (with an optional `retryAfterSeconds`): the rows wait with backoff (30 s, doubling, at
  most 6 h, or the time the service asked for); after 10 attempts they are `failed`;
- `failed`: a permanent failure (bad token, unknown topic); the rows are `failed` at once.

A thrown error counts as `retry`. Nothing waits for a delivery: tracking, the outbox and the other
consumers go on. Deliveries older than three days are dropped as `expired`, so a dead service never
builds up a backlog. Each configured consumer keeps its last attempt, last success and last error;
the Status page shows them, and the `consumers` check is `degraded` while one's last attempt
failed.

## 4. The consumer API

```ts
interface Consumer {
  describe(): ConsumerDescription; // manifest, config and secret schemas
  deliver(message: Message, call: ConsumerCall): Promise<DeliveryOutcome>;
  test(call: ConsumerCall): Promise<DeliveryOutcome>; // the "Send test notification" button
}
```

`ConsumerCall` carries the config, the secret (decrypted for this call only) and `http`, the
core's transport held to the consumer's hosts. `Message` holds the texts the core wrote (title,
body, the click link: the parcel's page when `OPENPARCELS_PUBLIC_URL` is set, else the carrier's
tracking page) and, per notification, only the parcel fields the manifest asks for. Courier
positions are never in it.

## 5. Built-in consumers

| Consumer | Config | Secret | Sends |
| --- | --- | --- | --- |
| `ntfy` | server, topic, priority | token (optional) | `POST <server>/<topic>` JSON with title, message, tags, `click` and a "View parcel" action |
| `email` | SMTP host, port, security (`starttls`, `tls`, `none`), from, to | user and password (optional) | an HTML and a text part |
| `webhook` | URL | HMAC secret | `POST` JSON, signed (below) |
| `apprise` | apprise-api URL, key of a stored configuration (optional) | the Apprise URLs, when there is no key (they hold the services' tokens) | `POST <url>/notify/<key>`, or `POST <url>/notify` with `urls`; title, body and link as text |

**Webhook signature:** the body is the JSON
`{ "type": "notification" | "digest" | "test", "sent_at", "language", "title", "body", "url", "notifications": [...] }`.
The request carries `X-Open-Parcels-Timestamp: <unix seconds>` and
`X-Open-Parcels-Signature: sha256=<hex>`, the HMAC-SHA256 with the configured secret of
`<timestamp>.<body>`. A receiver recomputes it over the raw body, compares in constant time and
rejects a timestamp more than five minutes off.

## 6. Manifest and sandbox

```json
{
  "schema": 1,
  "id": "ntfy",
  "name": "ntfy",
  "description": "Push notifications to an ntfy topic, with a link to the parcel.",
  "fields": ["tracking_number", "carrier", "expected_delivery"],
  "permissions": {
    "network": [{ "config": "server", "reason": "The ntfy server the user chose." }],
    "smtp": false
  }
}
```

- `fields`: the parcel fields beyond the texts: `tracking_number`, `carrier`, `items`, `shop`,
  `pickup_point`, `expected_delivery`. Positions cannot be asked for.
- `permissions.network`: as a provider's (§1 of
  [`provider-manifest-and-sandbox.md`](provider-manifest-and-sandbox.md)). Usually `config`
  entries: the hosts are the user's own servers, so unlike a provider's hosts they may be private
  addresses; the allow-list is checked for every request, redirects are not followed.
- `permissions.smtp`: only the built-in email consumer; an installed consumer gets `http` only.
- **Installed consumers** (with the registry, P3/P4) always run in the sandbox: a
  `sandboxedConsumer` sends `deliver`/`test` to the guest with the config and secret of that call,
  and grants `http` alone, answered by the same allow-listed transport. The built-ins run in the
  core; the HTTP ones only use `call.http`, so they would run unchanged in the sandbox.

## 7. Not built yet

Installing consumers from repositories (with the registry), MQTT/Gotify/Matrix/Telegram, the
return-by reminder (needs a schedule, not a live event), the Android app registering its
UnifiedPush endpoint as an ntfy consumer (decision record 0004).
