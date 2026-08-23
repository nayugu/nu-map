// ═══════════════════════════════════════════════════════════════════
// MAINTENANCE — times, in words, in eight languages.
//
// Two facts get shown about a window, and they do different jobs:
//
//   • the RELATIVE phrase ("in 20 minutes") is the glance. It is what makes a
//     student act now instead of later, and it is deliberately rounded.
//   • the ABSOLUTE time ("Sat, Aug 30, 2:00 – 4:00 AM EDT") is the authority.
//     It is shown alongside, always, in the reader's own timezone — because a
//     schedule is meaningless without one, and "2 AM" from a Boston project
//     posted to a student on co-op in Berlin is a 6-hour lie.
//
// Both come from `Intl`, not from strings in src/locales. That is the whole
// point: `RelativeTimeFormat` and `DateTimeFormat` already know the plural
// rules, the word order and the calendar conventions of all eight locales, so
// there is nothing here to hand-translate and nothing to get wrong. Writing
// "in {n} hours" as a locale string instead would have needed per-locale plural
// forms (Arabic has six) and would have been wrong in most of them.
//
// Every function is wrapped: a locale tag the runtime does not know, or an
// `Intl` that is missing a data pack, degrades to a plain ISO-ish string rather
// than throwing. This module renders a screen shown during an outage — it is
// the last place that should be able to fail.
// ═══════════════════════════════════════════════════════════════════

const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;

/**
 * "in 20 minutes" / "3 minutes ago".
 *
 * The unit is chosen by magnitude — minutes up to 90, then hours to 36, then
 * days — and the value is ROUNDED, so 89 minutes reads as "in 89 minutes" and
 * 91 as "in 2 hours". Rounding can therefore overstate by up to half a unit in
 * the far field ("in 2 hours" at 91 minutes out), which is acceptable for two
 * reasons and only those: the absolute time is displayed beside it and is the
 * authority, and the phase that actually asks the reader to DO something
 * (`imminent`, 30 minutes out by default) lands where the unit is minutes and
 * the error is under a minute. Do not use this on its own.
 *
 * @param {number} ms signed offset from now — positive is future
 * @param {string} locale BCP-47 tag
 * @returns {string}
 */
export function formatRelative(ms, locale = "en") {
  if (!Number.isFinite(ms)) return "";
  const abs = Math.abs(ms);
  let unit = "day", value = ms / DAY;
  if (abs < 90 * SEC) { unit = "second"; value = ms / SEC; }
  else if (abs < 90 * MIN) { unit = "minute"; value = ms / MIN; }
  else if (abs < 36 * HOUR) { unit = "hour"; value = ms / HOUR; }
  // Never round to zero: "in 0 minutes" is not a thing anyone says, and this
  // runs right up to the moment a window opens.
  const n = Math.sign(value) * Math.max(1, Math.round(Math.abs(value)));
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: "always" }).format(n, unit);
  } catch {
    try {
      return new Intl.RelativeTimeFormat("en", { numeric: "always" }).format(n, unit);
    } catch {
      return `${n} ${unit}${Math.abs(n) === 1 ? "" : "s"}`;
    }
  }
}

/**
 * One instant, in the reader's timezone, with the zone named.
 * @param {number} ms epoch ms
 * @param {string} locale
 * @param {{withDate?: boolean}} [o]
 */
export function formatInstant(ms, locale = "en", { withDate = true } = {}) {
  if (!Number.isFinite(ms)) return "";
  const opts = {
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
    ...(withDate ? { weekday: "short", month: "short", day: "numeric" } : {}),
  };
  try {
    return new Intl.DateTimeFormat(locale, opts).format(new Date(ms));
  } catch {
    try { return new Intl.DateTimeFormat("en", opts).format(new Date(ms)); }
    catch { return new Date(ms).toISOString(); }
  }
}

/**
 * A window as one phrase. Same-day windows drop the repeated date, which is
 * almost every window we will ever schedule: "Sat, Aug 30, 2:00 AM – 4:00 AM
 * EDT" rather than naming Saturday twice.
 *
 * `formatRange` is not used for the same-day case on purpose — it would hide
 * the timezone (Intl drops `timeZoneName` from the second half, and on some
 * runtimes from both), and the timezone is the part that stops this being
 * ambiguous.
 *
 * @param {number} start @param {number} end @param {string} locale
 */
export function formatWindow(start, end, locale = "en") {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "";
  try {
    const sameDay = new Intl.DateTimeFormat(locale, { year: "numeric", month: "numeric", day: "numeric" });
    if (sameDay.format(new Date(start)) === sameDay.format(new Date(end))) {
      const head = formatInstant(start, locale);
      const tail = formatInstant(end, locale, { withDate: false });
      // U+2013 EN DASH, spaced, matching the rest of the app's ranges.
      return `${head} – ${tail}`;
    }
  } catch { /* fall through to the two-sided form */ }
  return `${formatInstant(start, locale)} – ${formatInstant(end, locale)}`;
}

// There is deliberately no `formatDuration` here. It was written and deleted:
// building "2 hours" by slicing the number-and-unit out of `RelativeTimeFormat`
// parts works in English and produces "2時間後" ("2 hours LATER") in Japanese,
// because the framing is not a prefix in every language. A bare duration is not
// something Intl gives us portably, and every screen that wanted one reads just
// as well with "expected back in 2 hours" — which `formatRelative` already
// says correctly in all eight.
