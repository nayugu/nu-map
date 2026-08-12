// ═══════════════════════════════════════════════════════════════════
// SAMPLE PLAN OFFER — inside the major card.
//
// It lives here, not beside the program picker, because it belongs to the
// program you have CHOSEN rather than to choosing one. (That reasoning is
// inherited from the superseded design, which got this part right.)
//
// ── What it does differently ───────────────────────────────────────
//
// It is not a permanent control. `sampleplanOffer` decides whether to appear at
// all, so it is silent when the program publishes no plan (632 of 1,017), when
// the canvas already IS that plan, and for a true double major.
//
// The counts are shown BEFORE the action, not reported after it. "Adds 26
// courses and 22 placeholders" is a decision input; "placed 26 courses" is a
// receipt for a decision already made. Half of a sample plan names no course,
// so a student who is not told that meets a wall of blanks.
//
// The primary verb follows what is at stake. On an empty canvas there is
// nothing to lose, so it lays the plan out. On an occupied one the safe action
// leads — a new plan, which is also where "what if I did the five-year
// version?" belongs — and REPLACE is a demoted, confirmed action. Provenance
// proves the canvas started as a sample plan; it does not prove the student has
// left it alone.
//
// Demoted means SECOND, not shouted at. Replace sits beside the safe verb in
// the same colour, because the weight of a destructive action belongs in its
// confirmation (`ReplaceConfirm`, below), not in a red button that reads as an
// invitation to press it.
//
// "Add here" is deliberately gone. A sample plan assumes year 1 is your first
// year with nothing done, so adding it beside existing work leaves a canvas
// that is neither the student's nor the department's.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal }       from "react-dom";
import { usePlanner }         from "../context/PlannerContext.jsx";
import { usePort }            from "../context/InstitutionContext.jsx";
import { useLanguage }        from "../context/LanguageContext.jsx";
import { IMajorRequirements } from "../ports/IMajorRequirements.js";
import { ISpecialTerms }      from "../ports/ISpecialTerms.js";
import { applySamplePlan }    from "../core/applySamplePlan.js";
import SamplePlanPreview      from "./SamplePlanPreview.jsx";
import {
  sampleplanOffer, variantsFor, describeTemplate, isPlanEmpty,
} from "../core/planTemplate.js";

/** Namespaced like the other grad-panel collapse flags. */
const COLLAPSE_KEY = "numap-grad-expand-sampleplan";

