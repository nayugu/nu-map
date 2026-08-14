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
import { plannerId, isGradCode, isUgCode, inDomain, subjectOf } from "./ids.js";

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
 * @property {string[]} altTargets    every undergraduate course this graduate
 *                                    course could replace. More than one means
 *                                    the published table lists ALTERNATIVES.
 * @property {boolean} ambiguous      altTargets.length > 1 — the course shares,
 *                                    but which requirement it covers is the
 *                                    student's choice, not ours to guess.
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
  //
  // ── ONE PLACEMENT IS ONE SHARE ────────────────────────────────────
  //
  // A published table can list the same graduate course against SEVERAL
  // undergraduate targets, because they are alternatives the student picks
  // between: Khoury maps `CS 5500` to both `CS 4500` and `CS 4530`, and
  // `CS 5700` to both `CS 3700` and `CS 4700`. Emitting one ActiveShare per
  // MATCHING ROW counted a single 4 SH placement as 2 courses / 8 SH against
  // the cap. Grouping by placement key is what keeps "credits counted once"
  // true — the alternatives ride along in `altTargets` so the UI can ask the
  // student which one they mean.
  // Keyed by the BASE course, not the placement key. A retake is a second
  // placement of the SAME course ("CS5800" and "CS5800#2"), and a course can only
  // be shared once however many times it is attempted — keying by placement made
  // a retake read as 2 courses / 8 SH against a 4-course / 16 SH cap, which could
  // push a legal plan over the limit on the strength of one course.
  const byCourse = new Map();
  for (const cand of candidates) {
    if (!cand.gradId) continue;
    for (const pid of placementsOf(placements, cand.gradId)) {
      claimed.add(pid);
      const withdrawn = voided(grades[pid]);
      const existing = byCourse.get(cand.gradId);
      if (existing) {
        if (cand.targetId && !existing.altTargets.includes(cand.targetId)) {
          existing.altTargets.push(cand.targetId);
        }
        // Among several takes, the one that COUNTS is what the share reflects: a
        // withdrawn first attempt plus a completed retake is one active share,
        // sitting in the term the student actually earned it.
        if (existing.withdrawn && !withdrawn) {
          existing.withdrawn = false;
          existing.semId = placements[pid] ?? null;
        }
        continue;
      }
      byCourse.set(cand.gradId, {
        share: cand.share,
        gradId: cand.gradId,
        targetId: cand.targetId,
        altTargets: cand.targetId ? [cand.targetId] : [],
        sh: shOf(courseMap, cand.gradId),
        semId: placements[pid] ?? null,
        withdrawn,
      });
    }
  }
  for (const s of byCourse.values()) {
    // `ambiguous` is the signal the panel needs: we know the course shares, we
    // do not know WHICH requirement it should cover.
    out.push({ ...s, ambiguous: s.altTargets.length > 1 });
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

  // Group viable targets BY graduate course first. A course with more than one
  // is an alternation the student chooses between, not a licence to satisfy all
  // of them — emitting a pair per row let one 4 SH placement of `CS 5500`
  // satisfy `CS 4500` AND `CS 4530`, which is the "credits counted once"
  // invariant broken in the most expensive direction: two undergraduate
  // requirements ticked off by one course.
  const targetsOf = new Map();
  for (const { gradId, targetId } of resolveCandidates(pathway, { excluded })) {
    if (!gradId || !targetId) continue;
    // `noGradIfUgDone`: a target already in the plan is not viable, so it also
    // does not make the remaining choice ambiguous.
    if (ugVersionTaken(targetId, placements, placedOut)) continue;
    if (!targetsOf.has(gradId)) targetsOf.set(gradId, []);
    const list = targetsOf.get(gradId);
    if (!list.includes(targetId)) list.push(targetId);
  }

  const out = [];
  for (const [from, targets] of targetsOf) {
    // Exactly one viable target — unambiguous, so pre-arm it.
    if (targets.length === 1) { out.push({ from, to: targets[0] }); continue; }
    // Several — we cannot know which requirement the student wants covered, and
    // picking one silently would be a confident guess about their degree. Emit
    // nothing: `ambiguousShares` reports it, and the student's own manual
    // substitution wins in mergeSubstitutions once they decide.
  }
  return out;
}

/**
 * Graduate courses whose share target is ambiguous, with the alternatives.
 *
 * Reported rather than resolved. Deliberately computed from the same grouping
 * `pathwaySubstitutions` uses, so the thing we decline to guess and the thing we
 * tell the student about can never disagree.
 *
 * SCOPE: pathway-level, not placement-level — it answers "which rows of this
 * table are alternations?" and so lists a course whether or not it is placed.
 * The panel renders ambiguity per ACTIVE share via activeShares().ambiguous.
 *
 * @returns {{gradId: string, targets: string[]}[]}
 */
export function ambiguousShares({ pathway, placements = {}, placedOut = new Set() }) {
  if (!pathway) return [];
  const excluded = excludedIds(pathway);
  const targetsOf = new Map();
  for (const { gradId, targetId } of resolveCandidates(pathway, { excluded })) {
    if (!gradId || !targetId) continue;
    if (ugVersionTaken(targetId, placements, placedOut)) continue;
    if (!targetsOf.has(gradId)) targetsOf.set(gradId, []);
    const list = targetsOf.get(gradId);
    if (!list.includes(targetId)) list.push(targetId);
  }
  return [...targetsOf.entries()]
    .filter(([, t]) => t.length > 1)
    .map(([gradId, targets]) => ({ gradId, targets }));
}

