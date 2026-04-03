// ═══════════════════════════════════════════════════════════════════
// SUMMER ROW  — renders sumA + sumB as a single combined visual block
// ═══════════════════════════════════════════════════════════════════
import { usePlanner } from "../context/PlannerContext.jsx";
import { useState, useEffect } from "react";
import { TYPE_BG, COOP_TERMS, INTERNSHIP_TERMS } from "../core/constants.js";
import { getSemSH, getOrderedCourses } from "../core/planModel.js";
import CourseCard from "./CourseCard.jsx";

export default function SummerRow({ semA, semB }) {
  const {
    placements, semOrders, effectiveCourseMap,
    getSemStatus, setCurrentSemId,
    dragInfo, hoveredSem, hoveredZone,
    onDragOver, onDragLeave, onDrop,
    setHoveredZone, setHoveredSem,
    workStartMap, workContMap, workPl,
    internStartMap, internContMap, internPl, setInternPl,
    cardRefs, onDragStart,
    SEMESTERS, SEM_NEXT, SEM_INDEX,
    setWorkPl, pushUndo, isPhone,
    collapseOtherCredits, setCollapseOtherCredits,
  } = usePlanner();

  // Collapsible state for other credits
  const [showOther, setShowOther] = useState(!collapseOtherCredits);

  // Sync local state with global collapseOtherCredits setting
  useEffect(() => {
    setShowOther(!collapseOtherCredits);
  }, [collapseOtherCredits]);

  const year     = semA.id.replace("sumA", "");
  const sems     = [semA, semB].filter(Boolean);
  const combinedDone   = sems.every(s => getSemStatus(s.id) === "completed");
  const combinedActive = sems.some(s => getSemStatus(s.id) === "inprogress");
  const combinedSH     = sems.reduce((sum, s) => sum + getSemSH(s.id, placements, effectiveCourseMap), 0);
  const tb         = TYPE_BG.summer;
  const rowBg      = tb.bg;
  const rowBorder  = combinedActive ? "1px solid var(--active-now-border)" : `1px solid ${tb.border}`;
  const rowOpacity = combinedDone ? 0.9 : 1;

  const removeWork   = wid => { pushUndo(); setWorkPl(p => { const n = { ...p }; delete n[wid]; return n; }); };
  const removeIntern = iid => { pushUndo(); setInternPl(p => { const n = { ...p }; delete n[iid]; return n; }); };

  const sortBySem = entries => entries
    .filter(([, d]) => d?.semId)
    .sort(([, a], [, b]) => (SEM_INDEX[a.semId] ?? 99) - (SEM_INDEX[b.semId] ?? 99));
  const coopNumFor   = id => sortBySem(Object.entries(workPl)).findIndex(([i]) => i === id) + 1;
  const internNumFor = id => sortBySem(Object.entries(internPl)).findIndex(([i]) => i === id) + 1;

  const renderSession = sem => {
    if (!sem) return null;
    const semStatus  = getSemStatus(sem.id);
    const semIsDone  = semStatus === "completed";
    const isSessionA = sem.id.startsWith("sumA");
    const sessionLabel = isSessionA ? "Session A" : "Session B";

    // ── Co-op start card ─────────────────────────────────────────
    const workId     = workStartMap[sem.id];
    const workData   = workId ? workPl[workId] : null;
    const workItem   = workData ? { ...(COOP_TERMS.find(t => t.duration === workData.duration) ?? COOP_TERMS[0]), id: workId, duration: workData.duration } : null;
    if (workItem) {
      return (
        <div key={sem.id} style={{
          flex: 1, minWidth: 0, overflow: "hidden",
          border: "1px solid var(--border-slot)", borderRadius: 4, padding: "4px 5px",
          background: "var(--card-bg)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 5 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: workItem.color }}>{sessionLabel}</span>
            <span style={{ fontSize: 9, color: "var(--text-5)" }}>{sem.sub}</span>
          </div>
          <div
            ref={el => { cardRefs.current[workItem.id] = el; }}
            draggable
            data-drag-id={workItem.id}
            data-drag-type="work"
            data-drag-duration={workItem.duration}
            data-drag-from={sem.id}
            onDragStart={e => onDragStart(e, workItem.id, "work", sem.id, { duration: workItem.duration })}
            style={{
              position: "relative",
              width: "100%", minHeight: 58,
              background: "var(--card-bg)",
              border: `2px solid ${workItem.color}`,
              borderRadius: 6, padding: "8px 28px 8px 14px",
              cursor: "grab", display: "flex", flexDirection: "column", justifyContent: "center",
            }}
          >
            <button
              onClick={e => { e.stopPropagation(); removeWork(workItem.id); }}
              style={{
                position: "absolute", top: 4, right: 6,
                background: "none", border: "none", color: "var(--text-4)",
                cursor: "pointer", fontSize: 12, lineHeight: 1, padding: 0,
              }}
              title="Remove co-op"
            >✕</button>
            <div style={{ fontSize: 13, fontWeight: 900, color: workItem.color, letterSpacing: "0.05em" }}>
              {workItem.label} {coopNumFor(workItem.id)}
            </div>
            <div style={{ fontSize: 9, color: "var(--text-4)", marginTop: 3 }}>
              {workContMap[SEM_NEXT[sem.id]] === workItem.id
                ? `↕ spans into ${SEMESTERS.find(s => s.id === SEM_NEXT[sem.id])?.label} (${workItem.duration}-month block)`
                : `${workItem.duration}-month co-op`}
            </div>
          </div>
        </div>
      );
    }

    // ── Co-op continuation block ──────────────────────────────────
    const contWorkId   = workContMap[sem.id];
    const contWorkData = contWorkId ? workPl[contWorkId] : null;
    const contItem     = contWorkData ? { ...(COOP_TERMS.find(t => t.duration === contWorkData.duration) ?? COOP_TERMS[0]), id: contWorkId, duration: contWorkData.duration } : null;
    if (contItem) {
      return (
        <div key={sem.id} style={{
          flex: 1, minWidth: 0, overflow: "hidden",
          border: "1px solid var(--border-slot)", borderRadius: 4, padding: "4px 5px",
          background: "var(--card-bg)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 5 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: contItem.color }}>{sessionLabel}</span>
            <span style={{ fontSize: 9, color: "var(--text-5)" }}>{sem.sub}</span>
          </div>
          <div style={{
            width: "100%", minHeight: 58,
            border: `2px solid ${contItem.color}`,
            borderRadius: 6, padding: "8px 14px",
            display: "flex", flexDirection: "column", justifyContent: "center",
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: contItem.color }}>↕ {contItem.label} CONT.</div>
            <div style={{ fontSize: 9, color: "var(--text-4)", marginTop: 2 }}>6-month block</div>
          </div>
        </div>
      );
    }

    // ── Internship start card ─────────────────────────────────────
    const internId   = internStartMap[sem.id];
    const internData = internId ? internPl[internId] : null;
    const internTerm = internData ? (INTERNSHIP_TERMS.find(t => t.duration === internData.duration) ?? INTERNSHIP_TERMS[0]) : null;
    if (internTerm) {
      return (
        <div key={sem.id} style={{
          flex: 1, minWidth: 0, overflow: "hidden",
          border: "1px solid var(--border-slot)", borderRadius: 4, padding: "4px 5px",
          background: "var(--card-bg)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 5 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: internTerm.color }}>{sessionLabel}</span>
            <span style={{ fontSize: 9, color: "var(--text-5)" }}>{sem.sub}</span>
          </div>
          <div
            ref={el => { cardRefs.current[internId] = el; }}
            draggable
            data-drag-id={internId}
            data-drag-type="intern"
            data-drag-duration={internData.duration}
            data-drag-from={sem.id}
            onDragStart={e => onDragStart(e, internId, "intern", sem.id, { duration: internData.duration })}
            style={{
              position: "relative",
              width: "100%", minHeight: 58,
              background: "var(--card-bg)",
              border: `2px solid ${internTerm.color}`,
              borderRadius: 6, padding: "8px 28px 8px 14px",
              cursor: "grab", display: "flex", flexDirection: "column", justifyContent: "center",
            }}
          >
            <button
              onClick={e => { e.stopPropagation(); removeIntern(internId); }}
              style={{ position: "absolute", top: 4, right: 6, background: "none", border: "none", color: "var(--text-4)", cursor: "pointer", fontSize: 12, lineHeight: 1, padding: 0 }}
              title="Remove internship"
            >✕</button>
            <div style={{ fontSize: 13, fontWeight: 900, color: internTerm.color, letterSpacing: "0.05em" }}>
              Full-Time Internship {internNumFor(internId)}
            </div>
            <div style={{ fontSize: 9, color: "var(--text-4)", marginTop: 3 }}>
              {internData.duration === 4
                ? `↕ spans into ${SEMESTERS.find(s => s.id === SEM_NEXT[sem.id])?.label}`
                : `${internData.duration}-month internship`}
            </div>
          </div>
        </div>
      );
    }

    // ── Internship continuation block ─────────────────────────────
    const contInternId   = internContMap[sem.id];
    const contInternData = contInternId ? internPl[contInternId] : null;
    const contInternTerm = contInternData ? (INTERNSHIP_TERMS.find(t => t.duration === contInternData.duration) ?? INTERNSHIP_TERMS[0]) : null;
    if (contInternTerm) {
      return (
        <div key={sem.id} style={{
          flex: 1, minWidth: 0, overflow: "hidden",
          border: "1px solid var(--border-slot)", borderRadius: 4, padding: "4px 5px",
          background: "var(--card-bg)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 5 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: contInternTerm.color }}>{sessionLabel}</span>
            <span style={{ fontSize: 9, color: "var(--text-5)" }}>{sem.sub}</span>
          </div>
          <div style={{
            width: "100%", minHeight: 58,
            border: `2px solid ${contInternTerm.color}`,
            borderRadius: 6, padding: "8px 14px",
            display: "flex", flexDirection: "column", justifyContent: "center",
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: contInternTerm.color }}>↕ INTERNSHIP CONT.</div>
            <div style={{ fontSize: 9, color: "var(--text-4)", marginTop: 2 }}>4-month block</div>
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
              onClick={() => {
                setShowOther(v => {
                  setCollapseOtherCredits(v ? false : true);
                  return !v;
                });
              }}
              style={{
                fontSize: 9, color: "var(--text-5)", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 2, textAlign: "left"
              }}
              aria-expanded={showOther}
              title={showOther ? "Hide other credits" : "Show other credits"}
            >
              {showOther
                ? "▼ other credits"
                : (!isPhone && others.length > 0)
                  ? `► ${others.map(c => `${c.subject} ${c.number}`).join(", ")}`
                  : "► other credits"
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
