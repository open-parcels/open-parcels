import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Parcel } from "../api/types";
import { mockApi, parcel, renderApp, SIGNED_IN, type Recorded } from "../test/helpers";

const PARCELS = [
  parcel({ id: "00000000-0000-4000-8000-00000000000a", label: "Book", carrier: "dhl" }),
  parcel({
    id: "00000000-0000-4000-8000-00000000000b",
    tracking_number: "TEST0000000002",
    carrier: "dpd",
    status: "registered",
    lookup: {
      state: "not_found",
      since: "2026-11-10T10:00:00.000Z",
      checked_at: "2026-11-18T09:00:00.000Z",
    },
  }),
  parcel({
    id: "00000000-0000-4000-8000-00000000000c",
    tracking_number: "TEST0000000003",
    label: "Shoes",
    carrier: "hermes",
    status: "delivered",
    delivered: true,
  }),
];

/** The server's part, roughly: the Show filter, carrier, search and one page. */
function serve(all: readonly Parcel[]) {
  return (request: Recorded) => {
    const active = request.query.get("active");
    const carrier = request.query.get("carrier");
    const search = request.query.get("q")?.toLowerCase();
    const offset = Number(request.query.get("offset") ?? "0");
    const limit = Number(request.query.get("limit") ?? "500");
    const rows = all.filter(
      (one) =>
        (active === null || one.delivered === (active === "false")) &&
        (carrier === null || one.carrier === carrier) &&
        (search === undefined || one.display_name.toLowerCase().includes(search)),
    );
    return { body: rows.slice(offset, offset + limit) };
  };
}

const COUNTS = {
  active: 2,
  delivered: 1,
  archived: 0,
  carriers: ["dhl", "dpd", "hermes"].map((carrier) => ({ carrier, parcels: 1 })),
  connections: [],
};

function api() {
  return mockApi({
    "GET /api/v1/session": () => ({ body: SIGNED_IN }),
    "GET /api/v1/parcels": serve(PARCELS),
    "GET /api/v1/parcels/counts": () => ({ body: COUNTS }),
    "GET /api/v1/carriers": () => ({ body: [] }),
  });
}