/**
 * Every course the pathway says could be shared, with what the plan makes of it.
 *
 * This is the panel's most actionable list and the reason it exists: a student
 * who has just declared a pathway wants to know WHAT TO TAKE, and until now the
 * card only showed what they had already taken. The published table is the answer
 * the college gives, so it is the answer we show.
 *
 * One row per graduate course, not per table row — Khoury lists `CS 5500` twice
 * (against `CS 4500` and `CS 4530`) and that is one choice, not two options.
 *
 * `state` is per row:
 *   "taken"    the graduate course is in the plan — this share is active
 *   "choose"   available, but the table offers several targets (see `ambiguous`)
 *   "blocked"  every target is already taken, so sharing it would double-count.
 *              Shown rather than hidden: a silently vanishing option reads as a
 *              bug, and "you already took CS 3650" is the explanation.
 *   "open"     available
 *
 * @returns {{gradId, targets, state, sh, blockedBy, mandatory, recommended}[]}
 */
export function shareCandidates({
  pathway, placements = {}, placedOut = new Set(), courseMap = {},
}) {
  if (!pathway) return [];
  const excluded = excludedIds(pathway);

  const rows = new Map();
  for (const { share, gradId, targetId } of resolveCandidates(pathway, { excluded })) {
    if (!gradId) continue;                      // domain shares are reported separately
    if (!rows.has(gradId)) {
      rows.set(gradId, {
        gradId, targets: [], blockedBy: [],
        sh: shOf(courseMap, gradId),
        mandatory: !!share.mandatory,
        recommended: !!share.recommended,
        slotLabel: share.target?.kind !== "course" ? (share.target?.label ?? null) : null,
      });
    }
    const row = rows.get(gradId);
    row.mandatory ||= !!share.mandatory;
    row.recommended ||= !!share.recommended;
    if (!targetId) continue;
    if (ugVersionTaken(targetId, placements, placedOut)) {
      if (!row.blockedBy.includes(targetId)) row.blockedBy.push(targetId);
    } else if (!row.targets.includes(targetId)) {
      row.targets.push(targetId);
    }
  }

  const out = [];
  for (const row of rows.values()) {
    const taken = placementsOf(placements, row.gradId).length > 0;
    // A row with no viable target left, but blocked ones, is foreclosed. A row
    // with neither is a slot-filler (CS 5010 → "General Elective") and stays open.
    const state = taken ? "taken"
      : (!row.targets.length && row.blockedBy.length) ? "blocked"
      : row.targets.length > 1 ? "choose"
      : "open";
    out.push({ ...row, state, ambiguous: row.targets.length > 1 });
  }

  // Mandatory first, then what the student is already doing, then recommended,
  // then the rest alphabetically — foreclosed rows last, since they are context
  // rather than choices.
  const rank = r => (r.state === "blocked" ? 4 : r.mandatory ? 0 : r.state === "taken" ? 1 : r.recommended ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b) || a.gradId.localeCompare(b.gradId));
}

/**
 * Does this pathway allow sharing BEYOND its named table?
 *
 * Some colleges publish an open rule rather than a list — CEE states "any
 * graduate course that contributes to the MS degree requirements may be shared",
 * and COE's curriculum sheets carry anonymous "Graduate Course #1–#4" slots. For
 * those, a table is a starting point and not the limit, and saying so is the
 * difference between a helpful list and a misleading one.
 */
export function hasOpenShareDomain(pathway) {
  return (pathway?.shares ?? []).some(s => !s.grad && s.gradDomain);
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

/**
 * Is `code` within the graduate-course FAMILY this pathway shares from — the
 * subject a named share names, or whatever a domain share restricts to (or
 * every subject, when it restricts nothing — `inDomain({})` already returns
 * true for exactly that reason: CEE/SBS publish "any graduate course that
 * contributes to the MS degree requirements").
 */
function inPathwayGradFamily(pathway, code) {
  const subj = subjectOf(code);
  for (const s of pathway?.shares ?? []) {
    if (s.grad) { if (subjectOf(s.grad) === subj) return true; }
    else if (s.gradDomain && inDomain(code, s.gradDomain)) return true;
  }
  return false;
}

/**
 * Every graduate course PLACED anywhere in the plan, within this pathway's own
 * share family — deliberately broader than `shareTotals`.
 *
 * `shareTotals` counts only courses that satisfy a NAMED bachelor's
 * requirement — the sharing cap. This counts every graduate course of the
 * same family the student has placed, whether or not it happens to fill a
 * bachelor's slot, because the COE FAQ states a SEPARATE limit: "additional
 * graduate coursework beyond 16 hours cannot transfer to MS, even if not
 * applied to BS." A student who takes a 5th, 6th graduate CS course purely to
 * get ahead on the master's — no bachelor's requirement left to fill — still
 * spends against this cap. See rules/transferCap.js for the policy math this
 * feeds.
 *
 * One course counts once, however many times attempted (matching
 * `activeShares`' own convention), and a voided attempt (W/F/U) earns no
 * credit and does not count at all — checked per PLACEMENT so a withdrawn
 * first attempt plus a passed retake of the same course still counts once.
 */
export function pathwayGradCreditSH(pathway, { placements = {}, courseMap = {}, grades = {}, isVoid } = {}) {
  const voided = g => (typeof isVoid === "function" ? !!isVoid(g) : false);
  const seen = new Set();
  let semesterHours = 0;
  for (const pid of Object.keys(placements)) {
    const base = baseId(pid);
    if (!isGradCode(base) || seen.has(base) || voided(grades[pid])) continue;
    if (!inPathwayGradFamily(pathway, base)) continue;
    seen.add(base);
    semesterHours += shOf(courseMap, base);
  }
  return { semesterHours };
}
