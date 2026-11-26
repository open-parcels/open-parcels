import { admin } from "./de/admin";
import { calendar } from "./de/calendar";
import { common } from "./de/common";
import { connections } from "./de/connections";
import { consumers } from "./de/consumers";
import { errors } from "./de/errors";
import { jobs } from "./de/jobs";
import { map } from "./de/map";
import { orders } from "./de/orders";
import { parcels } from "./de/parcels";
import { returns } from "./de/returns";
import { serverSettings } from "./de/server-settings";
import { settings } from "./de/settings";
import { shell } from "./de/shell";
import type { Messages } from "./messages";

/** German texts. UI terms follow the German column of `docs/glossary.md`. */
export const de: Messages = {
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
