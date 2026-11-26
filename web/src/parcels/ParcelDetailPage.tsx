import { Link } from "@tanstack/react-router";
import { ArrowLeft, Calendar, CheckCircle2, ExternalLink, MapPin, PackageOpen } from "lucide-react";
import { lazy, Suspense, type ReactNode } from "react";
import { useParcel, useUpdateParcel } from "../api/queries";
import type { ParcelDetail } from "../api/types";
import { CarrierLogo, ProviderName, useProviderName } from "../components/CarrierLogo";
import { SplitContainer } from "../components/SplitContainer";
import { ErrorNotice, Spinner } from "../components/ui";
import {
  describeLookup,
  formatDateTime,
  formatRelative,
  formatExpected,
  CONNECTION_KIND_LABELS,
  STATUS_LABELS,
} from "../lib/format";
import { ArchivedBadge, LookupBadge } from "./badges";
import { formatDistance } from "../lib/geo";
import { safeHref } from "../lib/links";
import { useHome } from "../settings/home";
import { kmToHome } from "./distance";
import { useIsAdmin } from "../auth/session";
import { EditableStatus, EditableTitle, ParcelActions } from "./InlineEdit";
import { ItemList } from "./ItemList";
import { t } from "../i18n";

const LocationMap = lazy(() => import("../map/LocationMap"));

