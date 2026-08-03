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

/** Tier order, strongest first. Mirrors TIERS in scripts/lib/equivalence.js. */
const TIER_RANK = { A: 0, B: 1, C: 2, D: 3 };

/** Only tier C carries a caveat; A and B are facts the catalog grants. */
export function tierNeedsApproval(tier) {
  return tier === "C";
}

export function tierIsOfferable(tier) {
  return tier === "A" || tier === "B" || tier === "C";
}

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
  // parent "a|b" -> derived records that follow it
  const children = new Map();

  for (const p of wire.pairs) {
    if (!p?.a || !p?.b) continue;
    const key = p.a <= p.b ? `${p.a}|${p.b}` : `${p.b}|${p.a}`;
    byKey.set(key, p);
    for (const id of [p.a, p.b]) {
      if (!byCourse.has(id)) byCourse.set(id, []);
      byCourse.get(id).push(p);
    }
    const parent = p.e?.f;
    if (parent) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(p);
    }
  }

  return {
    generatedAt: wire.generatedAt ?? null,
    programs, programSlugToIx, byCourse, byKey, children,
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

/**
 * The tier this student should see for one raw pair.
 *
 * Membership in a publishing program upgrades to A — an entitlement the
 * catalog already grants, needing no approval. Otherwise the stored tier
 * stands. Mirrors `resolveTier` in scripts/lib/equivalence.js; kept in both
 * places because that one runs at build time with no student context.
 */
export function resolvePairTier(pair, myProgramIx) {
  const backing = pair?.e?.p;
  if (Array.isArray(backing) && myProgramIx?.size) {
    for (const ix of backing) {
      if (myProgramIx.has(ix)) return { tier: "A", scoped: true };
    }
  }
  return { tier: pair?.t ?? "D", scoped: false };
}

/**
 * Alternatives to `courseId`, ranked, grouped into bundles, tier-resolved.
 *
 * Each returned suggestion is ONE decision:
 *
 *   { to, tier, scoped, score, approval, evidence, components: [{from, to, role}] }
 *
 * `to` is the course the student would take instead. `components` holds the
 * extra pairs a bundle drags along (lab, recitation) — empty for a plain swap,
 * and what the UI renders as `+N`.
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
    if (row.e?.f) continue;                       // handled below, as a bundle
    const s = buildSuggestion(index, row, courseId, myProgramIx, opts);
    if (s) out.push(s);
  }

  // If `courseId` is itself a bundle component — a lab or recitation — it is not
  // a decision on its own, but answering "no known alternatives" is wrong and
  // looks broken: PHYS 1163 (Recitation for PHYS 1161) plainly does have one,
  // PHYS 1153. Follow the link up to the lecture pair and answer with that whole
  // swap, re-centred on the course the student asked about — they see
  // "PHYS 1153 +2", and applying it maps the lecture and lab too, so the bundle
  // stays atomic.
  //
  // Each component row is resolved against ITS OWN parent. Looking up every
  // decision the parent has instead produced a cross-product: PHYS 1163 offered
  // "PHYS 1153 as part of PHYS 1161 → PHYS 1171", mixing two different variant
  // families, because 1163 belongs to two component rows and 1161 has two
  // alternatives.
  if (!out.length) {
    for (const comp of rows) {
      const parentKey = comp.e?.f;
      if (!parentKey) continue;
      const parent = index.byKey.get(parentKey);
      if (!parent) continue;

      // A derived row keeps its parent's side ordering: comp.a pairs with
      // parent.a, so the student's side of the lecture pair is the side their
      // own component sits on.
      const mineIsA = comp.a === courseId;
      const head = mineIsA ? parent.a : parent.b;
      const counterpart = mineIsA ? comp.b : comp.a;

      const alt = buildSuggestion(index, parent, head, myProgramIx, opts);
      if (!alt) continue;

      out.push({
        ...alt,
        from: courseId,
        to: counterpart,
        components: [
          { from: head, to: alt.to, role: "lecture" },
          ...alt.components.filter(c => c.from !== courseId),
        ],
        viaBundle: { head, headTo: alt.to },
      });
    }
  }

  out.sort((x, y) => (TIER_RANK[x.tier] - TIER_RANK[y.tier]) || (y.score - x.score) ||
                     x.to.localeCompare(y.to));
  return out;
}

/**
 * Turn one raw pair into a suggestion seen from `fromCourseId`, or null when it
 * is not offerable to this student.
 */
function buildSuggestion(index, p, fromCourseId, myProgramIx, { includeUnofferable = false } = {}) {
  const { tier, scoped } = resolvePairTier(p, myProgramIx);
  if (!includeUnofferable && !tierIsOfferable(tier)) return null;

  const other = p.a === fromCourseId ? p.b : p.a;

  // A directed statement ("ACCT 1209 counts as ACCT 1201") only licenses the
  // swap in that direction. `e.d` names the course the statement was written
  // on, so it may stand in FOR the other one, not the reverse.
  if (p.e?.d && p.e.d !== fromCourseId) return null;

  // Component orientation follows the parent's. The builder emits a derived row
  // with `a` a companion of the parent's `a` and `b` a companion of its `b`, so
  // the side being substituted FROM carries straight down: a student swapping
  // PHYS 1165 → 1155 gets 1166 → 1156, not the reverse.
  const key = p.a <= p.b ? `${p.a}|${p.b}` : `${p.b}|${p.a}`;
  const fromIsA = p.a === fromCourseId;
  const components = (index.children.get(key) ?? []).map(c => ({
    from: fromIsA ? c.a : c.b,
    to:   fromIsA ? c.b : c.a,
    role: c.e?.r ?? null,
  }));

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
    },
    components,
  };
}

/** True when the course has anything worth showing. Cheap enough per render. */
export function hasAlternatives(index, courseId, myProgramIx) {
  return alternativesFor(index, courseId, myProgramIx).length > 0;
}

/**
 * Every swap the student's own programs publish — the answer to "what am I
 * allowed to do?" without them having to guess a course code first.
 *
 * These are tier A by definition: the program states the choice, so there is no
 * inference and no advisor flag. Sorted so the ones the student can act on now
 * come first (see `readyToApply`), then by score.
 *
 * Bundle components are skipped as entry points, exactly as in
 * `alternativesFor`: a lecture swap already carries its lab and recitation, and
 * listing those separately would offer the same decision several times.
 */
export function programAllowedSwaps(index, myProgramIx, { limit = 24 } = {}) {
  if (!index || !myProgramIx?.size) return [];
  const out = [];
  const seen = new Set();
  for (const p of index.byKey.values()) {
    if (p.e?.f) continue;                         // a component, not a decision
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
 * Is every course this swap replaces already in the plan?
 *
 * This is the case worth surfacing: with GE 1110 and GE 1111 both placed but the
 * substitution not applied, GE 1501 and GE 1502 still read as unmet and the plan
 * shows a gap that is not real. A group only takes effect once every `from` is
 * placed (see applySubstitutions), so this is exactly the threshold at which
 * applying it changes anything.
 */
export function readyToApply(alt, isPlaced) {
  if (typeof isPlaced !== "function") return false;
  const froms = [alt.from, ...(alt.components ?? []).map(c => c.from)];
  return froms.every(id => isPlaced(id));
}
