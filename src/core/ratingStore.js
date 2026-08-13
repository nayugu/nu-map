// ═══════════════════════════════════════════════════════════════════
// RATING STORE — the ratings YOU have given, held on this device.
// (pure — no React, no I/O; the caller owns localStorage)
//
// ── Why this is NOT plan data ──────────────────────────────────────
// Grades live in the plan slot, and correctly so: a grade changes the
// GPA, gates prerequisites, and decides whether a requirement is met,
// so it belongs to the scenario you are looking at. A rating changes
// none of those. It is a fact about a course you sat in, not about a
// plan — which has three consequences that decide the storage:
//
//   · You took the course once. Keeping ratings in the plan slot would
//     make you re-enter them in every plan you keep, and a "have you
//     rated this?" prompt would reappear per plan.
//   · A rating must never ride in an exported plan file or a share
//     link. Living outside the plan makes that structural rather than
//     a flag someone has to remember at each of the four doors.
//   · Deleting or switching a plan must not destroy what you reported.
//
// ── Keying ─────────────────────────────────────────────────────────
// `courseId@semId`, where semester ids are absolute (`fall2025`), not
// positional. A retake is therefore a SEPARATE rating: a different term
// usually means a different instructor and a genuinely different
// experience, and averaging the two would hide exactly that.
//
// ── What is stored ─────────────────────────────────────────────────
// Only the answers. No timestamps — the submission path deliberately
// carries no finer time signal than the term (see ICourseRatings), and
// a local clock would be the obvious place to leak one back in.
// ═══════════════════════════════════════════════════════════════════
import { isValidDifficulty, isValidHours } from "./courseRatings.js";

/** Storage key suffix; the caller prefixes it with the institution's slot. */
export const RATINGS_KEY = "course-ratings";

/** `courseId@semId` — the identity of one rating. */
export function ratingKey(courseId, semId) {
  if (!courseId || !semId) return null;
  return `${courseId}@${semId}`;
}

/** Split a key back into its parts. Course ids contain spaces but no `@`. */
export function parseRatingKey(key) {
  if (typeof key !== "string") return null;
  const at = key.lastIndexOf("@");
  if (at <= 0 || at === key.length - 1) return null;
  return { courseId: key.slice(0, at), semId: key.slice(at + 1) };
}

/** One stored entry, with anything unrecognised dropped. */
function cleanEntry(v) {
  if (!v || typeof v !== "object") return null;
  const difficulty = isValidDifficulty(v.difficulty) ? v.difficulty : null;
  const hours      = isValidHours(v.hours)           ? v.hours      : null;
  const instructor = typeof v.instructor === "string" && v.instructor
    ? v.instructor : null;
  // An entry with no answers is not an entry. Keeping empty shells would
  // make "already rated" true for a course nobody actually rated.
  if (difficulty === null && hours === null) return null;
  return { difficulty, hours, instructor };
}

/**
 * Parse whatever was in storage into a trusted map.
 *
 * Deliberately total: a corrupt or hand-edited value must degrade to
 * "no ratings", never throw on boot and never take the app down with it.
 */
export function readRatings(raw) {
  let parsed = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { return {}; }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (!parseRatingKey(k)) continue;
    const e = cleanEntry(v);
    if (e) out[k] = e;
  }
  return out;
}

/**
 * Set one field of one rating, returning a NEW map.
 *
 * Passing null clears the field, and clearing the last answered field
 * removes the entry entirely — so un-answering is a real operation and
 * cannot leave a husk behind that still reads as "rated".
 */
export function setRatingField(ratings, courseId, semId, field, value) {
  const key = ratingKey(courseId, semId);
  if (!key) return ratings;
  if (field !== "difficulty" && field !== "hours" && field !== "instructor") {
    return ratings;
  }
  const next = { ...(ratings ?? {}) };
  const merged = { ...(next[key] ?? {}), [field]: value };
  const clean = cleanEntry(merged);
  if (clean) next[key] = clean; else delete next[key];
  return next;
}

/** The stored rating for one course-and-term, or null. */
export function getRating(ratings, courseId, semId) {
  const key = ratingKey(courseId, semId);
  return (key && ratings?.[key]) || null;
}

/**
 * How complete one rating is — what drives the prompt's prominence.
 *
 * Three states rather than a boolean, because "partly answered" should
 * not keep shouting at someone who deliberately answered one field and
 * skipped the other, and should not read as finished either.
 *
 * @returns {"empty"|"partial"|"complete"}
 */
export function fillState(rating) {
  const d = isValidDifficulty(rating?.difficulty);
  const h = isValidHours(rating?.hours);
  if (d && h) return "complete";
  if (d || h) return "partial";
  return "empty";
}

/**
 * Every rating the device holds, as submission drafts.
 *
 * Shaped for the submit path, not for storage: the caller still has to
 * split these into independent submissions (see independentSubmissions)
 * — this returns them together only because the caller needs to know
 * what exists before deciding what to send.
 */
export function toDrafts(ratings) {
  const out = [];
  for (const [k, v] of Object.entries(ratings ?? {})) {
    const parts = parseRatingKey(k);
    if (!parts) continue;
    out.push({
      courseId: parts.courseId,
      semId: parts.semId,
      difficulty: v.difficulty ?? null,
      hours: v.hours ?? null,
      instructor: v.instructor ?? null,
    });
  }
  return out;
}
