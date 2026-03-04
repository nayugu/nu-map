// ═══════════════════════════════════════════════════════════════════
// COURSE CARD  — individual draggable course tile
// ═══════════════════════════════════════════════════════════════════
import { useState } from "react";
import { usePlanner } from "../context/PlannerContext.jsx";
import { REL_STYLE, SEMESTER_TYPES } from "../core/constants.js";
import { getOfferedFromTerms, getSemOfferedType } from "../core/courseModel.js";

/**
 * @param {object} course   - normalised course object
 * @param {boolean} inSem   - true when rendered inside the timeline
 * @param {string|null} semId - semester id (null when in bank)
 */
export default function CourseCard({ course, inSem, semId }) {
  const {
    selectedId, setSelectedId, setShowPanel,
    connectedIds, prereqViolations, coreqViolations,
    dragInfo, hoveredCardId, setHoveredCardId,
    getSemStatus, offeredOverrides, SEMESTERS,
    starredIds, toggleStar,
    onDragStart, onDropOnCard, cardRefs,
  } = usePlanner();

  const isSel         = selectedId === course.id;
  const relType       = connectedIds[course.id];
  const isConn        = !!relType;
  const isViolated    = prereqViolations.has(course.id);
  const violationType = prereqViolations.get(course.id);
  const coreqViol     = inSem ? coreqViolations.get(course.id) : undefined;
  const isDone        = inSem && semId ? getSemStatus(semId) === "completed" : false;
  const hasSel        = selectedId !== null;
  const isCardHov     = hoveredCardId === course.id && dragInfo?.id !== course.id;

  // Offered-semester warning
  const semOffType    = inSem && semId ? getSemOfferedType(semId) : null;
  const semMeta       = semId ? SEMESTERS.find(s => s.id === semId) : null;
  const offeredList   = offeredOverrides[course.id]
    ?? getOfferedFromTerms(course.terms)
    ?? ["fall", "spring"];
  const notOffered = inSem && semOffType && semMeta?.type !== "special" && !offeredList.includes(semOffType);

  let borderColor = isCardHov ? "var(--active)" : "var(--border-card)";
  if (coreqViol)                                                borderColor = "var(--warn-bright)";  // always wins
  else if (notOffered)                                          borderColor = "var(--warn-bright)";
  else if (isConn && relType === "corequisite" && coreqViol)    borderColor = "var(--warn-bright)";
  else if (isConn && relType === "corequisite")                 borderColor = REL_STYLE.corequisite.color;
  else if (isViolated)                                          borderColor = violationType === "order" ? "var(--error)" : "var(--error-border-2)";
  else if (isConn)                                              borderColor = REL_STYLE[relType]?.color ?? "var(--active)";

  // Red background tint for ordering violations (prereq placed after the course)
  const orderViolBg = inSem && violationType === "order";

  const dimmed = hasSel && !isSel && !isConn;
  const [isMouseHov, setIsMouseHov] = useState(false);

  return (
    <div
      ref={el => { cardRefs.current[course.id] = el; }}
      draggable
      data-drag-id={course.id}
      data-drag-type="course"
      data-drag-from={inSem ? semId : undefined}
      onDragStart={e => onDragStart(e, course.id, "course", inSem ? semId : null)}
      onMouseEnter={() => setIsMouseHov(true)}
      onMouseLeave={() => setIsMouseHov(false)}
      onDragOver={e => {
        if (!dragInfo || dragInfo.type !== "course" || dragInfo.id === course.id || !inSem) return;
        e.preventDefault(); e.stopPropagation();
        setHoveredCardId(course.id);
      }}
      onDragLeave={() => setHoveredCardId(null)}
      onDrop={e => inSem ? onDropOnCard(e, course.id, semId) : undefined}
      onClick={e => {
        e.stopPropagation();
        if (selectedId === course.id) { setSelectedId(null); setShowPanel(false); }
        else { setSelectedId(course.id); setShowPanel(true); }
      }}
      style={{
        flex: "1 1 110px", ...(inSem ? { minWidth: 0, overflow: "hidden" } : { maxWidth: 160 }), minHeight: 58, flexShrink: 0,
        position: "relative",
        background: orderViolBg ? "var(--card-bg-viol)" : isCardHov ? "var(--card-bg-hov)" : "var(--card-bg)",
        border: `2px solid ${borderColor}`,
        borderRadius: 6,
        padding: inSem ? "4px 6px 4px 10px" : "4px 6px 4px 30px",
        cursor: "grab", userSelect: "none",
        touchAction: "manipulation",
        opacity: dimmed ? 0.35 : 1,
        transition: "opacity 0.15s, border-color 0.15s, background 0.1s",
        boxShadow: isSel          ? "inset 0 -4px 0 #1a1a1a"
                 : isConn         ? "var(--shadow-card-conn)"
                 : isCardHov      ? "var(--shadow-card-hov)"
                 : isMouseHov     ? "inset 0 -3px 0 rgba(0,0,0,0.14)"
                 : "none",
      }}
    >
      {/* Subject colour stripe */}
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: 4,
        background: course.color, borderRadius: "4px 0 0 4px",
      }} />

      {/* Star toggle — bank cards only */}
      {!inSem && (
        <button
          onClick={e => { e.stopPropagation(); toggleStar(course.id); }}
          title={starredIds.has(course.id) ? "Remove from saved" : "Save course"}
          style={{
            position: "absolute", left: 4, top: 0, bottom: 0, width: 24,
            background: starredIds.has(course.id) ? "var(--warn-bg)" : "transparent",
            border: "none", padding: 0, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, lineHeight: 1,
            color: starredIds.has(course.id) ? "var(--warn-bright)" : "var(--text-5)",
            transition: "color 0.12s, background 0.12s",
          }}
        >
          {starredIds.has(course.id) ? "★" : "☆"}
        </button>
      )}

      {/* Course code */}
      <div style={{
        fontSize: 11, fontWeight: 800, color: course.color,
        letterSpacing: "0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>
        {course.code}
      </div>

      {/* Title */}
      <div style={{
        fontSize: 10, color: "var(--text-3)", lineHeight: 1.25,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 2,
      }}>
        {course.title || <span style={{ color: "var(--text-5)", fontStyle: "italic" }}>No title</span>}
      </div>

      {/* Badges */}
      <div style={{ display: "flex", gap: 3, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 9, color: "var(--text-4)", background: "var(--badge-bg)", borderRadius: 3, padding: "1px 4px" }}>
          {course.sh} SH
        </span>
        {isViolated && violationType === "order" && (
          <span title="Prerequisite is in the same or a later semester"
            style={{ fontSize: 9, fontWeight: 700, color: "var(--error-text)", lineHeight: 1 }}>⚡</span>
        )}
        {isViolated && violationType === "missing" && (
          <span title="Prerequisite not yet placed in plan"
            style={{ fontSize: 9, fontWeight: 700, color: "var(--error-text)", background: "var(--error-bg)", borderRadius: 3, padding: "1px 3px", lineHeight: 1 }}>
            ! prereq
          </span>
        )}
        {coreqViol === "alone" && (
          <span title="Corequisite partner is not placed — both must be in the plan"
            style={{ fontSize: 9, fontWeight: 700, color: "var(--warn)", background: "var(--warn-bg)", border: "1px solid var(--warn-bright)", borderRadius: 3, padding: "1px 3px", lineHeight: 1 }}>
            ! coreq
          </span>
        )}
        {coreqViol === "sep" && (
          <span title="Corequisite must be in the same semester"
            style={{ fontSize: 9, fontWeight: 700, color: "var(--warn)", background: "var(--warn-bg)", border: "1px solid var(--warn-bright)", borderRadius: 3, padding: "1px 3px", lineHeight: 1 }}>
            ⚡ coreq
          </span>
        )}
        {notOffered && (
          <span title={`${course.code} may not be offered in ${semOffType} — toggle in panel`}
            style={{ fontSize: 9, fontWeight: 700, color: "var(--warn)", background: "var(--warn-bg)", borderRadius: 3, padding: "1px 4px" }}>
            ⚠ avail?
          </span>
        )}
      </div>
    </div>
  );
}
