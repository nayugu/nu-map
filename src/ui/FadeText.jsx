// ═══════════════════════════════════════════════════════════════════
// FADE TEXT — single-line text that fades out PER CHARACTER when clipped
// ═══════════════════════════════════════════════════════════════════
// The last few visible characters step down in opacity (whole glyphs — no
// gradient slicing through a stroke, matching the instructor-list opacity
// language), and everything past them is fully invisible, so no glyph ever
// touches the container edge.
//
// Text that FITS is rendered as one plain text node, untouched: splitting it
// would cost a DOM node per character for no visual gain, and — more to the
// point — a browser only shapes text within a single inline box, so per-glyph
// spans break cursive joining (Arabic) and any ligature. That only has to be
// paid for when there is actually something to fade.
import { useLayoutEffect, useRef, useState } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";
// The ramp arithmetic and grapheme splitting live in core/ so the "no cut
// glyph is ever visible" rule is unit-tested rather than asserted in prose.
import { STEPS, GRADUAL_STEPS, graphemes, fadeOpacity } from "../core/fadeRamp.js";


export default function FadeText({ text, rtl = false, align, style, steps = STEPS }) {
  const ref = useRef(null);
  // null = nothing clipped, render plain. Otherwise the index of the last
  // grapheme that fits (-1 = clipped before even the first one).
  const [lastFit, setLastFit] = useState(null);
  const str = String(text ?? "");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let next = null;
    if (el.scrollWidth > el.clientWidth + 1) {
      // Clipped. In plain-text mode there are no per-grapheme children to
      // measure yet, so -1 switches this render into split mode and the next
      // pass — still inside this layout effect, before paint — does the real
      // measurement.
      next = -1;
      const box = el.getBoundingClientRect();
      for (let i = 0; i < el.children.length; i++) {
        const r = el.children[i].getBoundingClientRect();
        // Last grapheme that fits entirely, with 2px clearance from the edge.
        const fits = rtl ? r.left >= box.left + 2 : r.right <= box.right - 2;
        if (fits) next = i; else break;
      }
    }
    if (next !== lastFit) setLastFit(next);
  });

  const chars = lastFit === null ? null : graphemes(str);

  return (
    <span ref={ref} style={{
      overflow: "hidden",
      // `pre`, not `nowrap`: this often stands in for an <input>, which keeps
      // its value verbatim, and `nowrap` would collapse a run of spaces in a
      // name into one. Both stop wrapping.
      whiteSpace: "pre",
      minWidth: 0,
      // Clipped text fills the box, so it has to start at the reading edge:
      // a right-aligned overflow would clip the head instead of the tail and
      // the per-character measurement would run against the wrong edge.
      textAlign: lastFit === null ? align : (rtl ? "right" : "left"),
      ...style,
    }}>
      {chars === null ? str : chars.map((ch, i) => {
        const op = fadeOpacity(lastFit, i, steps);
        return (
          <span key={i} style={op === undefined ? undefined : { opacity: op }}>{ch}</span>
        );
      })}
    </span>
  );
}

/** Locale direction, for the fade to run off the trailing edge either way. */
export function useRtl() {
  const { locale, locales } = useLanguage();
  return (locales.find(l => l.code === locale)?.dir ?? "ltr") === "rtl";
}

/** Text input that wears the same fade while it is not focused: an entry too
    long for its field would otherwise end in a half-cut glyph. The real value
    stays in the input and only paints transparent, so caret, selection and IME
    are untouched — while editing you see the plain text, scrolled as usual. */
export function FadeInput({ value, style, steps = GRADUAL_STEPS, onFocus, onBlur, ...rest }) {
  const [focused, setFocused] = useState(false);
  const rtl = useRtl();
  const faded = !focused && !!value;
  // Alignment reaches the overlay as the `align` prop instead of raw style —
  // FadeText overrides it once the text is clipped.
  const { textAlign, width, ...textStyle } = style ?? {};

  return (
    <div style={{ position: "relative", width: "100%", minWidth: 0 }}>
      <input
        {...rest}
        value={value}
        onFocus={e => { setFocused(true); onFocus?.(e); }}
        onBlur={e => { setFocused(false); onBlur?.(e); }}
        style={faded ? { ...style, color: "transparent" } : style}
      />
      {faded && (
        // Centred against the input's line box, and inert so every click still
        // lands on the input underneath. aria-hidden because it is a PAINTING of
        // the input's value: the input itself already carries that value, and
        // without this a screen reader meets the same text twice.
        <div aria-hidden="true"
             style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", pointerEvents: "none" }}>
          <FadeText text={value} rtl={rtl} align={textAlign} steps={steps}
            style={{ ...textStyle, flex: 1, minWidth: 0 }} />
        </div>
      )}
    </div>
  );
}
