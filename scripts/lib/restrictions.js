// ═══════════════════════════════════════════════════════════════════
// BANNER RESTRICTIONS — the whole Restrictions pane, not just Classes
//
// `getRestrictions` is the Restrictions tab of Banner's Class Details modal —
// the page a student actually opens to find out whether they may register. We
// have fetched it once per CRN since Aug 2026 and kept ONE of its headings.
// `classesOf` in class-standing.js takes the `Classes` block and discards
// Levels, Majors, Colleges, Programs, Campuses, Concentrations, Attributes,
// Departments, Fields of Study and Special Approvals.
//
// This module keeps all of them. The HTTP cost was always paid; the loss was a
// nine-line filter.
//
// ── WHAT IS ACTUALLY THERE ─────────────────────────────────────────
//
// Measured by restrictions-probe.js over 1,778 sections of 202510/202530:
// 11 kinds, 17 kind×polarity combinations, on 99.0% of sections.
//
//   must  Levels            98.6%     4 codes      must  Concentrations   1.8%    14 codes
//   must  Classes           23.3%     5 codes      not   Classes          1.6%     1 code
//   must  Colleges          20.3%     6 codes      not   Majors           1.2%    10 codes
//   must  Programs          17.9%    73 codes      not   Programs         0.8%     8 codes
//   must  Majors             9.6%   115 codes      not   Fields of Study  0.8%     7 codes
//   must  Campuses           8.8%     9 codes      not   Colleges         0.6%     3 codes
//   info  Special Approvals  6.2%     3 codes      not   Campuses         0.4%     1 code
//   must  Attributes         3.4%    11 codes      not   Attributes       0.4%     2 codes
//                                                  not   Departments      0.2%     3 codes
//
// MEIE 4701 §01 in 202710 is the case advising raised, and it reads exactly as
// they described: Levels UG, Classes JR/SR, Majors IEBA/IECS/INDE — the Fall
// section of the shared ME/IE capstone is Industrial-only.
//
// ── THREE RULES THIS MODULE HOLDS TO ───────────────────────────────
//
// 1. A code is meaningless without its HEADING. NEU's major code for Journalism
//    is `(JR)`, identical to the Junior class code — `class-standing.test.js`
//    already guards `classesOf` against the collision, and a tally keyed on the
//    bare code would merge a major into the standing vocabulary.
// 2. `Special Approvals` is not a gate on WHO may enrol. Its three values are
//    `Advisor's Signature`, `Department's Signature`, `Instructor's Signature`
//    — a statement that a human must sign, carrying no code at all. It is kept
//    as polarity `info` so nothing folds it in with must/not.
// 3. Codes are stored, labels are stored ONCE. A 115-code Majors vocabulary
//    repeated per course-term is how an 8.7 MB file becomes unreadable; the
//    label map is written at the root of the term-details file instead.
// ═══════════════════════════════════════════════════════════════════

export { parseRestrictions, coalesceValues, decodeEntities } from "./class-standing.js";

/**
 * Split a Banner restriction heading into its kind and polarity.
 *
 * Banner writes "Must be enrolled in one of the following Majors:" and "Cannot
 * be enrolled in one of the following Classes:". The kind is the trailing noun
 * — which may be several words, and in one real case contains its own commas
 * and parentheses ("Fields of Study (Major, Minor or Concentration)").
 *
 * A heading with no enrolment verb at all is `info`: measured, that is
 * "Special Approvals:" on 6.2% of sections. Returning null for it would have
 * reported that the kind does not exist.
 *
 * @param {string} head
 * @returns {{kind: string, polarity: "must"|"not"|"info"}|null}
 */
