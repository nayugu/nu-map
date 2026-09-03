// ═══════════════════════════════════════════════════════════════════
// DOUBLE-COUNT BADGE — this course counts toward more than one credential.
//
// Northeastern permits that, and caps it: "a maximum of 50% of the credits
// required for a minor from their major, transfer credit, or advanced standing
// credit". It is the ONLY overlap in the app with a budget attached, which is
// the whole reason it is the only one marked:
//
//   · two majors double-count freely (no budget, nothing for an advisor to
//     watch), so a course shared by two majors alone gets no badge;
//   · a concentration is "a component of a major", not a second credential —
//     it folds into the major's role and never adds to the count;
//   · NUPath and degree requirements overlap without limit, by the same
//     catalog sentence that permits the minor overlap in the first place.
//
// ── The number is a COUNT, the colour is a STATE ─────────────────
//
// Two orthogonal facts, so they get two channels. `3×` means three credentials
// tick this course; the colour says whether that is fine or over a limit. An
// earlier version encoded both in colour and could not express "three
// programs, all within budget" without inventing a fourth hue.
//
//   grey outline   eligible — not placed. Taking it WOULD count more than once.
//   green filled   counted — every audit named below already claims it.
//   amber filled   over — one of those minors is past its 50% cap.
//
// Traffic-light rather than a house hue. This was purple for a while, chosen
// because purple was the one colour the app had not spent — which optimised for
// not colliding rather than for being understood, and purple tells a student
// nothing. Green-means-good and amber-means-look survive not knowing the
// product. The hover card carries the rest.
//
// ── The amber is a fact about the MINOR ──────────────────────────
//
// No single course is "the one over the limit" — the shared SET is — so every
// card in that set turns amber together and the card quotes the minor's own
// numbers rather than pretending this course is the culprit. `over` is true if
// ANY minor it draws on is over: with two minors a student needs to know a
// limit is breached, not which one, and the hover card names it anyway.
//
// ── It is dark for most students, and that is the design ─────────
//
// Measured over 225 (major, minor) pairs against the whole catalog, ranges
// included: 172 of them — 76% — have ZERO courses eligible for both. Median 0,
// p90 two courses, maximum twenty. A precision mark for the cognate-pair
// students it exists for, not a browsing aid.
// ═══════════════════════════════════════════════════════════════════
import { useState } from "react";
import HoverCard from "./HoverCard.jsx";
import ShareMeter from "./ShareMeter.jsx";
import { useRelevance } from "../context/RelevanceContext.jsx";
import { useLanguage }  from "../context/LanguageContext.jsx";
import { useTranslatedText } from "../context/TranslationContext.jsx";

/** Whole numbers stay whole; the cap is the one figure that can be a half. */
const fmt = (sh) => (Number.isInteger(sh) ? String(sh) : sh.toFixed(1));

/**
 * One minor's budget in the hover card: its name, its spend, its ceiling, drawn
 * with the SAME meter as the minor card's `Double counting` row.
 *
 * It used to be one grey sentence — "Data Science, Minor — 14 of 22.5 SH double
 * counted" — below two lines of prose, which put the only specific fact in the
 * card last and in the dimmest ink, and stated a ceiling in the grammar of a
 * total. The figures are the same; what changed is that they are now the SUBJECT
 * of the card rather than its footnote, and that "of {cap} SH allowed" is the
 * same phrase the panel uses, because it is the same fact.
 */
function BudgetLine({ minor }) {
  const { t } = useLanguage();
  const name = useTranslatedText(minor.name ?? null);
  const ink  = minor.over ? "var(--warn-badge-text)" : "var(--text-2)";
  return (
    <div style={{ marginTop: 7 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-3)",
                    lineHeight: 1.35 }}>
        {name || minor.name}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4, margin: "1px 0 3px" }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: ink, letterSpacing: 0 }}>
          {fmt(minor.sh)}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-5)" }}>
          {t("grad.share.cap", { cap: fmt(minor.capSH) })}
        </span>
      </div>
      <ShareMeter used={minor.sh} cap={minor.capSH} over={minor.over}
                  color="var(--warn-badge-text)" height={4} />
    </div>
  );
}

