// Automated accessibility checks (axe-core) on every page, signed in as the admin. jsdom has no
// layout or colours: contrast is checked on the design tokens instead (contrast.test.ts).
import { screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import { mockApi, parcel, renderApp, SIGNED_IN } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

const PARCEL = parcel();

function mockAll(): void {
  mockApi({
    "GET /api/v1/session": () => ({ body: SIGNED_IN }),
    "GET /api/v1/carriers": () => ({ body: [] }),
    "GET /api/v1/connections": () => ({ body: [] }),
    "GET /api/v1/consumers": () => ({ body: [] }),
    "GET /api/v1/consumers/available": () => ({ body: [] }),
    "GET /api/v1/parcels": () => ({ body: [PARCEL] }),
    [`GET /api/v1/parcels/${PARCEL.id}`]: () => ({ body: PARCEL }),
    "GET /api/v1/orders": () => ({ body: [] }),
    "GET /api/v1/returns": () => ({ body: [] }),
    "GET /api/v1/calendar": () => ({ body: [] }),
    "GET /api/v1/tokens": () => ({ body: [] }),
    "GET /api/v1/logins": () => ({ body: [] }),
    "GET /api/v1/settings": () => ({ body: { home: null, parcel_label: "tracking_number" } }),
    "GET /api/v1/settings/config": () => ({ body: [] }),
    "GET /api/v1/map/layers": () => ({
      body: { layers: [], default_base: "osm", default_overlay: null },
    }),
  });
}

async function violations(): Promise<string[]> {
  const result = await axe.run(document.body, {
    rules: { "color-contrast": { enabled: false } },
  });
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((node) => node.target.join(" ")).join(", ")}`,
  );
}

const PAGES = [
  "/",
  `/parcels/${PARCEL.id}`,
  "/connections",
  "/consumers",
  "/map",
  "/orders",
  "/orders/00000000-0000-4000-8000-0000000000f1",
  "/returns",
  "/calendar",
  "/tokens",
  "/status",
  "/settings",
  "/no/such/page",
];

describe("accessibility", () => {
  it("reports a violation when there is one", async () => {
    document.body.innerHTML = '<main><img src="x.png"></main>';
    expect(await violations()).toEqual([expect.stringMatching(/^image-alt:/)]);
    document.body.innerHTML = "";
  });

  it.each(PAGES)("finds no axe violations on %s", async (path) => {
    mockAll();
    renderApp(path);
    await screen.findByRole("main");
    await waitFor(() => {
      expect(screen.queryByText(t.common.loading)).toBeNull();
    });
    expect(await violations()).toEqual([]);
  });
});
