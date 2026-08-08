// ═══════════════════════════════════════════════════════════════════
// RESERVATIONS  (pure — no React, no I/O)
//
// A reservation is a card in a semester that has not been given a course yet:
// "Khoury Elective", "MATH elective", "General Elective". Half the credit in a
// department's published plan is one of these, and in the later years it is
// most of it — Computer Science and Mathematics year 4 is four real courses and
// four reservations.
//
// ── They are ordinary cards ────────────────────────────────────────
//
// A reservation occupies a position in a term, carries credit hours, drags
// between terms, reorders within one, and is deleted like anything else. It is
// not an annotation about a term; it is an occupant of it. Everything that
// lays out or exports a semester should treat it exactly like a course, which
// is why those consumers read ONE combined view (see `semesterOccupants`) and
// need no cases for it at all.
//
// ── Except for one question, which they must never answer ──────────
//
// A reserved seat counts toward how many people fit at the table. It does not
// count toward how many guests have replied. Same object, two questions, and
// answering the second with the first is how a student is told they have
// satisfied a requirement they have not chosen a course for.
//
// So reservations are stored in their OWN map, never in `placements`:
//
//   asks "what is in this semester?"     reads the combined view — gets both
//   asks "what counts toward my degree?" reads `placements` — cannot see one
//
// Sixteen modules read `placements`, and roughly half ask the second question:
// the audit, credit totals, GPA, prereq chains. Keeping reservations out of
// that map makes the wrong answer the one you have to go out of your way to
// produce, rather than the one you get by forgetting.
//
// ── Filling one is a replacement, not a state change ───────────────
//
// Choosing a course for a reservation deletes it and places the course. There
// is no "filled" flag, no link back to the course, and nothing to repair when
// the course later moves or is removed.
//
// The alternative — leave the reservation and work out whether its requirement
// is satisfied — reads well until two reservations share a requirement. Click
// the year 4 "Khoury Elective", pick a course, and the rule retires whichever
// is earliest, so the year 3 card disappears and the one actually clicked
// stays. Deleting the card the student acted on is both simpler and correct.
// ═══════════════════════════════════════════════════════════════════

/** A reservation id is prefixed so it can never collide with a course id. */
export const RESERVATION_PREFIX = "~res:";

export const isReservationId = (id) =>
  typeof id === "string" && id.startsWith(RESERVATION_PREFIX);

let counter = 0;

/**
 * @typedef {Object} Reservation
 * @property {string} id
 * @property {string} semId
 * @property {string} label     the catalog's wording, or the student's
 * @property {number} [sh]      credit hours; counts toward TERM load only
 * @property {{index: number, title: string}} [requirement]
 *   which requirement this stands for. See `resolveRequirement` for why both
 *   halves are stored.
 * @property {string} [origin]
 *   where this card came from, if a published plan put it here. Provenance,
 *   NOT identity: it survives the student dragging the card to another term,
 *   so re-applying the same plan recognises it rather than adding a second.
 */

/**
 * Make a reservation. `id` is generated rather than derived from position or
 * label, so nothing about it can drift when the catalog is re-scraped or when
 * two cards in one term happen to be worded the same.
 */
export function createReservation({ semId, label, sh = null, requirement = null, origin = null }) {
  return {
    id: `${RESERVATION_PREFIX}${Date.now().toString(36)}${(counter++).toString(36)}`,
    semId,
    label: String(label ?? "").trim() || "Elective",
    ...(sh == null ? {} : { sh }),
    ...(requirement ? { requirement } : {}),
    ...(origin ? { origin } : {}),
  };
}

/**
 * Where a published plan's cell sits, as a key that survives being moved.
 *
 * Built from POSITION — plan, academic year, term type, and which of the
 * identical cells in that term it is — never from the label. A label-derived
 * key collides the moment a department writes "SOCL elective" and "SOCL
 * Elective" in one term, which the previous design did, silently losing one of
 * the two cards in eleven terms across the corpus.
 */
export const originKey = (planLabel, yearIndex, termType, ordinal) =>
  `${planLabel}|${yearIndex}.${termType}.${ordinal}`;

/** The provenance keys already present, so re-applying can skip them. */
export function originsOf(reservations) {
  const out = new Set();
  for (const r of Object.values(reservations ?? {})) if (r?.origin) out.add(r.origin);
  return out;
}

