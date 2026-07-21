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
// locale (e.g. Chinese year-first: 2024年春季). Summer halves display as "Summer A/B" but feed
// the engine the academic phrasing "Summer half-term A/B <year>" via <TText as=…>, which resolves
// correctly (夏季半学期 A) where a bare "Summer 1" would not.
export function semLabelPhrases(typeId, year, calendar) {
  const isSumA = typeId === "sumA", isSumB = typeId === "sumB";
  const typeLabel = calendar.getSemesterTypes().find(s => s.id === typeId)?.label ?? typeId;
  return {
    display: isSumA ? `Summer A ${year}` : isSumB ? `Summer B ${year}` : `${typeLabel} ${year}`,
    as:      isSumA ? `Summer half-term A ${year}` : isSumB ? `Summer half-term B ${year}` : undefined,
  };
}

/** Renders a semester's "<name> <year>" translated identically to the planner rows. */
export function SemLabel({ typeId, year }) {
  const cal = usePort(ICalendar);
  const { display, as } = semLabelPhrases(typeId, year, cal);
  return <TText as={as}>{display}</TText>;
}
