import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { lazy, type ReactNode } from "react";
import { NotFoundPage } from "./layout/NotFoundPage";
import { Shell } from "./layout/Shell";
import { OrderDetailPage } from "./orders/OrderDetailPage";
import { OrdersPage } from "./orders/OrdersPage";
import { ParcelDetailPage } from "./parcels/ParcelDetailPage";
import { ParcelsPage } from "./parcels/ParcelsPage";
import { ReturnsPage } from "./returns/ReturnsPage";

// Leaflet and FullCalendar are large; load them only when their tab opens. The settings page shows
// a map preview and the admin pages are rarely opened, so they stay out of the first load too.
const MapPage = lazy(() => import("./map/MapPage"));
const CalendarPage = lazy(() => import("./calendar/CalendarPage"));
const SettingsPage = lazy(() =>
  import("./settings/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const ConnectionsPage = lazy(() =>
  import("./connections/ConnectionsPage").then((m) => ({ default: m.ConnectionsPage })),
);
const ConsumersPage = lazy(() =>
  import("./consumers/ConsumersPage").then((m) => ({ default: m.ConsumersPage })),
);
const TokensPage = lazy(() =>
  import("./admin/TokensPage").then((m) => ({ default: m.TokensPage })),
);
const StatusPage = lazy(() =>
  import("./admin/StatusPage").then((m) => ({ default: m.StatusPage })),
);

const rootRoute = createRootRoute({ component: Shell, notFoundComponent: NotFoundPage });

const parcelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/parcels/$parcelId",
  component: ParcelRoute,
});

function ParcelRoute(): ReactNode {
  // The route's own param type is circular here (the router type includes this component), so
  // read it as unknown and narrow.
  const params: unknown = parcelRoute.useParams();
  const parcelId =
    typeof params === "object" && params !== null && "parcelId" in params
      ? String(params.parcelId)
      : "";
  return <ParcelDetailPage parcelId={parcelId} />;
}

const orderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/orders/$orderId",
  component: OrderRoute,
});

function OrderRoute(): ReactNode {
  // Read as unknown and narrowed, for the same circular-type reason as ParcelRoute.
  const params: unknown = orderRoute.useParams();
  const orderId =
    typeof params === "object" && params !== null && "orderId" in params
      ? String(params.orderId)
      : "";
  return <OrderDetailPage orderId={orderId} />;
}

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: ParcelsPage }),
  parcelRoute,
  orderRoute,
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/connections",
    component: ConnectionsPage,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/consumers", component: ConsumersPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/map", component: MapPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/orders", component: OrdersPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/returns", component: ReturnsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/calendar", component: CalendarPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/tokens", component: TokensPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/status", component: StatusPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage }),
]);

/** `/`, or the Home Assistant ingress prefix the server wrote into `<base href>`. */
export function basePath(): string {
  const path = new URL(document.baseURI).pathname;
  return path.length > 1 ? path.replace(/\/$/, "") : "/";
}

export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    basepath: basePath(),
    defaultPreload: "intent",
    ...(history === undefined ? {} : { history }),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
