import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { mockApi } from "../test/helpers";
import {
  migrateStoredAppearance,
  settleAppearance,
  setMode,
  setTheme,
  useResolvedMode,
} from "./theme";
import { useThemeApplier } from "./theme-applier";

function Shown(): ReactNode {
  return <p>{useResolvedMode()}</p>;
}

function Applied(): ReactNode {
  useThemeApplier();
  return <Shown />;
}

const tokens = { font: "serif", mono: "monospace", radius: "4px", space: "16px" };
const THEMES = [
  {
    id: "default",
    name: "Open Parcels",
    description: null,
    tokens,
    light: { bg: "#eef2f9" },
    dark: { bg: "#0f172a" },
    fonts: [],
    logo: null,
    icon: null,
  },
  {
    id: "paper",
    name: "Paper",
    description: null,
    tokens,
    light: { bg: "#f5f0e6" },
    dark: null,
    fonts: [],
    logo: "/api/v1/themes/paper/files/logo.svg?v=1",
    icon: null,
  },
];

afterEach(() => {
  act(() => {
    setTheme("default");
    setMode("automatic");
    settleAppearance(null, null, false);
  });
});

function testQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("the resolved mode (OP-150)", () => {
  it("follows a choice made elsewhere at once", () => {
    render(<Shown />);
    expect(screen.getByText("light")).toBeInTheDocument();
    act(() => {
      setMode("dark");
    });
    expect(screen.getByText("dark")).toBeInTheDocument();
  });
});

describe("the theme applier", () => {
  it("puts the chosen theme's tokens for the mode on the page", async () => {
    mockApi({ "GET /api/v1/themes": () => ({ body: THEMES }) });
    render(
      <QueryClientProvider client={testQueryClient()}>
        <Applied />
      </QueryClientProvider>,
    );
    act(() => {
      setMode("dark");
    });
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#0f172a");
    });
    expect(document.documentElement.dataset["mode"]).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--radius")).toBe("4px");
  });

  it("lets a theme with one variant fix the mode", async () => {
    mockApi({ "GET /api/v1/themes": () => ({ body: THEMES }) });
    render(
      <QueryClientProvider client={testQueryClient()}>
        <Applied />
      </QueryClientProvider>,
    );
    act(() => {
      setMode("dark");
      setTheme("paper");
    });
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#f5f0e6");
    });
    expect(screen.getByText("light")).toBeInTheDocument();
    expect(document.documentElement.dataset["mode"]).toBe("light");
  });

  it("falls back to the default theme when the chosen one is gone", async () => {
    mockApi({ "GET /api/v1/themes": () => ({ body: THEMES }) });
    act(() => {
      setMode("light");
      setTheme("removed");
    });
    render(
      <QueryClientProvider client={testQueryClient()}>
        <Applied />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#eef2f9");
    });
  });
});

describe("the stored setting from before themes", () => {
  it("becomes the mode, once", () => {
    localStorage.setItem("open-parcels.theme", "dark");
    migrateStoredAppearance();
    expect(localStorage.getItem("open-parcels.mode")).toBe("dark");
    expect(localStorage.getItem("open-parcels.theme")).toBeNull();
    localStorage.setItem("open-parcels.theme", "system");
    localStorage.removeItem("open-parcels.mode");
    migrateStoredAppearance();
    expect(localStorage.getItem("open-parcels.mode")).toBeNull();
    expect(localStorage.getItem("open-parcels.theme")).toBeNull();
  });
});
