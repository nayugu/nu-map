// ═══════════════════════════════════════════════════════════════════
// CHART EXPLAINER — how the generated plan was built, in the order a person asks
//
// ── Two lists and a method, and that is all ────────────────────────
//
// This panel was four sections and a dozen per-plan statistics, and it never said what
// the engine actually DOES — which is both the interesting part and the only part a
// reader can check the grid against. So it is now:
//
//   the contract   what every plan MUST satisfy, then what it optimises for
//   the method     how a requirement becomes a card, gets a set of legal terms,
//                  and how the search narrows 10^31 arrangements to nineteen tries
//
// The contract is not a simplification written for the UI. The first list is exactly
// what `chart-gate.js` asserts at ZERO over all 1,031 shapes and what no relaxation
// rung may ever give up; the second is `DEFAULT_PREFERENCES.ranked` plus the orderings
// the search applies within it. If either stops matching the code, the code changed.
//
// ── What was kept from the old version, and why ────────────────────
//
// One thing: the warning that a requirement could not be scheduled. It is the single
// place a plan is knowingly incomplete, and it was added precisely so that a missing
// requirement cannot be invisible — dropping it with the rest would have quietly
// recreated the defect it exists to prevent.
// ═══════════════════════════════════════════════════════════════════
import { useLanguage } from "../context/LanguageContext.jsx";

