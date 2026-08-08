// ═══════════════════════════════════════════════════════════════════
// SEMESTER VIEW  (pure — no React, no I/O)
//
// The single answer to "what is in this semester, and in what order?".
//
// ── Why this exists ────────────────────────────────────────────────
//
// Three separate bugs shipped from the same shape: twelve call sites each
// re-deriving a term's contents from the raw maps, and each having to choose
// correctly between `placements` (courses only) and a combined view. SemRow
// chose right and SummerRow did not, so reservations vanished from summers.
// Six of nine ordering calls chose wrong, so any drop into a term holding a
// reservation silently rewrote its order.
//
// The problem was never that those choices were hard. It was that a choice
// existed at all, and the wrong answer looked right. A consumer asking what is
// in a term now has ONE thing to call, and there is no plausible-but-wrong
// alternative to reach for.
//
// ── The one boundary that stays ────────────────────────────────────
//
// `placements` remains courses-only, and the graduation audit, GPA and prereq
// chains keep reading it directly. That is deliberate and must not be
// "simplified" away: a reserved seat counts toward how many fit at the table
// and never toward how many guests have replied.
//
// The asymmetry is chosen, not accidental. Forgetting this module gives a
// LAYOUT bug — visible, annoying, cheap. Folding reservations into
// `placements` so layout came free would make forgetting give a CREDIT bug,
// telling a student they have graduated when they have not. The default fails
// in the cheap direction on purpose.
// ═══════════════════════════════════════════════════════════════════

import { getOrderedCourses, getSemStudySH } from "./planModel.js";
import { semesterOccupants, occupantCards } from "./reservations.js";

/**
 * @typedef {Object} SemesterView
 * @property {Object} occupants  id → semId, courses AND reservations
 * @property {Object} cards      id → card, courses AND reservations
 */

/**
 * Build the view once per state change; every query below reads it.
 *
 * Returns the inputs unchanged (same references) when there are no
 * reservations, so a plan without one costs nothing and downstream memos do
 * not invalidate.
 *
 * @returns {SemesterView}
 */
export function buildSemesterView({ placements, reservations, courseMap }) {
  return {
    occupants: semesterOccupants(placements, reservations),
    cards: occupantCards(courseMap, reservations),
  };
}

/**
 * The ids in a semester, in the order they are drawn.
 *
 * `semOrders` is a parameter rather than part of the view because a drop
 * computes against a HYPOTHETICAL order inside a state updater — the order it
 * is about to write, not the one on screen. Passing it explicitly is what lets
 * the same function serve both the render and the gesture, instead of the
 * gesture growing its own copy. That copy is what diverged before.
 */
export function cardIdsIn(semId, view, semOrders = {}) {
  return getOrderedCourses(semId, view.occupants, semOrders, view.cards);
}

/** The cards in a semester, resolved and in order. */
export function cardsIn(semId, view, semOrders = {}) {
  return cardIdsIn(semId, view, semOrders).map(id => view.cards[id]).filter(Boolean);
}

/**
 * A semester's study load.
 *
 * Reservations count: a fourth year that is entirely electives is exactly as
 * full as the department printed, not empty. This is TERM load — it is not the
 * credit anyone has earned, and nothing here reaches the degree.
 */
export function loadIn(semId, view, specialTermStartMap = {}, specialTermContMap = {}) {
  return getSemStudySH(semId, view.occupants, view.cards, specialTermStartMap, specialTermContMap);
}
