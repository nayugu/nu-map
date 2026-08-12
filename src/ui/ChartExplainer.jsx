// ═══════════════════════════════════════════════════════════════════
// CHART EXPLAINER — how the generated plan was built, in the order a person asks
//
// ── Why this is not a list of features ─────────────────────────────
//
// The obvious version of this panel enumerates what the engine does: reads the
// requirements, checks prerequisites, checks availability, balances the load. Nobody
// reads that, and it answers a question nobody asked. A student opening this has ONE
// question — "can I trust this?" — and it has a shape:
//
//   1. is it complete?        will I graduate if I follow it
//   2. is it legal?           can I actually register for these, in this order
//   3. why THIS order?        the part that looks arbitrary and is not
//   4. what did it not know?  the part that decides how much to trust the rest
//
// So the panel is those four, in that order, and the fourth is not buried. A plan
// that admits what it could not check is more trustworthy than one that does not,
// and burying the limits is how a tool earns the confidence it should not have.
//
// ── It describes THIS plan, not the algorithm in general ───────────
//
// Every section takes the report for the plan on screen. "3 courses could only go
// where they are" is a fact about your degree; "the engine considers prerequisites"
// is a brochure. Where a plan has nothing to say for a section — no trades, no
// stretched years — that section says so rather than showing a general statement.
// ═══════════════════════════════════════════════════════════════════
import { useLanguage } from "../context/LanguageContext.jsx";

/** The four questions, as headings. Body copy is per-plan and built below. */
export default function ChartExplainer({ report, program, onClose, isPhone }) {
  const { t } = useLanguage();
  if (!report) return null;

  const fz  = isPhone ? 9 : 12;
  const fzH = isPhone ? 10 : 13;

  const required = report.totalCreditsRequired ?? 0;
  const over = (report.warnings ?? []).find(w => w.kind === "sections-exceed-degree");

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

        {/* ── 1. Completeness ────────────────────────────────────── */}
        <Section n="1" title={t("chart.explain.complete.h")}>
          <p style={{ margin: "0 0 6px" }}>{t("chart.explain.complete.p")}</p>
          <Fact value={report.cells}>{t("chart.explain.complete.cells")}</Fact>
          <Fact value={`${report.cellsSH}`}>
            {t("chart.explain.complete.credits", { required })}
          </Fact>
          {over && (
            <p style={{ margin: "6px 0 0", color: "var(--text-3)" }}>
              {t("chart.explain.complete.excess", { over: over.over, total: over.total })}
            </p>
          )}
        </Section>

        {/* ── 2. Legality ────────────────────────────────────────── */}
        <Section n="2" title={t("chart.explain.legal.h")}>
          <p style={{ margin: "0 0 6px" }}>{t("chart.explain.legal.p")}</p>
          <Fact value="✓">{t("chart.explain.legal.prereq")}</Fact>
          <Fact value="✓">{t("chart.explain.legal.season")}</Fact>
          <Fact value="✓">{t("chart.explain.legal.load")}</Fact>
          <Fact value="✓">{t("chart.explain.legal.once")}</Fact>
          <p style={{ margin: "6px 0 0", color: "var(--text-3)" }}>
            {t("chart.explain.legal.witness")}
          </p>
        </Section>

        {/* ── 3. The order ───────────────────────────────────────── */}
        <Section n="3" title={t("chart.explain.order.h")}>
          <p style={{ margin: "0 0 6px" }}>{t("chart.explain.order.p")}</p>
          <ol style={{ margin: "0 0 6px", paddingLeft: 18 }}>
            <li>{t("chart.explain.order.forced")}</li>
            <li>{t("chart.explain.order.major")}</li>
            <li>{t("chart.explain.order.level")}</li>
            <li>{t("chart.explain.order.filler")}</li>
          </ol>
          {report.workTerms > 0 && (
            <p style={{ margin: "6px 0 0" }}>{t("chart.explain.order.coop")}</p>
          )}
          {(report.trades ?? []).length > 0 && (
            <p style={{ margin: "6px 0 0", color: "var(--text-3)" }}>
              {t("chart.explain.order.traded")}{" "}
              {report.trades.map(x => `${x.gaveUp} ${x.units}`).join("; ")}.
            </p>
          )}
        </Section>

        {/* ── 4. The limits ──────────────────────────────────────── */}
        <Section n="4" title={t("chart.explain.limits.h")}>
          <p style={{ margin: "0 0 6px" }}>{t("chart.explain.limits.p")}</p>

          {report.shapeSource === "published"
            ? <Fact value="·">{t("chart.explain.limits.shape.published")}</Fact>
            : <Fact value="·">{t("chart.explain.limits.shape.derived")}</Fact>}

          {report.extendedBy > 0 && (
            <Fact value={`+${report.extendedBy}`}>
              {t("chart.explain.limits.extended", { n: report.extendedBy })}
            </Fact>
          )}
          {(report.optionalTermsUsed ?? []).length > 0 && (
            <Fact value="·">
              {t("chart.explain.limits.optional", {
                terms: report.optionalTermsUsed.join(", "),
              })}
            </Fact>
          )}
          {(report.unscheduledPrereqs ?? []).length > 0 && (
            <Fact value={report.unscheduledPrereqs.length}>
              {t("chart.explain.limits.unscheduled")}
            </Fact>
          )}
          {(report.thresholds ?? []).length > 0 && (
            <Fact value={report.thresholds.length}>
              {t("chart.explain.limits.thresholds")}
            </Fact>
          )}
          <Fact value="·">{t("chart.explain.limits.nodata")}</Fact>
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
