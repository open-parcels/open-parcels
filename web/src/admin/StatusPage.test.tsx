import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi, renderApp, SIGNED_IN } from "../test/helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

/** A made-up status report: one connection in error, an inbox reconnecting, backups failing. */
const STATUS = {
  status: "degraded",
  checks: {
    database: "ok",
    connections: "degraded",
    inboxes: "degraded",
    scheduler: "ok",
    event_stream: "ok",
    backups: "degraded",
    consumers: "degraded",
  },
  checked_at: "2026-11-25T10:00:00.000Z",
  version: "2.0.0-dev.20261125",
  commit: "abc1234",
  install_id: "install-1",
  started_at: "2026-11-25T08:00:00.000Z",
  database: { detail: null },
  connections: [
    {
      id: "c1",
      provider: "demo",
      label: "Demo tracking",
      kind: "tracking",
      state: "error",
      state_reason: "update_failed",
      carrier_message: "Demo answered HTTP 500.",
      consecutive_failures: 2,
      last_run_at: "2026-11-25T09:50:00.000Z",
      last_ok_at: "2026-11-25T08:00:00.000Z",
      next_run_at: "2026-11-25T10:05:00.000Z",
      backoff_until: null,
    },
  ],
  inboxes: [
    {
      id: "i1",
      provider: "imap",
      label: "Inbox",
      kind: "mail",
      state: "error",
      state_reason: "inbox_unreachable",
      carrier_message: null,
      consecutive_failures: 0,
      last_run_at: null,
      last_ok_at: null,
      next_run_at: null,
      backoff_until: null,
      connected: false,
      reconnect_at: "2099-01-01T00:00:00.000Z",
    },
  ],
  scheduler: {
    running: true,
    in_flight: 0,
    last_cycle_at: "2026-11-25T09:59:00.000Z",
    last_error: null,
    next_run_at: "2026-11-25T10:05:00.000Z",
  },
  event_stream: { clients: 2, last_seq: 10, stored: 10, live_sessions: 0 },
  backups: {
    enabled: true,
    last_ok: false,
    last_at: "2026-11-25T03:00:00.000Z",
    last_error: "no_space",
    next_at: "2026-11-25T10:00:00.000Z",
  },
  consumers: [
    {
      id: "k1",
      consumer: "ntfy",
      label: "Phone",
      enabled: true,
      last_attempt_at: "2026-11-25T09:55:00.000Z",
      last_ok_at: null,
      last_error: "The ntfy server answered HTTP 403.",
      pending: 2,
      failed: 0,
    },
  ],
};

describe("status page", () => {
  it("shows what needs attention, per part", async () => {
    mockApi({
      "GET /api/v1/session": () => ({ body: { ...SIGNED_IN, role: "reader", scopes: ["read"] } }),
      "GET /api/v1/carriers": () => ({ body: [] }),
      "GET /api/v1/status": () => ({ body: STATUS }),
    });
    renderApp("/status");
    const service = await screen.findByRole("region", { name: "Service" });
    expect(within(service).getByRole("status")).toHaveTextContent("Needs attention");
    expect(within(service).getByRole("status")).toHaveTextContent(
      "Version 2.0.0-dev.20261125 (abc1234)",
    );
    expect(within(service).getByText("Backups")).toBeInTheDocument();

    const connections = screen.getByRole("region", { name: "Connections" });
    expect(
      within(connections).getByText(
        "The last update failed; retrying later. Details: Demo answered HTTP 500.",
      ),
    ).toBeInTheDocument();
    const inboxes = screen.getByRole("region", { name: "Inboxes" });
    expect(within(inboxes).getByText(/reconnecting/)).toBeInTheDocument();
    const background = screen.getByRole("region", { name: "Background work" });
    expect(within(background).getByText("The disk is full.")).toBeInTheDocument();
    const consumers = screen.getByRole("region", { name: "Consumers" });
    expect(
      within(consumers).getByText(
        "Last attempt failed: The ntfy server answered HTTP 403., 2 waiting",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Diagnostics are for the admin only.")).toBeInTheDocument();
  });
});
