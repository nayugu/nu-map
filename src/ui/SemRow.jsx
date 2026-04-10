// ═══════════════════════════════════════════════════════════════════
// SEM ROW  — renders a single non-summer semester row (fall/spring/special)
// ═══════════════════════════════════════════════════════════════════
import { usePlanner } from "../context/PlannerContext.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { useState } from "react";
import { TYPE_BG } from "../core/constants.js";
import { hexRgb, getSemSH, getOrderedCourses } from "../core/planModel.js";
import { resolveTermByDuration } from "../core/specialTermUtils.js";
import { usePort }        from "../context/InstitutionContext.jsx";
import { ISpecialTerms }  from "../ports/ISpecialTerms.js";
import { ICreditSystem }  from "../ports/ICreditSystem.js";
import { useLanguage }    from "../context/LanguageContext.jsx";
import CourseCard from "./CourseCard.jsx";
import CompanySearch from "./CompanySearch.jsx";
import CompanyLogo from "./CompanyLogo.jsx";

export default function SemRow({ sem }) {
  const {
    placements, semOrders, courseMap, effectiveCourseMap,
    getSemStatus, setCurrentSemId,
    dragInfo, hoveredSem, hoveredZone,
    onDragOver, onDragLeave, onDrop,
    setHoveredZone, setHoveredSem,
    specialTermStartMap, specialTermContMap, specialTermPl, setSpecialTermPl,
    cardRefs, onDragStart,
    SEM_INDEX,
    pushUndo, isPhone,
    bonusSH, setBonusSH,
  } = usePlanner();

  const { themeName } = useTheme();
  const specialTerms = usePort(ISpecialTerms);
  const creditSystem = usePort(ICreditSystem);
  const unitName     = creditSystem.getUnitName();
  const { t } = useLanguage();
  const companyColor     = themeName === "dark" ? "#b0bbc5" : "var(--text-3)";
  const placeholderColor = themeName === "dark" ? "#3e4856" : "#e4e4e4";

  const semStatus = getSemStatus(sem.id);
  const isDone    = semStatus === "completed";
  const isActive  = semStatus === "inprogress";

  // Generic special term for this semester
  const termStartId   = specialTermStartMap[sem.id];
  const termStartData = termStartId ? specialTermPl[termStartId] : null;
  const termStartType = termStartData ? (specialTerms.getTypes() ?? []).find(t => t.id === termStartData.typeId) : null;
  const termStartDur  = termStartType ? resolveTermByDuration(termStartType.durations, termStartData.duration) : null;

  const termContId   = specialTermContMap[sem.id];
  const termContData = termContId ? specialTermPl[termContId] : null;
  const termContType = termContData ? (specialTerms.getTypes() ?? []).find(t => t.id === termContData.typeId) : null;
  const termContDur  = termContType ? resolveTermByDuration(termContType.durations, termContData.duration) : null;

  // Numbering: 1-based index among placements of the same type, sorted by semester
  const termNum = (typeId, id) => Object.entries(specialTermPl)
    .filter(([, d]) => d?.semId && d.typeId === typeId)
    .sort(([, a], [, b]) => (SEM_INDEX[a.semId] ?? 99) - (SEM_INDEX[b.semId] ?? 99))
    .findIndex(([eid]) => eid === id) + 1;
  const courseIds  = getOrderedCourses(sem.id, placements, semOrders, courseMap);
  const crs        = courseIds.map(id => effectiveCourseMap[id] ?? courseMap[id]).filter(Boolean);
  const sh         = getSemSH(sem.id, placements, effectiveCourseMap);
  const mainSlots  = (sem.type === "fall" || sem.type === "spring") ? 4
                   : sem.type === "summer" ? 2 : null;
  const main4      = crs.filter(c => c.sh >= 3);
  const others     = crs.filter(c => c.sh <= 2);

  // Collapsible other credits
  const { collapseOtherCredits, collapsedSubs, setCollapsedSubs, showContLogo } = usePlanner();
  const [showOther, setShowOther] = useState(!collapseOtherCredits);

  // Collapsed state for incoming credit section (per-semester)
  const isIncomingCollapsed = collapsedSubs[sem.id] !== false;
  const isHov      = hoveredSem === sem.id;
  const tb         = TYPE_BG[sem.type] || TYPE_BG.special;

  let rowBg, rowBorder, rowOpacity, rowBoxShadow;
  if (isActive) {
    rowBg        = tb.bg;                          // no bg change — outline only
    rowBorder    = "1px solid var(--active-now-border)";
    rowOpacity   = 1;
    rowBoxShadow = "var(--shadow-active-row)";
  } else if (isDone) {
    rowBg        = isHov ? "var(--active-hov-bg)" : tb.bg;
    rowBorder    = `1px solid ${tb.border}`;
    rowOpacity   = 0.9;
    rowBoxShadow = "var(--shadow-done-row)";
  } else {
    rowBg        = isHov ? "var(--active-hov-bg)" : tb.bg;
    rowBorder    = `1px solid ${isHov ? "var(--active)" : tb.border}`;
    rowOpacity   = 1;
    rowBoxShadow = "none";
  }

  const statusDot = isDone ? (
    <span style={{ width: 14, height: 14, borderRadius: 3, background: "var(--bg-surface)", border: "1px solid var(--success-border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <span style={{ fontSize: 9, color: "var(--success)", fontWeight: 900 }}>✓</span>
    </span>
  ) : isActive ? (
    <span style={{ width: 14, height: 14, borderRadius: 3, background: "var(--active-bg)", border: "1px solid var(--active)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <span style={{ fontSize: 9, color: "var(--active)", fontWeight: 900 }}>▶</span>
    </span>
  ) : (
    <span style={{ width: 14, height: 14, borderRadius: 3, border: "1px solid var(--border-2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} />
  );

  const shEl = sh > 0 ? (
    <span style={{
      fontSize: 10, fontWeight: 700, marginLeft: 4,
      color: sh > 19 ? "var(--error)" : (sh < 12 && (sem.type === "fall" || sem.type === "spring")) ? "var(--warn-bright)" : "var(--success)",
    }}>
      {sh} SH{sh > 19 ? " ⚠" : ""}
    </span>
  ) : null;

  // Continuation row (any special term spanning from previous semester)
  if (termContId && !termStartId) {
    return (
      <div key={sem.id}
        onClick={() => setCurrentSemId(sem.id)}
        style={{
          display: "flex", alignItems: "stretch", marginBottom: 3, cursor: "pointer",
          background: "var(--card-bg)",
          border: isActive ? "2px solid var(--active)" : "1px solid var(--border-card)",
          borderRadius: 6, padding: "6px 10px",
          opacity: isDone ? 0.9 : 1,
          boxShadow: isActive ? "var(--shadow-active-row)" : "none",
          transition: "opacity 0.15s",
        }}
      >
        <div style={{ width: "clamp(100px,13vw,148px)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
            {statusDot}
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-3)" }}>{sem.label}</span>
            {isActive && (
              <span style={{ fontSize: 9, color: "var(--text-4)", background: "var(--bg-surface-2)", border: "1px solid var(--border-2)", borderRadius: 3, padding: "1px 4px", fontWeight: 700 }}>NOW</span>
            )}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-4)", paddingLeft: 19 }}>{sem.sub}</div>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, paddingLeft: 8 }}>
          <div style={{ width: 3, alignSelf: "stretch", background: "var(--border-2)", borderRadius: 2 }} />
          <div>
            <div style={{ fontSize: isPhone ? 6 : 12, fontWeight: 600, color: companyColor, fontFamily: "'Inter', sans-serif", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              {termContType?.label ?? "Work"} Continues
            </div>
            <div style={{ fontSize: isPhone ? 5 : 10, color: "var(--text-4)" }}>{termContData?.duration}-month block · drag to move</div>
          </div>
          {showContLogo && <CompanyLogo key={termContData?.companyDomain || ""} domain={termContData?.companyDomain} size={isPhone ? 20 : 40} />}
        </div>
      </div>
    );
  }

  return (
    <div key={sem.id}
      data-sem-id={sem.id}
      onDragOver={e => onDragOver(e, sem.id)}
      onDragLeave={onDragLeave}
      onDrop={e => onDrop(e, sem.id)}
      style={{
        display: "flex", alignItems: "flex-start", gap: 8,
        background: rowBg, border: rowBorder, borderRadius: 6,
        padding: "6px 8px", marginBottom: 3,
        minHeight: sem.type === "special" ? "auto" : 70,
        opacity: rowOpacity, boxShadow: rowBoxShadow,
        transition: "background 0.12s, border-color 0.12s, opacity 0.15s",
        flexWrap: "nowrap",
      }}
    >
      {/* Semester label */}
      {isPhone ? (
        <div
          onClick={() => setCurrentSemId(sem.id)}
          style={{ width: 34, flexShrink: 0, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 1, paddingTop: 2 }}
        >
          {statusDot}
          {sem.label.split(" ").map((part, i) => (
            <span key={i} style={{ fontSize: 7, fontWeight: i === 0 ? 700 : 500, color: i === 0 ? "var(--text-2)" : "var(--text-4)", lineHeight: 1.2, textAlign: "center" }}>{part}</span>
          ))}
          {shEl}
        </div>
      ) : (
        <div
          onClick={() => setCurrentSemId(sem.id)}
          style={{ width: "clamp(100px,13vw,148px)", flexShrink: 0, cursor: "pointer" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 1 }}>
            {statusDot}
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)" }}>
              {sem.label}
            </span>
            {isActive && (
              <span style={{ fontSize: 9, color: "var(--text-4)", background: "var(--bg-surface-2)", border: "1px solid var(--border-2)", borderRadius: 3, padding: "1px 4px", fontWeight: 700 }}>
                NOW
              </span>
            )}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-4)", paddingLeft: 19, marginBottom: 2 }}>{sem.sub}</div>
          {shEl}
          {sem.id === "incoming" && !isIncomingCollapsed && (
            <div style={{ paddingLeft: 19, marginTop: 5 }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 9, color: "var(--text-4)", marginBottom: 2 }}>general SH</div>
              <input
                type="number" min={0} max={999} value={bonusSH || ""}
                placeholder="0"
                onChange={e => {
                  const v = parseInt(e.target.value, 10);
                  setBonusSH(isNaN(v) || v < 0 ? 0 : v);
                }}
                style={{
                  width: 52, fontSize: 11, fontWeight: 700,
                  padding: "2px 5px", borderRadius: 4,
                  border: "1px solid var(--border-2)",
                  background: "var(--bg-surface-2)", color: "var(--text-1)",
                  outline: "none",
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Course slots */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, flex: 1 }}>
        {termStartId ? (
          // Full-width special term card (co-op, internship, or any custom type)
          <div
            ref={el => { cardRefs.current[termStartId] = el; }}
            draggable
            data-drag-id={termStartId}
            data-drag-type="specialTerm"
            data-drag-typeid={termStartData.typeId}
            data-drag-duration={termStartData.duration}
            data-drag-from={sem.id}
            onDragStart={e => onDragStart(e, termStartId, "specialTerm", sem.id, { duration: termStartData.duration, typeId: termStartData.typeId })}
            style={{
              flex: 1, minHeight: 58, minWidth: 200,
              position: "relative",
              background: "var(--card-bg)",
              border: "1px solid var(--border-card)",
              borderRadius: 6, padding: "8px 12px 8px 14px", cursor: "grab",
              display: "flex", flexDirection: "column", justifyContent: "center",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: isPhone ? 7 : 14, fontWeight: 600, color: companyColor, fontFamily: "'Inter', sans-serif", letterSpacing: "0.05em", textTransform: "uppercase", whiteSpace: "nowrap", flexShrink: 0 }}>
                {termStartType?.label ?? termStartData.typeId} {termNum(termStartData.typeId, termStartId)}
              </div>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "stretch", gap: 1, paddingLeft: isPhone ? 10 : 20 }}>
                <CompanySearch
                  name={termStartData.company}
                  color={companyColor}
                  emptyColor={placeholderColor}
                  fontSize={isPhone ? 7 : 14}
                  onChange={v => setSpecialTermPl(p => ({ ...p, [termStartId]: { ...p[termStartId], company: v?.name ?? "", companyDomain: v?.domain ?? "" } }))}
                />
                <input
                  value={termStartData.subline ?? ""}
                  onChange={e => setSpecialTermPl(p => ({ ...p, [termStartId]: { ...p[termStartId], subline: e.target.value } }))}
                  onMouseDown={e => e.stopPropagation()}
                  placeholder={t("sem.work.role.placeholder")}
                  className="work-input"
                  style={{ textAlign: "right", width: "100%", fontFamily: "'Inter', sans-serif", fontSize: isPhone ? 5 : 10, fontWeight: 400, color: termStartData.subline ? companyColor : placeholderColor, background: "transparent", border: "none", outline: "none", padding: 0 }}
                />
              </div>
              <CompanyLogo key={termStartData.companyDomain || ""} domain={termStartData.companyDomain} size={isPhone ? 20 : 40} />
              <button
                onClick={e => { e.stopPropagation(); pushUndo(); setSpecialTermPl(p => { const n = { ...p }; delete n[termStartId]; return n; }); }}
                onMouseDown={e => e.stopPropagation()}
                style={{ background: "none", border: "none", color: "var(--text-4)", cursor: "pointer", fontSize: 12, lineHeight: 1, padding: 0, flexShrink: 0 }}
                title={t("sem.term.remove", { type: (termStartType?.label ?? "term").toLowerCase() })}
              >✕</button>
            </div>
            {/* Warning for internship in fall/spring (requires non-attendance petition at NU) */}
            {termStartData.typeId === "intern" && (sem.type === "fall" || sem.type === "spring") && !isPhone && (
              <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", display: "flex", alignItems: "center", gap: 4, pointerEvents: "none" }}>
                <span style={{ fontSize: 13, color: "#facc15" }}>⚠</span>
                <span style={{ fontSize: 9, color: "#facc15", lineHeight: 1.3, whiteSpace: "nowrap" }}>{t("sem.intern.petition")}</span>
              </div>
            )}
            {termStartData.typeId === "intern" && (sem.type === "fall" || sem.type === "spring") && isPhone && (
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6, pointerEvents: "none" }}>
                <span style={{ fontSize: 11, color: "#facc15" }}>⚠</span>
                <span style={{ fontSize: 8, color: "#facc15", lineHeight: 1.3 }}>{t("sem.intern.petition")}</span>
              </div>
            )}
          </div>

        ) : mainSlots === null ? (
          // Special / incoming — collapsible section
          <div style={{ flex: 1, alignItems: "flex-start", display: "flex", flexDirection: "column", gap: 2 }}>
            <button
              onClick={() => setCollapsedSubs(p => ({ ...p, [sem.id]: !isIncomingCollapsed }))}
              style={{
                fontSize: 10, color: "var(--text-5)", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 2, textAlign: "left", alignSelf: "flex-start"
              }}
              aria-expanded={!isIncomingCollapsed}
              title={isIncomingCollapsed ? t("sem.incoming.title.show") : t("sem.incoming.title.hide")}
            >
              {isIncomingCollapsed
                ? `► general SH: ${bonusSH || 0}${crs.length > 0 ? ' | ' : ''}${crs.map(c => c.code || (c.subject + ' ' + c.number)).join(", ")}`
                : "▼ Incoming Credit"
              }
            </button>
            {!isIncomingCollapsed && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "flex-start" }}>
                {crs.map(c => <CourseCard key={c.id} course={c} inSem semId={sem.id} />)}
                <div
                  onDragOver={e => {
                    if (!dragInfo || dragInfo.type !== "course") return;
                    e.preventDefault(); e.stopPropagation();
                    setHoveredZone({ semId: sem.id, zone: "append" }); setHoveredSem(null);
                  }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setHoveredZone(null); }}
                  onDrop={e => { e.stopPropagation(); setHoveredZone(null); onDrop(e, sem.id); }}
                  style={{
                    height: 70, width: 164, flexShrink: 0,
                    border: hoveredZone?.semId === sem.id && hoveredZone?.zone === "append"
                      ? "1px dashed var(--active)" : "1px dashed var(--border-slot)",
                    borderRadius: 6,
                    background: hoveredZone?.semId === sem.id && hoveredZone?.zone === "append"
                      ? "var(--active-bg)" : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "border-color 0.1s, background 0.1s",
                  }}
                >
                  <span style={{ fontSize: 9, color: "var(--text-5)", fontStyle: "italic", pointerEvents: "none" }}>
                    {hoveredZone?.semId === sem.id && hoveredZone?.zone === "append" ? t("sem.slot.drop") : t("sem.slot.add")}
                  </span>
                </div>
              </div>
            )}
          </div>

        ) : (
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Main ≥4 SH zone */}
            <div
              onDragOver={e => {
                if (!dragInfo || dragInfo.type !== "course") return;
                const c = courseMap[dragInfo.id]; if (!c || c.sh < 4) return;
                e.preventDefault(); e.stopPropagation();
                setHoveredZone({ semId: sem.id, zone: "main" }); setHoveredSem(null);
              }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setHoveredZone(null); }}
              onDrop={e => {
                if (!dragInfo || dragInfo.type !== "course") return;
                const c = courseMap[dragInfo.id]; if (!c || c.sh < 4) return;
                e.stopPropagation(); setHoveredZone(null); onDrop(e, sem.id);
              }}
              style={{
                display: "grid", gridTemplateColumns: `repeat(${isPhone ? 2 : mainSlots}, 1fr)`, gap: 4, overflow: "hidden",
                borderRadius: 6, padding: 3, minHeight: 76,
                border: hoveredZone?.semId === sem.id && hoveredZone?.zone === "main"
                  ? "1px solid var(--active)" : "1px solid transparent",
                background: hoveredZone?.semId === sem.id && hoveredZone?.zone === "main"
                  ? "var(--active-bg)" : "transparent",
                transition: "border-color 0.1s, background 0.1s",
              }}
            >
              {main4.map(c => <CourseCard key={c.id} course={c} inSem semId={sem.id} />)}
              {Array.from({ length: Math.max(0, (isPhone ? 2 : mainSlots) - main4.length) }).map((_, i) => (
                <div key={`ms-${i}`} style={{ minHeight: 70, border: "1px dashed var(--border-slot)", borderRadius: 6, background: tb.bg }} />
              ))}
            </div>

            {/* Override zone — only visible when all main slots full + dragging a ≥4 SH course */}
            {main4.length >= (isPhone ? 2 : mainSlots) && dragInfo?.type === "course" && (courseMap[dragInfo.id]?.sh ?? 0) >= 4 && (
              <div
                onDragOver={e => {
                  if (!dragInfo || dragInfo.type !== "course") return;
                  const c = courseMap[dragInfo.id]; if (!c || c.sh < 4) return;
                  e.preventDefault(); e.stopPropagation();
                  setHoveredZone({ semId: sem.id, zone: "override" }); setHoveredSem(null);
                }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setHoveredZone(null); }}
                onDrop={e => {
                  if (!dragInfo || dragInfo.type !== "course") return;
                  e.stopPropagation(); setHoveredZone(null); onDrop(e, sem.id);
                }}
                style={{
                  marginTop: 3, padding: "3px 6px",
                  borderRadius: 4, cursor: "copy",
                  border: hoveredZone?.semId === sem.id && hoveredZone?.zone === "override"
                    ? "1px dashed var(--active)" : "1px dashed var(--border-slot)",
                  background: hoveredZone?.semId === sem.id && hoveredZone?.zone === "override"
                    ? "var(--active-bg)" : "transparent",
                  opacity: hoveredZone?.semId === sem.id && hoveredZone?.zone === "override" ? 1 : 0.35,
                  transition: "opacity 0.15s, border-color 0.1s, background 0.1s",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <span style={{ fontSize: 9, color: "var(--text-4)", letterSpacing: "0.04em" }}>{t("sem.override.label")}</span>
              </div>
            )}

            {/* Other <4 SH zone (collapsible) */}
            {(others.length > 0 || (dragInfo?.type === "course" && (courseMap[dragInfo.id]?.sh ?? 4) < 4)) && (
              <div style={{ marginTop: 5 }}>
                <button
                  onClick={() => setShowOther(v => !v)}
                  style={{
                    fontSize: 9, color: "var(--text-5)", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 2, textAlign: "left"
                  }}
                  aria-expanded={showOther}
                  title={showOther ? t("sem.other.title.hide") : t("sem.other.title.show")}
                >
                  {showOther
                    ? t("sem.other.label.open")
                    : (!isPhone && others.length > 0)
                      ? `► ${others.map(c => `${c.subject} ${c.number}`).join(", ")}`
                      : t("sem.other.label.closed")
                  }
                </button>
                {showOther && (
                  <div
                    onDragOver={e => {
                      if (!dragInfo || dragInfo.type !== "course") return;
                      const c = courseMap[dragInfo.id]; if (!c || c.sh >= 4) return;
                      e.preventDefault(); e.stopPropagation();
                      setHoveredZone({ semId: sem.id, zone: "other" }); setHoveredSem(null);
                    }}
                    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setHoveredZone(null); }}
                    onDrop={e => {
                      if (!dragInfo || dragInfo.type !== "course") return;
                      const c = courseMap[dragInfo.id]; if (!c || c.sh >= 4) return;
                      e.stopPropagation(); setHoveredZone(null); onDrop(e, sem.id);
                    }}
                    style={{
                      display: "flex", flexWrap: "wrap", gap: 4,
                      padding: "5px 4px 4px",
                      borderTop: "1px solid var(--border-sub)", borderRadius: 4,
                      minHeight: others.length === 0 ? 34 : "auto",
                      background: hoveredZone?.semId === sem.id && hoveredZone?.zone === "other" ? "var(--active-bg)" : "transparent",
                      outline: hoveredZone?.semId === sem.id && hoveredZone?.zone === "other" ? "1px dashed var(--active)" : "none",
                      transition: "background 0.1s",
                    }}
                  >
                    {others.map(c => <CourseCard key={c.id} course={c} inSem semId={sem.id} />)}
                    {others.length === 0 && (
                      <span style={{ fontSize: 9, color: "var(--text-5)", fontStyle: "italic", alignSelf: "center" }}>
                        {t("sem.other.drop", { unit: unitName })}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
