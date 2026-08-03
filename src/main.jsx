// NU Map — https://github.com/nayugu/nu-map
// Copyright (C) 2025-2026 Nathan Gu and Matthew Gu
// SPDX-License-Identifier: AGPL-3.0-only
//
// AGPL-3.0-only with an additional attribution term under section 7(b);
// see LICENSING.md and NOTICE. A commercial license is available (COMMERCIAL.md).
// The "NU Map" name and logo are not licensed — forks must be renamed.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import RecoveryBoundary from "./ui/RecoveryBoundary.jsx";
import { applyMigrationIfPresent } from "./migration.js";

// Import localStorage data from old domain before React starts.
// If a reload was triggered, stop here — the page will re-render clean.
if (!applyMigrationIfPresent()) {
  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <RecoveryBoundary>
        <App />
      </RecoveryBoundary>
    </StrictMode>
  );
  // Tell the boot-failure recovery in index.html the bundle loaded and ran, so
  // it won't reload the page. Reaching this line means the module executed —
  // exactly the failure (a 404'd/HTML-served bundle) that recovery guards against.
  window.__numapBooted?.();
}
