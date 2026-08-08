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
  const orderOf = (semId, orders) =>
    orders[semId] ?? getOrderedCourses(semId, gridPlacements, orders, gridCourseMap);

  // ── A reservation is what is being dragged ──────────────────────
  if (isReservationId(dragId)) {
    const from = reservations[dragId]?.semId;
    if (from !== targetSemId) {
      return { ...state, reservations: moveReservation(reservations, dragId, targetSemId) };
    }
    // Same term: a reorder, over the combined order so reservations and
    // courses share ONE sequence rather than two interleaved ones.
    const cur = orderOf(targetSemId, semOrders);
    const fi = cur.indexOf(dragId), ti = cur.indexOf(targetId);
    if (fi < 0 || ti < 0) return null;
    const next = [...cur];
    next.splice(fi, 1);
    next.splice(ti, 0, dragId);
    return { ...state, semOrders: { ...semOrders, [targetSemId]: next } };
  }

  // ── A course dropped ONTO a reservation answers it ──────────────
  if (isReservationId(targetId)) {
    const target = reservations[targetId];
    if (!target) return null;
    const semId = target.semId;

    // Coreq partners travel with the course, exactly as they do on any other
    // drop. Leaving them behind would split a pair the catalog requires
    // together — CS 2100 without CS 2101.
    const moving = [dragId, ...coreqPartners.filter(c => c !== dragId)];
    const nextPlacements = { ...placements };
    for (const id of moving) nextPlacements[id] = semId;

    // The course takes the card's position, so the term does not reshuffle at
    // the moment of filling.
    const cur = orderOf(semId, semOrders);
    const at = cur.indexOf(targetId);
    const rest = cur.filter(id => id !== targetId && !moving.includes(id));
    const nextOrder = at < 0
      ? [...rest, ...moving]
      : [...rest.slice(0, at), ...moving, ...rest.slice(at)];

    return {
      placements: nextPlacements,
      reservations: removeReservation(reservations, targetId),
      semOrders: { ...semOrders, [semId]: nextOrder },
    };
  }

  return null;   // course onto course — the caller's existing path
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
