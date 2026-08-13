// ═══════════════════════════════════════════════════════════════════
// COURSE REVIEW BUTTON — the info panel's entry into the same popover
// the grade chip opens.
//
// ── Why it is conditional, and why that is not a limitation ────────
// The info panel shows ANY course, including ones you are only
// considering. "Have you taken this?" on a course you are browsing as
// a candidate is noise — you are reading it precisely because you have
// not. Worse, a grade has nowhere to live for an unplaced course:
// grades are keyed by PLACEMENT, so with no placement there is no slot
// to write to and the popover's left half would be inert.
//
// So the button appears exactly when the plan already says you took
// the course: at least one placement, in a term that has started. That
// makes both halves meaningful, and turns the button into a nudge
// rather than a question — it only ever appears on courses you sat in.
//
// ── Why it shouts, and when it stops ───────────────────────────────
// Cold start is the thing that kills a first-party corpus, so an
// unreported course is worth being loud about. Prominence tracks
// fillState, not a boolean: `empty` gets the solid accent, `partial`
// steps down to an outline (someone who answered one field and skipped
// the other has been asked already), and `complete` goes quiet and
// becomes an edit affordance. Nagging a person who has answered is how
// you teach them to ignore the control.
// ═══════════════════════════════════════════════════════════════════
import { useMemo, useRef, useState } from "react";
import { usePlanner } from "../context/PlannerContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { baseId } from "../core/repeatInstances.js";
import { fillState } from "../core/ratingStore.js";
import CourseReviewPopover from "./CourseReviewPopover.jsx";

export default function CourseReviewButton({ courseId }) {
  const { t } = useLanguage();
  const {
    placements, SEM_INDEX, currentSemId, grades, setGrade, ratingFor,
    privateGrades,
  } = usePlanner();
  const ref = useRef(null);
  const [pop, setPop] = useState(null);

  // The take being reviewed: the LATEST placement of this course in a term
  // that has already started. Latest, because a retake is the experience
  // you remember, and because the earlier take usually already has a grade.
  const take = useMemo(() => {
    const nowIdx = SEM_INDEX?.[currentSemId] ?? 0;
    let best = null;
    for (const [pid, p] of Object.entries(placements ?? {})) {
      if (!p?.semId || baseId(pid) !== courseId) continue;
      const idx = SEM_INDEX?.[p.semId];
      if (idx == null || idx >= nowIdx) continue;      // future / in progress
      if (!best || idx > best.idx) best = { pid, semId: p.semId, idx };
    }
    return best;
  }, [placements, SEM_INDEX, currentSemId, courseId]);

  if (!take) return null;

  // Under "keep grades private" the button must not report its own state:
  // "Rated" versus "Rate this course" tells a bystander whether you filled
  // it in, which is the first half of what the switch is meant to hide.
  const state = privateGrades
    ? "empty"
    : fillState(ratingFor?.(courseId, take.semId));
  const solid = state === "empty";
  const label = state === "complete" ? t("review.btn.edit")
              : state === "partial"  ? t("review.btn.finish")
              :                        t("review.btn.ask");

  return (
    <>
      <span
        ref={ref}
        role="button"
        tabIndex={0}
        onClick={e => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          setPop(p => (p ? null : r));
        }}
        onKeyDown={e => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setPop(p => (p ? null : ref.current?.getBoundingClientRect() ?? null));
          }
        }}
        title={t("review.btn.tip")}
        style={{
          fontSize: 9.5, fontWeight: 700, borderRadius: 3, padding: "1px 7px",
          cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
          background: solid ? "var(--active)" : "transparent",
          color: solid ? "#fff" : "var(--active)",
          border: `1px solid var(--active)`,
          opacity: state === "complete" ? 0.6 : 1,
        }}
      >
        {label}
      </span>
      {pop && (
        <CourseReviewPopover
          pid={take.pid}
          courseId={courseId}
          semId={take.semId}
          grade={grades?.[take.pid] ?? null}
          rect={pop}
          setGrade={setGrade}
          onDismiss={() => setPop(null)}
        />
      )}
    </>
  );
}
