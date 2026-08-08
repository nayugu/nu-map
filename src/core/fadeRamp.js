// ═══════════════════════════════════════════════════════════════════
// FADE RAMP — the arithmetic behind the clipped-text fade (see ui/FadeText)
// ═══════════════════════════════════════════════════════════════════
// Pure, so the one rule that matters can be tested rather than trusted: NO
// GLYPH THE BOX CUTS THROUGH IS EVER VISIBLE. Everything past the last fully
// fitting grapheme is opacity 0, and the ramp is anchored at that grapheme —
// not at where the ramp starts — so a field too narrow for the whole ramp uses
// the ramp's TAIL and the character at the cut stays the faintest one.

// Opacity of the last visible graphemes, nearest the edge last.
// The header's plan button is barely wider than the name it holds, so its ramp
// has to be short or the whole name dims; the co-op fields are far wider, and a
// longer, gentler ramp there reads as the name trailing off rather than cut.
export const STEPS         = [0.6, 0.32, 0.12];
export const GRADUAL_STEPS = [0.92, 0.82, 0.7, 0.57, 0.44, 0.32, 0.21, 0.12, 0.05];

// Split into GRAPHEMES, not code points. "é" typed as e + U+0301, an emoji ZWJ
// sequence, and a Devanagari consonant + matra are each ONE thing the reader
// sees; handing their pieces separate opacities would tear them in half, which
// is the exact defect this fade exists to prevent. Intl.Segmenter is in every
// browser we target; the spread is a last-resort fallback.
const segmenter = typeof Intl !== "undefined" && Intl.Segmenter
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null;

/** @returns {string[]} one entry per user-perceived character */
export function graphemes(text) {
  const s = String(text ?? "");
  return segmenter ? [...segmenter.segment(s)].map(g => g.segment) : [...s];
}

/**
 * Opacity for the grapheme at `i`, or undefined to leave it untouched.
 * @param {number} lastFit index of the last grapheme that fits entirely
 * @param {number[]} steps ramp, faintest last
 */
export function fadeOpacity(lastFit, i, steps = STEPS) {
  const d = lastFit - i;
  if (d < 0) return 0;                                    // past the edge — never shown
  if (d < steps.length) return steps[steps.length - 1 - d];
  return undefined;                                       // well inside — full strength
}
