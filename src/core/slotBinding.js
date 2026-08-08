// ═══════════════════════════════════════════════════════════════════
// SLOT BINDING  (pure — no React, no I/O)
//
// Answers the question a slot cannot answer for itself: "which requirement is
// this reservation actually for, and therefore what may fill it?"
//
// ── Why the slot's own words cannot be trusted ─────────────────────
//
// The Sample Plan of Study and the Program Requirements tables are two
// different prose surfaces written by the same department, and they do not
// agree. Across the corpus 9,629 placeholder cells are worded 1,353 distinct
// ways, and the mismatch is not cosmetic:
//
//   Computer Science and Mathematics, BS
//     plan cell     "Computing and social issues"
//     requirement   section titled "Supporting Course"
//
//   Computer Science, BSCS  — the SAME requirement, same ten courses
//     plan cell     "Computing and Social Issues"
//     requirement   section titled "Computing and Social Issues"
//
// One program's plan names the requirement and the other's describes it, and
// nothing in either document says which. A matcher keyed on wording gets the
// second program right, the first program wrong, and cannot tell the two
// situations apart. So wording is a HINT here and never a decision.
//
// ── What decides instead: what is left over ────────────────────────
//
// A published plan and a published requirement list describe one degree twice.
// Everything the plan names outright is checked off against the requirements;
// whatever demand remains is, by construction, exactly what the plan's
// placeholders stand for. CS and Math closes to the credit hour:
//
//   Khoury Approved Electives    8 SH   ←  2 × "Khoury Elective"
//   Mathematics Electives       12 SH   ←  2 × "MATH elective" + 1 × "Math elective"
//   Supporting Course          1 course ←  1 × "Computing and social issues"
//   general electives           28 SH   ←  7 × "General Elective"
//                              ─────                              ─────
//                               52 SH                              52 SH
//
// Note what identifies the hard one. Three of the four have usable wording;
// "Computing and social issues" is identified because it is the only thing
// left standing once the other three are accounted for. Elimination is not a
// tie-breaker bolted onto text matching — it is the mechanism, and text merely
// narrows the field it works over.
//
// ── This is elimination, not assignment ────────────────────────────
//
// The tempting design is a greedy pass: take the most confident slot, assign
// it, consume that requirement's capacity, move on. It commits — an early
// choice cannot be revisited when it strands the rest — and worse, in this
// corpus "confidence" comes mostly from wording, so the least reliable
// evidence would make the earliest irreversible decision.
//
// So nothing is ever assigned. Each slot holds a DOMAIN of requirements it
// could still be for, and the only operation is removing a value that has been
// proven impossible. That makes the fixpoint independent of the order slots
// are visited in — there is no "start here" to get wrong — and it makes a
// half-solved problem a legitimate output rather than a failure.
//
// A domain of one is a forced binding. A domain of three is a slot whose
// picker offers the union of three requirements. That is the whole reason this
// approach is safe: the cost of ambiguity is a longer list, not a wrong answer,
// so the system can afford to admit more than it can prove.
//
// ── Where the shortfall comes from ─────────────────────────────────
//
// Not from re-deriving it here. `allocateSections` in gradRequirements.js
// already consumes placed courses against requirements — it is what the
// graduation audit runs on — so obligations are read off ITS result. A second
// allocator would be a second opinion, and the two would drift; reading the
// audit's own numbers means a slot binds to precisely the requirement the
// audit reports as unmet, and stays consistent with it for free.
//
// Alignment with the audit is taken at SECTION level only, never deeper:
// `normalizePooledSection` reshapes a section's children before allocating, so
// a node-by-node walk of the two trees in parallel would silently mismatch.
// Sections themselves map one-to-one and are safe.
//
// Section granularity is also what the data wants. Every residual requirement
// observed across the corpus is a whole section — "Khoury Approved Electives",
// "Supporting Course", "Presentation Requirement", "Science Requirement" —
// because a catalog section already IS the unit of "one kind of thing".
// ═══════════════════════════════════════════════════════════════════

import { specForNode, specIsEmpty, courseEligible, emptySpec } from "./programEligibility.js";
import { allocateSections } from "./gradRequirements.js";
import { unfilledSlots } from "./slotModel.js";

/**
 * Credit value assumed for one course when a requirement counts courses rather
 * than hours and nothing better can be worked out. A parameter rather than a
 * constant: it is Northeastern's standard, not a fact about degrees.
 */
const DEFAULT_UNIT_SH = 4;

