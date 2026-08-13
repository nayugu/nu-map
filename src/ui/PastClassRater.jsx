// ═══════════════════════════════════════════════════════════════════
// PAST CLASS RATER — the same review sheet, pointed at a term you pick
// rather than the one that just ended.
//
// ── Why this exists ────────────────────────────────────────────────
// Cold start is the only thing that can kill a first-party ratings
// corpus. Waiting for post-term prompts covers a degree in four years;
// letting a senior rate what they already took seeds thirty courses in
// one sitting. This is the single biggest lever the feature has.
//
// ── What retrospective entry costs, and what is done about it ──────
// · Recall drifts. Every rating carries a coarse RECENCY band so the
//   decay can be measured against fresh reports rather than assumed —
//   see recencyOf(). Bands, not exact ages, because term-rated plus
//   exact age reconstructs the term it was submitted in.
// · Long forms get satisficed. Rows are paged, and a straight-lined
//   set is queried before sending — on the device, never transmitted.
// · Batching de-anonymises. Thirty ratings in one request make the
//   request itself the join, and a full course history identifies a
//   person better than a name does. Submissions are split and shuffled
//   by independentSubmissions() and dispatched separately.
//
// This component owns term selection and the recency calculation; the
// sheet itself is shared with the post-term prompt so both entry points
// validate, page and submit identically.
// ═══════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import { usePlanner } from "../context/PlannerContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import TermReviewPrompt from "./TermReviewPrompt.jsx";
import { recencyOf, independentSubmissions } from "../core/courseRatings.js";

/** Rows are paged at this size. Eight is about one screen without
    scrolling, and short enough that each row still gets read. */
const PAGE_SIZE = 8;

/**
 * @param {Object} props
 * @param {(submission:object) => void} props.onSubmitOne
 *   Called once PER RATING, never with an array — the split is the point.
 * @param {() => void} props.onDismiss
 */
export default function PastClassRater({ onSubmitOne, onDismiss }) {
  const { t } = useLanguage();
  const {
    SEMESTERS, SEM_INDEX, placements, courseMap, currentSemId,
    mayShareRatings,
  } = usePlanner();

  // Only terms that are actually behind the student and actually hold
  // courses. Offering a future or empty term would be a dead end.
  const nowIdx = SEM_INDEX?.[currentSemId] ?? 0;
  const pastTerms = useMemo(() => {
    const bySem = {};
    for (const [pid, p] of Object.entries(placements ?? {})) {
      if (p?.semId) (bySem[p.semId] ??= []).push([pid, p]);
    }
    return (SEMESTERS ?? [])
      .filter(s => (SEM_INDEX?.[s.id] ?? 0) < nowIdx && bySem[s.id]?.length)
      .map(s => ({ sem: s, entries: bySem[s.id] }));
  }, [SEMESTERS, SEM_INDEX, placements, nowIdx]);

  const [termId, setTermId] = useState(() => pastTerms.at(-1)?.sem.id ?? null);
  const picked = pastTerms.find(x => x.sem.id === termId) ?? pastTerms.at(-1);

  const rows = useMemo(() => (picked?.entries ?? []).map(([pid, p]) => {
    const c = courseMap?.[p.courseId] ?? {};
    return {
      pid,
      courseId: p.courseId,
      code:  c.code  ?? p.courseId,
      title: c.title ?? "",
      instructors: [],           // from Banner once the adapter is wired
    };
  }), [picked, courseMap]);

  if (!pastTerms.length) return null;

  const termSelect = (
    <select value={picked?.sem.id ?? ""}
            onChange={e => setTermId(e.target.value)}
            aria-label={t("review.past.pick")}
            style={{
              fontSize: 13, fontWeight: 700, fontFamily: "inherit",
              color: "var(--text-1)", background: "transparent",
              border: "1px solid var(--border-2)", borderRadius: 6,
              padding: "3px 6px", cursor: "pointer",
            }}>
      {pastTerms.map(({ sem }) => (
        <option key={sem.id} value={sem.id}>{sem.label ?? sem.id}</option>
      ))}
    </select>
  );

  const submit = (termCode, drafts) => {
    // The consent gate, enforced here rather than only drawn in the UI: a
    // sheet that can be dismissed is not a control, and the answers are
    // already saved locally either way. Without an explicit "on", the
    // ratings simply stay on the device.
    if (!mayShareRatings) return;
    // Terms between the rated term and now — the only time signal a
    // submission carries, and only as a three-way band.
    const elapsed = nowIdx - (SEM_INDEX?.[termCode] ?? nowIdx);
    const recency = recencyOf(elapsed);
    const stamped = drafts.map(d => ({ ...d, term: termCode, recency }));
    // Split, shuffle, and hand them over one at a time. The caller must
    // not re-batch them.
    for (const one of independentSubmissions(stamped)) onSubmitOne(one);
  };

  return (
    <TermReviewPrompt
      termLabel={picked?.sem.label ?? ""}
      termCode={picked?.sem.id ?? ""}
      termSelect={termSelect}
      rows={rows}
      pageSize={PAGE_SIZE}
      onSubmit={submit}
      onDismiss={onDismiss}
    />
  );
}
