// ═══════════════════════════════════════════════════════════════════
// DERIVATION · the walkthrough, as steps on the reader's own grid  (pure)
//
// One step per course: it went HERE, it tried THESE first, and this is what threw it out of
// each of them. Then the swaps phase 2 made. That is the whole view, and it replaces a page of
// six charts whose verdict was "looks cool, but I have no idea what it means".
//
// ── Why the winning path, and what that would hide if left alone ─────
//
// Following the 13,019 placements a saturated degree explores is not a walkthrough, it is a
// texture. Following the ~40 that survived is a story with a beginning: each step is a course
// landing in a semester, on the same grid the reader already reads.
//
// But the winning path ALONE would imply the plan came out in one clean pass. For about half
// the corpus that is true. For the saturated third it is badly false — the engine threw away
// thousands of arrangements first — and a tidy 40-step walkthrough claiming otherwise is the
// "summary presented as a trace" failure this whole view exists to avoid.
//
// So each step carries two things the spine does not have on its own:
//
//   `rejected`  the terms this course was thrown out of right here, each with its cause. Small
//               (at most one per term), concrete, and it is what makes the REASON real: 92.6%
//               of the engine's stored reasons are the useless `load-balance`, where "the three
//               earlier semesters were already full" is the same fact and can be checked.
//   `cost`      how many arrangements were built and undone between the previous step sticking
//               and this one. Zero for most steps in an easy degree, thousands in a hard one —
//               so the struggle appears exactly where it happened rather than as a headline.
//
// ── The invariant that keeps it honest ──────────────────────────────
//
// The search's assignment plus every recorded swap must equal the plan that shipped. If it does
// not, the walkthrough is describing a plan the reader is not looking at, and that is worse
// than showing nothing. Asserted in `test/unit/derivation-steps.test.js` and over the corpus.
// ═══════════════════════════════════════════════════════════════════

import { NODE, CAUSES } from "./events.js";
// The same split into academic years `applySamplePlan` uses to land a published plan on the
// timeline. Shared rather than re-derived: if the two disagreed about which semesters make up
// "year 3", the walkthrough would show a course landing in a term the apply puts elsewhere.
import { academicYears } from "../applySamplePlan.js";

/**
 * The walkthrough.
 *
 * @param {object} snapshot a `createTrace().snapshot()`
 * @param {object} model the output of `deriveModel`
 */
