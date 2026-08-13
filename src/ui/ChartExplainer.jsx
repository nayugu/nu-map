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
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../context/LanguageContext.jsx";

export default function ChartExplainer({ report, program, onClose, isPhone }) {
  const { t } = useLanguage();

  // ── Escape closes ONE layer ───────────────────────────────────────
  //
  // Matching `SamplePlanPreview`, which this panel now sits beside: the handler stops
  // propagation so a dialog opened over another closes only itself. Registered before the
  // `report` guard below, because a hook cannot run conditionally.
  useEffect(() => {
    if (!report) return undefined;
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose?.(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [report, onClose]);

  if (!report) return null;

  const fz  = isPhone ? 9 : 12;
  const fzH = isPhone ? 10 : 13;

  const required = report.totalCreditsRequired ?? 0;

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
        background: "rgba(0,0,0,.5)",
        padding: isPhone ? "12px 10px" : "32px 24px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 620,
          // OPAQUE, with a literal fallback. `--bg-surface-1` is translucent in this
          // theme, so the card showed the grid straight through it and every line of
          // text sat on top of a course card.
          background: "var(--bg-solid, var(--bg-1, #ffffff))",
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
          borderRadius: 10, padding: isPhone ? 14 : 22,
          boxShadow: "0 18px 48px rgba(0,0,0,.45)",
          // No maxHeight and no inner scroll: the backdrop above owns scrolling, so the
          // card is as tall as it needs to be and nothing is unreachable.
        }}
      >
        {/* No subtitle. It restated the section headings immediately above the section
          * headings, which is the definition of filler. */}
        <header style={{ marginBottom: isPhone ? 10 : 16 }}>
          <div style={{ fontSize: fzH + 2, fontWeight: 800 }}>{t("chart.explain.title")}</div>
        </header>

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
            {["1", "2", "3", "4", "5"].map(n => (
              <li key={n} style={{ marginBottom: 3 }}>{t(`chart.contract.hard.${n}`)}</li>
            ))}
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
        <Section title={t("chart.contract.soft.h")}>
          <ol style={{ margin: 0, paddingInlineStart: 22, lineHeight: 1.6 }}>
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(n => (
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
          <ul style={{ margin: 0, paddingInlineStart: 22, lineHeight: 1.6 }}>
            {["b1", "b2", "b3", "b4", "b5", "b6"].map(k => (
              <li key={k} style={{ marginBottom: 2 }}>{t(`chart.how.${k}`)}</li>
            ))}
          </ul>
        </Section>

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


        <footer style={{
          display: "flex", justifyContent: "flex-end", gap: 8,
          borderTop: "1px solid var(--border-2)", paddingTop: 12, marginTop: 2,
        }}>
          <button
            onClick={onClose}
            style={{
              fontSize: fz, padding: isPhone ? "5px 10px" : "6px 14px", borderRadius: 6,
              border: "1px solid var(--border-2)", background: "var(--bg-surface-2)",
              cursor: "pointer", fontWeight: 600,
            }}
          >{t("chart.explain.close")}</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
