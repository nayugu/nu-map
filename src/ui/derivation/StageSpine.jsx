// ═══════════════════════════════════════════════════════════════════
// DERIVATION · the stages — and specifically, how they relate
//
// The first version drew these as equal boxes in a row, and the question it got was exactly the
// one the layout could not answer: "is it one stage then the next? are they simultaneous? is it
// choose one from many?"
//
// All three, in different places, which is why a row of equal boxes was hopeless:
//
//   1  turn requirements into courses     ─┐  strictly sequential. Each runs once, and the next
//   2  work out each course's semesters   ─┘  one needs what the last produced.
//   3  place them all                     ──  a LADDER. Attempt one follows every rule; if it
//        · following every rule        ✗      cannot finish, the next gives one convention up
//        · without the preferred order ✗      and starts again from scratch. Only the last one
//        · allowing 3 of a requirement ✓      to run produced anything.
//   4  improve the order                  ──  runs once, on whatever step 3 came back with.
//
// So this renders as a numbered sequence with the ladder INDENTED underneath its step, each rung
// marked ✗ or ✓. The indent carries "these are alternatives", the marks carry "tried in order
// until one worked", and the numbering carries "and this happens after that". None of that needs
// a sentence, which is the point — the previous version needed a paragraph and still did not
// land.
//
// ── The names are what a person would call them ─────────────────────
//
// "Demand" and "Narrowing" are the engine's words for these and mean nothing to a reader.
// "Turn the requirements into a list of courses" is longer and is what actually happens.
// ═══════════════════════════════════════════════════════════════════
import { useLanguage } from "../../context/LanguageContext.jsx";

/**
 * The one-line detail under a setup step.
 *
 * A lookup rather than a ternary. The ternary it replaced read "demand ? … : narrowing",
 * which is correct for exactly two stages and silently captions any third one as narrowing
 * — and there is now a third. An unknown key returns null and draws nothing, which is a
 * missing line rather than a wrong one.
 */
function setupDetail(s, t) {
  if (s.key === "demand") return t("chart.deriv.stage.demand.d", { n: s.cards, sh: s.sh ?? 0 });
  if (s.key === "narrowing") return t("chart.deriv.stage.narrowing.d2", { terms: s.terms ?? 0 });
  if (s.key === "early") {
    // Only the parts that happened. "11 kept" is the fact; "1 moved" and "2 left to CHART"
    // are corrections, and printing them as zeroes reads as a defect rather than a clean run.
    const parts = [t("chart.deriv.stage.early.d", { n: s.fixed ?? 0 })];
    if (s.moved > 0) parts.push(t("chart.deriv.stage.early.moved", { n: s.moved }));
    if (s.unplaced > 0) parts.push(t("chart.deriv.stage.early.unplaced", { n: s.unplaced }));
    if (s.overloaded) parts.push(t("chart.deriv.stage.early.overloaded"));
    return parts.join(" · ");
  }
  return null;
}