export default function SamplePlanOffer({ path, isGrad, programData, isPhone }) {
  const majorRequirements = usePort(IMajorRequirements);
  const specialTerms      = usePort(ISpecialTerms);
  const { t } = useLanguage();
  const {
    major2, appliedTemplate, placements, reservations, specialTermPl, placedOut,
    SEMESTERS, courseMap, applySamplePlanToPlan, createPlan, doUndo,
    // The plan LIBRARY's slots, renamed: `plans` below is this component's
    // list of sample-plan variants, which is a different thing entirely.
    plans: planSlots,
    planEntSem, planEntYear, planGradSem, planGradYear, studentType,
  } = usePlanner();

  const [plans,      setPlans]      = useState(null);
  const [variantIdx, setVariantIdx] = useState(0);
  const [justDid,    setJustDid]    = useState(null);   // "loaded" | "replaced" | "opened"
  const [confirming, setConfirming] = useState(false);  // the replace dialog
  const [previewing, setPreviewing] = useState(false);  // the plan preview

  // Collapse is remembered ACROSS sessions but chosen BY STATE the first time.
  // An explicit preference outranks the state default, the same rule the other
  // credits toggle follows — someone who folded this away meant it.
  const [openPref, setOpenPref] = useState(() => {
    try { const v = localStorage.getItem(COLLAPSE_KEY); return v === null ? null : v === "true"; }
    catch { return null; }
  });
  const setOpen = (next) => {
    const val = typeof next === "function" ? next(openResolved) : next;
    setOpenPref(val);
    try { localStorage.setItem(COLLAPSE_KEY, String(val)); } catch {}
  };

  // Question 1 of the rule, answered synchronously so nothing flickers in for a
  // program that publishes nothing.
  const hasSamplePlan = !!path && !!majorRequirements.hasSamplePlan?.(path, isGrad);

  useEffect(() => {
    setPlans(null); setVariantIdx(0); setJustDid(null); setConfirming(false); setPreviewing(false);
    if (!hasSamplePlan) return;
    let live = true;
    majorRequirements.loadSamplePlans(path, isGrad)
      .then(g => { if (live) setPlans(g?.plans ?? null); })
      .catch(() => { if (live) setPlans(null); });
    return () => { live = false; };
  }, [path, isGrad, hasSamplePlan, majorRequirements]);

  const canvasEmpty = useMemo(
    () => isPlanEmpty({ placements, reservations, specialTermPl, placedOut }),
    [placements, reservations, specialTermPl, placedOut]);

  const offer = useMemo(() => sampleplanOffer({
    major: path, major2, hasSamplePlan, appliedTemplate, canvasEmpty,
  }), [path, major2, hasSamplePlan, appliedTemplate, canvasEmpty]);

  const years = Math.round(((planGradYear * 2 + (planGradSem === "fall" ? 1 : 0)) -
                            (planEntYear  * 2 + (planEntSem  === "fall" ? 1 : 0)) + 1) / 2);
  const variants = useMemo(() => variantsFor(plans ?? [], { years }), [plans, years]);
  const safeIdx  = Math.min(Math.max(variantIdx, 0), Math.max(variants.length - 1, 0));
  const chosen   = variants[safeIdx] ?? null;

  // Counted against the canvas the OFFERED VERB will actually use.
  //
  // This was wrong and read as harmless. On an occupied canvas the verbs are
  // "open as new plan" and "replace", and both lay the plan out on a CLEAN
  // canvas — so counting against the current one produced "adds 2 courses and
  // 16 placeholders" for a student with sixteen courses already chosen. It
  // described an action that was not on offer, and made replacing sound like a
  // small addition when it would discard every one of those choices.
  const ontoEmpty = offer.state !== "load";
  const counts = useMemo(() => (chosen ? describeTemplate(chosen, ontoEmpty
    ? { semesters: SEMESTERS, courseMap, programData }
    : { semesters: SEMESTERS, courseMap, placements, reservations, specialTermPl, programData }
  ) : null), [chosen, ontoEmpty, SEMESTERS, courseMap, placements, reservations, specialTermPl, programData]);

  // What replacing would throw away — the three maps `applySamplePlanToPlan`
  // blanks under `{ replace: true }`, and only those. `placedOut` and the
  // grades are NOT in it, which is why the dialog can promise they survive.
  //
  // Courses lead because they are the student's own work; placeholders and
  // work terms are itemised separately rather than folded into one number, so
  // the row that says "2 work terms" can also say what goes with them (the
  // company and role typed in by hand, which no re-run of the sample plan
  // brings back).
  const losing = useMemo(() => ({
    courses:      Object.keys(placements    ?? {}).length,
    placeholders: Object.keys(reservations  ?? {}).length,
    workTerms:    Object.keys(specialTermPl ?? {}).length,
  }), [placements, reservations, specialTermPl]);

  // The co-op lengths the institution actually sells. `applySamplePlan` snaps
  // each merged co-op run to the nearest one, and its default is [6] — so
  // without this a run of a single full term (4 months) became a 6-month
  // co-op in `openAsNew` while `applySamplePlanToPlan`, which does pass them,
  // made it 4. Two verbs for the same plan produced different plans, and the
  // preview would have had to pick one and be wrong about the other.
  const coopDurations = useMemo(
    () => (specialTerms.getTypes?.() ?? []).find(x => x.id === "coop")?.durations?.map(d => d.duration) ?? [6],
    [specialTerms]);

  // Every hook above this line: the offer hides itself for a program with no
  // published plan, and hooks cannot run conditionally.
  if (!offer.show) return null;

  const layOut = () => {
    applySamplePlanToPlan(chosen, programData, 0, path);
    setJustDid("loaded");
  };

  const replace = () => {
    setConfirming(false);
    applySamplePlanToPlan(chosen, programData, 0, path, { replace: true });
    setJustDid("replaced");
  };

  // Seeded into a NEW slot rather than applied here: the current canvas is not
  // touched at all, which is the whole point of this verb.
  const openAsNew = () => {
    setConfirming(false);
    const r = applySamplePlan(chosen, { semesters: SEMESTERS, courseMap, programData, coopDurations });
    const name = planNameFor(path, majorRequirements.fmtProgramLabel, (planSlots ?? []).map(p => p.name));
    createPlan(name, {
      entSem: planEntSem, entYear: planEntYear,
      gradSem: planGradSem, gradYear: planGradYear, studentType,
    }, null, {
      placements: r.placements, reservations: r.reservations, specialTermPl: r.specialTermPl,
      major: path, appliedTemplate: { programKey: path, planLabel: chosen.label ?? "" },
    });
    setJustDid("opened");
  };

  const loaded = offer.state === "loaded";
  // Collapsed once the plan IS the canvas — there is nothing to decide, so the
  // row becomes a statement. Expanded whenever an action is available, because
  // a collapsed offer is one nobody finds.
  const openResolved = openPref ?? !loaded;
  const open = openResolved;
  const primary = offer.verbs[0] === "load" ? layOut : openAsNew;
  const primaryLabel = offer.verbs[0] === "load" ? t("grad.plan.load") : t("grad.plan.newplan");
  const fz = isPhone ? 9 : 10;

  return (
    <div style={{
      margin: "8px 0 10px", padding: isPhone ? "7px 8px" : "9px 10px", borderRadius: 6,
      border: "1px solid var(--border-2)", background: "var(--bg-surface-2)",
    }}>
      {/* Header doubles as the collapse control, so the section is always in
          the same place whatever state it is in. */}
      <div
        onClick={() => setOpen(v => !v)}
        style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", userSelect: "none" }}
      >
        <span style={{
          fontSize: isPhone ? 8 : 9, fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-4)",
        }}>{t("grad.plan.label")}</span>
        {/* Collapsed, the row still says something worth knowing: WHICH plan
            this canvas came from. Nothing else in the app surfaces that. */}
        {!open && loaded && appliedTemplate?.planLabel && (
          <span style={{
            flex: 1, fontSize: fz, color: "var(--text-3)", minWidth: 0,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{appliedTemplate.planLabel}</span>
        )}
        <span style={{ flex: !open && loaded ? "0 0 auto" : 1 }} />
        {loaded && (
          <span style={{ fontSize: fz - 1, color: "var(--success)" }}>{t("grad.plan.state.loaded")}</span>
        )}
        <span style={{ fontSize: fz - 1, color: "var(--text-5)" }}>{open ? "▾" : "▸"}</span>
      </div>

      {open && (
        <div style={{ marginTop: 6 }}>
          {/* What arrives, before deciding. */}
          {!!chosen && (
            <div style={{ fontSize: fz, color: "var(--text-3)", marginBottom: 6 }}>
              {counts
                ? t("onboard.sampleplan.counts", {
                    courses: counts.courses, placeholders: counts.placeholders })
                : "…"}
            </div>
          )}

          {/* The cost of REPLACING is deliberately not shown here.
              A warning box above the button row cannot say which button it is
              about, so beside "open as new plan" — which loses nothing — it
              made the safe action look dangerous too. It belongs where it can
              only mean one thing: inside the confirmation dialog. */}

          {/* Only when the cohort's year count leaves a real choice. */}
          {variants.length > 1 && (
            <VariantPicker
              variants={variants} value={safeIdx} onChange={setVariantIdx} isPhone={isPhone}
            />
          )}

          {chosen ? (
            <>
              <PreviewButton onClick={() => setPreviewing(true)} isPhone={isPhone} t={t} />

              {/* One row, two equal halves. These are the two answers to the
                  same question — "where does this plan go?" — so they are
                  read as a pair or not at all. Wrapping them stacked them
                  into what looked like a primary action with an afterthought
                  underneath, at every panel width narrower than about 200px,
                  which is most of them. `minWidth: 0` is what lets the halves
                  shrink instead of forcing the row to wrap. */}
              <div style={{ display: "flex", alignItems: "stretch", gap: 6 }}>
                {/* Once loaded, laying out again is not the point — switching
                    variant or branching a comparison is. */}
                <button
                  onClick={loaded ? openAsNew : primary}
                  style={{ ...primaryBtn(isPhone), flex: 1, minWidth: 0 }}
                >{loaded ? t("grad.plan.newplan") : primaryLabel}</button>
                {/* Same weight and same colour as its neighbour. Red made it
                    the loudest thing in the panel — a destructive action does
                    not need advertising, it needs a confirmation that says
                    what it costs, which is what the dialog below is for. */}
                {offer.verbs.includes("replace") && (
                  <button
                    onClick={() => setConfirming(true)}
                    style={{ ...primaryBtn(isPhone), flex: 1, minWidth: 0 }}
                  >{t("grad.plan.replace")}</button>
                )}
              </div>
              {justDid && (
                <div style={{ marginTop: 6 }}>
                  <button onClick={() => { doUndo(); setJustDid(null); }} style={linkBtn}>
                    {t("grad.plan.undo")}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: fz, color: "var(--text-5)" }}>{t("onboard.sampleplan.loading")}</div>
          )}
        </div>
      )}

      {/* Outside the collapse, so a dialog can never be stranded open behind a
          folded section. */}
      <ReplaceConfirm
        open={confirming && !!chosen}
        onCancel={() => setConfirming(false)}
        onConfirm={replace}
        onOpenAsNew={openAsNew}
        onPreview={() => setPreviewing(true)}
        label={chosen?.label ?? ""}
        lose={losing}
        gain={counts}
        t={t}
      />

      {/* Layered ABOVE the confirmation rather than replacing it: someone who
          opens the plan from inside that dialog is mid-decision, and closing
          the preview should put them back where they were, not cancel it. */}
      <SamplePlanPreview
        open={previewing && !!chosen}
        onClose={() => setPreviewing(false)}
        // Replacing from the preview closes it onto the SAME confirmation the
        // panel's button opens. One statement covers both routes in: opened
        // from the panel this raises the dialog, and opened from inside the
        // dialog it simply steps back down to it.
        onReplace={offer.verbs.includes("replace")
          ? () => { setPreviewing(false); setConfirming(true); }
          : null}
        plan={chosen}
        programData={programData}
        programLabel={programLabelOf(path, majorRequirements.fmtProgramLabel)}
      />
    </div>
  );
}

/**
 * The confirmation behind "Replace my plan".
 *
 * `window.confirm` held this job and could not do it. It renders in the
 * browser's own chrome — a different typeface from the app, an OS title bar
 * naming the site, and no way to lay the two sides of the trade beside each
 * other. Worse, it puts the destructive answer behind a button labelled "OK",
 * so the fastest way out of a dialog nobody read is the one that discards the
 * plan.
 *
 * What this says instead, in order: which plan is arriving, what leaves, what
 * arrives, and what is NOT touched. That last block is not padding — it is the
 * answer to the question that actually stops people here ("do I lose my
 * grades?"), and the answer is no: `applySamplePlanToPlan` writes only
 * placements, reservations and special terms, and `pushUndo` runs first.
 *
 * "Open as new plan instead" is offered from inside the dialog because someone
 * who paused at this point usually wanted the branch, not the overwrite — and
 * having read the cost, that is exactly when they can tell.
 */
function ReplaceConfirm({ open, onCancel, onConfirm, onOpenAsNew, onPreview, label, lose, gain, t }) {
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } };
    window.addEventListener("keydown", onKey);
    // Focus lands on the way OUT, never on the destructive button: a stray
    // Return pressed just after this opens must not discard the plan.
    const id = setTimeout(() => cancelRef.current?.focus(), 0);
    return () => { window.removeEventListener("keydown", onKey); clearTimeout(id); };
  }, [open, onCancel]);

  if (!open) return null;

  // Zero rows are dropped rather than printed as "0 …": a list of noughts reads
  // as a wall of text where the point was the one number that is not zero.
  const loseRows = [
    lose?.courses      && t("grad.plan.replace.lose.courses", { n: lose.courses }),
    lose?.placeholders && t("grad.plan.replace.lose.slots",   { n: lose.placeholders }),
    lose?.workTerms    && t("grad.plan.replace.lose.terms",   { n: lose.workTerms }),
  ].filter(Boolean);
  const gainRows = [
    gain?.courses      && t("grad.plan.replace.gain.courses", { n: gain.courses }),
    gain?.placeholders && t("grad.plan.replace.gain.slots",   { n: gain.placeholders }),
    gain?.coops        && t("grad.plan.replace.gain.coops",   { n: gain.coops }),
  ].filter(Boolean);

  return createPortal(
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 14,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="spo-replace-title"
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--bg-surface)", border: "1px solid var(--border-2)",
          borderRadius: 12, maxWidth: 330, width: "100%",
          padding: "16px 16px 14px", boxShadow: "var(--shadow-modal)",
          color: "var(--text-2)", fontFamily: "'Inter', system-ui, sans-serif",
          maxHeight: "calc(100vh - 28px)", overflowY: "auto",
        }}
      >
        {/* The ✕ is the third way out, alongside Escape and the backdrop —
            all three are the SAME cancel. A dialog whose only exits are two
            buttons at the bottom reads as a trap; the corner is where people
            look first for the way out of one they opened by accident. */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div id="spo-replace-title" style={{
            flex: 1, minWidth: 0, fontSize: 13, fontWeight: 800, color: "var(--text-1)",
          }}>
            {t("grad.plan.replace.title")}
          </div>
          <button onClick={onCancel} aria-label={t("grad.plan.replace.cancel")} style={{
            fontSize: 14, lineHeight: 1, background: "transparent", border: "none",
            color: "var(--text-5)", cursor: "pointer", padding: "0 0 0 6px", flex: "0 0 auto",
          }}>✕</button>
        </div>
        <div style={{
          fontSize: 10, color: "var(--text-4)", marginTop: 4, marginBottom: 12,
          lineHeight: "calc(1.5 * var(--lh-scale, 1))",
        }}>
          {label
            ? t("grad.plan.replace.sub", { label })
            : t("grad.plan.replace.sub.generic")}
        </div>

        <Ledger
          head={t("grad.plan.replace.head.lose")}
          rows={loseRows.length ? loseRows : [t("grad.plan.replace.lose.none")]}
          sign={loseRows.length ? "−" : ""}
          tone="lose"
        />
        <Ledger
          head={t("grad.plan.replace.head.gain")}
          rows={gainRows}
          sign="+"
          tone="gain"
        />

        {/* Directly under the block whose claim it answers: "26 courses" is a
            quantity, and the one question a count cannot answer is WHICH.
            Same button as the panel's, at full width — this is the moment it
            matters most, so it stops being a 9px link here. */}
        {onPreview && <div style={{ marginTop: 2 }}>
          <PreviewButton onClick={onPreview} isPhone={false} t={t} />
        </div>}

        <div style={{
          fontSize: 9, color: "var(--text-5)", marginTop: 10,
          lineHeight: "calc(1.55 * var(--lh-scale, 1))",
        }}>
          {t("grad.plan.replace.keeps")}
        </div>

        {/* The safe branch, spelled out. Full width and above the decision row
            so it is a real third option, not a link hiding beside Cancel. */}
        <button
          onClick={onOpenAsNew}
          style={{
            width: "100%", marginTop: 12, fontSize: 10, fontWeight: 600,
            padding: "6px 10px", borderRadius: 6, cursor: "pointer",
            background: "var(--bg-2)", color: "var(--text-2)",
            border: "1px solid var(--border-1)",
          }}
        >{t("grad.plan.replace.alt")}</button>

        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button
            ref={cancelRef}
            onClick={onCancel}
            style={{
              flex: 1, minWidth: 0, fontSize: 11, fontWeight: 700,
              padding: "7px 10px", borderRadius: 6, cursor: "pointer",
              background: "var(--bg-surface-2)", color: "var(--text-2)",
              border: "1px solid var(--border-2)",
            }}
          >{t("grad.plan.replace.cancel")}</button>
          {/* The one place red belongs: on the button that does the thing, in
              a dialog the student opened on purpose and has just read. */}
          <button
            onClick={onConfirm}
            style={{
              flex: 1, minWidth: 0, fontSize: 11, fontWeight: 700,
              padding: "7px 10px", borderRadius: 6, cursor: "pointer",
              background: "var(--error-bg)", color: "var(--error-text)",
              border: "1px solid var(--error)",
            }}
          >{t("grad.plan.replace")}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * "Show me the plan", wherever it is offered.
 *
 * ONE component, so the panel and the confirmation cannot drift into two
 * different-looking affordances for the same act. It was a full-width link-
 * coloured button in one and a 9px text link in the other, which read as two
 * unrelated things.
 *
 * Deliberately NEUTRAL. Preview is the only reversible action in this feature
 * — the two verbs beside it both change something — so it has no business
 * being the most saturated element on screen; the link colouring made it look
 * eager to be pressed. Its prominence comes from full width and position
 * instead, which costs nothing in urgency and is what actually gets it seen.
 */
function PreviewButton({ onClick, isPhone, t }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        width: "100%", marginBottom: 6,
        fontSize: isPhone ? 10 : 11, fontWeight: 600,
        padding: "6px 10px", borderRadius: 5, cursor: "pointer",
        background: "var(--bg-2)", color: "var(--text-2)",
        border: "1px solid var(--border-1)",
      }}
    >
      <span style={{ fontSize: isPhone ? 11 : 12, lineHeight: 1, color: "var(--text-4)" }}>⊞</span>
      {t("grad.plan.preview")}
    </button>
  );
}

