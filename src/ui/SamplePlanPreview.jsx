// ═══════════════════════════════════════════════════════════════════
// SAMPLE PLAN PREVIEW — the plan on the planner, before committing to it.
//
// ── Why a dialog and not a hovercard ───────────────────────────────
//
// Measured over the committed corpus (385 plan files, 678 variants): the
// median variant is 4 years, 14 term blocks and 39 entries; p90 is 48 entries
// and the worst is 83. Nothing that size fits in a tooltip, and a tooltip
// cannot be scrolled — reaching for the scrollbar dismisses it. A hover
// trigger also fires exactly when the pointer is on its way to the button,
// and never fires at all on a touch screen. So: a real dialog, opened on
// click, from beside the variant picker and from inside the replace
// confirmation.
//
// ── Why it looks like the planner ──────────────────────────────────
//
// This draws the ordinary NU Map rows at reduced scale — the same seasonal row
// colours, the same subject-striped cards, summer split into its two halves,
// co-op as a block across the term. A student is being asked what their plan
// will look like, and the only honest answer is a picture of their plan. It is
// STATIC: no drag handles, no click targets, no inputs. Nothing in here can
// change anything, which is what makes it safe to show before the decision.
//
// It is a reduced RE-RENDER, not the live grid. The live rows read the planner
// context — one `placements`, one set of drag handlers — so showing the real
// SemRow here would mean either mutating the student's plan to preview it or
// standing up a second planner provider that writes to the same localStorage.
// The shared pure helpers (`buildSemesterView`, `cardsIn`, `loadIn`) do the
// part that must not diverge: card resolution, ordering and term load are
// computed by the same functions the real grid uses.
//
// ── Why it re-runs the apply instead of reading plan.json ──────────
//
// It renders the OUTPUT of `applySamplePlan`, with the same arguments the
// buttons use, not a second walk of the published grid. The two can disagree —
// the apply merges consecutive co-op cells into one block, adds corequisites
// the department left implicit (218 gaps across the corpus), and drops terms
// past the end of the student's timeline. Both verbs lay out onto an EMPTY
// canvas, so what this draws is exactly what lands.
//
// ── What it warns about, and what it doesn't ───────────────────────
//
// Terms past the end of the timeline: 19.0% of variants against a four-year
// plan (264 terms), 0.3% against five years — frequent enough to earn a line.
// Unknown course codes: 0 of 678 variants, so that note is not rendered at
// all. A warning that has never once fired is furniture.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useMemo } from "react";
import { createPortal }       from "react-dom";
import { usePlanner }         from "../context/PlannerContext.jsx";
import { usePort }            from "../context/InstitutionContext.jsx";
import { useLanguage }        from "../context/LanguageContext.jsx";
import { ICreditSystem }      from "../ports/ICreditSystem.js";
import { ISpecialTerms }      from "../ports/ISpecialTerms.js";
import { TText }              from "../context/TranslationContext.jsx";
import { SEM_NAME_KEY }       from "./SemLabel.jsx";
import { buildSemesterView }  from "../core/semesterView.js";
import { applySamplePlan }    from "../core/applySamplePlan.js";
// The rows themselves. They used to live in this file; they moved out when the derivation
// walkthrough needed the same picture — see `MiniPlanGrid.jsx` for why a second hand copy was
// the wrong answer. Nothing about what this dialog draws changed in the move.
import { TYPE, planRows, MiniPlanGrid } from "./MiniPlanGrid.jsx";

// The type scale, the rows and the cards are all `MiniPlanGrid`'s now. The dialog is wider than
// the old one to pay for that scale; the layout stays compact, the letters do not.