export function splitHeading(head) {
  const s = String(head ?? "").trim();
  const m = /^(Must|Cannot|May not)\b.*?following\s+(.+?):$/i.exec(s);
  if (m) return { kind: m[2].trim(), polarity: /^Must/i.test(m[1]) ? "must" : "not" };
  const bare = /^([A-Z][A-Za-z /&'-]*):$/.exec(s);
  if (bare) return { kind: bare[1].trim(), polarity: "info" };
  return null;
}

/** The parenthesised code at the end of a value, or null. */
export function codeOf(value) {
  const m = /\(\s*([A-Za-z0-9._-]{1,12})\s*\)\s*$/.exec(String(value ?? "").trim());
  return m ? m[1].toUpperCase() : null;
}

/** A value's label, with the trailing code stripped. */
export function labelOf(value) {
  return String(value ?? "").replace(/\s*\([A-Za-z0-9._-]{1,12}\)\s*$/, "").trim();
}

/**
 * The storage key for a kind. `must:Majors`, `not:Classes`, `info:Special Approvals`.
 * Stable across Banner rewording of the sentence around the noun.
 */
export const paneKey = (kind, polarity) => `${polarity}:${kind}`;

/**
 * Fold one parsed page into `{ key: [codes] }` plus the labels it used.
 *
 * A value with no code keeps its LABEL as the key, wrapped in guillemets so it
 * can never collide with a real code — `Special Approvals` values have no code
 * at all, and dropping them would lose the kind entirely.
 *
 * @param {Record<string,string[]>} parsed  from parseRestrictions
 * @returns {{blocks: Record<string,string[]>, labels: Record<string,string>}}
 */
export function restrictionsOf(parsed) {
  const blocks = {};
  const labels = {};
  for (const [head, values] of Object.entries(parsed ?? {})) {
    const split = splitHeading(head);
    if (!split) continue;
    const key = paneKey(split.kind, split.polarity);
    const codes = new Set(blocks[key] ?? []);
    for (const v of values ?? []) {
      const code = codeOf(v);
      const label = labelOf(v);
      const id = code ?? `«${label}»`;
      codes.add(id);
      // Labels are per (kind, code): the same two letters mean different things
      // under different headings, which is exactly the (JR) collision.
      if (label) labels[`${key}|${id}`] = label;
    }
    if (codes.size) blocks[key] = [...codes].sort();
  }
  return { blocks, labels };
}

/**
 * One section's page → the tally shape stored per course-term.
 *
 * `{ "must:Majors": { "IEBA|IECS|INDE": 1 } }` — the same convention `std`
 * already uses: a sorted `|`-joined code set, counted by how many sections
 * carried exactly that set. Storing the raw per-section tally rather than a
 * fold is the rule class-standing.js established and the reason it did not cost
 * a 29-minute re-scrape to revisit: the fold is a presentation decision.
 *
 * @param {Record<string,string[]>} blocks  from restrictionsOf
 * @param {Record<string,Record<string,number>>} into  accumulator, mutated
 */
export function tallySection(blocks, into) {
  for (const [key, codes] of Object.entries(blocks ?? {})) {
    const setKey = codes.join("|");
    (into[key] ??= {});
    into[key][setKey] = (into[key][setKey] ?? 0) + 1;
  }
  return into;
}

/**
 * Codes a course's sections admit for one kind, with per-code section coverage.
 *
 * ── WHY UNION, and why coverage is kept ────────────────────────────
 *
 * For a POSITIVE restriction the union across sections is the lenient reading
 * and the only correct one for "could this student register at all": if four of
 * seven sections admit INEN, an INEN student can take the course. That is rule
 * 3 of class-standing.js generalised from a ladder to an unordered set.
 *
 * A NEGATIVE restriction inverts it: "cannot be a freshman" only binds when
 * EVERY section says so, so negatives intersect. Storing the tally rather than
 * a verdict is what lets both live in one place.
 *
 * Coverage is returned, never thresholded, because `3 of 21 sections` (an open
 * section exists) and `21 of 21` (there is no way in) are opposite advice and
 * one number cannot carry both.
 *
 * `totalSections` is the course's section count for the term, and it is
 * REQUIRED to resolve a negative. The tally alone only counts sections that
 * carry the restriction, so `{FR: 2}` is identical whether the course had two
 * sections or five — and those mean opposite things: on 2 of 2 a freshman is
 * barred, on 2 of 5 three sections are open to them. Without it a negative
 * returns nothing, which is the conservative direction: a negative that might
 * not bind must not bind.
 *
 * @param {Record<string,number>} tally  e.g. { "IEBA|IECS|INDE": 4, "INDE": 3 }
 * @param {"must"|"not"|"info"} polarity
 * @param {number} [totalSections]  the course's sections that term
 * @returns {{codes: Array<{code: string, sections: number}>, sections: number,
 *            total: number|null, unresolved: boolean}}
 */
export function foldKind(tally, polarity = "must", totalSections = null) {
  const perCode = new Map();
  let sections = 0;
  for (const [setKey, n] of Object.entries(tally ?? {})) {
    if (!Number.isFinite(n) || n <= 0) continue;
    sections += n;
    for (const code of setKey.split("|")) {
      if (!code) continue;
      perCode.set(code, (perCode.get(code) ?? 0) + n);
    }
  }
  const total = Number.isFinite(totalSections) && totalSections > 0 ? totalSections : null;
  let codes = [...perCode.entries()].map(([code, n]) => ({ code, sections: n }));
  let unresolved = false;
  if (polarity === "not") {
    if (total === null) { codes = []; unresolved = true; }
    else codes = codes.filter(c => c.sections >= total);
  }
  codes.sort((a, b) => b.sections - a.sections || a.code.localeCompare(b.code));
  return { codes, sections, total, unresolved };
}
