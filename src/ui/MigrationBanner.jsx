import { useState } from "react";
import { hasMigratableData, migrateToNewDomain } from "../migration.js";

export default function MigrationBanner() {
  const [visible, setVisible] = useState(() => hasMigratableData());

  if (!visible) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20,
    }}>
      <div style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-2)",
        borderRadius: 10,
        padding: "28px 32px",
        maxWidth: 400,
        width: "100%",
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        display: "flex", flexDirection: "column", gap: 14,
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text-1)" }}>
          nu-map has moved
        </div>
        <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
          We're now at <strong>numap.app</strong>. Click below to move your saved plans there — it only takes a second.
        </div>
        <button
          onClick={migrateToNewDomain}
          style={{
            padding: "10px 0", borderRadius: 6,
            background: "var(--accent)", color: "white",
            border: "none", fontSize: 13, fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Move my plans to numap.app →
        </button>
        <button
          onClick={() => setVisible(false)}
          style={{
            padding: "6px 0", borderRadius: 6,
            background: "transparent", color: "var(--text-4)",
            border: "1px solid var(--border-2)", fontSize: 12,
            cursor: "pointer",
          }}
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
