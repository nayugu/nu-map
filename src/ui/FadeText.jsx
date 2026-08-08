// ═══════════════════════════════════════════════════════════════════
// FADE TEXT — single-line text that fades out PER CHARACTER when clipped
// ═══════════════════════════════════════════════════════════════════
// The last few visible characters step down in opacity (whole glyphs — no
// gradient slicing through a stroke, matching the instructor-list opacity
// language), and everything past them is fully invisible, so no glyph ever
// touches the container edge. Text that fits renders untouched. All characters
// stay in the DOM (only opacity changes), so the measurement is stable across
// passes.
import { useLayoutEffect, useRef, useState } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";

// Opacity of the last visible chars, nearest the edge last. The header's plan
// button is barely wider than the name it holds, so its ramp has to be short
// or the whole name dims; the co-op fields are far wider, and a longer, gentler
// ramp there reads as the name trailing off rather than being cut.
const STEPS         = [0.6, 0.32, 0.12];
const GRADUAL_STEPS = [0.92, 0.82, 0.7, 0.57, 0.44, 0.32, 0.21, 0.12, 0.05];

export default function FadeText({ text, rtl = false, align, style, steps = STEPS }) {
  const ref = useRef(null);
  const [lastFit, setLastFit] = useState(null);   // last fully visible char; null = nothing clipped

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let next = null;
    if (el.scrollWidth > el.clientWidth + 1) {
      // Last character that fits entirely, with 2px clearance from the edge.
      const box = el.getBoundingClientRect();
      next = -1;
      for (let i = 0; i < el.children.length; i++) {
        const r = el.children[i].getBoundingClientRect();
        const fits = rtl ? r.left >= box.left + 2 : r.right <= box.right - 2;
        if (fits) next = i; else break;
      }
    }
    if (next !== lastFit) setLastFit(next);
  });

  return (
    <span ref={ref} style={{
      overflow: "hidden", whiteSpace: "nowrap", minWidth: 0,
      // Clipped text fills the box, so it has to start at the reading edge:
      // a right-aligned overflow would clip the head instead of the tail and
      // the per-character measurement would run against the wrong edge.
      textAlign: lastFit === null ? align : (rtl ? "right" : "left"),
      ...style,
    }}>
      {[...text].map((ch, i) => {
        // Opacity is keyed to the distance from the edge, not to where the ramp
        // starts: a field too narrow for the whole ramp then uses its tail, so
        // the character at the cut stays the faintest one and the first glyph
        // the box slices through is still invisible.
        const d = lastFit === null ? -1 : lastFit - i;
        const op = d < 0 ? (lastFit === null ? undefined : 0)
                 : d < steps.length ? steps[steps.length - 1 - d]
                 : undefined;
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
        // lands on the input underneath.
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", pointerEvents: "none" }}>
          <FadeText text={value} rtl={rtl} align={textAlign} steps={steps}
            style={{ ...textStyle, flex: 1, minWidth: 0 }} />
        </div>
      )}
    </div>
  );
}
