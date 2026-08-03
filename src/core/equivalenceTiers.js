// ═══════════════════════════════════════════════════════════════════
// EQUIVALENCE TIERS — the single source of truth for what a tier means.
//
// This lived in two places: `TIERS` in scripts/lib/equivalence.js, which
// decides the tier at build time, and hardcoded copies of the same facts
// in src/core/equivalenceIndex.js, which acts on it at runtime. Flipping
// tier C's approval flag in one would have left the other silently
// disagreeing — the builder marking a swap as needing sign-off while the
// UI offered it as an entitlement.
//
// It lives under src/ rather than scripts/ for two reasons: `src/` must
// never import `scripts/`, and the invariant CI job runs with no
// `npm install`, so anything test/invariant/ reaches may only use `src/`
// plus Node builtins. The builder imports this; nothing imports upward.
//
// Pure data and pure predicates — no React, no I/O, zero dependencies.
// ═══════════════════════════════════════════════════════════════════

/**
 * `offer` — may this tier be applied as a substitution at all?
 * `approval` — must an applied substitution be marked as needing an advisor?
 * `rank` — display order, strongest first.
 *
 * Tier C is offerable but always `approval: true`. Northeastern's course
 * substitution policy is unambiguous that every substitution is a *request*
 * ("Students may request to substitute one course for another… **If
 * approved**, the substituted course will replace the originally designated
 * course"), reviewed by the advisor, the program director and the department
 * that owns the original course.
 *
 * Tiers A and B need no such flag because they are not substitutions in that
 * sense — A is a choice the catalog or the student's own program publishes,
 * and B is the same course wearing a different subject code.
 */
export const TIERS = {
  A: { key: "A", label: "allowed",         offer: true,  approval: false, rank: 0 },
  B: { key: "B", label: "same-course",     offer: true,  approval: false, rank: 1 },
  C: { key: "C", label: "interchangeable", offer: true,  approval: true,  rank: 2 },
  D: { key: "D", label: "related",         offer: false, approval: false, rank: 3 },
};

/** Sort key: strongest tier first. Unknown tiers sort last, never crash. */
export function tierRank(tier) {
  return TIERS[tier]?.rank ?? Number.MAX_SAFE_INTEGER;
}

export function tierNeedsApproval(tier) {
  return TIERS[tier]?.approval === true;
}

export function tierIsOfferable(tier) {
  return TIERS[tier]?.offer === true;
}

/**
 * The tier a specific student should see for one emitted pair.
 *
 * A pair published as a choice by the student's *own* program is tier A for
 * them — an entitlement, no approval needed — whatever the stored tier says.
 * The stored tier is deliberately program-agnostic because 72% of
 * program-backed pairs come from exactly one program, so a global tier A would
 * tell every student "your program accepts either" on one program's authority.
 *
 * @param pair  an emitted record: { t, e: { p: number[] } }
 * @param mine  Set of program-slug **indices** the student is enrolled in
 */
export function resolveTier(pair, mine) {
  const backing = pair?.e?.p;
  if (Array.isArray(backing) && mine?.size) {
    for (const i of backing) if (mine.has(i)) return { tier: "A", scoped: true };
  }
  return { tier: pair?.t ?? "D", scoped: false };
}
