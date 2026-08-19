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

/**
 * The option groups of a card that names its courses, made safe to iterate.
 *
 * `options` is a list of GROUPS, every member of a group required together —
 * `PSYC 3200 or PT 5410 and PT 5411` is `[["PSYC3200"],["PT5410","PT5411"]]`.
 * It arrives from scraped data and from restored plans, so holes, empty groups
 * and non-arrays are real inputs rather than hypotheticals.
 *
 * One implementation because there were four, and the fourth was missing its
 * guard: `options: [null]` threw. Every consumer asks the identical question,
 * so it is answered in exactly one place.
 *
 * @param {string[][]|null} groups
 * @param {object|null} [courseMap]  when given, a group naming a course the
 *   catalog does not have is dropped — it can never be chosen. 13.2% of prereq
 *   atoms name renumbered courses, so this is not theoretical.
 * @returns {string[][]|null} null when nothing usable is left
 */
export function cleanOptionGroups(groups, courseMap = null) {
  if (!Array.isArray(groups)) return null;
  const out = groups.filter(g =>
    Array.isArray(g) && g.length
    && g.every(id => typeof id === "string" && id
      && (!courseMap || courseMap[id])));
  return out.length ? out.map(g => [...g]) : null;
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

  // An EMPTY title carries no identity, so it cannot be matched on. Scraped
  // sections with no title exist, and letting a blank match a blank hands the
  // card an arbitrary untitled section's courses — wrong information, where the
  // rule is to degrade to none.
  // Compared normalised on BOTH sides. Trimming only the stored half would make
  // a scrape that gained a trailing space look like a renamed requirement.
  const norm = (s) => (typeof s === "string" ? s.trim() : "");
  const title = norm(want.title);
  if (!title) return null;

  // The index is only a hint, but it must come back as a NUMBER. A stored "0"
  // resolves fine here and then fails `typeof target === "number"` downstream,
  // where a non-number means "a sentinel that admits any course" — so a
  // correctly bound card would silently start offering the whole catalog.
  const idx = Number(want.index);
  const at = Number.isInteger(idx) ? sections[idx] : undefined;
  if (at && norm(at.title) === title) return { index: idx, section: at };

  const found = sections.findIndex(s => norm(s.title) === title);
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
      // The requirement this card stands for, when the plan named one. A course
      // shows its title here, so a card that knows it is a Khoury Approved
      // Elective should say so rather than leave the line blank.
      //
      // The STORED title, not a re-resolved one: it is what the department's
      // plan meant, it needs no program data to read, and a section renamed
      // since is a cosmetic staleness rather than a wrong claim. Anything that
      // ACTS on the requirement still goes through `resolveRequirement`.
      title: r.requirement?.title ?? "",
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

/**
 * ── How a placeholder is NAMED, on every surface ────────────────────
 *
 * A reservation carries two English phrases for one thing: the plan's own
 * wording (`code`, from plan.json — "Concentration Course") and the requirement
 * it stands for (`title`, from the catalog — what the requirements tree prints).
 * Every surface that draws a placeholder has to choose between them, and until
 * these two functions existed each chose differently:
 *
 *   - the requirements tree translated the requirement title → 安全必修课程
 *   - the planner card left the plan's label in English → "Security Required
 *     Course", so a student saw one requirement in two languages at once
 *   - the sample-plan preview translated the plan's LABEL, which the engine
 *     renders differently again → 保安课程, "security guard course"
 *
 * The last one is the important failure: not a worse translation, a different
 * SOURCE STRING. Two phrases that mean the same thing to a reader do not
 * translate to the same words, so agreement between surfaces is only possible if
 * they translate the identical string. Hence one rule, in core, where every
 * renderer can reach it:
 *
 *   `reservationNameSource` — the string to translate and show as the NAME.
 *      Prefers the requirement's title, because that is what the requirements
 *      tree translates, and matching it is the whole point.
 *   `reservationSubline`    — the plan's own English wording, kept underneath.
 *      A placeholder has no course code, so this phrase is the only handle a
 *      student has when they search Banner or ask an advisor what fills the
 *      slot. Dropped when it is just the name again.
 *
 * Pure and hook-free on purpose: the translation itself is a React hook in the
 * UI, so core decides WHAT to translate and what to print beside it, never how.
 */
export const reservationNameSource = (card) =>
  (card?.title || card?.code || "");

/**
 * @param {{code?: string, title?: string}} card
 * @param {string} [translatedName]  the rendered name — already translated
 * @returns {string} the second line, or "" when it would only repeat the first
 */
export function reservationSubline(card, translatedName) {
  const label = card?.code ?? "";
  if (!label || !translatedName) return "";
  // Case- and plural-insensitive: "Khoury Approved Elective" against "Khoury
  // Approved Electives" is one phrase printed twice, which is exactly the noise
  // this line exists to avoid. When the reader's locale IS the catalog's, the
  // translation equals the source and nothing shows.
  const norm = (s) => s.toLowerCase().replace(/s\b/g, "").replace(/[^a-z0-9]/g, "");
  return norm(label) === norm(translatedName) ? "" : label;
}

/**
 * A placeholder's choices, written so the precedence is unambiguous.
 *
 * ── Why the card's own string will not do ───────────────────────────
 *
 * A card says `PHYS 1161 and PHYS 1162 and PHYS 1163 or PHYS 1191 and PHYS 1192 and
 * PHYS 1193`, and read aloud that is six courses joined by a coin-flip: nothing in it says
 * whether the `or` splits the whole list or only the pair beside it. It is two lab sequences
 * and you take one of them, which is not recoverable from the sentence.
 *
 * A card also TRUNCATES — `MAX_TITLED_OPTIONS` shows three and appends `(+12)` — because a
 * card is one line in a grid. A hover has room, so it shows every option and the marker
 * stops being needed. `(+12)` was the most confusing thing on these cards precisely because
 * the number counted something the reader could not see.
 *
 * ── Brackets only where they DISAMBIGUATE ───────────────────────────
 *
 * Around a group of several, never around a lone course. `(MUSC 2101) or (MUSC 2150)` is
 * punctuation pretending to be information, and this line already has too much of that.
 * With one group there is no `or` at all, so nothing needs bracketing either.
 *
 * @param {string[][]} groups  option groups: take every course in ONE group
 * @returns {string} "" when there is nothing a reader would not already know
 */
/**
 * A card's option groups, wherever they are on it.
 *
 * `occupantCards` builds the card view field by field and does not copy `options` up — it
 * carries the whole `reservation` instead, so the groups live one level down. A card built
 * some other way may carry them directly. Reading both here means a caller cannot pick the
 * wrong one, which is exactly what happened: the hover fell back to the card's truncated
 * wording on every planner card, because it looked only at `card.options` and found nothing.
 */
export function cardOptionGroups(card) {
  const g = card?.reservation?.options ?? card?.options;
  return Array.isArray(g) ? g : [];
}

export function optionGroupsText(groups) {
  const gs = (groups ?? []).filter(g => Array.isArray(g) && g.length);
  if (!gs.length) return "";
  const spaced = (id) => String(id).replace(/([A-Za-z])(\d)/g, "$1 $2");
  const one = (g) => g.map(spaced).join(" and ");
  if (gs.length === 1) return one(gs[0]);
  return gs.map(g => (g.length > 1 ? `(${one(g)})` : one(g))).join(" or ");
}

/**
 * How much of the plan is still undecided, as a plain count.
 *
 * The requirements panel reads `placements`, so a section shows `0/2` whether
 * the student has ignored it or reserved both cards for it. An advisor reads
 * the first meaning. This says the second, and it is deliberately the *dumbest*
 * statement available: a count of cards and their credit hours.
 *
 * Everything more precise was measured and rejected. Marking the individual
 * sections a card is bound to would cover 17.7% of cards — a median of 2
 * sections out of 11 per plan — while 41.7% stay ambiguous and 39.4% are free
 * electives that belong to no section at all. It would add a per-section visual
 * state that can be wrong (34 sections in the corpus are claimed by more cards
 * than they hold) to say less. A count covers 100% and cannot be wrong.
 *
 * Not a degree number and never presented as one: it counts what has NOT been
 * decided, which is the opposite of progress.
 *
 * @returns {{cards: number, sh: number}}
 */
export function reservedTotals(reservations) {
  let cards = 0, sh = 0;
  for (const r of Object.values(reservations ?? {})) {
    if (!r?.id) continue;
    cards += 1;
    const n = Number(r.sh);
    if (Number.isFinite(n) && n > 0) sh += n;
  }
  return { cards, sh };
}

/** Credit hours reserved in one semester — term load only, never the degree. */
export function semesterReservedSH(reservations, semId) {
  let n = 0;
  for (const r of Object.values(reservations ?? {})) {
    if (r?.semId === semId) n += r.sh ?? 0;
  }
  return n;
}
