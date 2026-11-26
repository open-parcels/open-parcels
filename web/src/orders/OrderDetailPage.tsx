/** One order: rename, archive or delete it, its items and its parcels. */
import { ArchiveButton, DeleteButton } from "../components/RecordActions";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, RotateCcw, ShoppingBag } from "lucide-react";
import type { ReactNode } from "react";
import { useProviderName } from "../components/CarrierLogo";
import { keys, useDeleteOrder, useOrder, useUpdateOrder } from "../api/queries";
import type { Order } from "../api/types";
import { ErrorNotice, Spinner } from "../components/ui";
import { t } from "../i18n";
import { formatDateTime } from "../lib/format";
import { useIsAdmin } from "../auth/session";
import { InlineTitle } from "../parcels/InlineEdit";
import { ItemList } from "../parcels/ItemList";
import { formatDay, ReturnCard } from "../returns/parts";
import { noParcelText, OrderBadges, OrderParcels, OrderProgress, orderSummary } from "./parts";

/** Says in words why the order is (or is not) in the archive. */
export function archiveExplanation(order: Order): string {
  switch (order.archive_mode) {
    case "archived":
      return t.orders.archive.archived;
    case "kept":
      return t.orders.archive.kept;
    case "automatic":
      if (order.status === "cancelled" || order.status === "refunded") {
        return order.archived
          ? t.orders.archive.endedArchived(order.status)
          : t.orders.archive.endedPending(order.status);
      }
      return order.archived ? t.orders.archive.parcelsArchived : t.orders.archive.parcelsPending;
  }
}

function Actions({ order }: { readonly order: Order }): ReactNode {
  const canEdit = useIsAdmin();
  const update = useUpdateOrder(order.id);
  const remove = useDeleteOrder();
  const client = useQueryClient();
  const navigate = useNavigate();
  if (!canEdit) return null;
  return (
    <>
      <ArchiveButton
        archived={order.archived}
        pending={update.isPending}
        archiveLabel={t.orders.archiveAction}
        restoreLabel={t.orders.unarchive}
        onChange={(archived) => {
          update.mutate({ archived });
        }}
      />
      {order.archive_mode === "automatic" ? null : (
        <button
          type="button"
          className="button small"
          disabled={update.isPending}
          title={t.orders.archiveAutomaticallyHint}
          onClick={() => {
            update.mutate({ archived: null });
          }}
        >
          <RotateCcw size={14} aria-hidden="true" /> {t.orders.archiveAutomatically}
        </button>
      )}
      <DeleteButton
        label={t.orders.delete}
        question={t.orders.deleteQuestion}
        onDelete={() => {
          remove.mutate(order.id, {
            onSuccess: () => {
              void navigate({ to: "/orders" }).then(() => {
                client.removeQueries({ queryKey: keys.order(order.id), exact: true });
              });
            },
          });
        }}
      />
      <ErrorNotice error={update.error ?? remove.error} />
    </>
  );
}

function Header({ order }: { readonly order: Order }): ReactNode {
  const update = useUpdateOrder(order.id);
  const shop = useProviderName(order.shop);
  return (
    <div className="detail-head">
      <ShoppingBag size={40} className="page-icon" aria-hidden="true" />
      <div className="detail-head-text">
        <div className="muted">
          {shop} <span className="mono">{order.order_number}</span>
        </div>
        <InlineTitle
          titleId="order-title"
          shown={order.display_name}
          label={order.label}
          placeholder={`${shop} ${order.order_number}`}
          error={update.error}
          onSave={(label) => {
            update.mutate({ label });
          }}
        />
      </div>
      <div className="detail-head-tags">
        <OrderBadges order={order} />
      </div>
      <div className="detail-head-actions">
        <Actions order={order} />
      </div>
    </div>
  );
}

function Items({ order }: { readonly order: Order }): ReactNode {
  return (
    <section className="detail-section" aria-labelledby="order-items-title">
      <h2 id="order-items-title">{t.orders.items}</h2>
      {order.items.length === 0 ? (
        <p className="muted">{t.orders.itemsMissing}</p>
      ) : (
        <ItemList
          items={order.items}
          note={(_item, index) => {
            const parcelId = order.items[index]?.parcel_id ?? null;
            if (parcelId === null) return t.orders.itemParcelUnknown;
            const carrying = order.parcels.find((parcel) => parcel.id === parcelId);
            return carrying === undefined ? null : t.orders.itemIn(carrying.display_name);
          }}
        />
      )}
    </section>
  );
}

/** The order's returns, and the shop's return window while none was started. */
function Returns({ order }: { readonly order: Order }): ReactNode {
  if (order.returns.length === 0 && order.return_until === null) return null;
  return (
    <section className="detail-section" aria-labelledby="order-returns-title">
      <h2 id="order-returns-title">{t.orders.returns}</h2>
      {order.return_until === null ? null : (
        <p className="muted">{t.orders.returnWindow(formatDay(order.return_until))}</p>
      )}
      {order.returns.map((entry) => (
        <ReturnCard key={entry.id} entry={entry} />
      ))}
    </section>
  );
}

export function OrderDetailPage({ orderId }: { readonly orderId: string }): ReactNode {
  const query = useOrder(orderId);
  const order = query.data;
  const summary = order === undefined ? "" : orderSummary(order);
  return (
    <section aria-labelledby="order-title" className="stack">
      <div className="detail-bar">
        <Link to="/orders" className="back-link">
          <ArrowLeft size={20} aria-hidden="true" /> {t.orders.allOrders}
        </Link>
      </div>
      <ErrorNotice error={query.error} />
      {order === undefined ? (
        query.isPending ? (
          <Spinner />
        ) : null
      ) : (
        <div className="glass-panel panel">
          <Header order={order} />
          {summary === "" ? null : <p className="muted">{summary}</p>}
          <OrderProgress order={order} />
          <p className="muted order-view-help">
            {archiveExplanation(order)}
            {order.archived_at === null
              ? null
              : t.orders.archive.archivedAt(formatDateTime(order.archived_at))}
          </p>
          <Items order={order} />
          <section className="detail-section" aria-labelledby="order-parcels-title">
            <h2 id="order-parcels-title">{t.orders.parcels}</h2>
            {order.parcels.length === 0 ? (
              <p className="muted">
                {t.orders.sentence(
                  order.digital ? t.orders.digitalNoParcel : noParcelText(order.status),
                )}
              </p>
            ) : (
              <OrderParcels order={order} />
            )}
          </section>
          <Returns order={order} />
        </div>
      )}
    </section>
  );
}