export default function SamplePlanPreview({
  open, onClose, onReplace, plan, programData, programLabel, studentType,
}) {
  const {
    SEMESTERS, courseMap, isPhone,
    planEntSem, planEntYear, planGradSem, planGradYear,
  } = usePlanner();
  const { t }   = useLanguage();
  const credit  = usePort(ICreditSystem);
  const special = usePort(ISpecialTerms);

  useEffect(() => {
    if (!open) return;
    // Stopped, not just handled: this can sit on top of the replace
    // confirmation, and one Escape should close one layer.
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const coopDurations = useMemo(
    () => (special.getTypes?.() ?? []).find(x => x.id === "coop")?.durations?.map(d => d.duration) ?? [6],
    [special]);

  const laid = useMemo(() => (plan
    ? applySamplePlan(plan, { semesters: SEMESTERS, courseMap, programData, coopDurations })
    : null), [plan, SEMESTERS, courseMap, programData, coopDurations]);

  // Same view the grid draws from, so ordering and load cannot drift.
  const view = useMemo(() => buildSemesterView({
    placements:   laid?.placements   ?? {},
    reservations: laid?.reservations ?? {},
    courseMap,
  }), [laid, courseMap]);

  // Start / continuation, taken from the run the apply already computed rather
  // than re-deriving it from term weights: `spans` IS the set of semesters the
  // block covers, so the preview cannot disagree with the block it previews.
  const [startMap, contMap] = useMemo(() => {
    const s = {}, c = {};
    for (const run of laid?.coops ?? []) {
      s[run.semId] = run.id;
      for (const semId of run.spans) if (semId !== run.semId) c[semId] = run.id;
    }
    return [s, c];
  }, [laid]);

  const overflow = laid?.notes.filter(n => n.kind === "outside-timeline").length ?? 0;

  // Which co-op cycle this variant actually runs — READ from the blocks the
  // apply produced, not parsed out of the label. The label is the department's
  // English prose ("Two Co-ops in Spring/Summer 1"); the blocks are where they
  // landed. NU sells two cycles, spring+summer A and summer B+fall, so the
  // start term names the cycle. A variant with no co-ops says nothing.
  const cycles = useMemo(() => {
    const out = new Set();
    for (const run of laid?.coops ?? []) {
      const sem = SEMESTERS.find(s => s.id === run.semId);
      if (!sem) continue;
      out.add(sem.semTypeId === "spring" || sem.semTypeId === "sumA" ? "spring" : "fall");
    }
    return [...out];
  }, [laid, SEMESTERS]);

  // Rows, paired exactly as App.jsx pairs them: consecutive sumA + sumB share one row, and the
  // Incoming Credit row is dropped. Shared with the walkthrough, so the two cannot pair differently.
  const rows = useMemo(() => planRows(SEMESTERS), [SEMESTERS]);

  if (!open || !plan || !laid) return null;

  const unit  = credit.getUnitName();
  const types = special.getTypes?.() ?? [];
  // The registration ceiling and the size of a standard course, so an empty slot is only
  // drawn where a course could actually go. See `TermBody`.
  const termMax  = credit.getSemesterMax?.(studentType) ?? Infinity;
  const oneCourse = credit.getStandardValue?.() ?? 4;
  const ctx   = { view, startMap, contMap, laid, types, unit, isPhone, t, termMax, oneCourse };

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 310,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 14,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="spp-title"
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--bg-surface)", border: "1px solid var(--border-2)",
          // Wider than it was: the type scale went up, and the alternative to
          // more width is narrower columns, which is where the small sizes
          // came from in the first place.
          borderRadius: 12, maxWidth: 900, width: "100%",
          maxHeight: "calc(100vh - 28px)", display: "flex", flexDirection: "column",
          boxShadow: "var(--shadow-modal)", color: "var(--text-2)",
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        {/* Head — fixed, so the plan scrolls under its own name. */}
        <div style={{
          padding: "16px 18px 12px", borderBottom: "1px solid var(--border-1)", flex: "0 0 auto",
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div id="spp-title" style={{
                fontSize: TYPE.eyebrow, fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-4)",
              }}>{t("grad.plan.preview.title")}</div>
              {/* The program leads. Which degree this is was the one thing the
                  title could not be read without — a variant label alone
                  ("Four Years, Two Co-ops") names no major at all. */}
              {!!programLabel && (
                <div style={{
                  fontSize: TYPE.title, fontWeight: 800, color: "var(--text-1)", marginTop: 3,
                  lineHeight: "calc(1.25 * var(--lh-scale, 1))",
                }}>
                  {programLabel}
                </div>
              )}
              <div style={{
                fontSize: programLabel ? TYPE.lead : TYPE.title,
                fontWeight: programLabel ? 600 : 800,
                color: programLabel ? "var(--text-3)" : "var(--text-1)", marginTop: 3,
                lineHeight: "calc(1.3 * var(--lh-scale, 1))",
              }}>
                <TText>{plan.label ?? ""}</TText>
              </div>
              {/* The facts of the run: when it starts and ends, what arrives,
                  and which co-op cycle it puts you on. */}
              <div style={{
                fontSize: TYPE.meta, color: "var(--text-4)", marginTop: 6,
                lineHeight: "calc(1.5 * var(--lh-scale, 1))",
              }}>
                {[
                  `${cohortName(planEntSem,  planEntYear,  t)} → ${cohortName(planGradSem, planGradYear, t)}`,
                  t("onboard.sampleplan.counts", {
                    courses: laid.placed.length, placeholders: laid.reserved.length }),
                  laid.coops.length ? t("grad.plan.preview.coops", { n: laid.coops.length }) : null,
                  ...cycles.map(c => t(`grad.plan.cycle.${c}`)),
                ].filter(Boolean).join(" · ")}
              </div>
            </div>
            <button onClick={onClose} aria-label={t("grad.plan.preview.close")} style={closeX}>✕</button>
          </div>
        </div>

        {/* The plan, drawn as the planner draws it. Nothing here is a control. */}
        <div style={{ padding: "10px 14px", overflowY: "auto", flex: "1 1 auto", background: "var(--bg-app)" }}>
          <MiniPlanGrid rows={rows} {...ctx} />
        </div>

        {/* Foot — the one warning the corpus says actually happens. */}
        <div style={{
          padding: "10px 18px 14px", borderTop: "1px solid var(--border-1)", flex: "0 0 auto",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          {overflow > 0 && (
            <div style={{
              fontSize: TYPE.meta, color: "var(--warn-badge-text)", flex: 1,
              lineHeight: "calc(1.4 * var(--lh-scale, 1))",
            }}>
              ⚠ {t("grad.plan.overflow", { n: overflow })}
            </div>
          )}
          <div style={{ flex: overflow > 0 ? "0 0 auto" : 1 }} />
          <button onClick={onClose} style={{
            fontSize: TYPE.action, fontWeight: 600, padding: "7px 16px", borderRadius: 6, cursor: "pointer",
            background: "var(--bg-2)", color: "var(--text-2)", border: "1px solid var(--border-1)",
          }}>{t("grad.plan.preview.close")}</button>
          {/* Acting from here goes through the SAME confirmation as the button
              in the panel. Having just read the plan is the best-informed
              anyone gets, but it is still not the moment to skip being told
              what it costs. */}
          {onReplace && (
            <button onClick={onReplace} style={{
              fontSize: TYPE.action, fontWeight: 700, padding: "7px 16px", borderRadius: 6, cursor: "pointer",
              background: "var(--error-bg)", color: "var(--error-text)", border: "1px solid var(--error)",
            }}>{t("grad.plan.replace")}</button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * "Fall 2026" for a cohort endpoint.
 *
 * The written season keys again, not the engine: this sits beside the row
 * labels, and the two reading differently in the same dialog would be worse
 * than either reading oddly.
 */
function cohortName(sem, year, t) {
  const key = SEM_NAME_KEY[sem];
  return `${key ? t(key) : sem}${year ? ` ${year}` : ""}`;
}

const closeX = {
  // A glyph, not text — sized to be a comfortable 44px-ish target rather than
  // to sit on the type scale.
  fontSize: 16, lineHeight: 1, background: "transparent", border: "none",
  color: "var(--text-5)", cursor: "pointer", padding: "2px 0 6px 8px", flex: "0 0 auto",
};
