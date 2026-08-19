// ═══════════════════════════════════════════════════════════════════
// MINI PLAN GRID — the planner's rows, drawn small and static
//
// Extracted from `SamplePlanPreview.jsx`, which is where all of this was written and where the
// reasoning below was argued out. It moved here for one reason: a SECOND surface needed the same
// picture — the derivation walkthrough on the "how this plan was built" dialog — and the version
// it had was a hand copy of `SemRow`'s grammar at pill scale. Every hand copy of this drifts. The
// walkthrough's copy drew fixed slot counts the planner no longer uses, labelled cells with a bare
// course number, and showed the engine's own "Year 1 Fall" where the planner says "Fall 2027".
//
// So there is now ONE miniature, with two callers:
//
//   SamplePlanPreview   the plan a student is about to commit to
//   BuildSteps          the same plan, being assembled one course at a time
//
// ── What makes it the planner and not a chart ───────────────────────
//
// The seasonal row tint (`TYPE_BG`), a label column carrying the written season name, its months
// and the term's load, summer as ONE row with two panels, cards striped by subject on the left
// edge, a co-op as a block across the term rather than a card in it, and an empty slot only where
// a course could actually be added. Those are the planner's own facts, read from the same
// helpers the live grid reads (`cardsIn`, `loadIn`, `semName`, `TYPE_BG`), never re-derived.
//
// It is a reduced RE-RENDER, not the live grid: `SemRow` (607 lines) and `SummerRow` (363) are
// wired into `usePlanner()`, drag state, hover zones and reveal targets, so they cannot be dropped
// into a dialog. What must not diverge — card resolution, ordering, term load — is computed by the
// shared pure helpers, so the two surfaces can only differ in chrome.
//
// ── The decoration layer ────────────────────────────────────────────
//
// The walkthrough needs to say things about a cell that the preview has no use for: this one just
// landed, that one is being ignored for a moment, this one was thrown out of here. Those arrive as
// an optional `decor` object of pure lookups. With no `decor` the grid renders exactly as the
// preview always did — which is the property that keeps the extraction honest, and is what
// `test/unit/mini-plan-grid.test.js` pins.
// ═══════════════════════════════════════════════════════════════════
import { useState }           from "react";
import { usePort }            from "../context/InstitutionContext.jsx";
import { ICalendar }          from "../ports/ICalendar.js";
import { TText, useTranslatedText, scaleLatinRuns } from "../context/TranslationContext.jsx";
import { SEM_NAME_KEY }       from "./SemLabel.jsx";
import { semName }            from "../core/semGrid.js";
import { TYPE_BG }            from "../core/constants.js";
import { cardsIn, loadIn }    from "../core/semesterView.js";
import { useCourseInk }       from "./useSubjectInk.js";
import { reservationNameSource, reservationSubline, optionGroupsText, cardOptionGroups } from "../core/reservations.js";
import { CardHover }          from "./HoverCard.jsx";

/**
 * ── Type scale ─────────────────────────────────────────────────────
 *
 * Five steps, and nothing outside them. The first draft of this grew its sizes by shrinking until
 * things fit — 7.5, 8.5, 9.5 — which is how a reading surface ends up smaller than the working
 * surface it depicts. The planner itself sets course codes at 11 and semester names at 12; a
 * preview meant to be READ has no business going below that.
 *
 * Three rules held here:
 *
 *   1. **A floor of 11px.** Below roughly 11 the x-height of Inter at typical viewing distance
 *      stops carrying lowercase reliably, and CJK glyphs lose internal strokes outright.
 *   2. **Integers only.** Fractional sizes rasterise inconsistently between the two halves of a
 *      split row, so 8.5px text looked blurrier in one column than the next.
 *   3. **Separation where it carries meaning.** The steps are close at the bottom (11/12) because
 *      those two are also separated by weight and colour — a bold coloured code against muted
 *      regular metadata — and widen at the top (14, 18) where size is doing the work alone.
 */
