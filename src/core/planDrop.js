// ═══════════════════════════════════════════════════════════════════
// PLAN DROP  (pure — no React, no I/O)
//
// What a drag-and-drop gesture does to plan state.
//
// This exists because the logic used to live inside a React handler as a
// sequence of setX calls, where it could not be tested — and three separate
// reservation bugs shipped and had to be reported by hand before anyone could
// see them. A gesture is a function from state to state; written that way it
// can be enumerated.
//
// Every case returns a COMPLETE next state, so a caller cannot apply half of
// one. That matters for filling: the card is removed and the course placed in
// the same commit, so one undo restores both.
// ═══════════════════════════════════════════════════════════════════

import { moveReservation, removeReservation, isReservationId } from "./reservations.js";
import { getOrderedCourses } from "./planModel.js";

/**
 * Drop a card onto another card.
 *
 * @param {object} state    { placements, reservations, semOrders }
 * @param {object} gesture  { dragId, targetId, targetSemId }
 * @param {object} ctx      { gridPlacements, gridCourseMap, coreqPartners }
 * @returns {object|null} next state, or null when the gesture means nothing
 */
export function dropOnCard(state, { dragId, targetId, targetSemId }, ctx = {}) {
  const { placements, reservations, semOrders } = state;
  if (!dragId || dragId === targetId) return null;

  const { gridPlacements = placements, gridCourseMap = {}, coreqPartners = [] } = ctx;

  // ALWAYS through getOrderedCourses, never the stored array directly. A stored
  // order can predate the cards now in the term — it is written by any drop,
  // including ones that happened before a plan was loaded — so reading it raw
  // yields a list missing the very ids being moved, indexOf returns -1, and the
  // gesture silently does nothing. getOrderedCourses reconciles it against what
  // is actually in the semester and appends anything the stored order missed.
  const orderOf = (semId, orders) =>
    getOrderedCourses(semId, gridPlacements, orders, gridCourseMap);

  // ── A reservation is what is being dragged ──────────────────────
  if (isReservationId(dragId)) {
    if (!reservations[dragId]) return null;
    const from = reservations[dragId].semId;

    // Same term: a reorder over the combined order, so reservations and courses
    // share ONE sequence rather than two interleaved ones.
    if (from === targetSemId) {
      const cur = orderOf(targetSemId, semOrders);
      const fi = cur.indexOf(dragId), ti = cur.indexOf(targetId);
      if (fi < 0) return null;
      const next = [...cur];
      next.splice(fi, 1);
      // A target that is not in the order (or no target at all) means the end
      // of the term rather than nothing happening.
      const at = ti < 0 ? next.length : next.indexOf(targetId);
      next.splice(at < 0 ? next.length : at, 0, dragId);
      return { ...state, semOrders: { ...semOrders, [targetSemId]: next } };
    }

    // Another term: move it AND place it where it was dropped. Moving without
    // touching the order left it at the end of the target term, which reads as
    // the drag having gone somewhere else.
    const nextReservations = moveReservation(reservations, dragId, targetSemId);
    const nextGrid = { ...gridPlacements, [dragId]: targetSemId };
    const fromOrder = orderOf(from, semOrders).filter(id => id !== dragId);
    const toOrder = getOrderedCourses(targetSemId, nextGrid, semOrders, gridCourseMap)
      .filter(id => id !== dragId);
    const ti = toOrder.indexOf(targetId);
    toOrder.splice(ti < 0 ? toOrder.length : ti, 0, dragId);

    return {
      ...state,
      reservations: nextReservations,
      semOrders: { ...semOrders, [from]: fromOrder, [targetSemId]: toOrder },
    };
  }

  // ── A course dropped ONTO a reservation ─────────────────────────
  //
  // Nothing special: it moves to that position, exactly as it would onto
  // another course. Dragging means the same thing wherever it lands, which is
  // the point of a reservation being an ordinary card — a gesture that
  // sometimes reorders and sometimes consumes the target would be two gestures
  // wearing one costume.
  //
  // Answering a reservation is a separate act with its own affordance;
  // fillReservation() in reservations.js is what it calls.
  return null;   // course onto anything — the caller's existing path
}

/**
 * Drop a card onto a semester (its empty space rather than another card).
 * Returns null for a course, which the caller already handles.
 */
export function dropOnSemester(state, { dragId, semId }) {
  if (!isReservationId(dragId)) return null;
  return { ...state, reservations: moveReservation(state.reservations, dragId, semId) };
}

/** Drop a card on the bank. For a reservation that is a delete. */
export function dropOnBank(state, { dragId }) {
  if (!isReservationId(dragId)) return null;
  return { ...state, reservations: removeReservation(state.reservations, dragId) };
}
