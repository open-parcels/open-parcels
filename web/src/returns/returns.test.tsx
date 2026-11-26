import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarEntry, Return } from "../api/types";
import { toCalendarEvent } from "../calendar/events";
import { mockApi, renderApp, SIGNED_IN } from "../test/helpers";

const ORDER_ID = "00000000-0000-4000-8000-0000000000f2";
const RETURN_ID = "00000000-0000-4000-8000-0000000000e1";
const PARCEL_ID = "00000000-0000-4000-8000-0000000000a9";

/** A made-up return; every value is invented. */
function made(overrides: Partial<Return> = {}): Return {
  return {
    id: RETURN_ID,
    order_id: ORDER_ID,
    shop: "example-shop.de",
    order_number: "RET-0001",
    status: "requested",
    reason: null,
    return_by: "2026-11-25",
    drop_off: [{ carrier: "dhl", kind: "any", description: "Any DHL drop-off point" }],
    cost: { free: true, amount: null, currency: null },
    label_url: "https://shop.example.invalid/returns/label/R-1",
    carrier: null,
    tracking_number: null,
    parcel_id: null,
    refund: { amount: 19.99, currency: "EUR", status: "pending" },
    items: [{ title: "Example kettle", order_item_position: null }],
    created_at: "2026-11-18T10:00:00.000Z",
    updated_at: "2026-11-18T10:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("returns page", () => {
  it("lists returns with deadline, drop-off, cost and label, and switches views", async () => {
    const calls = mockApi({
      "GET /api/v1/session": () => ({ body: SIGNED_IN }),
      "GET /api/v1/carriers": () => ({ body: [] }),
      "GET /api/v1/returns": (request) => ({
        body:
          request.query.get("view") === "closed"
            ? [
                made({
                  status: "refunded",
                  tracking_number: "00340000000000000099",
                  parcel_id: PARCEL_ID,
                }),
              ]
            : [made()],
      }),
    });
    const user = userEvent.setup();
    renderApp("/returns");
    const card = await screen.findByRole("region", { name: "Example kettle" });
    expect(within(card).getByText("Return requested")).toBeInTheDocument();
    expect(within(card).getByText("Any DHL drop-off point")).toBeInTheDocument();
    expect(within(card).getByText("Free return")).toBeInTheDocument();
    expect(within(card).getByText(/Refund expected/)).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Label or QR code" })).toHaveAttribute(
      "href",
      "https://shop.example.invalid/returns/label/R-1",
    );
    expect(within(card).getByRole("link", { name: /RET-0001/ })).toHaveAttribute(
      "href",
      `/orders/${ORDER_ID}`,
    );

    await user.click(screen.getByLabelText("Closed"));
    const closed = await screen.findByRole("region", { name: "Example kettle" });
    expect(await within(closed).findByText("Refunded")).toBeInTheDocument();
    expect(within(closed).getByRole("link", { name: "00340000000000000099" })).toHaveAttribute(
      "href",
      `/parcels/${PARCEL_ID}`,
    );
    expect(
      calls.filter((call) => call.path === "/api/v1/returns").map((c) => c.query.get("view")),
    ).toEqual(["open", "closed"]);
  });
});

describe("return deadlines in the calendar", () => {
  it("say what to return, where and at what cost, and open the order", () => {
    const entry: CalendarEntry = {
      uid: `return-${RETURN_ID}@open-parcels`,
      parcel_id: null,
      return_id: RETURN_ID,
      order_id: ORDER_ID,
      title: "Example kettle",
      carrier: "dhl",
      tracking_number: "RET-0001",
      status: "requested",
      kind: "return_by",
      drop_off: [{ carrier: "dhl", kind: "any", description: "Any DHL drop-off point" }],
      cost: { free: true, amount: null, currency: null },
      start: "2026-11-24T23:00:00.000Z",
      end: "2026-11-25T23:00:00.000Z",
      all_day: true,
      start_date: "2026-11-25",
      end_date: "2026-11-26",
      late: false,
      image_url: null,
      url: null,
      pickup_point: null,
    };
    expect(toCalendarEvent(entry, () => "DHL")).toMatchObject({
      title: "Return by: Example kettle · Drop off: Any DHL drop-off point · Free return",
      start: "2026-11-25",
      allDay: true,
      classNames: ["cal-return_by"],
      extendedProps: { parcelId: null, orderId: ORDER_ID },
    });
  });
});