/**
 * The general-elective bucket's identity. It is not a catalog section — no
 * program prints one — so it cannot collide with a real section key.
 */
export const GENERAL_ELECTIVE_KEY = "~general";

/** A required concentration the student has not chosen yet. Also not a section. */
export const CONCENTRATION_KEY = "~concentration";

/**
 * @typedef {Object} Obligation
 * @property {string} key          stable identity: section title + ordinal
 * @property {string} title        the department's own wording, for display
 * @property {EligibleSpec} spec   courses that answer it; empty = anything goes
 * @property {"credits"|"units"} kind
 * @property {number} shortfallSH  credit hours still unmet, given what is placed
 * @property {number} [units]      courses still unmet, when kind is "units"
 * @property {"section"|"concentration"|"general"} origin
 * @property {boolean} [derived]   true when the demand was inferred, not stated
 */

/**
 * Every requirement a slot could stand for, with how much of it is still unmet.
 *
 * @param {object|null} programData      a parsed program (requirementSections, …)
 * @param {object} ctx
 * @param {Set<string>} ctx.placedSet    course keys already placed
 * @param {object} ctx.courseMap         id → course, for credit values
 * @param {object|null} [ctx.concentration]  the chosen concentration SECTION, if any
 * @param {number} [ctx.defaultUnitSH]
 * @returns {Obligation[]} only those with something still unmet
 */
export function obligationsOf(programData, {
  placedSet = new Set(),
  courseMap = {},
  concentration = null,
  defaultUnitSH = DEFAULT_UNIT_SH,
} = {}) {
  const sections = programData?.requirementSections ?? [];
  const all = concentration ? [...sections, concentration] : sections;
  if (!all.length && !programData?.generalElectiveSH) return [];

  // One allocation pass, the same one the graduation panel runs.
  const alloc = allocateSections(all, placedSet, new Set(), courseMap);

  const out = [];
  const seenTitle = new Map();
  let statedDemand = 0;

  all.forEach((section, i) => {
    const title = section.title ?? "";
    const ord = seenTitle.get(title) ?? 0;
    seenTitle.set(title, ord + 1);

    const spec = specForNode(section);
    const short = shortfallOf(alloc[i]);
    const unitSH = typicalSH(spec, courseMap, defaultUnitSH);
    const shortfallSH = short.kind === "credits" ? short.sh : short.units * unitSH;
    statedDemand += demandOf(alloc[i], unitSH);

    if (shortfallSH <= 0) return;
    out.push({
      key: `${title}#${ord}`,
      title,
      spec,
      kind: short.kind,
      shortfallSH,
      ...(short.kind === "units" ? { units: short.units } : {}),
      origin: section === concentration ? "concentration" : "section",
    });
  });

  // ── A concentration that is required but not yet chosen ──────────
  //
  // 51 undergraduate programs require one, and their plans reserve terms for
  // it — Computer Science BSCS spends 16 SH on four "Concentration Course"
  // cells. Until the student picks, no single concentration's requirements
  // apply, so there is nothing for those slots to bind to and they float
  // through every OTHER requirement's domain instead, which is far worse than
  // leaving them alone: four unbindable slots were enough to make the
  // Presentation, Science and Mathematics requirements all look contested.
  //
  // So the demand is admitted before the choice is. Its candidates are every
  // course any concentration would accept, and its size is the SMALLEST any of
  // them demands — the floor the student owes whichever they pick. Both narrow
  // the moment a concentration is chosen and this branch stops running.
  const conc = programData?.concentrations;
  if (!concentration && conc?.concentrationOptions?.length && (conc.minOptions ?? 1) > 0) {
    const spec = emptySpec();
    let floor = Infinity;
    for (const option of conc.concentrationOptions) {
      const s = specForNode(option);
      s.keys.forEach(k => spec.keys.add(k));
      spec.ranges.push(...s.ranges);
      const optAlloc = allocateSections([option], placedSet, new Set(), courseMap)[0];
      floor = Math.min(floor, demandOf(optAlloc, typicalSH(s, courseMap, defaultUnitSH)));
    }
    if (Number.isFinite(floor) && floor > 0) {
      out.push({
        key: CONCENTRATION_KEY,
        title: "",
        spec,
        kind: "credits",
        shortfallSH: floor * (conc.minOptions ?? 1),
        origin: "concentration",
        derived: true,
      });
      statedDemand += floor * (conc.minOptions ?? 1);
    }
  }

  // ── The general-elective allowance ───────────────────────────────
  //
  // Recorded for only 95 of 532 undergraduate programs, so for the rest it is
  // derived from the stated total. It carries no candidates — by definition
  // anything counts — and is included anyway because of what it ABSORBS: seven
  // "General Elective" slots with nowhere to go would otherwise float through
  // every other requirement's domain and block elimination everywhere.
  const stated = programData?.generalElectiveSH;
  const total  = programData?.totalCreditsRequired ?? 0;
  const geSH   = stated ?? Math.max(0, total - statedDemand);
  if (geSH > 0) {
    // What has already gone to general electives is what the audit could not
    // allocate to any section — asking the allocator is exact, where deducing
    // it from totals would be an estimate that drifts from the panel.
    const allocated = new Set();
    for (const r of alloc) r?.allocatedCourses?.forEach(k => allocated.add(k));
    const used = [...placedSet].reduce(
      (n, k) => n + (allocated.has(k) ? 0 : courseMap[k]?.sh ?? 0), 0);
    const remaining = Math.max(0, geSH - used);
    if (remaining > 0) {
      out.push({
        key: GENERAL_ELECTIVE_KEY,
        title: "",
        spec: emptySpec(),
        kind: "credits",
        shortfallSH: remaining,
        origin: "general",
        ...(stated ? {} : { derived: true }),
      });
    }
  }
  return out;
}