export function buildSteps(snapshot, model) {
  if (!snapshot?.roster?.length) return null;
  const roster = snapshot.roster;
  const terms = snapshot.terms ?? [];
  const title = (c) => roster[c]?.title ?? "";

  const spine = winningSpine(snapshot);
  const place = [];

  // Cuts grouped by the node that tried them, so a step can name its own alternatives without
  // re-scanning the cut stream once per step.
  const cutsAt = new Map();
  const cutNode = snapshot.cutNode ?? [];
  for (let k = 0; k < cutNode.length; k++) {
    const p = cutNode[k];
    if (!cutsAt.has(p)) cutsAt.set(p, []);
    cutsAt.get(p).push(k);
  }

  for (let d = 0; d < spine.length; d++) {
    const at = spine[d];
    const c = snapshot.card[at];
    if (c < 0) continue;                       // the goal test: not a placement
    // ── The chosen term is on the CHILD, not on this node ────────────
    //
    // A node decides one card by looping over its terms; the term it keeps is the one it
    // recursed on, and the recursion records it as the child's incoming edge. Reading `edge[at]`
    // instead gives the term the PREVIOUS card took, which is an off-by-one that produces a
    // plausible and completely wrong walkthrough.
    const child = spine[d + 1];
    if (child == null) break;
    const term = snapshot.edge[child];
    place.push({
      card: c,
      title: title(c),
      sh: roster[c]?.sh ?? 0,
      target: roster[c]?.target ?? null,
      term,
      termLabel: labelOf(terms[term]),
      // Every term this course was thrown out of, in the order it tried them — which is
      // `termPreference`'s output, a real decision, so it is not re-sorted.
      rejected: (cutsAt.get(at) ?? []).map(k => ({
        term: snapshot.cutTerm[k],
        termLabel: labelOf(terms[snapshot.cutTerm[k]]),
        cause: CAUSES[snapshot.cutCause[k]] ?? "other",
      })),
      // Arrangements built and undone between the last step sticking and this one.
      cost: Math.max(0, child - at - 1),
      node: at,
    });
  }

  // ── Phase 2, as moves on the same grid ──────────────────────────────
  //
  // Recorded by diffing each named pass rather than by instrumenting the hill climber, so what
  // shows here is the NET effect of each pass — "the depth trade pulled this course forward
  // three semesters" — instead of every move the climber made and unmade on the way.
  const swaps = (snapshot.moveLog ?? []).map(m => ({
    ...m,
    title: title(m.card),
    fromLabel: labelOf(terms[m.from]),
    toLabel: labelOf(terms[m.to]),
  }));

  // The state the search handed to phase 2. Derived from the steps rather than stored, so it
  // cannot disagree with what the walkthrough just showed.
  const afterSearch = new Map(place.map(s => [s.card, s.term]));
  const final = new Map((snapshot.assignment ?? []).map(([c, t]) => [c, t]));

  // ── The variable ordering, for the attempt that ANSWERED ────────────
  //
  // The DFS takes the cards in one order and nothing else decides which card a step is about, so
  // this is the whole answer to "why is it looking at this course now". Read off the attempt the
  // spine belongs to — the last one that started at or before the spine's first node — because a
  // rung re-sorts and an earlier attempt's order describes a plan that was thrown away.
  const attempts = snapshot.attempts ?? [];
  let won = null;
  for (const a of attempts) if (spine.length && a.at <= spine[0]) won = a;
  const ranking = (won?.order ?? []).map((card, i) => ({
    card,
    title: title(card),
    code: roster[card]?.code ?? null,
    ...(won.keys?.[i] ?? {}),
  }));

  return {
    place,
    swaps,
    ranking,
    // Which rung produced it, so the panel can say the order it is showing is the order that
    // worked rather than one of the four that did not.
    rankingTier: won?.tier ?? null,
    afterSearch: [...afterSearch],
    final: [...final],
    // ── How the plan was CONSTRUCTED, because it is not always the search ──
    //
    // The packer is a greedy first-fit-decreasing pass with no tree, so a plan it produced has
    // no spine to walk. Stepping through nothing while the grid shows a full plan would be the
    // view quietly lying about where the plan came from, so the caller is told instead.
    via: place.length ? "search" : (model?.summary.packed ? "packer" : "none"),
    // Whether the walkthrough reproduces the plan that shipped. `false` is a defect, and it is
    // surfaced rather than swallowed: a walkthrough of a different plan is worse than none.
    // ── Vacuously true where there is no walkthrough ─────────────────
    //
    // A packer plan has no spine, so there are no steps and the panel shows none. "What I show
    // adds up" is then trivially satisfied — there is nothing shown to contradict the plan. The
    // first version asserted reconciliation unconditionally and duly flagged every packer plan as
    // broken, which is the test being wrong rather than the view.
    reconciles: place.length
      ? reconciles(afterSearch, swaps, final)
      : true,
    // `full` beside `label`, NOT over it. Overwriting `label` with "Year 1 Fall" while `term` still
    // said "Fall" made every consumer that composes the two print "Year 1 Fall Fall" — including
    // the row names for a shape that runs past the timeline.
    terms: terms.map(t => ({ ...t, full: labelOf(t) })),
    // The employment terms, which the search's `terms` cannot contain: `studyTerms` filters them
    // out, so without this the walkthrough draws a co-op degree with no co-ops in it.
    work: (snapshot.workTerms ?? []).map(t => ({ ...t, full: labelOf(t) })),
    roster: roster.map((r, i) => ({
      card: i, title: r.title, sh: r.sh, target: r.target, code: r.code ?? null,
    })),
    // Subject per card, by roster index. Computed in the engine by `cellSubject` rather than
    // scraped from the title here: a pool spanning several departments has NO one subject, and a
    // regex would confidently give it the first one it saw.
    subjects: roster.map(r => r.subject ?? null),
  };
}

/**
 * The path that returned true, deepest-last.
 *
 * Every node on it is marked `SOLVED`, so the path is exactly the solved nodes of the winning
 * attempt in depth order. Taken from the END of the recording backwards: a generate can contain
 * two searches — the ladder's plan refused by the hard criteria, then the packer, or a whole
 * second pass without breadth guidance — and the earlier one's solved spine is a plan that was
 * thrown away.
 */
