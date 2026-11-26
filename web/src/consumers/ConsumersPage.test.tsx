import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi, renderApp, SIGNED_IN } from "../test/helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

/** The ntfy consumer's forms as the server describes them (made-up, trimmed). */
const NTFY = {
  id: "ntfy",
  name: "ntfy",
  description: "Push notifications to an ntfy topic, with a link to the parcel.",
  tier: "builtin",
  fields: [],
  hosts: ["config:server"],
  smtp: false,
  config_schema: {
    type: "object",
    properties: {
      server: { type: "string", title: "Server" },
      topic: { type: "string", title: "Topic" },
    },
    required: ["server", "topic"],
  },
  secret_schema: {
    type: "object",
    properties: { token: { type: "string", title: "Access token" } },
    required: ["token"],
  },
};

const PHONE = {
  id: "00000000-0000-4000-8000-0000000000a1",
  consumer: "ntfy",
  label: "Phone",
  config: { server: "https://ntfy.example", topic: "parcels", priority: 3 },
  has_secret: false,
  rules: {
    events: ["delivered"],
    directions: ["receiving"],
    connections: null,
    quiet_hours: null,
    digest: "immediately",
    language: "en",
  },
  enabled: true,
  last_attempt_at: null,
  last_ok_at: null,
  last_error: null,
};

describe("consumers page", () => {
  it("adds a consumer from the picker with its settings and rules", async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      "GET /api/v1/session": () => ({ body: SIGNED_IN }),
      "GET /api/v1/carriers": () => ({ body: [] }),
      "GET /api/v1/connections": () => ({ body: [] }),
      "GET /api/v1/consumers": () => ({ body: [] }),
      "GET /api/v1/consumers/available": () => ({ body: [NTFY] }),
      "POST /api/v1/consumers": () => ({ status: 201, body: PHONE }),
    });
    renderApp("/consumers");
    await user.click(await screen.findByRole("button", { name: "Add a consumer" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /ntfy/ }));
    await user.type(within(dialog).getByLabelText("Server *"), "https://ntfy.example");
    await user.type(within(dialog).getByLabelText("Topic *"), "parcels");
    await user.click(within(dialog).getByRole("checkbox", { name: "On its way" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Sending" }));
    await user.selectOptions(within(dialog).getByLabelText("When"), "daily");
    await user.click(within(dialog).getByRole("button", { name: "Add consumer" }));
    await waitFor(() => {
      expect(calls.some((call) => call.method === "POST")).toBe(true);
    });
    const body = calls.find((call) => call.method === "POST")?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      consumer: "ntfy",
      label: "ntfy",
      config: { server: "https://ntfy.example", topic: "parcels" },
      secret: null,
      rules: { directions: ["receiving"], digest: "daily", connections: null },
    });
    expect((body["rules"] as { events: string[] }).events).toContain("in_transit");
  });

  it("sends a test notification and shows the outcome", async () => {
    const user = userEvent.setup();
    mockApi({
      "GET /api/v1/session": () => ({ body: SIGNED_IN }),
      "GET /api/v1/carriers": () => ({ body: [] }),
      "GET /api/v1/consumers": () => ({ body: [PHONE] }),
      "GET /api/v1/consumers/available": () => ({ body: [NTFY] }),
      [`POST /api/v1/consumers/${PHONE.id}/test`]: () => ({
        body: { ok: false, retry: false, message: "The ntfy server answered HTTP 403." },
      }),
    });
    renderApp("/consumers");
    expect(await screen.findByText("Nothing delivered yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send test notification" }));
    expect(
      await screen.findByText("Not delivered: The ntfy server answered HTTP 403."),
    ).toBeInTheDocument();
  });
});
