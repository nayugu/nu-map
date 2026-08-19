// ═══════════════════════════════════════════════════════════════════
// DERIVATION · colour, and the grouping it forced  (presentation only)
//
// Every value here was chosen by running `validate_palette.js`, not by eye, and the
// grouping below exists BECAUSE the validator refused the ungrouped version. That is the
// whole point of the check: it turned a taste question into a measurement, and the
// measurement changed the design.
//
// ── What the validator rejected, in order ───────────────────────────
//
// The narrowing matrix has five exclusion reasons in the engine, and the first attempt gave
// each one a hue, plus an accent for the chosen cell — six categorical slots:
//
//   6 slots, light   FAIL  normal-vision floor: orange #eb6834 ↔ magenta #e87ba4, ΔE 12.9
//   5 slots, light   FAIL  normal-vision floor: orange #eb6834 ↔ amber #eda100, ΔE 13.7
//   5 slots, dark    FAIL  CVD: blue #3987e5 ↔ violet #9085e9, ΔE 1.9 protan
//   4 slots, dark    FAIL  CVD: aqua #199e70 ↔ magenta #d55181, ΔE 1.6 deutan
//   3 slots, both    PASS  violet / amber / aqua — worst all-pairs ΔE 9.1 protan (light),
//                          8.4 protan (dark); normal-vision 22.9 and 19.8
//
// The skill's instruction for that outcome is explicit — under `--pairs all`, cut series or
// facet rather than accept a failing pair — so the reasons are GROUPED to three, and the
// grouping is semantic rather than arbitrary. Each category answers a different question
// about why a term is impossible:
//
//   the card's own prerequisites   `before-prereqs`
//   the calendar                   `not-offered-then`
//   OTHER cards' order             `outside-precedence-window`, `coop-prep-bound`
//
// The two folded together are both "something else has to come first", which is a real
// kinship: one is what the prerequisite chains leave, the other is that co-op preparation
// must precede the co-op. The exact reason is never lost — it is in the cell's tooltip and
// in the row detail, which is also the relief the contrast WARN below requires.
//
// ── Two things that are deliberately NOT hues ───────────────────────
//
// CHOSEN carries a ring and a strong neutral fill rather than a fifth colour, so the one
// cell that matters most is never identified by colour alone — and so it needs no slot in
// a palette that had none to spare.
//
// LEARNED-NOGOOD is a TEXTURE over the legal ground, and that is the honest encoding rather
// than a compromise. A nogood is a heuristic, not a deduction — `search.js` says so at
// length: "C cannot be in T" was observed under one arrangement and might be false under
// another. A hatch over "legal" says exactly that: still legal, provisionally set aside by
// us. A solid hue would have claimed it was ruled out by the degree.
//
// ── The one WARN, and what discharges it ────────────────────────────
//
// Light amber #eda100 is 2.17:1 against a white surface and light aqua #1baf7a is 2.82:1,
// both under 3:1. The skill calls that obligation non-dismissable: visible labels or a
// table view. Both are present — every fate is named in the legend, every cell states its
// reason on hover, and the row detail prints it as prose — so the colour is never the only
// carrier. The cells also sit on a 1px surface gap, which is the mark spec's spacer and
// keeps adjacent fills from reading as one.
// ═══════════════════════════════════════════════════════════════════

import { EXCLUSION, FATE } from "../../core/derivation/events.js";

/** The three display categories the validator allows, and which engine reasons map in. */
export const FATE_GROUP = Object.freeze({
  [FATE.CHOSEN]: "chosen",
  [FATE.LEGAL]: "legal",
  [EXCLUSION.BEFORE_PREREQS]: "prereqs",
  [EXCLUSION.NOT_OFFERED]: "offered",
  [EXCLUSION.PRECEDENCE_WINDOW]: "order",
  [EXCLUSION.COOP_PREP_BOUND]: "order",
  // Grouped with `order` because that is what it is — a sequencing decision — and because
  // inventing a colour for it would give the department's arrangement more visual weight in
  // the tree than the prerequisite chains it has to obey.
  [EXCLUSION.DEPARTMENT_TERM]: "order",
  [EXCLUSION.LEARNED]: "learned",
});

/**
 * Display order for the legend: taken, available, then the three obstructions.
 *
 * Each entry carries the LOCALE KEY it is named by, and those keys are the engine's own fate
 * values rather than these display groups — with one exception, `order`, which is the group
 * the two folded reasons share and therefore needs a name of its own. So the legend says
 * "ruled out by what must come before or after" once, and a cell that is hovered says which
 * of the two it actually was. The grouping is a palette constraint; the vocabulary is not.
 */
export const FATE_LEGEND = Object.freeze([
  ["chosen", "chosen"],
  ["legal", "legal"],
  ["prereqs", "before-prereqs"],
  ["offered", "not-offered-then"],
  ["order", "order"],
  ["learned", "learned-nogood"],
]);

/**
 * The validated hues, per mode.
 *
 * Light and dark are SELECTED, not flipped: each is the same hue stepped for its own
 * surface and validated against it, which is why the two columns are not derived from one
 * another in code.
 */
const HUES = Object.freeze({
  light: { prereqs: "#4a3aa7", offered: "#eda100", order: "#1baf7a" },
  dark: { prereqs: "#9085e9", offered: "#c98500", order: "#199e70" },
});

/**
 * Colours for a fate group, resolved against the current mode.
 *
 * `legal` and `chosen` come from THEME TOKENS rather than from this file, because they are
 * surface and ink rather than identity: "legal" is the ground the matrix is drawn on and
 * "chosen" is the strongest ink available. Hard-coding either would break one of the two
 * themes, which is the defect this panel's neighbour already shipped once (`--bg-solid`,
 * a token that never existed, so a white card in dark mode).
 */
export function fateStyle(group, mode) {
  const hue = HUES[mode === "dark" ? "dark" : "light"];
  switch (group) {
    case "chosen":
      return { fill: "var(--text-1)", ring: true };
    case "legal":
      return { fill: "var(--bg-surface-2)", border: "var(--border-2)" };
    case "learned":
      return { fill: "var(--bg-surface-2)", border: "var(--border-2)", hatch: "var(--text-4)" };
    case "prereqs":
      return { fill: hue.prereqs };
    case "offered":
      return { fill: hue.offered };
    case "order":
      return { fill: hue.order };
    default:
      return { fill: "var(--bg-surface-2)" };
  }
}

/**
 * The sequential ramp for the cause matrix, as an alpha over one hue.
 *
 * Counts are a MAGNITUDE, so this is one hue light→dark and there is nothing categorical to
 * validate — the six checks exist for adjacent-pair separation among identity colours, and a
 * ramp has no pairs to separate. Expressed as opacity over `--text-1` so it steps correctly
 * on both surfaces without a second table to keep in sync.
 *
 * `Math.sqrt` rather than linear: the distribution is heavily skewed — one card can carry
 * 4,000 rejections where the median carries a dozen — so a linear ramp renders every row but
 * the worst as blank. A square root keeps the top row darkest while leaving the ordinary rows
 * visible, and it is monotone, which is the only property a magnitude encoding must have.
 */
export function rampAlpha(value, max) {
  if (!(max > 0) || !(value > 0)) return 0;
  return 0.08 + 0.82 * Math.sqrt(value / max);
}
