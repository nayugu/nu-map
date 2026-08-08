// ═══════════════════════════════════════════════════════════════════
// SLOT MODEL  (pure — no React, no I/O)
//
// A slot is a RESERVATION ON A CARD POSITION: the department's claim that a
// course of some kind belongs in this semester, with a credit value and a
// constraint. "Khoury Elective", "Science Requirement", "CS 4530 or 4535".
//
// Not a minor case. 51% of all credit in an undergraduate sample plan is a
// slot rather than a named course, 32% of study terms hold nothing else, and
// the share climbs through the degree (Y1 34% → Y4 70%) because a degree gets
// LESS prescribed, not more.
//
// ── Where slots live, and why not anywhere else ────────────────────
//
// Two designs were tried and both were wrong, in opposite directions.
//
// Putting slots INTO `placements` with a synthetic entry in `courseMap` makes
// every id-keyed consumer work for free — which is how repeat instances work,
// so it looks like precedent. It is not: `CS2500#2` genuinely IS a course, and
// a slot is not. Every consumer that assumes courseMap holds catalog courses
// would quietly become wrong, and the worst of them counts credit toward
// graduation for a course nobody has chosen.
//
// Keeping slots as a wholly PARALLEL list means every consumer must learn
// about them. Summer semesters render through a different component than
// fall/spring, so teaching one taught half the app and slots silently vanished
// from the other — which is exactly what happened.
//
// The codebase already answers this. `effectivePlacements` is real placements
// plus virtual entries for substitutions, derived in a useMemo and never
// stored; consumers asking "what did the student place?" read `placements`,
// and consumers asking "what is satisfied?" read the derived view. So:
//
//   STORE     `slots`, minimal and authoritative
//   DERIVE    a grid view — placements + unfilled slots, courseMap + slot cards
//   CHOOSE    the view that matches the question you are asking
//
// The semester grid draws the derived view, so ordering, drag, occupancy
// counts, empty-slot maths and term load all work unchanged in BOTH renderers.
// Everything about the DEGREE — requirement satisfaction, graduation credit,
// prereq chains, grades, the audit, MCP — reads the raw maps and cannot see a
// slot at all. The dangerous mistake is structurally impossible rather than
// prevented by remembering to exclude it in eight places.
//
// ── One record, two stages ─────────────────────────────────────────
//
// A filled slot and an unfilled slot are the same object. `filledBy` is the
// transition, and keeping the record after filling buys three things: delete
// the course later and the slot comes back rather than leaving a hole where
// the department told you something belongs; the card can show which
// requirement it was chosen against; and re-applying a template stays
// idempotent because the slot is still there to recognise.
// ═══════════════════════════════════════════════════════════════════

/**
 * Slot ids are prefixed so `isSlotId` is a cheap, total test — no lookup, and
 * no chance of colliding with a course id (which is always SUBJECT + number)
 * or a repeat instance ("CS2500#2", which is why `#` must not appear here).
 */
export const SLOT_PREFIX = "~slot:";

export const isSlotId = (id) => typeof id === "string" && id.startsWith(SLOT_PREFIX);

/**
 * A slot's id encodes where the TEMPLATE put it, not where it is now.
 *
 * That is deliberate: it is provenance, not position. Move a slot to another
 * semester and re-apply the same template, and the slot is recognised rather
 * than duplicated. `semId` on the record is the live position.
 */
