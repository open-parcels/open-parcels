import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ParcelDetail } from "../api/types";
import { mockApi, parcel } from "../test/helpers";
import LocationMap from "./LocationMap";
import type { LatLng } from "./mapIcons";

/* Made-up places far from anywhere real. */

/** Every `positions` array each animated line was drawn with, by colour token. */
const drawn = new Map<string, (readonly LatLng[])[]>();

vi.mock("./AnimatedRoute", () => ({
  AnimatedRoute: (props: { readonly positions: readonly LatLng[]; readonly token?: string }) => {
    const token = props.token ?? "map-route";
    drawn.set(token, [...(drawn.get(token) ?? []), props.positions]);
    return null;
  },
}));
vi.mock("./SharedMap", () => ({
  SharedMap: (props: { readonly children: ReactNode }) => props.children,
}));
vi.mock("react-leaflet", () => ({ Marker: () => null, Popup: () => null }));

const scan = (timestamp: string, latitude: number, longitude: number) => ({
  timestamp,
  status: "in_transit" as const,
  raw_status: "Sorted",
  location: "Testtown",
  latitude,
  longitude,
  approximate: false,
});

const DETAIL: ParcelDetail = parcel({
  history: [scan("2026-11-18T08:00:00Z", 10.5, 20.25), scan("2026-11-18T12:00:00Z", 11.5, 21.25)],
});

describe("route map", () => {
  it("keeps its lines when it renders again with the same parcel and home (OP-149)", async () => {
    mockApi({
      "GET /api/v1/settings": () => ({
        body: { home: { latitude: 12.5, longitude: 22.25, label: null }, parcel_label: "items" },
      }),
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // A new element each time, so React renders the map again with the same props.
    const view = () => (
      <QueryClientProvider client={client}>
        <LocationMap parcel={DETAIL} />
      </QueryClientProvider>
    );
    const { rerender } = render(view());
    // Once the home has loaded, the way ahead is drawn too.
    await waitFor(() => {
      expect(drawn.size).toBe(2);
    });
    drawn.clear();
    rerender(view());
    rerender(view());
    expect([...drawn.values()].map((positions) => new Set(positions).size)).toEqual([1, 1]);
  });
});
