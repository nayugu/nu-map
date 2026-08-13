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
import { IPlanGenerator }     from "../ports/IPlanGenerator.js";
import { ISpecialTerms }      from "../ports/ISpecialTerms.js";
import PlanSourceToggle       from "./PlanSourceToggle.jsx";
import ChartExplainer         from "./ChartExplainer.jsx";
import { applySamplePlan }    from "../core/applySamplePlan.js";
import { refusalMessage }     from "../core/refusalMessage.js";
import SamplePlanPreview      from "./SamplePlanPreview.jsx";
import {
  sampleplanOffer, variantsFor, describeTemplate, isPlanEmpty, isGeneratedPlanLabel,
  shortVariantLabel,
} from "../core/planTemplate.js";

/**
 * Namespaced like the other grad-panel collapse flags, and kept separate per
 * form factor — see where it is read for why a desktop choice must not follow
 * the student onto a phone.
 */
const COLLAPSE_KEY = (isPhone) =>
  `numap-grad-expand-sampleplan${isPhone ? "-phone" : ""}`;

/**
 * Type scale for this frame.
 *
 * Phone sizes are ~2/3 of what they were: the section read far larger than the
 * panel around it. Two of the buttons were the reason it looked worst — they
 * carried a hardcoded 10 and ignored `isPhone` entirely, so on a phone the
 * actions were BIGGER than the body text describing them.
 *
 * One place, because five call sites drifting apart is how that happened.
 */
const PHONE_FZ  = (isPhone) => (isPhone ? 6 : 10);   // body, buttons, options
const PHONE_FZL = (isPhone) => (isPhone ? 5.5 : 9);  // the section label

