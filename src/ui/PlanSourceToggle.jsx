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
// ── And it is not a BUTTON ─────────────────────────────────────────
//
// The two halves used to be bordered, filled, full-width boxes — the same shape as
// "Preview", "Open as new plan" and "Replace my plan" beneath them. That put six
// identical rectangles in one 240px panel with nothing to say which two were settings
// and which three were actions, and it spent the panel's loudest element (a 700-weight
// label in a box) on a mode rather than on a verb.
//
// They are flat tabs now: text, and a 2px rule under the selected one. A mode switch
// should look like a heading you can change, not like something that happens when you
// press it. Losing the box also fixes the phone: the halves were stacked there only
// because a border and 8px of side padding left ~21px of label inside an 88px panel,
// and two words with no chrome fit side by side.
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
  // ── One sentence, not a leaflet ───────────────────────────────────
  //
  // This was a lead line, a three-bullet list and a caveat: six lines of tooltip on a two-option
  // toggle, which is more than the choice is worth and more than anyone reads with a pointer
  // hovering. It also sat beside a `Catalog` option explained in one line, so the imbalance read
  // as advocacy rather than description.
  //
  // What survives is the pair of claims that actually distinguish the two, and they are the two
  // the corpus supports: 35.5% of the departments' own 678 published variants break a hard rule
  // against zero of CHART's 773. The advisor caveat is not lost — it is stated where there is
  // room to mean it, in the explainer and under the plan itself.
  const options = [
    { id: "catalog", label: t("chart.source.catalog"),
      enabled: hasCatalog, why: t("chart.source.catalog.none"),
      tip: t("chart.source.catalog.tip"), tipTitle: undefined },
    { id: "chart", label: t("chart.source.chart"),
      enabled: canGenerate, why: t("chart.source.chart.none"),
      tip: t("chart.source.chart.tip"), tipTitle: undefined },
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
      // Sized by its LABELS, not by the panel. A full-width mode switch reads as a
      // full-width control; two words and a rule read as a caption you can change.
      // `flexWrap` is the phone's safety net rather than its layout — the two names fit
      // side by side once they are not carrying a border each, but a long translation
      // may not, and wrapping is a better answer there than two towers of syllables.
      style={{
        display: "flex", gap: isPhone ? 8 : 14, marginBottom: isPhone ? 5 : 7,
        flexWrap: "wrap", alignItems: "flex-end",
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
            style={{ flex: "0 0 auto" }}
          >
            <button
              // A stable hook for the live browser test, which cannot select on the label: the
              // copy exists in eight languages, so a text selector would fail on a translation
              // rather than on a defect. See test/live/chart-ui.live.test.js.
              data-testid={`plan-source-${o.id}`}
              role="radio" aria-checked={on} disabled={!o.enabled || busy}
              onClick={() => o.enabled && onChange(o.id)}
              style={{
                fontSize: fz, fontWeight: on ? 700 : 500,
                // Only what the underline needs: a couple of pixels of air above the rule,
                // and none at the sides at all. Side padding on a flat tab widens the
                // underline past the word it is underlining.
                padding: isPhone ? "0 0 2px" : "0 0 3px",
                whiteSpace: "nowrap",
                background: "transparent",
                // ── The rule IS the selection ──────────────────────────
                //
                // No fill, no border box. `--bg-2` used to carry this and resolved to
                // nothing — the token was referenced here and defined by neither theme, so
                // for however long that stood, "selected" was conveyed by font weight alone
                // against an identically transparent neighbour. A 2px rule states it at a
                // glance and cannot be lost to a missing colour: the unselected side spends
                // the same 2px on a transparent border, so nothing shifts when it changes.
                //
                // Still no colour, on either side. An accent here would read as a
                // recommendation, and the catalog's plan is the one with authority — what
                // steers a student to it is that it is first and selected on arrival, not
                // a tint saying the other one is exciting.
                border: "none",
                borderBottom: `2px solid ${on ? "var(--text-1)" : "transparent"}`,
                borderRadius: 0,
                cursor: o.enabled && !busy ? "pointer" : "default",
                color: !o.enabled ? "var(--text-5)"
                     : on ? "var(--text-1)" : "var(--text-4)",
                opacity: busy && !on ? 0.6 : 1,
                transition: "border-color .12s, color .12s",
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
