// The canonical plan schema — one source of truth for the fields a plan has.
//
// A plan travels through several "doors": the localStorage slot
// (captureCurrentPlan → restorePlan), the share link (planShare encode/decode),
// the exported/imported JSON file (applyPlanData), and the MCP snapshot. Each
// door used to hand-repeat the field list, and the recurring bug was a field
// added at one door and forgotten at another — conc2 dropped from share links,
// reservations dropped from capture, substitutions never restored, grades wiped
// on reload. The comment litany in PlannerContext's capture/restore functions
// is a catalogue of exactly these omissions.
//
// This registry lets every door derive its field list from one place instead.
// Adding a field here — with the right flags — wires it through every door that
// reads the registry, so the "forgot one door" class of data-loss bug cannot
// recur for fields that have migrated onto it.
//
// Pure module: no React, no I/O. Safe to import from core, adapters and tests.

/**
 * @typedef {Object} PlanFieldDescriptor
 * @property {string}  name       Canonical field name (as it appears in a plan slot).
 * @property {?string} share      Compact key used in a v2 share link, or null if
 *                                the field never leaves the browser in a share.
 * @property {boolean} [private]  True for fields that MUST NOT be shared — a hard
 *                                invariant (grades). Implies share === null.
 * @property {boolean} [envelope] True for fields that are not part of the plan
 *                                body but ride along in a share/export payload
 *                                (planName, locale). Not produced by capture.
 * @property {'specialTerm'|'substitution'} [nested]
 *                                Field whose value has its own inner key map
 *                                (see SHARE_INNER_KEYS) for share compaction.
 */

/** @type {PlanFieldDescriptor[]} */
export const PLAN_FIELDS = [
  // ── Timeline / cohort bounds ──────────────────────────────────────────
  { name: 'entSem',  share: 'es' },
  { name: 'entYear', share: 'ey' },
  { name: 'gradSem', share: 'gs' },
  { name: 'gradYear', share: 'gy' },

  // ── The plan body ─────────────────────────────────────────────────────
  { name: 'placements',      share: 'p'  },
  // Cards placed in a semester with no course chosen yet. For a later year
  // these are most of the plan, so dropping them at a door reads as the
  // sender's work having vanished.
  { name: 'reservations',    share: 'rv' },
  { name: 'specialTermPl',   share: 'sp', nested: 'specialTerm' },
  { name: 'semOrders',       share: 'so' },
  { name: 'shOverrides',     share: 'sh' },
  { name: 'bonusSH',         share: 'b'  },
  { name: 'currentSemId',    share: 'cs' },
  { name: 'offeredOverrides', share: 'oo' },
  { name: 'collapsedSubs',   share: 'cl' },
  { name: 'placedOut',       share: 'po' },
  { name: 'substitutions',   share: 'su', nested: 'substitution' },

  // ── Program associations ──────────────────────────────────────────────
  { name: 'major',  share: 'mj'  },
  { name: 'major2', share: 'mj2' },
  { name: 'conc',   share: 'cn'  },
  // conc2 was once missing from the share map entirely: a second major's
  // concentration survived a reload but was silently dropped from every share
  // link. 51 undergraduate programs REQUIRE a concentration, so a shared
  // double major could arrive unsatisfiable.
  { name: 'conc2',  share: 'cn2' },
  { name: 'minor1', share: 'm1'  },
  { name: 'minor2', share: 'm2'  },
  // An accelerated BS/MS pathway (Northeastern brands it "PlusOne"): the id of
  // the pathway the student has declared. Undergraduate plans only — sharing
  // happens while in undergraduate status, which is the whole mechanism.
  //
  // Deliberately ONE field. The shares themselves are not stored: they are
  // derived from the pathway plus what is placed (core/pathway/shareSet.js), so
  // there is one source of truth and a share can DISAPPEAR when the student
  // takes the undergraduate version — which Khoury's rules require and a stored
  // copy could not do without a sync step.
  { name: 'plusOne', share: 'p1' },
  { name: 'studentType', share: 'st' },

  // ── Sensitive / local-only — deliberately NOT shared ──────────────────
  // Grades are the most sensitive thing NU Map holds. They live in plan slots
  // only and must never survive into a share link. `private` makes that a
  // checked invariant, not a convention (see planSchema test).
  { name: 'grades', share: null, private: true },
  // Provenance: which sample plan this canvas came from. It rides in the plan
  // slot and in an exported file (applyPlanData reads it) but is currently NOT
  // carried on share links. Whether it SHOULD be is a product decision; this
  // registry records today's behaviour rather than silently changing it.
  { name: 'appliedTemplate', share: null },

  // ── Envelope fields — not plan body, but ride along in a share/export ──
  { name: 'planName', share: 'pn', envelope: true },
  { name: 'locale',   share: 'lc', envelope: true },
];

