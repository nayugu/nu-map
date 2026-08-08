// ═══════════════════════════════════════════════════════════════════
// PLAN INSTANCE  (pure — no React, no I/O)
//
// A student who has "loaded the sample plan" holds three facts and nothing
// else. Everything visible is derived from them:
//
//   appliedPlan   { programKey, planLabel, startYearIndex }
//   placements    course -> semester, exactly as before, authoritative
//   planEdits     entryId -> { semId?, deleted? }   divergences only
//
// See docs/sample-plan-design.md §2. The reasoning, briefly:
//
// ── A reference, not a copy ────────────────────────────────────────
//
// Materializing the plan into the student's state costs a median 3.4 KB of
// JSON (max 6.3 KB) against 150-400 bytes for a reference, and plans go into
// share links whole. It also stays current with the monthly scrape for free,
// and — the part that matters more — makes applying a plan IDEMPOTENT BY
// CONSTRUCTION, because applying twice sets the same reference. The previous
// design needed slot-id de-duplication to achieve that and got it wrong: two
// labels differing only in case produced one id, and 11 terms silently lost a
// reservation nobody could notice was missing.
//
// ── What may be keyed by an entry id, and what may not ─────────────
//
// A derived tree offers only positional ids, and those are NOT stable.
// Measured against archived catalog editions: 95.6% of positions still hold
// the same thing after one year, 39.5% after five — on a sample too small to
// trust the magnitude, which is exactly why the rule below does not depend on
// it.
//
//   Anchor consequential state on COURSE ids, which do not drift.
//   Anchor only cosmetic state on POSITIONS.
//
// So `placements` carries the student's actual courses and never an entry id,
// while `planEdits` — moves and deletions — is the only positional state. When
// an id drifts, a dismissed reservation reappears or one sits in its published
// term instead of where it was dragged. Their coursework is untouched.
//
// ── Answered-ness is derived, never stored ─────────────────────────
//
// This is what removes the two-store duality entirely: no `filledBy`, no
// orphan repair, no second copy to keep consistent. Delete a course and its
// reservation returns, with no bookkeeping at all.
//
// Reservations never enter `placements`, so nothing that totals credit toward
// the degree can see one. That safety property was the previous design's whole
// reason for existing; here it holds for free, because a reservation is not a
// stored thing.
// ═══════════════════════════════════════════════════════════════════

/**
 * A cell the plan left unanswered — the thing a UI would eventually draw as a
 * reservation. Headings label other rows, co-ops and vacations are not
 * coursework, and anything carrying `options` was named outright.
 */
export const isReservation = (entry) =>
  !!entry && !entry.options?.length && !entry.heading && !entry.coop
  && !entry.vacation && !entry.either;

/**
 * Where an entry sits in its plan.
 *
 * Positional because that is all a derived tree can offer. The year INDEX is
 * used rather than the year's printed label ("Year 1"), since the label is
 * prose a department may reword without meaning anything by it, while position
 * is what the grid actually encodes. The term is identified by its mapped
 * type rather than its printed name for the same reason — "Summer 1" and
 * "Summer I" are one term written two ways.
 */
export const entryId = (planIndex, yearIndex, termType, ordinal) =>
  `${planIndex}.${yearIndex}.${termType ?? "?"}.${ordinal}`;

/**
 * Flatten one plan into positioned entries, in plan order.
 *
 * Plan order is a total order over every entry, and several things depend on
 * it: which reservation retires first when a requirement is satisfied, and the
 * order a term renders in. It is derived here rather than stored so that every
 * client agrees without carrying anything.
 *
 * Children are yielded after their heading and share its term, so a nested
 * grid flattens without losing where its rows belong.
 *
 * @param {object} grid       plan.json for one program
 * @param {string} planLabel  which published variant; the first if absent
 * @returns {Array<{id, entry, planIndex, yearIndex, termType, ordinal}>}
 */
export function flattenPlan(grid, planLabel = null) {
  const plans = grid?.plans ?? [];
  const planIndex = Math.max(0, planLabel == null
    ? 0
    : plans.findIndex(p => p.label === planLabel));
  const plan = plans[planIndex];
  if (!plan) return [];

  const out = [];
  (plan.years ?? []).forEach((year, yearIndex) => {
    for (const term of year.terms ?? []) {
      let ordinal = 0;
      const push = (entry) => {
        out.push({
          id: entryId(planIndex, yearIndex, term.type, ordinal++),
          entry, planIndex, yearIndex, termType: term.type, ordinal: ordinal - 1,
        });
        for (const child of entry.children ?? []) push(child);
      };
      for (const entry of term.entries ?? []) push(entry);
    }
  });
  return out;
}

/**
 * Split a semester list into academic years.
 *
 * A new year begins each time the FIRST semester type comes round again, which
 * is how src/core/semGrid.js lays them out — rather than parsing a year out of
 * the id, which would break on any calendar whose academic year does not start
 * in the fall.
 */
export function academicYears(semesters) {
  const real = (semesters ?? []).filter(s => s.semTypeId !== "incoming" && s.type !== "special");
  const years = [];
  if (!real.length) return years;
  const first = real[0].semTypeId;
  for (const sem of real) {
    if (sem.semTypeId === first || !years.length) years.push([]);
    years[years.length - 1].push(sem);
  }
  return years;
}

