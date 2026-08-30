// ═══════════════════════════════════════════════════════════════════
// MINOR OVERLAP  (pure — no React, no I/O)
//
// Northeastern caps how much of a minor may be paid for twice:
//
//   "Students are permitted to double count a maximum of 50% of the credits
//    required for a minor from their major, transfer credit, or advanced
//    standing credit. Individual programs may have stricter requirements."
//      — Undergraduate catalog, Degrees, Majors, and Minors § Minors
//
// The companion sentence, on the same page and on the CPS minors page, is the
// one that makes this a cap rather than a ban: "courses used to fulfil
// requirements for the minor may also be used to complete undergraduate degree
// requirements". Overlap is expected — a minor is meant to fit inside the free
// electives — so the only thing measured here is overlap with a MAJOR's
// requirement sections. A minor course that lands in the degree's general
// electives is the normal case and is not shared credit.
//
// ── What this does NOT do ─────────────────────────────────────────
//
// It never un-allocates anything. The audit's allocation is unchanged with and
// without this module: a course the minor counts still counts, and the report
// is a separate statement about the plan. Choosing courses to drop in order to
// respect a percentage would be inventing an advising decision, and it would
// make the requirement rows disagree with the courses on the board.
//
// Transfer and advanced-standing credit share the same 50% budget in the
// policy and are NOT measured here, because this app models neither: a
// placed-out course carries no credit ("no credit, but satisfy prerequisites")
// and there is no transfer-credit input at all. So the figure reported is a
// LOWER bound on the policy's own numerator, which is the permissive
// direction — see the note on the denominator for the other one.
//
// ── The denominator, and why it is derived ────────────────────────
//
// "the credits required for a minor" is not published in a field we hold:
// measured 2026-08-30, **0 of 173 shipped minors** carry a non-zero
// `totalCreditsRequired`, and `verify-majors` flags every one of them as
// `missing-total-credits`. The pages really are quiet about it — the Arabic
// minor states "A total of five courses is required" in prose and nothing else
// — with exactly one exception (Computer Science, whose "20 semester hours
// required" is currently swallowed into the Credit/GPA row's text). So the
// requirement is read off the same allocator the rest of the audit uses:
// Σ `demandOf` over the minor's sections, which gets Arabic right at 16 + 4.
//
// ⚠ That sum is inflated for the minors whose page prints an elective's MENU
// as sibling sections — Computer Science derives 52 SH against a stated 20,
// because seven of its ten sections are the colleges making up the "Khoury
// meaningful minors list"; Biochemical Engineering derives 56 SH because its
// supporting math and science are listed in full. This is the same defect
// CLAUDE.md records for Data Science MSAlign, it is not introduced here, and
// its effect on this rule is to make the cap too GENEROUS (26 SH where the
// truth is 10). A missed warning leaves a student where they already were; a
// false one tells them to take courses they do not owe. `totalCreditsRequired`
// is preferred whenever a future scrape supplies it.
// ═══════════════════════════════════════════════════════════════════

import { allocateSections } from "./gradRequirements.js";
import { demandOf, satisfiedOf, typicalSH } from "./requirementDemand.js";
import { specForNode } from "./programEligibility.js";

/** The policy's fraction. A parameter of Northeastern's rule, not of degrees. */
export const MINOR_SHARE_FRACTION = 0.5;

/** Credit sums are integers in practice; this guards a `.5` cap against FP dust. */
const EPS = 1e-9;

/**
 * The sections of a minor that state requirements.
 *
 * "Required General Electives" is a placeholder the audit generates for majors
 * and never a minor's own requirement. Three callers filtered it inline with
 * three copies of the same string literal; this is that string, once.
 */
export function minorRequirementSections(minor) {
  return (minor?.requirementSections ?? []).filter(
    section => section && section.title !== "Required General Electives"
  );
}

