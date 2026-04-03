// ═══════════════════════════════════════════════════════════════════
// HEADER  — sticky timeline header: title, SH counters, controls,
//           relationship legend, co-op/grad conflict warning
// ═══════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { usePlanner } from "../context/PlannerContext.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { REL_STYLE, WORK_TERMS } from "../core/constants.js";
import { exportReport, getOrderedCourses } from "../core/planModel.js";
import { THEME_LABELS } from "../core/themes.js";
import { getNuPathCoverage } from "../core/gradRequirements.js";
import dataMeta from "../core/dataMeta.json";

export default function Header() {
  const {
    courses, totalSHDone, totalSHPlaced, persistEnabled, setPersistEnabled,
    placements, courseMap, effectiveCourseMap, currentSemId, SEMESTERS, SEM_INDEX, SEM_NEXT,
    resetAll, setShowDisclaimer,
    showSettings, setShowSettings,
    planEntSem, planEntYear, planGradSem, planGradYear,
    entOrd, gradOrd,
    setEntSem, setEntYear, setGradSem, setGradYear,
    coopGradConflicts, workPl, internPl, semOrders,
    showViolLines, setShowViolLines,
    manualZoom, setManualZoom, isPhone, isMobile,
    collapseOtherCredits, setCollapseOtherCredits,
    stickyCourses, setStickyCourses,
    exportPlanJSON, importPlanJSON,
    plans, activePlanId, switchPlan, createPlan, deletePlan, renamePlan,
    major, conc, minor1, minor2,
    placedOut, substitutions,
  } = usePlanner();

  const { themeName, setThemeName, themeNames } = useTheme();
  const [showQuickSet, setShowQuickSet] = useState(false);
  const [showPlanMenu, setShowPlanMenu] = useState(false);
  const [showIO, setShowIO] = useState(false);

   useEffect(() => {
    if (!showPlanMenu) return;
    const close = () => setShowPlanMenu(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [showPlanMenu]);

  const cycleTheme = e => {
    e.stopPropagation();
    const idx = themeNames.indexOf(themeName);
    setThemeName(themeNames[(idx + 1) % themeNames.length]);
  };

  const handleExport = e => {
    e.stopPropagation();
    const curIdx     = SEM_INDEX[currentSemId] ?? 0;
    const majorPath  = major  || "";
    const concLabel  = conc   || "";
    const minor1Path = minor1 || "";
    const minor2Path = minor2 || "";
    const npCovered  = getNuPathCoverage(placements, courseMap, workPl);
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
      placedOut, substitutions,
    };
    exportReport(placements, effectiveCourseMap, currentSemId, SEMESTERS, SEM_INDEX, gradInfo, workPl, internPl);
  };

  const handleCopyHumanReadable = async () => {
    // Gather plan metadata
    const entry = `${planEntSem === 'fall' ? 'Fall' : 'Spring'} ${planEntYear}`;
    const grad = `${planGradSem === 'fall' ? 'Fall' : 'Spring'} ${planGradYear}`;
    const totalSH = totalSHPlaced;
    const completedSH = totalSHDone;
    const plannedSH = totalSHPlaced - totalSHDone;

    // Build semester blocks
    const semLines = [];
    const semById = Object.fromEntries(SEMESTERS.map(s => [s.id, s]));

    // Determine current semester index for "completed" marking
    const currentIdx = SEM_INDEX[currentSemId] ?? 0;

    // Collect all placed course IDs for the appendix
    const allPlacedIds = Object.keys(placements);

    // Helper to format co‑op and internship blocks
    const workStartMap = {};
    const workContMap = {};
    Object.entries(workPl).forEach(([wid, data]) => {
      const semId = data?.semId;
      if (!semId) return;
      workStartMap[semId] = wid;
      if (data.duration === 6) {
        const nxt = SEM_NEXT[semId];
        if (nxt) workContMap[nxt] = wid;
      } else if (data.duration === 4) {
        const sem = SEMESTERS.find(s => s.id === semId);
        if (sem?.type === "summer") {
          const nxt = SEM_NEXT[semId];
          if (nxt) workContMap[nxt] = wid;
        }
      }
    });
    const internStartMap = {};
    const internContMap = {};
    Object.entries(internPl).forEach(([iid, data]) => {
      const semId = data?.semId;
      if (!semId) return;
      internStartMap[semId] = iid;
      if (data.duration === 4) {
        const sem = SEMESTERS.find(s => s.id === semId);
        if (sem?.type === "summer") {
          const nxt = SEM_NEXT[semId];
          if (nxt) internContMap[nxt] = iid;
        }
      }
    });

    // Iterate through semesters in order
    for (const sem of SEMESTERS) {
      const semId = sem.id;
      const idsInSem = getOrderedCourses(semId, placements, semOrders, courseMap);
      const hasWork = !!workStartMap[semId];
      const hasCont = !!workContMap[semId];

      const hasIntern     = !!internStartMap[semId];
      const hasInternCont = !!internContMap[semId];

      // Skip empty semesters
      if (idsInSem.length === 0 && !hasWork && !hasCont && !hasIntern && !hasInternCont) continue;

      const semLabel = sem.label;
      const isDone = (SEM_INDEX[semId] ?? 99) < currentIdx;
      const status = isDone ? ' (completed)' : (semId === currentSemId ? ' (in progress)' : '');
      semLines.push(`\n${semLabel}${status}`);

      // Co‑op continuation row
      if (hasCont && !hasWork) {
        const contWorkId   = workContMap[semId];
        const contWorkData = workPl[contWorkId];
        const workItem     = contWorkData ? (WORK_TERMS.find(w => w.duration === contWorkData.duration) ?? WORK_TERMS[0]) : null;
        if (workItem) {
          const co = contWorkData.company ? ` @ ${contWorkData.company}` : '';
          semLines.push(`  ⤷ ${workItem.label}${co} (continues)`);
        }
      }

      // Co‑op start row
      if (hasWork) {
        const workId   = workStartMap[semId];
        const workData = workPl[workId];
        const workItem = workData ? (WORK_TERMS.find(w => w.duration === workData.duration) ?? WORK_TERMS[0]) : null;
        if (workItem) {
          const nextSemId = SEM_NEXT[semId];
          const contPart  = nextSemId ? ` (spans into ${semById[nextSemId]?.label ?? nextSemId})` : '';
          const co        = workData.company  ? ` @ ${workData.company}`  : '';
          const role      = workData.subline  ? ` · ${workData.subline}`  : '';
          semLines.push(`  ⤷ ${workItem.label}${co}${role}${contPart}`);
        }
      }

      // Internship continuation row
      if (hasInternCont && !hasIntern) {
        const contInternId   = internContMap[semId];
        const contInternData = internPl[contInternId];
        if (contInternData) {
          const co = contInternData.company ? ` @ ${contInternData.company}` : '';
          semLines.push(`  ⤷ Full-Time Internship${co} (continues)`);
        }
      }

      // Internship start row
      if (hasIntern) {
        const internId   = internStartMap[semId];
        const internData = internPl[internId];
        if (internData) {
          const nextSemId  = SEM_NEXT[semId];
          const spansNext  = internData.duration === 4 && nextSemId && SEMESTERS.find(s => s.id === semId)?.type === "summer";
          const contPart   = spansNext ? ` (spans into ${semById[nextSemId]?.label ?? nextSemId})` : '';
          const co         = internData.company ? ` @ ${internData.company}` : '';
          const role       = internData.subline ? ` · ${internData.subline}` : '';
          semLines.push(`  ⤷ Full-Time Internship${co}${role}${contPart}`);
        }
      }

      // Normal courses – only code, title, SH
      for (const id of idsInSem) {
        const c = courseMap[id];
        if (!c) continue;
        semLines.push(`  - ${c.code}: ${c.title} (${c.sh} SH)`);
      }
    }

    // Build appendix of course descriptions (code, title, SH, description)
    const appendixLines = ['\n\n--- Appendix: Course Descriptions ---'];
    for (const id of allPlacedIds) {
      const c = courseMap[id];
      if (!c) continue;
      const desc = c.desc?.trim() || c.description?.trim() || 'No description available.';
      appendixLines.push(`\n${c.code}: ${c.title}`);
      appendixLines.push(`  Credits: ${c.sh} SH`);
      appendixLines.push(`  Description: ${desc}`);
    }

    const placedOutLines = placedOut.size > 0
      ? ['\n--- Placed Out (no credit, satisfies prerequisites) ---',
         ...[...placedOut].map(id => { const c = courseMap[id]; return c ? `  - ${c.code}: ${c.title}` : null; }).filter(Boolean)]
      : [];

    const substitutionLines = substitutions.length > 0
      ? ['\n--- Substitutions (course A placed → satisfies course B, credits count once) ---',
         ...substitutions.map(({ from, to }) => {
           const fc = courseMap[from]; const tc = courseMap[to];
           if (!fc || !tc) return null;
           return `  - ${fc.code} → ${tc.code}${placements[from] ? '' : ' ⚠ not placed'}`;
         }).filter(Boolean)]
      : [];

    // Assemble final text
    const fullText = [
      `NU Map Plan: ${plans.find(p => p.id === activePlanId)?.name || 'Untitled'}`,
      `Entry: ${entry}`,
      `Graduation: ${grad}`,
      `Total SH: ${totalSH} (completed: ${completedSH}, planned: ${plannedSH})`,
      '',
      '--- Semester Schedule ---',
      ...semLines,
      ...placedOutLines,
      ...substitutionLines,
      ...appendixLines,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(fullText);
      alert('Plan copied to clipboard!');
    } catch (err) {
      alert('Failed to copy: ' + err.message);
    }
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
        {/* Row 1: title + info — last-updated anchored right, never wraps */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "nowrap", minWidth: 0, overflow: "hidden" }}>
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="NU Map" style={{ height: 20, width: 20, objectFit: "contain", flexShrink: 0 }} />
          <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "-0.01em", flexShrink: 0 }}>NU Map</span>
          <span style={{ fontSize: 10, color: "var(--text-6)", flexShrink: 0 }}>·</span>
          {!isPhone && (
            <span style={{ fontSize: 10, color: "var(--text-3)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{courses.length.toLocaleString()} courses</span>
          )}
          {!isPhone && (__COMMIT_DATE__ || dataMeta.lastUpdated) && (
            <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <span style={{ fontSize: 9, color: "var(--text-5)", whiteSpace: "nowrap" }} title="Date of last course data refresh">
                updated {__COMMIT_DATE__ || dataMeta.lastUpdated}
              </span>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  color: "var(--beta-text)",
                  background: "var(--beta-bg)",
                  padding: "1px 7px",
                  borderRadius: 6,
                  marginLeft: 0,
                  userSelect: "none",
                  boxShadow: "0 1px 2px 0 rgba(0,0,0,0.03)",
                  lineHeight: 1.7,
                  transition: "background 0.2s,color 0.2s"
                }}
              >
                BETA
              </span>
            </span>
          )}
          {isPhone && (__COMMIT_DATE__ || dataMeta.lastUpdated) && (
            <>
              <span style={{ flex: 1, display: "flex", alignItems: "center", minWidth: 0, overflow: "hidden" }}>
                <span style={{ fontSize: 9, color: "var(--text-5)", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }} title="Date of last course data refresh">
                  updated {__COMMIT_DATE__ || dataMeta.lastUpdated}
                </span>
              </span>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  color: "var(--beta-text)",
                  background: "var(--beta-bg)",
                  padding: "1px 7px",
                  borderRadius: 6,
                  marginLeft: 0,
                  userSelect: "none",
                  boxShadow: "0 1px 2px 0 rgba(0,0,0,0.03)",
                  lineHeight: 1.7,
                  transition: "background 0.2s,color 0.2s",
                  alignSelf: "flex-end"
                }}
              >
                BETA
              </span>
            </>
          )}
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

          {/* Buttons — right side, icon-only on mobile/tablet */}
        
        {/* Plan switcher dropdown */}
        <div style={{ position: "relative" }}>
          <button className="hdr-btn" onClick={e => { e.stopPropagation(); setShowPlanMenu(v => !v); }}
            style={{ fontSize: isPhone ? 8 : 10, cursor: "pointer", maxWidth: isPhone ? 80 : 160,
              overflow: "hidden", textOverflow: "ellipsis",
              color: showPlanMenu ? "var(--text-2)" : "var(--text-4)",
              background: showPlanMenu ? "var(--bg-surface)" : "var(--bg-surface-2)",
              border: `1px solid ${showPlanMenu ? "var(--active)" : "var(--border-2)"}`,
              borderRadius: 5, padding: isPhone ? "2px 5px" : "3px 8px", whiteSpace: "nowrap" }}>
            {isPhone ? `${(plans.find(p => p.id === activePlanId)?.name) || "Plan"} ▾` : isMobile ? "📋" : `📋 ${(plans.find(p => p.id === activePlanId)?.name) || "Plan"} ▾`}
          </button>

          {showPlanMenu && (
            <div onClick={e => e.stopPropagation()} style={{
              position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 100,
              background: "var(--bg-surface)", border: "1px solid var(--border-2)", borderRadius: 6,
              padding: "6px 0", minWidth: 160, boxShadow: "var(--shadow-modal)",
              display: "flex", flexDirection: "column", transformOrigin: "top left",
              fontSize: isPhone ? 9 : 11,
            }}>
              <div style={{fontSize: 8, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", padding: "3px 10px 6px", borderBottom: "1px solid var(--border-1)" }}>
                SAVED PLANS
              </div>

              {plans.map(p => (
                <div key={p.id} style={{
                  display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
                  background: p.id === activePlanId ? "var(--active-bg)" : "transparent",
                  cursor: p.id === activePlanId ? "default" : "pointer",
                }} onClick={() => { if (p.id !== activePlanId) { switchPlan(p.id); setShowPlanMenu(false); } }}>
                  <span style={{
                    flex: 1, fontSize: isPhone ? 9 : 10, fontWeight: p.id === activePlanId ? 700 : 400,
                    color: p.id === activePlanId ? "var(--active)" : "var(--text-3)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {p.id === activePlanId ? "● " : ""}{p.name}
                  </span>
                  {/* Rename */}
                  <button onClick={e => {
                    e.stopPropagation();
                    const name = prompt("Rename plan:", p.name);
                    if (name?.trim()) renamePlan(p.id, name.trim());
                  }} style={{ background: "none", border: "none", color: "var(--text-5)", cursor: "pointer", fontSize: 10, padding: "0 2px" }}
                    title="Rename">✎</button>
                  {/* Delete */}
                  {plans.length > 1 && (
                    <button onClick={e => {
                      e.stopPropagation();
                      if (confirm(`Delete "${p.name}"?`)) { deletePlan(p.id); if (plans.length <= 2) setShowPlanMenu(false); }
                    }} style={{ background: "none", border: "none", color: "var(--text-5)", cursor: "pointer", fontSize: 10, padding: "0 2px" }}
                      title="Delete">✕</button>
                  )}
                </div>
              ))}

              <div style={{ borderTop: "1px solid var(--border-1)", padding: "4px 10px 3px" }}>
                <button onClick={e => {
                  e.stopPropagation();
                  const name = prompt("New plan name:");
                  if (name?.trim()) { createPlan(name.trim()); setShowPlanMenu(false); }
                }} style={{
                  width: "100%", fontSize: isPhone ? 9 : 10, fontWeight: 700, cursor: "pointer",
                  background: "var(--bg-surface-2)", padding: "5px 8px", borderRadius: 5,
                  border: "1px solid var(--border-2)", color: "var(--accent)", textAlign: "left",
                }}>
                  + New plan
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Spacer */}
          <div style={{ flex: 1 }} />


        {/* Input/Output Dropdown */}
        <div style={{ position: "relative" }}>
          <button className="hdr-btn" onClick={e => { e.stopPropagation(); setShowIO(v => !v); }}
            style={{ fontSize: isPhone ? 8 : 10, cursor: "pointer",
              color: showIO ? "var(--text-2)" : "var(--text-4)",
              background: showIO ? "var(--bg-surface)" : "var(--bg-surface-2)",
              border: `1px solid ${showIO ? "var(--active)" : "var(--border-2)"}`,
              borderRadius: 5, padding: isPhone ? "2px 5px" : "3px 8px", whiteSpace: "nowrap" }}>
            {isMobile ? "⇅" : "⇅ Input/Output"}
          </button>
          {showIO && (
            <div onClick={e => e.stopPropagation()} style={{
              position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 100,
              background: "var(--bg-surface)", border: "1px solid var(--border-2)", borderRadius: 8,
              padding: "10px 12px", minWidth: 170, boxShadow: "var(--shadow-modal)",
              display: "flex", flexDirection: "column", gap: 7,
            }}>
              <button className="hdr-btn-dd" onClick={handleCopyHumanReadable} title="Copy human-readable plan to clipboard"
                style={{ width: "100%", textAlign: "center", fontSize: 10, fontWeight: 700, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: "1px solid var(--border-2)", color: "var(--text-4)" }}>
                Copy summary
              </button>
              <button className="hdr-btn-dd" onClick={handleExport} title="Export PDF"
                style={{ width: "100%", textAlign: "center", fontSize: 10, fontWeight: 700, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: "1px solid var(--border-2)", color: "var(--text-4)" }}>
                Export PDF
              </button>
              <button className="hdr-btn-dd" onClick={exportPlanJSON} title="Export plan as JSON"
                style={{ width: "100%", textAlign: "center", fontSize: 10, fontWeight: 700, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: "1px solid var(--border-2)", color: "var(--text-4)" }}>
                  Save
              </button>
              <input type="file" id="plan-import-input" accept=".json" style={{ display: "none" }}
                onChange={e => { if (e.target.files[0]) { importPlanJSON(e.target.files[0]); e.target.value = ""; } }} />
              <button className="hdr-btn-dd" onClick={() => document.getElementById("plan-import-input").click()} title="Import plan from JSON"
                style={{ width: "100%", textAlign: "center", fontSize: 10, fontWeight: 700, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: "1px solid var(--border-2)", color: "var(--text-4)" }}>
                  Load
              </button>
            </div>
          )}
        </div>

        {/** Reset — hidden on all devices (commented out)
        {!isPhone && <button className="hdr-btn" onClick={handleReset} title="Reset all placements"
          style={{ fontSize: 10, color: "var(--text-4)", background: "var(--bg-surface-2)", border: "1px solid var(--border-2)", borderRadius: 5, padding: "3px 8px", cursor: "pointer", whiteSpace: "nowrap" }}>
          {isMobile ? "↺" : "↺ Erase"}
        </button>}
        */}

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

              {/* Collapse other credits toggle */}
              <button className="hdr-btn-dd" onClick={() => setCollapseOtherCredits(v => !v)}
                style={{ width: "100%", textAlign: "left", fontSize: 10, fontWeight: 700, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: `1px solid ${collapseOtherCredits ? "var(--active)" : "var(--border-2)"}`,
                  color: collapseOtherCredits ? "var(--active)" : "var(--text-4)" }}>
                {collapseOtherCredits ? "Collapse other credits: on" : "Collapse other credits: off"}
              </button>

              {/* Theme toggle */}
              <button className="hdr-btn-dd" onClick={cycleTheme}
                style={{ width: "100%", textAlign: "left", fontSize: 10, fontWeight: 600, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: "1px solid var(--border-2)", color: "var(--text-4)" }}>
                {THEME_LABELS[themeName] ?? themeName}
              </button>

              {/** Refresh catalog data (commented out)
              <button className="hdr-btn-dd" onClick={handleRefresh}
                style={{ width: "100%", textAlign: "left", fontSize: 10, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: "1px solid var(--border-2)", color: "var(--text-4)" }}>
                ↺ Refresh
              </button>
              */}

              {/* Dev portal link */}
              <a href="https://nayugu.github.io/nu-map/dev.html" target="_blank" rel="noreferrer"
                style={{ display: "block", width: "100%", textAlign: "left", fontSize: 10,
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: "1px solid var(--border-2)", color: "var(--text-4)",
                  textDecoration: "none", boxSizing: "border-box" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "var(--text-4)"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border-2)"}
              >
                🛠 Dev portal
              </a>

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
              {/* Sticky courses toggle */}
              <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 8, display: "flex", justifyContent: "flex-end" }}>
                <button onClick={() => setStickyCourses(v => !v)}
                  style={{ fontSize: 9, fontWeight: 700, cursor: "pointer", background: "var(--bg-surface)", padding: "3px 8px", borderRadius: 4,
                    border: `1px solid ${stickyCourses ? "var(--active)" : "var(--border-2)"}`,
                    color: stickyCourses ? "var(--active)" : "var(--text-5)" }}>
                  {stickyCourses ? "📌 Sticky: on" : "📌 Sticky: off"}
                </button>
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
