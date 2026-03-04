// ═══════════════════════════════════════════════════════════════════
// INFO PANEL  — bottom drawer for selected course details
// ═══════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { usePlanner } from "../context/PlannerContext.jsx";
import { REL_STYLE, SEMESTER_TYPES } from "../core/constants.js";
import { NUPATH_LABELS, getOfferedFromTerms } from "../core/courseModel.js";
import { getConnections } from "../core/planModel.js";

export default function InfoPanel() {
  const {
    showPanel, setShowPanel, selectedId, setSelectedId,
    courseMap, allEdges, offeredOverrides, setOfferedOverrides,
    panelHeight, panelResizing, isPhone,
  } = usePlanner();

  // ── InfoPanel nav history (back = Cmd+Z, fwd = Cmd+Shift+Z) ──────
  const navHistory = useRef([]);
  const navFuture  = useRef([]);
  const [, forceRender] = useState(0);

  const navTo = useCallback((newId) => {
    navHistory.current = [...navHistory.current, selectedId];
    navFuture.current  = [];
    forceRender(n => n + 1);
    setSelectedId(newId);
  }, [selectedId, setSelectedId]);

  useEffect(() => {
    const handler = (e) => {
      if (!showPanel) return;
      const isUndo = (e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey;
      const isRedo = (e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey;
      if (isUndo && navHistory.current.length > 0) {
        e.preventDefault(); e.stopImmediatePropagation();
        const prev = navHistory.current[navHistory.current.length - 1];
        navFuture.current  = [...navFuture.current, selectedId];
        navHistory.current = navHistory.current.slice(0, -1);
        forceRender(n => n + 1);
        setSelectedId(prev);
      } else if (isRedo && navFuture.current.length > 0) {
        e.preventDefault(); e.stopImmediatePropagation();
        const next = navFuture.current[navFuture.current.length - 1];
        navHistory.current = [...navHistory.current, selectedId];
        navFuture.current  = navFuture.current.slice(0, -1);
        forceRender(n => n + 1);
        setSelectedId(next);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [showPanel, selectedId, setSelectedId]);

  const selCourse = selectedId ? courseMap[selectedId] : null;
  const selEdges  = selectedId ? getConnections(selectedId, allEdges) : [];

  if (!showPanel || !selCourse) return null;

  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position: "fixed", bottom: 0, left: 0,
        right: 0, // will be overridden by inline style if bank is visible
        background: "var(--bg-surface)",
        borderTop: `2px solid ${selCourse.color}50`,
        zIndex: 50, height: panelHeight, display: "flex", flexDirection: "column",
      }}
    >
      {/* Drag-resize handle */}
      <div
        onMouseDown={e => {
          panelResizing.current = { startY: e.clientY, startH: panelHeight };
          e.preventDefault();
        }}
        onTouchStart={e => {
          panelResizing.current = { startY: e.touches[0].clientY, startH: panelHeight };
          e.stopPropagation();
        }}
        style={{
          height: 10, flexShrink: 0, cursor: "ns-resize",
          display: "flex", alignItems: "center", justifyContent: "center",
          borderBottom: "1px solid var(--border-1)",
        }}
      >
        <div style={{ width: 32, height: 3, borderRadius: 99, background: "var(--border-2)" }} />
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 14px 12px" }}>
        <div style={{ display: "flex", flexDirection: isPhone ? "column" : "row", alignItems: "flex-start", gap: isPhone ? 8 : 14 }}>
          {/* Top row: course info + (desktop: relationships + offered) + close */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14, width: "100%" }}>
            <CourseInfo selCourse={selCourse} navTo={navTo} />

            {!isPhone && selEdges.length > 0 && (
              <RelationshipList selCourse={selCourse} selEdges={selEdges} courseMap={courseMap} />
            )}

            {!isPhone && (
              <OfferedToggles
                selCourse={selCourse}
                offeredOverrides={offeredOverrides}
                setOfferedOverrides={setOfferedOverrides}
              />
            )}

            {/* Close */}
            <button
              onClick={() => { setShowPanel(false); setSelectedId(null); }}
              style={{ background: "transparent", border: "none", color: "var(--text-4)", fontSize: 16, cursor: "pointer", lineHeight: 1, padding: "0 2px", flexShrink: 0 }}
            >✕</button>
          </div>

          {/* Phone: relationships + offered toggles beneath main info */}
          {isPhone && (
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", width: "100%" }}>
              {selEdges.length > 0 && (
                <RelationshipList selCourse={selCourse} selEdges={selEdges} courseMap={courseMap} />
              )}
              <OfferedToggles
                selCourse={selCourse}
                offeredOverrides={offeredOverrides}
                setOfferedOverrides={setOfferedOverrides}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CourseInfo({ selCourse, navTo }) {
  const { courseMap, onDragStart, placements } = usePlanner();
  const [codeHover, setCodeHover] = useState(false);
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, background: selCourse.color, color: "var(--badge-bg)", borderRadius: 3, padding: "2px 8px", fontWeight: 800, letterSpacing: "0.04em" }}>
          {selCourse.subject}
        </span>
        <span
          draggable
          data-drag-id={selCourse.id}
          data-drag-type="course"
          onDragStart={e => onDragStart(e, selCourse.id, "course", null)}
          onMouseEnter={() => setCodeHover(true)}
          onMouseLeave={() => setCodeHover(false)}
          title="drag to place"
          style={{
            fontSize: 14, fontWeight: 800, cursor: "grab", userSelect: "none",
            textDecoration: codeHover ? "underline" : "none",
            textDecorationStyle: "dotted",
            textDecorationColor: "var(--text-6)",
            textUnderlineOffset: 3,
          }}
        >{selCourse.code}</span>
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>{selCourse.title}</span>
        <span style={{ fontSize: 10, color: "var(--text-4)", background: "var(--badge-bg)", border: "1px solid var(--border-1)", borderRadius: 3, padding: "1px 6px" }}>
          {selCourse.sh} SH
        </span>
        {selCourse.scheduleType && (
          <span style={{ fontSize: 9, color: "var(--text-3)", background: "var(--bg-surface)", border: "1px solid var(--border-2)", borderRadius: 3, padding: "1px 6px" }}>
            {selCourse.scheduleType}
          </span>
        )}
        {selCourse.nuPath?.map(np => (
          <span key={np} title={NUPATH_LABELS[np] || np}
            style={{ fontSize: 9, color: "var(--nupath-text)", background: "var(--nupath-bg)", border: "1px solid var(--nupath-border)", borderRadius: 3, padding: "1px 5px", cursor: "default" }}>
            {np}
          </span>
        ))}
      </div>
      {selCourse.desc && (
        <div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.55, marginBottom: 4 }}>
          <DescriptionWithLinks
            text={selCourse.desc}
            courseMap={courseMap}
            placements={placements}
            navTo={navTo}
            onDragStart={onDragStart}
          />
        </div>
      )}
      {selCourse.prereqs?.length > 0 && (
        <div style={{ fontSize: 10, color: "var(--text-4)", background: "var(--badge-bg)", border: "1px solid var(--border-1)", borderRadius: 4, padding: "4px 8px", marginTop: 4, lineHeight: 1.9 }}>
          <span style={{ color: "var(--error)", fontWeight: 700 }}>Prereqs: </span>
          <PrereqChips nodes={selCourse.prereqs} courseMap={courseMap} navTo={navTo} onDragStart={onDragStart} />
        </div>
      )}
    </div>
  );
}