export function winningSpine(snapshot) {
  const result = snapshot?.result ?? [];
  const depth = snapshot?.depth ?? [];
  let end = -1;
  for (let i = result.length - 1; i >= 0; i--) if (result[i] === NODE.SOLVED) { end = i; break; }
  if (end < 0) return [];
  // Walk back from the goal test, taking the last solved node at each shallower depth. The
  // spine is contiguous in depth by construction — a solved node's parent is solved — so this
  // cannot skip a level without the recording being malformed.
  const out = [];
  let want = depth[end];
  for (let i = end; i >= 0 && want >= 0; i--) {
    if (result[i] === NODE.SOLVED && depth[i] === want) { out.push(i); want--; }
  }
  return out.reverse();
}

/** Does the search's answer plus the recorded swaps equal the plan that shipped? */
function reconciles(afterSearch, swaps, final) {
  if (!final.size) return !afterSearch.size;
  const rolled = new Map(afterSearch);
  for (const m of swaps) rolled.set(m.card, m.to);
  if (rolled.size !== final.size) return false;
  for (const [c, t] of final) if (rolled.get(c) !== t) return false;
  return true;
}

/**
 * Which SEMESTER each of the shape's terms is — the join that lets the walkthrough play on the
 * reader's own grid instead of on a drawing of one.
 *
 * ── What this replaces, and why a redraw was not enough ─────────────
 *
 * There used to be a `gridRows` here that built a planner-SHAPED grid out of the term list: one
 * row per semester, summer as two halves, a fixed slot count per row. It was an honest attempt to
 * reproduce `SemRow` from the outside and it stayed wrong, because a reproduction can only ever
 * copy the rules someone remembered. It drew four slots for a fall the planner draws five of, it
 * labelled cells with a bare course number where the planner prints a code and a title, and it
 * said "Year 1 Fall" where every other surface in the app says "Fall 2027".
 *
 * So the row rendering is gone entirely: the walkthrough now draws `MiniPlanGrid`, the same
 * component the sample-plan preview draws, over the student's real `SEMESTERS`. All that is left
 * for core to answer is which semester a term IS — and that is exactly what the shape already
 * knows, since `shapeFromPlan` records `semTypeId` and `yearIndex` per term and `applySamplePlan`
 * lands a published plan on the timeline by the very same pair.
 *
 * ── Terms that land nowhere ─────────────────────────────────────────
 *
 * A shape can be longer than the student's timeline. The offer filters variants by year count, so
 * this is rare rather than routine, but "rare" is not "never" and the answer is not to drop the
 * courses that fell off the end — a walkthrough that silently omits a placement is describing a
 * plan the reader is not looking at. Those terms get a semester of their own, built here from the
 * shape's own words, which the grid then draws as an ordinary row.
 *
 * @param {object[]} terms      `buildSteps().terms`, or a snapshot's `terms`
 * @param {object[]} semesters  the planner's `SEMESTERS`
 * @returns {{semIds: (string|null)[], extraSems: object[]}}
 */
export function termSemesters(terms, semesters) {
  const years = academicYears(semesters ?? []);
  const semIds = [];
  const extraSems = [];
  (terms ?? []).forEach((t, i) => {
    const sem = years[t?.yearIndex ?? -1]?.find(s => s.semTypeId === t?.semTypeId);
    if (sem) { semIds[i] = sem.id; return; }
    // Off the end of the timeline (or a trace old enough to carry no join at all). The row is
    // still the plan's, so it is still drawn — named by the shape rather than by the calendar.
    const weight = t?.weight ?? 1;
    const pseudo = {
      // Keyed by the shape's YEAR, not by the term's index, because the grid pairs a summer's two
      // halves by stripping `sumA`/`sumB` off their ids and comparing what is left. Indexed ids
      // leave `x8` against `x9` and the pair splits into two rows, which is the one thing about a
      // summer the planner never does.
      id: `x${t?.yearIndex ?? i}${t?.semTypeId ?? ""}`,
      label: `${t?.label ?? ""} ${t?.term ?? ""}`.trim(),
      sub: "",
      type: themeOf(t?.semTypeId),
      // Blank on purpose: `SEM_NAME_KEY` would name the season and lose the year the shape put in
      // front of it, so a fifth-year fall would read "Fall" directly under a real "Fall 2030".
      semTypeId: "",
      weight,
      maxSlots: weight >= 1 ? 4 : 2,
    };
    semIds[i] = pseudo.id;
    extraSems.push(pseudo);
  });
  return { semIds, extraSems };
}

