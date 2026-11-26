/** Friendly names for the generated API types. */
import type {
  GetApiV1Calendar200Item,
  GetApiV1Carriers200Item,
  GetApiV1Orders200Item,
  GetApiV1OrdersView,
  GetApiV1Parcels200Item,
  GetApiV1ParcelsId200,
  GetApiV1Returns200Item,
  GetApiV1ReturnsView,
  GetApiV1Status200,
  GetApiV1Connections200Item,
  GetApiV1Consumers200Item,
  GetApiV1ConsumersAvailable200Item,
  GetApiV1ProvidersAvailable200ItemsItem,
  GetApiV1ProvidersInstalled200ItemsItem,
  PostApiV1ProvidersCheck200,
  PostApiV1ProvidersInstallBodySource,
  GetApiV1Jobs200Item,
  GetApiV1ConnectionsIdSignInFlows200Item,
  GetApiV1Tokens200Item,
  PostApiV1ConnectionsIdSignInAttemptsAttemptContinue200,
  PostApiV1Session401Error,
} from "./generated";
import { listingEvery } from "../lib/exhaustive";

/** Every error code the server sends (each error body has the same list). */
export type ErrorCode = PostApiV1Session401Error;
export type Parcel = GetApiV1Parcels200Item;
export type ParcelDetail = GetApiV1ParcelsId200;
export type ParcelStatus = Parcel["status"];
export type LookupState = Parcel["lookup"]["state"];
export type Carrier = GetApiV1Carriers200Item;
export type Connection = GetApiV1Connections200Item;
export type CarrierAction = Carrier["actions"][number];
export type Job = GetApiV1Jobs200Item;
export type JobState = Job["state"];
export type ConnectionState = Connection["state"];
export type StateReason = NonNullable<Connection["state_reason"]>;
export type SchedulerError = NonNullable<GetApiV1Status200["scheduler"]["last_error"]>;
export type BackupError = NonNullable<GetApiV1Status200["backups"]["last_error"]>;
export type DatabaseError = NonNullable<GetApiV1Status200["database"]["error"]>;
export type SignInFlow = GetApiV1ConnectionsIdSignInFlows200Item;
export type SignInResult = PostApiV1ConnectionsIdSignInAttemptsAttemptContinue200;
export type SignInStepResult = Extract<SignInResult, { status: "step" }>;
export type SignInStep = SignInStepResult["step"];
export type ApiToken = GetApiV1Tokens200Item;
export type CalendarEntry = GetApiV1Calendar200Item;
export type Order = GetApiV1Orders200Item;
export type OrderStatus = Order["status"];
export type OrderView = GetApiV1OrdersView;
export type Return = GetApiV1Returns200Item;
export type ReturnStatus = Return["status"];
export type ReturnView = GetApiV1ReturnsView;
export type ConsumerSetup = GetApiV1Consumers200Item;
export type AvailableConsumer = GetApiV1ConsumersAvailable200Item;
export type NotificationRules = ConsumerSetup["rules"];
export type NotificationEvent = NotificationRules["events"][number];
export type Digest = NotificationRules["digest"];

export const PARCEL_STATUSES = listingEvery<ParcelStatus>()([
  "registered",
  "in_transit",
  "out_for_delivery",
  "at_pickup_point",
  "delivered",
  "returning",
  "problem",
  "unknown",
]);

/** The Providers page (decision record 0002 §2.8). */
export type InstalledItem = GetApiV1ProvidersInstalled200ItemsItem;
export type AvailableItem = GetApiV1ProvidersAvailable200ItemsItem;
export type InstallOffer = PostApiV1ProvidersCheck200;
export type InstallSource = PostApiV1ProvidersInstallBodySource;
export type InstallKind = InstalledItem["kind"];