/**
 * Place a plan's entries onto the student's timeline.
 *
 * A plan running past the end of the timeline — a five-year plan on a
 * four-year cohort — yields entries with `semId: null` rather than being
 * silently truncated. That is a thing to report, not to hide.
 *
 * `planEdits` is applied last, so a student's move or deletion always wins
 * over the published position.
 *
 * @returns {Array<{id, entry, semId, deleted}>} in plan order
 */
export function positionEntries(flat, {
  semesters = [],
  startYearIndex = 0,
  planEdits = {},
} = {}) {
  const years = academicYears(semesters);
  return flat.map(({ id, entry, yearIndex, termType }) => {
    const edit = planEdits[id];
    const published = years[startYearIndex + yearIndex]
      ?.find(s => s.semTypeId === termType)?.id ?? null;
    return {
      id, entry,
      semId: edit?.semId ?? published,
      deleted: !!edit?.deleted,
      outsideTimeline: published === null,
    };
  });
}

// ── Answered-ness ──────────────────────────────────────────────────

/** Strip a repeat-instance suffix: "CS2500#2" -> "CS2500". */
const baseId = (pid) => {
  const i = String(pid).indexOf("#");
  return i < 0 ? String(pid) : String(pid).slice(0, i);
};

/**
 * Which entries the student's placements already answer.
 *
 * Two rules, and neither stores anything:
 *
 *   named    an entry is answered when one of its option GROUPS is fully
 *            placed. Groups are why this is not a membership test: "PSYC 3200
 *            or PT 5410 and PT 5411" is answered by PSYC 3200 alone or by BOTH
 *            PT courses, never by PT 5410 by itself.
 *
 *   unnamed  answered when the requirement it binds to has been satisfied
 *            beyond what the plan's own named entries supply. `surplus` is
 *            that measurement, taken by the caller from the graduation audit,
 *            so this module never forms a second opinion about satisfaction.
 *
 * Retirement is deterministic: the EARLIEST unanswered entry bound to a
 * requirement, in plan order. Two "Khoury Elective" entries and one newly
 * placed Khoury course is otherwise ambiguous, and resolving it differently
 * between renders would make the plan visibly churn.
 *
 * @param {Array} positioned            from positionEntries()
 * @param {object} ctx
 * @param {object} ctx.placements       course -> semester
 * @param {Map<string|number, number>} [ctx.surplus]
 *   binding target -> how many further reservations that requirement can retire
 * @returns {{answered: Set<string>, open: Array}}
 */
export function resolveAnswers(positioned, { placements = {}, surplus = new Map() } = {}) {
  const held = new Set(Object.keys(placements).map(baseId));
  const answered = new Set();

  for (const p of positioned) {
    if (p.deleted) continue;
    const groups = p.entry.options ?? [];
    if (!groups.length) continue;
    if (groups.some(group => group.length && group.every(c => held.has(c)))) answered.add(p.id);
  }

  // Reservations, earliest first — `positioned` is already in plan order, so
  // no sort is needed and none may be introduced without breaking the rule.
  const budget = new Map(surplus);
  for (const p of positioned) {
    if (p.deleted || answered.has(p.id) || !isReservation(p.entry)) continue;
    for (const target of p.entry.binding?.targets ?? []) {
      const left = budget.get(target) ?? 0;
      if (left <= 0) continue;
      budget.set(target, left - 1);
      answered.add(p.id);
      break;
    }
  }

  return {
    answered,
    open: positioned.filter(p => !p.deleted && !answered.has(p.id) && isReservation(p.entry)),
  };
}

/**
 * How many further reservations each requirement can retire.
 *
 * The measurement the caller feeds `resolveAnswers`. It is the difference
 * between what the student's actual placements satisfy and what the plan's own
 * named courses would satisfy, in whole courses — so a course placed for any
 * reason retires a reservation for the requirement it answers, and a course
 * the plan already named does not retire anything twice.
 *
 * @param {Map<string|number, number>} satisfiedNow   target -> credit satisfied
 * @param {Map<string|number, number>} satisfiedByPlan
 * @param {Map<string|number, number>} unitSH         target -> credit per course
 */
export function surplusOf(satisfiedNow, satisfiedByPlan, unitSH = new Map()) {
  const out = new Map();
  for (const [target, now] of satisfiedNow) {
    const base = satisfiedByPlan.get(target) ?? 0;
    const unit = unitSH.get(target) || 4;
    const n = Math.floor(Math.max(0, now - base) / unit);
    if (n > 0) out.set(target, n);
  }
  return out;
}

/**
 * A one-line-per-category account of what applying a plan would mean, built
 * from the same derivation the planner renders — never a second estimate of it.
 */
export function summarize(positioned, answered) {
  const live = positioned.filter(p => !p.deleted);
  return {
    entries: live.length,
    named: live.filter(p => p.entry.options?.length).length,
    reservations: live.filter(p => isReservation(p.entry)).length,
    answered: live.filter(p => answered.has(p.id)).length,
    coops: live.filter(p => p.entry.coop).length,
    outsideTimeline: live.filter(p => p.outsideTimeline).length,
    ambiguous: live.filter(p => p.entry.ambiguous).length,
  };
}
