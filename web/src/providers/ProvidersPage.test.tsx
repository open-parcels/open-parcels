import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi, renderApp, SIGNED_IN } from "../test/helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

const REPO = "https://github.com/example/op-extras";
const COMMIT = "1".repeat(40);

const INSTALLED = {
  items: [
    {
      kind: "provider",
      id: "dhl",
      name: "DHL",
      tier: "builtin",
      version: null,
      repository: null,
      commit: null,
      auto_update: true,
      auto_update_fixed: true,
    },
    {
      kind: "theme",
      id: "paper_copy",
      name: "Paper copy",
      tier: "custom",
      version: "v1.0.0",
      repository: REPO,
      commit: COMMIT,
      auto_update: false,
      auto_update_fixed: false,
    },
  ],
  registry: { checked_at: "2026-11-18T12:00:00.000Z", stale_days: 0, error: null },
  remote: true,
  community: true,
};

const COMMUNITY = {
  items: [
    {
      kind: null,
      id: null,
      name: "op-extras",
      description: "Extras",
      tier: "community",
      repository: REPO,
      version: null,
      commit: null,
      stars: 3,
      updated_at: "2026-11-17T00:00:00Z",
      installed: false,
      similar_to: "dhl",
    },
  ],
  checked_at: "2026-11-18T12:00:00.000Z",
  error: null,
};

const OFFER = {
  repository: REPO,
  version: "v1.0.0",
  commit: COMMIT,
  items: [
    {
      kind: "theme",
      id: "night",
      name: "Night",
      folder: "themes/night",
      description: null,
      hosts: [],
      refusal: null,
      detail: null,
    },
    {
      kind: "provider",
      id: "extra_carrier",
      name: "Extra",
      folder: "providers/extra_carrier",
      description: null,
      hosts: ["api.extra.example"],
      refusal: "needs_bundles",
      detail: null,
    },
  ],
};

describe("providers page", () => {
  it("shows tiers and switches auto-update of an installed item", async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      "GET /api/v1/session": () => ({ body: SIGNED_IN }),
      "GET /api/v1/providers/installed": () => ({ body: INSTALLED }),
      "PATCH /api/v1/providers/theme/paper_copy": () => ({ status: 204 }),
    });
    renderApp("/providers");
    expect(await screen.findByText("Paper copy")).toBeInTheDocument();
    expect(screen.getByText("Built in")).toBeInTheDocument();
    expect(screen.getByText("Custom")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Updates with open-parcels" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Update automatically" }));
    await waitFor(() => {
      expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ auto_update: true });
    });
  });

  it("installs a community theme only after the warning is acknowledged", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const calls = mockApi({
      "GET /api/v1/session": () => ({ body: SIGNED_IN }),
      "GET /api/v1/providers/installed": () => ({ body: INSTALLED }),
      "GET /api/v1/providers/available": () => ({ body: COMMUNITY }),
      "POST /api/v1/providers/check": () => ({ body: OFFER }),
      "POST /api/v1/providers/install": () => ({
        body: { ...INSTALLED.items[1], id: "night", name: "Night", tier: "community" },
      }),
    });
    renderApp("/providers");
    await user.click(await screen.findByRole("radio", { name: "Available" }));
    await user.click(await screen.findByRole("radio", { name: "Community" }));
    expect(await screen.findByText('Looks similar to "dhl"')).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Check" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Check repository" }));
    expect(await within(dialog).findByText(/cannot run installed code yet/)).toBeInTheDocument();
    const install = within(dialog).getByRole("button", { name: "Install" });
    expect(install).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Copy review prompt" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`${REPO} at commit ${COMMIT}`));
    expect(await within(dialog).findByText("Copied")).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("checkbox", { name: "I understand this code is unreviewed." }),
    );
    await user.click(install);
    await waitFor(() => {
      expect(calls.find((call) => call.path.endsWith("/install"))?.body).toEqual({
        url: REPO,
        ref: COMMIT,
        kind: "theme",
        id: "night",
        source: "community",
      });
    });
  });
});
