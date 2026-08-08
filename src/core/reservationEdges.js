// ═══════════════════════════════════════════════════════════════════
// RESERVATION EDGES  (pure — no React, no I/O)
//
// Prerequisite lines for a card that has no course yet.
//
// `IE 3412 or MATH 3081` sits in a term, and `IE 4516` sits in a later one
// requiring "IE 3412 Or MATH 3081". Every human reads a connection there. The
// app draws none, because `extractEdges` keys edges by course id and the card
// is not a course — it stands in for one.
//
// So the edges are synthesised: a reservation borrows the connections of the
// courses it could become.
//
// ── Only what holds under EVERY option ─────────────────────────────
//
// The card is a decision the student has not made. An edge drawn from it is a
// claim about a course that does not exist yet, so it may only be drawn when
// choosing differently could not falsify it:
//
//   IE 4516 needs IE 3412 OR MATH 3081, and BOTH options feed it
//     → whatever the student picks, the connection holds        → drawn
//
//   a course fed by IE 3412 alone
//     → picking MATH 3081 would make the line a lie             → not drawn
//
// The looser reading — draw if ANY option connects — produces more lines and
// some of them become false the moment the card is answered. Lines are cheap to
// omit and expensive to be wrong about, so this takes the strict one.
// `requireAll: false` is available for callers that want the looser rule, but
// nothing uses it.
//
// ── Only for cards that NAME their options ─────────────────────────
//
// A `Khoury Elective` card could become any of a hundred courses, and the
// intersection of a hundred courses' connections is empty in almost every case
// — so it would cost a large computation to draw nothing. Named cells are 1,386
// of the corpus and are exactly the ones a student can see a connection in.
// ═══════════════════════════════════════════════════════════════════

import { cleanOptionGroups } from "./reservations.js";

/** Edge types this synthesises. Both behave identically here. */
const TYPES = ["prerequisite", "corequisite"];

/**
 * Index edges once: what feeds a course, and what a course feeds.
 * Keyed by type, because a corequisite line must not be born from a
 * prerequisite one.
 */
function indexEdges(allEdges) {
  const feeds = new Map();   // type → (from → Set(to))
  const fedBy = new Map();   // type → (to   → Set(from))
  for (const t of TYPES) { feeds.set(t, new Map()); fedBy.set(t, new Map()); }
  for (const e of allEdges ?? []) {
    if (!e || !e.from || !e.to) continue;
    const f = feeds.get(e.type), b = fedBy.get(e.type);
    if (!f) continue;                       // an edge type we do not synthesise
    if (!f.has(e.from)) f.set(e.from, new Set());
    f.get(e.from).add(e.to);
    if (!b.has(e.to)) b.set(e.to, new Set());
    b.get(e.to).add(e.from);
  }
  return { feeds, fedBy };
}

/** The option groups that could still answer a reservation. */
const liveGroups = (reservation, courseMap) =>
  cleanOptionGroups(reservation?.options, courseMap);

/**
 * Synthesise the edges a reservation should take part in.
 *
 * @param {object} reservations  id → reservation
 * @param {object[]} allEdges    the real course-to-course edges
 * @param {object} opts
 * @param {object} opts.courseMap
 * @param {boolean} [opts.requireAll=true]  draw only what holds under every option
 * @returns {object[]} edges carrying `viaReservation: true`
 */
export function reservationEdges(reservations, allEdges, { courseMap = {}, requireAll = true } = {}) {
  const list = Object.values(reservations ?? {});
  if (!list.length || !allEdges?.length) return [];
  const { feeds, fedBy } = indexEdges(allEdges);
  const out = [];

  for (const r of list) {
    const groups = liveGroups(r, courseMap);
    if (!groups) continue;                  // unnamed card: nothing to borrow

    for (const type of TYPES) {
      const feedsT = feeds.get(type), fedByT = fedBy.get(type);

      // What every option (or any, when loose) feeds → edges OUT of the card.
      // What every option is fed by                 → edges INTO the card.
      const collect = (side) => {
        // Per group, the union over its members: a group is taken whole, so a
        // connection from any member is a connection of the group.
        const perGroup = groups.map(g => {
          const acc = new Set();
          for (const id of g) for (const x of side.get(id) ?? []) acc.add(x);
          return acc;
        });
        if (!perGroup.length) return [];
        if (!requireAll) {
          const any = new Set();
          for (const s of perGroup) for (const x of s) any.add(x);
          return [...any];
        }
        // Intersection across groups, seeded from the smallest.
        const smallest = perGroup.reduce((a, b) => (a.size <= b.size ? a : b));
        return [...smallest].filter(x => perGroup.every(s => s.has(x)));
      };

      for (const to of collect(feedsT)) {
        // A card must not point at a course it could BE — that reads as the
        // course being its own prerequisite.
        if (groups.some(g => g.includes(to))) continue;
        out.push({ from: r.id, to, type, viaReservation: true });
      }
      for (const from of collect(fedByT)) {
        if (groups.some(g => g.includes(from))) continue;
        out.push({ from, to: r.id, type, viaReservation: true });
      }
    }
  }
  return out;
}
