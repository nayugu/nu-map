// ═══════════════════════════════════════════════════════════════════
// CHART · PORTS  (pure — the contract, and a permissive default)
//
// `src/core/` imports nothing from `src/adapters/`, and CHART keeps that
// direction: every institution-specific fact arrives through this contract.
// Availability, seat pressure, co-op rules and the calendar all live in
// `src/adapters/northeastern/`, so importing any of them here would invert the
// dependency direction of the whole app.
//
// The pattern is already established — `applySamplePlan` takes `coopDurations`
// and `monthsPerUnitWeight`, `bind-plans` injects `specAdmitsSubject`. This is
// the same idea with a name and one place to read it.
//
// ── null means UNKNOWN and unknown means ALLOWED ───────────────────
//
// 40.8% of the catalog has no offering history, and `semTypeProb` returns null
// there. Reading null as "not offered" would make two fifths of the catalog
// unschedulable — the same mistake as reading an empty EligibleSpec as "nothing
// can go here" instead of "nothing is named". Every port that can return null
// says so in its signature, and the engine treats null as permission.
// ═══════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} EnginePorts
 *
 * @property {(courseId: string, semTypeId: string) => number|null} offeringProbability
 *   Historical share of that season's terms in which the course ran. `null` when
 *   there is no usable history — which is PERMISSION, not refusal. Only an
 *   explicit 0 blocks a placement.
 *
 * @property {(courseId: string, semTypeId: string) => number|null} seatPressure
 *   Open seats per section, newest term on record for that season; higher is
 *   roomier. `null` when unknown. Used only by the robustness objective, never
 *   as a constraint — a course being tight is a risk, not an illegality.
 *
 * @property {(studentType: string) => number} creditMin
 * @property {(studentType: string) => number} creditMax
 *   The term credit envelope. NU: 12–19 undergraduate, 8–16 graduate. `creditMax`
 *   is the REGISTRATION cap, not the billing threshold — a student may register
 *   for 19 and be billed for 16 (see docs/plan-engine-design.md §5.5), so the
 *   engine constrains registration and says nothing about cost.
 *
 * @property {(semTypeId: string) => number} termWeight
 *   1.0 for a full term, 0.5 for a summer half. Scales the credit envelope: an
 *   8-week summer half is not expected to carry a full 16 SH.
 *
 * @property {(specialTermPl: object) => string[]} coopGrantedAttrs
 *   Attribute codes a work term grants (NU: `EX`). Reported, never planned for.
 */

/**
 * A port set that forbids nothing and knows nothing.
 *
 * The point is testability, not production use: every hostile fixture in the
 * unit suites runs against this, so a test that fails is failing on the engine's
 * logic rather than on Northeastern's calendar. It also documents the contract
 * by being the simplest thing that satisfies it.
 *
 * `offeringProbability` returns null rather than 1 on purpose — a default that
 * claimed certainty would let a bug in the "unknown is allowed" path pass
 * unnoticed in every test.
 */
export function permissivePorts(overrides = {}) {
  return {
    offeringProbability: () => null,
    // Defaults to offered, matching `offeringProbability`'s null. Absent data is not
    // evidence of absence, and a default of `false` would make every cell unschedulable
    // for a caller with no offering port at all — silently, in every test.
    offered: () => true,
    seatPressure: () => null,
    creditMin: () => 0,
    creditMax: () => Infinity,
    termWeight: () => 1,
    coopGrantedAttrs: () => [],
    ...overrides,
  };
}

/**
 * Fill any missing member of a caller-supplied port set.
 *
 * A partially-supplied set is a real input: a test that only cares about
 * availability should not have to restate the credit envelope. Missing members
 * degrade to permissive rather than throwing, because a thrown error here would
 * surface as "generation failed" for a reason the student cannot act on.
 */
export function withDefaults(ports) {
  return permissivePorts(ports ?? {});
}