export default function StageSpine({ stages, isPhone }) {
  const { t } = useLanguage();
  const fz = isPhone ? 9 : 11;

  // The ladder is every search stage plus the packer; everything else is a numbered step.
  const rungs = stages.filter(s => s.kind === "search" || s.kind === "greedy");
  const setup = stages.filter(s => s.kind === "fixed");
  const after = stages.filter(s => s.kind === "local");
  const retry = stages.find(s => s.kind === "note");
  const refused = stages.find(s => s.kind === "refusal");

  let n = 0;
  const Step = ({ children, detail }) => {
    n += 1;
    const num = n;
    return (
      <div style={{ display: "flex", gap: 7, alignItems: "baseline", marginBottom: 5 }}>
        <span style={{
          flex: "0 0 auto", fontVariantNumeric: "tabular-nums",
          fontSize: fz, color: "var(--text-4)", minWidth: 12,
        }}>{num}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: fz + 1, color: "var(--text-2)" }}>{children}</span>
          {detail && (
            <span style={{ fontSize: fz, color: "var(--text-4)", marginInlineStart: 6 }}>
              {detail}
            </span>
          )}
        </span>
      </div>
    );
  };

  return (
    <div>
      {/* One detail line per setup stage, keyed by stage rather than by a ternary. It was
        * `demand ? … : narrowing`, which silently gave any third stage the narrowing
        * caption — and there is now a third. A lookup fails loudly instead. */}
      {setup.map(s => (
        <Step key={s.key} detail={setupDetail(s, t)}>
          {s.key === "early"
            ? t(`chart.deriv.stage.early.${s.source}`, { n: s.through })
            : t(`chart.deriv.stage.${s.key}`)}
        </Step>
      ))}

      {rungs.length > 0 && (
        <>
          <Step>{t("chart.deriv.stage.place", { n: setup[0]?.cards ?? 0 })}</Step>
          {/* ── The ladder ──────────────────────────────────────────
            * Indented under its step, so it reads as "these are ways of doing step 3" rather
            * than as steps of their own. Each rung says what it gave up and whether it worked;
            * a reader can then see that the plan came from the third attempt and what that
            * attempt had to concede to exist. */}
          <div style={{
            marginInlineStart: isPhone ? 19 : 19, marginBottom: 6,
            borderInlineStart: "1px solid var(--border-2)", paddingInlineStart: 9,
          }}>
            {rungs.map((s, i) => {
              const won = !!s.answered || !!s.arrangement;
              return (
                <div key={s.key + i} style={{
                  display: "flex", gap: 6, alignItems: "baseline", marginBottom: 3,
                }}>
                  <span style={{
                    flex: "0 0 auto", fontSize: fz,
                    // ✓ or ✗, and the colour is a STATUS colour used with the glyph rather than
                    // alone — status hues are reserved and never carry meaning by themselves.
                    color: won ? "var(--success)" : "var(--text-5)",
                  }}>{won ? "✓" : "✗"}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{
                      fontSize: fz, color: won ? "var(--text-1)" : "var(--text-4)",
                      fontWeight: won ? 600 : 400,
                    }}>{rungLabel(s, t)}</span>
                    <span style={{ fontSize: fz - 1, color: "var(--text-5)", marginInlineStart: 6 }}>
                      {s.kind === "greedy"
                        ? null
                        : t("chart.deriv.stage.rung.d", { nodes: (s.nodes ?? 0).toLocaleString() })}
                      {s.restarts > 0 && ` · ${t("chart.deriv.stage.restarts", { n: s.restarts })}`}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {after.map(s => (
        <Step key={s.key} detail={t("chart.deriv.stage.improve.d", { n: s.moves ?? 0 })}>
          {t("chart.deriv.stage.improve")}
        </Step>
      ))}

      {/* A retry is a whole SECOND pass over steps 1–3 under different assumptions. Stated
          plainly rather than folded away: the reader is otherwise looking at one record that
          contains two searches with no explanation for the seam. */}
      {retry && (
        <p style={{ margin: "2px 0 0", fontSize: fz, color: "var(--text-4)", lineHeight: 1.5 }}>
          {t(`chart.deriv.retry.${retry.because?.[0] ?? "breadth-guidance"}`)}
        </p>
      )}
      {refused && (
        <p style={{ margin: "4px 0 0", fontSize: fz, color: "var(--warn)", lineHeight: 1.5 }}>
          {t(`chart.deriv.refused.${refused.exhaustedSpace ? "space" : "budget"}`)}
        </p>
      )}
    </div>
  );
}

/** A rung's name: the convention it gave up, or "following every rule" for the first. */
function rungLabel(s, t) {
  if (s.kind === "greedy") return t("chart.deriv.stage.packer");
  if (!s.gave) return t("chart.deriv.rung.strict");
  return t("chart.deriv.gave", { what: t(`chart.deriv.gave.${s.gave}`) });
}