describe("parcel list", () => {
  it("shows active parcels with status, carrier and lookup state", async () => {
    api();
    renderApp();
    const table = await screen.findByRole("table", { name: "Parcels" });
    expect(within(table).getByText("Book")).toBeInTheDocument();
    expect(within(table).getByText("Not found by carrier")).toBeInTheDocument();
    expect(within(table).getByText("dpd")).toBeInTheDocument();
    // Delivered parcels are hidden under the default "Active" filter.
    expect(within(table).queryByText("Shoes")).not.toBeInTheDocument();
  });

  it("asks the server to filter by delivered, carrier and search", async () => {
    const calls = api();
    const user = userEvent.setup();
    renderApp();
    const table = await screen.findByRole("table", { name: "Parcels" });
    const lastQuery = () => calls.filter((call) => call.path === "/api/v1/parcels").at(-1)?.query;

    await user.click(screen.getByLabelText("Delivered"));
    expect(await within(table).findByText("Shoes")).toBeInTheDocument();
    expect(within(table).queryByText("Book")).not.toBeInTheDocument();
    expect(lastQuery()?.get("active")).toBe("false");

    await user.click(screen.getByLabelText("All"));
    await user.selectOptions(screen.getByLabelText("Carrier"), "dhl");
    expect(await within(table).findByText("Book")).toBeInTheDocument();
    await waitFor(() => {
      expect(within(table).queryByText("Shoes")).not.toBeInTheDocument();
    });
    expect(lastQuery()?.get("carrier")).toBe("dhl");
    expect(lastQuery()?.has("active")).toBe(false);

    await user.selectOptions(screen.getByLabelText("Carrier"), "");
    await user.type(screen.getByLabelText("Search parcels"), "shoes");
    expect(await within(table).findByText("Shoes")).toBeInTheDocument();
    await waitFor(() => {
      expect(within(table).queryByText("Book")).not.toBeInTheDocument();
    });
    expect(lastQuery()?.get("q")).toBe("shoes");
  });

  it("sorts on the server by the clicked column", async () => {
    const calls = api();
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole("table", { name: "Parcels" });
    expect(calls.find((call) => call.path === "/api/v1/parcels")?.query.get("sort")).toBe(
      "-updated_at",
    );
    await user.click(screen.getByRole("button", { name: "Carrier" }));
    await waitFor(() => {
      expect(
        calls
          .filter((call) => call.path === "/api/v1/parcels")
          .at(-1)
          ?.query.get("sort"),
      ).toBe("carrier");
    });
  });

  it("loads the list one server page at a time", async () => {
    const many = Array.from({ length: 450 }, (_, n) =>
      parcel({
        id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
        tracking_number: `TEST${String(n).padStart(10, "0")}`,
        label: `Scale ${String(n)}`,
      }),
    );
    const calls = mockApi({
      "GET /api/v1/session": () => ({ body: SIGNED_IN }),
      "GET /api/v1/parcels": serve(many),
      "GET /api/v1/parcels/counts": () => ({ body: COUNTS }),
      "GET /api/v1/carriers": () => ({ body: [] }),
    });
    const user = userEvent.setup();
    renderApp();
    const table = await screen.findByRole("table", { name: "Parcels" });
    // A header row and the first page; the count says more follow.
    expect(within(table).getAllByRole("row")).toHaveLength(201);
    expect(screen.getAllByText("200+").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(() => {
      expect(within(table).getAllByRole("row")).toHaveLength(401);
    });
    await user.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(() => {
      expect(within(table).getAllByRole("row")).toHaveLength(451);
    });
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
    const offsets = calls
      .filter((call) => call.path === "/api/v1/parcels")
      .map((call) => call.query.get("offset"));
    expect(offsets).toEqual(["0", "200", "400"]);
    // 450 table rows in jsdom took just over the 5 s default on the NAS's capped test container.
  }, 15_000);

  it("adds a parcel with carrier detection and sends the CSRF header", async () => {
    const calls = mockApi({
      "GET /api/v1/session": () => ({ body: SIGNED_IN }),
      "GET /api/v1/parcels": () => ({ body: [] }),
      "GET /api/v1/carriers": () => ({ body: [] }),
      "POST /api/v1/parcels": () => ({ status: 201, body: PARCELS[0] }),
      "GET /api/v1/parcels/00000000-0000-4000-8000-00000000000a": () => ({ body: PARCELS[0] }),
    });
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("button", { name: "Track a parcel" }));
    await user.type(screen.getByLabelText("Tracking number"), " TEST0000000009 ");
    await user.click(screen.getByRole("button", { name: "Track" }));

    expect(await screen.findByRole("heading", { name: "Book" })).toBeInTheDocument();
    const post = calls.find((call) => call.method === "POST" && call.path === "/api/v1/parcels");
    expect(post?.body).toEqual({ tracking_number: "TEST0000000009", label: null });
    expect(post?.headers.get("x-csrf-token")).toBe("csrf-test-value");
  });
});

const ARCHIVED = parcel({
  id: "00000000-0000-4000-8000-0000000000a1",
  label: "Old lamp",
  archived_at: "2026-11-18T09:00:00.000Z",
});

describe("parcel list with archived parcels", () => {
  it("keeps the Show selection when archived parcels are included", async () => {
    mockApi({
      "GET /api/v1/session": () => ({ body: SIGNED_IN }),
      "GET /api/v1/parcels": () => ({ body: [ARCHIVED] }),
      "GET /api/v1/carriers": () => ({ body: [] }),
    });
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole("table", { name: "Parcels" });
    await user.click(screen.getByLabelText("All"));
    await user.click(screen.getByLabelText("Include archived"));
    const table = await screen.findByRole("table", { name: "Parcels" });
    expect(screen.getByLabelText("All")).toBeChecked();
    expect(within(table).getByText("Archived")).toBeInTheDocument();
  });
});

