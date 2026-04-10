// ═══════════════════════════════════════════════════════════════════
// SUMMER ROW  — renders sumA + sumB as a single combined visual block
// ═══════════════════════════════════════════════════════════════════
import { usePlanner } from "../context/PlannerContext.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { useState } from "react";
import { TYPE_BG } from "../core/constants.js";
import { getSemSH, getOrderedCourses } from "../core/planModel.js";
import { resolveTermByDuration } from "../core/specialTermUtils.js";
import { usePort }        from "../context/InstitutionContext.jsx";
import { ISpecialTerms }  from "../ports/ISpecialTerms.js";
import { useLanguage }    from "../context/LanguageContext.jsx";
import CourseCard from "./CourseCard.jsx";
import CompanySearch from "./CompanySearch.jsx";
import CompanyLogo from "./CompanyLogo.jsx";


export default function SummerRow({ semA, semB }) {
  const {
    placements, semOrders, effectiveCourseMap,
    getSemStatus, setCurrentSemId,
    dragInfo, hoveredSem, hoveredZone,
    onDragOver, onDragLeave, onDrop,
    setHoveredZone, setHoveredSem,
    specialTermStartMap, specialTermContMap, specialTermPl, setSpecialTermPl,
    cardRefs, onDragStart,
    SEM_INDEX,
    pushUndo, isPhone,
    collapseOtherCredits, showContLogo,
  } = usePlanner();

  const { themeName } = useTheme();
  const specialTerms = usePort(ISpecialTerms);
  const { t } = useLanguage();
  const companyColor = themeName === "dark" ? "#b0bbc5" : "var(--text-3)";
  const placeholderColor = themeName === "dark" ? "#3e4856" : "#e4e4e4";

  // Collapsible state for other credits
  const [showOther, setShowOther] = useState(!collapseOtherCredits);

  const year     = semA.id.replace("sumA", "");
  const sems     = [semA, semB].filter(Boolean);
  const combinedDone   = sems.every(s => getSemStatus(s.id) === "completed");
  const combinedActive = sems.some(s => getSemStatus(s.id) === "inprogress");
  const combinedSH     = sems.reduce((sum, s) => sum + getSemSH(s.id, placements, effectiveCourseMap), 0);
  const tb         = TYPE_BG.summer;
  const rowBg      = tb.bg;
  const rowBorder  = combinedActive ? "1px solid var(--active-now-border)" : `1px solid ${tb.border}`;
  const rowOpacity = combinedDone ? 0.9 : 1;

  const removeTerm = id => { pushUndo(); setSpecialTermPl(p => { const n = { ...p }; delete n[id]; return n; }); };

  const termNum = (typeId, id) => Object.entries(specialTermPl)
    .filter(([, d]) => d?.semId && d.typeId === typeId)
    .sort(([, a], [, b]) => (SEM_INDEX[a.semId] ?? 99) - (SEM_INDEX[b.semId] ?? 99))
    .findIndex(([eid]) => eid === id) + 1;

  const renderSession = sem => {
    if (!sem) return null;
    const semStatus  = getSemStatus(sem.id);
    const semIsDone  = semStatus === "completed";
    const isSessionA = sem.id.startsWith("sumA");
    const sessionLabel = isSessionA ? "Session A" : "Session B";

    // ── Special term start card ───────────────────────────────────
    const termStartId   = specialTermStartMap[sem.id];
    const termStartData = termStartId ? specialTermPl[termStartId] : null;
    const termStartType = termStartData ? (specialTerms?.getTypes() ?? []).find(t => t.id === termStartData.typeId) : null;
    const termStartDur  = termStartType ? resolveTermByDuration(termStartType.durations, termStartData.duration) : null;
    if (termStartDur) {
      const displayLabel = isPhone && termStartType.label === "Full-Time Internship" ? "Internship" : termStartType.label;
      return (
        <div key={sem.id} data-sem-id={sem.id} style={{
          flex: 1, minWidth: 0, overflow: "hidden",
          border: `1px solid ${hoveredSem === sem.id ? "var(--active)" : "var(--border-slot)"}`, borderRadius: 4, padding: "4px 5px",
          background: hoveredSem === sem.id ? "var(--active-bg)" : "var(--card-bg)",
          transition: "background 0.1s, border-color 0.1s",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 5 }}>
            <span style={{ fontSize: isPhone ? 5 : 9, fontWeight: 600, color: companyColor, fontFamily: "'Inter', sans-serif" }}>{sessionLabel}</span>
            <span style={{ fontSize: isPhone ? 5 : 9, color: "var(--text-5)" }}>{sem.sub}</span>
          </div>
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
              width: "100%", minHeight: 58,
              background: "var(--card-bg)",
              border: "1px solid var(--border-card)",
              borderRadius: 6, padding: "8px 10px 8px 12px",
              cursor: "grab", display: "flex", flexDirection: "column", justifyContent: "center",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{ fontSize: isPhone ? 7 : 13, fontWeight: 600, color: companyColor, fontFamily: "'Inter', sans-serif", letterSpacing: termStartData.typeId === "coop" ? "0.08em" : "0.03em", textTransform: termStartData.typeId === "coop" ? "uppercase" : "none", whiteSpace: "nowrap", flexShrink: 0 }}>
                {displayLabel} {termNum(termStartData.typeId, termStartId)}
              </div>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "stretch", gap: 1, paddingLeft: isPhone ? 8 : 17 }}>
                <CompanySearch name={termStartData.company} color={companyColor} emptyColor={placeholderColor} fontSize={isPhone ? 7 : 13} onChange={v => setSpecialTermPl(p => ({ ...p, [termStartId]: { ...p[termStartId], company: v?.name ?? "", companyDomain: v?.domain ?? "" } }))} />
                <input value={termStartData.subline ?? ""} onChange={e => setSpecialTermPl(p => ({ ...p, [termStartId]: { ...p[termStartId], subline: e.target.value } }))} onMouseDown={e => e.stopPropagation()} placeholder={t("sem.work.role.placeholder")} className="work-input" style={{ textAlign: "right", width: "100%", fontFamily: "'Inter', sans-serif", fontSize: isPhone ? 5 : 9, fontWeight: 400, color: termStartData.subline ? companyColor : placeholderColor, background: "transparent", border: "none", outline: "none", padding: 0 }} />
              </div>
              <CompanyLogo key={termStartData.companyDomain || ""} domain={termStartData.companyDomain} size={isPhone ? 17 : 34} />
              <button onClick={e => { e.stopPropagation(); removeTerm(termStartId); }} onMouseDown={e => e.stopPropagation()} style={{ background: "none", border: "none", color: "var(--text-4)", cursor: "pointer", fontSize: 11, lineHeight: 1, padding: 0, flexShrink: 0 }} title={t("sem.term.remove", { type: termStartType.label.toLowerCase() })}>✕</button>
            </div>
          </div>
        </div>
      );
    }

    // ── Special term continuation block ──────────────────────────
    const termContId   = specialTermContMap[sem.id];
    const termContData = termContId ? specialTermPl[termContId] : null;
    const termContType = termContData ? (specialTerms?.getTypes() ?? []).find(t => t.id === termContData.typeId) : null;
    const termContDur  = termContType ? resolveTermByDuration(termContType.durations, termContData.duration) : null;
    if (termContDur && !termStartId) {
      return (
        <div key={sem.id} data-sem-id={sem.id} style={{
          flex: 1, minWidth: 0, overflow: "hidden",
          border: "1px solid var(--border-slot)", borderRadius: 4, padding: "4px 5px",
          background: "var(--card-bg)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 5 }}>
            <span style={{ fontSize: isPhone ? 5 : 9, fontWeight: 700, color: "var(--text-3)" }}>{sessionLabel}</span>
            <span style={{ fontSize: isPhone ? 5 : 9, color: "var(--text-5)" }}>{sem.sub}</span>
          </div>
          <div style={{
            width: "100%", minHeight: 58,
            border: "1px solid var(--border-card)",
            borderRadius: 6, padding: "8px 14px",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
          }}>
            <div>
              <div style={{ fontSize: isPhone ? 6 : 11, fontWeight: 600, color: companyColor, fontFamily: "'Inter', sans-serif", letterSpacing: termContData.typeId === "coop" ? "0.08em" : "0.03em", textTransform: termContData.typeId === "coop" ? "uppercase" : "none" }}>{termContType?.label} {t("sem.cont.abbr")}</div>
              <div style={{ fontSize: isPhone ? 5 : 9, color: "var(--text-4)", marginTop: 2 }}>{termContData.duration}-month block</div>
            </div>
            {showContLogo && <CompanyLogo key={termContData.companyDomain || ""} domain={termContData.companyDomain} size={isPhone ? 17 : 34} />}
          </div>
        </div>
      );
    }

    // ── Normal course session ─────────────────────────────────────
    const courseIds = getOrderedCourses(sem.id, placements, semOrders, effectiveCourseMap);
    const crs    = courseIds.map(id => effectiveCourseMap[id]).filter(Boolean);
    const main4  = crs.filter(c => c.sh >= 3);
    const others = crs.filter(c => c.sh <= 2);

    return (
      <div key={sem.id}
        data-sem-id={sem.id}
        onDragOver={e => onDragOver(e, sem.id)}
        onDragLeave={onDragLeave}
        onDrop={e => onDrop(e, sem.id)}
        style={{
          flex: 1, minWidth: 0, overflow: "hidden",
          padding: "4px 5px",
          border: `1px solid ${hoveredSem === sem.id ? "var(--active)" : "var(--border-slot)"}`,
          borderRadius: 4,
          background: hoveredSem === sem.id ? "var(--active-bg)" : "transparent",
          transition: "background 0.1s, border-color 0.1s",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 5 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: semIsDone ? "var(--success)" : "var(--text-4)" }}>
            {sessionLabel}
          </span>
          <span style={{ fontSize: 9, color: "var(--text-5)" }}>{sem.sub}</span>
          {semIsDone && <span style={{ fontSize: 8, color: "var(--success)" }}>✓</span>}
        </div>

        {/* Main ≥4 SH slots */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 4, minHeight: isPhone ? 35 : 66, overflow: "hidden",
          borderRadius: 4, padding: 2,
          border: hoveredZone?.semId === sem.id && hoveredZone?.zone === "main"
            ? "1px solid var(--active)" : "1px solid transparent",
          background: hoveredZone?.semId === sem.id && hoveredZone?.zone === "main"
            ? "var(--active-bg)" : "transparent",
        }}
          onDragOver={e => {
            if (!dragInfo || dragInfo.type !== "course") return;
            const c = effectiveCourseMap[dragInfo.id]; if (!c || c.sh < 3) return;
            e.preventDefault(); e.stopPropagation();
            setHoveredZone({ semId: sem.id, zone: "main" }); setHoveredSem(null);
          }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setHoveredZone(null); }}
          onDrop={e => {
            if (!dragInfo || dragInfo.type !== "course") return;
            const c = effectiveCourseMap[dragInfo.id]; if (!c || c.sh < 3) return;
            e.stopPropagation(); setHoveredZone(null); onDrop(e, sem.id);
          }}
        >
          {main4.map(c => <CourseCard key={c.id} course={c} inSem semId={sem.id} />)}
          {Array.from({ length: Math.max(0, 2 - main4.length) }).map((_, i) => (
            <div key={`ms-${i}`} style={{
              height: isPhone ? 35 : 66,
              border: "1px dashed var(--border-slot)", borderRadius: 6, background: tb.bg,
            }} />
          ))}
        </div>

        {/* Other <4 SH (collapsible) */}
        {(others.length > 0 || (dragInfo?.type === "course" && (effectiveCourseMap[dragInfo.id]?.sh ?? 3) <= 2)) && (
          <div style={{ marginTop: 4 }}>
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
              <div style={{
                display: "flex", flexWrap: "wrap", gap: 4, padding: "4px 2px 2px",
                borderTop: "1px solid var(--border-sub)", borderRadius: 4,
                background: hoveredZone?.semId === sem.id && hoveredZone?.zone === "other" ? "var(--active-bg)" : "transparent",
                outline: hoveredZone?.semId === sem.id && hoveredZone?.zone === "other" ? "1px dashed var(--active)" : "none",
              }}
                onDragOver={e => {
                  if (!dragInfo || dragInfo.type !== "course") return;
                  const c = effectiveCourseMap[dragInfo.id]; if (!c || c.sh > 2) return;
                  e.preventDefault(); e.stopPropagation();
                  setHoveredZone({ semId: sem.id, zone: "other" }); setHoveredSem(null);
                }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setHoveredZone(null); }}
                onDrop={e => {
                  if (!dragInfo || dragInfo.type !== "course") return;
                  const c = effectiveCourseMap[dragInfo.id]; if (!c || c.sh > 2) return;
                  e.stopPropagation(); setHoveredZone(null); onDrop(e, sem.id);
                }}
              >
                {others.map(c => <CourseCard key={c.id} course={c} inSem semId={sem.id} />)}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div key={`summer-${year}`} style={{
      display: "flex", alignItems: "flex-start", gap: 8,
      background: rowBg, border: rowBorder, borderRadius: 6,
      padding: "6px 8px", marginBottom: 3,
      opacity: rowOpacity,
      transition: "background 0.12s, border-color 0.12s, opacity 0.15s",
    }}>
      {/* Shared label column */}
      {isPhone ? (
        <div onClick={() => setCurrentSemId(semA.id)} style={{ width: 34, flexShrink: 0, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 1, paddingTop: 2 }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, background: combinedDone ? "var(--bg-surface)" : combinedActive ? "var(--active-bg)" : "transparent", border: combinedDone ? "1px solid var(--success-border)" : combinedActive ? "1px solid var(--active-now-border)" : "1px solid var(--border-2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {combinedDone   && <span style={{ fontSize: 9, color: "var(--success)", fontWeight: 900 }}>✓</span>}
            {combinedActive && <span style={{ fontSize: 9, color: "var(--active)",  fontWeight: 900 }}>▶</span>}
          </span>
          <span style={{ fontSize: 7, fontWeight: 700, color: "var(--text-2)", lineHeight: 1.2 }}>Sm</span>
          <span style={{ fontSize: 7, fontWeight: 500, color: "var(--text-4)", lineHeight: 1.2 }}>{year}</span>
          {combinedSH > 0 && <span style={{ fontSize: 7, fontWeight: 700, color: "var(--success)", lineHeight: 1.2, textAlign: "center" }}>{combinedSH} SH</span>}
        </div>
      ) : (
        <div onClick={() => setCurrentSemId(semA.id)} style={{ width: "clamp(100px,13vw,148px)", flexShrink: 0, cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 1 }}>
            <span style={{ width: 14, height: 14, borderRadius: 3, background: combinedDone ? "var(--bg-surface)" : combinedActive ? "var(--active-bg)" : "transparent", border: combinedDone ? "1px solid var(--success-border)" : combinedActive ? "1px solid var(--active-now-border)" : "1px solid var(--border-2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {combinedDone   && <span style={{ fontSize: 9, color: "var(--success)", fontWeight: 900 }}>✓</span>}
              {combinedActive && <span style={{ fontSize: 9, color: "var(--active)",  fontWeight: 900 }}>▶</span>}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)" }}>Summer {year}</span>
            {combinedActive && (
              <span style={{ fontSize: 9, color: "var(--text-4)", background: "var(--bg-surface-2)", border: "1px solid var(--border-2)", borderRadius: 3, padding: "1px 4px", fontWeight: 700, marginLeft: 3 }}>NOW</span>
            )}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-4)", paddingLeft: 19, marginBottom: 2 }}>May – Aug</div>
          {combinedSH > 0 && <span style={{ fontSize: 10, fontWeight: 700, marginLeft: 19, color: "var(--success)" }}>{combinedSH} SH</span>}
        </div>
      )}

      {/* Two session sub-columns — stacked on phone, side by side on desktop */}
      <div style={{ display: "flex", flexDirection: isPhone ? "column" : "row", gap: 4, flex: 1, minWidth: 0 }}>
        {renderSession(semA)}
        {renderSession(semB)}
      </div>
    </div>
  );
}
