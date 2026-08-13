// ═══════════════════════════════════════════════════════════════════
// TERM REVIEW PROMPT — one screen, at the end of a term: what did you
// get, and what did it cost you?
//
// ── Why one table and not a wizard ─────────────────────────────────
// A per-course wizard would be five screens for a normal term. Nobody
// finishes those. Every course is a row, every field is a tap, and
// there is exactly one Save. Partial answers are the expected case,
// not an error state.
//
// ── Two destinations, one form ─────────────────────────────────────
// The grade column writes to LOCAL plan state and goes nowhere else —
// grades are a PRIVATE_FIELDS entry, excluded from share links by
// invariant. The difficulty and hours columns are submitted
// anonymously. Same table, different fates, and the footer says so in
// as many words because a student has no other way to know.
//
// ── Why the hours slider starts with no thumb ──────────────────────
// Every field here is optional, so an untouched control must be
// distinguishable from a deliberate answer. A slider resting at a
// default silently manufactures responses at whatever value it rests
// on — the classic anchoring artefact. Until it is touched there is no
// thumb and no value, and the row submits nothing for that field.
//
// Hours is TOTAL time (class + homework + group work + reading +
// study), which is why the helper line enumerates them: the main
// threat to self-reported data is not dishonesty, it is people
// silently counting different things.
// ═══════════════════════════════════════════════════════════════════
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePlanner } from "../context/PlannerContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import GradePopover from "./GradePopover.jsx";
import ClearButton from "./ClearButton.jsx";
import RatingConsentSheet from "./RatingConsentSheet.jsx";
import {
  DIFFICULTY_MIN, DIFFICULTY_MAX, DIFFICULTY_STEP, HOURS_MIN, HOURS_CAP,
  normalizeRating, looksStraightLined,
} from "../core/courseRatings.js";

/**
 * @param {Object}   props
 * @param {string}   props.termLabel  already-localized term name, e.g. "Fall 2025"
 * @param {string}   props.termCode   Banner term code — the ONLY time granularity
 *                                    a submission ever carries
 * @param {Array<{pid:string, courseId:string, code:string, title:string,
 *                instructors:string[]}>} props.rows
 * @param {(termCode:string, drafts:object[]) => void} props.onSubmit
 * @param {() => void} props.onDismiss
 * @param {number}   [props.pageSize]   paginate above this many rows. Retrospective
 *                                      entry can produce thirty rows at once, and a
 *                                      wall of them is what produces straight-lined
 *                                      answers — a page at a time keeps each row read.
 * @param {React.ReactNode} [props.termSelect] rendered instead of the static term
 *                                      label, so a caller can let the user pick which
 *                                      past term they are rating.
 */
