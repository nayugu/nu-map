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

import { createReservation, originKey, originsOf } from "./reservations.js";
// A leaf module by design — see `planLabels.js`. `planTemplate.js` re-exports these and also
// imports THIS file, so reading them from there would make a cycle out of two string constants.
import { isGeneratedPlanLabel, GENERATED_ORIGIN_NS } from "./planLabels.js";

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
 * Months in a full-weight term. NU's semester weights are 1.0 for fall/spring
 * (four months) and 0.5 for each summer half (two), and its co-ops are sold in
 * exactly those units. A parameter so an institution with a different calendar
 * is not forced through NU's arithmetic.
 */
const MONTHS_PER_UNIT_WEIGHT = 4;

/** A stable id for a co-op the plan created, so re-applying does not duplicate. */
const coopId = (semId, typeId) => `${typeId}-plan-${semId}`;

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
  // Northeastern's co-op is SIX months and comes in two cycles: one overlapping
  // spring (spring + summer 1) and one overlapping fall (summer 2 + fall).
  // Measured across the corpus, those two shapes are ~1,235 of ~1,875 runs and
  // single-term co-ops are 4. The default reflects that; an institution
  // offering others passes them in.
  specialTermPl = {}, coopTypeId = "coop", coopDurations = [6],
  monthsPerUnitWeight = MONTHS_PER_UNIT_WEIGHT,
} = {}) {
  const years = academicYears(semesters);
  const nextPlacements = { ...placements };
  // Co-op cells are collected first and merged afterwards: a run cannot be
  // recognised one cell at a time.
  const coopCells = [];
  const nextReservations = { ...reservations };
  const nextSpecial = { ...specialTermPl };
  // Cards this plan already put in the student's plan. Re-applying must add
  // nothing a second time — the same guarantee an already-placed course gets.
  const seenOrigins = originsOf(reservations);
  // ── Provenance is keyed on a STABLE token, not on the caption ──────
  //
  // `originKey` embeds this string, and `seenOrigins` uses the result to know a card is already
  // here. Reading the display label directly makes every reservation's identity hostage to the
  // wording: renaming the generated plan's label doubled a student's cards, measured at 3 -> 6,
  // with nothing reported. A department's variant label is genuinely the identity of its plan
  // and stays as it is; OUR label is a caption we are free to reword, so it is replaced by a
  // constant that never changes. See `GENERATED_ORIGIN_NS`.
  const planLabel = isGeneratedPlanLabel(plan?.label)
    ? GENERATED_ORIGIN_NS
    : (plan?.label ?? "");
  const placed = [], reserved = [], coops = [], notes = [];
  const held = new Set(Object.keys(placements).map(k => String(k).split("#")[0]));
  const sections = programData?.requirementSections ?? [];

  // Which requirement a cell stands for, named so a re-scrape that reorders
  // sections cannot silently repoint the card. Only a binding forced to a single
  // SECTION is followed: a sentinel (`~general`, `~concentration`) is not a
  // section index, and an ambiguous list is not an answer.
  const requirementOf = (e) => {
    const t = e.binding?.targets;
    if (t?.length !== 1 || typeof t[0] !== "number") return null;
    return sections[t[0]] ? { index: t[0], title: sections[t[0]].title ?? "" } : null;
  };

  (plan?.years ?? []).forEach((gridYear, i) => {
    for (const term of gridYear.terms ?? []) {
      const sem = years[startYearIndex + i]?.find(s => s.semTypeId === term.type);
      if (!sem) {
        if (term.entries?.length) notes.push({ kind: "outside-timeline", text: `${gridYear.label} ${term.term}` });
        continue;
      }
      let ordinal = 0;
      const walk = (entries) => {
        for (const e of entries ?? []) {
          if (e.vacation || e.heading || e.either) { walk(e.children); continue; }
          if (e.coop) { coopCells.push(sem); walk(e.children); continue; }

          if (isOpen(e)) {
            const requirement = requirementOf(e);
            const origin = originKey(planLabel, startYearIndex + i, term.type, ordinal++);
            if (seenOrigins.has(origin)) {
              notes.push({ kind: "already-reserved", origin });
            } else {
              const r = createReservation({ semId: sem.id, label: e.text, sh: e.sh ?? null, requirement, origin });
              nextReservations[r.id] = r;
              reserved.push(r);
            }
            walk(e.children);
            continue;
          }

          // Only a single option group is a course the plan actually names.
          // A choice is the student's to make, so it becomes a reservation
          // that already knows its candidates.
          if (e.options.length > 1) {
            const origin = originKey(planLabel, startYearIndex + i, term.type, ordinal++);
            if (seenOrigins.has(origin)) {
              notes.push({ kind: "already-reserved", origin });
            } else {
              // A named choice carries its requirement for the same reason an
              // open cell does. No published plan supplies one — `bind-plans`
              // only binds cells with no options, so all 1,386 multi-option
              // cells in the corpus arrive with `binding` absent and this reads
              // as null — but a CHART-generated plan constructs the binding
              // rather than inferring it, and dropping it here would throw away
              // the one thing generation knows for certain.
              const r = createReservation({
                semId: sem.id, label: e.text, sh: e.sh ?? null,
                requirement: requirementOf(e), origin,
              });
              r.options = e.options;
              nextReservations[r.id] = r;
              reserved.push(r);
            }
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

  // ── Corequisites come with the course ────────────────────────────
  //
  // A corequisite must be taken in the SAME term, so a plan that places
  // CS 3000 without CS 3001 hands the student a violation the moment it loads.
  // Measured: 218 such gaps across the corpus, in 19.9% of plans — 85 of them
  // that one pair.
  //
  // This is not inventing. Every OTHER way a course reaches the grid already
  // carries its partners: both drag handlers build `coreqPartners` and move
  // them together. Loading a plan was the one path that did not, so the fix is
  // consistency rather than a new rule.
  //
  // Departments omit them because the printed grid lists what you CHOOSE, and
  // 88% of the missing partners are zero-credit recitations that come with the
  // lecture — nothing to decide, so nothing to print.
  //
  // A partner the student has already placed is left exactly where it is: this
  // completes the plan, it does not relocate their work.
  const coreqNotes = [];
  for (const [id, semId] of Object.entries(nextPlacements)) {
    for (const r of courseMap[id]?.coreqs ?? []) {
      if (!r || typeof r !== "object" || !r.subject) continue;
      const partner = `${String(r.subject).toUpperCase()}${parseInt(r.number, 10)}`;
      if (!courseMap[partner]) continue;              // renumbered away
      if (held.has(partner)) continue;                // already in the plan
      nextPlacements[partner] = semId;
      held.add(partner);
      placed.push(partner);
      coreqNotes.push({ kind: "coreq-added", code: partner, with: id });
    }
  }
  notes.push(...coreqNotes);

  // ── A cycle is indivisible: displaced co-ops come out first ──────
  //
  // Applying a plan used to add its courses and leave every existing co-op exactly
  // where it was. That is right for a co-op the plan ALSO wants there, and wrong for one
  // sitting in a term the plan needs for study — the term ends up being a work term and
  // holding courses at the same time, and the courses have nowhere to be.
  //
  // It is what makes switching cycles look like nothing happened. "Four Years, Two Co-ops
  // in Spring/Summer First" and "…in Summer Second Half" differ ONLY in which terms are
  // work terms; load the second over the first and every one of its study terms is still
  // blocked by the first's co-ops, so the courses cannot land and the grid barely moves.
  //
  // A published cycle is a coherent whole — you cannot take half of it — so a co-op the
  // new plan contradicts is removed and reported. The student's own work is still
  // protected everywhere it does not conflict: a co-op in a term this plan also leaves for
  // work is kept, which is the `coop-kept` case below.
  // Term order, shared with the run-merging below: one map, so the two cannot disagree
  // about which terms are adjacent.
  const order = new Map((semesters ?? []).map((s, i) => [s.id, i]));

  const studySemIds = new Set(
    Object.values(nextPlacements).concat(
      Object.values(nextReservations).map(r => r?.semId)).filter(Boolean));
  for (const sem of coopCells) studySemIds.delete(sem.id);

  // Judged by the co-op's START term, and only that.
  //
  // The first version re-derived the whole span from the stored duration — a co-op records
  // only where it begins and how many months it runs — and walked forward accumulating term
  // weights. That broke IDEMPOTENCE on 9 plans: the re-derived span could include a term
  // the plan legitimately uses for courses, so re-applying a plan displaced the very co-op
  // its own first application had created. The derivation and the run-merging below
  // disagreed about which terms a block covers, and the derivation is the guess.
  //
  // The start term needs no guessing and is exactly the case that matters: switching
  // cycles moves where co-ops BEGIN. A co-op whose start term this plan wants for study is
  // unambiguously contradicted; anything subtler is left alone, and a term that ends up
  // both working and studying is reported by the planner's own checks rather than
  // guessed at here.
  for (const [id, d] of Object.entries(nextSpecial)) {
    if (!d?.semId || !studySemIds.has(d.semId)) continue;
    delete nextSpecial[id];
    notes.push({ kind: "coop-displaced", semId: d.semId });
  }

  // ── Co-ops are runs, not cells ───────────────────────────────────
  //
  // The catalog writes a six-month co-op as TWO cells — Spring "Co-op" and
  // Summer 1 "Co-op" — because its grid has one column per term. Reading them
  // as two co-ops would give a student twice as many as their program
  // requires. So consecutive co-op terms merge into one block, and its length
  // comes from the terms it spans: a full term is four months, a summer half
  // is two, so Spring + Summer 1 is the six-month co-op it actually is.
  coopCells.sort((a, b) => order.get(a.id) - order.get(b.id));

  let run = [];
  const flush = () => {
    if (!run.length) return;
    const start  = run[0];
    const weight = run.reduce((n, s) => n + (s.weight ?? 1), 0);
    const months = weight * monthsPerUnitWeight;
    // Snap to what the institution actually offers: a grid can describe a
    // length nobody can register for.
    const duration = [...coopDurations].sort(
      (a, b) => Math.abs(a - months) - Math.abs(b - months) || a - b)[0] ?? months;

    // An existing co-op anywhere in the run means the student already planned
    // this stretch; leave every part of it alone. Applying a plan must not
    // overwrite a decision already made.
    // Read from `nextSpecial`, not the incoming `specialTermPl`: a co-op displaced above
    // is gone, and consulting the original would have it still "occupying" the run and
    // silently suppress the co-op this plan is asking for — leaving the student with
    // neither the old block nor the new one.
    const occupied = run.some(s =>
      Object.values(nextSpecial).some(d => d?.semId === s.id));
    if (occupied) {
      notes.push({ kind: "coop-kept", semId: start.id });
    } else {
      const id = coopId(start.id, coopTypeId);
      nextSpecial[id] = { typeId: coopTypeId, semId: start.id, duration };
      coops.push({ id, semId: start.id, duration, spans: run.map(s => s.id) });
    }
    run = [];
  };
  for (const sem of coopCells) {
    const prev = run[run.length - 1];
    if (prev && order.get(sem.id) !== order.get(prev.id) + 1) flush();
    run.push(sem);
  }
  flush();

  return { placements: nextPlacements, reservations: nextReservations,
           specialTermPl: nextSpecial, placed, reserved, coops, notes };
}
