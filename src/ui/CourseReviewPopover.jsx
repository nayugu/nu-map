// ═══════════════════════════════════════════════════════════════════
// COURSE REVIEW POPOVER — everything you can say about a course you
// took, in one place: the grade you got, and what it cost you.
//
// ── Why one popover and not two ────────────────────────────────────
// The grade chip on a card and the review button in the info panel are
// the same question asked from two places ("you took this — how did it
// go?"), so they open the same surface. Two popovers would mean two
// habits to learn, and the second one would go unfound.
//
// ── The two halves have different fates, and the footer says so ────
//   left   GRADE — writes to plan state, stays on this device, is a
//          PRIVATE_FIELDS entry and never enters a share link.
//   right  HOURS + DIFFICULTY — written to the device-local rating
//          store, and submitted anonymously later.
// A student has no other way to know that, so it is stated in the
// popover rather than buried in a settings page.
//
// The grade half is the ORIGINAL GradePopover content, unchanged in
// behaviour: letters as a grid because everyone reads those at a
// glance, and S/U/T/I/W each carrying a line of explanation because an
// S is not "like an A" and a W is not a failure.
// ═══════════════════════════════════════════════════════════════════
import { useMemo, useRef, useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../context/LanguageContext.jsx";
import { usePlanner } from "../context/PlannerContext.jsx";
import { GRADE_POINTS } from "../core/gradeSystem.js";
import ClearButton from "./ClearButton.jsx";
import {
  DIFFICULTY_MIN, DIFFICULTY_MAX, DIFFICULTY_STEP, HOURS_MIN, HOURS_CAP,
} from "../core/courseRatings.js";

const GRADE_W  = 214;   // the original popover's content width
const RATE_W   = 218;
const GAP      = 8;
const EDGE     = 8;
// `box-sizing: border-box` is global (index.html), so the popover's `width`
// is the OUTER box — padding and the divider's margins have to be added in,
// or the columns (which do not shrink) overflow and text runs off screen.
const PAD_X    = 15;
const DIV_W    = 25;    // 1px rule + 12px either side

const LETTERS = Object.keys(GRADE_POINTS);
const OTHERS  = ["S", "U", "T", "I", "W"];

/**
 * @param {Object} props
 * @param {string} props.pid       placement id — where the GRADE is stored
 * @param {string} props.courseId  catalog id — where the RATING is stored
 * @param {string} props.semId     absolute term id, e.g. "fall2025"
 * @param {?string} props.grade
 * @param {DOMRect} props.rect     anchor
 * @param {(pid:string, g:?string) => void} props.setGrade
 * @param {() => void} props.onDismiss
 * @param {boolean} [props.rateOnly] hide the grade half — used when a course
 *                                   has no placement to hang a grade on
 */
export default function CourseReviewPopover({
  pid, courseId, semId, grade, rect, setGrade, onDismiss, rateOnly,
}) {
  const { t } = useLanguage();
  const { ratingFor, setRating, isPhone, courseMap, privateGrades } = usePlanner();
  const ref = useRef(null);
  const [placed, setPlaced] = useState(null);

  const rating = ratingFor?.(courseId, semId) ?? null;

  // Who taught this course in the SEMESTER TYPE it was taken in. The scrape
  // records instructors per semester type (fall / spring / sumA / sumB), not
  // per calendar year, so a `fall2025` placement asks the "fall" list —
  // semester ids are `<type><year>`, hence stripping the trailing digits.
  // Ordered by share of enrolment, so the usual instructor is first.
  const instructors = useMemo(() => {
    const semType = String(semId ?? "").replace(/\d+$/, "");
    const entries = courseMap?.[courseId]?.offering?.prof?.[semType];
    if (!Array.isArray(entries)) return [];
    return entries
      .filter(e => Array.isArray(e) && typeof e[0] === "string" && e[0])
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
      .map(e => e[0]);
  }, [courseMap, courseId, semId]);
  const showGrade = !rateOnly && pid;
  // On a phone the two columns will not fit side by side, so they stack —
  // the divider becomes a horizontal rule and the popover stays reachable.
  const stacked = isPhone;
  const width = (stacked
    ? Math.max(GRADE_W, RATE_W)
    : (showGrade ? GRADE_W + DIV_W + RATE_W : RATE_W)) + PAD_X * 2;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.min(Math.max(EDGE, left), window.innerWidth - width - EDGE);
    let top = rect.bottom + GAP;
    if (top + h > window.innerHeight - EDGE) top = rect.top - GAP - h;
    top = Math.min(Math.max(EDGE, top), window.innerHeight - h - EDGE);
    setPlaced({ top: Math.round(top), left: Math.round(left) });
  }, [rect, width]);

  const pickGrade = (g) => { setGrade(pid, g); };
  const setField  = (f, v) => setRating(courseId, semId, f, v);

  const cell = (g, selected) => ({
    padding: "4px 0", fontSize: 11, fontWeight: 700, textAlign: "center",
    borderRadius: 5, cursor: "pointer", userSelect: "none",
    border: `1px solid ${selected ? "var(--active)" : "var(--border-2)"}`,
    background: selected ? "var(--badge-bg)" : "transparent",
    color: selected ? "var(--active)" : "var(--text-2)",
  });
  const sectionLabel = {
    fontSize: 9.5, fontWeight: 600, color: "var(--text-5)", marginBottom: 5,
  };
  // The right column's three headings use the SAME style as "GRADE" on the
  // left, not the smaller subtitle style — they are the column's headings,
  // and matching them to "Letter grade" made the two sides read at
  // different levels.
  const fieldLabel = {
    fontSize: 10, fontWeight: 700, color: "var(--text-4)",
    letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 2,
  };
  // One line under each heading saying what the field actually means. The
  // main threat to self-reported data is not dishonesty, it is people
  // silently counting different things.
  const fieldHelp = {
    fontSize: 9, lineHeight: 1.45, color: "var(--text-5)",
    opacity: 0.85, marginBottom: 6,
  };

  // "Keep grades private" is a presentation switch for showing your plan to
  // someone else, and what you reported a course cost you is exactly as
  // personal in that moment as the grade beside it. It HIDES, never
  // deletes: the stored values are untouched and reappear when it is off.
  const hidden = privateGrades;

  const hours = rating?.hours ?? null;
  const touched = hours !== null && hours !== undefined;
  const setHours = v => setField("hours", Math.max(HOURS_MIN, Math.min(HOURS_CAP, v)));

  const ratedDiff = rating?.difficulty !== null && rating?.difficulty !== undefined;

  return createPortal(
    <>
      <div onClick={e => { e.stopPropagation(); onDismiss?.(); }}
           onMouseOver={e => e.stopPropagation()}
           onMouseOut={e => e.stopPropagation()}
           style={{ position: "fixed", inset: 0, zIndex: 9000 }} />
      <div ref={ref}
           onClick={e => e.stopPropagation()}
           onMouseOver={e => e.stopPropagation()}
           onMouseOut={e => e.stopPropagation()}
           style={{
             position: "fixed",
             left: placed ? placed.left : Math.round(rect.left),
             top:  placed ? placed.top  : Math.round(rect.bottom + GAP),
             zIndex: 9001, width, padding: `13px ${PAD_X}px`,
             background: "var(--bg-surface)", border: "1px solid var(--border-card)",
             borderRadius: 9, boxShadow: "var(--shadow-modal)",
             fontFamily: "'Inter', system-ui, sans-serif",
             visibility: placed ? "visible" : "hidden",
           }}>

        <div style={{
          display: "flex", flexDirection: stacked ? "column" : "row",
          gap: stacked ? 12 : 0, alignItems: "stretch",
        }}>

          {showGrade && (
            <div style={{ width: stacked ? "auto" : GRADE_W, flexShrink: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-4)",
                            letterSpacing: "0.06em", marginBottom: 9 }}>
                <bdi>{t("grade.pop.title")}</bdi>
              </div>
              <div style={sectionLabel}><bdi>{t("grade.pop.letters")}</bdi></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
                {LETTERS.map(g => (
                  <div key={g} style={cell(g, grade === g)} onClick={() => pickGrade(g)}>{g}</div>
                ))}
              </div>
              <div style={{ ...sectionLabel, margin: "10px 0 5px" }}>
                <bdi>{t("grade.pop.other")}</bdi>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {OTHERS.map(g => (
                  <div key={g} onClick={() => pickGrade(g)}
                       style={{ display: "flex", alignItems: "center", gap: 8,
                                padding: "3px 4px", borderRadius: 5, cursor: "pointer",
                                border: `1px solid ${grade === g ? "var(--active)" : "transparent"}`,
                                background: grade === g ? "var(--badge-bg)" : "transparent" }}>
                    <span style={{ flexShrink: 0, width: 22, textAlign: "center", fontSize: 11,
                                   fontWeight: 800, borderRadius: 4, padding: "2px 0",
                                   border: "1px solid var(--border-2)",
                                   color: grade === g ? "var(--active)" : "var(--text-2)" }}>{g}</span>
                    <span style={{ fontSize: 10, lineHeight: 1.4, color: "var(--text-4)" }}>
                      {t(`grade.desc.${g}`)}
                    </span>
                  </div>
                ))}
              </div>
              {grade != null && (
                <div onClick={() => pickGrade(null)}
                     style={{ marginTop: 10, paddingTop: 9,
                              borderTop: "1px solid var(--border-2)",
                              fontSize: 10.5, fontWeight: 600, color: "var(--text-4)",
                              cursor: "pointer", textAlign: "center" }}>
                  {t("grade.clear")}
                </div>
              )}
            </div>
          )}

          {/* The "|" — a real divider between two things that go to two
              different places, not decoration. */}
          {showGrade && (
            stacked
              ? <div style={{ height: 1, background: "var(--border-2)" }} />
              : <div style={{ width: 1, background: "var(--border-2)", margin: "0 12px" }} />
          )}

          {/* minWidth:0 lets long translated labels wrap instead of pushing
              the column past the popover's edge. */}
          <div style={{ width: stacked ? "auto" : RATE_W, flexShrink: 0, minWidth: 0 }}>
            {/* No column title: these three headings ARE the column, and
                they carry the same weight as "GRADE" opposite. */}
            <div style={fieldLabel}><bdi>{t("review.col.hours")}</bdi></div>
            <div style={fieldHelp}>{t("review.hours.help")}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {/* Masking the number is not enough — a thumb four-fifths along
                  the track states the answer just as plainly. While hidden the
                  control is parked and disabled, which also stops a stray drag
                  overwriting a real answer nobody can currently see. */}
              <input type="range" min={HOURS_MIN} max={HOURS_CAP} step={1}
                     value={hidden ? HOURS_MIN : touched ? hours : HOURS_MIN}
                     disabled={hidden}
                     aria-label={t("review.col.hours")}
                     onChange={e => setHours(Number(e.target.value))}
                     style={{ flex: 1, minWidth: 0, accentColor: "var(--active)",
                              // No thumb value until touched: an optional field
                              // must not manufacture an answer at its default.
                              opacity: hidden ? 0.25 : touched ? 1 : 0.35,
                              cursor: hidden ? "default" : "pointer" }} />
              {/* The unit rides with the number: the heading sits above the
                  slider, so at the point of reading "14" would otherwise be
                  a bare figure. Muted and smaller so the number still leads. */}
              <div style={{ minWidth: 40, textAlign: "right", fontSize: 11, fontWeight: 700,
                            fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
                            color: touched ? "var(--text-1)" : "var(--text-5)" }}>
                {hidden ? "••" : touched ? (hours >= HOURS_CAP ? `${HOURS_CAP}+` : hours) : "—"}
                <span style={{ fontSize: 9, fontWeight: 600, marginInlineStart: 2,
                               color: "var(--text-5)" }}>
                  {t("review.hours.unit")}
                </span>
              </div>
              {/* Its presence alone would say "this one is answered". */}
              <ClearButton show={touched && !hidden} onClick={() => setField("hours", null)}
                     title={t("review.hours.clear")} />
            </div>

            <div style={{ ...fieldLabel, margin: "14px 0 2px" }}>
              <bdi>{t("review.col.difficulty")}</bdi>
            </div>
            {/* Says what difficulty is NOT, because hours already covers
                time — without this the two fields collect the same answer
                twice and the pair stops being informative. */}
            <div style={fieldHelp}>{t("review.difficulty.help")}</div>
            {/* Same control and the same width as hours, so the two answers
                read as one pair rather than two unrelated widgets. */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input type="range"
                     min={DIFFICULTY_MIN} max={DIFFICULTY_MAX} step={DIFFICULTY_STEP}
                     value={hidden ? DIFFICULTY_MIN : ratedDiff ? rating.difficulty : DIFFICULTY_MIN}
                     disabled={hidden}
                     aria-label={t("review.col.difficulty")}
                     onChange={e => setField("difficulty", Number(e.target.value))}
                     style={{ flex: 1, minWidth: 0, accentColor: "var(--active)",
                              opacity: hidden ? 0.25 : ratedDiff ? 1 : 0.35,
                              cursor: hidden ? "default" : "pointer" }} />
              <div style={{ minWidth: 26, textAlign: "right", fontSize: 11, fontWeight: 700,
                            fontVariantNumeric: "tabular-nums",
                            color: ratedDiff ? "var(--text-1)" : "var(--text-5)" }}>
                {hidden ? "••" : ratedDiff ? `${rating.difficulty}/${DIFFICULTY_MAX}` : `—/${DIFFICULTY_MAX}`}
              </div>
              <ClearButton show={ratedDiff && !hidden} onClick={() => setField("difficulty", null)}
                     title={t("review.difficulty.clear")} />
            </div>
            {/* The word matters more than the number — "4/5" says nothing
                about which end is hard. Half-steps take the nearest name,
                rounding up so the warning is the conservative one. */}
            <div style={{ fontSize: 9, color: "var(--text-5)", marginTop: 3,
                          minHeight: 12, whiteSpace: "nowrap",
                          overflow: "hidden", textOverflow: "ellipsis" }}>
              {hidden ? "" : ratedDiff ? t(`review.difficulty.${Math.round(rating.difficulty)}`) : ""}
            </div>

            {/* Instructor — the whole reason per-professor figures are
                possible. A picker, never a pre-fill: only about half of
                courses have a single instructor in a typical term, so
                guessing would misattribute roughly half of all
                professor-level ratings. Unset is fine — the rating still
                counts toward the course. */}
            {instructors.length > 0 && (
              <>
                {/* No help line: the heading already says it. */}
                <div style={{ ...fieldLabel, margin: "14px 0 5px" }}>
                  <bdi>{t("review.col.instructor")}</bdi>
                </div>
                {/* `appearance: none` + our own chevron: the native control
                    renders in the BROWSER's font and chrome, which is what
                    made it look pasted in. Colours stay on theme variables
                    rather than a literal white — a hard white would be a
                    bright rectangle in the dark theme. `colorScheme` is what
                    makes the popped-open option list follow the theme too. */}
                <div style={{ position: "relative" }}>
                  <select value={rating?.instructor ?? ""}
                          onChange={e => setField("instructor", e.target.value || null)}
                          aria-label={t("review.col.instructor")}
                          style={{
                            width: "100%", maxWidth: "100%",
                            appearance: "none", WebkitAppearance: "none",
                            fontFamily: "'Inter', system-ui, sans-serif",
                            fontSize: 10.5, fontWeight: 600,
                            padding: "5px 22px 5px 8px", borderRadius: 6,
                            border: "1px solid var(--border-2)",
                            background: "var(--bg-surface)",
                            color: rating?.instructor ? "var(--text-1)" : "var(--text-4)",
                            colorScheme: "light dark",
                            cursor: "pointer", lineHeight: 1.3,
                            textOverflow: "ellipsis",
                          }}>
                    <option value="">{t("review.instructor.none")}</option>
                    {instructors.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                  <span aria-hidden="true" style={{
                    position: "absolute", insetInlineEnd: 8, top: "50%",
                    transform: "translateY(-50%)", pointerEvents: "none",
                    fontSize: 8, color: "var(--text-5)",
                  }}>▼</span>
                </div>
              </>
            )}

          </div>
        </div>

        <div style={{ marginTop: 11, paddingTop: 9,
                      borderTop: "1px solid var(--border-2)",
                      fontSize: 9.5, lineHeight: 1.5, color: "var(--text-5)" }}>
          {showGrade ? t("review.privacy") : t("review.privacy.rateonly")}
        </div>
      </div>
    </>,
    document.body,
  );
}

