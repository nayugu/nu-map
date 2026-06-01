import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { applyMigrationIfPresent } from "./migration.js";

// Import localStorage data from old domain before React starts.
// If a reload was triggered, stop here — the page will re-render clean.
if (!applyMigrationIfPresent()) {
  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
