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
// "Add here" is deliberately gone. A sample plan assumes year 1 is your first
// year with nothing done, so adding it beside existing work leaves a canvas
// that is neither the student's nor the department's.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";
import { usePlanner }         from "../context/PlannerContext.jsx";
import { usePort }            from "../context/InstitutionContext.jsx";
import { useLanguage }        from "../context/LanguageContext.jsx";
import { IMajorRequirements } from "../ports/IMajorRequirements.js";
import { applySamplePlan }    from "../core/applySamplePlan.js";
import {
  sampleplanOffer, variantsFor, describeTemplate, isPlanEmpty,
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

export default function SamplePlanOffer({ path, isGrad, programData, isPhone }) {
  const majorRequirements = usePort(IMajorRequirements);
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

  useEffect(() => {
    setPlans(null); setVariantIdx(0); setJustDid(null);
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

  // What replacing would throw away. The count that matters is the student's
  // own work, so reservations are excluded — a placeholder is the plan's, not
  // theirs, and counting it would inflate the warning.
  const losing = useMemo(() => Object.keys(placements ?? {}).length, [placements]);

  if (!offer.show) return null;

  const layOut = () => {
    applySamplePlanToPlan(chosen, programData, 0, path);
    setJustDid("loaded");
  };

  const replace = () => {
    // The count goes in the confirm too. "Replace everything?" is easy to wave
    // through; "discard 16 courses you placed" is the fact being agreed to.
    const msg = losing > 0
      ? `${t("grad.plan.replace.warn", { n: losing })}\n\n${t("grad.plan.replace.confirm")}`
      : t("grad.plan.replace.confirm");
    if (!window.confirm(msg)) return;
    applySamplePlanToPlan(chosen, programData, 0, path, { replace: true });
    setJustDid("replaced");
  };

  // Seeded into a NEW slot rather than applied here: the current canvas is not
  // touched at all, which is the whole point of this verb.
  const openAsNew = () => {
    const r = applySamplePlan(chosen, { semesters: SEMESTERS, courseMap, programData });
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
              only mean one thing: the red button, and the confirm behind it. */}

          {/* Only when the cohort's year count leaves a real choice. */}
          {variants.length > 1 && (
            <VariantPicker
              variants={variants} value={safeIdx} onChange={setVariantIdx} isPhone={isPhone}
            />
          )}

          {chosen ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {/* Once loaded, laying out again is not the point — switching
                  variant or branching a comparison is. */}
              {!loaded && <button onClick={primary} style={primaryBtn(isPhone)}>{primaryLabel}</button>}
              {loaded && <button onClick={openAsNew} style={primaryBtn(isPhone)}>{t("grad.plan.newplan")}</button>}
              {/* Destructive, so never the default, always confirmed, and
                  coloured like what it does. It read as an ordinary link
                  beside the safe action — the same weight as "open as new
                  plan", which loses nothing. */}
              {offer.verbs.includes("replace") && (
                <button onClick={replace} style={dangerBtn(isPhone)}>{t("grad.plan.replace")}</button>
              )}
              {justDid && (
                <button onClick={() => { doUndo(); setJustDid(null); }} style={linkBtn(isPhone)}>
                  {t("grad.plan.undo")}
                </button>
              )}
            </div>
          ) : (
            <div style={{ fontSize: fz, color: "var(--text-5)" }}>{t("onboard.sampleplan.loading")}</div>
          )}
        </div>
      )}
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
    <div ref={boxRef} style={{ position: "relative", marginBottom: isPhone ? 5 : 6 }}>
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
function planNameFor(path, fmtProgramLabel, taken) {
  const parts = String(path ?? "").split("/");
  const folder = parts[parts.length - 2] || parts[parts.length - 1] || "";
  const base = (fmtProgramLabel?.(folder) || folder.replace(/_/g, " ") || "Plan").trim();
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
/** Replacing discards the student's own work, so it is coloured like it. */
const dangerBtn = (isPhone) => ({
  fontSize: PHONE_FZ(isPhone), fontWeight: 600, background: "transparent",
  border: "1px solid var(--error)", borderRadius: 5,
  padding: isPhone ? "2px 6px" : "3px 8px",
  color: "var(--error-text)", cursor: "pointer",
});
