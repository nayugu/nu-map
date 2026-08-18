/**
 * early-donors.js — how to start a plan for a program that publishes none.
 *
 * 365 of the 1,031 shapes CHART is asked to plan have no Sample Plan of Study
 * at all (7 undergraduate degrees, 358 graduate programs), so `seed.js` has
 * nothing to inherit and their first terms are whatever the search decides —
 * which is the placement measured 32.6% too late. This module builds a stand-in
 * from the programs that DO publish one.
 *
 * ## The donor is asked WHEN, never WHAT
 *
 * Only courses the target program already requires are ever placed. The donor
 * supplies timing for them and nothing else: it cannot introduce a course, and a
 * course it never mentions is simply left to the search. That single restriction
 * is what makes borrowing safe — the worst case is a requirement scheduled in a
 * term some other department favours, not a degree with a course in it that
 * nobody asked for.
 *
 * ## Similar per CLUSTER, not per program
 *
 * A program is a bag of subject clusters, and its nearest whole-program neighbour
 * is usually a compromise between them. Asking per cluster instead lets the
 * Biology half of a degree learn from a Biology-heavy program while its Computer
 * Science half learns from a CS-heavy one. Measured over the 345 undergraduate
 * programs that publish a plan, holding each one out and predicting its own first
 * term:
 *
 *   per-cluster donors        76.8%
 *   one whole-program donor   64.7%
 *   the corpus's commonest first-term courses, no donor at all   30.4%
 *
 * The control matters more than the winner: a donor has to beat "put the usual
 * first-semester courses first", and it does, by a factor of two and a half.
 *
 * ## Similarity is set distance, not overlap
 *
 * Jaccard — the shared courses over the union — so a donor is penalised for
 * requirements the target does NOT have as well as for ones it misses. Overlap
 * alone would rank a sprawling program above a tight one that matches exactly:
 * against a 6-course Biology cluster, a 10-course Biology major covering all 6
 * scores 0.60 while a 5-course Biochemistry cluster matching 5 scores 0.83. The
 * second is the better teacher, because structure is what is being compared.
 */

/** A subject needs this many required courses in it to be worth matching on. */
export const MIN_CLUSTER = 3;

/**
 * How similar a cluster must be before its donor is believed.
 *
 * Below this the plan degrades to no seeding, which is exactly today's behaviour
 * and therefore always a safe answer. Chosen from the measured distribution
 * rather than by taste: see `derive-early-donors.js`, which prints it.
 */
export const MIN_SIMILARITY = 0.4;

/** How many academic terms a donor is consulted for — the same window `seed.js` pins. */
export const EARLY_TERMS = 4;

/** `MATH` out of `MATH2321`. */
const subjectOf = (key) => /^([A-Z]+)/.exec(key)?.[1] ?? "";

/**
 * Every course a program's requirements name, grouped by subject.
 *
 * Walks whatever nesting the parsed requirements use rather than assuming a
 * depth, because a section holds requirements, a requirement holds courses, and
 * an AND/OR node holds either.
 */
export function requiredBySubject(program) {
  const all = new Set();
  const walk = (nodes) => {
    for (const n of nodes ?? []) {
      if (n?.type === "COURSE" && n.subject) all.add(`${n.subject}${n.classId}`);
      for (const k of ["requirements", "courses", "sections", "options"]) {
        if (Array.isArray(n?.[k])) walk(n[k]);
      }
    }
  };
  walk(program?.requirementSections);

  const out = new Map();
  for (const key of all) {
    const s = subjectOf(key);
    if (!s) continue;
    if (!out.has(s)) out.set(s, new Set());
    out.get(s).add(key);
  }
  return out;
}