/** Move one to another semester. Identical to moving a course. */
export function moveReservation(reservations, id, semId) {
  const r = reservations?.[id];
  return r ? { ...reservations, [id]: { ...r, semId } } : reservations;
}

/** Drop one. */
export function removeReservation(reservations, id) {
  if (!reservations?.[id]) return reservations;
  const out = { ...reservations };
  delete out[id];
  return out;
}

/**
 * Give a reservation a course.
 *
 * Returns the caller's next state rather than performing it, so the placement
 * and the removal commit together and undo together — a student who changes
 * their mind should get the card back in one step, not find the course gone
 * and the reservation still missing.
 */
export function fillReservation(reservations, id, courseId) {
  const r = reservations?.[id];
  if (!r) return null;
  return { reservations: removeReservation(reservations, id), courseId, semId: r.semId };
}

/**
 * Which requirement a reservation stands for, re-checked against the program
 * as it is TODAY.
 *
 * The index alone is not safe to trust. It points into `requirementSections`,
 * which is re-scraped monthly, so an inserted or reordered section silently
 * turns index 7 into a different requirement — and the card would go on
 * offering courses for something else without anything looking wrong.
 *
 * So the title is stored beside it and the two must still agree. If they do
 * not, the title is searched for; if that fails too, the reservation keeps its
 * label and simply stops suggesting. Degrade to less information, never to
 * wrong information.
 *
 * @returns {{index: number, section: object}|null}
 */
export function resolveRequirement(reservation, programData) {
  const want = reservation?.requirement;
  const sections = programData?.requirementSections;
  if (!want || !sections?.length) return null;

  const at = sections[want.index];
  if (at && at.title === want.title) return { index: want.index, section: at };

  const found = sections.findIndex(s => s.title === want.title);
  return found >= 0 ? { index: found, section: sections[found] } : null;
}

/**
 * The combined "what is in this semester" view — real placements plus every
 * reservation.
 *
 * This is what the grid, ordering, drag, term load and export all read, and it
 * is the only place the two are mixed. Returns `placements` unchanged (same
 * reference) when there is nothing to add, so a memo downstream stays cheap.
 */
export function semesterOccupants(placements, reservations) {
  const list = Object.values(reservations ?? {});
  if (!list.length) return placements;
  const out = { ...placements };
  for (const r of list) if (r?.semId) out[r.id] = r.semId;
  return out;
}

/**
 * The card view: `courseMap` plus a card-shaped entry per reservation.
 *
 * `sh` is carried so a term reads the load the department printed — a fourth
 * year that is entirely electives is exactly full, not empty. That is only
 * safe because this map is derived and nothing totalling degree credit ever
 * receives it.
 */
export function occupantCards(courseMap, reservations) {
  const list = Object.values(reservations ?? {});
  if (!list.length) return courseMap;
  const out = { ...courseMap };
  for (const r of list) {
    out[r.id] = {
      id: r.id,
      isReservation: true,
      reservation: r,
      // What card headers render: the catalog's own wording is the only thing
      // telling a student what belongs here.
      code: r.label,
      title: "",
      subject: "", number: "",
      sh: r.sh ?? 0,
      // Card rendering reads `color` unguarded (it derives an HSL glow from
      // it), so a reservation needs one. Neutral on purpose: a subject colour
      // would claim a department the student has not chosen.
      color: "#94a3b8",
      // The full course shape, not a subset. Card rendering reads several of
      // these without guarding — `color.slice()` was the one that threw — and
      // a card missing a field is a crash waiting for whichever consumer
      // touches it next. Matching the shape exactly means every existing
      // consumer works on a reservation with no cases for it, which is the
      // whole point of it being an ordinary card.
      desc: "",
      shMin: null, shMax: null,
      repeatable: false, repeatMax: null, repeatMaxSH: null,
      scheduleType: "", termHistory: {}, birthTermCode: null,
      terms: [], isCps: false,
      nuPath: [], attributes: [],
      prereqs: null, coreqs: null,
      sections: [],
    };
  }
  return out;
}

/** Credit hours reserved in one semester — term load only, never the degree. */
export function semesterReservedSH(reservations, semId) {
  let n = 0;
  for (const r of Object.values(reservations ?? {})) {
    if (r?.semId === semId) n += r.sh ?? 0;
  }
  return n;
}