/** Credit hours a section demands in total, regardless of what is placed. */
function demandOf(allocSection, unitSH) {
  let reqSh = 0, found = false;
  for (const c of allocSection?.children ?? []) {
    if (typeof c.reqSh === "number") { reqSh += c.reqSh; found = true; }
  }
  if (found) return reqSh;
  return (allocSection?.minRequired ?? allocSection?.total ?? 0) * unitSH;
}

/**
 * What a section still needs, read off the audit's own result.
 *
 * Only the section node and its immediate children are touched — see the
 * header on why a deeper parallel walk is unsafe. A child carrying `reqSh`
 * states its demand in credit hours (an XOM pool); anything else is counted in
 * courses via the section's own `minRequired` / `satCount`.
 */
function shortfallOf(allocSection) {
  let reqSh = 0, satSh = 0, found = false;
  for (const c of allocSection?.children ?? []) {
    if (typeof c.reqSh === "number") {
      reqSh += c.reqSh;
      satSh += c.satSh ?? 0;
      found = true;
    }
  }
  if (found) return { kind: "credits", sh: Math.max(0, reqSh - satSh) };
  const need = allocSection?.minRequired ?? allocSection?.total ?? 0;
  return { kind: "units", units: Math.max(0, need - (allocSection?.satCount ?? 0)) };
}

