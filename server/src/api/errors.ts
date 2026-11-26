import { z } from "zod";

/**
 * Every error code the API sends. Clients show their own text per code (the web UI has one per
 * language in `web/src/i18n/*\/errors.ts`); `message` is an English explanation for logs and
 * scripts, and `params` carries the values a client text needs.
 */
const ERROR_CODES = [
  "unauthorized",
  "forbidden",
  "csrf",
  "admin_required",
  "not_found",
  "invalid_request",
  "internal",
  "invalid_range",
  "carrier_not_detected",
  "duplicate",
  "backup_failed",
  "delete_backup_failed",
  "confirmation_required",
  "invalid_setting",
  "geocode_failed",
  "tile",
  "image",
  "too_many_attempts",
  "current_required",
  "invalid_password",
  "no_environment_password",
  "already_set_up",
  "bad_setup_code",
  "wrong_password",
  "login_ended",
  "sync_expired",
  "invalid_connection",
  "connection_backing_off",
  "sign_in_expired",
  "sign_in_timeout",
  "sign_in_refused",
  "sign_in_failed",
  "sign_in_wrong_step",
  "sign_in_poll_too_soon",
  "sign_in_unavailable",
  "sign_in_captcha",
  "no_sign_in",
  "no_such_action",
  "action_unavailable",
  "action_cooldown",
  "invalid_input",
  "job_running",
  "job_state",
  "invalid_consumer",
  "install_refused",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** What `not_found` was about (`params.resource`). */
export type NotFoundResource =
  | "route"
  | "connection"
  | "order"
  | "parcel"
  | "return"
  | "token"
  | "login"
  | "calendar_feed"
  | "sign_in"
  | "setting"
  | "pictures"
  | "job"
  | "consumer";

export type ErrorParams = Readonly<Record<string, string | number>>;

/** An error whose message is safe to show to API clients. */
export class ApiError extends Error {
  override readonly name = "ApiError";

  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly params: ErrorParams = {},
  ) {
    super(message);
  }
}

export const errorBodySchema = z.object({
  error: z.enum(ERROR_CODES).describe("Stable machine-readable error code."),
  message: z.string().describe("English explanation, for logs and scripts."),
  params: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .describe(
      "Values a client's own text for the code needs, e.g. `resource` for `not_found`, `seconds` for `too_many_attempts`, `detail` for a carrier's or validator's own words.",
    ),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;

export const unauthorized = (): ApiError =>
  new ApiError(401, "unauthorized", "Sign in or send a valid API token.");
export const forbidden = (scope: string): ApiError =>
  new ApiError(403, "forbidden", `This needs the "${scope}" scope.`, { scope });

const NOT_FOUND_TEXT: Readonly<Record<NotFoundResource, string>> = {
  route: "This address",
  connection: "The connection",
  order: "The order",
  parcel: "The parcel",
  return: "The return",
  token: "The token",
  login: "The login",
  calendar_feed: "This calendar feed",
  sign_in: "The sign-in attempt",
  setting: "The setting",
  pictures: "The item pictures",
  job: "The job",
  consumer: "The consumer",
};
export const notFound = (resource: NotFoundResource): ApiError =>
  new ApiError(404, "not_found", `${NOT_FOUND_TEXT[resource]} was not found.`, { resource });

/** The body for a path no route serves. */
export const routeNotFound = (method: string, url: string): ErrorBody => ({
  error: "not_found",
  message: `Route ${method} ${url} not found.`,
  params: { resource: "route" },
});