/** One side of the trade: a heading and its signed rows. */
function Ledger({ head, rows, sign, tone }) {
  if (!rows.length) return null;
  const accent = tone === "lose" ? "var(--error-text)" : "var(--success)";
  return (
    <div style={{
      border: "1px solid var(--border-1)", borderRadius: 6, padding: "7px 9px",
      background: "var(--bg-surface-2)", marginBottom: 6,
    }}>
      <div style={{
        fontSize: 8, fontWeight: 700, letterSpacing: "0.06em",
        color: "var(--text-4)", marginBottom: 4,
      }}>{head}</div>
      {rows.map((r, i) => (
        <div key={i} style={{
          display: "flex", gap: 6, fontSize: 10, color: "var(--text-2)",
          lineHeight: "calc(1.5 * var(--lh-scale, 1))",
        }}>
          {sign && <span style={{ color: accent, fontWeight: 700, flex: "0 0 auto" }}>{sign}</span>}
          <span style={{ flex: 1, minWidth: 0 }}>{r}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Which variant to lay out.
 *
 * A native <select> renders as the operating system's control, which on macOS
 * is a different typeface, weight and corner radius from everything around it —
 * one element that looks borrowed. This is the app's own popup instead: the
 * same `.hdr-pop` the header menus use, so it inherits the viewport cap and
 * scrolling they already solved.
 *
 * Not a segmented control, tempting as that is for the common case of two
 * options: the labels are "Four Years, Two Co-ops in Spring/Summer First Half",
 * and side-by-side pills would wrap into an unreadable block.
 */
function VariantPicker({ variants, value, onChange, isPhone }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  // Close on anything that means "I am done here" — a click elsewhere, or
  // Escape. Bound only while open, so a closed picker costs no listeners.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    const onKey  = (e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const fz = isPhone ? 9 : 10;
  return (
    <div ref={boxRef} style={{ position: "relative", marginBottom: 6 }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", gap: 6, width: "100%",
          fontSize: fz, textAlign: "left", cursor: "pointer",
          background: "var(--bg-2)", color: "var(--text-2)",
          border: "1px solid var(--border-1)", borderRadius: 4, padding: "3px 6px",
        }}
      >
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {variants[value]?.label ?? ""}
        </span>
        <span style={{ color: "var(--text-5)", fontSize: fz - 1 }}>{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div
          className="hdr-pop"
          role="listbox"
          style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 100,
            background: "var(--bg-surface)", border: "1px solid var(--border-2)",
            borderRadius: 6, padding: "4px 0", boxShadow: "var(--shadow-modal)",
            display: "flex", flexDirection: "column",
          }}
        >
          {variants.map((p, i) => (
            <button
              key={i}
              type="button"
              role="option"
              aria-selected={i === value}
              onClick={() => { onChange(i); setOpen(false); }}
              style={{
                textAlign: "left", fontSize: fz, cursor: "pointer", border: "none",
                padding: "4px 8px", background: i === value ? "var(--card-bg-hov)" : "transparent",
                color: i === value ? "var(--text-1)" : "var(--text-2)",
                fontWeight: i === value ? 600 : 400,
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A name for a plan branched off a sample plan.
 *
 * Three things were wrong with what this produced:
 *
 *   "requirements.json (sample plan)"
 *
 * The path ends in the FILE, so the program is the second-to-last segment —
 * taking the last one named every plan after the JSON it was read from.
 * `fmtProgramLabel` is what the rest of the app uses on that folder.
 *
 * Two branches then collided, because nothing checked the names already taken.
 *
 * And the "(sample plan)" suffix was translated at creation, so a plan made
 * while the app was in Chinese kept 示例计划 in its name forever — a stored
 * artefact in whatever language happened to be active. It is dropped entirely:
 * `appliedTemplate` records the provenance properly now, and the collapsed
 * section states it, so the name does not have to carry it.
 */
/**
 * The program's display name, from its path.
 *
 * Shared by the new plan's name and the preview's title so the two cannot
 * disagree about what the program is called. The path ends in the FILE, so the
 * program is the second-to-last segment — taking the last one named everything
 * after the JSON it was read from.
 */
function programLabelOf(path, fmtProgramLabel) {
  const parts = String(path ?? "").split("/");
  const folder = parts[parts.length - 2] || parts[parts.length - 1] || "";
  return (fmtProgramLabel?.(folder) || folder.replace(/_/g, " ") || "").trim();
}

function planNameFor(path, fmtProgramLabel, taken) {
  const base = programLabelOf(path, fmtProgramLabel) || "Plan";
  const used = new Set(taken ?? []);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!used.has(candidate)) return candidate;
  }
}

function Row({ children, isPhone }) {
  return (
    <div style={{
      margin: "8px 0 10px", padding: isPhone ? "7px 8px" : "9px 10px", borderRadius: 6,
      border: "1px solid var(--border-2)", background: "var(--bg-surface-2)",
      display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
      fontSize: isPhone ? 9 : 10,
    }}>{children}</div>
  );
}

const primaryBtn = (isPhone) => ({
  fontSize: isPhone ? 9 : 10, fontWeight: 600, padding: "3px 10px", borderRadius: 5,
  cursor: "pointer", border: "1px solid var(--border-1)",
  background: "var(--bg-2)", color: "var(--text-2)",
});
const linkBtn = {
  fontSize: 10, background: "transparent", border: "none", color: "var(--link-1)",
  cursor: "pointer", padding: 0,
};
