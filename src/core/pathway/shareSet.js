// ═══════════════════════════════════════════════════════════════════
// SHARE SET — which shares a pathway offers, which the student is using,
// and the substitutions that follow.
//
// ── The one idea ──────────────────────────────────────────────────
//
// A PlusOne "double count" is never a double count inside any single audit.
// The graduate course fills one bachelor's slot, once, and one master's slot,
// once; the sharing is only visible when the two audits are compared.
// D'Amore-McKim states it as policy — "credits counted once, applied to
// undergraduate degree first". So there is NO new credit arithmetic here, and
// `applySubstitutions` in core/planModel.js already implements the bachelor's
// side exactly.
//
// ── One-way, and why it matters ───────────────────────────────────
//
// Substitutions run GRADUATE → UNDERGRADUATE and never the reverse.
// `CS 5800` satisfies `CS 3000`; `CS 3000` never satisfies `CS 5800`.
//
// This is why the plan's own `substitutions` field is the right primitive and
// the equivalence index is NOT: index pairs are symmetric `{a, b}`, so routing
// PlusOne through them would let an undergraduate course claim credit toward a
// master's requirement. `assertOneWay` below makes the direction a checked
// invariant rather than a comment.
//
// ── Derived, not materialized ─────────────────────────────────────
//
// The plan stores only `plusOne` (the MS program id). The substitution list is
// derived here on read and concatenated with the student's own. Three reasons,
// and note that share-link size is NOT one of them — measured, materializing
// 13 pairs costs 116 base64 characters, 17.7% of a QR's capacity:
//
//   1. one source of truth: a stored copy can disagree with pathway data after
//      a data update;
//   2. `noGradIfUgDone` requires a share to DISAPPEAR once the undergraduate
//      version is taken — trivial when derived, a sync problem when stored;
//   3. the student never opens their substitutions list to find entries they
//      did not create.
//
// Pre-arming every candidate is safe because `applySubstitutions` fires only
// `if (placements[from])` — an unplaced substitution is inert. Declaring a
// pathway therefore changes nothing at all until a graduate course is placed.
//
// Pure module: no React, no I/O.
// ═══════════════════════════════════════════════════════════════════

import { baseId } from "../repeatInstances.js";
import { plannerId, isGradCode, isUgCode, inDomain } from "./ids.js";

/**
 * @typedef {Object} Share            one row of a pathway's share table
 * @property {?string} grad           graduate course, source spelling ("CS 5800"),
 *                                    or null for an anonymous domain share
 * @property {Object}  [gradDomain]   domain for an anonymous share (see ids.inDomain)
 * @property {Object}  target         what it fills on the bachelor's side:
 *                                    { kind: "course", ref } | { kind: "requirement", label }
 *                                    | { kind: "slot", label }
 * @property {boolean} [mandatory]
 * @property {Object}  [mandatoryUnless] { completed: "CS 3000" }
 * @property {boolean} [recommended]  soft preference only (Khoury MSDS stars two)
 *
 * @typedef {Object} ActiveShare      a candidate whose graduate course is placed
 * @property {Share}   share
 * @property {string}  gradId         planner id, e.g. "CS5800"
 * @property {?string} targetId       planner id of a course target, else null
 * @property {number}  sh             semester hours, from courseMap
 * @property {?string} semId          term it sits in
 * @property {boolean} withdrawn      placed but the grade voids the take
 */

/**
 * Semester hours of a placed course, 0 when we cannot tell.
 *
 * TWO course shapes reach this function and they name the field differently:
 *
 *   `sh`      the RUNTIME course, normalised by adapters/northeastern/courseNorm.js
 *             — this is what the app's courseMap holds
 *   `credits` the RAW catalog record in public/northeastern/catalog-courses.json
 *             — this is what scripts, the verifier and tests build maps from
 *
 * Reading only `credits` is a bug that green tests cannot catch, because the
 * tests build their courseMap from the raw file: every share reported 0 SH in
 * the browser while the suite passed. `sh` is checked first because the runtime
 * shape is the one a student sees.
 */
