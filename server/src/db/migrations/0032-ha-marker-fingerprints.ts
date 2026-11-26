import { sql, type Kysely } from "kysely";

/**
 * When the HA importer started keying its credential fingerprint (an HMAC under the instance's
 * secret instead of a plain SHA-256 prefix). The importer writes `updated_at` with every marker, so a
 * marker last written before this moment holds an unkeyed fingerprint.
 */
const KEYED_SINCE = "2026-11-19T09:38:19.000Z";

/**
 * Home Assistant import markers (`settings` keys `ha_import:<entry>`) with an unkeyed fingerprint.
 *
 * They cannot be re-keyed: the fingerprint is a hash of the sign-in data as Home Assistant had it,
 * and that is not in the database (the connection's own blobs may hold tokens rotated since). Nor
 * can the marker simply be deleted: a re-run of the importer would then create a second connection
 * for the same entry. So the fingerprint is dropped and the marker becomes an adopted one, which the
 * importer never rewrites: a re-run keeps the connection, its label and its tokens as they are. What
 * this gives up is carrying a changed Home Assistant sign-in over on a re-run; the user signs in
 * again in the web UI instead, which is the safer outcome for tokens the connection may have
 * rotated. Markers that are not JSON objects, have no `connectionId` or are adopted already are left
 * alone. Markers written later already carry the keyed form.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const rows = await sql<{ key: string; value: string }>`
    select key, value from settings where key like 'ha_import:%' and updated_at < ${KEYED_SINCE}
  `.execute(db);
  for (const row of rows.rows) {
    let stored: unknown;
    try {
      stored = JSON.parse(row.value);
    } catch {
      continue;
    }
    if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
      continue;
    }
    const marker = stored as Record<string, unknown>;
    if (typeof marker["connectionId"] !== "string" || marker["adopted"] === true) {
      continue;
    }
    const value = JSON.stringify({
      connectionId: marker["connectionId"],
      credentials: "",
      adopted: true,
    });
    await sql`update settings set value = ${value} where key = ${row.key}`.execute(db);
  }
}
