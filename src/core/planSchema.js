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

/** Inner key maps for fields whose values are compacted element-by-element. */
export const SHARE_INNER_KEYS = {
  // specialTermPl entry objects
  specialTerm: { typeId: 't', semId: 's', duration: 'd', company: 'c', companyDomain: 'cd', subline: 'sl' },
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