function DescriptionWithLinks({ text, courseMap, placements, navTo, onDragStart }) {
  if (!text) return null;
  const COURSE_RE = /\b([A-Z]{2,5})\s+(\d{4}[A-Z0-9]*)\b/g;
  const parts = [];
  let last = 0, m;
  while ((m = COURSE_RE.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: "text", val: text.slice(last, m.index) });
    const id = m[1] + m[2];
    const c  = courseMap[id];
    const placed = c && placements[id] !== undefined;
    parts.push({ type: "course", id, raw: m[0], c, placed });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: "text", val: text.slice(last) });

  return (
    <>
      {parts.map((p, i) => {
        if (p.type === "text") return <span key={i}>{p.val}</span>;
        if (!p.c) return <span key={i}>{p.raw}</span>;
        const isPlaced = p.placed;
        return (
          <span
            key={i}
            draggable={!isPlaced}
            data-drag-id={!isPlaced ? p.id : undefined}
            data-drag-type={!isPlaced ? "course" : undefined}
            onDragStart={!isPlaced ? (e => onDragStart(e, p.id, "course", null)) : undefined}
            onClick={e => { e.stopPropagation(); navTo(p.id); }}
            title={isPlaced ? `${p.c.title} (already placed) — click to view` : `${p.c.title} — drag to place or click to view`}
            style={{
              cursor: isPlaced ? "pointer" : "grab",
              color: "var(--text-2)", fontWeight: 600,
              textDecoration: "underline",
              textDecorationStyle: "dotted",
              textDecorationColor: isPlaced ? "var(--text-6)" : "var(--text-5)",
              textUnderlineOffset: 2,
            }}
          >{p.raw}</span>
        );
      })}
    </>
  );
}

