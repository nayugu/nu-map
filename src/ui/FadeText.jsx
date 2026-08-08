// ═══════════════════════════════════════════════════════════════════
// FADE TEXT — single-line text that fades out PER CHARACTER when clipped
// ═══════════════════════════════════════════════════════════════════
// The last three visible characters step down in opacity (whole glyphs — no
// gradient slicing through a stroke, matching the instructor-list opacity
// language), and everything past them is fully invisible, so no glyph ever
// touches the container edge. Text that fits renders untouched. All characters
// stay in the DOM (only opacity changes), so the measurement is stable across
// passes.
import { useLayoutEffect, useRef, useState } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";

const STEPS = [0.6, 0.32, 0.12];   // opacity of the last 3 visible chars

export default function FadeText({ text, rtl = false, align, style }) {
  const ref = useRef(null);
  const [fadeFrom, setFadeFrom] = useState(-1);   // index of first faded char; -1 = fits

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let next = -1;
    if (el.scrollWidth > el.clientWidth + 1) {
      // Last character that fits entirely, with 2px clearance from the edge.
      const box = el.getBoundingClientRect();
      let lastFit = -1;
      for (let i = 0; i < el.children.length; i++) {
        const r = el.children[i].getBoundingClientRect();
        const fits = rtl ? r.left >= box.left + 2 : r.right <= box.right - 2;
        if (fits) lastFit = i; else break;
      }
      next = Math.max(0, lastFit - (STEPS.length - 1));
    }
    if (next !== fadeFrom) setFadeFrom(next);
  });

  return (
    <span ref={ref} style={{
      overflow: "hidden", whiteSpace: "nowrap", minWidth: 0,
      // Clipped text fills the box, so it has to start at the reading edge:
      // a right-aligned overflow would clip the head instead of the tail and
      // the per-character measurement would run against the wrong edge.
      textAlign: fadeFrom === -1 ? align : (rtl ? "right" : "left"),
      ...style,
    }}>
      {[...text].map((ch, i) => {
        const step = fadeFrom === -1 ? -1 : i - fadeFrom;
        return (
          <span key={i} style={step >= 0 ? { opacity: STEPS[step] ?? 0 } : undefined}>{ch}</span>
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
export function FadeInput({ value, style, onFocus, onBlur, ...rest }) {
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
          <FadeText text={value} rtl={rtl} align={textAlign}
            style={{ ...textStyle, flex: 1, minWidth: 0 }} />
        </div>
      )}
    </div>
  );
}
