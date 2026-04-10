// ═══════════════════════════════════════════════════════════════════
// HEADER  — sticky timeline header: title, SH counters, controls,
//           relationship legend, co-op/grad conflict warning
// ═══════════════════════════════════════════════════════════════════
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { usePlanner } from "../context/PlannerContext.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { REL_STYLE } from "../core/constants.js";
import { exportReport, getOrderedCourses } from "../core/planModel.js";
import { resolveTermByDuration, termSpans, computeGrantedAttrs } from "../core/specialTermUtils.js";
import { THEME_LABELS } from "../core/themes.js";
import { useInstitution } from "../context/InstitutionContext.jsx";
import { useLanguage }    from "../context/LanguageContext.jsx";
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
    coopGradConflicts, specialTermPl, specialTermStartMap, specialTermContMap, semOrders,
    showViolLines, setShowViolLines,
    manualZoom, setManualZoom, isPhone, isMobile,
    collapseOtherCredits, setCollapseOtherCredits,
    showContLogo, setShowContLogo,
    stickyCourses, setStickyCourses,
    exportPlanJSON, importPlanJSON,
    plans, activePlanId, switchPlan, createPlan, deletePlan, renamePlan,
    major, conc, minor1, minor2,
    placedOut, substitutions,
  } = usePlanner();

  const { themeName, setThemeName, themeNames } = useTheme();
  const { t, locale, setLocale, locales } = useLanguage();
  const adapter = useInstitution();
  const { attributeSystem, specialTerms, calendar, creditSystem, institution } = adapter;
  const unitName        = creditSystem.getUnitName();
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
    const npCovered  = attributeSystem.getCoverage(placements, courseMap, computeGrantedAttrs(specialTermPl, specialTerms.getTypes()));
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
    exportReport(placements, effectiveCourseMap, currentSemId, SEMESTERS, SEM_INDEX, gradInfo, specialTermPl, adapter);
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

    // Iterate through semesters in order
    for (const sem of SEMESTERS) {
      const semId = sem.id;
      const idsInSem = getOrderedCourses(semId, placements, semOrders, courseMap);
      const hasStart = !!specialTermStartMap[semId];
      const hasCont  = !!specialTermContMap[semId];

      // Skip empty semesters
      if (idsInSem.length === 0 && !hasStart && !hasCont) continue;

      const semLabel = sem.label;
      const isDone = (SEM_INDEX[semId] ?? 99) < currentIdx;
      const status = isDone ? ' (completed)' : (semId === currentSemId ? ' (in progress)' : '');
      semLines.push(`\n${semLabel}${status}`);

      // Special term continuation row
      if (hasCont && !hasStart) {
        const contId   = specialTermContMap[semId];
        const contData = specialTermPl[contId];
        const contType = contData ? (specialTerms.getTypes() ?? []).find(t => t.id === contData.typeId) : null;
        const contDur  = contType ? resolveTermByDuration(contType.durations, contData.duration) : null;
        if (contDur) {
          const co = contData.company ? ` @ ${contData.company}` : '';
          semLines.push(`  ⤷ ${contType.label}${co} (continues)`);
        }
      }

      // Special term start row
      if (hasStart) {
        const startId   = specialTermStartMap[semId];
        const startData = specialTermPl[startId];
        const startType = startData ? (specialTerms.getTypes() ?? []).find(t => t.id === startData.typeId) : null;
        const startDur  = startType ? resolveTermByDuration(startType.durations, startData.duration) : null;
        if (startDur) {
          const nextSemId = SEM_NEXT[semId];
          const spansNext = termSpans(startDur.weight, sem.weight ?? 1) && !!nextSemId;
          const contPart  = spansNext ? ` (spans into ${semById[nextSemId]?.label ?? nextSemId})` : '';
          const co        = startData.company ? ` @ ${startData.company}` : '';
          const role      = startData.subline ? ` · ${startData.subline}` : '';
          semLines.push(`  ⤷ ${startType.label}${co}${role}${contPart}`);
        }
      }

      // Normal courses – only code, title, SH
      for (const id of idsInSem) {
        const c = courseMap[id];
        if (!c) continue;
        semLines.push(`  - ${c.code}: ${c.title} (${c.sh} ${unitName})`);
      }
    }

    // Build appendix of course descriptions (code, title, SH, description)
    const appendixLines = ['\n\n--- Appendix: Course Descriptions ---'];
    for (const id of allPlacedIds) {
      const c = courseMap[id];
      if (!c) continue;
      const desc = c.desc?.trim() || c.description?.trim() || 'No description available.';
      appendixLines.push(`\n${c.code}: ${c.title}`);
      appendixLines.push(`  Credits: ${c.sh} ${unitName}`);
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
      `${institution.appName} Plan: ${plans.find(p => p.id === activePlanId)?.name || 'Untitled'}`,
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
      alert(t("header.io.copy.done") ?? "Plan copied to clipboard!");
    } catch (err) {
      alert("Failed to copy: " + err.message);
    }
  };

  const handleReset = e => {
    e.stopPropagation();
    if (!confirm(t("header.reset.confirm"))) return;
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
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt={institution.appName} style={{ height: 20, width: 20, objectFit: "contain", flexShrink: 0 }} />
          <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "-0.01em", flexShrink: 0 }}>{institution.appName}</span>
          <span style={{ fontSize: 10, color: "var(--text-6)", flexShrink: 0 }}>·</span>
          {!isPhone && (
            <span style={{ fontSize: 10, color: "var(--text-3)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{t("header.courses.count", { n: courses.length.toLocaleString() })}</span>
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
            {t("header.credits.done", { n: totalSHDone, unit: unitName })}
          </span>
          <span style={{ fontSize: isPhone ? 8 : 10, color: "var(--text-3)", background: "var(--bg-surface)", border: "1px solid var(--border-2)", borderRadius: 4, padding: isPhone ? "1px 4px" : "2px 7px", flexShrink: 0 }}>
            {t("header.credits.placed", { n: totalSHPlaced, unit: unitName })}
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
                {t("header.plans.title")}
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
                    const name = prompt(t("header.plan.rename.prompt"), p.name);
                    if (name?.trim()) renamePlan(p.id, name.trim());
                  }} style={{ background: "none", border: "none", color: "var(--text-5)", cursor: "pointer", fontSize: 10, padding: "0 2px" }}
                    title={t("header.plan.rename.title")}>✎</button>
                  {/* Delete */}
                  {plans.length > 1 && (
                    <button onClick={e => {
                      e.stopPropagation();
                      if (confirm(t("header.plan.delete.confirm", { name: p.name }))) { deletePlan(p.id); if (plans.length <= 2) setShowPlanMenu(false); }
                    }} style={{ background: "none", border: "none", color: "var(--text-5)", cursor: "pointer", fontSize: 10, padding: "0 2px" }}
                      title="Delete">✕</button>
                  )}
                </div>
              ))}

              <div style={{ borderTop: "1px solid var(--border-1)", padding: "4px 10px 3px" }}>
                <button onClick={e => {
                  e.stopPropagation();
                  const name = prompt(t("header.plan.new.prompt"));
                  if (name?.trim()) { createPlan(name.trim()); setShowPlanMenu(false); }
                }} style={{
                  width: "100%", fontSize: isPhone ? 9 : 10, fontWeight: 700, cursor: "pointer",
                  background: "var(--bg-surface-2)", padding: "5px 8px", borderRadius: 5,
                  border: "1px solid var(--border-2)", color: "var(--accent)", textAlign: "left",
                }}>
                  {t("header.plan.new")}
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
            {isMobile ? "⇅" : `⇅ ${t("header.io.button")}`}
          </button>
          {showIO && (
            <div onClick={e => e.stopPropagation()} style={{
              position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 100,
              background: "var(--bg-surface)", border: "1px solid var(--border-2)", borderRadius: 8,
              padding: "10px 12px", minWidth: 170, boxShadow: "var(--shadow-modal)",
              display: "flex", flexDirection: "column", gap: 7,
            }}>
              <button className="hdr-btn-dd" onClick={handleCopyHumanReadable} title={t("header.io.copy.title")}
                style={{ width: "100%", textAlign: "center", fontSize: 10, fontWeight: 700, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: "1px solid var(--border-2)", color: "var(--text-4)" }}>
                {t("header.io.copy")}
              </button>
              <button className="hdr-btn-dd" onClick={handleExport} title={t("header.io.export.pdf.title")}
                style={{ width: "100%", textAlign: "center", fontSize: 10, fontWeight: 700, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: "1px solid var(--border-2)", color: "var(--text-4)" }}>
                {t("header.io.export.pdf")}
              </button>
              <button className="hdr-btn-dd" onClick={exportPlanJSON} title={t("header.io.export.json.title")}
                style={{ width: "100%", textAlign: "center", fontSize: 10, fontWeight: 700, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: "1px solid var(--border-2)", color: "var(--text-4)" }}>
                  {t("header.io.export.json")}
              </button>
              <input type="file" id="plan-import-input" accept=".json" style={{ display: "none" }}
                onChange={e => { if (e.target.files[0]) { importPlanJSON(e.target.files[0]); e.target.value = ""; } }} />
              <button className="hdr-btn-dd" onClick={() => document.getElementById("plan-import-input").click()} title={t("header.io.import.json.title")}
                style={{ width: "100%", textAlign: "center", fontSize: 10, fontWeight: 700, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: "1px solid var(--border-2)", color: "var(--text-4)" }}>
                  {t("header.io.import.json")}
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
            {isMobile ? "⚙" : `⚙ ${t("header.settings.button")}`}
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
                {persistEnabled ? t("header.settings.save.on") : t("header.settings.save.off")}
              </button>

              {/* Error lines toggle */}
              <button className="hdr-btn-dd" onClick={() => setShowViolLines(v => !v)}
                style={{ width: "100%", textAlign: "left", fontSize: 10, fontWeight: 700, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: `1px solid ${showViolLines ? "var(--error)" : "var(--border-2)"}`,
                  color: showViolLines ? "var(--error)" : "var(--text-4)" }}>
                {showViolLines ? t("header.settings.violations.on") : t("header.settings.violations.off")}
              </button>

              {/* Collapse other credits toggle */}
              <button className="hdr-btn-dd" onClick={() => setCollapseOtherCredits(v => !v)}
                style={{ width: "100%", textAlign: "left", fontSize: 10, fontWeight: 700, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: `1px solid ${collapseOtherCredits ? "var(--active)" : "var(--border-2)"}`,
                  color: collapseOtherCredits ? "var(--active)" : "var(--text-4)" }}>
                {collapseOtherCredits ? t("header.settings.collapse.on") : t("header.settings.collapse.off")}
              </button>

              {/* Theme toggle */}
              <button className="hdr-btn-dd" onClick={cycleTheme}
                style={{ width: "100%", textAlign: "left", fontSize: 10, fontWeight: 600, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: "1px solid var(--border-2)", color: "var(--text-4)" }}>
                {t(`header.settings.theme.${themeName}`) || THEME_LABELS[themeName] || themeName}
              </button>

              {/* Continuation logo toggle */}
              <button className="hdr-btn-dd" onClick={() => setShowContLogo(v => !v)}
                style={{ width: "100%", textAlign: "left", fontSize: 10, fontWeight: 400, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: "1px solid var(--border-2)",
                  color: showContLogo ? "var(--text-3)" : "var(--text-5)" }}>
                {showContLogo ? t("header.settings.contlogo.on") : t("header.settings.contlogo.off")}
              </button>

              {/** Refresh catalog data (commented out)
              <button className="hdr-btn-dd" onClick={handleRefresh}
                style={{ width: "100%", textAlign: "left", fontSize: 10, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: "1px solid var(--border-2)", color: "var(--text-4)" }}>
                ↺ Refresh
              </button>
              */}

              {/* Zoom */}
              <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 7 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", marginBottom: 5 }}>{t("header.settings.zoom")}</div>
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                  {[null, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map(v => {
                    const isActive = v === null ? manualZoom == null : manualZoom === v;
                    const label = v == null ? t("header.settings.zoom.auto") : `${Math.round(v * 100)}%`;
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
                  <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", marginBottom: 5, textTransform: "uppercase" }}>{t("header.cohort.title")}</div>
                  <div style={{ fontSize: 9, color: "var(--text-4)", marginBottom: 3 }}>{t("header.cohort.entry")}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 3, marginBottom: 6 }}>
                    {["fall","spring"].map(s => {
                      const wouldBe = planEntYear * 2 + (s === "spring" ? 1 : 0);
                      const blocked = wouldBe >= gradOrd;
                      return (<button key={s} onClick={() => { if (!blocked) setEntSem(s); }} style={{ flex: 1, fontSize: 9, padding: "3px 0", borderRadius: 4, cursor: blocked ? "not-allowed" : "pointer", background: planEntSem === s ? (s === "fall" ? "var(--sel-fall-bg)" : "var(--sel-spr-bg)") : "transparent", border: `1px solid ${planEntSem === s ? (s === "fall" ? "var(--sel-fall-border)" : "var(--sel-spr-border)") : blocked ? "var(--blocked-border)" : "var(--border-2)"}`, color: planEntSem === s ? (s === "fall" ? "var(--sel-fall-text)" : "var(--sel-spr-text)") : blocked ? "var(--blocked-text)" : "var(--text-4)", fontWeight: planEntSem === s ? 700 : 400, opacity: blocked ? 0.4 : 1 }}>{s === "fall" ? t("header.cohort.fall") : t("header.cohort.spring")}</button>);
                    })}
                    <YearStepper year={planEntYear} min={2010} max={2040} canInc={entOrd + 2 < gradOrd} onDec={() => { if (planEntYear > 2010) setEntYear(planEntYear - 1); }} onInc={() => { if (entOrd + 2 < gradOrd && planEntYear < 2040) setEntYear(planEntYear + 1); }} />
                  </div>
                  <div style={{ fontSize: 9, color: "var(--text-4)", marginBottom: 3 }}>{t("header.cohort.graduation")}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                    {["fall","spring"].map(s => {
                      const wouldBe = planGradYear * 2 + (s === "spring" ? 1 : 0);
                      const blocked = wouldBe <= entOrd;
                      return (<button key={s} onClick={() => { if (!blocked) setGradSem(s); }} style={{ flex: 1, fontSize: 9, padding: "3px 0", borderRadius: 4, cursor: blocked ? "not-allowed" : "pointer", background: planGradSem === s ? (s === "fall" ? "var(--sel-fall-bg)" : "var(--sel-spr-bg)") : "transparent", border: `1px solid ${planGradSem === s ? (s === "fall" ? "var(--sel-fall-border)" : "var(--sel-spr-border)") : blocked ? "var(--blocked-border)" : "var(--border-2)"}`, color: planGradSem === s ? (s === "fall" ? "var(--sel-fall-text)" : "var(--sel-spr-text)") : blocked ? "var(--blocked-text)" : "var(--text-4)", fontWeight: planGradSem === s ? 700 : 400, opacity: blocked ? 0.4 : 1 }}>{s === "fall" ? t("header.cohort.fall") : t("header.cohort.spring")}</button>);
                    })}
                    <YearStepper year={planGradYear} min={2010} max={2040} canDec={gradOrd - 2 > entOrd} onDec={() => { if (gradOrd - 2 > entOrd && planGradYear > 2010) setGradYear(planGradYear - 1); }} onInc={() => { if (planGradYear < 2040) setGradYear(planGradYear + 1); }} />
                  </div>
                </div>
              )}

              {/* Language picker */}
              {locales.length > 1 && (
                <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 7 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", marginBottom: 5 }}>{t("header.settings.language")}</div>
                  <LanguagePicker locale={locale} locales={locales} setLocale={setLocale} />
                </div>
              )}

              {/* Links */}
              <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 7, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", marginBottom: 1 }}>{t("header.links.title")}</div>
                <a href="https://nayugu.github.io/nu-map/dev.html" target="_blank" rel="noreferrer"
                  style={{ display: "block", width: "100%", textAlign: "left", fontSize: 10,
                    background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                    border: "1px solid var(--border-2)", color: "var(--text-4)",
                    textDecoration: "none", boxSizing: "border-box",
                    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace", letterSpacing: "0.02em" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "var(--text-4)"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border-2)"}
                >
                  /dev
                </a>
                <a href={`${import.meta.env.BASE_URL}documentation/`} target="_blank" rel="noreferrer"
                  style={{ display: "block", width: "100%", textAlign: "left", fontSize: 10,
                    background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                    border: "1px solid var(--border-2)", color: "var(--text-4)",
                    textDecoration: "none", boxSizing: "border-box",
                    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace", letterSpacing: "0.02em" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "var(--text-4)"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border-2)"}
                >
                  /documentation
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Cohort date picker — hidden on phone, available via Settings above */}
        {!isPhone && <div style={{ position: "relative" }}>
          <button
            className="hdr-btn"
            onClick={e => { e.stopPropagation(); setShowSettings(v => !v); }}
            title={t("header.cohort.button.title")}
            style={{
              fontSize: 10, cursor: "pointer", whiteSpace: "nowrap",
            color: showSettings ? "var(--text-2)" : "var(--text-4)",
            background: showSettings ? "var(--bg-surface)" : "var(--bg-surface-2)",
            border: `1px solid ${showSettings ? "var(--active)" : "var(--border-2)"}`,
              borderRadius: 5, padding: "3px 8px", whiteSpace: "nowrap",
            }}
          >{isMobile ? "🎓" : `🎓 ${t("header.cohort.button")}`}</button>

          {showSettings && (
            <div onClick={e => e.stopPropagation()} style={{
              position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 100,
              background: "var(--bg-surface)", border: "1px solid var(--border-2)", borderRadius: 8,
              padding: "14px 16px", minWidth: 270, boxShadow: "var(--shadow-modal)",
              display: "flex", flexDirection: "column", gap: 12,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.05em" }}>{t("header.cohort.title")}</div>

              {/* Entry */}
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", marginBottom: 6 }}>{t("header.cohort.entry")}</div>
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
                      >{s === "fall" ? t("header.cohort.fall") : t("header.cohort.spring")}</button>
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
                <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", marginBottom: 6 }}>{t("header.cohort.graduation")}</div>
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
                      >{s === "fall" ? t("header.cohort.fall") : t("header.cohort.spring")}</button>
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
                <span>{planEntSem === "fall" ? t("header.cohort.fall") : t("header.cohort.spring")} {planEntYear} → {planGradSem === "fall" ? t("header.cohort.fall") : t("header.cohort.spring")} {planGradYear}</span>
                {(planGradYear < planEntYear || (planGradYear === planEntYear && planGradSem === "fall" && planEntSem === "spring"))
                  ? <span style={{ color: "var(--error)" }}>{t("header.cohort.error")}</span>
                  : <span style={{ color: "var(--success)" }}>
                      {t("header.cohort.duration", { yrs: ((planGradYear * 2 + (planGradSem === "fall" ? 0 : 1)) - (planEntYear * 2 + (planEntSem === "fall" ? 0 : 1))) / 2 })}
                    </span>
                }
              </div>
              {/* Sticky courses toggle */}
              <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 8, display: "flex", justifyContent: "flex-end" }}>
                <button onClick={() => setStickyCourses(v => !v)}
                  style={{ fontSize: 9, fontWeight: 700, cursor: "pointer", background: "var(--bg-surface)", padding: "3px 8px", borderRadius: 4,
                    border: `1px solid ${stickyCourses ? "var(--active)" : "var(--border-2)"}`,
                    color: stickyCourses ? "var(--active)" : "var(--text-5)" }}>
                  {stickyCourses ? t("header.cohort.sticky.on") : t("header.cohort.sticky.off")}
                </button>
              </div>
            </div>
          )}
        </div>}

        {/* About button */}
        <button
          className="hdr-btn"
          onClick={e => { e.stopPropagation(); setShowDisclaimer(true); }}
          title={t("header.about.title")}
          style={{ fontSize: isPhone ? 8 : 10, color: "var(--text-4)", background: "var(--bg-surface-2)", border: "1px solid var(--border-2)", borderRadius: 5, padding: isPhone ? "2px 5px" : "3px 8px", cursor: "pointer", whiteSpace: "nowrap" }}
        >{isMobile ? "ⓘ" : `ⓘ ${t("header.about.button")}`}</button>
        </div>{/* end controls row */}
      </div>{/* end header */}

      {/* ── Relationship legend ── */}
      <div style={{ display: "flex", gap: isPhone ? 6 : 10, marginBottom: 8, flexWrap: "nowrap", alignItems: "center", overflow: "hidden" }}>
        {Object.entries(REL_STYLE).filter(([type]) => type !== "corequisite-viol").map(([type, s]) => (
            <div key={type} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: isPhone ? 8 : 9, color: "var(--text-4)", flexShrink: 0 }}>
            <svg width={isPhone ? 14 : 18} height="6">
              <line x1="0" y1="3" x2={isPhone ? 14 : 18} y2="3" stroke={s.color} strokeWidth="1.5" strokeDasharray={s.dash || ""} />
            </svg>
            <span>{t(`legend.${type}`) || s.label}</span>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 3, fontSize: isPhone ? 8 : 9, color: "var(--text-4)", flexShrink: 0 }}>
          <span style={{ display: "inline-block", width: isPhone ? 10 : 12, height: isPhone ? 10 : 12, borderRadius: 3, border: "2px solid var(--warn-bright)", flexShrink: 0 }} />
          <span>{t("legend.corequisite-viol")}</span>
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
              {t("header.coop.conflict.title")}
            </div>
            <div style={{ fontSize: 10, color: "var(--warn)", lineHeight: 1.5 }}>
              {coopGradConflicts.length === 1
                ? t("header.coop.conflict.single", {
                    label: coopGradConflicts[0].label,
                    sem: planGradSem === "fall" ? t("header.cohort.fall") : t("header.cohort.spring"),
                    year: planGradYear,
                  })
                : t("header.coop.conflict.multi", {
                    labels: coopGradConflicts.map(w => w.label).join(", "),
                    sem: planGradSem === "fall" ? t("header.cohort.fall") : t("header.cohort.spring"),
                    year: planGradYear,
                  })
              }
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Language search input with portal dropdown — mirrors CompanySearch UX.
 * Placeholder shows the active locale's native name. Typing filters locales;
 * selecting commits the change and clears the query.
 */
function LanguagePicker({ locale, locales, setLocale }) {
  const [query, setQuery] = useState("");
  const [open,  setOpen]  = useState(false);
  const [pos,   setPos]   = useState({ top: 0, left: 0, width: 0 });
  const wrapRef = useRef(null);
  const dropRef = useRef(null);

  useEffect(() => {
    const handler = e => {
      if (wrapRef.current?.contains(e.target)) return;
      if (dropRef.current?.contains(e.target)) return;
      setOpen(false);
      setQuery("");
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, []);

  const openAt = () => {
    if (!wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left, width: r.width });
  };

  const handleChange = e => {
    const v = e.target.value;
    setQuery(v);
    if (v.trim()) { openAt(); setOpen(true); }
    else setOpen(false);
  };

  const select = l => {
    setLocale(l.code);
    setQuery("");
    setOpen(false);
  };

  const filtered = query.trim()
    ? locales.filter(l => {
        const q = query.toLowerCase();
        return l.nativeName.toLowerCase().includes(q)
          || l.name.toLowerCase().includes(q)
          || l.code.toLowerCase().includes(q);
      })
    : [];

  const currentNativeName = locales.find(l => l.code === locale)?.nativeName ?? "";

  const dropdown = open && filtered.length > 0 && createPortal(
    <div ref={dropRef} style={{
      position: "fixed", top: pos.top, left: pos.left, width: pos.width,
      zIndex: 99999,
      background: "var(--bg-surface)", border: "1px solid var(--border-2)",
      borderRadius: 6, boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
      maxHeight: 200, overflowY: "auto",
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      {filtered.map(l => (
        <div key={l.code}
          onMouseDown={e => { e.preventDefault(); select(l); }}
          onTouchEnd={e => { e.preventDefault(); select(l); }}
          style={{
            padding: "7px 10px", cursor: "pointer", fontSize: 11,
            color: l.code === locale ? "var(--active)" : "var(--text-2)",
            fontWeight: l.code === locale ? 700 : 400,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "var(--card-bg-hov)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
        >
          {l.nativeName}
          {l.code === locale && <span style={{ fontSize: 9, marginLeft: 6 }}>✓</span>}
        </div>
      ))}
    </div>,
    document.body
  );

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        value={query}
        onChange={handleChange}
        onFocus={() => { if (filtered.length) { openAt(); setOpen(true); } }}
        onMouseDown={e => e.stopPropagation()}
        placeholder={currentNativeName}
        style={{
          width: "100%", boxSizing: "border-box",
          fontSize: 10, padding: "4px 7px", borderRadius: 4,
          border: "1px solid var(--border-2)", background: "var(--bg-surface-2)",
          color: "var(--text-3)", outline: "none",
        }}
      />
      {dropdown}
    </div>
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
