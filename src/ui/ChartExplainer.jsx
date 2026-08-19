// ═══════════════════════════════════════════════════════════════════
// CHART EXPLAINER — how the generated plan was built, in the order a person asks
//
// ── Two lists and a method, and that is all ────────────────────────
//
// This panel was four sections and a dozen per-plan statistics, and it never said what
// the engine actually DOES — which is both the interesting part and the only part a
// reader can check the grid against. So it is now:
//
//   the contract   what every plan MUST satisfy, then what it optimises for
//   the method     how a requirement becomes a card, gets a set of legal terms,
//                  and how the search narrows 10^31 arrangements to nineteen tries
//
// The contract is not a simplification written for the UI. The first list is exactly
// what `chart-gate.js` asserts at ZERO over all 1,031 shapes and what no relaxation
// rung may ever give up; the second is `DEFAULT_PREFERENCES.ranked` plus the orderings
// the search applies within it. If either stops matching the code, the code changed.
//
// ── What was kept from the old version, and why ────────────────────
//
// One thing: the warning that a requirement could not be scheduled. It is the single
// place a plan is knowingly incomplete, and it was added precisely so that a missing
// requirement cannot be invisible — dropping it with the rest would have quietly
// recreated the defect it exists to prevent.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../context/LanguageContext.jsx";
import DerivationPanel from "./derivation/DerivationPanel.jsx";

/** Season names, written per locale rather than engine-translated — see `SemLabel.jsx`. */
const SEASON_KEY = {
  fall: "claude.sem.fall", spring: "claude.sem.spring",
  sumA: "claude.sem.sum1", sumB: "claude.sem.sum2",
};

/**
 * Which half of this plan the department arranged, and every course we moved.
 *
 * Module scope rather than a closure inside the panel, so it can be rendered — and read —
 * on its own. It takes `t` rather than calling `useLanguage`, matching how the rest of this
 * file passes translation down.
 */
function EarlyTerms({ early, relaxed, t }) {
  // Plan-RELATIVE and localized: "Year 2 Summer A", never "Year 2 Summer 1" and never a
  // calendar date. The engine hands over `{ year, semTypeId }` precisely so this decision
  // is made once, here, by the layer that knows the reader's language.
  const term = (w) => {
    if (!w) return "";
    const key = SEASON_KEY[w.semTypeId];
    return t("chart.early.term", { y: w.year, season: key ? t(key) : (w.semTypeId ?? "") });
  };
  const dropped = (relaxed ?? []).includes("department-early-terms");
  const n = early.through ?? 4;

  // Four sources, four sentences, and no sentence that has to be qualified by the next one.
  const lead = dropped ? "chart.early.relaxed"
    : early.source === "department" ? "chart.early.department"
    : early.source === "similar-programs" ? "chart.early.similar"
    : "chart.early.own";

  return (
    <>
      <p style={{ margin: 0, lineHeight: 1.6 }}>{t(lead, { n, rest: n + 1 })}</p>
      {!dropped && (early.moves ?? []).length > 0 && (
        <>
          <p style={{ margin: "9px 0 3px" }}>{t("chart.early.moved.h")}</p>
          <ul style={{ margin: 0, paddingInlineStart: 22, lineHeight: 1.6 }}>
            {early.moves.map((m, i) => (
              <li key={`${m.cell}-${i}`} style={{ marginBottom: 2 }}>
                {t(`chart.early.moved.${m.why ?? "not-offered-then"}`, {
                  course: m.course, from: term(m.fromWhere), to: term(m.toWhere),
                })}
              </li>
            ))}
          </ul>
        </>
      )}
      {/* An over-cap first semester is stated, never assumed. `chart-hard-rules` puts the
        * objection exactly right — it is "an overload petition the plan does not mention" —
        * and the petition is the student's to file. Drawn as a warning because it is an
        * action they may have to take, not a detail. */}
      {!dropped && early.overload && (
        <p style={{ margin: "9px 0 0", color: "var(--warn)" }}>
          {t("chart.early.overload", {
            term: term(early.overload.where), sh: early.overload.sh, cap: early.overload.cap,
          })}
        </p>
      )}
      {!dropped && (early.unplaced ?? []).map((u, i) => (
        <p key={`${u.cell}-${i}`} style={{ margin: "9px 0 0", color: "var(--warn)" }}>
          {t("chart.early.unplaced", { course: u.course, from: term(u.fromWhere) })}
        </p>
      ))}
    </>
  );
}