function Facts({ parcel }: { readonly parcel: ParcelDetail }): ReactNode {
  const carrierPage = safeHref(parcel.url);
  const rows: [string, ReactNode][] = [
    [t.parcels.trackingNumber, <span className="mono">{parcel.tracking_number}</span>],
    [t.parcels.carrierSays, parcel.raw_status ?? "—"],
    [
      t.parcels.columnLookup,
      <>
        <LookupBadge state={parcel.lookup.state} />{" "}
        <span className="muted">{describeLookup(parcel.lookup)}</span>
      </>,
    ],
    [t.parcels.pickupPoint, parcel.pickup_point ?? (parcel.pickup ? t.common.yes : "—")],
    [t.parcels.sender, parcel.sender ?? "—"],
    [
      t.parcels.direction,
      parcel.direction === "receiving" ? t.parcels.receiving : t.parcels.sending,
    ],
    [
      t.parcels.order,
      parcel.order === null ? (
        "—"
      ) : (
        <Link to="/orders/$orderId" params={{ orderId: parcel.order.id }}>
          <ProviderName id={parcel.order.shop} /> {parcel.order.order_number}
        </Link>
      ),
    ],
    [t.parcels.columnUpdated, formatDateTime(parcel.updated_at)],
  ];
  return (
    <section className="detail-section" aria-labelledby="facts-title">
      <h2 id="facts-title">{t.parcels.details}</h2>
      <dl className="facts">
        {rows.map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        {carrierPage === null ? null : (
          <div>
            <dt>{t.parcels.carrierPage}</dt>
            <dd>
              <a href={carrierPage} target="_blank" rel="noreferrer noopener">
                {t.parcels.openOnCarrierSite} <ExternalLink size={12} aria-hidden="true" />
              </a>
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function EtaCard({ parcel }: { readonly parcel: ParcelDetail }): ReactNode {
  const { home } = useHome();
  const done = parcel.delivered;
  const km = kmToHome(parcel, home?.point ?? null);
  const away = km === null ? null : t.parcels.away(formatDistance(km));
  const planned = parcel.expected_from !== null || parcel.expected_to !== null;
  const when = done
    ? `${formatDateTime(parcel.delivered_at)} (${formatRelative(parcel.delivered_at)})`
    : planned
      ? `${formatExpected(parcel)} (${[
          formatRelative(parcel.expected_from ?? parcel.expected_to),
          ...(away === null ? [] : [away]),
        ].join("; ")})`
      : away === null
        ? t.parcels.pending
        : t.parcels.pendingAway(away);
  return (
    <div className={done ? "eta-card done" : "eta-card"}>
      {done ? (
        <CheckCircle2 size={20} aria-hidden="true" />
      ) : (
        <Calendar size={20} aria-hidden="true" />
      )}
      <div>
        <div className="eta-label">
          {done ? t.parcels.deliveryDate : t.parcels.expectedDelivery}
        </div>
        <div className="eta-value">{when}</div>
      </div>
    </div>
  );
}

function History({ parcel }: { readonly parcel: ParcelDetail }): ReactNode {
  const events = [...parcel.history].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return (
    <section className="detail-section" aria-labelledby="history-title">
      <h2 id="history-title">{t.parcels.history}</h2>
      {events.length === 0 ? (
        <div className="empty-state">
          <PackageOpen size={32} aria-hidden="true" />
          <p>{t.parcels.noHistory}</p>
        </div>
      ) : (
        <ol className="timeline">
          {events.map((event, index) => (
            <li key={`${event.timestamp}-${index}`}>
              <div className="timeline-row">
                <div className="timeline-text">
                  {event.raw_status}
                  {event.status === null ? null : (
                    <span className="chip">{STATUS_LABELS[event.status]}</span>
                  )}
                </div>
                <time dateTime={event.timestamp}>{formatDateTime(event.timestamp)}</time>
              </div>
              {event.location === null ? null : (
                <div className="timeline-location">
                  <MapPin size={12} aria-hidden="true" />
                  {event.location}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * The order's other items: in another parcel, or in one not known yet. Items the server linked to
 * a parcel are told apart by that link; only unlinked ones fall back to the title (OP-151).
 */
export function otherOrderItems<Line extends { title: string; parcel_id: string | null }>(parcel: {
  readonly id: string;
  readonly items: readonly { title: string }[];
  readonly order: { readonly items: readonly Line[] } | null;
}): Line[] {
  const own = new Set(parcel.items.map((item) => item.title));
  return (parcel.order?.items ?? []).filter((line) =>
    line.parcel_id === null ? !own.has(line.title) : line.parcel_id !== parcel.id,
  );
}

function Items({ parcel }: { readonly parcel: ParcelDetail }): ReactNode {
  const otherLines = otherOrderItems(parcel);
  return (
    <section className="detail-section" aria-labelledby="items-title">
      <h2 id="items-title">{t.parcels.items}</h2>
      {parcel.items.length === 0 ? (
        <p className="muted">{t.parcels.noItems}</p>
      ) : (
        <ItemList items={parcel.items} />
      )}
      {otherLines.length === 0 ? null : (
        <>
          <h3 className="items-subtitle">{t.parcels.alsoInOrder}</h3>
          <ItemList
            items={otherLines}
            note={(_item, index) =>
              otherLines[index]?.parcel_id === null
                ? t.parcels.parcelNotKnown
                : t.parcels.inAnotherParcel
            }
          />
        </>
      )}
    </section>
  );
}

/** Its own section, so assistive tech does not read the connections as part of "Items" (OP-157). */
function Connections({ parcel }: { readonly parcel: ParcelDetail }): ReactNode {
  return (
    <section className="detail-section" aria-labelledby="connections-title">
      <h2 id="connections-title">{t.parcels.connections}</h2>
      {parcel.connections.length === 0 ? (
        <p className="muted">{t.parcels.noConnections}</p>
      ) : (
        <ul>
          {parcel.connections.map((connection) => (
            <li key={`${connection.connection_id}-${connection.role}`}>
              {connection.label}{" "}
              <span className="muted">
                ({CONNECTION_KIND_LABELS[connection.kind]}, {connection.role})
              </span>
              {t.parcels.seen(formatRelative(connection.last_seen_at))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Header({ parcel }: { readonly parcel: ParcelDetail }): ReactNode {
  const carrierName = useProviderName(parcel.carrier);
  const update = useUpdateParcel(parcel.id);
  const canEdit = useIsAdmin();
  const markedDelivered = parcel.manual_status === "delivered";
  return (
    <div className="detail-head">
      <CarrierLogo carrier={parcel.carrier} size={52} />
      <div className="detail-head-text">
        <div className="muted">{carrierName}</div>
        <EditableTitle parcel={parcel} />
      </div>
      <div className="detail-head-tags">
        {canEdit ? (
          <button
            type="button"
            className="button small"
            aria-pressed={markedDelivered}
            disabled={update.isPending}
            onClick={() => {
              update.mutate({ manual_status: markedDelivered ? null : "delivered" });
            }}
          >
            {markedDelivered ? t.parcels.markNotDelivered : t.parcels.markDelivered}
          </button>
        ) : null}
        {parcel.archived_at === null ? null : <ArchivedBadge />}
        <EditableStatus parcel={parcel} />
      </div>
      <div className="detail-head-actions">
        <ParcelActions parcel={parcel} />
      </div>
      <ErrorNotice error={update.error} />
    </div>
  );
}

function Overview({ parcel }: { readonly parcel: ParcelDetail }): ReactNode {
  return (
    <div className="glass-panel panel">
      <div className="panel-scroll">
        <Header parcel={parcel} />
        <EtaCard parcel={parcel} />
        <History parcel={parcel} />
        <Items parcel={parcel} />
        <Connections parcel={parcel} />
        <Facts parcel={parcel} />
      </div>
    </div>
  );
}

export function ParcelDetailPage({ parcelId }: { readonly parcelId: string }): ReactNode {
  const query = useParcel(parcelId);
  const parcel = query.data;

  return (
    <section aria-labelledby="parcel-title" className="stack">
      <div className="detail-bar">
        <Link to="/" className="back-link">
          <ArrowLeft size={20} aria-hidden="true" /> {t.parcels.allParcels}
        </Link>
      </div>
      <ErrorNotice error={query.error} />
      {parcel === undefined ? (
        query.isPending ? (
          <Spinner />
        ) : null
      ) : (
        <div className="split-page with-bar">
          <SplitContainer
            leftPanel={<Overview parcel={parcel} />}
            rightPanel={
              <div className="glass-panel map-panel">
                <Suspense fallback={<Spinner label={t.parcels.loadingMap} />}>
                  <LocationMap parcel={parcel} />
                </Suspense>
              </div>
            }
          />
        </div>
      )}
    </section>
  );
}
