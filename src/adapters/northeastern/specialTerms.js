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
    occupiesSlot:    true,
    creditValue:     0,
  },
  {
    id:    "intern",
    label: "Full-Time Internship",
    color: "#9ca3af",
    durations: [
      { id: "2mo", label: "2-month", duration: 2, weight: 0.5 },
      { id: "4mo", label: "4-month", duration: 4, weight: 1.0 },
    ],
    attributeGrants: [],
    occupiesSlot:    true,
    creditValue:     0,
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
};
