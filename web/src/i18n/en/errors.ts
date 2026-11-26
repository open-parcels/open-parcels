import { admin } from "./admin";
import {
  backupErrorText,
  param,
  pick,
  withDetail,
  type ErrorText,
  type ErrorTexts,
  type InvalidConnectionReason,
  type NotFoundResource,
  type PasswordProblem,
  type SettingProblem,
} from "../params";

const NOT_FOUND: Readonly<Record<NotFoundResource, ErrorText>> = {
  route: () => "This address does not exist.",
  connection: () => "The connection was not found.",
  order: () => "The order was not found.",
  parcel: () => "The parcel was not found.",
  return: () => "The return was not found.",
  token: () => "The token was not found.",
  login: () => "The login was not found.",
  calendar_feed: () => "This calendar feed does not exist.",
  sign_in: () => "The sign-in was not found. Start it again.",
  setting: () => "There is no such setting.",
  pictures: () => "There are no item pictures.",
  job: () => "The job was not found.",
  consumer: () => "The consumer was not found.",
};

const INVALID_CONNECTION: Readonly<Record<InvalidConnectionReason, ErrorText>> = {
  inbox_kind: () => "Inboxes are added with the inbox form.",
  inbox_fields: () => "The inbox needs a server, a username and a password.",
  unknown_provider: (p) => `There is no provider called ${param(p, "provider")}.`,
  no_such_kind: (p) => `${param(p, "provider")} cannot be used this way.`,
  secret_mismatch: (p) => `The sign-in data does not fit ${param(p, "provider")}.`,
  invalid_fields: (p) => `Check these fields: ${param(p, "fields")}.`,
  no_such_sign_in: (p) => `${param(p, "provider")} has no such sign-in.`,
  no_tracking_provider: (p) => `There is no provider that tracks ${param(p, "provider")}.`,
  provider: (p) => withDetail("The connection's settings cannot work.", p),
};

const INVALID_SETTING: Readonly<Record<SettingProblem, ErrorText>> = {
  unknown: (p) => `${param(p, "key")}: there is no such setting.`,
  own_form: (p) => `${param(p, "key")}: change it with its own form.`,
  env_only: (p) => `${param(p, "key")}: can only be set in the environment.`,
  required: (p) =>
    `${param(p, "key")}: a value is required. Reset the setting to go back to the environment or default.`,
  too_short: (p) => `${param(p, "key")}: use at least ${param(p, "min")} characters.`,
  wrong_type: (p) => `${param(p, "key")}: enter text, a number or yes/no.`,
  invalid: (p) => withDetail(`${param(p, "key")}: this value is not valid.`, p),
};

const INVALID_PASSWORD: Readonly<Record<PasswordProblem, ErrorText>> = {
  wrong_current: () => "The current admin password is wrong.",
  too_short: (p) => `Use at least ${param(p, "min")} characters.`,
};

/** English texts for the server's error codes; `params` are the values it sent along. */
export const errors: ErrorTexts = {
  byCode: {
    unauthorized: () => "Log in again.",
    forbidden: (p) => `This needs the "${param(p, "scope")}" permission.`,
    csrf: () => "The page is out of date. Reload it and try again.",
    admin_required: () => "Only the admin may change anything. Log in with the admin password.",
    not_found: pick(NOT_FOUND, "resource", "It was not found."),
    invalid_request: (p) => withDetail("The request is invalid.", p),
    internal: () => "Something went wrong on the server.",
    invalid_range: () => "Use a range that ends after it starts and spans at most 400 days.",
    carrier_not_detected: () =>
      "The carrier could not be detected from this tracking number. Choose one, or add a fallback service (Universal lookup, 17TRACK).",
    duplicate: () => "This parcel is already tracked.",
    backup_failed: (p) => `The backup failed: ${backupErrorText(admin.backupErrors, p)}`,
    delete_backup_failed: (p) =>
      `Nothing was deleted: the backup before deleting failed. ${backupErrorText(admin.backupErrors, p)}`,
    confirmation_required: (p) =>
      `Type ${param(p, "phrase")} to confirm deleting every parcel and order.`,
    invalid_setting: pick(INVALID_SETTING, "reason", "This value is not valid."),
    geocode_failed: (p) => withDetail("The place lookup failed.", p),
    tile: () => "The map tile could not be loaded.",
    image: () => "The picture could not be loaded.",
    too_many_attempts: (p) =>
      `Too many failed attempts. Try again in ${param(p, "seconds")} seconds.`,
    current_required: () => "Enter the current admin password.",
    invalid_password: pick(INVALID_PASSWORD, "reason", "This password cannot be used."),
    no_environment_password: () =>
      "There is no OPENPARCELS_ADMIN_PASSWORD in the environment to fall back to; change the password instead.",
    already_set_up: () => "The admin password is already set.",
    bad_setup_code: () => "The setup code does not match the one in the container log.",
    wrong_password: () => "That password is not correct.",
    login_ended: () => "The login has ended. Log in again.",
    sync_expired: () => "This copy is too old to update. Load everything again.",
    invalid_connection: pick(
      INVALID_CONNECTION,
      "reason",
      "The connection's settings cannot work.",
    ),
    connection_backing_off: (p) =>
      `The carrier asked us to wait; this connection runs again in ${param(p, "seconds")} seconds.`,
    sign_in_expired: () => "This sign-in has expired. Start it again.",
    sign_in_timeout: () => "The approval did not arrive in time. Start again.",
    sign_in_refused: () => "The carrier refused that. Check it and try again.",
    sign_in_failed: () => "That did not work. Check what you entered and try again.",
    sign_in_wrong_step: () => "This step has moved on. Continue with the current step.",
    sign_in_poll_too_soon: () => "Wait a moment before checking again.",
    sign_in_unavailable: () =>
      "The carrier could not be reached. Your sign-in is kept; try the same step again.",
    sign_in_captcha: () =>
      "The carrier showed a captcha. Your sign-in is kept; wait a while, then try the same step again.",
    no_sign_in: () => "This connection has no such sign-in.",
    no_such_action: () => "This connection has no such action.",
    action_unavailable: () => "This action cannot start now (check the connection's state).",
    action_cooldown: (p) =>
      `This action ran a short while ago; try again in ${param(p, "seconds")} seconds.`,
    invalid_input: (p) => withDetail("Check what you entered.", p),
    job_running: () => "This connection is busy with a job already.",
    job_state: () => "The job cannot do that in its current state.",
    invalid_consumer: (p) => withDetail("Check the consumer's settings and rules.", p),
  },
  http: (status) => `The server answered with error ${String(status)}.`,
};