function PrereqChips({ nodes, courseMap, navTo, onDragStart }) {
  if (!Array.isArray(nodes) || nodes.length === 0) return <span>—</span>;
  return (
    <span>
      {nodes.map((item, i) => (
        <PrereqNode key={i} item={item} courseMap={courseMap} navTo={navTo} onDragStart={onDragStart} />
      ))}
    </span>
  );
}

function PrereqNode({ item, courseMap, navTo, onDragStart }) {
  const [hov, setHov] = useState(false);
  if (typeof item === "string") {
    return <span style={{ color: "var(--text-5)", padding: "0 2px" }}>{item}</span>;
  }
  if (Array.isArray(item)) {
    return (
      <span>
        {item.map((sub, i) => (
          <PrereqNode key={i} item={sub} courseMap={courseMap} navTo={navTo} onDragStart={onDragStart} />
        ))}
      </span>
    );
  }
  if (item && item.subject && item.number) {
    const id = `${item.subject.toUpperCase()}${item.number}`;
    const c  = courseMap[id];
    return (
      <span
        draggable
        onDragStart={e => { e.stopPropagation(); onDragStart(e, id, "course", null); }}
        onClick={e => { e.stopPropagation(); navTo(id); }}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        title={c ? `${c.title} — click to view, drag to place` : id}
        style={{
          display: "inline-block", fontSize: 9, fontWeight: 600,
          color: "var(--text-2)", background: "var(--bg-surface-2)",
          border: `1px solid ${hov ? "var(--text-4)" : "var(--border-2)"}`,
          borderRadius: 5, padding: "1px 6px", cursor: "pointer",
          userSelect: "none", margin: "0 1px",
          transition: "border-color 0.1s",
        }}
      >
        {c ? c.code : `${item.subject} ${item.number}`}
      </span>
    );
  }
  return null;
}

function RelationshipList({ selCourse, selEdges, courseMap }) {
  return (
    <div style={{ width: 240, flexShrink: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.06em", marginBottom: 5 }}>
        RELATIONSHIPS
      </div>
      <div style={{ overflowY: "auto", maxHeight: 220 }}>
        {selEdges.map((rel, i) => {
          const isOut = rel.from === selCourse.id;
          const other = courseMap[isOut ? rel.to : rel.from];
          const rs    = REL_STYLE[rel.type];
          return (
            <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 5, marginBottom: 3 }}>
              <span style={{ fontSize: 11, color: rs?.color, fontWeight: 700, width: 14 }}>
                {isOut ? "→" : "←"}
              </span>
              <span style={{ fontSize: 8, background: `${rs?.color}20`, color: rs?.color, borderRadius: 3, padding: "1px 4px", whiteSpace: "nowrap" }}>
                {rs?.label}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-2)" }}>
                {other?.code || (isOut ? rel.to : rel.from)}
              </span>
              <span style={{ fontSize: 9, color: "var(--text-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {other?.title || ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OfferedToggles({ selCourse, offeredOverrides, setOfferedOverrides }) {
  const defaults = getOfferedFromTerms(selCourse.terms) ?? ["fall", "spring"];

  return (
    <div style={{ width: 155, flexShrink: 0 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.06em", marginBottom: 6 }}>
        OFFERED IN
      </div>
      {SEMESTER_TYPES.map(type => {
        const active = (offeredOverrides[selCourse.id] ?? defaults).includes(type);
        const label  = { fall: "Fall", spring: "Spring", sumA: "Summer A", sumB: "Summer B" }[type];
        return (
          <label key={type} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginBottom: 4, userSelect: "none" }}
            onClick={e => e.stopPropagation()}>
            <input type="checkbox" checked={active}
              onChange={() => {
                setOfferedOverrides(prev => {
                  const cur  = prev[selCourse.id] ?? defaults;
                  const next = active ? cur.filter(t => t !== type) : [...cur, type];
                  return { ...prev, [selCourse.id]: next };
                });
              }}
              style={{ accentColor: "var(--active)", cursor: "pointer" }}
            />
            <span style={{ fontSize: 10, color: active ? "var(--text-2)" : "var(--text-5)" }}>{label}</span>
          </label>
        );
      })}
      <div style={{ fontSize: 8.5, color: "var(--text-5)", fontStyle: "italic", marginTop: 4, lineHeight: 1.4 }}>
        Availability may vary by year — override with checkboxes if needed.
      </div>
    </div>
  );
}