function shOf(courseMap, id) {
  const c = courseMap?.[id] ?? courseMap?.[baseId(id)];
  for (const v of [c?.sh, c?.credits]) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * Every placement key whose base course is `id`, so a repeat instance
 * ("CS5800#2") is found by its base code. Returns [] when absent.
 */
function placementsOf(placements, id) {
  const out = [];
  for (const pid of Object.keys(placements ?? {})) {
    if (baseId(pid) === id) out.push(pid);
  }
  return out;
}

/**
 * Is the undergraduate version already taken?
 *
 * "Completed" is deliberately generous: a course PLACED anywhere in the plan
 * counts, not only one in a finished term. Khoury's rule bites at registration
 * time, so warning a student only after the term ends would be useless — and
 * withdrawing the share early is the conservative direction, since the student
 * can always remove the undergraduate placement to get it back.
 */
function ugVersionTaken(targetId, placements, placedOut) {
  if (!targetId) return false;
  if (placedOut?.has?.(targetId)) return true;
  return placementsOf(placements, targetId).length > 0;
}

/**
 * Resolve a pathway's candidate shares into planner-id form, dropping any that
 * the pathway itself excludes.
 *
 * @param {Object} pathway
 * @param {Object} opts
 * @param {Set<string>} [opts.excluded]  planner ids that may never be shared
 * @returns {{share: Share, gradId: ?string, targetId: ?string}[]}
 */
export function resolveCandidates(pathway, { excluded } = {}) {
  const out = [];
  for (const share of pathway?.shares ?? []) {
    const gradId = share.grad ? plannerId(share.grad) : null;
    if (gradId && excluded?.has(gradId)) continue;
    const targetId = share.target?.kind === "course" ? plannerId(share.target.ref) : null;
    out.push({ share, gradId, targetId });
  }
  return out;
}

/**
 * The planner ids a pathway forbids sharing (rule kind `excludedFromShare`).
 * Collected from the rules rather than from the shares, because the published
 * exclusions (ECE's EECE 5698 / 7398 / 6400) are stated as a blocklist and do
 * not appear in any share table.
 */
export function excludedIds(pathway) {
  const out = new Set();
  for (const rule of pathway?.rules ?? []) {
    if (rule.kind !== "excludedFromShare") continue;
    for (const c of rule.courses ?? []) {
      const id = plannerId(c);
      if (id) out.add(id);
    }
  }
  return out;
}

/**
 * Which candidate shares is the student actually using?
 *
 * A candidate is ACTIVE when its graduate course is placed. Anonymous domain
 * shares (COE's "Graduate Course #1–#4", CEE's "any graduate course that
 * contributes to the MS degree") have no named course, so they are matched
 * against any placed graduate course in the domain that no named share claimed.
 *
 * @param {Object}  args
 * @param {Object}  args.pathway
 * @param {Object}  args.placements     { placementKey: semId }
 * @param {Object}  args.courseMap      plannerId → course
 * @param {Object}  [args.grades]       { placementKey: grade }
 * @param {Set}     [args.placedOut]
 * @param {Function}[args.isVoid]       grade → true when the take does not count
 * @returns {ActiveShare[]}
 */
export function activeShares({
  pathway, placements = {}, courseMap = {}, grades = {}, placedOut = new Set(), isVoid,
}) {
  const excluded = excludedIds(pathway);
  const candidates = resolveCandidates(pathway, { excluded });
  const claimed = new Set();
  const out = [];

  const voided = g => (typeof isVoid === "function" ? !!isVoid(g) : false);

  // Named shares first, so a domain share never steals a course that a named
  // row already accounts for.
  for (const cand of candidates) {
    if (!cand.gradId) continue;
    for (const pid of placementsOf(placements, cand.gradId)) {
      claimed.add(pid);
      out.push({
        share: cand.share,
        gradId: cand.gradId,
        targetId: cand.targetId,
        sh: shOf(courseMap, cand.gradId),
        semId: placements[pid] ?? null,
        withdrawn: voided(grades[pid]),
      });
    }
  }

  // Then anonymous domain shares, each consuming at most `count` placements.
  for (const cand of candidates) {
    if (cand.gradId || !cand.share.gradDomain) continue;
    let room = Number.isFinite(cand.share.count) ? cand.share.count : Infinity;
    for (const pid of Object.keys(placements)) {
      if (room <= 0) break;
      if (claimed.has(pid)) continue;
      const base = baseId(pid);
      if (!inDomain(base, cand.share.gradDomain)) continue;
      if (excluded.has(base)) continue;
      claimed.add(pid);
      room -= 1;
      out.push({
        share: cand.share,
        gradId: base,
        targetId: null,
        sh: shOf(courseMap, base),
        semId: placements[pid] ?? null,
        withdrawn: voided(grades[pid]),
      });
    }
  }

  return out;
}

/**
 * The substitutions a declared pathway contributes, in `applySubstitutions`
 * shape. Only `target.kind === "course"` produces one: a share that fills a
 * "General Elective" or a named requirement has no single course to satisfy, so
 * it is reported by the panel and left to the requirement allocator.
 *
 * Withdrawal is the point of deriving these. When the undergraduate version is
 * already in the plan, the pair is omitted entirely — the student cannot take
 * the graduate version for credit (Khoury `noGradIfUgDone`), and offering the
 * swap anyway would let the plan satisfy one requirement twice.
 *
 * @returns {{from: string, to: string}[]}  from = graduate, to = undergraduate
 */
export function pathwaySubstitutions({
  pathway, placements = {}, placedOut = new Set(),
}) {
  if (!pathway) return [];
  const excluded = excludedIds(pathway);
  const out = [];
  const seen = new Set();

  for (const { share, gradId, targetId } of resolveCandidates(pathway, { excluded })) {
    if (!gradId || !targetId) continue;
    if (ugVersionTaken(targetId, placements, placedOut)) continue;
    const key = `${gradId}|${targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from: gradId, to: targetId });
  }

  return out;
}

/**
 * Merge derived pathway substitutions with the student's own.
 *
 * The student's list wins on collision: a manual substitution is an explicit
 * act and a derived one is a default. Order is stable so a share link built
 * from the merged list does not churn.
 */
export function mergeSubstitutions(userSubs = [], derived = []) {
  const seen = new Set(userSubs.map(s => `${s.from}|${s.to}`));
  const out = [...userSubs];
  for (const s of derived) {
    const key = `${s.from}|${s.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * The direction invariant, as a check rather than a comment.
 *
 * Every substitution a pathway contributes must run graduate → undergraduate.
 * The failure this prevents is silent and expensive: reversed, an undergraduate
 * course would satisfy a graduate requirement and the master's projection would
 * over-count. Called by the test suite over every shipped pathway, and cheap
 * enough to call from the adapter in development.
 *
 * @returns {{from: string, to: string}[]} offending pairs — empty when sound
 */
export function assertOneWay(subs = []) {
  return subs.filter(s => !(isGradCode(s.from) && isUgCode(s.to)));
}

/**
 * Share totals for the cap meter: how many courses and semester hours the
 * student is currently sharing.
 *
 * `includeWithdrawn` exists because Khoury counts withdrawals against the
 * four-course limit ("four graduate courses total, including withdrawals"),
 * which is a counting CONVENTION rather than a constraint — so it is a property
 * of the pathway, not a rule with an evaluator.
 */
export function shareTotals(shares = [], { includeWithdrawn = false } = {}) {
  const counted = includeWithdrawn ? shares : shares.filter(s => !s.withdrawn);
  return {
    courses: counted.length,
    semesterHours: counted.reduce((n, s) => n + (Number(s.sh) || 0), 0),
    withdrawn: shares.filter(s => s.withdrawn).length,
  };
}
