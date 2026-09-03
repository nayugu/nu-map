// ═══════════════════════════════════════════════════════════════════
// SHARE METER — one drawing of "how much of a minor's credit is double
// counted, against how much may be".
//
// Two surfaces show that budget: the minor card's `Double counting` row
// (GradPanel → SharedCredit) and the 2× badge's hover card
// (DoubleCountBadge → BudgetLine). A student can have both open at once, so
// they have to be the same picture — this is that picture, once.
//
// ── Why a meter at all ───────────────────────────────────────────
//
// The figures alone were read wrong. A cap is a CEILING, not a total, so
// `12 / 8 SH` looks like a fraction above one, i.e. like a bug, and the eye
// has to do the subtraction to find out whether that is bad. Here the TRACK
// is the allowance: under the cap the fill stops short of the end, over it
// the fill runs past the ceiling in the warning colour. The overage is the
// only coloured thing, because staying under a limit is not an achievement
// and must not read like one.
//
// The track is scaled to whichever of the two is larger. That is what makes
// "the track is your allowance" true in the ordinary case while still leaving
// somewhere for an overage to be drawn.
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {number}  props.used    credit counted toward both (`dependentSH`)
 * @param {number}  props.cap     the ceiling (`capSH`)
 * @param {boolean} props.over    past the ceiling
 * @param {string}  props.color   the warning ink, supplied by the caller so
 *                                each surface keeps its own badge/text token
 * @param {number}  [props.height]
 */
export default function ShareMeter({ used, cap, over, color, height = 5 }) {
  // A minor with a 0 SH cap has nothing to divide by.
  const span   = Math.max(cap, used) || 1;
  const capPct = Math.min(100, (cap / span) * 100);
  const usedPct = Math.min(100, (used / span) * 100);

  return (
    <div style={{ position: "relative", height, borderRadius: height / 2,
                  background: "var(--border-2)", overflow: "hidden" }}>
      {/* `--text-4` rather than `--text-5`: the dimmest ink is a shade off the
          track's own colour in the dark theme (#4e5662 on #30363d) and the
          fill disappeared into it. */}
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0,
                    width: `${usedPct}%`, background: "var(--text-4)" }} />
      {over && (
        <div style={{ position: "absolute", left: `${capPct}%`, top: 0, bottom: 0,
                      width: `${Math.max(0, usedPct - capPct)}%`, background: color }} />
      )}
      {/* The ceiling itself, drawn over the fill. Only meaningful when the fill
          runs past it — under the cap it sits at the end of the track, which is
          already where the allowance ends. */}
      <div style={{ position: "absolute", left: `calc(${capPct}% - 1px)`, top: -1, bottom: -1,
                    width: 2, background: "var(--text-2)" }} />
    </div>
  );
}
