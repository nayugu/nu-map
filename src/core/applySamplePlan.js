// ═══════════════════════════════════════════════════════════════════
// APPLY SAMPLE PLAN  (pure — no React, no I/O)
//
// Turns a department's published plan (src/data/**/plan.json) into the two
// things a planner stores: course placements, and reservations for the cells
// that name no course.
//
// Strictly ADDITIVE. A course already placed stays exactly where it is, and
// nothing is ever removed — applying a plan must not undo a decision the
// student already made.
// ═══════════════════════════════════════════════════════════════════

import { createReservation } from "./reservations.js";

/** A cell the plan left open: no courses, and not a co-op, vacation or label. */
const isOpen = (e) =>
  !e.options?.length && !e.heading && !e.coop && !e.vacation && !e.either;

/** Split a semester list into academic years, the way semGrid lays them out. */
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
 * @param {object} plan        one entry from plan.json `plans[]`
 * @param {object} ctx
 * @param {object[]} ctx.semesters
 * @param {object} ctx.courseMap        id → course, for "is this real?"
 * @param {object} [ctx.placements]     never mutated
 * @param {object} [ctx.reservations]   never mutated
 * @param {object} [ctx.programData]    for naming the requirement a cell is for
 * @param {number} [ctx.startYearIndex]
 * @returns {{placements, reservations, placed, reserved, notes}}
 */
export function applySamplePlan(plan, {
  semesters = [], courseMap = {}, placements = {}, reservations = {},
  programData = null, startYearIndex = 0,
} = {}) {
  const years = academicYears(semesters);
  const nextPlacements = { ...placements };
  const nextReservations = { ...reservations };
  const placed = [], reserved = [], notes = [];
  const held = new Set(Object.keys(placements).map(k => String(k).split("#")[0]));
  const sections = programData?.requirementSections ?? [];

  (plan?.years ?? []).forEach((gridYear, i) => {
    for (const term of gridYear.terms ?? []) {
      const sem = years[startYearIndex + i]?.find(s => s.semTypeId === term.type);
      if (!sem) {
        if (term.entries?.length) notes.push({ kind: "outside-timeline", text: `${gridYear.label} ${term.term}` });
        continue;
      }
      const walk = (entries) => {
        for (const e of entries ?? []) {
          if (e.vacation || e.heading || e.either) { walk(e.children); continue; }
          if (e.coop) { notes.push({ kind: "coop", semId: sem.id }); walk(e.children); continue; }

          if (isOpen(e)) {
            // Which requirement it stands for, named so a re-scrape that
            // reorders sections cannot silently repoint the card.
            const idx = e.binding?.targets?.length === 1 && typeof e.binding.targets[0] === "number"
              ? e.binding.targets[0] : null;
            const requirement = idx != null && sections[idx]
              ? { index: idx, title: sections[idx].title ?? "" } : null;
            const r = createReservation({ semId: sem.id, label: e.text, sh: e.sh ?? null, requirement });
            nextReservations[r.id] = r;
            reserved.push(r);
            walk(e.children);
            continue;
          }

          // Only a single option group is a course the plan actually names.
          // A choice is the student's to make, so it becomes a reservation
          // that already knows its candidates.
          if (e.options.length > 1) {
            const r = createReservation({ semId: sem.id, label: e.text, sh: e.sh ?? null });
            r.options = e.options;
            nextReservations[r.id] = r;
            reserved.push(r);
          } else {
            for (const code of e.options[0] ?? []) {
              if (held.has(code)) { notes.push({ kind: "already-placed", code }); continue; }
              if (!courseMap[code]) { notes.push({ kind: "unknown-course", code }); continue; }
              nextPlacements[code] = sem.id;
              held.add(code);
              placed.push(code);
            }
          }
          walk(e.children);
        }
      };
      walk(term.entries);
    }
  });

  return { placements: nextPlacements, reservations: nextReservations, placed, reserved, notes };
}