export const TYPE = {
  eyebrow: 10,   // uppercase, letterspaced — presence comes from tracking
  meta:    11,   // term sub-label, load, course titles, footnotes
  body:    12,   // course codes, work blocks
  lead:    14,   // semester names, the variant label
  title:   18,   // the program
  action:  13,   // buttons
};

/**
 * The rows, paired exactly as `App.jsx` pairs them: consecutive sumA + sumB share one row.
 *
 * The Incoming Credit row is dropped — neither caller ever places transfer credit, so it would be
 * a permanently empty row at the top of both.
 *
 * @param {object[]} semesters the planner's `SEMESTERS`
 * @returns {{kind: "term"|"summer", sems: object[]}[]}
 */
export function planRows(semesters) {
  const out = [];
  let i = 0;
  while (i < (semesters?.length ?? 0)) {
    const sem = semesters[i], next = semesters[i + 1];
    if (sem.id === "incoming") { i += 1; continue; }
    if (sem.type === "summer" && next?.type === "summer" &&
        next.id.replace("sumB", "") === sem.id.replace("sumA", "")) {
      out.push({ kind: "summer", sems: [sem, next] }); i += 2;
    } else if (sem.type === "summer") {
      out.push({ kind: "summer", sems: [sem] }); i += 1;
    } else {
      out.push({ kind: "term", sems: [sem] }); i += 1;
    }
  }
  return out;
}

/**
 * ── `dense`: the same grid, sized to be seen whole ──────────────────
 *
 * The preview is a document — one plan, scrolled, read. The walkthrough is a MOVIE, and a movie
 * you have to scroll is not one: a course landing in year 4 while the reader is looking at year 1
 * is a step that did not happen as far as they are concerned. Four years is 12 rows, and at the
 * preview's metrics that is roughly 1,100px of dialog.
 *
 * So dense changes METRICS ONLY — row height, card height, padding — and nothing about the
 * grammar. Same seasonal tint, same label column, same subject stripe, same summer split, same
 * work block. The one thing it drops is the card's second line, and it drops it asymmetrically:
 * a course keeps its CODE and loses its title, while a placeholder's name IS its first line and
 * survives untouched. That is the line that carries the most per pixel on each kind of card, and
 * a plan that is roughly half placeholders by credit would be unreadable the other way round.
 */
const M = (dense) => (dense
  // Not as tight as it can be. The first dense pass squeezed to the pixel — 26px cards, 3px gaps —
  // and a plan drawn that way reads as a spreadsheet: nothing has room around it, so nothing looks
  // like a card. Moving the four statistics off the top of the page bought about 90px, and it is
  // better spent giving twelve rows air than on a thirteenth row nobody needed.
  ? { rowPad: "5px 7px", rowMin: 38, rowGap: 4, cardMin: 32, cardPad: "3px 6px 3px 10px", basis: 90 }
  : { rowPad: "7px 8px", rowMin: 58, rowGap: 4, cardMin: 44, cardPad: "4px 6px 4px 10px", basis: 104 });

/** Every row of a plan, in order. `ctx` is the bag both row kinds read; see `MiniTermRow`. */
export function MiniPlanGrid({ rows, ...ctx }) {
  return rows.map(row => row.kind === "summer"
    ? <MiniSummerRow key={row.sems[0].id} sems={row.sems} {...ctx} />
    : <MiniTermRow   key={row.sems[0].id} sem={row.sems[0]}  {...ctx} />);
}

