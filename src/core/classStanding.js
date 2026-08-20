// ═══════════════════════════════════════════════════════════════════
// CLASS STANDING — the registrar's gate, as a position in a plan  (pure)
//
// Northeastern states some courses' real prerequisite as class standing rather
// than as a course: "Must be enrolled in one of the following Classes: Junior
// (JR), Senior(SR)". The catalog prints that only in prose, where
// `courseNorm.RESTRICTION_ONLY` discards it, so until this existed the engine
// stood in the course-level DIGIT for it — and that proxy is wrong in both
// directions. ENGW 3302 is level 3, so `levelFloor[3]` allowed it 0.22 through
// the plan (term 2 of 8) while every one of its 24 sections requires junior
// standing; 4000-level courses were held to 0.67 where a JR/SR gate is 0.50.
//
// The gate itself is scraped from Banner (scripts/lib/class-standing.js parses it,
// derive-offering-summary folds it to one code per course) and arrives at runtime
// on `course.offering.std`. This module is the domain half: what the codes mean
// and where each one sits in a plan. It is in core, not engine, because the course
// card and the MCP tools read it too.
// ═══════════════════════════════════════════════════════════════════

/**
 * The standing ladder, most junior first. Position IS the ordering — `indexOf`
 * on this array is what makes "most lenient" computable.
 *
 * GR is deliberately NOT on it. Graduate standing is not a rung above senior; it
 * is a different ladder, reached by admission rather than by accumulating terms.
 * `prereqDepth` measures the p10 of a graduate placement at 0.00 for every level
 * 5xxx–8xxx: a student admitted to a master's takes 5000-level courses in their
 * first term, and mapping GR onto an undergraduate floor is exactly how they get
 * barred from it.
 */
export const STANDING_LADDER = ["FR", "SH", "JR", "SR"];

/** Every code Banner is known to print in a Classes restriction. */
export const KNOWN_STANDINGS = new Set([...STANDING_LADDER, "GR"]);

/**
 * ── THE RULE, as the registrar states it ────────────────────────────
 *
 * Northeastern's undergraduate catalog, Academic Progression Standards:
 *
 *   "For undergraduate day students, freshman, sophomore, junior, and senior
 *    standing are determined by earned semester hours:"
 *      Freshman   less than 32 semester hours
 *      Sophomore  at least 32 but less than 64
 *      Junior     at least 64 but less than 96
 *      Senior     at least 96
 *
 * MINIMUM earned semester hours for each standing. Two words in that quotation
 * decide the whole design:
 *
 *   **earned** — not registered, not in progress. The credits for the term you
 *   are registering INTO have not been earned, so they cannot raise the standing
 *   that lets you register. Hence `earnedSHBefore` sums terms STRICTLY BEFORE the
 *   one being checked, the same `sidx < currentSemIdx` rule `totalSHDone` uses.
 *
 *   **semester hours** — not terms, not years. This is why the old fixed
 *   fractions (sophomore at 1/4 of the plan, junior at 1/2) were wrong rather
 *   than merely rough: a student who overloads reaches junior standing a term
 *   early, and one who spends a year on co-op earning no credit reaches it a year
 *   late. Both are common at Northeastern, and the fractions describe neither.
 */
export const STANDING_SH = Object.freeze({ FR: 0, SH: 32, JR: 64, SR: 96 });

/**
 * Fraction-of-plan positions, kept ONLY as the generator's fallback ordering
 * hint for the case where no credit projection is available.
 *
 * These are what `STANDING_SH` replaced for any real judgement. They assume a
 * 4-year/8-term plan at an even load, which is exactly the assumption co-op
 * breaks. Do not use them to decide whether a placement is legal — use
 * `meetsStanding` against a real credit total.
 */
export const STANDING_FLOOR = Object.freeze({ FR: 0.00, SH: 0.25, JR: 0.50, SR: 0.75 });

/** Minimum earned semester hours a standing requires. 0 for anything unknown. */
export function requiredSHFor(code) {
  return STANDING_SH[code] ?? 0;
}

/**
 * The standing a given number of earned semester hours confers.
 *
 * @param {number} sh  earned semester hours
 * @returns {string} a STANDING_LADDER member ("FR" below 32)
 */
export function standingAtSH(sh) {
  const n = Number.isFinite(sh) ? sh : 0;
  let best = "FR";
  for (const code of STANDING_LADDER) {
    if (n >= STANDING_SH[code]) best = code;
  }
  return best;
}

/**
 * Does `earnedSH` satisfy a required standing?
 *
 * TRUE when the requirement is unknown or unreadable — the conservative
 * direction. This answer becomes a warning on a student's plan, and a false
 * warning about a gate we cannot even name is worse than a missed one.
 *
 * @param {number} earnedSH
 * @param {string} required  a standing code
 * @returns {boolean}
 */
