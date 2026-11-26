import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createQueryClient } from "./api/client";
import { App } from "./App";
import { LANGUAGE } from "./i18n";
import { migrateStoredAppearance } from "./lib/theme";
import "./styles.css";

document.documentElement.lang = LANGUAGE;
migrateStoredAppearance();

const queryClient = createQueryClient();

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
}
