import { fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import { carrier } from "../test/helpers";
import { pickerEntries, searchEntries, type PickerEntry } from "./picker";
import { ProviderPicker } from "./ProviderPicker";

const CARRIERS = [
  carrier("dhl", "DHL", {
    countries: ["*"],
    aliases: ["Deutsche Post"],
    logo: "/api/v1/carriers/dhl/logo?v=0123456789ab",
  }),
  carrier("ceska_posta", "Česká pošta", { countries: ["CZ"] }),
  carrier("postnord", "PostNord", { countries: ["DK", "SE", "NO", "FI", "IS"] }),
  carrier("universal_lookup", "Universal lookup", { countries: ["*"], fallback: true }),
];
const ENTRIES = pickerEntries(CARRIERS);

const names = (entries: readonly PickerEntry[]): string[] => entries.map((entry) => entry.name);

describe("provider search", () => {
  it("matches names, aliases and country codes and names, without accents", () => {
    expect(names(searchEntries(ENTRIES, "deutsche"))).toEqual(["DHL"]);
    expect(names(searchEntries(ENTRIES, "posta"))).toEqual(["Česká pošta"]);
    expect(names(searchEntries(ENTRIES, "czech"))).toEqual(["Česká pošta"]);
    expect(names(searchEntries(ENTRIES, "se"))).toContain("PostNord");
    expect(names(searchEntries(ENTRIES, "imap"))).toEqual([t.connections.inboxOption]);
    expect(searchEntries(ENTRIES, "  ")).toHaveLength(ENTRIES.length);
  });
});

describe("the provider picker", () => {
  it("lists providers, then the inbox and fallback services in their own section", () => {
    render(<ProviderPicker entries={ENTRIES} onChoose={vi.fn()} />);
    const providers = screen.getByRole("region", { name: t.connections.pickerProviders });
    const other = screen.getByRole("region", { name: t.connections.pickerOther });
    expect(providers).toHaveTextContent("DHL");
    expect(providers).not.toHaveTextContent("Universal lookup");
    expect(other).toHaveTextContent("Universal lookup");
    expect(other).toHaveTextContent(t.connections.inboxOption);
    expect(screen.getByRole("status")).toHaveTextContent(t.connections.pickerResults(5));
    // The logo is a bundled path; providers without one get a monogram.
    expect(document.querySelector("img.carrier-logo")?.getAttribute("src")).toContain(
      "/api/v1/carriers/dhl/logo",
    );
    expect(document.querySelector('[data-initials="Čp"]')).not.toBeNull();
    // Five countries: four badges and "+1"; every country is read out in full.
    expect(screen.getByRole("button", { name: /PostNord/ })).toHaveTextContent("+1");
  });

  it("filters while typing and picks the first match on Enter", () => {
    const onChoose = vi.fn();
    render(<ProviderPicker entries={ENTRIES} onChoose={onChoose} />);
    const search = screen.getByRole("searchbox", { name: t.connections.pickerSearch });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: "nord" } });
    expect(screen.queryByText("DHL")).toBeNull();
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChoose).toHaveBeenCalledWith("postnord");
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByRole("status")).toHaveTextContent(t.connections.pickerNone);
  });

  it("moves through the rows with the arrow keys", () => {
    render(<ProviderPicker entries={ENTRIES} onChoose={vi.fn()} />);
    const search = screen.getByRole("searchbox");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    const [first, second] = screen.getAllByRole("button");
    const rows = screen.getAllByRole("button");
    if (first === undefined || second === undefined) {
      throw new Error("expected rows");
    }
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: "End" });
    expect(rows.at(-1)).toHaveFocus();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <main>
        <ProviderPicker entries={ENTRIES} onChoose={vi.fn()} />
      </main>,
    );
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations.map((violation) => violation.id)).toEqual([]);
  });
});