export default function SamplePlanOffer({ path, isGrad, programData, concentration, isPhone }) {
  const majorRequirements = usePort(IMajorRequirements);
  const planGenerator     = usePort(IPlanGenerator);
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

  // ── CHART, the generated alternative ──────────────────────────────
  //
  // A generated plan is a plan.json variant like any other, so it slots in beside
  // the catalog's rather than needing a parallel path: everything below — counts,
  // verbs, replace, undo — works on `chosen` and does not care where it came from.
  //
  // Generated LAZILY, on the first switch to it. It is ~100 ms of work that most
  // students never ask for, and doing it on mount would tax every program view for
  // a feature used on some of them.
  const [source,   setSource]   = useState("catalog");
  const [gen,      setGen]      = useState(null);     // {plan, report} | {refused}
  const [genBusy,  setGenBusy]  = useState(false);
  const [showWhy,  setShowWhy]  = useState(false);

  // Collapse is remembered ACROSS sessions but chosen BY STATE the first time.
  // An explicit preference outranks the state default, the same rule the other
  // credits toggle follows — someone who folded this away meant it.
  //
  // Remembered SEPARATELY per form factor. Expanding on a desktop is a
  // reasonable thing to want and says nothing about a phone, where the same
  // preference would put "Lay out" and "Replace my plan" back under the thumb.
  const collapseKey = COLLAPSE_KEY(isPhone);
  const [openPref, setOpenPref] = useState(() => {
    try { const v = localStorage.getItem(collapseKey); return v === null ? null : v === "true"; }
    catch { return null; }
  });
  const setOpen = (next) => {
    const val = typeof next === "function" ? next(openResolved) : next;
    setOpenPref(val);
    try { localStorage.setItem(collapseKey, String(val)); } catch {}
  };

  // Question 1 of the rule, answered synchronously so nothing flickers in for a
  // program that publishes nothing.
  const hasSamplePlan = !!path && !!majorRequirements.hasSamplePlan?.(path, isGrad);

  // Its other half, and declared HERE for a reason: `offer` below reads it, and having
  // it further down the file put it in the temporal dead zone. The component threw
  // `Cannot access 'canGenerate' before initialization` on every render with a program
  // selected — which the build cannot see and no test caught, because the page loads
  // perfectly until something IS selected.
  const canGenerate = !!path && !!planGenerator?.canGenerate?.(path, isGrad, programData);

  useEffect(() => {
    setPlans(null); setVariantIdx(0); setJustDid(null); setConfirming(false); setPreviewing(false);
    setGen(null); setGenBusy(false); setShowWhy(false);
    startedRef.current = null;
    // Back to the catalog when the program changes: a source choice is about the
    // program in front of you, not a standing preference, and silently generating
    // for the next program would spend work nobody asked for.
    setSource("catalog");
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

  // `hasSamplePlan` gates the section, and CHART widens that gate: a program that
  // publishes nothing (632 of 1,017) previously had no section at all, and is exactly
  // the case where a generated plan is worth the most.
  const offer = useMemo(() => sampleplanOffer({
    major: path, major2, hasSamplePlan: hasSamplePlan || canGenerate,
    appliedTemplate, canvasEmpty,
  }), [path, major2, hasSamplePlan, canGenerate, appliedTemplate, canvasEmpty]);

  const years = Math.round(((planGradYear * 2 + (planGradSem === "fall" ? 1 : 0)) -
                            (planEntYear  * 2 + (planEntSem  === "fall" ? 1 : 0)) + 1) / 2);
  const catalogVariants = useMemo(() => variantsFor(plans ?? [], { years }), [plans, years]);

  // Generated on demand, once per program, and only for the source actually chosen.
  //
  // ── The guard is a REF, not the state it sets ─────────────────────
  //
  // The first version had `gen` and `genBusy` in this effect's dependency array and
  // also set them, which deadlocks: the effect starts, sets `genBusy`, that change
  // re-runs the effect, the CLEANUP fires and clears `live`, and when the generation
  // finally resolves nothing is listening. The panel sat on "Working out an order…"
  // for ever, with no error anywhere.
  //
  // So the "already started" flag lives in a ref keyed by what a generation is FOR.
  // A ref does not re-run anything, and keying it means switching program or student
  // type starts a new one while flipping the toggle back and forth does not.
  // The VARIANT is part of what a generation is for, and leaving it out was a bug.
  //
  // CHART inherits the shape — how many years, which terms are used, where the co-ops
  // fall — from a published variant, so a different variant is a different plan, not a
  // different view of one. Measured, the difference is not cosmetic: the five-year
  // Industrial Engineering and Computer Science patterns exercise a shape the four-year
  // ones never do, and they were the two that failed the four-course rule.
  // The concentration is IN the key. Without it, picking a concentration after the plan had
  // already been generated left the old plan on screen — built against the union of every
  // option — and nothing said so, which is the worst of the three possible behaviours.
  const genKey = `${path}|${isGrad}|${studentType}|${variantIdx}|${concentration ?? ""}`;
  const startedRef = useRef(null);

  useEffect(() => {
    if (source !== "chart" || !canGenerate) return;
    if (startedRef.current === genKey) return;
    startedRef.current = genKey;

    let live = true;
    setGenBusy(true);
    planGenerator.generate({
      programKey: path, isGrad, programData, courseMap, studentType,
      // Without this the concentration cells can only draw on the UNION of every option, and
      // the pools are typically disjoint — so the plan gets proved feasible by courses from
      // three different concentrations, which no student can take. With it, the cells are that
      // one concentration's courses and are sequenced as the major depth they actually are.
      concentration,
      // The catalog's own SHAPE — years, terms, where the co-ops fall — is real
      // departmental intent and worth inheriting even when its CONTENT is not.
      //
      // The SELECTED variant, not `[0]`. Hard-coding the first one meant a student who
      // picked the five-year pattern was silently given a plan built on the four-year
      // skeleton, and the picker was hidden in CHART mode so they could not even see the
      // choice being ignored. CHART should adapt to any pattern the catalog publishes;
      // that is the whole reason it inherits a shape instead of inventing one.
      publishedPlan: catalogVariants[Math.min(variantIdx, Math.max(catalogVariants.length - 1, 0))] ?? null,
    })
      .then(r => { if (live) setGen(r); })
      .catch(() => {
        if (live) setGen({ refused: { reason: "error", detail: t("chart.refused") } });
      })
      .finally(() => { if (live) setGenBusy(false); });

    return () => { live = false; };
    // `catalogVariants` is deliberately absent: it settles asynchronously, and a
    // change to it after generation has started would tear down the in-flight
    // request and strand the panel exactly as the dependency bug did.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, genKey, canGenerate]);

  const usingChart = source === "chart";
  const chartPlan  = gen && !gen.refused ? gen.plan : null;
  // One list, whichever source. Everything downstream reads `chosen` and never asks.
  const variants = usingChart ? (chartPlan ? [chartPlan] : []) : catalogVariants;
  const safeIdx  = Math.min(Math.max(usingChart ? 0 : variantIdx, 0), Math.max(variants.length - 1, 0));
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
    const id = createPlan(name, {
      entSem: planEntSem, entYear: planEntYear,
      gradSem: planGradSem, gradYear: planGradYear, studentType,
    }, null, {
      placements: r.placements, reservations: r.reservations, specialTermPl: r.specialTermPl,
      major: path, appliedTemplate: { programKey: path, planLabel: chosen.label ?? "" },
    });
    // A SEEDED create aborts and returns null when its slot cannot be written
    // (a full store), having already said so. Announcing "opened" on top of
    // that would claim a plan exists that does not.
    if (id) setJustDid("opened");
  };

  const loaded = offer.state === "loaded";
  // On a desktop: collapsed once the plan IS the canvas — there is nothing to
  // decide, so the row becomes a statement — and expanded whenever an action is
  // available, because a collapsed offer is one nobody finds.
  //
  // On a phone: always collapsed. Expanded, this section puts "Lay out" and
  // "Replace my plan" directly under the thumb in a list the student is
  // scrolling, and one of those discards work. Discoverability is worth a
  // mis-tap on a mouse; it is not worth one here, and the header still says the
  // section exists.
  const openResolved = openPref ?? (isPhone ? false : !loaded);
  const open = openResolved;
  const primary = offer.verbs[0] === "load" ? layOut : openAsNew;
  const primaryLabel = offer.verbs[0] === "load" ? t("grad.plan.load") : t("grad.plan.newplan");
  const fz = PHONE_FZ(isPhone);
  // See the header for why a generated plan's own label is not one of these.
  const showPlanLabel = !open && loaded
    && !!appliedTemplate?.planLabel && !isGeneratedPlanLabel(appliedTemplate.planLabel);

  return (
    <div style={{
      // Padding tightened with the type, or 2/3-size text sits in a frame built
      // for text half again as large and the box reads mostly as empty.
      margin: isPhone ? "6px 0 7px" : "8px 0 10px",
      padding: isPhone ? "5px 6px" : "9px 10px", borderRadius: 6,
      border: "1px solid var(--border-2)", background: "var(--bg-surface-2)",
    }}>
      {/* Header doubles as the collapse control, so the section is always in
          the same place whatever state it is in. */}
      <div
        onClick={() => setOpen(v => !v)}
        style={{ display: "flex", alignItems: "center", gap: isPhone ? 4 : 6, cursor: "pointer", userSelect: "none" }}
      >
        <span style={{
          fontSize: PHONE_FZL(isPhone), fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-4)",
        }}>{t("grad.plan.label")}</span>
        {/* Collapsed, the row still says something worth knowing: WHICH plan
            this canvas came from. Nothing else in the app surfaces that.
            Except when the engine named it. A department's variant label
            distinguishes one plan from another the student could have picked
            ("Four Years, Two Co-ops"), which is why it earns room here;
            "Generated by CHART" distinguishes nothing — there is only ever one
            generated plan — and it is long enough to be truncated to "Generated
            by C…" in the collapsed strip, which is a byline nobody can read
            taking the space from the state badge beside it. Expanded, the
            generated plan says so for itself, with its explainer. */}
        {showPlanLabel && (
          <span style={{
            flex: 1, fontSize: fz, color: "var(--text-3)", minWidth: 0,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{appliedTemplate.planLabel}</span>
        )}
        {/* The label takes the slack when it is there; when it is not, the
            spacer does, so the state badge stays pinned right either way. */}
        <span style={{ flex: showPlanLabel ? "0 0 auto" : 1 }} />
        {loaded && (
          <span style={{ fontSize: fz - 1, color: "var(--success)" }}>{t("grad.plan.state.loaded")}</span>
        )}
        <span style={{ fontSize: fz - 1, color: "var(--text-5)" }}>{open ? "▾" : "▸"}</span>
      </div>

      {showWhy && gen?.report && (
        <ChartExplainer
          report={gen.report} program={programData} isPhone={isPhone}
          onClose={() => setShowWhy(false)}
        />
      )}

      {open && (
        <div style={{ marginTop: 6 }}>
          {/* Whose plan this is. First, because it changes everything below it. */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
            marginBottom: 7,
          }}>
            <PlanSourceToggle
              value={source} onChange={setSource}
              hasCatalog={hasSamplePlan} canGenerate={canGenerate}
              busy={genBusy} isPhone={isPhone}
            />
          </div>

          {/* Generation is the one thing here that takes visible time. */}
          {/* A machine-readable status for the live browser test.
              Rendered whenever CHART is the source, including while busy, because the bug it
              guards against is generation NEVER finishing — the panel sat on "Working out an
              order…" for ever with no error anywhere. A test can only catch that by watching
              `data-busy` go false; watching for a string cannot distinguish "still working"
              from "stuck working". */}
          {usingChart && (
            <div
              data-testid="chart-status"
              data-busy={genBusy ? "true" : "false"}
              data-state={genBusy ? "busy" : gen?.refused ? "refused" : chartPlan ? "ready" : "idle"}
              style={{ display: "none" }}
            />
          )}

          {usingChart && genBusy && (
            <div style={{ fontSize: fz, color: "var(--text-5)", marginBottom: 6 }}>
              {t("chart.busy")}
            </div>
          )}

          {/* A refusal is an ANSWER, and it names something actionable. Shown as
              prose rather than an error, because "this program cannot be planned
              from what the catalog states" is a fact about the program.

              ── One refusal is a QUESTION, not a dead end ──────────────

              `concentration-unfillable` means no single schedule serves every
              concentration — measured on 8 shapes, and confirmed to be the degree
              rather than the search: re-run at 12x the time budget, 0 of 8 were
              rescued. But 107 of 126 (program, concentration) pairs DO generate once
              a pick is made, so the honest response is to ask rather than to report
              nothing. Only before a pick: with one chosen this reason cannot occur,
              because there is no disjunction left to be universal about.

              The engine's own `detail` is suppressed here on purpose — "no legal
              placement exists" is true and is not something a student can act on. */}
          {usingChart && gen?.refused && (
            <div style={{
              fontSize: fz, color: "var(--text-3)", marginBottom: 6,
              padding: isPhone ? "5px 7px" : "7px 9px", borderRadius: 5,
              background: "var(--bg-surface-1)", border: "1px solid var(--border-2)",
            }}>
              {gen.refused.reason === "concentration-unfillable" && !concentration
                ? t("chart.refused.conc")
                : refusalMessage(gen.refused, t)}
            </div>
          )}

          {/* ── The two-number summary is gone ──────────────────────
            *
            * "adds 19 courses and 27 placeholders you'll choose later" was the best answer
            * available to "what will this do" when it was written. It is not any more:
            * `SamplePlanPreview` draws the actual plan, at the planner's own scale, from the
            * same `applySamplePlan` output the buttons use. A picture of the plan beats two
            * counts of it, and keeping both meant the weaker answer was the one shown by
            * default while the stronger one hid behind a button.
            *
            * `counts` still feeds the replace confirmation, where a NUMBER is the right unit
            * because the question there is what you lose, not what you get.
            */}

          {/* The cost of REPLACING is deliberately not shown here.
              A warning box above the button row cannot say which button it is
              about, so beside "open as new plan" — which loses nothing — it
              made the safe action look dangerous too. It belongs where it can
              only mean one thing: inside the confirmation dialog. */}

          {/* Only when the cohort's year count leaves a real choice.

              Shown in BOTH modes. It used to be hidden for CHART, on the assumption that a
              generated plan has one variant — but CHART inherits its SHAPE from a
              published variant, so the choice is just as real there: four years with two
              co-ops and five years with three are different plans, not different views.
              Hiding it meant the student's selection was silently ignored. The list is
              always the CATALOG's variants, because that is what is being chosen. */}
          {/* One row: which variant on the left, look at it on the right.
              Preview used to be a full-width button on its own line under the
              picker, which gave equal weight to "choose the plan" and "look at
              the plan" and cost a whole row of a panel that has none to spare.
              It is a small trailing control now — the picker keeps the width,
              because reading the co-op pattern is the harder job of the two. */}
          {(catalogVariants.length > 1 || chosen) && (
            <div style={{
              display: "flex", alignItems: "stretch", gap: 6,
              marginBottom: isPhone ? 5 : 6,
            }}>
              {catalogVariants.length > 1 ? (
                <VariantPicker
                  variants={catalogVariants}
                  value={Math.min(variantIdx, catalogVariants.length - 1)}
                  onChange={setVariantIdx} isPhone={isPhone}
                />
              ) : (
                // Nothing to choose, but Preview still belongs on the right
                // rather than stretched across a row of its own.
                <span style={{ flex: 1, minWidth: 0 }} />
              )}
              {chosen && (
                <PreviewButton onClick={() => setPreviewing(true)} isPhone={isPhone} t={t} />
              )}
            </div>
          )}

          {chosen ? (
            <>

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
              {/* ── The two quiet links share one row ────────────────────
                *
                * Both are secondary to the buttons above, and stacked on separate lines they
                * read as two unrelated afterthoughts while costing a row of height each. So
                * they sit on one line: undo at the start, where the eye already is after
                * acting, and "how was this built" pushed to the end.
                *
                * That end position was twice mis-placed before this. Beside the toggle it was a
                * link outranking the two buttons that actually act; directly under the toggle it
                * sat between two full-width controls and read as an orphan interrupting the
                * stack. The panel is a sequence — pick a source, pick a variant, look at it, act
                * — and "how was this built" is the question that arrives after all of those, if
                * at all. Quiet and right-aligned is where a curious reader looks and nobody
                * else has to step over it.
                *
                * The row renders when EITHER exists, and the explainer is pushed to the end by
                * `marginInlineStart: auto` rather than by `space-between` against a filler
                * element — so it stays right-aligned when undo is absent, without an empty span
                * whose baseline would participate in the row's alignment. `Inline` rather than
                * `left`, so the Arabic locale flips it with everything else.
                *
                * Only when there is a generated plan to explain: an explainer describing the
                * algorithm in general rather than THIS plan is a brochure.
                */}
              {(justDid || (usingChart && gen?.report)) && (
                <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
                  {justDid && (
                    <button onClick={() => { doUndo(); setJustDid(null); }} style={linkBtn(isPhone)}>
                      {t("grad.plan.undo")}
                    </button>
                  )}
                  {usingChart && gen?.report && (
                    <button
                      onClick={() => setShowWhy(true)}
                      style={{
                        fontSize: PHONE_FZ(isPhone), background: "transparent", border: "none",
                        color: "var(--text-3)", cursor: "pointer", padding: 0,
                        textDecoration: "underline", textUnderlineOffset: 2,
                        marginInlineStart: "auto",
                      }}
                    >{t("chart.why")}</button>
                  )}
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
          <PreviewButton onClick={onPreview} isPhone={false} t={t} fullWidth />
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
/**
 * Look at the plan. A SMALL trailing control beside the variant picker.
 *
 * `flexShrink: 0` and `whiteSpace: nowrap` are the load-bearing pair: in the
 * row it shares with the picker it must keep its own label intact and let the
 * picker's much longer one do the ellipsizing. Without them the two fought for
 * the same pixels and "Preview" was the one that lost, leaving a button
 * reading "Prev…".
 *
 * `fullWidth` is for the collapsed row, which has no picker to sit beside.
 */
function PreviewButton({ onClick, isPhone, t, fullWidth = false }) {
  // Through PHONE_FZ like everything else in this frame. Written with its own
  // sizes first, which is how the two buttons beside it ended up smaller than
  // it on a phone — the exact drift the shared scale exists to stop.
  const fz = PHONE_FZ(isPhone);
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: isPhone ? 3 : 5,
        ...(fullWidth ? { width: "100%" } : { flexShrink: 0, whiteSpace: "nowrap" }),
        fontSize: fz, fontWeight: 600,
        padding: isPhone ? "3px 7px" : "4px 9px", borderRadius: 4, cursor: "pointer",
        background: "var(--bg-2)", color: "var(--text-2)",
        border: "1px solid var(--border-1)",
      }}
    >
      <span style={{ fontSize: fz + 1, lineHeight: 1, color: "var(--text-4)" }}>⊞</span>
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

  const fz = PHONE_FZ(isPhone);
  return (
    // `flex: 1, minWidth: 0` so the picker takes the row's spare width and its
    // long label ellipsizes, rather than pushing Preview off the end.
    <div ref={boxRef} style={{ position: "relative", flex: 1, minWidth: 0 }}>
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
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {shortVariantLabel(variants[value]?.label)}
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
              {shortVariantLabel(p.label)}
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

const primaryBtn = (isPhone) => ({
  fontSize: PHONE_FZ(isPhone), fontWeight: 600,
  padding: isPhone ? "2px 7px" : "3px 10px", borderRadius: 5,
  cursor: "pointer", border: "1px solid var(--border-1)",
  background: "var(--bg-2)", color: "var(--text-2)",
});
const linkBtn = (isPhone) => ({
  fontSize: PHONE_FZ(isPhone), background: "transparent", border: "none",
  color: "var(--link-1)", cursor: "pointer", padding: 0,
});
// `dangerBtn` lived here. The inline red REPLACE it styled is gone — a
// destructive action does not need advertising, it needs a confirmation that
// says what it costs — so the helper has no caller left. The phone scale it
// was taught is kept on everything that survives.
