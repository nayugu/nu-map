// ═══════════════════════════════════════════════════════════════════
// EQUIVALENCE INDEX  (pure — no React, no I/O)
//
// Turns the committed `course-equivalences.json` wire format into
// per-course lookups for the substitutions UI.
//
// Two things this layer is responsible for, both of which exist because
// the raw data would otherwise be misleading:
//
//   1. RESOLVING THE TIER AGAINST THE STUDENT'S OWN PROGRAMS.
//      A stored tier is deliberately program-agnostic. 72% of
//      program-backed pairs are published by exactly one program, so
//      "your program accepts either" is only true for that program's
//      students — everyone else gets the weaker, honest tier.
//
//   2. GROUPING A BUNDLE INTO ONE DECISION.
//      Substituting a lecture implies its lab and recitation
//      (PHYS 1161→1151 also means 1162→1152 and 1163→1153). The data
//      links these with `e.f`; the UI shows one row and a +N chip,
//      because it is one decision to the student.
//
// Wire format is documented in docs/substitutions-design.md §6.
// ═══════════════════════════════════════════════════════════════════

import { tierRank, tierNeedsApproval, tierIsOfferable, resolveTier }
  from "./equivalenceTiers.js";
export { tierNeedsApproval, tierIsOfferable } from "./equivalenceTiers.js";

/**
 * Build lookup structures from the raw wire object.
 *
 * Returns `null` for missing/!malformed input so every caller can treat the
 * feature as simply absent — the app must work identically when the index
 * has not loaded (or failed to load) yet.
 */
export function buildEquivalenceIndex(wire) {
  if (!wire || !Array.isArray(wire.pairs)) return null;

  const programs = Array.isArray(wire.programs) ? wire.programs : [];
  const programSlugToIx = new Map(programs.map((s, i) => [s, i]));

  // course id -> raw pair records mentioning it
  const byCourse = new Map();
  // "a|b" -> record, for resolving a derived row's parent
  const byKey = new Map();

  for (const p of wire.pairs) {
    if (!p?.a || !p?.b) continue;
    const key = p.a <= p.b ? `${p.a}|${p.b}` : `${p.b}|${p.a}`;
    byKey.set(key, p);
    for (const id of [p.a, p.b]) {
      if (!byCourse.has(id)) byCourse.set(id, []);
      byCourse.get(id).push(p);
    }
  }

  return {
    generatedAt: wire.generatedAt ?? null,
    programs, programSlugToIx, byCourse, byKey,
    size: wire.pairs.length,
  };
}

/**
 * Translate program slugs the planner knows about into the index's indices.
 * Unknown slugs are skipped — a program with no published choices simply
 * contributes nothing rather than throwing.
 */
export function programIndexSet(index, slugs) {
  const out = new Set();
  if (!index || !slugs) return out;
  for (const s of slugs) {
    const ix = index.programSlugToIx.get(s);
    if (ix !== undefined) out.add(ix);
  }
  return out;
}

/** Re-exported under the name the UI already uses. */
export const resolvePairTier = resolveTier;


/**
 * Alternatives to `courseId`, ranked, grouped into bundles, tier-resolved.
 *
 * Each returned suggestion is ONE decision:
 *
 *   { to, tier, scoped, score, approval, evidence }
 *
 * `to` is the course the student would take instead. Substitutions are strictly
 * one-to-one: a lecture swap does not drag its lab along, and a set rule stated
 * in a footnote is offered as its separate pairs.
 *
 * Asking about a bundle COMPONENT works too. A student who types PHYS 1163
 * (Recitation for PHYS 1161) is answered with PHYS 1153 carrying `viaBundle`,
 * because refusing — the first design — reported "no known alternatives" for a
 * course that plainly has one. Applying it still maps the whole group, so the
 * half-applied bundle that exclusion was guarding against cannot happen.
 */
export function alternativesFor(index, courseId, myProgramIx, opts = {}) {
  if (!index || !courseId) return [];
  const rows = index.byCourse.get(courseId) ?? [];
  const out = [];

  for (const row of rows) {
    const s = buildSuggestion(index, row, courseId, myProgramIx, opts);
    if (s) out.push(s);
  }

  out.sort((x, y) => (tierRank(x.tier) - tierRank(y.tier)) || (y.score - x.score) ||
                     x.to.localeCompare(y.to));
  return out;
}