/** A fall/spring row: label column, then the term's cards. */
export function MiniTermRow({ sem, view, startMap, contMap, laid, types, unit, isPhone, t,
                              termMax, oneCourse, decor, dense }) {
  const m     = M(dense);
  const tb    = TYPE_BG[sem.type] ?? TYPE_BG.special;
  const cards = cardsIn(sem.id, view);
  const run   = runFor(sem.id, laid, startMap, contMap);
  // The row a step is acting on lifts, exactly as the live grid lifts the term you are dragging
  // over. Nothing else about the row changes: the reader is following one course, and a second
  // moving part on the row it lands in is noise.
  const lit   = decor?.rowState?.(sem.id) === "target";

  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 8,
      background: lit ? "var(--active-bg)" : tb.bg,
      border: `1px solid ${lit ? "var(--active)" : tb.border}`, borderRadius: 6,
      padding: m.rowPad, marginBottom: m.rowGap, minHeight: m.rowMin,
      transition: "background 120ms linear, border-color 120ms linear",
    }}>
      <SemLabelCol sem={sem} sh={loadIn(sem.id, view, startMap, contMap)} unit={unit}
                   isPhone={isPhone} t={t} dense={dense} />
      <TermBody cards={cards} sem={sem} tb={tb} run={run} types={types} t={t}
                termMax={termMax} oneCourse={oneCourse} decor={decor} dense={dense} />
    </div>
  );
}

/**
 * What sits in a term: the work block if one covers it, then the term's cards on two lines, then
 * the empty slots the planner leaves dashed.
 *
 * ── The two lines ──────────────────────────────────────────────────
 *
 * The same split the grid uses, by the same rule (`sh >= 3 || shVoided`): substantial courses on
 * the main line, everything one or two credits — labs, recitations, seminars — on a quieter line
 * beneath. Without it a zero-credit recitation took a full slot next to a four-credit course and
 * the term read as fuller than it is. The rule is copied deliberately rather than approximated: a
 * preview that grouped cards differently from the board would be a different picture of the same
 * plan.
 *
 * The block does not REPLACE the cards. A term can legitimately hold both — a plan that writes
 * "Co-op or vacation" alongside a course puts one of each in the same term — and an earlier draft
 * of this rendered only the block, which would have hidden a course the apply really does place.
 */
