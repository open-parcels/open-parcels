import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi, renderApp, SIGNED_IN } from "../test/helpers";
import type { CalendarEntry } from "../api/types";
import { toCalendarEvent } from "./events";

describe("calendar page", () => {
  it("asks once, for the range it shows, also for a day in another month (OP-153)", async () => {
    const calls = mockApi({
      "GET /api/v1/session": () => ({ body: SIGNED_IN }),
      "GET /api/v1/calendar": () => ({ body: [] }),
      "GET /api/v1/carriers": () => ({ body: [] }),
    });
    renderApp("/calendar?date=2025-03-15");
    const reads = () => calls.filter((call) => call.path === "/api/v1/calendar");
    await waitFor(() => {
      expect(reads()).toHaveLength(1);
    });
    expect(await screen.findByText(/March 2025/)).toBeInTheDocument();
    const [read] = reads();
    expect(read?.query.get("from")?.slice(0, 10) ?? "").toMatch(/^2025-0[23]-/);
    expect(read?.query.get("to")?.slice(0, 10) ?? "").toMatch(/^2025-04-/);
    expect(reads()).toHaveLength(1);
  });

  describe("on a phone", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("opens the list instead of the month grid unless the address names a view", async () => {
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query === "(max-width: 480px)",
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }));
      mockApi({
        "GET /api/v1/session": () => ({ body: SIGNED_IN }),
        "GET /api/v1/calendar": () => ({ body: [] }),
        "GET /api/v1/carriers": () => ({ body: [] }),
      });
      const { container } = renderApp("/calendar?date=2025-03-15");
      await waitFor(() => {
        expect(container.querySelector(".fc-listWeek-view")).not.toBeNull();
      });
      expect(container.querySelector(".fc-dayGridMonth-view")).toBeNull();
    });
  });
});

describe("calendar entries", () => {
  it("places all-day entries on the server's local days, not the browser's", () => {
    const entry: CalendarEntry = {
      uid: "p1@open-parcels",
      parcel_id: "00000000-0000-4000-8000-0000000000b1",
      return_id: null,
      order_id: null,
      drop_off: [],
      cost: null,
      title: "Lamp",
      carrier: "dhl",
      tracking_number: "TEST0000000009",
      status: "delivered",
      kind: "delivered",
      // Local midnight in Berlin, which a UTC browser would put on the day before.
      start: "2026-11-16T23:00:00.000Z",
      end: "2026-11-17T23:00:00.000Z",
      all_day: true,
      start_date: "2026-11-17",
      end_date: "2026-11-18",
      late: false,
      image_url: null,
      url: null,
      pickup_point: null,
    };
    expect(toCalendarEvent(entry, () => "DHL")).toMatchObject({
      start: "2026-11-17",
      end: "2026-11-18",
      allDay: true,
    });
  });
});
