import { usePort } from "../context/InstitutionContext.jsx";
import { ICalendar } from "../ports/ICalendar.js";
import { TText } from "../context/TranslationContext.jsx";

// Single source of truth for a translated "<semester> <year>" label.
//
// Shared by the planner (Header's SemToastLabel) and the availability popover so their semester
// names always match. The planner's cohort SEMESTERS list only spans a plan's entry→grad range,
// so the popover — which shows historical terms (e.g. Fall 2023) — can't just look a name up; it
// builds one here instead, using the same rules.
//
// The whole "<label> <year>" phrase is translated together so the year reorders naturally per
// locale (e.g. Chinese year-first: 2024年春季). Any institution-specific phrasing lives in the
// calendar adapter, not here: a SemesterType may carry `altLabel` (a display override, e.g. NEU's
// "Summer A") and `translateAs` (an engine disambiguation hint, e.g. "Summer half-term A"). This
// component stays institution-agnostic — it just reads those optional fields from the port.
/**
 * Hand-written season names, by semester-type id.
 *
 * Per-word engine translation loses the context ("Fall" → 落下, "falling") and
 * whole-phrase output reorders per locale, so every term type we know by name
 * uses a written key instead: deterministic, and season-first in all eight
 * locales. A type with no key here falls back to engine translation of the
 * whole label. Lives beside `semLabelPhrases` because it answers the same
 * question — how is a semester named — and is shared by the planner rows and
 * the sample-plan preview so the two can never disagree.
 */
export const SEM_NAME_KEY = {
  fall: "claude.sem.fall", spring: "claude.sem.spring",
  sumA: "claude.sem.sum1", sumB: "claude.sem.sum2",
  incoming: "claude.sem.incoming",
};

export function semLabelPhrases(typeId, year, calendar) {
  const st = calendar.getSemesterTypes().find(s => s.id === typeId);
  const base = st?.altLabel ?? st?.label ?? typeId;   // display text (source locale)
  const hint = st?.translateAs;                        // optional engine rephrasing
  return {
    display: `${base} ${year}`,
    as:      hint ? `${hint} ${year}` : undefined,
  };
}

/** Renders a semester's "<name> <year>" translated identically to the planner rows. */
export function SemLabel({ typeId, year }) {
  const cal = usePort(ICalendar);
  const { display, as } = semLabelPhrases(typeId, year, cal);
  return <TText as={as}>{display}</TText>;
}