/**
 * Turn one raw pair into a suggestion seen from `fromCourseId`, or null when it
 * is not offerable to this student.
 */
function buildSuggestion(index, p, fromCourseId, myProgramIx, { includeUnofferable = false } = {}) {
  const { tier, scoped } = resolveTier(p, myProgramIx);
  if (!includeUnofferable && !tierIsOfferable(tier)) return null;

  const other = p.a === fromCourseId ? p.b : p.a;

  // A directed statement ("ACCT 1209 counts as ACCT 1201") only licenses the
  // swap in that direction. `e.d` names the course the statement was written
  // on, so it may stand in FOR the other one, not the reverse.
  if (p.e?.d && p.e.d !== fromCourseId) return null;


  return {
    from: fromCourseId,
    to: other,
    tier, scoped,
    score: typeof p.s === "number" ? p.s : 0,
    approval: tierNeedsApproval(tier),
    evidence: {
      programs: p.e?.p?.length ?? 0,
      prereqOr: p.e?.q ?? 0,
      overlap: p.e?.o ?? null,          // % of downstream courses shared
      crossList: p.e?.x ?? null,
      statement: p.e?.s ?? null,
      scope: p.e?.sc ?? null,
      excludes: p.e?.ex ?? null,
      // Every course the stated rule requires, when it named more than one.
      // Informational: the pair still applies on its own.
      setRequires: Array.isArray(p.e?.set) ? p.e.set : null,
    },
  };
}



/**
 * Every swap the student's own programs publish — the answer to "what am I
 * allowed to do?" without them having to guess a course code first.
 *
 * These are tier A by definition: the program states the choice, so there is no
 * inference and no advisor flag. Sorted so the ones the student can act on now
 * come first (see `readyToApply`), then by score.
 *
 * Every pair stands alone, so nothing is filtered here beyond direction.
 */
export function programAllowedSwaps(index, myProgramIx, { limit = 24 } = {}) {
  if (!index || !myProgramIx?.size) return [];
  const out = [];
  const seen = new Set();
  for (const p of index.byKey.values()) {
    const backing = p.e?.p;
    if (!Array.isArray(backing) || !backing.some(i => myProgramIx.has(i))) continue;

    // Direction: a directed statement only licenses its own way round.
    const from = p.e?.d ?? p.a;
    const to = from === p.a ? p.b : p.a;
    const key = `${from}|${to}`;
    if (seen.has(key)) continue;
    seen.add(key);

    for (const alt of alternativesFor(index, from, myProgramIx)) {
      if (alt.to !== to) continue;
      out.push(alt);
      break;
    }
    if (out.length >= limit * 2) break;
  }
  out.sort((x, y) => (y.score - x.score) || x.from.localeCompare(y.from));
  return out.slice(0, limit);
}

/**
 * Is the course this swap replaces already in the plan?
 *
 * A substitution only takes effect once its source course is placed, so this is
 * exactly the threshold at which applying it changes anything: the course is in
 * the plan, the requirement still reads as unmet, and one click closes it.
 */
export function readyToApply(alt, isPlaced) {
  if (typeof isPlaced !== "function") return false;
  return isPlaced(alt.from);
}

/**
 * A stated set rule is only fully earned when every course it names is placed.
 *
 * Substitutions apply one-to-one, so a student can add "GE 1110 -> GE 1501"
 * alone and have GE 1501 read as satisfied — which the catalog, stating
 * "substitute GE 1110 AND GE 1111 for GE 1501 AND GE 1502", does not grant.
 * Rather than re-couple the pairs, the shortfall is reported so the UI can flag
 * it. Returns the missing courses, or [] when there is nothing to say.
 */
export function unmetSetRequirement(alt, isPlaced) {
  const req = alt?.evidence?.setRequires;
  if (!Array.isArray(req) || typeof isPlaced !== "function") return [];
  return req.filter(id => !isPlaced(id));
}
