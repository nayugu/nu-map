// ═══════════════════════════════════════════════════════════════════
// DOUBLE-COUNT BADGE — this course counts toward a major AND a minor.
//
// Northeastern permits that, and caps it: "a maximum of 50% of the credits
// required for a minor from their major". It is the ONLY overlap in the app
// with a budget attached, which is the whole reason it is the only one marked:
//
//   · two majors double-count freely (no budget, nothing for an advisor to
//     watch), so a shared course there gets no badge;
//   · a concentration is "a component of a major", not a second credential —
//     there are not two things there to double count between;
//   · NUPath and degree requirements overlap without limit, by the same
//     catalog sentence that permits the minor overlap in the first place.
//
// ── Three states, one glyph ──────────────────────────────────────
//
//   eligible      outlined  — not placed. Slotting it in WOULD count twice.
//   counted       filled    — placed, and both audits claim it.
//   over budget   amber     — counted, and this minor is past its 50% cap.
//
// A double-checkmark was the first idea and reads as a read-receipt ("seen
// twice"); "2×" says the thing itself. Purple because it is the one hue the
// app does not already spend: green/amber/red belong to prerequisite state
// (REL_STYLE) and every other colour on a card is a SUBJECT. `--link-2` is a
// theme token, so this is not a new colour, it is an unused one.
//
// ── The amber is a fact about the MINOR ──────────────────────────
//
// No single course is "the one over the limit" — the shared SET is — so every
// card in that set turns amber together and the tooltip carries the set's own
// numbers rather than pretending this course is the culprit. The badge is a
// pointer to the minor card's Double counting row, never a second opinion:
// both read the same `minorShare` result out of RelevanceContext.
//
// ── It is dark for most students, and that is the design ─────────
//
// Measured over 225 (major, minor) pairs against the whole catalog, ranges
// included: 172 of them — 76% — have ZERO courses eligible for both. Median 0,
// p90 two courses, maximum twenty. So this is a precision mark for the
// cognate-pair students it exists for, not a browsing aid, and it must stay
// cheap enough to be invisible when it says nothing.
// ═══════════════════════════════════════════════════════════════════
import { useRelevance } from "../context/RelevanceContext.jsx";
import { useLanguage }  from "../context/LanguageContext.jsx";
import { useTranslatedText } from "../context/TranslationContext.jsx";
import { REL_STYLE }    from "../core/constants.js";

/** Whole numbers stay whole; the cap is the one figure that can be a half. */
const fmt = (sh) => (Number.isInteger(sh) ? String(sh) : sh.toFixed(1));

/**
 * @param {object}  props.course  the catalog course (needs subject + number)
 * @param {boolean} [props.compact]  phone-sized card
 */
export default function DoubleCountBadge({ course, compact = false }) {
  const { doubleCount } = useRelevance();
  const { t } = useLanguage();
  const dc = course ? doubleCount?.(course) : null;
  // Before the early return: the minor's name is scraped English and gets the
  // same live translation a program name gets anywhere else, and a hook cannot
  // sit behind a condition.
  const minorName = useTranslatedText(dc?.minorName ?? null);
  if (!dc) return null;

  const params = { name: minorName || dc.minorName, sh: fmt(dc.sh), cap: fmt(dc.capSH) };
  const title = dc.over    ? t("relevance.both.over", params)
              : dc.placed  ? t("relevance.both.counted", params)
              :              t("relevance.both.eligible", params);

  const purple = "var(--link-2)";
  const amber  = REL_STYLE["corequisite-viol"].color;
  const ink    = dc.over ? amber : purple;

  return (
    <span
      title={title}
      aria-label={title}
      style={{
        flexShrink: 0,
        fontSize: compact ? 6.5 : 8,
        fontWeight: 800,
        lineHeight: 1,
        letterSpacing: 0,
        padding: compact ? "1px 2px" : "1px 3px",
        borderRadius: 3,
        whiteSpace: "nowrap",
        // Filled once it is a fact about the plan; outlined while it is still
        // only a possibility. The difference has to survive at 6.5px on a
        // phone, so it is fill-vs-outline rather than two shades of one colour.
        color: dc.placed ? "var(--badge-bg)" : ink,
        background: dc.placed ? ink : "transparent",
        border: `1px solid ${ink}`,
      }}
    >2×</span>
  );
}