export function meetsStanding(earnedSH, required) {
  if (!STANDING_LADDER.includes(required)) return true;
  return (Number.isFinite(earnedSH) ? earnedSH : 0) >= STANDING_SH[required];
}

/**
 * Semester hours earned BEFORE a given term — the number the registrar would see
 * when the student registers for it.
 *
 * `shByTermIndex` is a term-index → credits map or array; anything at an index
 * < `termIndex` counts, anything at or after it does not. `bonusSH` is credit
 * that exists before the timeline starts (transfer, AP, placement), which counts
 * toward standing from day one — a student arriving with 32 transfer credits is a
 * sophomore in their first term, and that is precisely the case a term-fraction
 * model can never express.
 *
 * @param {number} termIndex
 * @param {Record<number,number>|number[]} shByTermIndex
 * @param {number} [bonusSH]
 * @returns {number}
 */
/**
 * The earliest TERM INDEX at which a plan has earned `requiredSH`.
 *
 * The generator's version of the same rule. `termSH` is the plan's per-term credit
 * target in order, and co-op terms are 0 there (`shape.js` sets `targetSH: 0` for
 * work terms) — which is the whole reason this exists rather than a fraction of
 * the plan's length: a plan with two co-op terms reaches junior standing a year
 * later than one without, and no fraction can know that.
 *
 * Returns `termSH.length` when the plan never accumulates enough. That is a real
 * conflict — the plan cannot legally contain the course at all — but it is
 * expressed as "last" rather than "nowhere" because this feeds an ORDERING. If it
 * is ever promoted to a domain filter, this return needs revisiting first: it
 * would forbid every term rather than merely disprefer them.
 *
 * @param {number} requiredSH
 * @param {number[]} termSH  credits per term, in plan order
 * @param {number} [bonusSH] credit already held before term 0 (transfer/AP)
 * @returns {number} term index
 */
export function standingFloorTerm(requiredSH, termSH, bonusSH = 0) {
  const need = Number.isFinite(requiredSH) ? requiredSH : 0;
  if (need <= 0) return 0;
  const list = Array.isArray(termSH) ? termSH : [];
  let sum = Number.isFinite(bonusSH) ? bonusSH : 0;
  for (let ti = 0; ti < list.length; ti++) {
    if (sum >= need) return ti;
    sum += Number.isFinite(list[ti]) ? list[ti] : 0;
  }
  return list.length;
}

export function earnedSHBefore(termIndex, shByTermIndex, bonusSH = 0) {
  let sum = Number.isFinite(bonusSH) ? bonusSH : 0;
  if (!shByTermIndex) return sum;
  const entries = Array.isArray(shByTermIndex)
    ? shByTermIndex.map((v, i) => [i, v])
    : Object.entries(shByTermIndex).map(([k, v]) => [Number(k), v]);
  for (const [ti, sh] of entries) {
    if (!Number.isFinite(ti) || ti >= termIndex) continue;
    if (Number.isFinite(sh)) sum += sh;
  }
  return sum;
}

/**
 * Canonical English names, for surfaces that are not localized — the MCP tools
 * answer in English regardless of the app's locale. The UI must NOT use these:
 * every user-facing string exists in all 8 locales, so `CourseCard` reads
 * `t.classStanding[code]` instead.
 */
export const STANDING_NAMES = Object.freeze({
  FR: "Freshman", SH: "Sophomore", JR: "Junior", SR: "Senior",
});

/**
 * The most lenient standing in a `|`-joined key, or null.
 *
 * "Most lenient" is the earliest rung the key admits, because a student holding it
 * satisfies the restriction. GR is skipped for the reason on STANDING_LADDER: a
 * `GR|JR|SR` section is open to juniors, so its floor is junior, while a GR-ONLY
 * section has no undergraduate floor at all and returns null.
 *
 * @param {string} key
 * @returns {string|null} a STANDING_LADDER member
 */
export function lenientStanding(key) {
  let best = null;
  for (const code of String(key ?? "").split("|")) {
    const i = STANDING_LADDER.indexOf(code);
    if (i === -1) continue;
    if (best === null || i < STANDING_LADDER.indexOf(best)) best = code;
  }
  return best;
}

/**
 * The earliest position 0..1 a course's class-standing gate allows, or null when
 * there is no gate to read.
 *
 * Null rather than 0 on purpose: the caller has to distinguish "the registrar says
 * this is open from day one" from "we have no restriction data", because only the
 * second should fall back to the level-digit estimate.
 *
 * @param {{offering?: {std?: string}}|null|undefined} course  a normalized Course
 * @returns {number|null}
 */
export function standingFloorOf(course) {
  const code = course?.offering?.std;
  if (typeof code !== "string") return null;
  const floor = STANDING_FLOOR[code];
  return typeof floor === "number" ? floor : null;
}
