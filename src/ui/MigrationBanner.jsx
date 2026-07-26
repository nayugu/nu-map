import { useState } from "react";
import { hasMigratableData, migrateToNewDomain } from "../migration.js";

export default function MigrationBanner() {
  const [visible, setVisible] = useState(() => hasMigratableData());

  if (!visible) return null;

  return (
    <div
      onClick={() => setVisible(false)}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.75)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 14,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--bg-surface)", border: "1px solid var(--border-2)",
          borderRadius: 12, maxWidth: 400, width: "100%",
          padding: "16px 14px 14px", boxShadow: "var(--shadow-modal)",
          display: "flex", flexDirection: "column", gap: 10,
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text-1)" }}>
          nu-map has moved
        </div>
        <div style={{ fontSize: 11, color: "var(--text-2)", lineHeight: "calc(1.6 * var(--lh-scale, 1))" }}>
          We're now at <strong>numap.app</strong>. Click below to move your saved plans — it only takes a second.
        </div>
        <button
          onClick={migrateToNewDomain}
          style={{
            width: "100%", padding: "7px 0", borderRadius: 6,
            background: "var(--link-bg)", border: "1px solid var(--link-1)",
            color: "var(--link-1)", fontSize: 11, fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Move my plans to numap.app →
        </button>
        <button
          onClick={() => setVisible(false)}
          style={{
            width: "100%", padding: "7px 0", borderRadius: 6,
            background: "transparent", border: "1px solid var(--border-2)",
            color: "var(--text-4)", fontSize: 11, fontWeight: 400,
            cursor: "pointer",
          }}
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
