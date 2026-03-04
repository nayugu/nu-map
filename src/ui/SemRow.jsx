// ═══════════════════════════════════════════════════════════════════
// SEM ROW  — renders a single non-summer semester row (fall/spring/special)
// ═══════════════════════════════════════════════════════════════════
import { usePlanner } from "../context/PlannerContext.jsx";
import { TYPE_BG, WORK_TERMS } from "../core/constants.js";
import { hexRgb, getSemSH, getOrderedCourses } from "../core/planModel.js";
import CourseCard from "./CourseCard.jsx";

export default function SemRow({ sem }) {
  const {
    placements, semOrders, courseMap,
    getSemStatus, setCurrentSemId,
    dragInfo, hoveredSem, hoveredZone,
    onDragOver, onDragLeave, onDrop,
    setHoveredZone, setHoveredSem,
    workStartMap, workContMap,
    cardRefs, onDragStart,
    SEMESTERS, SEM_NEXT,
    setWorkPl, pushUndo,
  } = usePlanner();

  const semStatus  = getSemStatus(sem.id);
  const isDone     = semStatus === "completed";
  const isActive   = semStatus === "inprogress";
  const workId     = workStartMap[sem.id];
  const contWorkId = workContMap[sem.id];
  const workItem   = workId     ? WORK_TERMS.find(w => w.id === workId)     : null;
  const contItem   = contWorkId ? WORK_TERMS.find(w => w.id === contWorkId) : null;
  const courseIds  = getOrderedCourses(sem.id, placements, semOrders, courseMap);
  const crs        = courseIds.map(id => courseMap[id]).filter(Boolean);
  const sh         = getSemSH(sem.id, placements, courseMap);
  const mainSlots  = (sem.type === "fall" || sem.type === "spring") ? 4
                   : sem.type === "summer" ? 2 : null;
  const main4      = crs.filter(c => c.sh >= 4);
  const others     = crs.filter(c => c.sh < 4);
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
    rowBg        = isHov ? "var(--active-hov-bg)" : workItem ? `rgba(${hexRgb(workItem.color)},0.06)` : tb.bg;
    rowBorder    = `1px solid ${isHov ? "var(--active)" : workItem ? `${workItem.color}50` : tb.border}`;
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

  // Continuation row (work term spanning from previous semester)
  if (contItem) {
    return (
      <div key={sem.id}
        onClick={() => setCurrentSemId(sem.id)}
        style={{
          display: "flex", alignItems: "stretch", marginBottom: 3, cursor: "pointer",
          background: `var(--card-bg)`,
          border: isActive ? "2px solid var(--active)" : `1px solid ${contItem.color}`,
          borderRadius: 6, padding: "6px 10px",
          opacity: isDone ? 0.9 : 1,
          boxShadow: isActive ? "var(--shadow-active-row)" : "none",
          transition: "opacity 0.15s",
        }}
      >
        <div style={{ width: "clamp(100px,13vw,148px)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
            {statusDot}
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-3)" }}>
              {sem.label}
            </span>
            {isActive && (
              <span style={{ fontSize: 9, color: "var(--text-4)", background: "var(--bg-surface-2)", border: "1px solid var(--border-2)", borderRadius: 3, padding: "1px 4px", fontWeight: 700 }}>
                NOW
              </span>
            )}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-4)", paddingLeft: 19 }}>{sem.sub}</div>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, paddingLeft: 8 }}>
          <div style={{ width: 3, alignSelf: "stretch", background: contItem.color, borderRadius: 2 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: contItem.color }}>↕ {contItem.label} CONTINUES</div>
            <div style={{ fontSize: 10, color: "var(--text-4)" }}>6-month block · drag to move</div>
          </div>
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
      </div>

      {/* Course slots */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, flex: 1 }}>
        {workItem ? (
          // Full-width work-term card
          <div
            ref={el => { cardRefs.current[workItem.id] = el; }}
            draggable
            data-drag-id={workItem.id}
            data-drag-type="work"
            data-drag-from={sem.id}
            onDragStart={e => onDragStart(e, workItem.id, "work", sem.id)}
            style={{
              flex: 1, minHeight: 58, minWidth: 200,
              position: "relative",
              background: `var(--card-bg)`,
              border: `2px solid ${workItem.color}`,
              borderRadius: 6, padding: "8px 28px 8px 14px", cursor: "grab",
              display: "flex", flexDirection: "column", justifyContent: "center",
            }}
          >
            <button
              onClick={e => { e.stopPropagation(); pushUndo(); setWorkPl(p => { const n = { ...p }; delete n[workItem.id]; return n; }); }}
              style={{
                position: "absolute", top: 4, right: 8,
                background: "none", border: "none", color: "var(--text-4)",
                cursor: "pointer", fontSize: 12, lineHeight: 1, padding: 0,
              }}
              title="Remove co-op"
            >✕</button>
            <div style={{ fontSize: 14, fontWeight: 900, color: workItem.color, letterSpacing: "0.06em" }}>
              {workItem.label}
            </div>
            {SEM_NEXT[sem.id] && (
              <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 4 }}>
                ↕ Spans into {SEMESTERS.find(s => s.id === SEM_NEXT[sem.id])?.label} (6-month block)
              </div>
            )}
          </div>

        ) : mainSlots === null ? (
          // Special / incoming — no slot limits, always-visible append zone at end
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, flex: 1, alignItems: "flex-start" }}>
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
                {hoveredZone?.semId === sem.id && hoveredZone?.zone === "append" ? "drop to add" : "+ add"}
              </span>
            </div>
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
                display: "grid", gridTemplateColumns: `repeat(${mainSlots}, 1fr)`, gap: 4, overflow: "hidden",
                borderRadius: 6, padding: 3, minHeight: 76,
                border: hoveredZone?.semId === sem.id && hoveredZone?.zone === "main"
                  ? "1px solid var(--active)" : "1px solid transparent",
                background: hoveredZone?.semId === sem.id && hoveredZone?.zone === "main"
                  ? "var(--active-bg)" : "transparent",
                transition: "border-color 0.1s, background 0.1s",
              }}
            >
              {main4.map(c => <CourseCard key={c.id} course={c} inSem semId={sem.id} />)}
              {Array.from({ length: Math.max(0, mainSlots - main4.length) }).map((_, i) => (
                <div key={`ms-${i}`} style={{ minHeight: 70, border: "1px dashed var(--border-slot)", borderRadius: 6, background: tb.bg }} />
              ))}
            </div>

            {/* Override zone — only visible when all main slots full + dragging a ≥4 SH course */}
            {main4.length >= mainSlots && dragInfo?.type === "course" && (courseMap[dragInfo.id]?.sh ?? 0) >= 4 && (
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
                <span style={{ fontSize: 9, color: "var(--text-4)", letterSpacing: "0.04em" }}>+ override limit</span>
              </div>
            )}

            {/* Other <4 SH zone */}
            {(others.length > 0 || (dragInfo?.type === "course" && (courseMap[dragInfo.id]?.sh ?? 4) < 4)) && (
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
                  marginTop: 5, padding: "5px 4px 4px",
                  borderTop: "1px solid var(--border-sub)", borderRadius: 4,
                  minHeight: others.length === 0 ? 34 : "auto",
                background: hoveredZone?.semId === sem.id && hoveredZone?.zone === "other" ? "var(--active-bg)" : "transparent",
                outline:    hoveredZone?.semId === sem.id && hoveredZone?.zone === "other" ? "1px dashed var(--active)" : "none",
                  transition: "background 0.1s",
                }}
              >
                <span style={{ fontSize: 10, color: "var(--text-5)", width: "100%", margin: "0 0 2px 1px" }}>other credits</span>
                {others.map(c => <CourseCard key={c.id} course={c} inSem semId={sem.id} />)}
                {others.length === 0 && (
                  <span style={{ fontSize: 9, color: "var(--text-5)", fontStyle: "italic", alignSelf: "center" }}>
                    drop &lt;4 SH here
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
