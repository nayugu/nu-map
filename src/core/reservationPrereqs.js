// ═══════════════════════════════════════════════════════════════════
// RESERVATION PREREQS  (pure — no React, no I/O)
//
// Can a card that has no course yet satisfy another course's prerequisite?
//
// A plan places "IE 3412 or MATH 3081" in spring, and IE 4516 — whose
// prerequisite is "IE 3412 Or MATH 3081" — a year later. Nothing is chosen, so
// `placements` holds neither, and IE 4516 is flagged as missing a prerequisite.
// The warning is false: whatever the student picks, they will have it.
//
// ── Only when EVERY option satisfies it ────────────────────────────
//
// The card is an undecided choice, so clearing a warning on its behalf is a
// claim about a course that does not exist yet. It may only be made when no
// decision could falsify it:
//
//   IE 4516 needs "IE 3412 Or MATH 3081", card is "IE 3412 or MATH 3081"
//     → satisfied under both options                       → warning cleared
//
//   a course needing "IE 3412 AND MATH 3081"
//     → each option supplies half                          → warning stays
//
// The second case is why this evaluates the prerequisite TREE per option rather
// than checking which courses are mentioned. Mentioning is what the edge
// synthesis in reservationEdges.js tests, and it is a weaker statement: both
// options appear in "A AND B" while neither satisfies it.
//
// ── Ordering still applies ─────────────────────────────────────────
//
// The option is placed at the RESERVATION's semester, so a card sitting after
// the course it would feed satisfies nothing — exactly as a real course placed
// there would not.
//
// ── Conservative when it cannot be sure ────────────────────────────
//
// Several undecided cards can bear on one course, and the honest question is
// whether every JOINT assignment satisfies it. That product is bounded; past
// the bound this returns null ("no opinion") and the warning stands. Giving up
// leaves a warning that may be unnecessary, which is the cheap direction.
// ═══════════════════════════════════════════════════════════════════

import { evalPrereqTree } from "./prereqEval.js";

/** Course ids named anywhere in a prerequisite token list. */
function atomsOf(tree) {
  const out = new Set();
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === "object" && node.subject && node.number) {
      out.add(`${String(node.subject).toUpperCase()}${node.number}`);
    }
  };
  walk(tree);
  return out;
}

/** Option groups of a reservation that name only courses we actually have. */
function liveGroups(reservation, courseMap) {
  const groups = reservation?.options;
  if (!Array.isArray(groups) || !groups.length) return null;
  const live = groups.filter(g =>
    Array.isArray(g) && g.length && g.every(id => !courseMap || courseMap[id]));
  return live.length ? live : null;
}

/**
 * Would this course's prerequisite be satisfied whatever the undecided cards
 * become?
 *
 * @param {object} course        needs `prereqs`
 * @param {number} ti            the course's own semester index
 * @param {object} ctx
 * @param {object} ctx.reservations
 * @param {object} ctx.placements     already-effective placements
 * @param {object} ctx.semIndex
 * @param {Set} [ctx.placedOut]
 * @param {object} [ctx.courseMap]
 * @param {object} [ctx.conditions]
 * @param {number} [ctx.maxWorlds=64]
 * @returns {boolean|null} true / false, or null when no card is relevant or the
 *   joint space is too large to decide
 */
export function satisfiedUnderEveryOption(course, ti, {
  reservations, placements, semIndex, placedOut = new Set(),
  courseMap = null, conditions = null, maxWorlds = 64,
} = {}) {
  const tree = course?.prereqs;
  if (!tree?.length) return null;
  const atoms = atomsOf(tree);
  if (!atoms.size) return null;

  // Only cards that could supply something this prerequisite names matter.
  const relevant = [];
  for (const r of Object.values(reservations ?? {})) {
    if (!r?.semId) continue;
    const groups = liveGroups(r, courseMap);
    if (!groups) continue;
    if (!groups.some(g => g.some(id => atoms.has(id)))) continue;
    relevant.push({ semId: r.semId, groups });
  }
  if (!relevant.length) return null;

  let worlds = 1;
  for (const r of relevant) worlds *= r.groups.length;
  if (worlds > maxWorlds) return null;      // too many joint assignments to decide

  // Every joint assignment must satisfy it.
  const check = (i, extra) => {
    if (i === relevant.length) {
      const merged = { ...placements };
      for (const [id, semId] of extra) {
        // A real placement always wins: a virtual one must never move a course
        // the student actually put somewhere.
        if (merged[id] == null) merged[id] = semId;
      }
      return evalPrereqTree(tree, merged, semIndex, ti, placedOut, null, conditions) === "satisfied";
    }
    for (const g of relevant[i].groups) {
      const next = [...extra, ...g.map(id => [id, relevant[i].semId])];
      if (!check(i + 1, next)) return false;
    }
    return true;
  };
  return check(0, []);
}