/**
 * @param {object}  props.course  the catalog course (needs subject + number)
 * @param {boolean} [props.compact]  phone-sized card
 * @param {boolean} [props.corner]   push to the end of its flex row — the
 *   planner card's top-right, where nothing else sits. Done with `margin-left:
 *   auto` rather than absolute positioning on purpose: the code beside it
 *   ellipsises, and an absolutely-placed badge would be overlapped by a long
 *   reservation title instead of shortening it.
 */
export default function DoubleCountBadge({ course, compact = false, corner = false }) {
  const { doubleCount } = useRelevance();
  const { t } = useLanguage();
  const [hover, setHover] = useState(null);     // anchor rect while shown
  const dc = course ? doubleCount?.(course) : null;
  if (!dc) return null;

  // grey → green → amber. `--warn-badge-text` rather than `--warn`: it is the
  // token tuned to stay legible AS a badge in both themes.
  const ink = dc.over   ? "var(--warn-badge-text)"
            : dc.placed ? "var(--success)"
            :             "var(--text-4)";

  const title = t(dc.placed ? "relevance.dc.title.does" : "relevance.dc.title.would",
                  { n: dc.count });
  const meaning = t(dc.over ? "relevance.dc.over"
                   : dc.placed ? "relevance.dc.counted"
                   : "relevance.dc.eligible");

  return (
    <>
      <span
        // The rect is read on enter and kept: by the time state settles React
        // has pooled the event and nulled currentTarget.
        onMouseEnter={e => setHover(e.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => setHover(null)}
        // Touch has no hover. Tap toggles, and stops the card underneath from
        // taking the tap as a selection.
        onClick={e => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          setHover(h => (h ? null : rect));
        }}
        aria-label={`${title}. ${meaning}`}
        style={{
          flexShrink: 0,
          fontSize: compact ? 6.5 : 8,
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: 0,
          padding: compact ? "1px 2px" : "1px 3px",
          borderRadius: 3,
          whiteSpace: "nowrap",
          cursor: "help",
          ...(corner ? { marginLeft: "auto" } : null),
          // ── The colour is the ink, not the fill ──────────────────
          // It used to be a solid block of colour with the card's own
          // background punched out of it, which made it the loudest thing on a
          // card whose SUBJECT is the course code. Inverted, it reads as a chip
          // like the SH one beside it — same `--badge-bg`, coloured text — and
          // the hue still carries the state.
          //
          // What that inversion spends is the fill/outline difference, which is
          // what told "counts toward both" from "would count if you took it".
          // Hue covers it for the ordinary pair (green vs grey), but NOT for
          // amber: over the cap both states are amber, and a filled-vs-outlined
          // amber was the only thing between them.
          //
          // So it is fill XOR outline, never both: a fact about the plan is a
          // chip like the SH one beside it (tint, no border), a possibility is
          // an empty dashed outline. One shape each, still legible at 6.5px on
          // a phone, and the ring around the filled state — which was doing no
          // work once the fill stopped being solid colour — is gone.
          color: ink,
          background: dc.placed ? "var(--badge-bg)" : "transparent",
          border: dc.placed ? "1px solid transparent" : `1px dashed ${ink}`,
        }}
      >{dc.count}×</span>

      {/* SPECIFIC BEFORE GENERAL. The card used to open with a large coloured
          headline, spend three lines restating the rule, and finish with the
          one number that is about THIS student. The order is inverted now: the
          state, then each minor's budget, then the rule in the dimmest ink — a
          student who already knows the rule never has to read past the meter,
          and one who doesn't still finds it. The title keeps its colour (it
          carries the state) but drops to the body's size; at headline weight it
          was the loudest thing in the card and the least informative. */}
      {hover && (
        <HoverCard rect={hover} maxWidth={260}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: ink, lineHeight: 1.35 }}>
            {title}
          </div>
          {dc.minors.map(m => <BudgetLine key={m.n} minor={m} />)}
          {/* One step brighter over the cap: that sentence stops being the rule
              and becomes the way out ("Add minor coursework your major doesn't
              count"), which is the most useful line in the card. Not the warn
              colour — four lines of amber under an amber heading is a shout,
              and the meter has already said it. */}
          <div style={{ marginTop: 7, paddingTop: 6, borderTop: "1px solid var(--border-2)",
                        fontSize: 11.5, lineHeight: 1.45,
                        color: dc.over ? "var(--text-4)" : "var(--text-5)" }}>
            {meaning}
          </div>
        </HoverCard>
      )}
    </>
  );
}
