// ═══════════════════════════════════════════════════════════════════
// SHARE METER — what a minor's credit is PAID FOR WITH.
//
// Two surfaces draw it: the minor card's `Double counting` row
// (GradPanel → SharedCredit) and the 2× badge's hover card
// (DoubleCountBadge → BudgetLine). A student can have both open at once, so
// they have to be the same picture — this is that picture, once.
//
// ── Why it is not a warning meter ────────────────────────────────
//
// The first version drew the CAP: a track scaled to the ceiling, neutral up
// to it, amber past it. That framing is wrong, and it was wrong in a way a
// student feels. Double counting is a BENEFIT — courses counting toward two
// credentials at once is free credit, and the cap is a limit on a good
// thing. Drawing it in the app's "something is broken" colour made the good
// news look like a fault, and it spent that colour five times over on one
// hover card: the heading, two figures and two bars.
//
// What is genuinely bad is the TAIL — credit the student believes they have
// banked toward the minor that Northeastern will not accept, so the minor is
// not as finished as the card above says.
//
// That band is amber, and grey was tried first. Both were rendered and
// compared, and grey lost on a property the argument for it missed: the band
// is SMALL — 2 SH of a 20 SH minor is a tenth of the bar — and a small grey
// segment against the grey empty track beside it is nearly invisible. The one
// thing in the picture that needs acting on was the one thing you could not
// see. Amber now appears exactly twice, here and in the sentence below the
// bar, and both are the same fact, so it reads as one signal rather than the
// five the old card had. Amber next to green is the worst pair for red/green
// colour blindness, which is survivable only because colour is never the sole
// channel here: every band is labelled with its own figure and the sentence
// states the number in words.
//
// ── The track is the MINOR, not the cap ──────────────────────────
//
// Scaling to the ceiling answered "how much of my allowance have I spent",
// which is a question about our arithmetic. Scaling to the minor's own
// requirement answers "is my minor done, and what is it standing on" — and
// it stops this bar contradicting the progress bar directly above it, which
// counts the same credit without applying the cap. Four segments, and every
// number is one `minorShare` already returns:
//
//   ▓ counts   own + shared: everything that counts     → green
//   ░ over     double counted past the cap             → amber HATCHING
//   ┈ to go    not yet satisfied                       → the empty track
//
// `own` and `shared` are drawn as ONE green band. They were two, split by a
// hairline, with the split named in the legend — and the answer to "how much
// of this minor is only mine" is not a question a student asked. Both bands
// mean the same thing, this credit counts, so they look the same; which
// courses are shared is in the expanded detail, by name.
//
// The green is `--success-bar`, the token the requirement rows and every
// progress bar in the panel already use — a second, duller green for the
// shared part was tried and read as a distinction about our bookkeeping
// wearing the colour of one about the student's progress.
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {number} props.required  the minor's own requirement — the track
 * @param {number} props.own       credit only the minor claims
 * @param {number} props.shared    credit counted toward both, within the cap
 * @param {number} props.excess    credit double counted beyond the cap
 * @param {number} [props.height]
 */
export default function ShareMeter({ required, own, shared, excess, height = 5 }) {
  // A minor with no derivable requirement has no track to draw on. Callers
  // already refuse that case; this keeps a 0 from dividing.
  const span = required > 0 ? required : 1;
  const pct = (sh) => `${Math.max(0, Math.min(span, sh ?? 0)) / span * 100}%`;

  return (
    <div style={{ display: "flex", height, borderRadius: height / 2,
                  background: "var(--border-2)", overflow: "hidden" }}>
      <div style={{ width: pct(own + shared), background: "var(--success-bar)" }} />
      {/* A hairline of track between the two, so the amber is legibly a
          DIFFERENT kind of thing rather than more fill. Credit that does not
          count should not look like progress that does. */}
      {excess > 0 && (own + shared) > 0 && (
        <div style={{ width: 1, flexShrink: 0, background: "var(--border-2)" }} />
      )}
      <div style={{ width: pct(excess), background: "var(--warn-badge-text)" }} />
    </div>
  );
}

/**
 * The four segment sizes, from a `minorShare` result.
 *
 * Both surfaces need them and the arithmetic is easy to get subtly wrong —
 * `dependentSH` is the part of the CLAIMED credit that leans on the major, so
 * the allowed share is `min(dependent, cap)` and never the cap itself.
 */
export function shareSegments(share) {
  return {
    required: share.requiredSH,
    own:      Math.max(0, share.claimedSH - share.dependentSH),
    shared:   Math.min(share.dependentSH, share.capSH),
    excess:   Math.max(0, share.dependentSH - share.capSH),
  };
}