/** The four questions, as headings. Body copy is per-plan and built below. */
export default function ChartExplainer({ report, program, onClose, isPhone }) {
  const { t } = useLanguage();
  if (!report) return null;

  const fz  = isPhone ? 9 : 12;
  const fzH = isPhone ? 10 : 13;

  const required = report.totalCreditsRequired ?? 0;

  const Section = ({ n, title, children }) => (
    <section style={{ marginBottom: isPhone ? 12 : 18 }}>
      <h4 style={{
        margin: "0 0 6px", fontSize: fzH, fontWeight: 700, letterSpacing: ".01em",
        display: "flex", alignItems: "baseline", gap: 8,
      }}>
        <span style={{
          fontSize: fz, fontWeight: 700, color: "var(--accent, #fb923c)",
          fontVariantNumeric: "tabular-nums",
        }}>{n}</span>
        {title}
      </h4>
      <div style={{ fontSize: fz, lineHeight: 1.55, color: "var(--text-2)" }}>{children}</div>
    </section>
  );

  /** A fact worth its own line, with the number leading. */
  const Fact = ({ value, children }) => (
    <div style={{ display: "flex", gap: 8, alignItems: "baseline", margin: "3px 0" }}>
      <span style={{
        minWidth: isPhone ? 26 : 34, textAlign: "right", fontWeight: 700,
        fontVariantNumeric: "tabular-nums", color: "var(--text-1)",
      }}>{value}</span>
      <span>{children}</span>
    </div>
  );

  return (
    <div
      role="dialog" aria-modal="true" aria-label={t("chart.explain.title")}
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        // The BACKDROP scrolls, not the card. `placeItems: center` on a fixed grid
        // pins the card's centre to the viewport's, so a card taller than the screen
        // has its top and bottom cut off with no way to reach them. Scrolling the
        // backdrop and letting the card size to its content reaches all of it.
        overflowY: "auto", overscrollBehavior: "contain",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        background: "rgba(0,0,0,.5)",
        padding: isPhone ? "12px 10px" : "32px 24px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 620,
          // OPAQUE, with a literal fallback. `--bg-surface-1` is translucent in this
          // theme, so the card showed the grid straight through it and every line of
          // text sat on top of a course card.
          background: "var(--bg-solid, var(--bg-1, #ffffff))",
          color: "var(--text-1)",
          border: "1px solid var(--border-2)",
          borderRadius: 10, padding: isPhone ? 14 : 22,
          boxShadow: "0 18px 48px rgba(0,0,0,.45)",
          // No maxHeight and no inner scroll: the backdrop above owns scrolling, so the
          // card is as tall as it needs to be and nothing is unreachable.
        }}
      >
        <header style={{ marginBottom: isPhone ? 10 : 16 }}>
          <div style={{ fontSize: fzH + 2, fontWeight: 800 }}>{t("chart.explain.title")}</div>
          <div style={{ fontSize: fz, color: "var(--text-3)", marginTop: 3 }}>
            {t("chart.explain.sub")}
          </div>
        </header>

        {/* ── 0. The contract, in two lists ──────────────────────────
          *
          * The whole engine in twelve lines, before any per-plan detail. It answers the
          * question a student actually has — "why is this the plan?" — which the sections
          * below answer only implicitly, one statistic at a time.
          *
          * The split is the engine's real architecture and not a simplification for the UI:
          * the first list is what `chart-gate.js` asserts at ZERO over every generated plan
          * and what no relaxation rung is ever allowed to give up, and the second is
          * `DEFAULT_PREFERENCES.ranked` plus the orderings the search applies inside it. If
          * either list stops matching the code, the code is what changed.
          */}
        <section style={{ marginBottom: isPhone ? 12 : 18 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{t("chart.contract.hard.h")}</div>
          <ol style={{ margin: "0 0 12px", paddingInlineStart: 20, lineHeight: 1.55 }}>
            {["1", "2", "3", "4", "5"].map(n => (
              <li key={n}>{t(`chart.contract.hard.${n}`)}</li>
            ))}
          </ol>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{t("chart.contract.soft.h")}</div>
          <ul style={{ margin: "0 0 10px", paddingInlineStart: 20, lineHeight: 1.55 }}>
            {["1", "2", "3", "4", "5"].map(n => (
              <li key={n}>{t(`chart.contract.soft.${n}`)}</li>
            ))}
          </ul>
        </section>

        {/* ── How it works, with this plan's own numbers ──────────────
          *
          * The four sections that used to sit here reported a dozen statistics and never said
          * what the engine DOES, which is the interesting part and the one a reader can check
          * the grid against. Every figure below is real: `report.cells`, `report.nodes` and
          * `report.searchSpaceLog10` come straight out of the search.
          *
          * The two numbers worth putting side by side are the space and the nodes. Around
          * 10^31 arrangements exist for a typical degree and a median program finds a legal one
          * in nineteen attempts — the ratio IS the method, and it explains constraint
          * propagation to someone who has never heard the phrase.
          */}
        <Section n="1" title={t("chart.how.h")}>
          <ol style={{ margin: "0 0 10px", paddingInlineStart: 20, lineHeight: 1.55 }}>
            <li>{t("chart.how.s1", { cells: report.cells, sh: report.cellsSH, required })}</li>
            <li>{t("chart.how.s2")}</li>
            <li>{t("chart.how.s3")}</li>
            <li>{t("chart.how.s4")}</li>
          </ol>
          <Fact value={`10^${Math.round(report.searchSpaceLog10 ?? 0)}`}>
            {t("chart.how.space")}
          </Fact>
          <Fact value={report.nodes}>{t("chart.how.nodes")}</Fact>
          <p style={{ margin: "6px 0 0", color: "var(--text-3)" }}>{t("chart.how.ratio")}</p>
          {(report.unschedulable ?? []).length > 0 && (
            <div style={{
              margin: "8px 0 0", padding: "7px 9px", borderRadius: 6,
              background: "var(--warn-bg)", border: "1px solid var(--warn-border)",
              color: "var(--warn)", fontWeight: 600,
            }}>
              {t("chart.explain.complete.unschedulable", {
                n: report.unschedulable.length,
                courses: report.unschedulable
                  .map(u => (u.courses ?? []).join(" / ") || u.title)
                  .filter(Boolean).join(", "),
              })}
            </div>
          )}
        </Section>


        <footer style={{
          display: "flex", justifyContent: "flex-end", gap: 8,
          borderTop: "1px solid var(--border-2)", paddingTop: 12, marginTop: 2,
        }}>
          <button
            onClick={onClose}
            style={{
              fontSize: fz, padding: isPhone ? "5px 10px" : "6px 14px", borderRadius: 6,
              border: "1px solid var(--border-2)", background: "var(--bg-surface-2)",
              cursor: "pointer", fontWeight: 600,
            }}
          >{t("chart.explain.close")}</button>
        </footer>
      </div>
    </div>
  );
}
