import { z } from "zod";

/**
 * Why the database does not answer, as a code; clients show their own text and the server log has
 * the error. `busy`: another process holds a lock. `corrupt`: the file is damaged or no database.
 * `no_space`: the disk is full. `read_only`: the file or its folder may not be written.
 * `cannot_open`: the file cannot be opened (missing folder, permissions). `failed`: anything else.
 */
const DATABASE_ERRORS = [
  "busy",
  "corrupt",
  "no_space",
  "read_only",
  "cannot_open",
  "failed",
] as const;
export type DatabaseError = (typeof DATABASE_ERRORS)[number];

export const databaseErrorSchema = z
  .enum(DATABASE_ERRORS)
  .nullable()
  .describe(
    "Why the database does not answer, as a code (the server log has the details); null when it answers.",
  );

/** SQLite's primary result codes (extended codes such as `SQLITE_BUSY_SNAPSHOT` share them). */
const BY_SQLITE_CODE: Readonly<Record<string, DatabaseError>> = {
  SQLITE_BUSY: "busy",
  SQLITE_LOCKED: "busy",
  SQLITE_CORRUPT: "corrupt",
  SQLITE_NOTADB: "corrupt",
  SQLITE_FULL: "no_space",
  SQLITE_READONLY: "read_only",
  SQLITE_CANTOPEN: "cannot_open",
  SQLITE_PERM: "cannot_open",
};

/** The code for an error thrown by the database driver. */
export function databaseError(error: unknown): DatabaseError {
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "";
  const primary = /^SQLITE_[A-Z]+/u.exec(code)?.[0] ?? "";
  return BY_SQLITE_CODE[primary] ?? "failed";
}
