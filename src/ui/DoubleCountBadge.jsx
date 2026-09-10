// ═══════════════════════════════════════════════════════════════════
// DOUBLE-COUNT BADGE — this course counts toward more than one credential.
//
// Northeastern permits that, and caps it: "a maximum of 50% of the credits
// required for a minor from their major, transfer credit, or advanced standing
// credit". It is the ONLY overlap in the app with a budget attached, which is
// the whole reason it is the only one marked:
//
//   · two majors are the case this app applies NO limit to, so a course shared
//     by two majors alone gets no badge — there is no budget here for the badge
//     to be a fraction OF. ⚠ That is a statement about us, not a permission.
//     This comment read "two majors double-count freely (no budget, nothing for
//     an advisor to watch)" and cited NU policy for it; corrected 2026-09-10,
//     because the catalog says the opposite in three places — a double major
//     "must be approved by the home college of each major" precisely BECAUSE of
//     course overlap, graduate credit sharing needs both colleges' approval and
//     caps two master's programs at 50%, and 52 live pages state their own
//     limits ("Only one course can be double counted toward any other major or
//     minor"). See GradPanel's header for the quotations. Nothing drawn here
//     may imply major↔major sharing is unlimited;
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
//   grey dashed    eligible — not placed. Taking it WOULD count more than once.
//   green chip     counted — every audit named below already claims it.
//   amber chip     over — one of those minors is past its 50% cap.
//
// Fill XOR outline, never both: a fact about the plan is a tinted chip like the
// SH one beside it, a possibility is an empty dashed outline. Hue alone cannot
// carry that difference, because over the cap BOTH states are amber.
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
import ShareMeter, { shareSegments } from "./ShareMeter.jsx";
import { useRelevance } from "../context/RelevanceContext.jsx";
import { useLanguage }  from "../context/LanguageContext.jsx";
import { useTranslatedText } from "../context/TranslationContext.jsx";

/** A backstop only: the cap is floored, so these figures are already whole. */
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
function BudgetLine({ minor, majors = 1 }) {
  const { t } = useLanguage();
  const name = useTranslatedText(minor.name ?? null);
  const seg = shareSegments(minor);
  return (
    <div style={{ marginTop: 7 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-3)",
                    lineHeight: 1.35 }}>
        {name || minor.name}
      </div>
      {/* No figure line: it read "16.5 of 23 SH", credit that counts once the
          cap is applied, and that number appears nowhere else in the app. The
          bar carries the proportion; the amber line carries the number that
          can be acted on. */}
      <div style={{ marginTop: 3 }}>
        <ShareMeter {...seg} height={4} />
      </div>
      {/* WHAT TO DO, on the minor it is about, and only when there is
          something to do.
          Two policy restatements stood here before it and both were confusing
          for the same reason: they described the RULE and left the reader to
          work out the consequence. "7 past the limit, doesn't count" is a
          legend for a bar segment, and "the credit past half a minor does not
          count toward it" is the rule with a pronoun in it. The number is
          identical in all three versions; only this one says what the number
          means for the plan, and it sits under the minor whose number it is,
          so two minors state two figures rather than one sentence covering
          both ambiguously.
          Nothing is printed when the minor is inside its cap: the bar has
          already said so, and a card that speaks only when it has something to
          report is the difference between a glance and a paragraph. */}
      {seg.excess > 0 && (
        <div style={{ display: "flex", gap: 4, fontSize: 11, lineHeight: 1.35,
                      color: "var(--warn-badge-text)", marginTop: 3 }}>
          <span style={{ flexShrink: 0, fontWeight: 800 }}>!</span>
          {/* "your major" is WRONG when two are named a few lines below, and
              the reason is the cap's own arithmetic: the minor holds ONE
              budget and BOTH majors spend it (`majorClaim` unions them, so a
              course either one claims is charged). A student told to find
              credit "your major doesn't count" would reasonably go looking in
              their second major, where it is charged just the same. */}
          <span>{t(majors > 1 ? "relevance.dc.minorNeeds.two"
                              : "relevance.dc.minorNeeds", { sh: fmt(seg.excess) })}</span>
        </div>
      )}
    </div>
  );
}

/**
 * A major: named, with no budget beside it.
 *
 * Naming it is not optional. The badge counts majors, so "2×" over a single
 * named minor left the student to infer the second program, and with two majors
 * selected there was nothing to infer FROM, since a course can be claimed by
 * the second and not the first.
 *
 * But it is smaller and dimmer than `BudgetLine`, not equal to it. A major has
 * no double-counting ceiling here, so there is no meter to draw and no figure
 * to quote, and drawn at the same weight the names read as four peers of which
 * two mysteriously have bars. Caption weight under a label says what the flat
 * list could not: these are the ones with nothing to measure.
 */
