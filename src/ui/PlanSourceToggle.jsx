// ═══════════════════════════════════════════════════════════════════
// PLAN SOURCE TOGGLE — the catalog's plan, or CHART's
//
// Two sources for the same artifact, so this is a segmented control rather than a
// dropdown: there are exactly two, both are always meaningful, and a student should
// be able to see what the alternative IS without opening anything.
//
// ── The labels name the author, not the mechanism ──────────────────
//
// "Catalog" and "NU Map" rather than "published" and "generated". The question a
// student is answering is whose plan they are looking at, and a department's plan
// carries a different kind of authority from a computed one — that difference is the
// whole reason both are offered, so the control should say it.
//
// The second label said "CHART" and that was a mistake: it is the engine's internal
// name and it means nothing to anyone who has not read the source. "Catalog or CHART"
// asks a student to choose between a thing they know and an acronym. "Catalog or NU Map"
// asks them to choose between two authors, which is the actual question. The engine's
// name still appears — in the tooltip, where a reader who wants it will find it and
// nobody else has to decode it.
//
// ── And the group says what is being chosen ─────────────────────────
//
// `chart.source.label` was an `aria-label` only, so a sighted reader saw two words with
// no indication that they were alternatives at all, let alone alternatives of WHAT. It is
// now visible as a caption, and phrased as the prefix the labels complete: "Plan by" →
// "Catalog" / "NU Map".
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

  // ── A lead, four bullets, and what to do about it ──────────────────
  //
  // Three earlier attempts failed in different directions: sentence-length bullets were too
  // much to read on the way to a click, one long sentence buried five facts in a comma splice,
  // and a titled version repeated the engine's name twice — the caps header said "CHART —
  // Course Hierarchy and Requirement Timeline" directly above a line reading "Uses NU Map's
  // native engine, CHART". The lead names it once; that is enough at this size.
  //
  // "Spread across terms, full-time loads" is gone. It described the engine's own bookkeeping
  // rather than anything a student is choosing between — no one picks a plan source to get a
  // balanced credit load, and a bullet that changes nobody's decision is taking a line from
  // the four that do.
  //
  // The closing line is an INSTRUCTION, not a disclaimer. "Not an official plan" states a fact
  // and leaves the reader holding it; "double-check with an advisor" says what to do about the
  // fact, which is the only useful thing a caveat can do.
  //
  // The measured comparison — 35.5% of the departments' own 678 published variants break one
  // of the first three rules, against zero of CHART's 773 — is a stronger argument than any of
  // this, and it belongs where there is room to state it rather than assert it in passing.
  const chartTip = (
    <>
      <div style={{ marginBottom: 5 }}>{t("chart.source.chart.lead")}</div>
      <ul style={{ margin: 0, paddingInlineStart: 15, lineHeight: 1.5 }}>
        {["b1", "b2", "b3"].map(k => (
          <li key={k}>{t(`chart.source.chart.${k}`)}</li>
        ))}
      </ul>
      <div style={{ marginTop: 5, opacity: 0.75 }}>{t("chart.source.chart.caveat")}</div>
    </>
  );

  const options = [
    { id: "catalog", label: t("chart.source.catalog"),
      enabled: hasCatalog, why: t("chart.source.catalog.none"),
      tip: t("chart.source.catalog.tip"), tipTitle: undefined },
    { id: "chart", label: t("chart.source.chart"),
      enabled: canGenerate, why: t("chart.source.chart.none"),
      // No title. The lead already names the engine, and a caps header repeating it was
      // the second grey heading asked to go from this control.
      tip: chartTip, tipTitle: undefined },
  ];

  // ── No caption ────────────────────────────────────────────────────
  //
  // A visible "Plan by" label was tried and removed. Under "SAMPLE PLAN OF STUDY" it was a
  // second grey line before the first control — and once the labels read "Catalog" and
  // "NU Map" rather than "Catalog" and "CHART", there is nothing left to explain: two authors,
  // one of them selected. The caption was scaffolding for a label that no longer needs it.
  //
  // It survives as the group's `aria-label`, where it does real work: a screen reader
  // announces the pair as a named radio group rather than two unrelated buttons.
  return (
    <div
      role="radiogroup" aria-label={t("chart.source.label")}
      // Full width, with the same 6px gap between its two halves as the variant-picker/Preview
      // row and the Lay-out/Replace row beneath it — this used to be ONE merged, bordered strip
      // with no gap at all, which read as a different kind of control from its neighbours
      // rather than as the same rhythm repeated three times down the panel.
      style={{
        display: "flex", width: "100%", gap: 6, marginBottom: isPhone ? 5 : 6,
      }}
    >
      {options.map((o) => {
        const on = value === o.id;
        return (
          // Disabled wins the tooltip. "This program does not publish a plan" is the
          // answer to why the button will not respond, and it outranks a description of
          // what the button would have done.
          <HoverTip
            key={o.id}
            tip={o.enabled ? o.tip : o.why}
            title={o.enabled ? o.tipTitle : undefined}
            display="flex" width={o.enabled && o.tipTitle ? 290 : 250}
            style={{ flex: 1, minWidth: 0 }}
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
                // Its own border and radius, same as every other button in this panel, now that
                // the two halves are separate pieces rather than one box divided by fill alone.
                border: "1px solid var(--border-1)", borderRadius: 5,
                cursor: o.enabled && !busy ? "pointer" : "default",
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
