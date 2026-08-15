// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/specialTerms  (implements ISpecialTerms)
//
// Each duration object has two distinct numeric fields:
//   duration — length in calendar months (stored in plan state,
//              used for display labels and drag-and-drop identity)
//   weight   — grid weight on the ICalendar scale (1.0 = one full
//              semester slot; used for span logic when placing terms)
//
//   4-month co-op      → duration 4,  weight 1.0  (one full slot)
//   6-month co-op      → duration 6,  weight 2.0  (spans two slots)
//   2-month internship → duration 2,  weight 0.5  (one summer half)
//   4-month internship → duration 4,  weight 1.0  (one full slot)
// ═══════════════════════════════════════════════════════════════════

const _types = [
  {
    id:    "coop",
    label: "Co-op",
    color: "#f87171",
    durations: [
      { id: "4mo", label: "4-month", duration: 4, weight: 1.0 },
      { id: "6mo", label: "6-month", duration: 6, weight: 2.0 },
    ],
    attributeGrants: ["EX"],
    // A co-op block IS a course registration — students really do register for
    // one, and 140 programs name such a course as a requirement. So the card
    // carries a course field, scoped to the 87 catalog courses stamped
    // `kind: "coop"` by scripts/derive-coop-courses.js.
    //
    // It registers NOTHING until the student picks. This used to grant
    // COOP 3945 from any placed co-op, on the reasoning that all 37 COOP-naming
    // undergraduate programs list 3945 among their options — but the variants
    // are not interchangeable (3946/3947 are half-time, 3947/3948 abroad), and
    // the inference picked an option that FIT rather than the one that was
    // true. A student whose co-op registered something a section does not
    // accept saw it tick anyway. The field is the honest answer to the question
    // the inference was guessing at.
    registersCourse: "coop",
    occupiesSlot:    true,
    creditValue:     0,
    // A full-time co-op is 32+ hours a week, and NU permits ONE course
    // alongside it: no petition when it does not conflict (after 5pm Mon–Fri,
    // weekends, or asynchronous), and the Petition Registration form beyond
    // 4 credits. Two courses needs the co-op coordinator, the academic
    // advisor and the job supervisor, and fall/spring only.
    //
    // The corpus says the same number independently: of the 90 mixed co-op
    // terms across 42 published plans, 88 of the 88 legitimate ones are ≤4 SH
    // (the two 16 SH outliers are parse artifacts — a full four-course load
    // printed beside a co-op cell).
    //
    // ADVISORY, never enforced. Two courses IS permitted with approvals, so an
    // app that refused to draw it would be wrong about the policy as well as
    // paternalistic — and this codebase already settled that argument:
    // "NU Map trusts the user: the repeat limit is never enforced, only
    // reported" (core/repeatInstances.js).
    concurrentCap:   { courses: 1, sh: 4 },
  },
  {
    id:    "intern",
    label: "Internship",
    color: "#9ca3af",
    durations: [
      { id: "2mo", label: "2-month", duration: 2, weight: 0.5 },
      { id: "4mo", label: "4-month", duration: 4, weight: 1.0 },
    ],
    attributeGrants: [],
    // Same bridge as co-op, and it needs the same care about WHICH courses.
    // NEU registers two different things under the word "internship":
    //
    //   • 5 zero-credit registrations — `COOP 3949 Internship Exchange`,
    //     `EEBA 2945/2948 Internship Experience`, `COP 5002`, `PPUA 6861`.
    //     These record a work term, exactly like COOP 3945.
    //   • 35 credit-bearing `*994 Internship` courses, 4 SH each, one per
    //     department. A student pays tuition and earns credit for those, so
    //     they are ordinary courses you place on the board — NOT this block.
    //
    // Only the first group is stamped `kind: "intern"`, so only it appears in
    // this card's picker. Hiding the second group would have cost 35 courses
    // 4 SH apiece.
    registersCourse: "intern",
    occupiesSlot:    true,
    creditValue:     0,
    // Deliberately no concurrentCap. A full-time internship is the same
    // situation as a full-time co-op, but the ≤4 SH / one-course rule is
    // published as CO-OP policy and I have no source saying it governs
    // internships. Absent means courses in the term stay parked and uncounted,
    // which is today's behaviour — so this omission changes nothing rather
    // than guessing a number onto a student's credit total.
  },
];

