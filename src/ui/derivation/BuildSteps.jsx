// ═══════════════════════════════════════════════════════════════════
// DERIVATION · watch the plan get built, ON THE PLANNER
//
// ── The fourth version, and the first that does not draw its own grid ─
//
// Three earlier ones were patched toward the planner and a fourth was rewritten "from `SemRow.jsx`
// and `SummerRow.jsx` rather than from a memory of what they look like". That last one was careful
// — it got the equal columns, the fixed slot count and the 3 SH split right — and it still did not
// look like the planner, because a careful copy of a 607-line component is still a copy. It drew
// pills with a bare course number, no title, no seasonal row tint, no months, no load, and it
// named its rows the way the ENGINE names them ("Year 1 Fall") rather than the way every other
// surface in the app does ("Fall 2027").
//
// So this one draws no grid at all. It renders `MiniPlanGrid` — the exact component the sample
// plan preview renders, two dialogs away in the same panel — over the student's own `SEMESTERS`.
// Whatever the preview does, this does, because it is the same code:
//
//   the seasonal row tint, the label column with the written season name, its months and the
//   term's load; cards striped by subject, carrying their code AND their title; summer as one row
//   with two panels; a co-op as a block across the term; an empty slot only where a course could
//   really be added.
//
// The join from the engine's relative shape ("Year 1 Fall") to the reader's absolute semester
// ("Fall 2027") is `termSemesters` in core, and it is the SAME pair of fields `applySamplePlan`
// lands a published plan by — so the walkthrough cannot put a course in a term the apply would
// not.
//
// ── What the walkthrough adds on top, and nothing more ──────────────
//
// Three marks, all of them additive. A card's identity — its colour, its code, its title — never
// changes with its state, so the reader watches one picture change rather than two alternate.
//
//   ONE STEP PER COURSE, and only what changed is bright. Backtracking and swapping are obvious
//   the first time you watch them and nearly impossible to put in a sentence.
//   THE BOUNCES, in place — the semesters this course was thrown out of, struck through in the
//   row it tried. That is what makes the reason real: 92.6% of the engine's own stored reasons
//   are the useless `load-balance`, where "those two were already full" is checkable.
//   THE TARGET ROW lifts, exactly as the live grid lifts the term you drag a card over.
//
// Reservations need no special mark here any more. The old pill grid hatched them because a
// placeholder had no course number to print and would otherwise have been an empty box; the
// planner's own card already says what it is — dashed border, grey stripe, the requirement's name
// in italics — and roughly half a CHART plan by credit is one of these, so this is the difference
// between a picture and a wall of identical rectangles.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage }  from "../../context/LanguageContext.jsx";
import { usePlanner }   from "../../context/PlannerContext.jsx";
import { usePort }      from "../../context/InstitutionContext.jsx";
import { ICreditSystem } from "../../ports/ICreditSystem.js";
import { ISpecialTerms } from "../../ports/ISpecialTerms.js";
import { subjectColor } from "../../core/courseModel.js";
import { semName }      from "../../core/semGrid.js";
import { termSemesters, orderReason, orderWhy, ORDER_KEYS } from "../../core/derivation/steps.js";
import { SEM_NAME_KEY } from "../SemLabel.jsx";
import { planRows, MiniPlanGrid } from "../MiniPlanGrid.jsx";

/** Milliseconds between steps on autoplay. About a heartbeat: fast enough to read as building. */
const TICK = 480;

/**
 * The neutral a placeholder is drawn in — `reservations.js`'s own colour for the same cards on the
 * live grid. A subject colour would claim a department the student has not chosen.
 */
const RESERVATION_COLOUR = "#94a3b8";

/** Months a full-weight term covers, for stating a co-op run's length. Matches `applySamplePlan`. */
const MONTHS_PER_UNIT_WEIGHT = 4;

/**
 * The two columns, stated once.
 *
 * The header row and the body row both use them, which is what lets each control sit over the
 * thing it acts on — the sentence over the plan, the transport over the queue. Two independent
 * widths would agree until the first time one of them changed.
 */
const QUEUE_W = 224;
const COL_GAP = 10;