/** The credit value one course of this kind usually carries. */
function typicalSH(spec, courseMap, fallback) {
  const counts = new Map();
  for (const key of spec?.keys ?? []) {
    const sh = courseMap[key]?.sh;
    if (sh) counts.set(sh, (counts.get(sh) ?? 0) + 1);
  }
  if (!counts.size) return fallback;
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

// ═══════════════════════════════════════════════════════════════════
// HINTS
//
// Everything language- and institution-shaped lives behind this contract, so
// the solver above and the elimination below know nothing about English. The
// default is the empty set of hints, under which binding is purely structural
// and still correct — just less often forced. `mapSamplePlan` already sets
// this precedent with its injected `isFreeElective`.
// ═══════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} SlotHints
 * @property {(label: string) => boolean}  [isFreeElective]
 *   "General Elective" — names no requirement, so it binds to the open bucket.
 * @property {(label: string) => string|null} [subjectOf]
 *   "MATH elective" → "MATH". Checked against each requirement's actual course
 *   set rather than its title, which is what makes it near-conclusive: the
 *   Khoury bucket admits no MATH course, so it is excluded as a fact rather
 *   than as a guess.
 * @property {(label: string) => {subject: string, start: number, end: number}|null} [rangeOf]
 *   Some cells state their own constraint outright — "Course in the following
 *   range: MATH 3001 to MATH 4999". That is not inference at all.
 * @property {(label: string, title: string) => boolean} [titleMatches]
 *   The weakest rung, and the first dropped: "Khoury Elective" ~ "Khoury
 *   Approved Electives".
 */

const NO_HINTS = {};

/**
 * The evidence ladder, weakest first — the order narrowings are given back in
 * when a requirement turns out to be over-claimed.
 *
 * `stated` and `range` are at the top because neither is inference: the
 * catalog printed the course codes, or printed the rule. Giving those up would
 * be discarding what the source said in favour of what we deduced, so nothing
 * above `subject` is ever relaxed.
 */
const RUNG_STRENGTH = {
  title: 0, subject: 1, free: 1, elimination: 2, range: 3, stated: 3,
};

// ═══════════════════════════════════════════════════════════════════
// BINDING
// ═══════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} Binding
 * @property {string[]} obligations  keys still possible; one = forced
 * @property {"stated"|"range"|"subject"|"free"|"title"|"elimination"|"open"} basis
 *   which rung of the evidence ladder left the domain where it is — for
 *   explaining the result, and for telling a fact from a deduction.
 */

/**
 * Work out which requirement each unfilled slot stands for.
 *
 * @param {object} slots                  id → slot
 * @param {Obligation[]} obligations
 * @param {object} [ctx]
 * @param {object} [ctx.courseMap]
 * @param {SlotHints} [ctx.hints]
 * @param {number} [ctx.defaultUnitSH]
 * @returns {Object.<string, Binding>} keyed by slot id; slots with nothing to
 *   bind to are absent rather than present-and-empty
 */
export function bindSlots(slots, obligations, {
  courseMap = {},
  hints = NO_HINTS,
  defaultUnitSH = DEFAULT_UNIT_SH,
} = {}) {
  // `exact` slots are included, and that is not a detail. The catalog stating
  // "CS 4300 or 4100" means the plan HAS answered that requirement, so the
  // requirement is not outstanding and no other slot can be for it. Leaving
  // them out made two CS and Math requirements look unmet and put three
  // spurious candidates on the one slot this module exists to identify.
  //
  // They are bound structurally from the codes the catalog printed, never from
  // wording, and their basis says so.
  const open = unfilledSlots(slots);
  if (!open.length || !obligations?.length) return {};

  const byKey = new Map(obligations.map(o => [o.key, o]));
  const domain = new Map();   // slot id → obligation keys
  const basis  = new Map();
  const rungs  = new Map();   // slot id → successive domains, widest first
  const stated = new Map();   // slot id → a rule the cell printed for itself

  for (const slot of open) {
    const label = slot.label ?? "";
    // Every requirement with demand left is possible until something rules it
    // out. Capacity is deliberately NOT applied per slot here — it is a
    // property of the whole assignment, and saturation below is where it
    // belongs.
    let d = obligations.map(o => o.key);
    let why = "elimination";
    // Each rung of the ladder is kept, so a narrowing that turns out to
    // over-claim can be stepped back one rung instead of all the way — see
    // relieve().
    const ladder = [d];

    if (slot.constraint === "exact") {
      // Whichever of the printed codes the student ends up taking, it answers
      // the same requirement — so any obligation admitting any candidate is a
      // possibility, and there is nothing to infer beyond that.
      const admits = d.filter(k => (slot.candidates ?? []).some(
        c => specAdmitsKey(byKey.get(k)?.spec, c, courseMap)));
      domain.set(slot.id, admits.length ? admits : d);
      basis.set(slot.id, "stated");
      continue;
    }

    // Each filter narrows only if it leaves something behind. A hint that
    // contradicts the structure is the hint being wrong, not the structure —
    // so it is dropped for that slot and the slot stays ambiguous rather than
    // being bound somewhere the arithmetic says it cannot go.
    const narrow = (next, reason) => {
      if (next.length && next.length < d.length) { d = next; why = reason; ladder.push(d); }
    };

    const range = hints.rangeOf?.(label);
    if (range) {
      // Kept on the binding, not just used to narrow. A cell that prints its
      // own rule can answer "what fits here" by itself, and must keep doing so
      // even when the requirement it was matched to is the wrong one — which
      // happens wherever a program's requirement parse is missing the section
      // the cell was really for.
      stated.set(slot.id, range);
      narrow(d.filter(k => specAdmitsRange(byKey.get(k)?.spec, range)), "range");
    } else if (hints.isFreeElective?.(label)) {
      narrow(d.filter(k => k === GENERAL_ELECTIVE_KEY), "free");
    } else {
      const subject = hints.subjectOf?.(label);
      if (subject) {
        narrow(d.filter(k => specAdmitsSubject(byKey.get(k)?.spec, subject)), "subject");
      }
      if (hints.titleMatches) {
        narrow(d.filter(k => {
          const o = byKey.get(k);
          return o?.title && hints.titleMatches(label, o.title);
        }), "title");
      }
    }

    // A free-elective slot that found no general bucket, or any slot left with
    // only the open bucket, is bound to nothing informative.
    domain.set(slot.id, d);
    basis.set(slot.id, why);
    rungs.set(slot.id, ladder);
  }

  relieve(open, domain, basis, rungs, byKey, defaultUnitSH);
  saturate(open, domain, byKey, defaultUnitSH);

  const out = {};
  for (const slot of open) {
    const d = domain.get(slot.id) ?? [];
    if (!d.length) continue;
    // `basis` records the last thing that narrowed this slot's domain, so a
    // slot nothing narrowed reads "elimination" — which is the honest account
    // of a binding that exists only because everything else was ruled out.
    out[slot.id] = {
      obligations: d,
      basis: basis.get(slot.id),
      ...(stated.has(slot.id) ? { stated: stated.get(slot.id) } : {}),
    };
  }
  return out;
}

/**
 * Undo narrowings that claim more of a requirement than it has room for.
 *
 * Saturation is only half of capacity. It removes a requirement from OTHER
 * slots' domains once it is full, but a slot already narrowed to a singleton
 * is immune — so three slots can each sit confidently on one 4 SH Capstone and
 * nothing objects. Mathematics and Philosophy does exactly this.
 *
 * The measurement that makes this worth fixing also corrected the diagnosis.
 * Over-subscription was expected to mark programs with thin requirement data;
 * it marks the opposite. Programs where it happens have slot credit and
 * requirement demand almost equal (1.09×) while the untroubled ones carry 2.5×
 * more slots than requirements, with the same number of sections either way.
 * Slack is what hides the problem — everything spare drains into the general
 * bucket and never contends. So this fires precisely on the BEST-specified
 * programs, and getting it wrong there is getting it wrong where it counts.
 *
 * The remedy is the evidence ladder run backwards. A requirement claimed
 * beyond its capacity means the narrowing that put those slots there was too
 * strong, so every slot involved steps back one rung — to what it believed
 * before its weakest evidence was applied — and the check runs again. Stepping
 * ALL of them back rather than choosing among them is what keeps the result
 * independent of order: picking a victim would need a reason, and any reason
 * would be the wording we already refuse to let decide.
 */
function relieve(slots, domain, basis, rungs, byKey, defaultUnitSH) {
  // Bounded by the total number of rungs, and every pass either steps
  // something back or stops.
  for (let pass = 0; pass < 8; pass++) {
    let stepped = false;
    for (const [key, ob] of byKey) {
      const claimants = slots.filter(s => {
        const d = domain.get(s.id);
        return d.length === 1 && d[0] === key;
      });
      const load = claimants.reduce((n, s) => n + (s.sh ?? defaultUnitSH), 0);
      if (load <= ob.shortfallSH) continue;

      // Give up the WEAKEST evidence present and no more. Stepping every
      // claimant back at once costs more than it should: where a requirement
      // is contested by one slot that names it and two that merely overlap it
      // numerically, all three lose and the one that was right is punished
      // alongside the two that were not.
      //
      // The tier is a property of the slot's own evidence, not of the order it
      // was visited in, so choosing this way stays order-independent — unlike
      // picking a victim, which would need a reason, and the only reason
      // available is the wording this module refuses to let decide.
      const weakest = claimants.reduce(
        (w, s) => Math.min(w, RUNG_STRENGTH[basis.get(s.id)] ?? 99), 99);
      // Nothing relaxable left: an over-subscribed requirement is still a
      // better answer than none, so it stands and the diagnostic survives.
      if (weakest >= RUNG_STRENGTH.stated) continue;

      for (const s of claimants) {
        if ((RUNG_STRENGTH[basis.get(s.id)] ?? 99) !== weakest) continue;
        const ladder = rungs.get(s.id);
        if (!ladder || ladder.length < 2) continue;
        ladder.pop();
        domain.set(s.id, ladder[ladder.length - 1]);
        if (ladder.length === 1) basis.set(s.id, "elimination");
        stepped = true;
      }
    }
    if (!stepped) return;
  }
}

/**
 * Remove requirements that are provably already spoken for.
 *
 * A slot whose domain is a single requirement can go nowhere else, so it is
 * committed to it. When the slots committed to a requirement already cover its
 * remaining demand, that requirement is full: no OTHER slot can be for it, and
 * it leaves their domains. Removing it may reduce another domain to one, which
 * commits that slot in turn, so this runs to a fixpoint.
 *
 * This is the step that identifies "Computing and social issues". Nothing about
 * the phrase is recognised; the Khoury, Mathematics and general-elective
 * requirements fill up with slots that name them, and the Supporting Course is
 * the only requirement left that anything can still be for.
 *
 * Only provably-impossible values are ever removed and domains only shrink, so
 * the result does not depend on the order of either loop, and it terminates.
 */
function saturate(slots, domain, byKey, defaultUnitSH) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, ob] of byKey) {
      let claimed = 0;
      let committed = 0;
      for (const s of slots) {
        const d = domain.get(s.id);
        if (d.length === 1 && d[0] === key) {
          claimed += s.sh ?? defaultUnitSH;
          committed += 1;
        }
      }
      if (!committed || claimed < ob.shortfallSH) continue;
      for (const s of slots) {
        const d = domain.get(s.id);
        // Never empty a domain: a slot with nowhere left to go is worse than a
        // slot that is merely unresolved.
        if (d.length > 1 && d.includes(key)) {
          domain.set(s.id, d.filter(k => k !== key));
          changed = true;
        }
      }
    }
  }
}

