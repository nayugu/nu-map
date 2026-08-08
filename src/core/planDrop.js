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
/**
 * Where a card lives, whichever map that is.
 *
 * This is the whole trick. A course's position is a value in `placements`, a
 * reservation's is a field on its record in `reservations` — but a DROP does
 * not care which. Expressing "put this card in this term" once means every
 * combination below is the same code, so course-course and
 * reservation-reservation cannot drift apart the way they did when each had
 * its own branch.
 */
function place(state, id, semId) {
  if (isReservationId(id)) {
    return { ...state, reservations: moveReservation(state.reservations, id, semId) };
  }
  return { ...state, placements: { ...state.placements, [id]: semId } };
}

/** Which term a card is in, whichever map holds it. */
export function semOf(state, id) {
  return isReservationId(id) ? state.reservations[id]?.semId : state.placements[id];
}

/** Does this card exist at all? */
const exists = (state, id) =>
  isReservationId(id) ? !!state.reservations[id] : !!state.placements[id];

/**
 * Drop a card onto another card.
 *
 * One behaviour for all four combinations of course and reservation, because
 * they are the same gesture on the same kind of object:
 *
 *   same term       reorder — the dragged card takes the target's position
 *   different term  SWAP    — they exchange terms AND positions
 *
 * The swap is what the planner has always done for course-onto-course, and
 * matching it is the entire point: a reservation that merely MOVED while a
 * course would have swapped is a reservation that does not behave like a card.
 *
 * @param {object} state    { placements, reservations, semOrders }
 * @param {object} gesture  { dragId, targetId, targetSemId }
 * @param {object} ctx      { gridPlacements, gridCourseMap, coreqPartners }
 * @returns {object|null} next state, or null when the gesture means nothing
 */
export function dropOnCard(state, { dragId, targetId, targetSemId }, ctx = {}) {
  const { semOrders } = state;
  if (!dragId || dragId === targetId) return null;
  if (!exists(state, dragId)) return null;

  const { gridPlacements = state.placements, gridCourseMap = {}, coreqPartners = [] } = ctx;

  // ALWAYS through getOrderedCourses, never a stored array directly. A stored
  // order is written by any drop and can predate the cards now in the term, so
  // reading it raw yields a list missing the ids being moved — indexOf returns
  // -1 and the gesture silently does nothing.
  const orderIn = (semId, grid) => getOrderedCourses(semId, grid, semOrders, gridCourseMap);

  const from = semOf(state, dragId);
  const moving = [dragId, ...coreqPartners.filter(c => c !== dragId && !isReservationId(c))];

  // ── Same term: a reorder ────────────────────────────────────────
  if (from === targetSemId) {
    const cur = orderIn(targetSemId, gridPlacements);
    const fi = cur.indexOf(dragId);
    const ti = cur.indexOf(targetId);
    const rest = cur.filter(id => !moving.includes(id));

    // An unknown target means the end of the term, never "do nothing" — a
    // silently ignored drag reads as the app being broken rather than a rule
    // being applied.
    if (ti < 0) {
      return { ...state, semOrders: { ...semOrders, [targetSemId]: [...rest, ...moving] } };
    }

    // WHICH SIDE of the target to land on depends on the direction of travel.
    // Dragging BACKWARD (from after the target) lands before it; dragging
    // FORWARD lands after it. Always inserting before is why a forward drag did
    // nothing at all: removing the card first shifts everything left by one, so
    // "before the target" is exactly where it started. Backward drags worked,
    // which made it look like a per-semester quirk rather than one rule with a
    // missing case.
    let at = rest.indexOf(targetId);
    if (fi >= 0 && fi < ti) at += 1;

    return { ...state, semOrders: { ...semOrders, [targetSemId]: [
      ...rest.slice(0, at), ...moving, ...rest.slice(at),
    ] } };
  }

  // ── Different terms: a swap ─────────────────────────────────────
  const fromOrder = orderIn(from, gridPlacements);
  const toOrder   = orderIn(targetSemId, gridPlacements);
  const fi = fromOrder.indexOf(dragId);
  const ti = toOrder.indexOf(targetId);

  let next = state;
  for (const id of moving) next = place(next, id, targetSemId);
  // The target comes back the other way, but only if it is a real card. A drop
  // on a term's empty space has no target to exchange with.
  const swapping = targetId && exists(state, targetId);
  if (swapping) next = place(next, targetId, from);

  const nf = fromOrder.filter(id => !moving.includes(id) && id !== targetId);
  if (swapping) nf.splice(Math.min(Math.max(fi, 0), nf.length), 0, targetId);

  const nt = toOrder.filter(id => !moving.includes(id) && id !== targetId);
  nt.splice(Math.min(ti < 0 ? nt.length : ti, nt.length), 0, ...moving);

  return { ...next, semOrders: { ...semOrders, [from]: nf, [targetSemId]: nt } };
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