/**
 * How much of a minor is paid for by courses a major already claims.
 *
 * ── Two readings of "shared", and why the verdict uses the smaller ──
 *
 * `sharedSH` is the plain one: the credit of every course this minor's
 * allocation claims that a major's allocation also claims. It is what the
 * expansion lists, and every course in that list genuinely counts toward both.
 *
 * `dependentSH` is what the minor could not have done without them —
 * satisfied credit with the major's courses withheld, subtracted from
 * satisfied credit with everything available. The two differ only when a
 * shared course was REPLACEABLE: the student placed a spare non-major course
 * eligible for the same pool, and allocation, which is greedy in catalog
 * order, happened to reach for the major's one first. That is an artefact of
 * ordering rather than a fact about the plan, so the violation is decided on
 * `dependentSH` and can never fire on a minor the student could satisfy
 * independently with what they have already placed.
 *
 * The gap was measured rather than assumed, because "greedy allocation might
 * pick badly" is exactly the kind of worry that turns out to be theoretical.
 * Over 500 (major, minor) pairs — 20 majors x 25 minors, each against a
 * student who has placed every course EITHER program names, which is the most
 * choice the allocator can ever have and so the worst case for the artefact —
 * the two disagree on 21 pairs (4.2%), 240 SH against 133 SH in total. Rare,
 * but not small when it happens: Film Production minor against Media and
 * Screen Studies and Theatre BA reads 12 SH shared on the plain definition and
 * 4 SH on this one, so the plain reading would have declared a violation of a
 * 10 SH cap that the student's own placed courses already avoid.
 *
 * @param {object}      args.minor      minor program record (Major2 JSON shape)
 * @param {Set<string>} args.placedSet  canonical keys of everything placed
 * @param {Set<string>} args.majorKeys  keys claimed by a major's requirement
 *                                      sections (concentration included,
 *                                      general electives excluded)
 * @param {Record<string, object>} args.courseMap
 * @returns {null | {requiredSH: number, capSH: number, sharedSH: number,
 *                   dependentSH: number, claimedSH: number, uniqueSH: number,
 *                   overSH: number, over: boolean, sharedKeys: string[]}}
 *          null when the minor states no requirement at all — there is no
 *          denominator, so there is no percentage to report.
 */
export function minorShare({ minor, placedSet, majorKeys, courseMap = {} } = {}) {
  const sections = minorRequirementSections(minor);
  if (!sections.length) return null;

  const placed = placedSet instanceof Set ? placedSet : new Set(placedSet ?? []);
  const major  = majorKeys instanceof Set ? majorKeys : new Set(majorKeys ?? []);

  // One unit per section, computed once: `demandOf` and `satisfiedOf` must be
  // given the SAME unit or their difference stops meaning anything.
  const units = sections.map(s => typicalSH(specForNode(s), courseMap));

  const claimed = new Set();
  const full = allocateSections(sections, placed, claimed, courseMap);
  const requiredSH = sections.reduce((n, _, i) => n + demandOf(full[i], units[i], courseMap), 0);
  const claimedSH  = sections.reduce((n, _, i) => n + satisfiedOf(full[i], units[i], courseMap), 0);

  const sharedKeys = [...claimed].filter(k => major.has(k));
  const sharedSH = sharedKeys.reduce((n, k) => n + (courseMap[k]?.sh ?? 0), 0);

  // The same minor, allocated as if the major's courses had never been placed.
  // Only run when something is actually shared — otherwise the answer is
  // `claimedSH` by construction and the second allocation is pure cost.
  let uniqueSH = claimedSH;
  if (sharedKeys.length) {
    const withheld = new Set([...placed].filter(k => !major.has(k)));
    const alone = allocateSections(sections, withheld, new Set(), courseMap);
    uniqueSH = sections.reduce((n, _, i) => n + satisfiedOf(alone[i], units[i], courseMap), 0);
  }
  const dependentSH = Math.max(0, claimedSH - uniqueSH);

  const capSH = requiredSH * MINOR_SHARE_FRACTION;
  const over  = dependentSH - capSH > EPS;

  return {
    requiredSH, capSH, sharedSH, dependentSH, claimedSH, uniqueSH,
    overSH: over ? dependentSH - capSH : 0,
    over,
    // Stable order so the expansion does not reshuffle between renders.
    sharedKeys: sharedKeys.sort(),
  };
}