describe("an ended session and a deleted parcel", () => {
  const ID = "00000000-0000-4000-8000-0000000000b2";
  const SIGNED_OUT = {
    authenticated: false,
    method: null,
    role: null,
    scopes: [],
    csrf_token: null,
    reader_required: true,
    setup_required: false,
  };

  it("goes back to sign-in when a change is refused with 401", async () => {
    let signedIn = true;
    mockApi({
      "GET /api/v1/session": () => ({ body: signedIn ? SIGNED_IN : SIGNED_OUT }),
      [`GET /api/v1/parcels/${ID}`]: () => ({ body: { ...parcel({ id: ID }), connections: [] } }),
      [`PATCH /api/v1/parcels/${ID}`]: () => {
        signedIn = false;
        return { status: 401, body: { error: "unauthorized", message: "Sign in again." } };
      },
      "GET /api/v1/parcels": () => ({ body: [] }),
      "GET /api/v1/carriers": () => ({ body: [] }),
    });
    const user = userEvent.setup();
    renderApp(`/parcels/${ID}`);
    await user.click(await screen.findByRole("button", { name: "Archive" }));
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
  });

  it("does not ask for a deleted parcel's detail again", async () => {
    let deleted = false;
    const calls = mockApi({
      "GET /api/v1/session": () => ({ body: SIGNED_IN }),
      [`GET /api/v1/parcels/${ID}`]: () =>
        deleted
          ? { status: 404, body: { error: "not_found", message: "Gone." } }
          : { body: { ...parcel({ id: ID }), connections: [] } },
      [`DELETE /api/v1/parcels/${ID}`]: () => {
        deleted = true;
        return { status: 204 };
      },
      "GET /api/v1/parcels": () => ({ body: [] }),
      "GET /api/v1/carriers": () => ({ body: [] }),
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderApp(`/parcels/${ID}`);
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    // Back on the list, whose read follows the invalidation a stale detail read would come with.
    await screen.findByRole("table");
    await waitFor(() => {
      expect(deleted).toBe(true);
      expect(calls.some((call) => call.method === "GET" && call.path === "/api/v1/parcels")).toBe(
        true,
      );
    });
    const detailReads = calls.filter(
      (call) => call.method === "GET" && call.path === `/api/v1/parcels/${ID}`,
    );
    expect(detailReads).toHaveLength(1);
  });
});

describe("parcel detail", () => {
  it("shows an archived parcel as archived, offers Unarchive and names its connections", async () => {
    const calls = mockApi({
      "GET /api/v1/session": () => ({ body: SIGNED_IN }),
      "GET /api/v1/parcels/00000000-0000-4000-8000-0000000000a1": () => ({
        body: {
          ...ARCHIVED,
          connections: [
            {
              connection_id: "s1",
              provider: "dhl",
              label: "DHL account",
              kind: "account",
              role: "primary",
              last_seen_at: "2026-11-18T09:00:00.000Z",
            },
            {
              connection_id: "s2",
              provider: "dhl",
              label: "DHL tracking",
              kind: "tracking",
              role: "primary",
              last_seen_at: "2026-11-18T09:00:00.000Z",
            },
          ],
        },
      }),
      "PATCH /api/v1/parcels/00000000-0000-4000-8000-0000000000a1": () => ({
        body: { ...ARCHIVED, archived_at: null },
      }),
      "GET /api/v1/parcels": () => ({ body: [] }),
      "GET /api/v1/carriers": () => ({ body: [] }),
    });
    const user = userEvent.setup();
    renderApp("/parcels/00000000-0000-4000-8000-0000000000a1");
    await screen.findByRole("heading", { name: "Old lamp" });
    expect(screen.getByText("Archived")).toBeInTheDocument();
    // The connections are their own region, not part of "Items" (OP-157).
    const connections = screen.getByRole("region", { name: "Connections" });
    expect(within(connections).getByText(/DHL account/)).toBeInTheDocument();
    expect(within(connections).getByText(/DHL tracking/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Unarchive" }));
    expect(await screen.findByText("Restored from the archive.")).toBeInTheDocument();
    expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ archived: false });
  });
});
