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
//
// ── Weight, not colour ─────────────────────────────────────────────
//
// The CHART half used to be orange on a tinted background, which was backwards. An
// accent colour reads as a recommendation — it is what a "new" or "try this" badge
// looks like — so it promoted the generated plan over the department's, which is the
// opposite of what this control should do. The catalog's plan carries authority the
// generated one cannot, and the default should feel like the default.
//
// So both halves are identical and neutral: the selected side is darker text on a
// slightly raised surface, the other is muted on nothing. Selection is legible from
// contrast alone. What steers a student toward the official plan is that it is first,
// selected on arrival, and never visually outranked — not a colour telling them the
// other one is exciting.
//
// Orange is also spoken for. `CLAUDE.md` reserves it for the Claude/MCP surfaces, so
// spending it here made two unrelated things look related.
// ═══════════════════════════════════════════════════════════════════
import { useLanguage } from "../context/LanguageContext.jsx";
import HoverTip from "./InfoTip.jsx";

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
      enabled: hasCatalog, why: t("chart.source.catalog.none"),
      tip: t("chart.source.catalog.tip") },
    { id: "chart", label: t("chart.source.chart"),
      enabled: canGenerate, why: t("chart.source.chart.none"),
      tip: t("chart.source.chart.tip") },
  ];

  return (
    <div
      role="radiogroup" aria-label={t("chart.source.label")}
      // Full width, and the same border, radius and rhythm as the variant picker, Preview
      // and the button row beneath it. It was `inline-flex`, so it sat as a short tab strip
      // above four controls that all span the panel — the one element out of alignment reads
      // as unfinished rather than as emphasis.
      style={{
        display: "flex", width: "100%", marginBottom: isPhone ? 5 : 6,
        borderRadius: 5, overflow: "hidden",
        border: "1px solid var(--border-1)",
      }}
    >
      {options.map((o) => {
        const on = value === o.id;
        return (
          // Disabled wins the tooltip. "This program does not publish a plan" is the
          // answer to why the button will not respond, and it outranks a description of
          // what the button would have done.
          <HoverTip
            key={o.id} tip={o.enabled ? o.tip : o.why}
            display="flex" width={250} style={{ flex: 1, minWidth: 0 }}
          >
            <button
              // A stable hook for the live browser test, which cannot select on the label: the
              // copy exists in eight languages, so a text selector would fail on a translation
              // rather than on a defect. See test/live/chart-ui.live.test.js.
              data-testid={`plan-source-${o.id}`}
              role="radio" aria-checked={on} disabled={!o.enabled || busy}
              onClick={() => o.enabled && onChange(o.id)}
              style={{
                width: "100%",
                fontSize: fz, fontWeight: on ? 700 : 500,
                padding: isPhone ? "4px 8px" : "6px 10px",
                border: "none", cursor: o.enabled && !busy ? "pointer" : "default",
                // ── No colour, on either side ──────────────────────────
                //
                // `--bg-2` is the fill the variant picker and Preview already use, so the
                // selected half looks like the rest of the panel rather than like a state
                // this control invented. The earlier `#e9edf3` fallback was a blue-grey,
                // which is a colour however faint — and any tint on one side is a
                // recommendation. Selection is carried by fill against transparent and by
                // text weight, nothing else.
                background: on ? "var(--bg-2)" : "transparent",
                color: !o.enabled ? "var(--text-4, #9ca3af)"
                     : on ? "var(--text-1)" : "var(--text-3)",
                opacity: busy && !on ? 0.6 : 1,
                transition: "background .12s, color .12s",
              }}
            >
              {o.label}
              {busy && on ? " …" : ""}
            </button>
          </HoverTip>
        );
      })}
    </div>
  );
}