export function slotId(originSemId, label, ordinal) {
  const slug = String(label).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${SLOT_PREFIX}${originSemId}:${slug}:${ordinal}`;
}

/** Slots with no course chosen yet — the only ones the grid draws as slots. */
export function unfilledSlots(slots) {
  return Object.values(slots ?? {}).filter((s) => s && !s.filledBy);
}

/**
 * The grid's placement view: real placements plus a position for every
 * unfilled slot.
 *
 * Returns `placements` unchanged (same reference) when there is nothing to
 * add, so the memo downstream stays cheap — the same courtesy
 * applySubstitutions extends.
 */
export function withSlots(placements, slots) {
  const open = unfilledSlots(slots);
  if (!open.length) return placements;
  const out = { ...placements };
  for (const s of open) if (s.semId) out[s.id] = s.semId;
  return out;
}

/**
 * The grid's card view: courseMap plus a card-shaped entry per unfilled slot.
 *
 * `sh` carries the catalog's credit value so a term reads the load the
 * department printed — a fourth year that is entirely electives is exactly
 * full, not empty. This is safe ONLY because the map is derived: nothing that
 * totals credit toward the degree ever receives it.
 */
export function withSlotCards(courseMap, slots) {
  const open = unfilledSlots(slots);
  if (!open.length) return courseMap;
  const out = { ...courseMap };
  for (const s of open) {
    out[s.id] = {
      id: s.id,
      isSlot: true,
      slot: s,
      // `code` is what card headers render; the catalog's own wording is the
      // only thing telling a student what belongs here.
      code: s.label,
      title: "",
      subject: "", number: "",
      sh: s.sh ?? 0,
      nuPath: [],
      prereqs: null, coreqs: null,
      sections: [],
    };
  }
  return out;
}

// ── Transitions ────────────────────────────────────────────────────

/** Move an unfilled slot to another semester. Filled slots follow their course. */
export function moveSlot(slots, id, semId) {
  const s = slots?.[id];
  if (!s || s.filledBy) return slots;
  return { ...slots, [id]: { ...s, semId } };
}

/**
 * Record that `courseId` fills this slot.
 *
 * Does NOT place the course — the caller does that through the ordinary
 * placement path, so a filled slot is an ordinary course everywhere that
 * matters. This only remembers which reservation it answered.
 */
export function fillSlot(slots, id, courseId) {
  const s = slots?.[id];
  if (!s) return slots;
  return { ...slots, [id]: { ...s, filledBy: courseId } };
}

/** Give the reservation back, without touching the course's placement. */
export function emptySlot(slots, id) {
  const s = slots?.[id];
  if (!s?.filledBy) return slots;
  return { ...slots, [id]: { ...s, filledBy: null } };
}

/** Drop a slot entirely. */
export function removeSlot(slots, id) {
  if (!slots?.[id]) return slots;
  const out = { ...slots };
  delete out[id];
  return out;
}

/**
 * Un-fill every slot whose course is no longer in the plan.
 *
 * A course removed from the plan takes its answer with it, and the department
 * still says something belongs there — so the reservation comes back rather
 * than leaving a hole. Callers run this after any placement change.
 */
export function reopenOrphanedSlots(slots, placements) {
  let changed = false;
  const out = {};
  for (const [id, s] of Object.entries(slots ?? {})) {
    if (s?.filledBy && !placements[s.filledBy]) {
      out[id] = { ...s, filledBy: null };
      changed = true;
    } else {
      out[id] = s;
    }
  }
  return changed ? out : slots;
}

// ── Questions the UI asks ──────────────────────────────────────────

/** The slot a placed course was chosen for, or null. Drives the provenance chip. */
export function provenanceOf(slots, courseId) {
  for (const s of Object.values(slots ?? {})) {
    if (s?.filledBy === courseId) return s;
  }
  return null;
}

/**
 * May this course fill this slot?
 *
 * Strictness follows the CONFIDENCE OF THE SOURCE, which is the whole rule:
 *
 *   exact     the catalog printed the codes  → we know      → closed
 *   inferred  we matched a requirement       → we may be wrong → open, suggested
 *   open      nothing was stated             → nothing to know → open
 *
 * Inferring which requirement a slot means is a guess, and a guess has no
 * business closing a door. The catalog printing two course codes is not.
 *
 * Substitutions widen even the closed case, which is what keeps this
 * consistent with a planner that "warns but doesn't stop": an advisor-approved
 * swap is recorded once and then works everywhere, instead of being a silent
 * mismatch or a blocked student.
 */
export function canFill(slot, courseId, substitutions = []) {
  if (!slot) return false;
  if (slot.constraint !== "exact") return true;
  const allowed = new Set(slot.candidates ?? []);
  if (allowed.has(courseId)) return true;
  return substitutions.some(({ from, to }) => from === courseId && allowed.has(to));
}

/** Credit hours of the unfilled slots in a semester — term load only, never the degree. */
export function semesterSlotSH(slots, semId) {
  let n = 0;
  for (const s of unfilledSlots(slots)) if (s.semId === semId) n += s.sh ?? 0;
  return n;
}