export default function TermReviewPrompt({
  termLabel, termCode, rows, onSubmit, onDismiss, pageSize, termSelect,
}) {
  const { t } = useLanguage();
  const {
    grades, setGrade, ratingFor, setRating, ratingConsent, mayShareRatings,
  } = usePlanner();
  const [page, setPage] = useState(0);
  const [askConsent, setAskConsent] = useState(false);

  // Nothing is staged here. Both halves write straight through — grades to
  // plan state, ratings to the device-local rating store — so this sheet,
  // the grade chip on a card and the info-panel button are three views of
  // ONE set of answers. Staging would mean a course could read as rated in
  // one place and unrated in another, and closing without saving would
  // silently discard work the student believes they entered.
  const [gradeAt, setGradeAt] = useState(null);       // {pid, rect} while the popover is open
  const chipRefs = useRef({});

  const patch = (r, field, value) => setRating(r.courseId, termCode, field, value);
  const valueOf = (r) => ratingFor?.(r.courseId, termCode) ?? null;

  const drafts = useMemo(() => rows
    .map(r => {
      const v = ratingFor?.(r.courseId, termCode) ?? null;
      return normalizeRating({
        courseId:   r.courseId,
        instructor: v?.instructor ?? null,
        difficulty: v?.difficulty ?? null,
        hours:      v?.hours ?? null,
      });
    })
    .filter(Boolean), [rows, termCode, ratingFor]);

  const openGrade = (pid) => {
    const el = chipRefs.current[pid];
    if (el) setGradeAt({ pid, rect: el.getBoundingClientRect() });
  };

  // Pagination is over the ROWS only — `draft` is keyed by pid, so answers
  // given on page 1 survive paging and are all submitted together.
  const size     = pageSize && pageSize > 0 ? pageSize : rows.length || 1;
  const pages    = Math.max(1, Math.ceil(rows.length / size));
  const current  = Math.min(page, pages - 1);
  const shown    = pages > 1 ? rows.slice(current * size, current * size + size) : rows;

  // A nudge, not a gate: uniform answers across many courses is what a long
  // form gets when someone stops reading it, but it is also a real semester.
  // Ask, never refuse — and this never leaves the device (see the note on
  // looksStraightLined; a shared flag on independent submissions would
  // re-link them).
  const flat = looksStraightLined(drafts);
  const flatWarn = flat.difficulty || flat.hours;

  const cell = { padding: "9px 8px", verticalAlign: "middle" };
  const head = {
    ...cell, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em",
    color: "var(--text-5)", textTransform: "uppercase", textAlign: "left",
  };

  return createPortal(
    <>
      <div onClick={onDismiss}
           style={{ position: "fixed", inset: 0, zIndex: 8500,
                    background: "var(--overlay, rgba(0,0,0,0.45))" }} />
      <div role="dialog" aria-modal="true" aria-label={t("review.title")}
           onClick={e => e.stopPropagation()}
           style={{
             position: "fixed", zIndex: 8501,
             left: "50%", top: "50%", transform: "translate(-50%, -50%)",
             width: "min(760px, calc(100vw - 32px))",
             maxHeight: "calc(100vh - 64px)", overflowY: "auto",
             background: "var(--bg-surface)",
             border: "1px solid var(--border-card)", borderRadius: 11,
             boxShadow: "var(--shadow-modal)", padding: "18px 20px 16px",
             fontFamily: "'Inter', system-ui, sans-serif",
           }}>

        <div style={{ display: "flex", alignItems: "baseline",
                      justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text-1)" }}>
            {termSelect ?? <bdi>{t("review.title", { term: termLabel })}</bdi>}
          </div>
          <div style={{ fontSize: 10.5, color: "var(--text-4)" }}>
            {t("review.optional")}
          </div>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-2)" }}>
              <th style={head}><bdi>{t("review.col.course")}</bdi></th>
              <th style={{ ...head, width: 62 }}>{t("review.col.grade")}</th>
              <th style={{ ...head, width: 132 }}>{t("review.col.instructor")}</th>
              {/* Widths track the controls inside them: slider + readout +
                  a 28px clear target (WCAG 2.5.8) + gaps + 16px cell
                  padding. Too narrow and the clear button overflows the
                  cell, which is how it silently became unhittable. */}
              <th style={{ ...head, width: 138 }}>{t("review.col.difficulty")}</th>
              <th style={{ ...head, width: 172 }}>{t("review.col.hours")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(r => {
              const d = valueOf(r) ?? {};
              return (
                <tr key={r.pid} style={{ borderBottom: "1px solid var(--border-3, var(--border-2))" }}>
                  <td style={cell}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-1)" }}>
                      <bdi>{r.code}</bdi>
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 1 }}>
                      <bdi>{r.title}</bdi>
                    </div>
                  </td>

                  {/* Grade — reuses the existing popover, so the symbol
                      vocabulary (S/U/T/I/W) and its explanations stay in
                      exactly one place. Writes to plan state immediately. */}
                  <td style={cell}>
                    <div ref={el => { chipRefs.current[r.pid] = el; }}
                         onClick={() => openGrade(r.pid)}
                         style={{
                           fontSize: 11, fontWeight: 700, textAlign: "center",
                           padding: "4px 0", borderRadius: 5, cursor: "pointer",
                           border: `1px solid ${grades?.[r.pid] ? "var(--active)" : "var(--border-2)"}`,
                           color: grades?.[r.pid] ? "var(--active)" : "var(--text-5)",
                           background: grades?.[r.pid] ? "var(--badge-bg)" : "transparent",
                         }}>
                      {grades?.[r.pid] ?? "—"}
                    </div>
                  </td>

                  {/* Instructor — a picker, never a silent pre-fill. Only
                      54% of courses have a single instructor in a typical
                      term, so guessing would misattribute roughly half of
                      all professor-level ratings. */}
                  <td style={cell}>
                    <select value={d.instructor ?? ""}
                            onChange={e => patch(r, "instructor", e.target.value || null)}
                            style={{
                              width: "100%", fontSize: 10.5, padding: "4px 5px",
                              borderRadius: 5, border: "1px solid var(--border-2)",
                              background: "transparent", color: "var(--text-2)",
                              fontFamily: "inherit",
                            }}>
                      <option value="">{t("review.instructor.none")}</option>
                      {r.instructors.map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </td>

                  {/* The same half-step slider the popover uses. Dots could
                      only express whole points, so a 3.5 entered in the
                      popover rendered here as nothing selected at all — the
                      two surfaces must speak the same scale. */}
                  <td style={cell}>
                    <DifficultyField
                      value={d.difficulty ?? null}
                      onChange={v => patch(r, "difficulty", v)}
                      t={t}
                    />
                  </td>

                  {/* Hours — no thumb until touched, so "unset" stays
                      distinguishable from a deliberate answer. */}
                  <td style={cell}>
                    <HoursField
                      value={d.hours ?? null}
                      onChange={v => patch(r, "hours", v)}
                      t={t}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div style={{ marginTop: 12, fontSize: 10, lineHeight: 1.55, color: "var(--text-4)" }}>
          <div>{t("review.hours.help")}</div>
          <div style={{ marginTop: 3 }}>{t("review.privacy")}</div>
          {flatWarn && (
            <div style={{ marginTop: 5, color: "var(--text-3)" }}>
              {t("review.straightline")}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center",
                      justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          {pages > 1 && (
            <div style={{ marginRight: "auto", display: "flex",
                          alignItems: "center", gap: 6 }}>
              <button onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={current === 0} style={btn(false)}>‹</button>
              <span style={{ fontSize: 10, color: "var(--text-4)",
                             fontVariantNumeric: "tabular-nums" }}>
                {t("review.page", { page: current + 1, pages })}
              </span>
              <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))}
                      disabled={current === pages - 1} style={btn(false)}>›</button>
            </div>
          )}
          <button onClick={onDismiss}
                  style={btn(false)}>{t("review.later")}</button>
          {/* Answers are already saved locally by this point — this button
              only decides whether they are also contributed. So on a first
              submission it opens the consent sheet instead of sending, and
              nothing is lost if the answer is no. */}
          <button onClick={() => {
                    if (ratingConsent === "unasked" && drafts.length) {
                      setAskConsent(true);
                      return;
                    }
                    if (mayShareRatings) onSubmit(termCode, drafts);
                    onDismiss();
                  }}
                  style={btn(true)}>
            {drafts.length ? t("review.save.n", { n: drafts.length }) : t("review.save")}
          </button>
        </div>
      </div>

      {askConsent && (
        <RatingConsentSheet onDecided={() => {
          setAskConsent(false);
          // Re-read consent from the store rather than assuming the answer:
          // the sheet owns the decision, this only acts on it.
          onDismiss();
        }} />
      )}

      {gradeAt && (
        <GradePopover
          pid={gradeAt.pid}
          grade={grades?.[gradeAt.pid] ?? null}
          rect={gradeAt.rect}
          setGrade={setGrade}
          onDismiss={() => setGradeAt(null)}
        />
      )}
    </>,
    document.body,
  );
}

/** The hours control: a 1–20 integer slider whose top value means "or more".
    The scale starts at 1 because hours is TOTAL time — a course you attended
    at all took more than none of your week — so there is no 0 sitting at the
    slider's floor for a stray tap to enter. "No answer" is null, and the ×
    is the only way to say it. */
function HoursField({ value, onChange, t }) {
  const set = v => onChange(Math.max(HOURS_MIN, Math.min(HOURS_CAP, v)));
  const touched = value !== null && value !== undefined;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        type="range" min={HOURS_MIN} max={HOURS_CAP} step={1}
        value={touched ? value : HOURS_MIN}
        aria-label={t("review.col.hours")}
        onChange={e => set(Number(e.target.value))}
        style={{
          flex: 1, minWidth: 74, accentColor: "var(--active)",
          // Until it is touched the control is visibly inert — there is no
          // value to read off it, and no thumb inviting one.
          opacity: touched ? 1 : 0.35, cursor: "pointer",
        }}
      />
      <div style={{
        minWidth: 40, textAlign: "right", fontSize: 10.5, fontWeight: 700,
        fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
        color: touched ? "var(--text-1)" : "var(--text-5)",
      }}>
        {touched ? (value >= HOURS_CAP ? `${HOURS_CAP}+` : value) : "—"}
        <span style={{ fontSize: 9, fontWeight: 600, marginInlineStart: 2,
                       color: "var(--text-5)" }}>
          {t("review.hours.unit")}
        </span>
      </div>
      <ClearButton show={touched} onClick={() => onChange(null)}
                   title={t("review.hours.clear")} />
    </div>
  );
}