export default function BuildSteps({ steps, isPhone }) {
  const { t } = useLanguage();
  // `studentType` because the credit ceiling is per student type — a graduate term is full at a
  // load an undergraduate one has room in, and an empty slot is a claim about room.
  // `SEM_INDEX` because a co-op run is a stretch of ADJACENT semesters, and only the planner's own
  // ordering knows which those are.
  const { SEMESTERS, SEM_INDEX, studentType } = usePlanner();
  const credit  = usePort(ICreditSystem);
  const special = usePort(ISpecialTerms);
  const fz  = isPhone ? 9 : 11;
  // The caption's own size. It is the one sentence on the page and it is now the page's lead, so
  // it sits above the control labels rather than beside them.
  const fzL = isPhone ? 11 : 14;

  const place = steps?.place ?? [];
  const swaps = steps?.swaps ?? [];
  // ONE timeline: every placement, then every swap. A reader does not care that the engine changed
  // algorithm halfway; they care that the plan filled up and then some courses moved.
  const total = place.length + swaps.length;

  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef(null);

  useEffect(() => { setAt(0); setPlaying(false); }, [total]);
  useEffect(() => {
    if (!playing) return undefined;
    timer.current = setInterval(
      () => setAt(v => { if (v >= total) { setPlaying(false); return v; } return v + 1; }),
      TICK);
    return () => clearInterval(timer.current);
  }, [playing, total]);

  // ── The grid: the reader's semesters, plus any the shape ran past ──
  //
  // Two joins, because the engine has two term lists. `steps.terms` is what the search placed into
  // and is what every term index in the recording points at; `steps.work` is the employment the
  // shape carries, which the search never sees. Both have to land on the grid or the picture is of
  // a different degree.
  const { semIds, extraSems } = useMemo(
    () => termSemesters(steps?.terms ?? [], SEMESTERS), [steps, SEMESTERS]);
  const workJoin = useMemo(
    () => termSemesters(steps?.work ?? [], SEMESTERS), [steps, SEMESTERS]);
  const rows = useMemo(() => {
    // Off-timeline rows from either join, de-duplicated by id: a shape cannot hold two terms with
    // the same year and season, so the same id twice means the two joins agree about one row.
    const extra = [...extraSems, ...workJoin.extraSems]
      .filter((s, i, all) => all.findIndex(x => x.id === s.id) === i);
    return planRows([...SEMESTERS, ...extra]);
  }, [SEMESTERS, extraSems, workJoin]);

  // ── The cards, in the shape the planner's own card component reads ──
  //
  // A cell that names exactly one course is a course card: its code, its title, its subject's
  // colour. A cell that names a requirement is a reservation, and `MiniCard` already knows how to
  // draw one — the requirement's title as the name, in italics behind a dashed border. Building
  // both here rather than in core because `subjectColor` is the app's palette, and the whole point
  // is that a course is the colour the planner already paints it.
  const cards = useMemo(() => {
    const out = {};
    (steps?.roster ?? []).forEach((r, i) => {
      const code = spaced(r.code);
      const named = !!code;
      out[cardId(i)] = named
        ? {
            id: cardId(i), isReservation: false, code,
            title: r.title ?? "", sh: r.sh ?? 0,
            color: subjectColor(steps.subjects?.[i] ?? code.split(" ")[0]),
          }
        : {
            id: cardId(i), isReservation: true,
            // `code` is the plan's own wording and `title` the requirement's. A generated cell has
            // only the one string, so it is the name and there is no second line to print.
            code: "", title: r.title ?? "", sh: r.sh ?? 0,
            color: RESERVATION_COLOUR,
          };
    });
    return out;
  }, [steps]);

  // ── The plan as of step `at` ────────────────────────────────────────
  //
  // Rebuilt from scratch each step rather than mutated: `at` can jump anywhere, and an incremental
  // applier would need an inverse for every kind of step — the one place a stale course could
  // survive a scrub and show a plan that never existed. At ~40 steps this costs nothing.
  //
  // `occupants` is inserted in PLACEMENT order, which is the order `getOrderedCourses` falls back
  // to with no `semOrders`. So a course keeps its position in a term as later ones land beside it;
  // sorting by title would make a card jump sideways when an unrelated one arrives, and that is
  // movement that did not happen.
  const view = useMemo(() => {
    const n = Math.max(0, Math.min(at, total));
    const where = new Map();
    for (let i = 0; i < Math.min(n, place.length); i++) where.set(place[i].card, place[i].term);
    for (let i = 0; i < Math.max(0, n - place.length); i++) where.set(swaps[i].card, swaps[i].to);
    const occupants = {};
    for (const [c, term] of where) {
      const semId = semIds[term];
      if (semId) occupants[cardId(c)] = semId;
    }
    const cur = n === 0 ? null
      : n <= place.length ? { kind: "place", step: place[n - 1] }
      : { kind: "swap", step: swaps[n - place.length - 1] };
    // What was already placed when this step STARTED. The queue beside the grid is the engine's
    // to-do list at that moment, so the course the step is about has to still be on it — showing
    // the list after the placement would answer "why this one" with the one already gone.
    //
    // Except at the END, where there is no step in flight: holding the last card back then left
    // the queue showing one course for ever, next to a grid on which it is plainly already placed.
    // The finished state is finished on both sides.
    const upto = n >= total ? place.length : Math.max(0, n - 1);
    const placedBefore = new Set();
    for (let i = 0; i < Math.min(upto, place.length); i++) placedBefore.add(place[i].card);
    return { view: { occupants, cards }, cur, done: n >= total, placedBefore };
  }, [at, total, place, swaps, semIds, cards]);

  // ── Work terms, as the runs the planner draws them as ───────────────
  //
  // The shape says which terms are employment; consecutive ones are ONE co-op, because that is
  // what they are — a six-month block, not two independent terms — and it is how `SemRow` and the
  // preview both render them. Duration is read off the terms' own weights rather than assumed to
  // be six: a shape with a four-month single-term co-op would otherwise be labelled wrongly.
  const work = useMemo(() => {
    const terms = steps?.work ?? [];
    const ids = workJoin.semIds;
    const coops = [], startMap = {}, contMap = {}, specialTermPl = {};
    let i = 0;
    while (i < terms.length) {
      if (!ids[i]) { i += 1; continue; }
      const spans = [];
      let weight = 0;
      // ── A run breaks on the CALENDAR, not on the list ────────────────
      //
      // The work list holds only employment terms, so its entries are adjacent to each other by
      // construction and tell you nothing about whether they are adjacent in time. International
      // Business is the case: its four work terms are Year 2 spring + summer 1 and Year 3 spring +
      // summer 1 — two separate six-month co-ops with a whole academic year between them — and
      // merging on list order alone drew one twelve-month block spanning that year.
      while (i < terms.length && ids[i]
             && (!spans.length || SEM_INDEX[ids[i]] === SEM_INDEX[spans[spans.length - 1]] + 1)) {
        spans.push(ids[i]); weight += terms[i].weight ?? 1; i += 1;
      }
      const id = `deriv-coop-${spans[0]}`;
      coops.push({ id, semId: spans[0], spans, duration: Math.round(weight * MONTHS_PER_UNIT_WEIGHT) });
      specialTermPl[id] = { typeId: "coop", semId: spans[0] };
      startMap[spans[0]] = id;
      for (const s of spans.slice(1)) contMap[s] = id;
    }
    return { laid: { coops, specialTermPl }, startMap, contMap };
  }, [steps, workJoin, SEM_INDEX]);

  // ── The three marks ─────────────────────────────────────────────────
  const cur = view.cur;
  const liveId = cur ? cardId(cur.step.card) : null;
  // The last step is not a step, it is the finished plan: nothing is dimmed, nothing is ringed and
  // nothing is struck through, because that is the frame a reader stops on and reads.
  const done = view.done;
  const dimming = !!cur && !done;
  const decor = useMemo(() => ({
    cardState: (card) => (done ? undefined
      : card.id === liveId ? "live" : dimming ? "dim" : undefined),
    // ── The bounces belong to the step in flight, and to nothing else ──
    //
    // They are what this course tried on its way here, not a running tally, so they clear the
    // moment the step advances. And `done` clears them too: at the last step the walkthrough is
    // no longer showing a step, it is showing THE PLAN, and a plan with courses struck through in
    // semesters they are not in is not the plan — it is the last frame of the animation left on
    // screen. That is the state a reader stops on, so it is the one that must be clean.
    ghostsIn: (semId) => (cur?.kind === "place" && !done
      ? cur.step.rejected.filter(r => semIds[r.term] === semId).map(() => cards[liveId])
      : []).filter(Boolean),
    rowState: (semId) => {
      if (done) return undefined;
      const target = cur?.kind === "place" ? cur.step.term
        : cur?.kind === "swap" ? cur.step.to : -1;
      return semIds[target] === semId ? "target" : undefined;
    },
  }), [cur, liveId, dimming, done, semIds, cards]);

  if (!total) return null;

  // The same context bag the preview passes its rows, minus everything only a real applied plan
  // has: there is no `programData` here and no student placements, just the search's own answer.
  const ctx = {
    view: view.view, startMap: work.startMap, contMap: work.contMap, laid: work.laid,
    types: special.getTypes?.() ?? [], unit: credit.getUnitName(), isPhone, t,
    termMax: credit.getSemesterMax?.(studentType) ?? Infinity,
    oneCourse: credit.getStandardValue?.() ?? 4,
    decor,
    // A walkthrough you have to scroll is not a walkthrough: a course landing in year 4 while the
    // reader is looking at year 1 is a step they did not see. Dense keeps every row of the plan on
    // screen at once, and changes nothing but the metrics.
    dense: true,
  };

  return (
    <div>
      {/* ── One band: the transport, the count, and what just happened ──
        *
        * This was four stacked things — a section heading, a row of buttons with a quarter of the
        * dialog empty beside them, a full-width centred sentence, and only then the plan. Three of
        * those bands were mostly air, and the sentence sat far enough from the buttons that it
        * read as a caption to nothing.
        *
        * They belong together: the buttons move the step and the sentence says what the step did,
        * so they are one control. The sentence takes the room to the right of the buttons that was
        * empty anyway, which is also why it is no longer centred — a line that starts at a
        * different x on every step is a line the eye has to hunt for, and it will change on every
        * one of the forty steps.
        *
        * The height is fixed at two lines. Without it, a step whose sentence wraps shoves the
        * whole plan down a line — movement the plan did not make, on the one surface whose entire
        * job is to show movement that did. */}
      {/* ── The header band, in the same two columns as the body ──────
        *
        * Each half sits over what it belongs to: the sentence over the plan it describes, the
        * transport over the queue it advances. That is the whole reason for the arrangement — an
        * earlier version had the buttons hard left and the sentence filling the rest, which put
        * the controls over the corner of a grid they say nothing about and left the sentence
        * starting at a different x every step.
        *
        * The columns are the same two constants the body uses, so the two rows cannot drift.
        * Height is fixed at two lines of the caption: without it, a step whose sentence wraps
        * shoves the whole plan down a line — movement the plan did not make, on the one surface
        * whose entire job is showing movement that did. */}
      <div style={{
        display: "flex", alignItems: "center", gap: COL_GAP, marginBottom: 6,
        minHeight: Math.round(fzL * 3),
      }}>
        <div style={{
          flex: 1, minWidth: 0, fontSize: fzL, color: "var(--text-2)", lineHeight: 1.4,
          textAlign: "center", padding: "0 6px",
        }}>
          {caption(cur, t, at, total, steps, view, (i) => termName(semIds[i], SEMESTERS, steps, i, t))}
        </div>
        <div style={{
          flex: isPhone ? "0 0 auto" : `0 0 ${QUEUE_W}px`,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
        }}>
          <Btn onClick={() => { setPlaying(false); setAt(0); }} label="⏮" fz={fz} title={t("chart.deriv.play.start")} />
          <Btn onClick={() => { setPlaying(false); setAt(v => Math.max(0, v - 1)); }} label="◀" fz={fz} title={t("chart.deriv.play.prev")} />
          <Btn
            onClick={() => { if (at >= total) setAt(0); setPlaying(p => !p); }}
            label={playing ? "❙❙" : "▶"} fz={fz} wide
            title={t(playing ? "chart.deriv.play.pause" : "chart.deriv.play.play")}
          />
          <Btn onClick={() => { setPlaying(false); setAt(v => Math.min(total, v + 1)); }} label="▶" fz={fz} title={t("chart.deriv.play.next")} />
          <span style={{ fontSize: fz, color: "var(--text-4)", marginInlineStart: 2,
                         fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {t("chart.deriv.play.step", { n: at, total })}
          </span>
        </div>
      </div>

      {/* `stretch`, so the queue is exactly as tall as the grid beside it and its list scrolls
          inside that height. Anything else needs a measured pixel value, and a measured height is
          one resize away from being wrong. */}
      <div style={{ display: "flex", gap: COL_GAP, alignItems: "stretch" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <MiniPlanGrid rows={rows} {...ctx} />
        </div>
        {/* Not on a phone. The queue is a five-column table of small numbers; at phone width it
            would either wrap into nonsense or take the space the grid needs to stay one screen. */}
        {!isPhone && (
          <RankQueue
            ranking={steps?.ranking ?? []} cards={cards} placed={view.placedBefore}
            liveCard={cur?.kind === "place" ? cur.step.card : -1} t={t} fz={fz}
            totalTerms={(steps?.terms ?? []).length}
          />
        )}
      </div>
    </div>
  );
}

/**
 * ── The queue: why THIS course, and not one of the other twenty ─────
 *
 * The walkthrough could say where a course went and why it did not fit the semesters it tried. It
 * could not say why the engine was looking at that course at all, which is the question a reader
 * asks first — and the honest answer is not a story about the course, it is a SORT. The DFS takes
 * the cards in one fixed order per attempt and nothing else chooses; so this shows the sort, with
 * the numbers it sorted on, and the course the current step is about is the top of it.
 *
 * ── The comparator, in full, in its own order ───────────────────────
 *
 * `byConstraint` in `search.js`, and the panel shows every key it compares on. An earlier version
 * of this showed the last three and let the first two be implied, which is the same failure as
 * explaining a decision by its tie-breaks: the two keys it left out are the ones the whole engine
 * exists for.
 *
 *   1. FILLER LAST. A cell that admits any course (`candidates === null`) claims nothing, so it
 *      takes what is left. This is the founding complaint about published plans — they spend the
 *      free electives before the first co-op — and it is one key, unconditionally, at the top.
 *      The one exception is rule 4: a DEPTH elective in a degree whose own chains are shallower
 *      than a generic advanced course is not filler, because there the electives are the depth.
 *   2. CLAIM. Who gets a scarce early semester, stated rather than inferred from width:
 *        unlocks   a chain-bearing course — everything else depends on it
 *        major     a major-subject pool, or a depth elective that beat rule 4's comparison.
 *                  The deliberate inversion: this is what published plans put last
 *        other     everything else specific, including a requirement that unlocks nothing
 *   3. SEM. How many semesters are still legal for it, fewest first — most-constrained-first.
 *   4. OPT. How many courses could fill it, fewest first.
 *   5. CHAIN. How many courses must follow it, deepest first, as a tie-break at equal width.
 *
 * (There is a sixth key, the cell id, purely so two runs of the same degree agree. It decides
 * nothing and is not shown — diversifying it was tried and rescued no plans.)
 *
 * The values are the engine's own, recorded at the moment it sorted (`trace.order`), not recomputed
 * here from something that looks like them. A panel that re-derived them would eventually disagree
 * with the order it is drawn beside, and then it would be explaining a decision nobody made.
 */
function RankQueue({ ranking, cards, placed, liveCard, t, fz, totalTerms }) {
  // Collapsed by default, and the state lives here rather than in the parent: it is a preference
  // about reading this panel, not a fact about the walkthrough, and it must survive every step.
  const [ladderOpen, setLadder] = useState(false);
  const left = ranking.filter(r => !placed.has(r.card));
  const live = left[0]?.card === liveCard ? left[0] : left.find(r => r.card === liveCard);
  // The key that separates the front card from the one immediately behind it — the reason it is
  // first rather than second, and so the reason this step is about this course.
  const principal = live ? orderReason(live, left[left.indexOf(live) + 1])?.key : null;
  const name = (r) => {
    const card = cards[cardId(r.card)];
    return card?.isReservation === false ? card.code : (r.title || "—");
  };

  return (
    <div style={{ flex: `0 0 ${QUEUE_W}px`, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: fz + 1, fontWeight: 700, color: "var(--text-2)", marginBottom: 2 }}>
        {t("chart.deriv.rank.h")}
      </div>
      {/* ── The ladder: one line by default, five on request ──────────
        *
        * The bullets below name reasons and, left to themselves, they read as reasons ACCUMULATING
        * — as if the engine weighed five things and this card came out on top. It does not. The
        * comparison is lexicographic: five tests in a fixed order, and the first one that separates
        * two cards decides them outright. A card can be the narrowest thing in the program and
        * still go last for being an open elective, because test 1 settled it and tests 2 to 5 were
        * never reached.
        *
        * That is the one thing about the ordering a reader cannot infer from any single card, so it
        * is stated rather than implied — but it took seven lines to state, permanently, above a
        * list whose whole value is being long enough to scroll. Collapsed, the sentence keeps the
        * part that cannot be worked out ("the first difference decides") and defers the part that
        * can be read off the bullets themselves (which five tests, in what order).
        *
        * Open by one click, and the numbers on the bullets are the numbers in here. */}
      <button
        onClick={() => setLadder(v => !v)}
        aria-expanded={ladderOpen}
        style={{
          fontSize: fz - 1, color: "var(--text-5)", lineHeight: 1.4, textAlign: "start",
          background: "none", border: "none", padding: 0, marginBottom: 4, cursor: "pointer",
          display: "flex", gap: 4,
        }}
      >
        <span aria-hidden="true">{ladderOpen ? "▾" : "▸"}</span>
        <span>{t(ladderOpen ? "chart.deriv.rank.rule" : "chart.deriv.rank.rule.short")}</span>
      </button>
      {ladderOpen && (
        <ol style={{
          margin: "0 0 7px", paddingInlineStart: 0, listStyle: "none",
          fontSize: fz - 1, color: "var(--text-4)", lineHeight: 1.5,
        }}>
          {RUNGS.map((key, i) => (
            <li key={key} style={{ display: "flex", gap: 5 }}>
              <span style={{ color: "var(--text-5)", fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>
              <span>{t(`chart.deriv.rank.rung.${key}`)}</span>
            </li>
          ))}
        </ol>
      )}

      {!left.length && (
        <div style={{ fontSize: fz, color: "var(--text-4)", lineHeight: 1.45 }}>
          {t("chart.deriv.rank.none")}
        </div>
      )}

      {/* ── The one at the front, in a sentence ───────────────────────
        * The rest of the list is two or three words a row, which is right for scanning and wrong
        * for the row a reader is actually asking about. That one gets prose: what it claims, and
        * the key that put it in front. */}
      {!!live && (
        <div style={{
          border: "1px solid var(--active)", background: "var(--active-bg)", borderRadius: 5,
          padding: "5px 7px", marginBottom: 6,
        }}>
          <div style={{ fontSize: fz + 1, fontWeight: 700, color: "var(--text-1)",
                        overflow: "hidden", textOverflow: "ellipsis" }} title={live.title}>
            {name(live)}
          </div>
          {/* ── One bullet per key that actually beat something ─────────
            * Not one reason and not five columns: the keys that DECIDED this card against the
            * rest, each with the number of cards it settled and the value it was settled on. The
            * counts sum to the size of the queue behind it, which is what makes the list a
            * derivation rather than a description of one. */}
          {/* An ordered list, numbered by RUNG rather than by position — `value` sets each item's
              number, so a card decided by tests 2 and 4 shows "2." and "4." and the gap says the
              missing tests were never reached. A plain 1,2,3 would say the reasons are ranked by
              this card, which is exactly the misreading the ladder above exists to prevent. */}
          <ol style={{ margin: "3px 0 0", paddingInlineStart: 17 }}>
            {orderWhy(live, left).map(w => (
              <li key={w.key} style={{
                fontSize: fz, lineHeight: 1.45, marginTop: 1,
                // ── The principal reason, in bold ──────────────────────
                //
                // Several of these can be true at once and they are not equal. The one that puts
                // this card AT THE TOP is the key that separates it from the RUNNER-UP: lose that
                // key and it is second, whatever the other bullets say. The rest explain why it is
                // ahead of cards further down, which is a weaker claim and reads as one.
                //
                // Taken from `orderReason` against the next card in the queue rather than from the
                // first bullet in the list: the two usually agree and they come apart exactly when
                // it matters — where a low-numbered test beats a crowd at the back while a
                // higher-numbered one settles the card in second place.
                fontWeight: w.key === principal ? 700 : 400,
                color: w.key === principal ? "var(--text-1)" : "var(--text-3)",
                // The tie is not a rung — it is what is left when all five tests have failed to
                // separate two cards — so it carries no number rather than a "0" or a phantom "6".
                listStyle: w.key === "tie" ? "none" : undefined,
                marginInlineStart: w.key === "tie" ? -13 : undefined,
              }} value={w.key === "tie" ? undefined : RUNGS.indexOf(w.key) + 1}>
                {whyText(w, totalTerms, t)}
                {/* The tally, quietly, after the reason. A tie beat nobody — it is the absence of a
                    reason — so it gets no count, which is also how it reads. */}
                {w.key !== "tie" && (
                  <span style={{ color: "var(--text-5)" }}>
                    {" · "}{t("chart.deriv.rank.why2.ahead", { beat: w.beat })}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Every card still to place, scrolling. It used to be the first nine and a "+25 more", which
          is the shape of the argument the panel is making — the LIST is the logic, and truncating
          it at nine hid the whole tail where the electives sit. */}
      <div style={{ overflowY: "auto", minHeight: 0, flex: "1 1 auto" }}>
        {left.filter(r => r !== live).map((r, i, arr) => (
          <div key={r.card} style={{
            display: "flex", alignItems: "baseline", gap: 6,
            padding: "2px 1px", borderTop: i ? "1px solid var(--border-sub)" : "none",
          }}>
            <span style={{
              fontSize: fz, color: "var(--text-3)", flex: "1 1 auto", minWidth: 0,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }} title={r.title}>{name(r)}</span>
            {/* Against the NEXT row in the list as drawn, which is the order the reader sees. */}
            <span style={{
              fontSize: fz - 1, color: "var(--text-5)", flex: "0 1 auto", textAlign: "end",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>{reasonText(orderReason(r, arr[i + 1]), t)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One bullet: the key, the number this card was judged on, and how many cards it settled.
 *
 * Both numbers are stated because either alone is unreadable. "Only 4 semesters fit it" is a fact
 * about the card and says nothing about why it goes FIRST; "ahead of 3 others" says it went first
 * and not why. Together they are the comparison the engine made.
 */
function whyText(w, totalTerms, t) {
  const base = w.key === "claim" ? `claim.${w.value ?? 2}` : w.key;
  // A dedicated line for the count of one. "Only 1 course(s) can fill it" is the kind of copy that
  // makes a reader distrust the number beside it, and the singular case is not a rounding of the
  // plural here — "exactly one course can fill it" means there is no choice to make, which is a
  // stronger and clearer statement than "only 1".
  const one = (w.key === "tie" ? w.beat : w.value) === 1;
  const key = one && ["terms", "options", "depth", "tie"].includes(w.key) ? `${base}.one` : base;
  return t(`chart.deriv.rank.why2.${key}`, { n: w.value ?? 0, beat: w.beat, total: totalTerms });
}

/** One reason, in words. `null` where there is no row below to be ahead of. */
function reasonText(reason, t) {
  if (!reason) return "";
  if (reason.key === "filler" || reason.key === "claim" || reason.key === "tie"
      || reason.key === "last") {
    return t(`chart.deriv.rank.why.${reason.key}${reason.key === "claim" ? `.${reason.value}` : ""}`);
  }
  return t(`chart.deriv.rank.why.${reason.key}`, { n: reason.value ?? 0 });
}

/**
 * The five tests, in the order the comparator consults them.
 *
 * `ORDER_KEYS` minus `tie`, deliberately: a tie is not a test, it is what is left when all five
 * have failed to separate two cards, and numbering it "6" would present the alphabetical
 * tie-break as a rule about degrees rather than a device for repeatability.
 */
const RUNGS = ORDER_KEYS.filter(k => k !== "tie");

/** The roster index as an id the planner's own helpers can key on. */
const cardId = (i) => `deriv-${i}`;

/**
 * "CS1800" → "CS 1800", the way the catalog prints it — and "" for a cell that names no single
 * course, which is what tells the card apart from a reservation.
 */
function spaced(code) {
  const m = /^([A-Z]{2,5})\s*(\d{3,4})$/.exec(String(code ?? "").trim());
  return m ? `${m[1]} ${m[2]}` : "";
}

/**
 * A term's name for the CAPTION, composed exactly as the row above it composes its own.
 *
 * The sentence and the grid naming the same semester differently is the specific fault this whole
 * rewrite is about, so the caption reads the mapped semester rather than the shape's words. A term
 * that landed on no semester falls back to those words, which is also what its row is labelled
 * with.
 */
function termName(semId, semesters, steps, termIndex, t) {
  const sem = (semesters ?? []).find(s => s.id === semId);
  if (!sem) return steps?.terms?.[termIndex]?.full ?? "";
  const key = SEM_NAME_KEY[sem.semTypeId];
  const year = sem.label.match(/\d{4}/)?.[0] ?? "";
  return key ? semName(t, key, year) : sem.label;
}

/** The current step, in one line. Written per kind: four different events, four sentences. */
function caption(cur, t, at, total, steps, view, nameOf) {
  if (at === 0) return t("chart.deriv.step.start", { n: steps.place.length });
  if (view.done) {
    return steps.via === "packer" ? t("chart.deriv.step.packed") : t("chart.deriv.step.done");
  }
  if (cur?.kind === "swap") {
    const key = cur.step.pass.startsWith("rank:") ? "rank" : cur.step.pass;
    return t(`chart.deriv.pass.${key}`,
             { title: cur.step.title, from: nameOf(cur.step.from), to: nameOf(cur.step.to) });
  }
  const s = cur.step;
  let line = t("chart.deriv.step.place", { title: s.title, term: nameOf(s.term) });
  if (s.rejected.length) {
    line += ` ${t("chart.deriv.step.bounced", {
      n: s.rejected.length, why: t(`chart.deriv.cause.${s.rejected[0].cause}`),
    })}`;
  }
  // Only where there was work to report. "0 arrangements undone" is not information; 4,101 of
  // them is the whole story of a hard degree, told at the step where it happened.
  if (s.cost >= 50) line += ` ${t("chart.deriv.step.cost", { n: s.cost.toLocaleString() })}`;
  return line;
}

const Btn = ({ onClick, label, fz, wide, title }) => (
  <button
    onClick={onClick} title={title} aria-label={title}
    style={{
      fontSize: fz, lineHeight: 1, padding: wide ? "4px 12px" : "4px 7px",
      borderRadius: 5, border: "1px solid var(--border-2)",
      background: "var(--bg-surface-2)", color: "var(--text-2)", cursor: "pointer",
    }}
  >{label}</button>
);

// ── The seek track is gone, and the search profile with it ──────────
//
// It was the depth profile drawn as a 640-point sawtooth with a handle on it, and the argument was
// that it showed how much work sat between one step and the next: thousands of arrangements built
// and undone for a saturated degree, appearing exactly where it happened. That argument is true
// and it did not survive being looked at. At 26px tall it reads as an audio waveform, it is the
// same shape for every hard degree, and it sat directly above the grid — so the most prominent
// element on the page was the one a reader could do the least with, and the sentence that says
// what just happened was pushed below the picture it describes.
//
// The information itself is not lost: the cost of a step is already in the caption, in words, at
// the step where it happened ("4,101 arrangements undone"), which is the form a reader can use.
// `model.profile` is still computed and still tested — the panel simply no longer draws it.
