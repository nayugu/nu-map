// ═══════════════════════════════════════════════════════════════════
// HEADER  — sticky timeline header: title, SH counters, controls,
//           relationship legend, co-op/grad conflict warning
// ═══════════════════════════════════════════════════════════════════
import { useState } from "react";
import { usePlanner } from "../context/PlannerContext.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { REL_STYLE, WORK_TERMS } from "../core/constants.js";
import { exportReport } from "../core/planModel.js";
import { THEME_LABELS } from "../core/themes.js";
import { getNuPathCoverage } from "../core/gradRequirements.js";

export default function Header() {
  const {
    courses, totalSHDone, totalSHPlaced, persistEnabled, setPersistEnabled,
    placements, courseMap, currentSemId, SEMESTERS, SEM_INDEX, SEM_NEXT,
    resetAll, setShowDisclaimer,
    showSettings, setShowSettings,
    planEntSem, planEntYear, planGradSem, planGradYear,
    entOrd, gradOrd,
    setEntSem, setEntYear, setGradSem, setGradYear,
    coopGradConflicts, workPl,
    showViolLines, setShowViolLines,
    manualZoom, setManualZoom, isPhone, isMobile,
  } = usePlanner();

  const { themeName, setThemeName, themeNames } = useTheme();
  const [showQuickSet, setShowQuickSet] = useState(false);

  const cycleTheme = e => {
    e.stopPropagation();
    const idx = themeNames.indexOf(themeName);
    setThemeName(themeNames[(idx + 1) % themeNames.length]);
  };

  const handleExport = e => {
    e.stopPropagation();
    const curIdx     = SEM_INDEX[currentSemId] ?? 0;
    const majorPath  = localStorage.getItem("ncp-grad-major")  || "";
    const concLabel  = localStorage.getItem("ncp-grad-conc")   || "";
    const minor1Path = localStorage.getItem("ncp-grad-minor1") || "";
    const minor2Path = localStorage.getItem("ncp-grad-minor2") || "";
    const npCovered  = getNuPathCoverage(placements, courseMap);
    // Build set of course keys that are placed in already-completed semesters
    const doneKeys = new Set();
    for (const [id, semId] of Object.entries(placements)) {
      const c = courseMap[id];
      if (!c?.subject || !c?.number) continue;
      if ((SEM_INDEX[semId] ?? 99) < curIdx) doneKeys.add(c.subject + c.number);
    }
    const gradInfo = {
      majorPath, concLabel, minor1Path, minor2Path,
      npCovered, doneKeys, totalSHRequired: 0,
    };
    exportReport(placements, courseMap, currentSemId, SEMESTERS, SEM_INDEX, gradInfo);
  };

  const handleReset = e => {
    e.stopPropagation();
    if (!confirm("Reset all placements?")) return;
    resetAll();
  };

  const handleRefresh = e => {
    e.stopPropagation();
    try { localStorage.removeItem("ncp-state-v2"); } catch {}
    window.location.reload();
  };

  return (
    <>
      {/* ── Sticky header bar ── */}
      <div style={{
        display: "flex", flexDirection: "column", gap: 6, marginBottom: 10,
        position: "sticky", top: 0, zIndex: 30, background: "var(--bg-app)",
        paddingBottom: 8, borderBottom: "1px solid var(--border-1)",
      }}>
        {/* Row 1: title + info — never wraps */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "nowrap", minWidth: 0, overflow: "hidden" }}>
          <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "-0.01em", flexShrink: 0 }}>NU Map</span>
          <span style={{ fontSize: 10, color: "var(--text-6)", flexShrink: 0 }}>·</span>
          <span style={{ fontSize: 10, color: "var(--text-3)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{courses.length.toLocaleString()} courses</span>
        </div>

        {/* Row 2: SH badges left · buttons right — never wraps */}
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "nowrap", minWidth: 0 }}>
          {/* SH badges — left side */}
          <span style={{ fontSize: isPhone ? 8 : 10, color: "var(--success)", background: "var(--success-bg)", border: "1px solid var(--success-border)", borderRadius: 4, padding: isPhone ? "1px 4px" : "2px 7px", flexShrink: 0 }}>
            {totalSHDone} SH ✓
          </span>
          <span style={{ fontSize: isPhone ? 8 : 10, color: "var(--text-3)", background: "var(--bg-surface)", border: "1px solid var(--border-2)", borderRadius: 4, padding: isPhone ? "1px 4px" : "2px 7px", flexShrink: 0 }}>
            {totalSHPlaced} SH placed
          </span>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Buttons — right side, icon-only on mobile/tablet */}

        {/* Export — hidden on phone */}
        {!isPhone && <button className="hdr-btn" onClick={handleExport} title="Export PDF" style={{ fontSize: 10, color: "var(--text-4)", background: "var(--bg-surface-2)", border: "1px solid var(--border-2)", borderRadius: 5, padding: "3px 8px", cursor: "pointer", whiteSpace: "nowrap" }}>
          {isMobile ? "⬇" : "⬇ Export PDF"}
        </button>}

        {/* Reset — hidden on phone */}
        {!isPhone && <button className="hdr-btn" onClick={handleReset} title="Reset all placements"
          style={{ fontSize: 10, color: "var(--text-4)", background: "var(--bg-surface-2)", border: "1px solid var(--border-2)", borderRadius: 5, padding: "3px 8px", cursor: "pointer", whiteSpace: "nowrap" }}>
          {isMobile ? "↺" : "↺ Reset"}
        </button>}

        {/* ⚙ Settings dropdown — infrequent controls */}
        <div style={{ position: "relative" }}>
          <button className="hdr-btn" onClick={e => { e.stopPropagation(); setShowQuickSet(v => !v); }}
            style={{ fontSize: isPhone ? 8 : 10, cursor: "pointer",
              color:      showQuickSet ? "var(--text-2)" : "var(--text-4)",
              background: showQuickSet ? "var(--bg-surface)" : "var(--bg-surface-2)",
              border:    `1px solid ${showQuickSet ? "var(--active)" : "var(--border-2)"}`,
              borderRadius: 5, padding: isPhone ? "2px 5px" : "3px 8px", whiteSpace: "nowrap" }}>
            {isMobile ? "⚙" : "⚙ Settings"}
          </button>

          {showQuickSet && (
            <div onClick={e => e.stopPropagation()} style={{
              position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 100,
              background: "var(--bg-surface)", border: "1px solid var(--border-2)", borderRadius: 8,
              padding: "10px 12px", minWidth: 190, boxShadow: "var(--shadow-modal)",
              display: "flex", flexDirection: "column", gap: 7,
            }}>
              {/* Save toggle */}
              <button
                className="hdr-btn-dd"
                onClick={e => {
                  e.stopPropagation();
                  const next = !persistEnabled;
                  setPersistEnabled(next);
                  if (!next) { try { localStorage.setItem("ncp-state-v2", JSON.stringify({ persist: false })); } catch {} }
                }}
                style={{ width: "100%", textAlign: "left", fontSize: 10, fontWeight: 700, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: `1px solid ${persistEnabled ? "var(--success-border)" : "var(--border-2)"}`,
                  color: persistEnabled ? "var(--success)" : "var(--text-4)" }}>
                {persistEnabled ? "Saving on" : "Saving off"}
              </button>

              {/* Error lines toggle */}
              <button className="hdr-btn-dd" onClick={() => setShowViolLines(v => !v)}
                style={{ width: "100%", textAlign: "left", fontSize: 10, fontWeight: 700, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: `1px solid ${showViolLines ? "var(--error)" : "var(--border-2)"}`,
                  color: showViolLines ? "var(--error)" : "var(--text-4)" }}>
                {showViolLines ? "Error lines: on" : "Error lines: off"}
              </button>

              {/* Theme toggle */}
              <button className="hdr-btn-dd" onClick={cycleTheme}
                style={{ width: "100%", textAlign: "left", fontSize: 10, fontWeight: 600, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: "1px solid var(--border-2)", color: "var(--text-4)" }}>
                {THEME_LABELS[themeName] ?? themeName}
              </button>

              {/* Refresh catalog */}
              <button className="hdr-btn-dd" onClick={handleRefresh}
                style={{ width: "100%", textAlign: "left", fontSize: 10, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: "1px solid var(--border-2)", color: "var(--text-4)" }}>
                ⟳ Refresh catalog
              </button>

              {/* Zoom */}
              <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 7 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", marginBottom: 5 }}>ZOOM</div>
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                  {[null, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map(v => {
                    const isActive = v === null ? manualZoom == null : manualZoom === v;
                    const label = v == null ? "auto" : `${Math.round(v * 100)}%`;
                    return (
                      <button key={label} onClick={() => setManualZoom(v)} style={{
                        flex: "1 1 auto", fontSize: 9, padding: "3px 4px", borderRadius: 4, cursor: "pointer",
                        background: isActive ? "var(--active-bg)" : "transparent",
                        border: `1px solid ${isActive ? "var(--active)" : "var(--border-2)"}`,
                        color: isActive ? "var(--active)" : "var(--text-4)",
                        fontWeight: isActive ? 700 : 400,
                      }}>{label}</button>
                    );
                  })}
                </div>
              </div>
              {isPhone && (
                <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 7 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", marginBottom: 5 }}>COHORT</div>
                  <div style={{ fontSize: 9, color: "var(--text-4)", marginBottom: 3 }}>Entry</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 3, marginBottom: 6 }}>
                    {["fall","spring"].map(s => {
                      const wouldBe = planEntYear * 2 + (s === "spring" ? 1 : 0);
                      const blocked = wouldBe >= gradOrd;
                      return (<button key={s} onClick={() => { if (!blocked) setEntSem(s); }} style={{ flex: 1, fontSize: 9, padding: "3px 0", borderRadius: 4, cursor: blocked ? "not-allowed" : "pointer", background: planEntSem === s ? (s === "fall" ? "var(--sel-fall-bg)" : "var(--sel-spr-bg)") : "transparent", border: `1px solid ${planEntSem === s ? (s === "fall" ? "var(--sel-fall-border)" : "var(--sel-spr-border)") : blocked ? "var(--blocked-border)" : "var(--border-2)"}`, color: planEntSem === s ? (s === "fall" ? "var(--sel-fall-text)" : "var(--sel-spr-text)") : blocked ? "var(--blocked-text)" : "var(--text-4)", fontWeight: planEntSem === s ? 700 : 400, opacity: blocked ? 0.4 : 1 }}>{s === "fall" ? "Fall" : "Spring"}</button>);
                    })}
                    <YearStepper year={planEntYear} min={2010} max={2040} canInc={entOrd + 2 < gradOrd} onDec={() => { if (planEntYear > 2010) setEntYear(planEntYear - 1); }} onInc={() => { if (entOrd + 2 < gradOrd && planEntYear < 2040) setEntYear(planEntYear + 1); }} />
                  </div>
                  <div style={{ fontSize: 9, color: "var(--text-4)", marginBottom: 3 }}>Graduation</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                    {["fall","spring"].map(s => {
                      const wouldBe = planGradYear * 2 + (s === "spring" ? 1 : 0);
                      const blocked = wouldBe <= entOrd;
                      return (<button key={s} onClick={() => { if (!blocked) setGradSem(s); }} style={{ flex: 1, fontSize: 9, padding: "3px 0", borderRadius: 4, cursor: blocked ? "not-allowed" : "pointer", background: planGradSem === s ? (s === "fall" ? "var(--sel-fall-bg)" : "var(--sel-spr-bg)") : "transparent", border: `1px solid ${planGradSem === s ? (s === "fall" ? "var(--sel-fall-border)" : "var(--sel-spr-border)") : blocked ? "var(--blocked-border)" : "var(--border-2)"}`, color: planGradSem === s ? (s === "fall" ? "var(--sel-fall-text)" : "var(--sel-spr-text)") : blocked ? "var(--blocked-text)" : "var(--text-4)", fontWeight: planGradSem === s ? 700 : 400, opacity: blocked ? 0.4 : 1 }}>{s === "fall" ? "Fall" : "Spring"}</button>);
                    })}
                    <YearStepper year={planGradYear} min={2010} max={2040} canDec={gradOrd - 2 > entOrd} onDec={() => { if (gradOrd - 2 > entOrd && planGradYear > 2010) setGradYear(planGradYear - 1); }} onInc={() => { if (planGradYear < 2040) setGradYear(planGradYear + 1); }} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Cohort date picker — hidden on phone, available via Settings above */}
        {!isPhone && <div style={{ position: "relative" }}>
          <button
            className="hdr-btn"
            onClick={e => { e.stopPropagation(); setShowSettings(v => !v); }}
            title="Set entry & graduation semester"
            style={{
              fontSize: 10, cursor: "pointer", whiteSpace: "nowrap",
            color: showSettings ? "var(--text-2)" : "var(--text-4)",
            background: showSettings ? "var(--bg-surface)" : "var(--bg-surface-2)",
            border: `1px solid ${showSettings ? "var(--active)" : "var(--border-2)"}`,
              borderRadius: 5, padding: "3px 8px", whiteSpace: "nowrap",
            }}
          >{isMobile ? "🎓" : "🎓 Cohort"}</button>

          {showSettings && (
            <div onClick={e => e.stopPropagation()} style={{
              position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 100,
              background: "var(--bg-surface)", border: "1px solid var(--border-2)", borderRadius: 8,
              padding: "14px 16px", minWidth: 270, boxShadow: "var(--shadow-modal)",
              display: "flex", flexDirection: "column", gap: 12,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.05em" }}>COHORT DATES</div>

              {/* Entry */}
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", marginBottom: 6 }}>ENTRY</div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {["fall", "spring"].map(s => {
                    const wouldBe = planEntYear * 2 + (s === "spring" ? 1 : 0);
                    const blocked = wouldBe >= gradOrd;
                    return (
                      <button key={s}
                        onClick={() => { if (!blocked) setEntSem(s); }}
                        style={{
                          flex: 1, fontSize: 9, padding: "4px 0", borderRadius: 4,
                          cursor: blocked ? "not-allowed" : "pointer",
                          background: planEntSem === s ? (s === "fall" ? "var(--sel-fall-bg)" : "var(--sel-spr-bg)") : "transparent",
                          border: `1px solid ${planEntSem === s ? (s === "fall" ? "var(--sel-fall-border)" : "var(--sel-spr-border)") : blocked ? "var(--blocked-border)" : "var(--border-2)"}`,
                          color: planEntSem === s ? (s === "fall" ? "var(--sel-fall-text)" : "var(--sel-spr-text)") : blocked ? "var(--blocked-text)" : "var(--text-4)",
                          fontWeight: planEntSem === s ? 700 : 400, opacity: blocked ? 0.4 : 1,
                        }}
                      >{s === "fall" ? "Fall" : "Spring"}</button>
                    );
                  })}
                  <YearStepper
                    year={planEntYear} min={2010} max={2040}
                    canInc={entOrd + 2 < gradOrd}
                    onDec={() => { if (planEntYear > 2010) setEntYear(planEntYear - 1); }}
                    onInc={() => { if (entOrd + 2 < gradOrd && planEntYear < 2040) setEntYear(planEntYear + 1); }}
                  />
                </div>
              </div>

              {/* Graduation */}
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", marginBottom: 6 }}>GRADUATION</div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {["fall", "spring"].map(s => {
                    const wouldBe = planGradYear * 2 + (s === "spring" ? 1 : 0);
                    const blocked = wouldBe <= entOrd;
                    return (
                      <button key={s}
                        onClick={() => { if (!blocked) setGradSem(s); }}
                        style={{
                          flex: 1, fontSize: 9, padding: "4px 0", borderRadius: 4,
                          cursor: blocked ? "not-allowed" : "pointer",
                          background: planGradSem === s ? (s === "fall" ? "var(--sel-fall-bg)" : "var(--sel-spr-bg)") : "transparent",
                          border: `1px solid ${planGradSem === s ? (s === "fall" ? "var(--sel-fall-border)" : "var(--sel-spr-border)") : blocked ? "var(--blocked-border)" : "var(--border-2)"}`,
                          color: planGradSem === s ? (s === "fall" ? "var(--sel-fall-text)" : "var(--sel-spr-text)") : blocked ? "var(--blocked-text)" : "var(--text-4)",
                          fontWeight: planGradSem === s ? 700 : 400, opacity: blocked ? 0.4 : 1,
                        }}
                      >{s === "fall" ? "Fall" : "Spring"}</button>
                    );
                  })}
                  <YearStepper
                    year={planGradYear} min={2010} max={2040}
                    canDec={gradOrd - 2 > entOrd}
                    onDec={() => { if (gradOrd - 2 > entOrd && planGradYear > 2010) setGradYear(planGradYear - 1); }}
                    onInc={() => { if (planGradYear < 2040) setGradYear(planGradYear + 1); }}
                  />
                </div>
              </div>

              {/* Summary */}
              <div style={{ fontSize: 9, color: "var(--text-6)", lineHeight: 1.6, borderTop: "1px solid var(--border-1)", paddingTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <span>{planEntSem === "fall" ? "Fall" : "Spring"} {planEntYear} → {planGradSem === "fall" ? "Fall" : "Spring"} {planGradYear}</span>
                {(planGradYear < planEntYear || (planGradYear === planEntYear && planGradSem === "fall" && planEntSem === "spring"))
                  ? <span style={{ color: "var(--error)" }}>⚠ grad before entry</span>
                  : <span style={{ color: "var(--success)" }}>
                      ~{((planGradYear * 2 + (planGradSem === "fall" ? 0 : 1)) - (planEntYear * 2 + (planEntSem === "fall" ? 0 : 1))) / 2} yrs
                    </span>
                }
              </div>
            </div>
          )}
        </div>}

        {/* About button */}
        <button
          className="hdr-btn"
          onClick={e => { e.stopPropagation(); setShowDisclaimer(true); }}
          title="About & disclaimer"
          style={{ fontSize: isPhone ? 8 : 10, color: "var(--text-4)", background: "var(--bg-surface-2)", border: "1px solid var(--border-2)", borderRadius: 5, padding: isPhone ? "2px 5px" : "3px 8px", cursor: "pointer", whiteSpace: "nowrap" }}
        >{isMobile ? "ⓘ" : "ⓘ About"}</button>
        </div>{/* end controls row */}
      </div>{/* end header */}

      {/* ── Relationship legend ── */}
      <div style={{ display: "flex", gap: isPhone ? 6 : 10, marginBottom: 8, flexWrap: "nowrap", alignItems: "center", overflow: "hidden" }}>
        {Object.entries(REL_STYLE).filter(([type]) => type !== "corequisite-viol").map(([type, s]) => (
            <div key={type} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: isPhone ? 8 : 9, color: "var(--text-4)", flexShrink: 0 }}>
            <svg width={isPhone ? 14 : 18} height="6">
              <line x1="0" y1="3" x2={isPhone ? 14 : 18} y2="3" stroke={s.color} strokeWidth="1.5" strokeDasharray={s.dash || ""} />
            </svg>
            <span>{s.label}</span>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 3, fontSize: isPhone ? 8 : 9, color: "var(--text-4)", flexShrink: 0 }}>
          <span style={{ display: "inline-block", width: isPhone ? 10 : 12, height: isPhone ? 10 : 12, borderRadius: 3, border: "2px solid var(--warn-bright)", flexShrink: 0 }} />
          <span>Misplaced</span>
        </div>
        {!isPhone && <span style={{ fontSize: 9, color: "var(--text-5)" }}>
          · Click card to highlight relationships · Click semester label to mark as current
        </span>}
      </div>

      {/* ── Co-op / graduation conflict warning ── */}
      {coopGradConflicts.length > 0 && (
        <div style={{
          margin: "0 0 6px", padding: "9px 12px",
          background: "var(--warn-bg)", border: "1px solid var(--warn-border)",
          borderRadius: 6, display: "flex", alignItems: "flex-start", gap: 8,
        }}>
          <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>⚠️</span>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--warn-bright)", marginBottom: 2 }}>
              Co-op overlaps graduation semester
            </div>
            <div style={{ fontSize: 10, color: "var(--warn)", lineHeight: 1.5 }}>
              {coopGradConflicts.map(w => w.label).join(" and ")}{" "}
              {coopGradConflicts.length === 1 ? "spans" : "span"} your graduation semester (
              {planGradSem === "fall" ? "Fall" : "Spring"} {planGradYear}).
              You cannot graduate while on co-op — move the co-op block or adjust your graduation date.
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Small ◀ year ▶ stepper widget used in cohort popover. */
function YearStepper({ year, canDec = true, canInc = true, onDec, onInc }) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginLeft: 4, background: "var(--bg-app)", border: "1px solid var(--border-2)", borderRadius: 5, overflow: "hidden" }}>
      <button onClick={onDec}
        style={{ background: "none", border: "none", color: canDec ? "var(--text-3)" : "var(--border-2)", cursor: canDec ? "pointer" : "not-allowed", padding: "2px 7px", fontSize: 11 }}>◀</button>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", minWidth: 34, textAlign: "center" }}>{year}</span>
      <button onClick={onInc}
        style={{ background: "none", border: "none", color: canInc ? "var(--text-3)" : "var(--border-2)", cursor: canInc ? "pointer" : "not-allowed", padding: "2px 7px", fontSize: 11 }}>▶</button>
    </div>
  );
}
