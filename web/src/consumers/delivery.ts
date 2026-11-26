import { formatRelative } from "../lib/format";
import { t } from "../i18n";

/** A consumer's last delivery, on its card and on the Status page. */
export function lastDelivery(consumer: {
  readonly last_ok_at: string | null;
  readonly last_error: string | null;
}): string {
  if (consumer.last_error !== null) return t.consumers.lastError(consumer.last_error);
  return consumer.last_ok_at === null
    ? t.consumers.never
    : t.consumers.lastOk(formatRelative(consumer.last_ok_at));
}
