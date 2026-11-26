/** A return as the order page and the Returns list show it. */
import { Link } from "@tanstack/react-router";
import { Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { ProviderName, useProviderNames } from "../components/CarrierLogo";
import type { ParcelStatus, Return, ReturnStatus } from "../api/types";
import { t } from "../i18n";
import { formatMoney } from "../lib/format";
import { UI_LOCALE } from "../lib/locale";

const RETURN_STATUS_LABELS: Readonly<Record<ReturnStatus, string>> = t.returns.status;

/** The parcel status whose colour a return status borrows. */
const STATUS_COLOUR: Readonly<Record<ReturnStatus, ParcelStatus>> = {
  requested: "registered",
  label_created: "registered",
  dropped_off: "in_transit",
  in_transit: "in_transit",
  received: "out_for_delivery",
  refunded: "delivered",
  rejected: "problem",
  cancelled: "unknown",
  expired: "problem",
};

const KIND_LABELS: Readonly<Record<Return["drop_off"][number]["kind"], string>> = t.returns.kinds;

/** A `YYYY-MM-DD` day in words, read as that local day (never shifted by the time zone). */
export function formatDay(day: string): string {
  const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(UI_LOCALE, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, date));
}

/** "Free return", "Return costs 4,99 €", or null when not known. */
export function costLabel(cost: Return["cost"]): string | null {
  if (cost === null) return null;
  if (cost.free) return t.returns.free;
  return cost.amount === null
    ? t.returns.costsMoney
    : t.returns.costs(formatMoney(cost.amount, cost.currency));
}

function refundLabel(refund: Return["refund"]): string | null {
  if (refund === null) return null;
  const amount = refund.amount === null ? null : formatMoney(refund.amount, refund.currency);
  return refund.status === "issued" ? t.returns.refunded(amount) : t.returns.refundExpected(amount);
}

/** Where a return may be handed in; `nameOf` turns a carrier id into its display name. */
export function dropOffLabel(
  option: Return["drop_off"][number],
  nameOf: (id: string) => string,
): string {
  return (
    option.description ??
    `${KIND_LABELS[option.kind]}${option.carrier === null ? "" : ` (${nameOf(option.carrier)})`}`
  );
}

function ReturnStatusBadge({ status }: { readonly status: ReturnStatus }): ReactNode {
  return (
    <span className={`badge status-${STATUS_COLOUR[status]}`}>{RETURN_STATUS_LABELS[status]}</span>
  );
}

/** One return: status, deadline, where to hand it in, cost, refund, label and its parcel. */
export function ReturnCard({
  entry,
  showOrder = false,
}: {
  readonly entry: Return;
  readonly showOrder?: boolean;
}): ReactNode {
  const titleId = `return-${entry.id}`;
  const cost = costLabel(entry.cost);
  const refund = refundLabel(entry.refund);
  const title = entry.items.map((item) => item.title).join(", ");
  const nameOf = useProviderNames();
  return (
    <section className="glass-panel return-card" aria-labelledby={titleId}>
      <div className="order-head">
        <Undo2 size={20} className="page-icon" aria-hidden="true" />
        <div className="order-head-text">
          <h3 id={titleId}>{title === "" ? t.returns.untitled : title}</h3>
          {showOrder ? (
            <Link to="/orders/$orderId" params={{ orderId: entry.order_id }} className="mono muted">
              <ProviderName id={entry.shop} /> {entry.order_number}
            </Link>
          ) : null}
        </div>
        <ReturnStatusBadge status={entry.status} />
      </div>
      <dl className="return-facts">
        {entry.return_by === null ? null : (
          <>
            <dt>{t.returns.returnBy}</dt>
            <dd>{formatDay(entry.return_by)}</dd>
          </>
        )}
        {entry.drop_off.length === 0 ? null : (
          <>
            <dt>{t.returns.dropOff}</dt>
            <dd>
              <ul className="return-drop-off">
                {entry.drop_off.map((option) => (
                  <li key={dropOffLabel(option, nameOf)}>{dropOffLabel(option, nameOf)}</li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {cost === null ? null : (
          <>
            <dt>{t.returns.cost}</dt>
            <dd>{cost}</dd>
          </>
        )}
        {refund === null ? null : (
          <>
            <dt>{t.returns.refund}</dt>
            <dd>{refund}</dd>
          </>
        )}
        {entry.reason === null ? null : (
          <>
            <dt>{t.returns.reason}</dt>
            <dd>{entry.reason}</dd>
          </>
        )}
        {entry.tracking_number === null ? null : (
          <>
            <dt>{t.returns.tracking}</dt>
            <dd>
              {entry.parcel_id === null ? (
                <span className="mono">{entry.tracking_number}</span>
              ) : (
                <Link to="/parcels/$parcelId" params={{ parcelId: entry.parcel_id }}>
                  <span className="mono">{entry.tracking_number}</span>
                </Link>
              )}
            </dd>
          </>
        )}
      </dl>
      {entry.label_url === null ? null : (
        <a
          href={entry.label_url}
          target="_blank"
          rel="noreferrer noopener"
          className="button small"
        >
          {t.returns.label}
        </a>
      )}
    </section>
  );
}