export function TermBody({ cards, sem, tb, run, types, t, termMax = Infinity, oneCourse = 4,
                           decor, dense }) {
  const m      = M(dense);
  const main   = cards.filter(c => c.sh >= 3 || c.shVoided);
  const others = cards.filter(c => c.sh <= 2 && !c.shVoided);
  // Cells this term threw out — the walkthrough's bounces. They sit in the row they tried, struck
  // through, which is what makes the reason checkable rather than asserted.
  const ghosts = decor?.ghostsIn?.(sem.id) ?? [];
  // ── An empty slot is a claim about ROOM, and `maxSlots` cannot make it ──
  //
  // `maxSlots` is a layout constant from `semGrid.js` — 4 for spring, 5 for fall, 2 for a summer
  // half — describing how many boxes the editable grid draws. It is not a fact about the degree or
  // the student, so `maxSlots - main.length` rendered a UI constant as a statement that another
  // course fits.
  //
  // It was wrong twice over. The second line is invisible to it, so a term with six courses read
  // as three: International Business Spring 2027 holds FINA 2201 and two concentration cells on
  // the main line and BUSN 1103, INTB 2205 and INTB 2206 beneath, and was drawn with a free slot.
  // And credits were ignored — at 17 of 19 SH no 4 SH course fits however many boxes are free.
  //
  // So the slot is drawn only where a standard course could actually be added. That is the same
  // credit-aware test the engine and `gatePlan` already use for "is this term full", rather than a
  // fourth notion of fullness. Scaled by the term's own weight, so a summer half is measured
  // against half the cap — the same scaling `termCapacity` applies in the engine.
  const load = cards.reduce((n, c) => n + (c.sh ?? 0), 0);
  const cap = termMax * (sem.weight ?? 1);
  const roomForOne = load + oneCourse <= cap + 0.01;
  const empties = (run || !roomForOne)
    ? 0
    : Math.max(0, (sem.maxSlots ?? 4) - main.length - others.length - ghosts.length);

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {run && <WorkBlock run={run} types={types} t={t} dense={dense} />}
        {main.map(c => <MiniCard key={c.id} card={c} state={decor?.cardState?.(c)} dense={dense} />)}
        {ghosts.map((g, i) => <MiniCard key={`g${i}`} card={g} state="ghost" dense={dense} />)}
        {Array.from({ length: Math.min(empties, 4) }, (_, i) => (
          <div key={`e${i}`} style={{
            flex: `1 1 ${m.basis}px`, minWidth: 0, minHeight: m.cardMin, borderRadius: 6,
            border: "1px dashed var(--border-slot)", background: tb.bg, opacity: 0.6,
          }} />
        ))}
      </div>
      {!!others.length && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4, paddingTop: 4,
          borderTop: "1px solid var(--border-sub)",
        }}>
          {others.map(c => (
            <MiniCard key={c.id} card={c} small state={decor?.cardState?.(c)} dense={dense} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A summer row: the two halves side by side, as the planner splits them — behind the same shared
 * label column the planner puts in front of them.
 *
 * Without that column the row was the one place in the dialog that named itself differently from
 * the board: fall and spring led with "Spring 2028 / Jan – Apr" in a fixed-width gutter, and summer
 * led with nothing, so the two halves started where the other rows' cards did and the year was
 * repeated inside each half instead. Now the year and the span sit once, at the front, and the
 * halves carry only what distinguishes them (A/B and their own months) — which is how SummerRow
 * reads.
 */
export function MiniSummerRow({ sems, view, startMap, contMap, laid, types, unit, isPhone, t,
                                termMax, oneCourse, decor, dense }) {
  const m    = M(dense);
  const tb   = TYPE_BG.summer;
  const year = sems[0].label.match(/\d{4}/)?.[0] ?? "";
  const sh   = sems.reduce((sum, s) => sum + loadIn(s.id, view, startMap, contMap), 0);
  const lit  = sems.some(s => decor?.rowState?.(s.id) === "target");
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 8,
      background: lit ? "var(--active-bg)" : tb.bg,
      border: `1px solid ${lit ? "var(--active)" : tb.border}`, borderRadius: 6,
      padding: m.rowPad, marginBottom: m.rowGap, minHeight: m.rowMin,
      transition: "background 120ms linear, border-color 120ms linear",
    }}>
      <SummerLabelCol sems={sems} year={year} sh={sh} unit={unit} isPhone={isPhone} t={t}
                      dense={dense} />
      <div style={{ display: "flex", alignItems: "stretch", gap: 6, flex: 1, minWidth: 0 }}>
      {sems.map(sem => {
        const cards = cardsIn(sem.id, view);
        const run   = runFor(sem.id, laid, startMap, contMap);
        return (
          <div key={sem.id} style={{
            flex: 1, minWidth: 0, border: "1px solid var(--border-slot)", borderRadius: 4,
            padding: dense ? "3px 5px" : "5px 6px", background: "var(--card-bg)",
          }}>
            <SemLabelCol sem={sem} sh={loadIn(sem.id, view, startMap, contMap)}
                         unit={unit} isPhone={isPhone} t={t} inline dense={dense} />
            <div style={{ marginTop: 3 }}>
              <TermBody cards={cards} sem={sem} tb={tb} run={run} types={types} t={t}
                termMax={termMax} oneCourse={oneCourse} decor={decor} dense={dense} />
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}

/**
 * "Summer 2028 / May – Aug", the heading the two halves share.
 *
 * The span is READ off the halves' own sub-labels (`May – Jun` + `Jul – Aug` → `May – Aug`) rather
 * than written here as a constant: the calendar adapter owns when a term runs, and a hard-coded
 * pair of months in a preview is one more place to forget when it changes. A half whose sub carries
 * no dash falls back to the sub verbatim, and a lone half (no B) simply reports its own months.
 *
 * The season uses the written `claude.sem.summer` key with the year appended, NOT whole-phrase
 * translation of "Summer 2028". Whole-phrase output reorders per locale — the engine returns
 * "2028 年夏季" — and the fall and spring rows beside it compose `t(key) + year` and stay
 * season-first ("春季 2028"). Both orders are defensible; two of them in one column is not.
 * (SummerRow on the live grid does translate the phrase, so its summer heading reads year-first in
 * CJK while this one reads season-first. That is a bug on the row, not here, and fixing it there is
 * a one-line swap to this same key.)
 */
function SummerLabelCol({ sems, year, sh, unit, isPhone, t, dense }) {
  const first = sems[0].sub ?? "";
  const last  = sems[sems.length - 1].sub ?? "";
  const from  = first.split("–")[0].trim();
  const to    = last.split("–").pop().trim();
  const span  = from && to && from !== to ? `${from} – ${to}` : (last || first);

  return (
    <div style={{ width: isPhone ? 76 : 116, flexShrink: 0, minWidth: 0 }}>
      <div style={{
        fontSize: dense ? TYPE.body : TYPE.lead, fontWeight: 700, color: "var(--text-2)",
        fontFamily: "'InterTight', 'Inter', system-ui, sans-serif",
        lineHeight: "calc(1.2 * var(--lh-scale, 1))",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{scaleLatinRuns(semName(t, "claude.sem.summer", year), { tight: true })}</div>
      {/* The months go in dense. The row still says which summer it is and how loaded it is; what
          it stops saying is that summer runs May to August, which the reader knows. */}
      <div style={{
        fontSize: TYPE.meta, color: "var(--text-5)", marginTop: dense ? 0 : 2,
        lineHeight: "calc(1.35 * var(--lh-scale, 1))",
      }}>
        {!dense && <TText>{span}</TText>}{!!sh && <>{dense ? "" : " · "}{sh} {unit}</>}
      </div>
    </div>
  );
}

/**
 * The semester's name and load.
 *
 * The season comes from the hand-written `claude.sem.*` keys for the same reason SemRow uses them:
 * per-word engine translation turns "Fall" into "falling". A calendar term type we have no key for
 * falls back to whole-phrase translation, hint included — hence the hook, which must run whether or
 * not that branch is taken.
 *
 * `inline` is the summer half: it drops the year, because the row's shared column in front of it
 * already carries one and "Summer A 2028 / Summer B 2028" spent the two halves' scarce width saying
 * the same year twice. The half keeps its own months for the same reason the planner's halves do —
 * the split is the only thing the row cannot say for both at once.
 */
function SemLabelCol({ sem, sh, unit, isPhone, t, inline = false, dense = false }) {
  const cal  = usePort(ICalendar);
  const st   = cal.getSemesterTypes().find(s => s.id === sem.semTypeId);
  const year = sem.label.match(/\d{4}/)?.[0] ?? "";
  const key  = SEM_NAME_KEY[sem.semTypeId];
  const translated = useTranslatedText(key ? null : sem.label,
    { as: st?.translateAs ? `${st.translateAs} ${year}` : undefined });
  // `semName` composes the year in the locale's own order; the summer half asks for none, because
  // the row's shared column in front of it already carries one.
  const name = key ? semName(t, key, inline ? "" : year) : (translated ?? sem.label);

  if (inline) {
    return (
      <div style={{ display: "flex", alignItems: "baseline", gap: 5, minWidth: 0 }}>
        <span style={{
          fontSize: TYPE.body, fontWeight: 700, color: "var(--text-3)",
          fontFamily: "'InterTight', 'Inter', system-ui, sans-serif",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{name}</span>
        <span style={{
          fontSize: TYPE.meta, color: "var(--text-5)", whiteSpace: "nowrap",
          overflow: "hidden", textOverflow: "ellipsis",
        }}><TText>{sem.sub}</TText></span>
        <span style={{ flex: 1 }} />
        {!!sh && <span style={{ fontSize: TYPE.meta, color: "var(--text-5)", whiteSpace: "nowrap" }}>{sh} {unit}</span>}
      </div>
    );
  }
  // Dense puts the name and the load on ONE line: the months are the line worth losing, and two
  // stacked lines set the row's height even when the term holds a single card.
  if (dense) {
    return (
      <div style={{
        width: isPhone ? 76 : 116, flexShrink: 0, minWidth: 0,
        display: "flex", alignItems: "baseline", gap: 5,
      }}>
        <span style={{
          fontSize: TYPE.body, fontWeight: 700, color: "var(--text-2)",
          fontFamily: "'InterTight', 'Inter', system-ui, sans-serif",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{name}</span>
        {!!sh && <span style={{ fontSize: TYPE.meta, color: "var(--text-5)", whiteSpace: "nowrap" }}>
          {sh} {unit}
        </span>}
      </div>
    );
  }
  return (
    <div style={{ width: isPhone ? 76 : 116, flexShrink: 0, minWidth: 0 }}>
      <div style={{
        fontSize: TYPE.lead, fontWeight: 700, color: "var(--text-2)",
        fontFamily: "'InterTight', 'Inter', system-ui, sans-serif",
        lineHeight: "calc(1.2 * var(--lh-scale, 1))",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{name}</div>
      <div style={{
        fontSize: TYPE.meta, color: "var(--text-5)", marginTop: 2,
        lineHeight: "calc(1.35 * var(--lh-scale, 1))",
      }}>
        <TText>{sem.sub}</TText>{!!sh && <> · {sh} {unit}</>}
      </div>
    </div>
  );
}

/**
 * One card. The reservation shape comes from `occupantCards`, so a placeholder arrives here already
 * looking like a card — grey, its label as the code, its requirement as the title. The only thing
 * this adds is the dashed border: on the real grid a placeholder is a card you can drop onto, and
 * here it is a decision still to make, which is worth saying at a glance.
 *
 * ── Which of a placeholder's two strings gets translated ───────────
 *
 * A reservation carries two names for one thing: the plan's own wording (`code`, from plan.json)
 * and the requirement it stands for (`title`, from the catalog). Both are English prose, and the
 * first draft here sent the FIRST through the engine and printed the second raw. That produced the
 * two faults this dialog was reported for:
 *
 *   - a card reading "库里选修课 / Khoury Approved Electives" — one line translated, the next not,
 *     on the same card;
 *   - and worse, the *same* requirement named two different things in two places: 保安课程 here
 *     ("security guard course") against 安全必修课程 in the requirements tree. Not a worse engine —
 *     a different SOURCE STRING. The tree translates `r.title`; this translated the plan's label.
 *
 * So: the requirement's title is the name, translated, and it is the SAME string the tree
 * translates, which is what makes the two agree. The plan's own wording is kept as the quiet second
 * line, in the catalog's English — a placeholder has no course code to search Banner by, and that
 * phrase is the only handle a student has when they ask an advisor what fills this slot. It is
 * dropped when it says nothing the first line did not.
 *
 * ── `state`, the walkthrough's only mark on a card ──────────────────
 *
 *   "live"   this course just landed — a ring in the active colour, nothing else
 *   "dim"    everything already placed, while one course is moving
 *   "ghost"  a term this course was thrown out of: struck through, in place
 *
 * Deliberately three, and deliberately additive: a card's identity — its colour, its code, its
 * title — never changes with the state, so the reader is watching one picture change rather than
 * two pictures alternate.
 */
export function MiniCard({ card, small = false, state, dense = false }) {
  const m = M(dense);
  const held = !card.isReservation;
  const ghost = state === "ghost";
  // Unconditional, as hooks must be: null asks for no translation.
  const name = useTranslatedText(held ? null : reservationNameSource(card));
  // Resolved here rather than read off `card.color`: co-op and internship
  // courses follow the theme, and this grid renders in both.
  const cardColor = useCourseInk(card);

  // ── A placeholder's full wording, on hover ────────────────────────
  //
  // These cards are the ones whose text does not fit: a course is "PHYS 1161" and a
  // placeholder is "Select ONE of the following CHEM course sequences:". Clipped to the
  // card, that reads as "Select ONE of the follo…" and the student cannot see what the
  // choice even is. The native `title` did carry it and waits about a second, which is long
  // enough that it was effectively never read — the reason `HoverCard` exists at all.
  //
  // Only for placeholders. A held course already shows its code in full and its title on the
  // second line, so a card explaining itself would be noise on every card in the grid.
  //
  // Built from the reservation's OPTION GROUPS where it has them: the card's own string is
  // truncated to three with a `(+12)` after it and its `or`s carry no precedence. See
  // `optionGroupsText`. Falls back to the card's wording when there is nothing to expand.
  const [hover, setHover] = useState(null);
  const opts = held ? "" : optionGroupsText(cardOptionGroups(card));
  // Two fields, not one joined string: `CardHover` stacks the name over what answers it.
  const hoverTitle  = held ? "" : String(name ?? card.title ?? card.code ?? "").trim();
  const hoverDetail = held ? "" : String(opts || subline(card, name) || "").trim();
  const full = held ? null : (hoverTitle || hoverDetail || null);

  return (
    <div
      // Bound only where there is something clipped to reveal, so an ordinary course card
      // does not carry two listeners and a state update per hover across a whole grid.
      onMouseEnter={full ? (e) => setHover(e.currentTarget.getBoundingClientRect()) : undefined}
      onMouseLeave={full ? () => setHover(null) : undefined}
      style={{
      // The second line is for one- and two-credit cards, so they take the room they are worth
      // rather than a full slot each.
      flex: small ? "0 1 auto" : `1 1 ${m.basis}px`,
      minWidth: 0, minHeight: small ? 0 : m.cardMin, position: "relative", overflow: "hidden",
      // ── A bounce is RED, and at full strength ────────────────────────
      //
      // It was a faint struck-through outline at 0.5 opacity, on the reasoning that a rejection is
      // a lesser thing than a placement and should not shout. Wrong twice: it is on screen for one
      // step out of forty, so it has one moment to be seen at all; and it is the only mark on the
      // grid that says something FAILED, which is a different kind of fact from everything else
      // drawn here and cannot be carried by the same grey.
      //
      // `--error` on the app's own scale, not a literal, so it moves with the theme like every
      // other state the planner draws. Full opacity: the strike-through says "not here" and the
      // colour says "and it could not be" — neither works at half strength.
      background: ghost ? "var(--error-bg)" : "var(--card-bg)", borderRadius: 6,
      border: ghost ? "1px dashed var(--error)"
        : held ? "1px solid var(--border-card)" : "1px dashed var(--border-slot)",
      padding: small ? (dense ? "2px 6px 2px 9px" : "4px 7px 4px 10px") : m.cardPad,
      boxShadow: state === "live" ? "0 0 0 2px var(--active)" : undefined,
      opacity: state === "dim" ? 0.34 : 1,
      textDecoration: ghost ? "line-through" : undefined,
      textDecorationColor: ghost ? "var(--error)" : undefined,
      transition: "opacity 160ms linear, box-shadow 160ms linear",
    }}>
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: 4,
        background: ghost ? "var(--error)" : cardColor, borderRadius: "5px 0 0 5px",
        opacity: held || ghost ? 1 : 0.5,
      }} />
      {/* ── One line in dense, and one line only ─────────────────────
        *
        * A course code is four characters and a requirement's name is "International Business
        * Requirements". Left to wrap, the second one takes two or three lines and its row grows
        * to fit — so a plan is drawn with rows of three different heights and the grid stops
        * reading as a grid. That is a bad trade in the walkthrough, where the reader is watching
        * for one card to change and every uneven row is a shape to re-learn.
        *
        * So dense clips to one line at a slightly smaller size, and the full name is on the card's
        * `title`. The preview keeps wrapping: it is a document, it is read once, and there the
        * complete name is worth more than a flat baseline. */}
      {/* No native `title` on a placeholder any more — `HoverCard` below carries the same
        * words instantly instead of after the browser's one-second wait. Kept off entirely
        * rather than left as a fallback: two tooltips for one card is one of them arriving
        * late, over the top of the other. */}
      <div style={{
        fontSize: dense && !held ? TYPE.meta : TYPE.body, fontWeight: 800,
        color: ghost ? "var(--error-text)" : held ? cardColor : "var(--text-4)",
        letterSpacing: "0.02em", lineHeight: "calc(1.3 * var(--lh-scale, 1))",
        overflow: "hidden", textOverflow: "ellipsis",
        whiteSpace: held || dense ? "nowrap" : "normal",
        fontStyle: held ? "normal" : "italic",
        textDecoration: ghost ? "line-through" : undefined,
      }}>{held ? card.code : (name ?? card.title ?? card.code)}</div>
      {/* Second line: a real course's title, translated as the grid translates it; a placeholder's
          own English wording, when it adds something. Only on the main line — the small strip is
          one- and two-credit cards, and a wrapped line there costs more height than the courses on
          it are worth. */}
      {!!subline(card, name) && !small && !dense && (
        <div style={{
          fontSize: TYPE.meta, color: "var(--text-5)", marginTop: 1,
          lineHeight: "calc(1.3 * var(--lh-scale, 1))",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>{held ? <TText>{card.title}</TText> : subline(card, name)}</div>
      )}
      {/* Wrapped at 300px so a long "Select ONE of the following CHEM course sequences:"
        * becomes two readable lines rather than one strip running off the viewport —
        * `HoverCard` stays on a single line unless given a `maxWidth`. */}
      {hover && full && (
        <CardHover rect={hover} title={hoverTitle || hoverDetail}
                   detail={hoverTitle ? hoverDetail : ""} maxWidth={300} />
      )}
    </div>
  );
}

/**
 * The quiet second line: a held course's title, or a placeholder's own English wording. The
 * placeholder half is `reservationSubline` in core, shared with the planner card so the two
 * surfaces cannot drift apart again.
 */
const subline = (card, translated) =>
  card.isReservation ? reservationSubline(card, translated) : (card.title || "");

/** A co-op across the term — a block, never a card, as on the real grid. */
export function WorkBlock({ run, types, t, dense }) {
  const m = M(dense);
  const type = types.find(x => x.id === run.typeId) ?? types.find(x => x.id === "coop");
  return (
    <div style={{
      // A full line of its own: a co-op is the term, not one card in it, and anything the plan
      // places alongside wraps underneath.
      flex: "1 1 100%", minWidth: 0, minHeight: m.cardMin, borderRadius: 6,
      border: "1px solid var(--border-card)", background: "var(--card-bg)",
      padding: dense ? "3px 10px" : "6px 12px", display: "flex", alignItems: "center", gap: 8,
    }}>
      <span style={{
        fontSize: dense ? TYPE.body : TYPE.lead, fontWeight: 600, color: "var(--text-2)",
        letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap",
      }}>
        <TText>{type?.label ?? "Co-op"}</TText>{run.cont ? <> {t("sem.cont.label")}</> : null}
      </span>
      <span style={{ flex: 1 }} />
      {!!run.duration && (
        <span style={{ fontSize: TYPE.meta, color: "var(--text-5)", whiteSpace: "nowrap" }}>
          {t("grad.plan.preview.duration", { n: run.duration })}
        </span>
      )}
    </div>
  );
}

/**
 * The work-term run covering a semester, and whether it merely passes through.
 *
 * The type id is read back out of the instance the apply wrote, not assumed to be "coop":
 * `applySamplePlan` takes `coopTypeId` as a parameter, so an institution whose plans describe a
 * different kind of work term would have had this label lie about it.
 */
export function runFor(semId, laid, startMap, contMap) {
  const id = startMap?.[semId] ?? contMap?.[semId];
  if (!id) return null;
  const run = (laid?.coops ?? []).find(c => c.id === id);
  if (!run) return null;
  return { ...run, typeId: laid?.specialTermPl?.[id]?.typeId ?? "coop", cont: !startMap?.[semId] };
}
