import { admin } from "./en/admin";
import { calendar } from "./en/calendar";
import { common } from "./en/common";
import { connections } from "./en/connections";
import { consumers } from "./en/consumers";
import { errors } from "./en/errors";
import { jobs } from "./en/jobs";
import { map } from "./en/map";
import { orders } from "./en/orders";
import { parcels } from "./en/parcels";
import { returns } from "./en/returns";
import { serverSettings } from "./en/server-settings";
import { settings } from "./en/settings";
import { shell } from "./en/shell";

/**
 * Every text of the web UI, in English; the source of truth for the shape. One file per area
 * under `en/` and `de/`. A text with values is a function; plurals go through `plural`.
 */
export const en = {
  common,
  shell,
  parcels,
  connections,
  consumers,
  jobs,
  settings,
  serverSettings,
  admin,
  orders,
  returns,
  calendar,
  map,
  errors,
};

/** The shape every language provides: the German dictionary is checked against it. */
export type Messages = typeof en;
