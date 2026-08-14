// ═══════════════════════════════════════════════════════════════════
// DERIVATION PANEL — how this plan was worked out
//
// ── What this page used to be, and why it was rebuilt ────────────────
//
// Six charts, each with its own title, in the order the engine runs: a stage strip, a depth
// profile, a literal search tree, a card × term matrix, a cause heatmap. Every one of them was
// accurate. The verdict on it was "looks cool, but I have no idea what it means", and that was
// the correct verdict — it explained the mechanism in the mechanism's own vocabulary to a reader
// with no reason to know that the engine commits one course at a time and takes them back.
//
// Three specific failures, each fixed by something structural rather than by better wording:
//
//   THE STAGES read as a pipeline where everything happens, because they were equal boxes in a
//   row. They are two sequential steps, then a LADDER of alternatives tried until one works, then
//   a polish. `StageSpine` now numbers the sequence and indents the ladder with ✗ / ✓.
//
//   THE PROFILE was an abstract squiggle of depth against attempt index, and at 13,019 nodes it
//   is an EKG. It is no longer presented as a chart to read: it survives as the SEEK BAR under
//   the walkthrough, where being a texture is exactly right — you drag along it and the dense
//   stretch is where the plan was built and unbuilt.
//
//   NOTHING ANSWERED THE READER'S QUESTION. "Why is my course in this semester" was buried under
//   two views about our search. It is now the hero: one step per course, on a miniature of the
//   grid they already read.
//
// ── The order, and why it is this order ─────────────────────────────
//
//   the numbers     four, and each one answers the question the previous raises
//   the stages      what happened, in four numbered steps
//   the walkthrough watch it get built — the hero, and where a reader will spend their time
//   more detail     the three expert views, collapsed: all-possibilities, the tree, the causes
//
// The expert views are kept rather than deleted. They are correct, they answer questions the
// walkthrough cannot ("could this course have gone anywhere else in principle"), and a reader who
// wants them is a reader who will open a disclosure. What they must not do is greet everybody.
// ═══════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import { useLanguage } from "../../context/LanguageContext.jsx";
import { deriveModel } from "../../core/derivation/reduce.js";
import { buildSteps } from "../../core/derivation/steps.js";
import StageSpine from "./StageSpine.jsx";
import BuildSteps from "./BuildSteps.jsx";