function ProgramLine({ name }) {
  const translated = useTranslatedText(name || null);
  return (
    <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-4)",
                  lineHeight: 1.35 }}>
      {translated || name}
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

  // THE TITLE IS THE PANEL'S OWN HEADING for this concept, "Double counting".
  //
  // Two attempts preceded it and each failed differently. "Counts toward {n}
  // programs" summed a major (no budget here) with a minor (the one budget we
  // hold), so two majors and two minors read "4 programs" on every eligible
  // course whether anything was over or not. "Shared with both minors" then
  // made a fact about ONE COURSE sound like a property of the minors, and put
  // the invented word "shared" where the panel says "double counting" two
  // clicks away. Naming it identically in both places costs nothing and means a
  // student who has read one has read the other.
  //
  // The programs are named below, so the title does not have to enumerate
  // them; the only thing it still carries is whether this is a fact or a
  // possibility, which the dashed-vs-filled badge also says.
  const title = t(dc.placed ? "relevance.dc.head.does" : "relevance.dc.head.would");

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
        // The card's own content, since there is no longer a summary sentence
        // to borrow: the heading, then the programs. Raw names rather than the
        // translated ones, because translation is a hook per rendered line and
        // this is one attribute on the glyph.
        aria-label={[title, ...dc.minors.map(m => m.name),
                     ...(dc.majors ?? []).map(m => m.name)]
                     .filter(Boolean).join(". ")}
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

      {/* A GLANCE, NOT AN EXPLANATION.
          The graduation panel is where the rule is explained, at length and in
          one place; a hover card that tries to do the same job competes with it
          and loses, because it has to say everything on every course. So this
          card carries FACTS about this course and nothing else:

            1. what it is shared with (the title),
            2. each minor's budget, drawn with the panel's own meter,
            3. the majors, named once and quietly,
            4. one short clause of state, and only when it says something.

          That is the correction of two mistakes in a row. It opened with a
          count of credentials ("4 programs") that summed the budgeted and the
          unbudgeted and so discriminated nothing; then, having named the
          majors, it printed the flat list beside two meters and closed with
          seven lines of policy. Both times the card grew because a fact was
          missing somewhere ELSE. */}
      {hover && (
        <HoverCard rect={hover} maxWidth={260}>
          {/* Neutral, never the badge's ink: the headline fact is that a course
              is doing double duty, which is good news even when a minor is over
              its cap. Colouring it amber announced a fault at the top of a card
              whose subject is a benefit. */}
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-2)",
                        lineHeight: 1.35 }}>
            {title}
          </div>

          {/* THE MINORS FIRST, because they are the only programs here with a
              ceiling, and the meter is the reason to open this card at all. */}
          {/* `majors` is how many majors CLAIM THIS COURSE, which is also how
              many are named below it, so the sentence and the caption cannot
              disagree. It is not "how many majors are selected": with two
              selected and one claiming, the singular is the true sentence. */}
          {dc.minors.map(m => (
            <BudgetLine key={m.n} minor={m} majors={(dc.majors ?? []).length} />
          ))}

          {/* THE MAJORS, named once and demoted to a caption.
              Naming them is not optional: the badge counts them, so a card that
              did not name them left "2×" against a single named minor. But they
              carry no budget, so they get no meter and no weight of their own —
              a label plus the names, in the ink the legend uses. A major with no
              name is skipped rather than drawn blank, which would read as a
              program whose name we lost. */}
          {(dc.majors ?? []).some(m => m.name) && (
            <div style={{ marginTop: 8, paddingTop: 6,
                          borderTop: "1px solid var(--border-2)" }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.05em",
                            color: "var(--text-5)", marginBottom: 2 }}>
                {t("relevance.dc.majors.label")}
              </div>
              {dc.majors.filter(m => m.name).map(m => (
                <ProgramLine key={`major${m.n}`} name={m.name} />
              ))}
            </div>
          )}

          {/* Nothing closes the card. A state clause stood here through three
              wordings and every one of them restated the rule: what a student
              can act on is a number under the minor it belongs to, which
              `BudgetLine` now prints in the warning ink, and what the rule IS
              belongs in the panel, where it is read once instead of on every
              course. The card ends when it runs out of facts. */}
        </HoverCard>
      )}
    </>
  );
}