/** Shared over union. 0 when either side is empty. */
export function similarity(a, b) {
  if (!a?.size || !b?.size) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** The clusters worth matching on — subjects carrying real weight in the degree. */
export const clustersOf = (bySubject, minCluster = MIN_CLUSTER) =>
  [...bySubject.entries()].filter(([, set]) => set.size >= minCluster).map(([s]) => s);

/**
 * The best donor for each of a program's clusters.
 *
 * @param {{name: string, bySubject: Map<string, Set<string>>}} target
 * @param {Array<{name: string, base: string, bySubject: Map, early: Array<Set<string>>}>} candidates
 *   programs that publish a plan, with its first `EARLY_TERMS` academic terms
 * @param {{excludeSameBase?: boolean, minSimilarity?: number}} [opts]
 *   `excludeSameBase` drops a program's own other-campus twin. Off in production —
 *   Design BFA (Oakland) is the ideal teacher for Design BFA (Boston) — and on
 *   when validating, where a twin would score a free 1.0 and flatter the method.
 * @returns {Array<{subject: string, donor: object, similarity: number}>}
 */
export function pickDonors(target, candidates, opts = {}) {
  const { excludeSameBase = false, minSimilarity = MIN_SIMILARITY,
          minCluster = MIN_CLUSTER } = opts;
  const out = [];
  for (const subject of clustersOf(target.bySubject, minCluster)) {
    const ours = target.bySubject.get(subject);
    let best = null, bestScore = 0;
    for (const c of candidates) {
      if (c.name === target.name) continue;
      if (excludeSameBase && c.base === target.base) continue;
      const theirs = c.bySubject.get(subject);
      // One course in common is a coincidence, not a structure to learn from.
      if (!theirs || theirs.size < 2) continue;
      const score = similarity(ours, theirs);
      // `>` not `>=`, and candidates arrive sorted by name, so ties resolve to
      // the same donor on every run.
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (best && bestScore >= minSimilarity) {
      out.push({ subject, donor: best, similarity: bestScore });
    }
  }
  return out;
}

/**
 * A stand-in plan: the target's own required courses, timed by its donors.
 *
 * Emitted in `plan.json`'s variant shape so `seed.js` consumes it with no new
 * code — it is read exactly as a published plan is, and therefore repaired
 * exactly as one is, which is the point. The terms are written as plain
 * fall/spring because a donor's ordinal is all that was borrowed: "the third
 * semester" is the claim, and normalising it onto a summer the target may not
 * even have would be inventing a second one.
 *
 * Returns null when nothing could be borrowed, which must read as "no plan
 * here", not as an empty one.
 */
export function borrowEarlyPlan(target, donors) {
  const terms = Array.from({ length: EARLY_TERMS }, () => new Set());
  for (const { subject, donor } of donors) {
    const ours = target.bySubject.get(subject) ?? new Set();
    donor.early.forEach((named, i) => {
      if (i >= EARLY_TERMS) return;
      for (const key of named) {
        // WHEN, not WHAT: the target has to require it already.
        if (subjectOf(key) === subject && ours.has(key)) terms[i].add(key);
      }
    });
  }
  if (!terms.some(t => t.size)) return null;

  // A course borrowed twice keeps its EARLIEST term. Two clusters can name the
  // same cross-listed course, and the later slot would otherwise win by position.
  const seen = new Set();
  const years = [];
  terms.forEach((named, i) => {
    const entries = [...named].sort().filter(k => !seen.has(k));
    for (const k of entries) seen.add(k);
    const yearIndex = Math.floor(i / 2);
    years[yearIndex] ??= { label: `Year ${yearIndex + 1}`, terms: [] };
    years[yearIndex].terms.push({
      term: i % 2 === 0 ? "Fall" : "Spring",
      type: i % 2 === 0 ? "fall" : "spring",
      // `entries` may be empty — a cluster may have had nothing to say about the
      // third semester. Harmless either way: `seed.js` skips a term naming no
      // course, and it keys the terms it does read by year and season rather than
      // by counting, so an empty one shifts nothing.
      entries: entries.map(k => ({ text: k, options: [[k]] })),
    });
  });
  return { label: "derived from similar programs", pattern: "", years };
}