// ── Spec questions ─────────────────────────────────────────────────

/**
 * Does this requirement admit this specific course?
 *
 * Falls back to plain key membership when the catalog has no record of the
 * course — a plan may name one that has since been retired, and a range check
 * needs a subject and number it cannot invent.
 */
export function specAdmitsKey(spec, key, courseMap = {}) {
  if (!spec || !key) return false;
  if (spec.keys.has(key)) return true;
  const course = courseMap[key];
  return course ? courseEligible(course, spec) : false;
}

/** Does this requirement admit any course in the given subject? */
export function specAdmitsSubject(spec, subject) {
  if (!spec || !subject) return false;
  for (const k of spec.keys) if (k.startsWith(subject) && /^\d/.test(k.slice(subject.length))) return true;
  return spec.ranges.some(r => r.subject === subject);
}

/** Does this requirement admit anything inside the stated range? */
export function specAdmitsRange(spec, { subject, start, end }) {
  if (!spec) return false;
  for (const k of spec.keys) {
    if (!k.startsWith(subject)) continue;
    const n = parseInt(k.slice(subject.length), 10);
    if (Number.isFinite(n) && n >= start && n <= end) return true;
  }
  return spec.ranges.some(r => r.subject === subject && r.start <= end && r.end >= start);
}

/**
 * The courses a bound slot suggests — the union of everything its remaining
 * requirements admit.
 *
 * Returned as a SPEC rather than a course list, which is the whole point: a
 * MATH 3001–4999 requirement is four numbers, not the forty-one course ids it
 * currently happens to expand to. It cannot go stale against next month's
 * scrape, it costs nothing to carry, and `courseEligible` already answers the
 * only question anyone asks of it.
 *
 * An empty spec means "anything" (a general elective), which is not the same
 * as "nothing" — callers must distinguish, so `specIsEmpty` is re-exported.
 *
 * @returns {EligibleSpec|null} null when the slot is bound to nothing
 */
