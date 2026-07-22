// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/offeringStats  (pure helpers, no I/O)
//
// The offering-history derivations the user sees in the course info
// panel, extracted so external consumers (MCP query adapter) report the
// exact same numbers the UI renders. InfoPanel currently keeps an inline
// copy of this math; it can adopt this module without behavior change.
//
// Inputs: Course.termHistory / Course.birthTermCode (from courseNorm)
// and Course.offering ({e,c,s,fmt,cmp,dow,pat,lab} from offering-summary.json).
// ═══════════════════════════════════════════════════════════════════
import calendar from "./calendar.js";

/**
 * Historical offering probability for one semester type (0..1), or null
 * when there is no data or fewer than 2 post-birth entries. Pre-birth
 * entries are excluded: a false entry before birthTermCode means the
 * course didn't exist yet, not that it was offered and stopped. The ≥2
 * floor keeps sparse data for new courses from producing a misleading 0%.
 *
 * @param {Record<string,boolean>} termHistory
 * @param {number|null} birthTermCode
 * @param {string} semTypeId  e.g. "fall"
 */
export function semTypeProb(termHistory, birthTermCode, semTypeId) {
  const entries = Object.entries(termHistory ?? {})
    .filter(([code]) => (birthTermCode === null || Number(code) >= birthTermCode)
                     && calendar.decodeTermCode(code) === semTypeId);
  if (entries.length < 2) return null;
  return entries.filter(([, v]) => v).length / entries.length;
}

/**
 * Effective offered/not-offered state for a semester type, combining a
 * user override with the historical probability — the same rule that
 * dims semester labels and raises the ⚠ not-offered badge in the UI.
 *
 * @param {Record<string,boolean>|undefined} overrides  offeredOverrides[courseId]
 * @returns {{ offered: boolean, source: "override"|"history"|"no-data", prob: number|null }}
 */
export function effectiveOffered(termHistory, birthTermCode, semTypeId, overrides) {
  const ovr = (overrides && !Array.isArray(overrides)) ? overrides[semTypeId] : undefined;
  if (ovr === true || ovr === false) {
    return { offered: ovr, source: "override", prob: semTypeProb(termHistory, birthTermCode, semTypeId) };
  }
  const prob = semTypeProb(termHistory, birthTermCode, semTypeId);
  if (prob === null) return { offered: true, source: "no-data", prob: null };
  return { offered: prob > 0.5, source: "history", prob };
}

// Seat-availability thresholds (open seats per section) — the diverging
// green↔red gauge scale in the offering popover.
export const SEATS_ROOM = 6;  // ≥ this open/section = "room" (green side)
export const ROOM_OPEN  = 15; // ≥ this = wide open (fully saturated green)

/**
 * Seat math for one completed term, exactly as the enrollment gauge
 * derives it: fill % (gauge height), open seats, open-per-section
 * (gauge color driver), plus a categorical availability label.
 *
 * @param {number} enr enrolled  @param {number} cap capacity  @param {number} sec sections
 */
export function seatStats(enr, cap, sec) {
  if (!(cap > 0)) return null;
  const open   = Math.max(0, cap - enr);
  const fill   = Math.round((enr / cap) * 100);
  const perSec = open / (sec || 1);
  const availability =
    perSec >= ROOM_OPEN  ? "wide-open" :
    perSec >= SEATS_ROOM ? "room"      :
    perSec >= 1          ? "tight"     : "packed";
  return { enr, cap, sec: sec || 1, open, fill, perSec: Math.round(perSec * 100) / 100, availability };
}

/**
 * Full per-term offering history with seat stats merged in — the data
 * behind the "Offered in" grid plus its hover popovers, newest-first.
 * Terms before birth are excluded (pre-existence noise), matching the UI.
 *
 * @param {object} course  normalized Course (termHistory, birthTermCode, offering)
 */
export function offeringHistory(course) {
  const off = course.offering ?? {};
  return Object.entries(course.termHistory ?? {})
    .filter(([code]) => course.birthTermCode == null || Number(code) >= course.birthTermCode)
    .map(([termCode, offered]) => {
      const semTypeId = calendar.decodeTermCode(termCode);
      const year      = calendar.getTermCodeYear(termCode);
      if (!semTypeId || year == null) return null;
      const seats = offered ? seatStats(off.e?.[termCode], off.c?.[termCode], off.s?.[termCode]) : null;
      return { termCode, semTypeId, year, offered, ...(seats && { seats }) };
    })
    .filter(Boolean)
    .sort((a, b) => b.termCode.localeCompare(a.termCode));
}

/**
 * Per-semester-type offering summary: probability + effective state per
 * semester type in the calendar, honoring the plan's user overrides.
 *
 * @param {object} course
 * @param {Record<string,boolean>|undefined} overrides offeredOverrides[courseId]
 */
export function semTypeSummary(course, overrides) {
  return calendar.getSemesterTypes().map(st => ({
    semTypeId: st.id,
    label:     st.label,
    ...effectiveOffered(course.termHistory, course.birthTermCode ?? null, st.id, overrides),
  }));
}

/**
 * Schedule profile from the offering summary — weekday distribution,
 * enrolment-weighted meeting patterns (with the same "other" remainder
 * the hover chart shows), formats, campuses, linked-lab flag.
 */
export function scheduleProfile(course) {
  const off = course.offering;
  if (!off) return null;
  const pat = off.pat ?? null;
  const patSum = (pat ?? []).reduce((s, [, pct]) => s + pct, 0);
  return {
    weekdayPct: off.dow ?? null,                 // [Mon,Tue,Wed,Thu,Fri] % of enrolment
    patterns:   pat,                             // [["MWR", 38], …] most common first
    otherPct:   pat && 100 - patSum >= 1 ? 100 - patSum : 0,
    formats:    off.fmt ?? [],
    campuses:   off.cmp ?? [],
    linkedLab:  off.lab === true,
  };
}