export default function DerivationPanel({ trace, isPhone, controlsSlot = null }) {
  const { t } = useLanguage();
  const fz = isPhone ? 9 : 12;
  const fzH = isPhone ? 10 : 13;

  // Reduced once per recording: the reduction walks up to 24,000 nodes and 20,000 cut records,
  // and every hover and every step in a child component would otherwise redo it.
  const model = useMemo(() => (trace ? deriveModel(trace) : null), [trace]);
  const steps = useMemo(() => (trace && model ? buildSteps(trace, model) : null), [trace, model]);
  const [stagesOpen, setStages] = useState(false);

  if (!model) {
    return (
      <p style={{ margin: 0, fontSize: fz, color: "var(--text-3)", lineHeight: 1.6 }}>
        {t("chart.deriv.none")}
      </p>
    );
  }

  const s = model.summary;
  // The `Section` wrapper that used to put a heading over each block is gone with the headings
  // themselves. One page, one thing on it, and two footnotes under it — there is nothing left to
  // caption.

  // ── The four numbers ──────────────────────────────────────────────
  //
  // `cards × terms` and `legal card–term pairs` are gone. Both were the engine's own internal
  // quantities: the first reads as an arithmetic operation that is not the point, and the second
  // is the sum of the domain widths, which means nothing outside the solver.
  //
  // What replaces them answers the question the other two raise. "13,019 placements tried" is
  // unreadable in isolation — a reader has no scale for it — and against the number of possible
  // layouts it becomes the point. And "took a course back N times" is the concrete, picturable
  // version of "branches rejected": it is what a person does at a whiteboard.
  // `10^31 possible layouts` was here and is gone. It was meant to give "13,019 placements tried"
  // a scale, and it does not: an exponent nobody can picture does not make a number nobody can
  // picture meaningful, it just adds a second one. Four figures that each stand on their own fit
  // one line, which is worth more than a fifth that needs a footnote.
  const stats = (
    // ── The four figures, and why they are now at the FOOT ────────────
    //
    // They opened the page, on the reasoning that a number is a fast way in. In practice they are
    // the one thing here a reader cannot act on — "115,940 branches rejected" is the size of the
    // work, not a fact about their degree — and putting them first meant the walkthrough, which is
    // what the page is for, started below four numbers and a fold. They read better as a footnote
    // to the picture than as an overture to it.
    <div style={{
      margin: isPhone ? "10px 0 0" : "12px 0 0",
      borderTop: "1px solid var(--border-2)", paddingTop: 10,
    }}>
      {/* A lead, because four bare numbers under a rule at the foot of a page belong to nothing.
          They had a position at the top that said "these are the headline"; at the bottom they
          need a word that says what they are counting. */}
      <div style={{ fontSize: fz, color: "var(--text-4)", marginBottom: 6 }}>
        {t("chart.deriv.stat.h")}
      </div>
      <div style={{ display: "flex", gap: isPhone ? 12 : 24, flexWrap: "wrap" }}>
      <Stat v={s.nodes.toLocaleString()} l={t("chart.deriv.stat.nodes")} {...{ fz, fzH }} />
      <Stat v={s.rejects.toLocaleString()} l={t("chart.deriv.stat.cuts")} {...{ fz, fzH }} />
      <Stat v={(s.takenBack ?? 0).toLocaleString()} l={t("chart.deriv.stat.undone")} {...{ fz, fzH }} />
      <Stat v={s.moves.toLocaleString()} l={t("chart.deriv.stat.moves")} {...{ fz, fzH }} />
      </div>
    </div>
  );

  // ── What it did, collapsed, and now at the FOOT ───────────────────
  //
  // The ladder of tiers is the most abstract thing on the page and the least like the reader's own
  // plan, so it greets nobody — it used to greet everybody, as a disclosure above the walkthrough,
  // which cost a band of chrome to say nothing to the reader who came to watch their plan get
  // built. It sits with the figures now, because both are facts about the RUN rather than about
  // the degree. Whoever wants to know which conventions were spent still opens it in one click.
  const whatItDid = (
    <div style={{ marginTop: isPhone ? 12 : 18 }}>
      <button
        onClick={() => setStages(v => !v)}
        aria-expanded={stagesOpen}
        style={{
          fontSize: fzH, fontWeight: 600, padding: 0, border: "none",
          background: "transparent", color: "var(--text-1)", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 5,
        }}
      >
        <span style={{ fontSize: fz, color: "var(--text-4)" }}>{stagesOpen ? "▾" : "▸"}</span>
        {t("chart.deriv.spine.h")}
      </button>
      {stagesOpen && (
        <div style={{ fontSize: fz, lineHeight: 1.6, color: "var(--text-2)", marginTop: 6 }}>
          <StageSpine stages={model.stages} isPhone={isPhone} />
        </div>
      )}
    </div>
  );

  return (
    <div>
      {/* The truncation warning STAYS at the top, unlike the figures. It is not a statistic — it
          says the pictures below this line are incomplete, and a warning about a picture has to
          arrive before the picture. */}
      {s.truncated && (
        <p style={{ margin: "0 0 12px", fontSize: fz, color: "var(--warn)", lineHeight: 1.5 }}>
          {t("chart.deriv.truncated", { n: s.nodes.toLocaleString() })}
        </p>
      )}

      {/* ── The hero ─────────────────────────────────────────────────
        * Only where there is something to step through. A packer plan has no per-course sequence
        * — it is a greedy pass with no tree — and offering a walkthrough of nothing would be the
        * page quietly inventing a search that did not happen. */}
      {/* No heading over it. "Watch it get built" was a band of chrome naming something the next
          40 pixels already name: the tab is called The process, the thing under it is a plan with
          a play button on it, and the sentence beside that button says what the step did.

          Uncapped width: the 760px cap here was sized for a grid of pills, and what draws now is
          the planner's own rows, where every pixel taken away comes out of a course title. */}
      {steps && steps.place.length > 0 && (
        <BuildSteps steps={steps} isPhone={isPhone} controlsSlot={controlsSlot} />
      )}
      {steps && !steps.place.length && (
        <p style={{ margin: 0, fontSize: fz, lineHeight: 1.6, color: "var(--text-3)" }}>
          {t("chart.deriv.step.packed")}
        </p>
      )}

      {/* `whatItDid` before `stats`: the stages say what the run DID, the figures say how much of
          it there was. The second only means anything once you know the first, and the figures are
          also the harder stop — a rule under them ends the page. */}
      {whatItDid}
      {stats}
    </div>
  );
}

/** One figure, at size, with a quiet label under it — matching the explainer's own `Stat`. */
function Stat({ v, l, fz, fzH, title }) {
  return (
    <div style={{ flex: "0 1 auto", minWidth: 0 }} title={title}>
      <div style={{
        fontSize: fzH + 5, lineHeight: 1.15, fontVariantNumeric: "tabular-nums",
        color: "var(--text-1)",
      }}>{v}</div>
      <div style={{ fontSize: fz, color: "var(--text-3)", marginTop: 3 }}>{l}</div>
    </div>
  );
}