/**
 * Why this card sits above the next one — the FIRST key on which the two differ.
 *
 * ── Why one key and not five ────────────────────────────────────────
 *
 * The queue beside the walkthrough first showed every key of the comparator as a column of
 * numbers, and the verdict on it was "the numbers don't mean anything to me". That verdict is
 * right, and the reason is structural rather than cosmetic: a five-key comparator uses exactly ONE
 * key to decide any given pair — the first they differ on — and the other four are noise for that
 * pair. Reading five numbers to find the one that mattered is work the reader should not be doing,
 * because the sort already did it.
 *
 * So each row states the key that put it ahead of the row below. Read down the list and you get
 * the sort as a chain of reasons rather than as a table, and every one of those reasons is the
 * comparator's own — this walks the same keys, in the same order, with the same treatment of an
 * open cell's candidate count as unbounded.
 *
 * `null` for the row below is the end of the list, which has nothing to be ahead of.
 *
 * @param {object} a  the row's recorded keys, from `trace.order`
 * @param {object} [b] the keys of the row below it
 * @returns {{key: string, value?: number}|null}
 */
export function orderReason(a, b) {
  if (!a) return null;
  if (!b) return { key: "last" };
  const fa = a.filler ? 1 : 0, fb = b.filler ? 1 : 0;
  if (fa !== fb) return { key: "filler" };
  const ca = a.claim ?? 2, cb = b.claim ?? 2;
  if (ca !== cb) return { key: "claim", value: ca };
  if ((a.terms ?? 0) !== (b.terms ?? 0)) return { key: "terms", value: a.terms ?? 0 };
  // An open cell admits the catalog, so its candidate count is unbounded — the same treatment
  // `byConstraint` gives it. Two open cells tie here rather than both counting as zero.
  const oa = a.options == null ? Infinity : a.options;
  const ob = b.options == null ? Infinity : b.options;
  if (oa !== ob) return { key: "options", value: a.options };
  if ((a.depth ?? 0) !== (b.depth ?? 0)) return { key: "depth", value: a.depth ?? 0 };
  // Identical on every key that means anything. The comparator breaks this by cell id purely for
  // determinism, and saying so is more honest than inventing a reason for an arbitrary order.
  return { key: "tie" };
}

/** The comparator's keys, in the order it consults them. `byConstraint` in `search.js`. */
export const ORDER_KEYS = ["filler", "claim", "terms", "options", "depth", "tie"];

/**
 * Every reason this card is at the FRONT — one per key, with how many rivals that key beat.
 *
 * ── Why one reason is not enough, and five is too many ──────────────
 *
 * `orderReason` answers a pairwise question and one key always settles it. "Why is this one being
 * placed now" is not pairwise: it is this card against everything still unplaced, and it beats
 * different rivals on different keys. A card can be first because it is not an elective (which
 * settles it against the eleven electives), AND because it unlocks a chain (which settles it
 * against nineteen more), AND because only four semesters still fit it (which settles it against
 * the three remaining cards that also unlock something). All three are true, none is the whole
 * answer, and picking one would be arbitrary.
 *
 * So: run the pairwise comparison against every rival, group by the key that decided it, and
 * report each key once with a count. That is the sort's own arithmetic — no key appears unless it
 * really decided something, the counts add up to the number of rivals, and the numbers quoted are
 * this card's own recorded values rather than a description of them.
 *
 * Returned in comparator order, not in count order: the engine consults them in that sequence, and
 * a list that led with whichever key happened to beat the most cards would misrepresent which rule
 * is subordinate to which.
 *
 * @param {object} a     the front card's recorded keys
 * @param {object[]} rest every other card still to place
 * @returns {{key: string, value?: number, beat: number}[]}
 */
export function orderWhy(a, rest) {
  if (!a) return [];
  const groups = new Map();
  for (const b of rest ?? []) {
    // Itself, by identity OR by card. Identity alone is an accident of how the caller happens to
    // build the list — one `.map()` between the queue and here and the card would tie with its own
    // copy, adding a phantom "nothing tells it apart from 1 other" bullet that no rival backs.
    if (b === a || (a.card != null && b?.card === a.card)) continue;
    const r = orderReason(a, b);
    if (!r || r.key === "last") continue;
    const g = groups.get(r.key) ?? { key: r.key, value: r.value, beat: 0 };
    g.beat += 1;
    groups.set(r.key, g);
  }
  return ORDER_KEYS.filter(k => groups.has(k)).map(k => groups.get(k));
}

/** The row theme a term type is drawn in — `semGrid`'s `type`, not its `semTypeId`. */
const themeOf = (semTypeId) =>
  (semTypeId === "sumA" || semTypeId === "sumB") ? "summer" : (semTypeId || "special");

const labelOf = (t) => (t ? `${t.label ?? ""} ${t.term ?? ""}`.trim() : "");

