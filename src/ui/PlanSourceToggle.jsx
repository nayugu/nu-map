// ═══════════════════════════════════════════════════════════════════
// PLAN SOURCE TOGGLE — the catalog's plan, or CHART's
//
// Two sources for the same artifact, so this is a segmented control rather than a
// dropdown: there are exactly two, both are always meaningful, and a student should
// be able to see what the alternative IS without opening anything.
//
// ── The labels name the author, not the mechanism ──────────────────
//
// "Catalog" and "CHART" rather than "published" and "generated". The question a
// student is answering is whose plan they are looking at, and a department's plan
// carries a different kind of authority from a computed one — that difference is the
// whole reason both are offered, so the control should say it.
//
// ── Disabled is not the same as absent ─────────────────────────────
//
// A program with no published plan still shows both options, with the catalog side
// disabled and saying why. Hiding it would leave a lone button that looks like the
// only possibility, when the fact worth conveying is that the department publishes
// nothing here — which is itself a reason to want the generated one.
// ═══════════════════════════════════════════════════════════════════
import { useLanguage } from "../context/LanguageContext.jsx";

/**
 * @param {"catalog"|"chart"} value
 * @param {boolean} hasCatalog   the program publishes at least one plan
 * @param {boolean} busy         a generation is in flight
 */
export default function PlanSourceToggle({
  value, onChange, hasCatalog, canGenerate, busy, isPhone,
}) {
  const { t } = useLanguage();
  const fz = isPhone ? 6 : 10;

  const options = [
    { id: "catalog", label: t("chart.source.catalog"),
      enabled: hasCatalog, why: t("chart.source.catalog.none") },
    { id: "chart", label: t("chart.source.chart"),
      enabled: canGenerate, why: t("chart.source.chart.none") },
  ];

  return (
    <div
      role="radiogroup" aria-label={t("chart.source.label")}
      style={{
        display: "inline-flex", borderRadius: 6, overflow: "hidden",
        border: "1px solid var(--border-2)", background: "var(--bg-surface-1)",
      }}
    >
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            // A stable hook for the live browser test, which cannot select on the label: the
            // copy exists in eight languages, so a text selector would fail on a translation
            // rather than on a defect. See test/live/chart-ui.live.test.js.
            data-testid={`plan-source-${o.id}`}
            role="radio" aria-checked={on} disabled={!o.enabled || busy}
            title={o.enabled ? undefined : o.why}
            onClick={() => o.enabled && onChange(o.id)}
            style={{
              fontSize: fz, fontWeight: on ? 700 : 500,
              padding: isPhone ? "3px 8px" : "4px 12px",
              border: "none", cursor: o.enabled && !busy ? "pointer" : "default",
              // The selected side reads as the accent the Claude/generated surfaces
              // already use, so "this is the computed one" is legible at a glance.
              background: on
                ? (o.id === "chart" ? "var(--accent-soft, #fff1e3)" : "var(--bg-surface-3, #eef2ff)")
                : "transparent",
              color: !o.enabled ? "var(--text-4, #9ca3af)"
                   : on ? (o.id === "chart" ? "var(--accent, #c2410c)" : "var(--text-1)")
                   : "var(--text-3)",
              opacity: busy && !on ? 0.6 : 1,
              transition: "background .12s, color .12s",
            }}
          >
            {o.label}
            {busy && on ? " …" : ""}
          </button>
        );
      })}
    </div>
  );
}
