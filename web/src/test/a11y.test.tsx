// Automated accessibility checks (axe-core) on every page, signed in as the admin. jsdom has no
// layout or colours: contrast is checked on the design tokens instead (contrast.test.ts).
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    "GET /api/v1/parcels/counts": () => ({
      body: { active: 1, delivered: 0, archived: 0, carriers: [], connections: [] },
    }),
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

async function violations(root: Element = document.body): Promise<string[]> {
  const result = await axe.run(root, {
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

// The dialogs a page opens: opener path, the opener's name and the dialog's title. Focus trapping
// comes from the browser's modal dialog (`showModal`); jsdom has none, so it is stubbed and its
// use is checked. What is left for a person is listed in tasks/TODO.md §2.
const DIALOGS = [
  { path: "/", opener: t.shell.add, title: t.parcels.track },
  { path: "/connections", opener: t.connections.add, title: t.connections.add },
  { path: "/consumers", opener: t.consumers.add, title: t.consumers.add },
] as const;

describe("dialogs from the keyboard", () => {
  afterEach(() => {
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  });

  it.each(DIALOGS)(
    "$title: modal, named, clean, Escape closes it, focus returns",
    async (dialog) => {
      mockAll();
      const showModal = vi.fn(function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
      });
      Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
        configurable: true,
        value: showModal,
      });
      const user = userEvent.setup();
      renderApp(dialog.path);
      const openers = await screen.findAllByRole("button", { name: dialog.opener });
      const opener = openers[0];
      if (opener === undefined) throw new Error("no opener");
      opener.focus();
      await user.keyboard("{Enter}");
      const open = await screen.findByRole("dialog", { name: dialog.title });
      expect(showModal).toHaveBeenCalledOnce();
      expect(within(open).getByRole("button", { name: t.common.close })).toBeTruthy();
      expect(await violations(open)).toEqual([]);
      // Escape fires the dialog's `cancel` event in a browser.
      fireEvent(open, new Event("cancel", { cancelable: true }));
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
      expect(document.activeElement).toBe(opener);
    },
  );
});