export default function ChartExplainer({ report, program, derivation, onClose, isPhone }) {
  const { t } = useLanguage();
  // ── Two pages, not two dialogs ────────────────────────────────────
  //
  // "What the engine promises" and "what it did for this degree" are different kinds of
  // document — one is prose that holds for every plan, the other is a record of one search —
  // and they answer questions a reader has in sequence rather than at once. So they are tabs
  // in one dialog: the second only makes sense once the first has said what the rules are,
  // and a reader who does not want it never opens it.
  //
  // A REFUSED degree has a derivation and no report, and it is the case where the process
  // matters most: there is no plan to read instead, so the record of the search is the only
  // account of what happened. So the text page is conditional on there being one, and the
  // panel opens on whichever page it actually has.
  // ── The process opens first, always ───────────────────────────────
  //
  // The button says "how this plan was built", and the process page is the only one that answers
  // that literally: it plays the plan being built. The rules page answers a different and later
  // question — what the engine will and will not do in general — and it opened first only because
  // it was written first. So the order on the strip is the order of the questions, and the page a
  // reader lands on is the one they asked for.
  const hasText = !!report;
  const [tab, setTab] = useState(derivation ? "process" : "text");
  // The header's control slot, as STATE rather than a ref: a ref does not re-render, so the child
  // that portals into it would be told about the node one render too late and draw nothing.
  const [controls, setControls] = useState(null);

  // ── Escape closes ONE layer ───────────────────────────────────────
  //
  // Matching `SamplePlanPreview`, which this panel now sits beside: the handler stops
  // propagation so a dialog opened over another closes only itself. Registered before the
  // `report` guard below, because a hook cannot run conditionally.
  const open = !!report || !!derivation;
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose?.(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const fz  = isPhone ? 9 : 12;
  const fzH = isPhone ? 10 : 13;

  const required = report?.totalCreditsRequired ?? 0;

  // ── One weight, one colour, no ornament ───────────────────────────
  //
  // This had three bold treatments — an accent-coloured section number, a bold heading, and a
  // bold leading figure on every statistic — which read as emphasis on everything and therefore
  // emphasis on nothing. A heading is already distinguishable by being a heading.
  //
  // The section numbers went entirely: they were decoration, and with only three sections a
  // large orange "1" beside the first one carried no information at all.
  const Section = ({ title, children }) => (
    <section style={{ marginBottom: isPhone ? 14 : 20 }}>
      <h4 style={{ margin: "0 0 5px", fontSize: fzH, fontWeight: 600 }}>{title}</h4>
      <div style={{ fontSize: fz, lineHeight: 1.6, color: "var(--text-2)" }}>{children}</div>
    </section>
  );

  /** One figure, at size, with a quiet label under it. No bold, no accent. */
  const Stat = ({ value, label }) => (
    <div style={{ flex: "1 1 0", minWidth: 0 }}>
      <div style={{
        fontSize: fzH + 7, lineHeight: 1.15, fontVariantNumeric: "tabular-nums",
        color: "var(--text-1)",
      }}>{value}</div>
      <div style={{ fontSize: fz, color: "var(--text-3)", marginTop: 3 }}>{label}</div>
    </div>
  );

  // ── Portalled to the body, like every other dialog here now ───────
  //
  // `position: fixed` is only fixed to the VIEWPORT while no ancestor has a `transform`,
  // `filter` or `contain` — any of those makes it a containing block and the overlay is
  // clipped to whatever panel it was declared in. This dialog is rendered from deep inside
  // the grad panel, so it was one CSS property away from being trapped there, and upstream
  // has already paid for that class of bug once ("confirm the shared plan in-app, above
  // everything, so a phone can accept it").
  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-label={t("chart.explain.title")}
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        // The BACKDROP scrolls, not the card. `placeItems: center` on a fixed grid
        // pins the card's centre to the viewport's, so a card taller than the screen
        // has its top and bottom cut off with no way to reach them. Scrolling the
        // backdrop and letting the card size to its content reaches all of it.
        overflowY: "auto", overscrollBehavior: "contain",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        // Matched to the dialog it sits beside (`SamplePlanOffer`, 0.6) rather than left at 0.45.
        // A scrim is the one colour that is legitimately theme-independent — it darkens whatever
        // is behind it on both sides — so this stays a literal, and the only thing worth being
        // consistent about is the amount.
        background: "rgba(0,0,0,0.6)",
        padding: isPhone ? "12px 10px" : "32px 24px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          // ── Two widths, because the two tabs are two different kinds of thing ──
          //
          // The rules tab is prose, and 620 is about as wide as a paragraph should get before the
          // eye loses the start of the next line. The process tab is the PLANNER: four cards to a
          // fall, each carrying a course code and a title, behind a label column. At 620 those
          // cards are 104px wide and every title is an ellipsis, which is the same "shrink until
          // it fits" failure the preview's type scale was written to end. 900 is the width the
          // sample-plan preview settled on for exactly these rows, so the two dialogs in this
          // panel now draw the same grid at the same size.
          width: "100%", maxWidth: tab === "process" ? 900 : 620,
          // ── OPAQUE, and with a token that EXISTS ────────────────────
          //
          // This read `var(--bg-solid, var(--bg-1, #ffffff))`, and neither `--bg-solid` nor
          // `--bg-1` is defined anywhere — `src/core/themes.js` has no such token, and those two
          // names appeared in this file and nowhere else in the app. So the whole chain fell
          // through to the literal `#ffffff` on EVERY theme, and in dark mode the card was white
          // while `--text-1` is `#e6edf3`: near-white text on white. That is the dark-mode
          // complaint, and it is not a contrast tweak — a fallback that always fires is the
          // fallback becoming the value.
          //
          // `--bg-surface` is the real panel token and is themed on both sides (`#161b22` dark,
          // `#ffffff` light). It is also opaque, which is what the old comment was reaching for:
          // the concern was that a translucent surface showed the course grid straight through
          // the card, and `--bg-surface` does not.
          //
          // No literal fallback now, deliberately. A fallback here can only mask the next missing
          // token, and masking is precisely how this survived.
          background: "var(--bg-surface)",
          color: "var(--text-1)",
          // STATED, because a portal to `document.body` inherits from nothing.
          //
          // `index.html` sets the type stack on `button, input, select, textarea` and never on
          // `body`, so prose rendered outside the app tree falls through to the browser default
          // serif. That is why the buttons in here looked right while every explanatory line
          // did not. `ReplaceConfirm` in `SamplePlanOffer.jsx` already carries this for the
          // same reason; it is a property of portalling, not of either component.
          fontFamily: "'Inter', system-ui, sans-serif",
          border: "1px solid var(--border-2)",
          // Tighter at the top than the sides: the header is now a single line, and the space
          // above it was sized for a title that is no longer drawn.
          borderRadius: 10, padding: isPhone ? "8px 14px 14px" : "10px 22px 18px",
          // Themed, not fixed. A 0.45-alpha black drop shadow is tuned for a dark surface and
          // reads as grime under a white card; the theme already carries the right value for each
          // side (`0 24px 64px rgba(0,0,0,0.65)` dark, `0 8px 32px rgba(0,0,0,0.12)` light), and
          // `SamplePlanOffer`'s dialog — the modal this one sits beside — already uses it.
          boxShadow: "var(--shadow-modal)",
          // No maxHeight and no inner scroll: the backdrop above owns scrolling, so the
          // card is as tall as it needs to be and nothing is unreachable.
        }}
      >
        {/* ── One line: the tabs, and the way out ──────────────────────
          *
          * The title, the tab strip and the ✕ were three stacked bands costing about 90px before
          * the first pixel of plan. And the title is the one thing here a reader already knows —
          * they clicked a button that said it — so as a heading it spends the most space saying
          * the least. It survives as the dialog's accessible name (`aria-label` on the card) and
          * as the visible heading ONLY where there is no tab strip to name the page instead.
          *
          * What is left is what the page is for: press play, watch the plan get built. */}
        <header style={{
          display: "flex", alignItems: "flex-end", gap: 10, position: "relative",
          // ── Tall enough to hold the transport ────────────────────────
          //
          // The controls are absolutely positioned inside this line, so the header's own height
          // comes from the TABS — which are shorter than a button. The buttons then grew upward
          // out of the header and over the top edge of the dialog. This is the height of the
          // tallest thing the line actually contains, which is what a header should be.
          minHeight: isPhone ? 32 : 39,
          marginBottom: isPhone ? 8 : 10, borderBottom: "1px solid var(--border-2)",
        }}>
          {/* A recording is made during a live generate and does not survive a reload, so a plan
            * restored from storage legitimately has none — and a tab leading to "nothing recorded"
            * is worse than no tab. That is the case where the title has to appear. */}
          {!(derivation && hasText) && (
            <div style={{ fontSize: fzH + 2, fontWeight: 800, flex: 1, minWidth: 0,
                          paddingBottom: 6 }}>
              {t("chart.explain.title")}
            </div>
          )}
          {derivation && hasText && (
            <div role="tablist" style={{
              display: "flex", gap: 2, flex: 1, minWidth: 0, marginBottom: -1,
            }}>
              {[["process", "chart.explain.tab.process"], ["text", "chart.explain.tab.text"]]
                .map(([k, key]) => (
                  <button
                    key={k} role="tab" aria-selected={tab === k}
                    onClick={() => setTab(k)}
                    style={{
                      fontSize: fz, fontWeight: tab === k ? 700 : 500,
                      padding: isPhone ? "4px 8px" : "6px 12px",
                      border: "none", background: "transparent", cursor: "pointer",
                      color: tab === k ? "var(--text-1)" : "var(--text-4)",
                      // The selected tab is marked by a rule under it, not by a fill: this
                      // dialog already carries one accent (the stage that answered, inside the
                      // process page) and a second one competing with it in the header would
                      // make the emphasis mean nothing.
                      borderBottom: `2px solid ${tab === k ? "var(--active)" : "transparent"}`,
                      marginBottom: -1,
                    }}
                  >{t(key)}</button>
                ))}
            </div>
          )}
          {/* ── Where the walkthrough's transport lands ─────────────────
            *
            * An empty slot on the header line, filled by `BuildSteps` through a portal. The
            * controls belong on this line — it is the only band of chrome left, and a row of
            * buttons on its own underneath was the last thing between the reader and the plan —
            * but the playback state belongs in the component that owns the steps, not up here
            * where nothing else knows what a step is.
            *
            * A portal is what lets both be true. It also means the slot is EMPTY on the rules
            * page: `BuildSteps` is not mounted there, so there is nothing to fill it, and a play
            * button over a page of prose would be a control for nothing. */}
          <div
            ref={setControls}
            style={{
              // ── Centred on the DIALOG, not between its neighbours ────
              //
              // In flow, the transport sat in whatever gap the tabs and the ✕ left it, so its
              // centre moved with the length of two tab labels — and in a locale with longer ones
              // it would move again. Taken out of flow and stretched across the header, it is
              // centred on the page itself, which is where the eye looks for a play button.
              //
              // `pointerEvents: none` on the strip so the tabs underneath stay clickable; the
              // buttons themselves turn it back on.
              position: "absolute", insetInlineStart: 0, insetInlineEnd: 0, bottom: 4,
              display: "flex", justifyContent: "center", pointerEvents: "none",
            }}
          />
          {/* Where the footer button used to be, and where every other dialog here keeps it. A
              glyph, sized as a comfortable target rather than to sit on the type scale. */}
          <button
            onClick={onClose} aria-label={t("chart.explain.close")} title={t("chart.explain.close")}
            style={{
              fontSize: 16, lineHeight: 1, background: "transparent", border: "none",
              color: "var(--text-5)", cursor: "pointer", padding: "2px 0 6px 8px",
              flex: "0 0 auto",
            }}
          >✕</button>
        </header>

        {tab === "process" && derivation && (
          <DerivationPanel trace={derivation} isPhone={isPhone} controlsSlot={controls} />
        )}
        {tab === "text" && hasText && (<>


        {/* ── 0. The contract, in two lists ──────────────────────────
          *
          * The whole engine in twelve lines, before any per-plan detail. It answers the
          * question a student actually has — "why is this the plan?" — which the sections
          * below answer only implicitly, one statistic at a time.
          *
          * The split is the engine's real architecture and not a simplification for the UI:
          * the first list is what `chart-gate.js` asserts at ZERO over every generated plan
          * and what no relaxation rung is ever allowed to give up, and the second is
          * `DEFAULT_PREFERENCES.ranked` plus the orderings the search applies inside it. If
          * either list stops matching the code, the code is what changed.
          */}
        {/* Eight. The first draft had five and quietly omitted three real hard rules:
          * co-requisites sharing a term (`checkViolations`), no course used twice (the
          * distinctness matching that every node runs), and co-op length and start season
          * (`validateDrop`). A list of rules that leaves rules out is worse than no list. */}
        {/* ── Only rules that apply to THIS reader ──────────────────
          *
          * Two of these were false for some plans, which is worse than omitting them.
          *
          * The four-course bar does not exist for graduate degrees — `graduateFullTermMinCourses`
          * is 0 and `canStillFill` never enforces it — so a master's student was being told a
          * rule about their plan that the engine does not apply. It now renders only when the
          * bar is real, and states the number it actually uses.
          *
          * "Every requirement covered" contradicts the unschedulable warning further down the
          * same panel. When the catalog has made a requirement impossible, the claim is stated
          * with its exception instead of being quietly contradicted two sections later.
          */}
        <Section title={t("chart.contract.hard.h")}>
          <ol style={{ margin: 0, paddingInlineStart: 22, lineHeight: 1.6 }}>
            {["1", "2", "3", "4"].map(n => (
              <li key={n} style={{ marginBottom: 3 }}>{t(`chart.contract.hard.${n}`)}</li>
            ))}
            {/* Rule 5 carries its exception for the same reason rule 6 does. "No term over
              * the credit cap" is a HARD promise, and it stops being true the moment a first
              * semester keeps the overload its department published — which this panel then
              * states plainly two sections down. A guarantee contradicted by the same
              * document is worse than one that names its exception up front. */}
            <li style={{ marginBottom: 3 }}>
              {t(report.earlyTerms?.overload
                ? "chart.contract.hard.5.overload" : "chart.contract.hard.5")}
            </li>
            <li style={{ marginBottom: 3 }}>
              {t((report.unschedulable ?? []).length > 0
                ? "chart.contract.hard.6.gap" : "chart.contract.hard.6")}
            </li>
            {/* Shown only where it genuinely holds. Both "unless" clauses are gone: the
              * credit-limit one was never an exception — `termIsFull` DEFINES full as four
              * courses OR no room for another — and the too-few-courses one is now an omission
              * rather than a caveat, because a rule qualified into mush is worse than a rule
              * left out. */}
            {report.fullTermBarApplies && (
              <li style={{ marginBottom: 3 }}>
                {t("chart.contract.hard.7", { n: report.fullTermMinCourses })}
              </li>
            )}
            <li>{t("chart.contract.hard.8")}</li>
          </ol>
        </Section>

        {/* Eight, not five. The first draft collapsed these into "major depth before the first
          * co-op" and "1000-level early, 4000-level late", which lost the two behaviours a
          * student is most likely to query: a major course that unlocks little of the degree is
          * pushed LATER (`generatorBar`, measured against this program's own median), and major
          * electives are pulled EARLIER than terminal requirements — the one deliberate
          * departure from the published plans, and the reason the engine exists. */}
        {/* ── The free-elective SPLIT, with this degree's own numbers ──
          *
          * Rendered between the placement rule and the buffer rule, because those three lines are
          * one story: what the free credit is FOR, where it goes, and what it gets spent on. The
          * keys are not renumbered to achieve that — a key is an identifier and the render order
          * is the reading order, so the list is emitted in two halves with this between them.
          *
          * Conditional on the degree HAVING free electives. 178 of 529 undergraduate degrees have
          * no general-elective pool at all, and stating a rule about a pool that does not exist is
          * the same defect as telling a master's student about the four-course bar.
          *
          * It names counts and never a competency code, which is deliberate and is rule 6: the
          * cards carry the binding as guidance, and printing `IC` on a card would read as an
          * instruction about a choice that was never the plan's to make. A COUNT in the explainer
          * is a different claim from a LABEL on a card — it explains the reasoning without
          * prescribing the course — and it is the one number here a reader can check against their
          * own grid.
          */}
        <Section title={t("chart.contract.soft.h")}>
          <ol style={{ margin: 0, paddingInlineStart: 22, lineHeight: 1.6 }}>
            {["1", "2", "3", "4", "5", "6"].map(n => (
              <li key={n} style={{ marginBottom: 3 }}>{t(`chart.contract.soft.${n}`)}</li>
            ))}
            {/* Two strings, because the all-breadth case cannot carry a count grammatically.
              * `split.all` first read "Sets aside all {total} free electives …" and 9 of the 50
              * all-breadth degrees have exactly ONE, which renders "all 1 free electives". The
              * count says almost nothing there — the sentence already means "all of them" — so it
              * is dropped rather than pluralised, which would have needed a singular form in all
              * eight locales for a number the grid already shows. */}
            {report.generalElectives?.total > 0 && (
              <li style={{ marginBottom: 3 }}>
                {report.generalElectives.depth > 0
                  ? t("chart.contract.soft.split", {
                      n: report.generalElectives.breadth,
                      total: report.generalElectives.total,
                      d: report.generalElectives.depth,
                    })
                  : t("chart.contract.soft.split.all")}
              </li>
            )}
            {["7", "8", "9"].map(n => (
              <li key={n} style={{ marginBottom: 3 }}>{t(`chart.contract.soft.${n}`)}</li>
            ))}
          </ol>
        </Section>

        {/* ── How it works ───────────────────────────────────────────
          *
          * Six short steps, and deliberately NOT a restatement of the two lists above — the
          * draft that repeated them is what made this unreadable.
          *
          * Two things were cut for being interesting to an engineer and useless to a student:
          * that 71% of the catalog has no prerequisites, and a description of pruning "whole
          * regions rather than one arrangement at a time". A student opening this wants to know
          * whether to trust the plan and why one course sits where it does, and neither fact
          * helps with either.
          *
          * `nodes` is a PLACEMENT, not a complete arrangement — an earlier draft labelled it
          * "arrangements examined", overstating it by orders of magnitude.
          */}
        <Section title={t("chart.how.h")}>
          {/* ── One figure, and why the second one went ───────────────
            *
            * The node count was here and has been removed: it measures OUR SEARCH, not the
            * degree. "5,041 placements" is a fact about the strategy in search.js, and nobody
            * reading a plan for their own degree has a use for it.
            *
            * What survives is a fact about the degree and the catalog — how many ways these
            * cards fit inside the terms their prerequisites and offering history allow. Each
            * card's window comes from `criticalPath` earliest/latest, so this is prerequisite
            * -derived; it does NOT enforce pairwise order between cards, so it is an upper
            * bound and the label says "allow" rather than claiming every one is valid.
            *
            * The exact count of prerequisite-respecting layouts was considered and dropped.
            * Counting order-preserving maps over a poset is #P-complete in general, and while
            * it IS tractable here — measured, the median program's largest precedence component
            * is 3 cells and 77% of cells have no edge at all, so it factorises — the exactness
            * buys an exponent, not a message. A 3-chain over 12 terms is 1,320 by windows
            * against 220 exactly, so with a median of 3 edges per program the whole correction
            * is one or two orders of magnitude out of 10^33. Roughly 150 lines and a
            * hardness cap to move 33 to 31, inside a sentence that means "astronomically
            * many": not worth it.
            *
            * A real <sup>, since 10^33 is not how anyone writes a number. It cannot go through
            * `t()` — that returns a string — so the VALUE is composed in JSX and only the label
            * is translated.
            */}
          <div style={{
            display: "flex", gap: isPhone ? 16 : 28, margin: "0 0 12px",
            borderTop: "1px solid var(--border-2)", borderBottom: "1px solid var(--border-2)",
            padding: "10px 0",
          }}>
            <Stat
              value={(report.nodes ?? 0).toLocaleString()}
              label={t("chart.how.stat.tried")}
            />
            <Stat
              value={(report.moves ?? 0).toLocaleString()}
              label={t("chart.how.stat.moves")}
            />
          </div>
          {/* Each step says WHAT is counted and WHAT that decides. The previous wording —
            * "measures how deep each course sits and how much it unlocks above" — named two
            * quantities and neither of their consequences, so it read as jargon.
            *
            * The ordering step took two attempts. "Places the most constrained card first" was a
            * term of art; "the card with the fewest terms left, since it has the least room to
            * move" then said the same thing twice and still gave no reason. What it needs is the
            * CONSEQUENCE: place the flexible cards first and they sit in the two slots the tight
            * one needed, and the plan has to be torn up. Tight first, and the flexible ones fill
            * in around the fixed points.
            *
            * The last step says where it STOPS, because "improves the order" with no end
            * condition invites exactly the question it got. */}
          {/* `b3b` is the early-terms step, and it sits between narrowing and placing
            * because that is where it runs. Shown only when it actually applied: for a
            * program with no plan and no similar one to model, "keeps your department's
            * first semesters" describes something that did not happen. */}
          <ul style={{ margin: 0, paddingInlineStart: 22, lineHeight: 1.6 }}>
            {["b1", "b2", "b3", "b3b", "b4", "b5", "b6"]
              .filter(k => k !== "b3b"
                || (report.earlyTerms?.source && report.earlyTerms.source !== "chart"))
              .map(k => (
                <li key={k} style={{ marginBottom: 2 }}>
                  {t(`chart.how.${k}`, { n: report.earlyTerms?.through ?? 4 })}
                </li>
              ))}
          </ul>
        </Section>

        {/* ── Who planned which semester ────────────────────────────
          *
          * The headline claim of the whole generator, so it is its own section and sits
          * above the caveats rather than inside them. The rule it states is one sentence —
          * the department plans the first four semesters, CHART plans the rest — and a
          * student who reads nothing else should still come away knowing which half of
          * their plan an advisor arranged.
          *
          * `source` is read rather than inferred from `publishedPlan` being present,
          * because the fallback drops the department's arrangement while the plan itself is
          * still there. Inferring here is exactly how this panel would come to claim an
          * authority the plan does not have.
          */}
        {report.earlyTerms && (
          <Section title={t("chart.early.h")}>
            <EarlyTerms early={report.earlyTerms} relaxed={report.relaxed} t={t} />
          </Section>
        )}

        {/* ── What it takes as given, and what it cannot know ─────────
          *
          * This category was dropped in the rewrite and had to come back. It answers the
          * questions the other three lists cannot: why does this plan have a fifth year, why is
          * Summer 1 in use when my department leaves it blank, and was difficulty considered.
          *
          * The two per-plan items are rendered only when they are TRUE, so the list stays four
          * lines for a typical plan instead of stating conditions that do not apply. The last
          * one is the honest disclosure and is never conditional: a tool that admits what it did
          * not look at is more trustworthy than one that does not.
          */}
        <Section title={t("chart.limits.h")}>
          <ul style={{ margin: 0, paddingInlineStart: 22, lineHeight: 1.6 }}>
            <li style={{ marginBottom: 2 }}>
              {t(report.shapeSource === "published"
                ? "chart.limits.shape.published" : "chart.limits.shape.derived")}
            </li>
            {report.extendedBy > 0 && (
              <li style={{ marginBottom: 2 }}>
                {t("chart.limits.extended", { n: report.extendedBy })}
              </li>
            )}
            {(report.substituted ?? []).length > 0 && (
              <li style={{ marginBottom: 2 }}>
                {t("chart.limits.substituted", {
                  courses: report.substituted.map(s => s.course).join(", "),
                })}
              </li>
            )}
            {(report.optionalTermsUsed ?? []).length > 0 && (
              <li style={{ marginBottom: 2 }}>
                {t("chart.limits.optional", { terms: report.optionalTermsUsed.join(", ") })}
              </li>
            )}
            <li>{t("chart.limits.nodata")}</li>
          </ul>
          {(report.unschedulable ?? []).length > 0 && (
            <p style={{ margin: "9px 0 0", color: "var(--warn)" }}>
              {t("chart.explain.complete.unschedulable", {
                n: report.unschedulable.length,
                courses: report.unschedulable
                  .map(u => (u.courses ?? []).join(" / ") || u.title)
                  .filter(Boolean).join(", "),
              })}
            </p>
          )}
        </Section>
        </>)}

        {/* ── The footer Close button is gone ────────────────────────
          *
          * It sat alone in a bordered strip at the foot of a long scrolling page, and it read as
          * an empty box: `--bg-surface-2` against `--bg-surface` is nearly no contrast, and the
          * label carried the only weight. Worse, it was the third way to close a dialog that
          * already closes on Escape and on a click outside, and the one that cost a rule, a
          * padded strip and a scroll to reach.
          *
          * The affordance moved to the header instead (see the ✕ beside the title), where it is
          * where every other dialog in the app puts it and does not move as the page grows. */}
      </div>
    </div>,
    document.body,
  );
}
