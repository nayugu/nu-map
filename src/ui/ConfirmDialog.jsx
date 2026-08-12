// ═══════════════════════════════════════════════════════════════════
// ConfirmDialog — the in-app confirmation modal.
//
// Extracted from PlanLibrary, which had the only real one. Everywhere else
// asked with native window.confirm(), and that mattered for two reasons
// beyond looks:
//
//   1. A native dialog cannot be localized. The header's bulk delete asked
//      "Delete 3 plans?" in hardcoded English — including the English plural
//      rule — in all 8 locales, on the single most destructive control in the
//      app. Every other user-facing string in this repo is translated by hand;
//      this one could not be.
//   2. A native dialog cannot say what it is about to destroy. It gets one
//      string, so it cannot show the scope of a recursive delete, cannot mark
//      the difference between a recoverable delete and a permanent one, and
//      cannot style the permanent case differently.
//
// `danger` is the flag for genuinely irreversible actions (emptying the trash).
// Ordinary deletes are now recoverable, so they should NOT set it — a warning
// colour on a reversible action is how people learn to click through warnings.
// ═══════════════════════════════════════════════════════════════════

import React, { useEffect, useRef } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";

/**
 * @param {object}   p
 * @param {string}   p.title        The question. Already localized.
 * @param {React.ReactNode} [p.body] Detail beneath the question.
 * @param {string}   [p.confirmLabel]
 * @param {string}   [p.cancelLabel]
 * @param {boolean}  [p.danger]     True only when the action destroys data for good.
 * @param {() => void} p.onConfirm
 * @param {() => void} p.onCancel
 */
export default function ConfirmDialog({
  title, body, confirmLabel, cancelLabel, danger = false, onConfirm, onCancel,
}) {
  const { t } = useLanguage();
  const confirmRef = useRef(null);

  // Escape cancels. Registered in capture phase because this renders inside
  // panels that close on Escape themselves — without capture, one keypress
  // would dismiss the dialog AND the panel behind it, so a user backing out of
  // a delete would lose their place in the library.
  useEffect(() => {
    const h = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      onCancel();
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [onCancel]);

  // Focus the confirm button so Enter works, matching the library's old
  // behaviour. For a `danger` action focus stays off it deliberately: a stray
  // Enter must not permanently delete anything.
  useEffect(() => {
    if (!danger) confirmRef.current?.focus();
  }, [danger]);

  return (
    <div
      onClick={e => { e.stopPropagation(); onCancel(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 10100, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--bg-surface)", border: "1px solid var(--border-2)",
          borderRadius: 12, maxWidth: 330, width: "100%", padding: "15px 16px 13px",
          boxShadow: "var(--shadow-modal)",
        }}
      >
        <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text-1)", marginBottom: 7 }}>
          {title}
        </div>
        {body && (
          <div style={{
            fontSize: 10.5, color: "var(--text-4)",
            lineHeight: "calc(1.6 * var(--lh-scale, 1))", marginBottom: 12,
          }}>
            {body}
          </div>
        )}
        <div style={{ display: "flex", gap: 7 }}>
          <button onClick={onCancel} style={{
            flex: 1, fontSize: 11, padding: "6px 10px", borderRadius: 6, cursor: "pointer",
            background: "var(--bg-surface-2)", border: "1px solid var(--border-2)",
            color: "var(--text-3)", fontFamily: "inherit",
          }}>{cancelLabel ?? t("folders.delete.cancel")}</button>
          <button ref={confirmRef} onClick={onConfirm} style={{
            flex: 1, fontSize: 11, fontWeight: 700, padding: "6px 10px", borderRadius: 6,
            cursor: "pointer", background: "var(--error-bg, rgba(239,68,68,0.12))",
            border: "1px solid var(--error)", color: "var(--error)", fontFamily: "inherit",
          }}>{confirmLabel ?? t("folders.delete.confirm")}</button>
        </div>
      </div>
    </div>
  );
}
