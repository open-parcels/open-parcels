import type { ErrorParams } from "../api/fetcher";
import type { BackupError, ErrorCode } from "../api/types";
import { formatNumber } from "../lib/locale";

/** A text value the server sent with an error; empty when it is missing. */
export function param(params: ErrorParams, key: string): string {
  const value = params[key];
  if (value === undefined) return "";
  return typeof value === "number" ? formatNumber(value) : value;
}

/** A detail (a carrier's or validator's own words) appended in parentheses when there is one. */
export function withDetail(text: string, params: ErrorParams): string {
  const detail = param(params, "detail");
  return detail === "" ? text : `${text} (${detail})`;
}

export type ErrorText = (params: ErrorParams) => string;

/** The text for the backup error code in `params.error`; the general one for an unknown code. */
export function backupErrorText(
  texts: Readonly<Record<BackupError, string>>,
  params: ErrorParams,
): string {
  const code = param(params, "error");
  return (texts as Readonly<Record<string, string | undefined>>)[code] ?? texts.failed;
}

/** One text per server error code, and one for an answer without a code (a proxy's page). */
export interface ErrorTexts {
  readonly byCode: Readonly<Record<ErrorCode, ErrorText>>;
  readonly http: (status: number) => string;
}

/** The text for the value of `params[key]`, or the fallback for a value the table lacks. */
export function pick<K extends string>(
  table: Readonly<Record<K, ErrorText>>,
  key: string,
  fallback: string,
): ErrorText {
  return (params) => {
    const chosen = (table as Readonly<Record<string, ErrorText | undefined>>)[param(params, key)];
    return chosen === undefined ? fallback : chosen(params);
  };
}

// The values below mirror the server's lists (`server/src/api/errors.ts`, `config.ts`,
// `engine/registry.ts`, `auth/access.ts`); a value the UI lacks falls back to a general text.
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
export type InvalidConnectionReason =
  | "inbox_kind"
  | "inbox_fields"
  | "unknown_provider"
  | "no_such_kind"
  | "secret_mismatch"
  | "invalid_fields"
  | "no_such_sign_in"
  | "no_tracking_provider"
  | "provider";
export type SettingProblem =
  "unknown" | "own_form" | "env_only" | "required" | "too_short" | "wrong_type" | "invalid";
export type PasswordProblem = "wrong_current" | "too_short";