export function suggestedSpec(binding, obligations) {
  if (!binding) return null;
  // A rule the catalog printed for this cell outranks the requirement we
  // matched it to, because the first is a fact and the second is a deduction.
  if (binding.stated) {
    const out = emptySpec();
    out.ranges.push({ ...binding.stated, exceptions: new Set() });
    return out;
  }
  if (!binding.obligations?.length) return null;
  const byKey = new Map(obligations.map(o => [o.key, o]));
  const out = emptySpec();
  let any = false;
  for (const k of binding.obligations) {
    const spec = byKey.get(k)?.spec;
    if (!spec) continue;
    any = true;
    spec.keys.forEach(key => out.keys.add(key));
    out.ranges.push(...spec.ranges);
  }
  return any ? out : null;
}

/**
 * Is this course a sensible answer to this slot?
 *
 * Never a verdict on whether it is ALLOWED — `canFill` in slotModel.js owns
 * that, and for an inferred binding the answer is always yes, because a guess
 * must not close a door. This only says whether the course is one of the ones
 * we would have offered.
 */
export function isSuggested(course, binding, obligations) {
  const spec = suggestedSpec(binding, obligations);
  if (!spec || specIsEmpty(spec)) return false;
  return courseEligible(course, spec);
}

export { specIsEmpty };