/** @type {import('../../ports/ISpecialTerms.js').ISpecialTerms} */
export default {
  getTypes() { return _types; },

  /**
   * NU-specific placement rules for co-op and internship blocks.
   *
   * Co-op (4-month): any fall or spring slot; or sumA of a summer pair.
   * Co-op (6-month): must start at spring or sumB (spans into following semester).
   * Internship (2-month): summer only (one half-slot).
   * Internship (4-month): any fall or spring; or sumA of a summer pair.
   *
   * @param {string} typeId
   * @param {number} duration - calendar months
   * @param {string} semId
   * @param {import('../../ports/ISpecialTerms.js').DropContext} ctx
   * @returns {{valid: boolean, startId?: string}}
   */
  validateDrop(typeId, duration, semId, { SEMESTERS, SEM_PREV, SEM_NEXT, isOccupied }) {
    const type = _types.find(t => t.id === typeId);
    if (!type || !type.occupiesSlot) return { valid: false };
    const sem = SEMESTERS.find(s => s.id === semId);
    if (!sem) return { valid: false };

    if (typeId === "coop") {
      if (duration === 4) {
        if (sem.type === "fall" || sem.type === "spring") {
          if (isOccupied(semId)) return { valid: false };
          return { valid: true, startId: semId };
        }
        if (sem.type === "summer") {
          let startId = semId;
          if (sem.id.startsWith("sumB")) {
            const prev = SEM_PREV[semId];
            if (!prev) return { valid: false };
            startId = prev;
            if (isOccupied(startId)) return { valid: false };
          }
          const nxt = SEM_NEXT[startId];
          if (!nxt || isOccupied(nxt)) return { valid: false };
          return { valid: true, startId };
        }
      }
      if (duration === 6) {
        // 6-month: only spring or sumB are valid starts (NU academic calendar rule)
        let startId;
        if (sem.type === "spring" || sem.id.startsWith("sumB")) {
          startId = semId;
        } else {
          const prev = SEM_PREV[semId];
          if (!prev) return { valid: false };
          const prevSem = SEMESTERS.find(s => s.id === prev);
          if (!prevSem) return { valid: false };
          if (prevSem.type === "spring" || prevSem.id.startsWith("sumB")) startId = prev;
          else return { valid: false };
        }
        const contId = SEM_NEXT[startId];
        if (!contId) return { valid: false };
        if (isOccupied(startId) || isOccupied(contId)) return { valid: false };
        return { valid: true, startId };
      }
      return { valid: false };
    }

    if (typeId === "intern") {
      if (duration === 2) {
        if (sem.type !== "summer") return { valid: false };
        if (isOccupied(semId)) return { valid: false };
        return { valid: true, startId: semId };
      }
      if (duration === 4) {
        if (sem.type === "fall" || sem.type === "spring") {
          if (isOccupied(semId)) return { valid: false };
          return { valid: true, startId: semId };
        }
        if (sem.type === "summer") {
          let startId = semId;
          if (sem.id.startsWith("sumB")) {
            const prev = SEM_PREV[semId];
            if (!prev) return { valid: false };
            startId = prev;
            if (isOccupied(startId)) return { valid: false };
          }
          const nxt = SEM_NEXT[startId];
          if (!nxt || isOccupied(nxt)) return { valid: false };
          return { valid: true, startId };
        }
      }
      return { valid: false };
    }

    // Weight-based fallback for any future custom term type
    const durationDesc = type.durations.find(d => d.duration === duration) ?? type.durations[0];
    const semWeight    = sem.weight ?? 1;
    if (durationDesc.weight > semWeight) {
      if (sem.type === "summer") {
        let startId = semId;
        if (sem.id.startsWith("sumB")) {
          const prev = SEM_PREV[semId];
          if (!prev) return { valid: false };
          startId = prev;
          if (isOccupied(startId)) return { valid: false };
        }
        const nxt = SEM_NEXT[startId];
        if (!nxt || isOccupied(nxt)) return { valid: false };
        return { valid: true, startId };
      }
      const nxt = SEM_NEXT[semId];
      if (!nxt || isOccupied(semId) || isOccupied(nxt)) return { valid: false };
      return { valid: true, startId: semId };
    }
    if (isOccupied(semId)) return { valid: false };
    return { valid: true, startId: semId };
  },

  getSources() { return []; },
};
