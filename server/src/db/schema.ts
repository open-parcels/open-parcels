import type { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely";
import type { StateReason } from "../engine/state-reason.js";

/**
 * Row types for Kysely. Conventions:
 * - timestamps are ISO-8601 UTC strings (`...Z`);
 * - booleans are 0/1 integers, as SQLite has no boolean type;
 * - JSON columns are TEXT holding serialised JSON;
 * - encrypted columns are BLOBs produced by SecretBox.
 */
type Bool = 0 | 1;
type Timestamp = string;

interface OwnerTable {
  id: ColumnType<1, 1, never>;
  password_hash: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

interface SessionTable {
  /** SHA-256 of the session cookie value; the raw value is never stored. */
  id_hash: string;
  csrf_token: string;
  created_at: Timestamp;
  expires_at: Timestamp;
  last_seen_at: Timestamp;
  user_agent: string | null;
  /** `admin` or `reader`; see migration 0012. */
  role: string;
}

interface ApiTokenTable {
  id: string;
  name: string;
  /** SHA-256 of the token; the raw value is shown once at creation. */
  token_hash: string;
  /** JSON array of scopes. */
  scopes: string;
  created_at: Timestamp;
  last_used_at: Timestamp | null;
  expires_at: Timestamp | null;
}

/** A token login of a client without cookies. See migration 0026. */
export interface LoginTable {
  id: string;
  /** What the client called itself, e.g. "Android app on Pixel 8". */
  name: string;
  /** `admin` or `reader`. */
  role: string;
  /** SHA-256 of the current access token. */
  access_hash: string;
  access_expires_at: Timestamp;
  /** SHA-256 of the current refresh token. */
  refresh_hash: string;
  /** SHA-256 of the refresh token the last refresh replaced: presenting it again ends the login. */
  previous_refresh_hash: string | null;
  refresh_expires_at: Timestamp;
  created_at: Timestamp;
  last_used_at: Timestamp;
}

interface SettingTable {
  key: string;
  /** JSON value. */
  value: string;
  updated_at: Timestamp;
}

export interface ConnectionTable {
  id: string;
  provider: string;
  kind: "account" | "tracking" | "shop" | "mail";
  label: string;
  /** JSON, non-secret provider configuration. */
  config: string;
  secret_blob: Buffer | null;
  session_blob: Buffer | null;
  /** `idle`: the last run deliberately did nothing; `state_reason` and `carrier_message` say why. */
  state: "ok" | "idle" | "needs_sign_in" | "error" | "disabled";
  /** A `StateReason` code (`engine/state-reason.ts`). */
  state_reason: StateReason | null;
  /** The provider's or carrier's own words about the state, passed through as written. */
  carrier_message: string | null;
  consecutive_failures: Generated<number>;
  backoff_until: Timestamp | null;
  next_run_at: Timestamp | null;
  last_run_at: Timestamp | null;
  last_ok_at: Timestamp | null;
  /** 1 when the server made this keyless tracking connection on its own; see migration 0006. */
  auto_created: Generated<number>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface OrderTable {
  id: string;
  shop: string;
  order_number: string;
  placed_at: Timestamp | null;
  status: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  /** The owner's name for the order; null for the shop's. See migration 0010. */
  label: ColumnType<string | null, string | null | undefined>;
  /** Null while archiving is automatic; `archived` or `kept` when the owner decided. */
  archive_mode: ColumnType<"archived" | "kept" | null, "archived" | "kept" | null | undefined>;
  /** When the owner archived the order. */
  archived_at: ColumnType<Timestamp | null, Timestamp | null | undefined>;
  /** Set when the owner deleted the order: kept as a tombstone so a shop cannot re-create it. */
  deleted_at: ColumnType<Timestamp | null, Timestamp | null | undefined>;
  /** Last day of the shop's return window (`YYYY-MM-DD`), when it lists one. See migration 0018. */
  return_until: ColumnType<string | null, string | null | undefined>;
  /** The total an email stated, and who stated it (`shop` wins over `payment`). See 0021. */
  total_amount: ColumnType<number | null, number | null | undefined>;
  total_currency: ColumnType<string | null, string | null | undefined>;
  total_source: ColumnType<"shop" | "payment" | null, "shop" | "payment" | null | undefined>;
  /** When an import job created the order; null for one a run or an email started. See 0030. */
  imported_at: ColumnType<Timestamp | null, Timestamp | null | undefined>;
}

interface ParcelTable {
  id: string;
  carrier: string;
  tracking_number: string;
  direction: "receiving" | "sending";
  status: string;
  raw_status: string | null;
  delivered: Bool;
  delivered_at: Timestamp | null;
  expected_from: Timestamp | null;
  expected_to: Timestamp | null;
  pickup: Bool;
  pickup_point: string | null;
  url: string | null;
  sender: string | null;
  receiver: string | null;
  weight_kg: number | null;
  label: string | null;
  order_id: string | null;
  manual_status: string | null;
  /** When the owner set `manual_status`. See migration 0016. */
  manual_at: ColumnType<Timestamp | null, Timestamp | null | undefined>;
  /** Time of the newest scan that set `status`; null when no scan carried a time. */
  status_at: ColumnType<Timestamp | null, Timestamp | null | undefined>;
  first_seen_at: Timestamp;
  last_seen_at: Timestamp;
  updated_at: Timestamp;
  removed_at: Timestamp | null;
  archived_at: Timestamp | null;
  /** Why the server archived the parcel on its own; null for retention or a user's archive. */
  archive_reason: ColumnType<string | null, string | null | undefined>;
  /** When an import job created the parcel; retention never deletes it. See migration 0030. */
  imported_at: ColumnType<Timestamp | null, Timestamp | null | undefined>;
  /** What a carrier last said about the code: pending (never answered), found or not_found. */
  lookup_state: ColumnType<
    "pending" | "found" | "not_found",
    "pending" | "found" | "not_found" | undefined
  >;
  /** When the current lookup state began. */
  lookup_since: ColumnType<Timestamp | null, Timestamp | null | undefined>;
  /** When a carrier was last asked about the code. */
  lookup_checked_at: ColumnType<Timestamp | null, Timestamp | null | undefined>;
}

interface ParcelConnectionTable {
  parcel_id: string;
  connection_id: string;
  external_ref: string | null;
  role: "primary" | "handoff" | "mail";
  last_seen_at: Timestamp;
  /** First time a complete listing of this connection lacked the parcel; null while it is listed. */
  missing_since: ColumnType<Timestamp | null, Timestamp | null | undefined>;
}

/** Which connections reported an order. See migration 0015. */
interface OrderConnectionTable {
  order_id: string;
  connection_id: string;
}

/** One return of an order. See migration 0018. */
export interface ReturnTable {
  id: string;
  order_id: string;
  external_ref: string | null;
  status: string;
  reason: string | null;
  /** `YYYY-MM-DD`, the server's local day. */
  return_by: string | null;
  /** JSON array of `{carrier, kind, description}`. */
  drop_off: string;
  cost_free: Bool | null;
  cost_amount: number | null;
  cost_currency: string | null;
  label_url: string | null;
  carrier: string | null;
  tracking_number: string | null;
  parcel_id: string | null;
  refund_amount: number | null;
  refund_currency: string | null;
  refund_status: "pending" | "issued" | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

interface ReturnConnectionTable {
  return_id: string;
  connection_id: string;
}

interface ReturnItemTable {
  id: Generated<number>;
  return_id: string;
  position: number;
  title: string;
  order_item_id: number | null;
}

interface ParcelEventTable {
  id: Generated<number>;
  parcel_id: string;
  connection_id: string | null;
  at: Timestamp;
  status: string | null;
  raw_status: string;
  location_text: string | null;
  /** Where the scan happened, when the carrier says; both set or both null. */
  latitude: ColumnType<number | null, number | null | undefined>;
  longitude: ColumnType<number | null, number | null | undefined>;
  /** 1 when the coordinates were looked up from `location_text` (approximate). See 0013. */
  geocoded: ColumnType<number, number | undefined, number>;
  /** Hash of (at, raw_status, location) so a re-fetched history never duplicates entries. */
  fingerprint: string;
  /** Set by a trigger on every change (see `db/sync-triggers.ts`). */
  updated_at: ColumnType<Timestamp, never, never>;
}

/** The newest change of each synced entity, and tombstones. See migration 0027. */
export interface SyncChangeTable {
  seq: Generated<number>;
  entity: "parcel" | "event" | "order" | "return" | "connection";
  entity_id: string;
  deleted: Bool;
  changed_at: Timestamp;
}

interface ParcelRawTable {
  parcel_id: string;
  connection_id: string;
  fetched_at: Timestamp;
  payload: string;
}

interface ItemTable {
  id: Generated<number>;
  parcel_id: string;
  position: number;
  title: string;
  image_ref: string | null;
  url: string | null;
  external_id: string | null;
  quantity: number | null;
  price: number | null;
  currency: string | null;
}

/** What was ordered; `parcel_id` once it is known which parcel carries it. */
export interface OrderItemTable {
  id: Generated<number>;
  order_id: string;
  position: number;
  title: string;
  image_ref: string | null;
  url: string | null;
  external_id: string | null;
  quantity: number | null;
  price: number | null;
  currency: string | null;
  parcel_id: string | null;
}

interface LiveStateTable {
  parcel_id: string;
  /** The connection following the session; only its runs may end it. See migration 0022. */
  connection_id: string;
  state: "en_route" | "next_stop" | "delivered" | "ended";
  stops_away: number | null;
  message: string | null;
  position_at: Timestamp | null;
  updated_at: Timestamp;
}

/** Place-name lookups, keyed by the normalised name. See migration 0014. */
interface PlaceTable {
  key: string;
  /** JSON array of the places the name may stand for, best first; `[]` when none was found. */
  candidates: string;
  looked_at: Timestamp;
}

interface OutboxTable {
  seq: Generated<number>;
  type: string;
  parcel_id: string | null;
  payload: string;
  created_at: Timestamp;
}

interface UnknownVocabTable {
  provider: string;
  kind: string;
  key: string;
  first_seen_at: Timestamp;
  last_seen_at: Timestamp;
  count: number;
}

interface SignInAttemptTable {
  id: string;
  connection_id: string;
  flow: string;
  /** Encrypted JSON {state, step}; the AAD binds it to the attempt and the connection. */
  blob: Buffer;
  failures: Generated<number>;
  created_at: Timestamp;
  expires_at: Timestamp;
  /** Set while the step waits for an approval: polls before this are refused. */
  poll_not_before: Timestamp | null;
}

/** A connection action's job. See migration 0029 and `docs/connection-actions-and-jobs.md`. */
export interface JobTable {
  id: string;
  connection_id: string;
  provider: string;
  action: string;
  /** JSON, the validated input. */
  input: string;
  state: "queued" | "running" | "paused" | "done" | "partial" | "failed" | "cancelled";
  /** Why it is paused or failed (`rate_limited`, `captcha`, `needs_sign_in`, …), else null. */
  reason: string | null;
  /** JSON `{done, total, phase}`. */
  progress: string;
  /** The provider's checkpoint, encrypted with the job's id as associated data. */
  checkpoint_blob: Buffer | null;
  summary: string | null;
  /** Transient failures in a row; reset by every emitted batch. */
  retries: Generated<number>;
  created_at: Timestamp;
  started_at: Timestamp | null;
  updated_at: Timestamp;
  finished_at: Timestamp | null;
  /** When a paused job is queued again on its own; null: only by hand. */
  resume_at: Timestamp | null;
}

/** A configured consumer. See migration 0031 and `docs/consumers.md`. */
/** An installed provider, theme or consumer (`installs/service.ts`); built-in ones have no row. */
interface InstallTable {
  kind: string;
  id: string;
  name: string;
  /** `verified`, `custom` or `community`. */
  tier: string;
  repository: string;
  folder: string;
  version: string;
  /** The full commit it is pinned to. */
  commit: string;
  auto_update: number;
  installed_at: Timestamp;
  updated_at: Timestamp;
}

interface ConsumerTable {
  id: string;
  /** The consumer's id (`ntfy`, `email`, …). */
  consumer: string;
  label: string;
  /** JSON, checked against the consumer's config schema. */
  config: string;
  /** The encrypted secret JSON (token, password, signing secret); the AAD is the row's id. */
  secret_blob: Buffer | null;
  /** JSON `NotificationRules`. */
  rules: string;
  enabled: number;
  created_at: Timestamp;
  updated_at: Timestamp;
  last_attempt_at: Timestamp | null;
  last_ok_at: Timestamp | null;
  /** Why the last attempt did not deliver; null after a success. */
  last_error: string | null;
}

/** One parcel state change (or sign-in or backup problem), stored once by its key. */
interface NotificationTable {
  id: Generated<number>;
  key: string;
  event: string;
  /** JSON `NotificationData`: no courier position. */
  data: string;
  created_at: Timestamp;
}

/** One notification for one configured consumer. */
interface NotificationDeliveryTable {
  notification_id: number;
  consumer_id: string;
  state: "pending" | "sent" | "failed" | "expired";
  attempts: Generated<number>;
  due_at: Timestamp;
  created_at: Timestamp;
  finished_at: Timestamp | null;
}

export interface Database {
  owner: OwnerTable;
  sessions: SessionTable;
  api_tokens: ApiTokenTable;
  logins: LoginTable;
  settings: SettingTable;
  /** OPENPARCELS_* values saved in the UI; same shape as `settings`. See migration 0011. */
  setting_overrides: SettingTable;
  connections: ConnectionTable;
  orders: OrderTable;
  parcels: ParcelTable;
  parcel_connections: ParcelConnectionTable;
  order_connections: OrderConnectionTable;
  returns: ReturnTable;
  return_connections: ReturnConnectionTable;
  return_items: ReturnItemTable;
  parcel_events: ParcelEventTable;
  order_items: OrderItemTable;
  parcel_raw: ParcelRawTable;
  items: ItemTable;
  live_state: LiveStateTable;
  places: PlaceTable;
  outbox: OutboxTable;
  unknown_vocab: UnknownVocabTable;
  sign_in_attempts: SignInAttemptTable;
  sync_changes: SyncChangeTable;
  jobs: JobTable;
  consumers: ConsumerTable;
  installs: InstallTable;
  notifications: NotificationTable;
  notification_deliveries: NotificationDeliveryTable;
}

export type ConsumerRow = Selectable<ConsumerTable>;

export type JobRow = Selectable<JobTable>;

export type ParcelRow = Selectable<ParcelTable>;
export type NewParcelRow = Insertable<ParcelTable>;
export type ParcelUpdate = Updateable<ParcelTable>;
export type ConnectionRow = Selectable<ConnectionTable>;
export type OutboxRow = Selectable<OutboxTable>;
