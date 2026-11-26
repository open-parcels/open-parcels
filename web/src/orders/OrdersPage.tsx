/** Orders from shop connections and mails, sorted into open, delivered and archived. */
import { useProviderName } from "../components/CarrierLogo";
import { ItemPictures } from "../components/ItemPictures";
import { Segmented } from "../components/Segmented";
import { Link } from "@tanstack/react-router";
import { ShoppingBag } from "lucide-react";
import type { ReactNode } from "react";
import { pickOne, useUrlParam } from "../lib/urlState";
import { useOrders } from "../api/queries";
import type { Order, OrderView } from "../api/types";
import { ErrorNotice, Spinner } from "../components/ui";
import { t } from "../i18n";
import { OrderBadges, OrderParcels, OrderProgress, orderSummary, ORDER_VIEW_TABS } from "./parts";

function OrderCard({ order }: { readonly order: Order }): ReactNode {
  const titleId = `order-${order.id}`;
  const summary = orderSummary(order);
  const shop = useProviderName(order.shop);
  return (
    <section className="glass-panel order-card" aria-labelledby={titleId}>
      <div className="order-head">
        <ShoppingBag size={20} className="page-icon" aria-hidden="true" />
        <div className="order-head-text">
          <h2 id={titleId}>
            <Link to="/orders/$orderId" params={{ orderId: order.id }}>
              {order.label ?? shop}
            </Link>
          </h2>
          <span className="mono muted">
            {order.label === null ? order.order_number : `${shop} ${order.order_number}`}
          </span>
        </div>
        <OrderBadges order={order} />
      </div>
      {summary === "" ? null : <div className="muted">{summary}</div>}
      <ItemPictures items={order.items} limit={6} size="large" />
      <OrderProgress order={order} />
      <OrderParcels order={order} />
    </section>
  );
}

const VIEWS: readonly OrderView[] = ["open", "delivered", "archived", "all"];

/** Linkable: `?view=open|delivered|archived|all`. */
export function OrdersPage(): ReactNode {
  const [viewParam, setViewParam] = useUrlParam("view");
  const view = pickOne(viewParam, VIEWS, "open");
  const setView = (next: OrderView): void => {
    setViewParam(next === "open" ? null : next);
  };
  const orders = useOrders(view);
  const tab = ORDER_VIEW_TABS.find((entry) => entry.view === view);
  const list = orders.data?.pages.flat();

  return (
    <section aria-labelledby="orders-title" className="stack">
      <div className="page-header glass-panel">
        <div className="page-title-row">
          <ShoppingBag size={22} className="page-icon" aria-hidden="true" />
          <h1 id="orders-title">{t.orders.title}</h1>
          <span className="page-count">
            {list?.length ?? 0}
            {orders.hasNextPage ? "+" : ""}
          </span>
        </div>
        <Segmented
          legend={t.orders.show}
          name="order-view"
          options={ORDER_VIEW_TABS.map((entry) => ({ value: entry.view, label: entry.label }))}
          value={view}
          onChange={setView}
        />
      </div>
      {tab === undefined ? null : <p className="muted order-view-help">{tab.help}</p>}
      <ErrorNotice error={orders.error} />
      {list === undefined ? (
        orders.isPending ? (
          <Spinner />
        ) : null
      ) : list.length === 0 ? (
        <div className="glass-panel empty-state">
          <ShoppingBag size={32} aria-hidden="true" />
          <p>{t.orders.views[view].empty}</p>
        </div>
      ) : (
        <>
          <div className="order-grid">
            {list.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
          {orders.hasNextPage ? (
            <button
              type="button"
              className="button show-more"
              disabled={orders.isFetchingNextPage}
              onClick={() => {
                void orders.fetchNextPage();
              }}
            >
              {t.common.loadMore}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