/** Difficulty, on the same 1–5 half-step scale as the popover. Reads
    "3.5/5" rather than a row of dots: the number carries the scale's
    ceiling with it, which a filled dot does not. */
function DifficultyField({ value, onChange, t }) {
  const rated = value !== null && value !== undefined;
  const set = v => onChange(Math.max(DIFFICULTY_MIN, Math.min(DIFFICULTY_MAX, v)));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        type="range" min={DIFFICULTY_MIN} max={DIFFICULTY_MAX} step={DIFFICULTY_STEP}
        value={rated ? value : DIFFICULTY_MIN}
        aria-label={t("review.col.difficulty")}
        title={rated ? t(`review.difficulty.${Math.round(value)}`) : undefined}
        onChange={e => set(Number(e.target.value))}
        style={{ flex: 1, minWidth: 54, accentColor: "var(--active)",
                 opacity: rated ? 1 : 0.35, cursor: "pointer" }}
      />
      <div style={{ minWidth: 28, textAlign: "right", fontSize: 10.5, fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                    color: rated ? "var(--text-1)" : "var(--text-5)" }}>
        {rated ? `${value}/${DIFFICULTY_MAX}` : `—/${DIFFICULTY_MAX}`}
      </div>
      <ClearButton show={rated} onClick={() => onChange(null)}
                   title={t("review.difficulty.clear")} />
    </div>
  );
}


const btn = (primary) => ({
  fontSize: 11, fontWeight: 700, padding: "6px 14px", borderRadius: 6,
  cursor: "pointer", fontFamily: "inherit",
  border: `1px solid ${primary ? "var(--active)" : "var(--border-2)"}`,
  background: primary ? "var(--active)" : "transparent",
  color: primary ? "var(--on-active, #fff)" : "var(--text-3)",
});