/**
 * Discriminator for a whole-library backup file, so the import can tell a
 * bundle from a single plan before touching anything. A single-plan file is
 * identified only by `version: 1`, which a bundle also carries — without a
 * distinct marker the two doors are indistinguishable, and feeding a bundle to
 * the single-plan importer would create one plan holding a `plans` array.
 */
export const LIBRARY_BUNDLE_KIND = "map-library-backup";

/** Inner key maps for fields whose values are compacted element-by-element. */
export const SHARE_INNER_KEYS = {
  // specialTermPl entry objects.
  //
  // `abroad` earns its place here for the same reason `conc2` did, the hard
  // way: a key absent from this map survives a reload (specialTermPl is
  // serialised whole) but is SILENTLY DROPPED from every share link, export
  // and backup. A co-op marked international would arrive domestic, and
  // International Business's `International Experiential Learning` — the one
  // requirement in 1,017 programs that turns on this flag — would read unmet
  // for the recipient of a plan that satisfied it for the sender.
  specialTerm: { typeId: 't', semId: 's', duration: 'd', company: 'c', companyDomain: 'cd', subline: 'sl', abroad: 'ab' },
  // substitutions array entries
  substitution: { from: 'f', to: 't' },
};

/**
 * The v2 share-link key map: canonical name → compact key, for every field
 * that participates in a share. Derived from the registry so it cannot drift
 * from the field list. Equivalent to planShare's former inline `_KEYS`.
 * @type {Record<string, string>}
 */
export const SHARE_KEYS = Object.fromEntries(
  PLAN_FIELDS.filter(f => f.share != null).map(f => [f.name, f.share]),
);

/** Reverse of SHARE_KEYS: compact key → canonical name. */
export const SHARE_KEYS_R = Object.fromEntries(
  Object.entries(SHARE_KEYS).map(([k, v]) => [v, k]),
);

/** Which nested inner-key map (if any) a field uses for share compaction. */
export const SHARE_NESTED = Object.fromEntries(
  PLAN_FIELDS.filter(f => f.nested).map(f => [f.name, f.nested]),
);

/** Field names that must never appear in a share payload (hard invariant). */
export const PRIVATE_FIELDS = PLAN_FIELDS.filter(f => f.private).map(f => f.name);

/**
 * Drop term-order entries that name a card the plan does not contain.
 *
 * `semOrders` is positional bookkeeping: "in this term, draw these ids in this
 * sequence". Every drop rewrites the orders of the terms it touched, and only
 * those — so an id can be left behind in the order of a term it no longer
 * occupies, and a card deleted from the plan can stay named in an order
 * somewhere. The grid never shows it (`getOrderedCourses` filters an order
 * against what is actually in the term), so nothing looks wrong; the entries
 * simply accumulate, and ride into every exported file and share link as
 * references to cards that are not in the plan.
 *
 * ── What this deliberately does NOT touch ──────────────────────────
 *
 * Placements in a term outside the plan's current window. Those look like the
 * same kind of ghost and are not: shortening a cohort PARKS cards rather than
 * deleting them, so they return when it widens again. Pruning them at a door
 * would turn "I shortened my plan by a year" into silent, permanent data loss.
 * They are invisible in the app on purpose, and they are carried on purpose.
 * The rule here uses no timeline knowledge at all — only whether the plan
 * itself still holds the card — which is what keeps the two cases apart.
 *
 * @param {object} data a plan body (capture / slot / file shape)
 * @returns {object} the same object when nothing is stale, so callers can
 *                   cheaply skip a write
 */
export function pruneSemOrders(data) {
  const orders = data?.semOrders;
  if (!orders || typeof orders !== "object") return data;

  const held = new Set(Object.keys(data.placements ?? {}));
  for (const id of Object.keys(data.reservations ?? {})) held.add(id);

  let changed = false;
  const next = {};
  for (const [semId, ids] of Object.entries(orders)) {
    if (!Array.isArray(ids)) { changed = true; continue; }
    const kept = ids.filter(id => held.has(id));
    if (kept.length !== ids.length) changed = true;
    // An order that has emptied out carries nothing; keeping the key would
    // just be a term id with a `[]` beside it in every file from here on.
    if (kept.length) next[semId] = kept;
    else if (ids.length) changed = true;
  }
  return changed ? { ...data, semOrders: next } : data;
}
