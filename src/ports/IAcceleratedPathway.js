// ═══════════════════════════════════════════════════════════════════
// PORT: IAcceleratedPathway
//
// A pathway that lets an undergraduate share course credit with a graduate
// credential, so both degrees finish sooner than taken in sequence.
//
// ── Why the port is not called "PlusOne" ──────────────────────────
//
// "PlusOne" is Northeastern's brand for this. The concept is not: the same
// arrangement is an "accelerated master's", a "4+1", an "integrated BS/MS" or a
// "combined degree" elsewhere, and Northeastern itself runs a sibling scheme
// called PlusJD with a different sharing limb (and a professional-doctorate
// scheme with a 40% limb rather than a course count).
//
// So the port and the core speak "pathway"; only the NEU adapter, the data files
// and the locale strings say "PlusOne". A second institution — or PlusJD — plugs
// in without touching src/core/pathway/.
//
// ── The port is DATA ONLY, on purpose ─────────────────────────────
//
// Evaluation lives in src/core/pathway/ (pure, no I/O) and is not reachable
// through this port. That is deliberate interface segregation: if an adapter
// could evaluate, an adapter could decide policy, and the safety classification
// in core/pathway/ruleKinds.js — which is what stops a student being told their
// plan is broken on the basis of a GPA we do not hold — would become advisory.
//
// An adapter MAY contribute extra rule evaluators for institution-specific rules
// (see docs/plusone-design.md §5.2), but they are registered into the core
// registry and are subject to the same invariant.
//
// ── Contract ──────────────────────────────────────────────────────
//
//   listPathways({ ugProgramId, studentType }) → Pathway[]
//   getPathway(id)                            → Pathway | null
//
// Both are synchronous and pure over already-loaded data. The generic default
// returns nothing, so an institution with no such scheme needs no adapter at all
// and no caller needs a null check.
// ═══════════════════════════════════════════════════════════════════

/** Port key — use with wire() and usePort(). */
export const IAcceleratedPathway = "acceleratedPathway";

/**
 * What a pathway offers on the bachelor's side.
 *
 * Three shapes exist in published practice and all three are in use, so a
 * consumer must handle all three (docs/plusone-design.md §2.2):
 *
 *   { kind: "course",      ref: "CS 3000" }     replaces a specific course
 *   { kind: "requirement", label: "…" }         satisfies a named requirement
 *   { kind: "slot",        label: "…" }          fills a slot type ("General Elective")
 *
 * Only `course` can become a substitution — the other two have no single course
 * to satisfy and are reported for the requirement allocator instead.
 *
 * @typedef {Object} ShareTarget
 * @property {"course"|"requirement"|"slot"} kind
 * @property {string} [ref]    course code, when kind === "course"
 * @property {string} [label]  human label, when kind is "requirement" or "slot"
 */

/**
 * One row of a pathway's share table.
 *
 * Exactly one of `grad` / `gradDomain` is present. A domain share is anonymous —
 * COE publishes "Graduate Course #1–#4" and CEE publishes "any graduate course
 * that contributes to the MS degree requirements" — so it is placeable but its
 * prerequisites cannot be checked ahead of time.
 *
 * @typedef {Object} Share
 * @property {?string} grad            graduate course, source spelling ("CS 5800")
 * @property {Object}  [gradDomain]    { subject?, subjects?, excludeSubject?, min?, max? }
 * @property {number}  [count]         how many placements a domain share may absorb
 * @property {ShareTarget} target
 * @property {boolean} [mandatory]     the pathway requires this share
 * @property {Object}  [mandatoryUnless] { completed: "CS 3000" } — conditional requirement
 * @property {boolean} [recommended]   soft preference only; never enforced
 */

/**
 * One rule over whichever shares the student takes.
 *
 * `kind` must be a key of core/pathway/ruleKinds.RULE_KINDS; remaining fields are
 * the kind's parameters. Unknown kinds degrade to "cannot say" rather than
 * failing a student, and scripts/verify-pathways.js refuses to let data ship
 * naming one.
 *
 * @typedef {Object} Rule
 * @property {string} kind
 */

/**
 * @typedef {Object} PathwaySource
 * @property {string} url          where this was transcribed from
 * @property {"html"|"pdf"} kind
 * @property {string} retrievedAt  ISO date — REQUIRED. Pathway data is curated
 *                                 from marketing pages and PDFs with no catalog
 *                                 authority, so a pathway with no date cannot be
 *                                 shown honestly and the verifier rejects it.
 * @property {string} [contentHash] for the CI drift check
 */

/**
 * @typedef {Object} Pathway
 * @property {string} id
 * @property {string} [brand]        institution's marketing name ("PlusOne")
 * @property {string} [label]
 * @property {string} [college]
 * @property {{ugProgram: string, requiresMsConcentration?: string}[]} eligibility
 *           Eligibility is (program × concentration): ECE admits BS Physics to
 *           its MSMD concentration ONLY, so a program id alone is not enough.
 * @property {string[]} msPrograms   campus variants of the same master's; Khoury's
 *                                   CS pathways span four campuses, and we hold a
 *                                   separate requirement file for each.
 * @property {Share[]} shares
 * @property {Rule[]}  rules
 * @property {{includeWithdrawn?: boolean, note?: string}} [counting]
 *           Counting CONVENTIONS rather than constraints — Khoury counts
 *           withdrawals against its four-course budget. Not a rule because there
 *           is nothing to satisfy or violate.
 * @property {{text: string, reason: string}[]} [notes]
 *           Published facts we deliberately do not model, each with why. Bouvé's
 *           `BIOT 5621 + BIOL 5100 → CHEM 5620` lives here: substitutions are
 *           strictly one-to-one and reopening that to serve one case would
 *           weaken a model that holds everywhere else.
 * @property {PathwaySource} source
 * @property {"published"|"derived"} confidence
 */

/**
 * @typedef {Object} IAcceleratedPathwayPort
 * @property {(q: {ugProgramId?: string, studentType?: string}) => Pathway[]} listPathways
 *           Pathways open to a student. MUST return [] for a graduate plan:
 *           sharing happens while in undergraduate status, so the concept does
 *           not apply.
 * @property {(id: string) => (Pathway|null)} getPathway
 */
