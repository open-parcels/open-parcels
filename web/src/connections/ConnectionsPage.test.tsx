import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { CarrierAction, Connection, Job } from "../api/types";
import { ConnectionStateBadge } from "../parcels/badges";
import { mockApi, renderApp, SIGNED_IN } from "../test/helpers";

describe("a connection that ran but had nothing to do", () => {
  it("shows Idle from the server's idle state", () => {
    render(<ConnectionStateBadge state="idle" lastOkAt={null} />);
    expect(screen.getByText("Idle", { selector: ".badge" })).toBeInTheDocument();
  });

  it("does not guess Idle from the detail text of an OK connection", () => {
    render(<ConnectionStateBadge state="ok" lastOkAt="2026-11-01T10:00:00.000Z" />);
    expect(screen.getByText("OK", { selector: ".badge" })).toBeInTheDocument();
  });
});

describe("connections", () => {
  const disabled: Connection = {
    id: "s3",
    provider: "dhl",
    kind: "account",
    label: "DHL account",
    config: {},
    has_secret: false,
    state: "disabled",
    state_reason: null,
    carrier_message: null,
    next_run_at: null,
    last_run_at: null,
    last_ok_at: null,
  };

  it("offers neither Sync now nor Sign in on a disabled connection", async () => {
    mockApi({
      "GET /api/v1/session": () => ({ body: SIGNED_IN }),
      "GET /api/v1/connections": () => ({ body: [disabled] }),
      "GET /api/v1/carriers": () => ({ body: [] }),
    });
    renderApp("/connections");
    await screen.findByRole("heading", { name: "DHL account" });
    expect(screen.getByRole("button", { name: "Enable" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sync now" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sign in/ })).not.toBeInTheDocument();
  });

  it("shows the server's parcel counts per connection, without loading the parcels", async () => {
    const calls = mockApi({
      "GET /api/v1/session": () => ({ body: SIGNED_IN }),
      "GET /api/v1/connections": () => ({ body: [{ ...disabled, state: "ok" }] }),
      "GET /api/v1/carriers": () => ({ body: [] }),
      "GET /api/v1/parcels/counts": () => ({
        body: {
          active: 7,
          delivered: 40,
          archived: 30,
          carriers: [],
          connections: [{ connection_id: "s3", active: 3, delivered: 21, total: 25 }],
        },
      }),
    });
    renderApp("/connections");
    await screen.findByRole("heading", { name: "DHL account" });
    for (const value of ["7", "3", "21", "25"]) {
      expect(await screen.findByText(value, { selector: ".connection-stat-value" })).toBeVisible();
    }
    expect(calls.some((call) => call.path === "/api/v1/parcels")).toBe(false);
  });

  it("shows a connection that never had a successful run as not run yet, never OK", async () => {
    mockApi({
      "GET /api/v1/session": () => ({ body: SIGNED_IN }),
      "GET /api/v1/connections": () => ({
        body: [{ ...disabled, state: "ok", state_reason: "not_run_yet" }],
      }),
      "GET /api/v1/carriers": () => ({ body: [] }),
    });
    renderApp("/connections");
    await screen.findByRole("heading", { name: "DHL account" });
    expect(screen.getByText("Not run yet", { selector: ".badge" })).toBeInTheDocument();
    expect(
      screen.getByText("Not run yet.", { selector: ".connection-detail" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("OK", { selector: ".badge" })).not.toBeInTheDocument();
  });

  const importHistory: CarrierAction = {
    id: "import_history",
    kind: "task",
    label: "Import history",
    description: null,
    connection_kinds: ["account"],
    when_state: ["ok", "idle"],
    weight: "light",
    confirm: "This takes a while.",
    destructive: false,
    expose_to_ha: true,
    cooldown_minutes: 0,
    input_schema: null,
    input_required: false,
  };
  const running: Job = {
    id: "00000000-0000-4000-8000-000000000001",
    connection_id: "s3",
    provider: "dhl",
    action: "import_history",
    state: "running",
    reason: null,
    progress: { done: 2, total: 5, phase: "2024: page 3" },
    summary: null,
    created_at: "2026-11-01T10:00:00.000Z",
    started_at: "2026-11-01T10:00:00.000Z",
    updated_at: "2026-11-01T10:05:00.000Z",
    finished_at: null,
    resume_at: null,
  };

  it("shows a connection's job with its progress, and starts and cancels jobs", async () => {
    const calls = mockApi({
      "GET /api/v1/session": () => ({ body: SIGNED_IN }),
      "GET /api/v1/connections": () => ({ body: [{ ...disabled, state: "ok" }] }),
      "GET /api/v1/carriers": () => ({
        body: [
          {
            id: "dhl",
            name: "DHL",
            countries: ["DE"],
            aliases: [],
            logo: null,
            connection_kinds: ["account"],
            fallback: false,
            sign_in: "none",
            sign_in_flows: [],
            config_schema: {},
            secret_schema: {},
            actions: [importHistory],
          },
        ],
      }),
      "GET /api/v1/jobs": () => ({ body: [running] }),
      [`POST /api/v1/jobs/${running.id}/cancel`]: () => ({
        body: { ...running, state: "running" },
      }),
    });
    const user = userEvent.setup();
    renderApp("/connections");
    expect(await screen.findByText("Running", { selector: ".badge" })).toBeInTheDocument();
    expect(screen.getByText(/2 of 5 · 2024: page 3/)).toBeInTheDocument();
    // One job per connection: the action waits until this one ends.
    expect(screen.getByRole("button", { name: "Import history…" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(calls.map((call) => `${call.method} ${call.path}`)).toContain(
        `POST /api/v1/jobs/${running.id}/cancel`,
      );
    });
  });
});
