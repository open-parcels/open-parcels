// The phone header's menu: a menu button with Mode and Log in, used from the keyboard. jsdom has
// no media queries, so the inline controls are rendered as well; the menu is queried by its role.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setMode } from "../lib/theme";
import { mockApi, renderApp } from "../test/helpers";

const ANONYMOUS = {
  authenticated: false,
  method: "anonymous",
  role: "reader",
  scopes: ["read"],
  csrf_token: null,
  reader_required: false,
  setup_required: false,
};

afterEach(() => {
  setMode("automatic");
  vi.restoreAllMocks();
});

describe("header menu", () => {
  it("opens from the keyboard, moves with the arrows, sets the mode and closes with Escape", async () => {
    mockApi({
      "GET /api/v1/session": () => ({ body: ANONYMOUS }),
      "GET /api/v1/parcels": () => ({ body: [] }),
    });
    const user = userEvent.setup();
    renderApp();
    const button = await screen.findByRole("button", { name: "Menu" });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");

    button.focus();
    await user.keyboard("{ArrowDown}");
    const menu = screen.getByRole("menu", { name: "Menu" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", menu.id);
    const automatic = within(menu).getByRole("menuitemradio", { name: "Automatic" });
    expect(automatic).toHaveFocus();
    expect(automatic).toHaveAttribute("aria-checked", "true");
    expect(within(menu).getByRole("group", { name: "Mode" })).toBeInTheDocument();
    const result = await axe.run(menu, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations.map((v) => v.id)).toEqual([]);

    // Up from the first entry wraps to the last, Log in.
    await user.keyboard("{ArrowUp}");
    expect(within(menu).getByRole("menuitem", { name: "Log in" })).toHaveFocus();
    await user.keyboard("{Home}{ArrowDown}{Enter}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();

    await user.click(button);
    expect(screen.getByRole("menuitemradio", { name: "Light" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("offers Log in, which opens the login page", async () => {
    mockApi({
      "GET /api/v1/session": () => ({ body: ANONYMOUS }),
      "GET /api/v1/parcels": () => ({ body: [] }),
    });
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("button", { name: "Menu" }));
    await user.click(screen.getByRole("menuitem", { name: "Log in" }));
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
  });
});
