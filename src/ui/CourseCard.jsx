// ═══════════════════════════════════════════════════════════════════
// COURSE CARD  — individual draggable course tile
// ═══════════════════════════════════════════════════════════════════
import { useState } from "react";
import { usePlanner }     from "../context/PlannerContext.jsx";
import { usePort }        from "../context/InstitutionContext.jsx";
import { ICreditSystem }  from "../ports/ICreditSystem.js";
import { ICalendar }      from "../ports/ICalendar.js";
import { REL_STYLE } from "../core/constants.js";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useTranslatedText } from "../context/TranslationContext.jsx";

/**
 * @param {object} course   - normalised course object
 * @param {boolean} inSem   - true when rendered inside the timeline
 * @param {string|null} semId - semester id (null when in bank)
 */
export default function CourseCard({ course, inSem, semId, noSubject = false }) {
  const {
    selectedId, setSelectedId, setShowPanel,
    connectedIds, prereqViolations, coreqViolations,
    dragInfo, hoveredCardId, setHoveredCardId,
    getSemStatus, offeredOverrides, SEMESTERS,
    starredIds, toggleStar,
    onDragStart, onDropOnCard, cardRefs,
    isPhone, shOverrides, setShOverride,
  } = usePlanner();
  const creditSystem = usePort(ICreditSystem);
  const calendar     = usePort(ICalendar);
  const { t }        = useLanguage();
  const title        = useTranslatedText(course.title);

  const [editingSh, setEditingSh] = useState(false);

  const isSel         = selectedId === course.id;
  const relType       = connectedIds[course.id];
  const isConn        = !!relType;
  const isViolated    = prereqViolations.has(course.id);
  const violationType = prereqViolations.get(course.id);
  const coreqViol     = inSem ? coreqViolations.get(course.id) : undefined;
  const isDone        = inSem && semId ? getSemStatus(semId) === "completed" : false;
  const hasSel        = selectedId !== null;
  const isCardHov     = hoveredCardId === course.id && dragInfo?.id !== course.id;

  // Offered-semester warning — probability-based (≤ 50% triggers ⚠).
  // Explicit override in offeredOverrides[course.id][semTypeId] takes precedence:
  //   true  = force-offered (suppress warning)
  //   false = force-not-offered (always warn)
  //   absent = auto: warn only when historical probability ≤ 0.5
  const semMeta    = semId ? SEMESTERS.find(s => s.id === semId) : null;
  const semOffType = inSem ? semMeta?.semTypeId ?? null : null;
  let notOffered = false;
  if (inSem && semOffType && semMeta?.type !== "special") {
    const rawOvr = offeredOverrides[course.id];
    const semOvr = (rawOvr && !Array.isArray(rawOvr)) ? rawOvr[semOffType] : undefined;
    if (semOvr === false) {
      notOffered = true;
    } else if (semOvr !== true) {
      const entries = Object.entries(course.termHistory ?? {})
        .filter(([code]) => calendar.decodeTermCode(code) === semOffType);
      if (entries.length > 0) {
        notOffered = entries.filter(([, v]) => v).length / entries.length <= 0.5;
      }
    }
  }

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

  // ── Mobile: bank card — code + star only ────────────────────
  if (isPhone && !inSem) {
    return (
      <div
        draggable
        data-drag-id={course.id}
        data-drag-type="course"
        onDragStart={e => onDragStart(e, course.id, "course", null)}
        onClick={e => {
          e.stopPropagation();
          if (selectedId === course.id) { setSelectedId(null); setShowPanel(false); }
          else { setSelectedId(course.id); setShowPanel(true); }
        }}
        style={{
          position: "relative",
          background: isCardHov ? "var(--card-bg-hov)" : "var(--card-bg)",
          border: `2px solid ${borderColor}`,
          borderRadius: 6, padding: "2px 5px 2px 28px",
          cursor: "grab", userSelect: "none", touchAction: "manipulation",
          display: "flex", alignItems: "center", minHeight: 18,
          opacity: dimmed ? 0.35 : 1,
          transition: "opacity 0.15s, border-color 0.15s, background 0.1s",
          boxShadow: isSel ? "inset 0 -3px 0 #999" : isCardHov ? "var(--shadow-card-hov)" : "none",
        }}
      >
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: course.color, borderRadius: "4px 0 0 4px" }} />
        <button
          onClick={e => { e.stopPropagation(); toggleStar(course.id); }}
          title={starredIds.has(course.id) ? t("course.star.remove") : t("course.star.save")}
          style={{
            position: "absolute", left: 4, top: 0, bottom: 0, width: 26,
            background: starredIds.has(course.id) ? "var(--warn-bg)" : "transparent",
            border: "none", padding: 0, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, lineHeight: 1,
            color: starredIds.has(course.id) ? "var(--warn-bright)" : "var(--text-5)",
          }}
        >{starredIds.has(course.id) ? "★" : "☆"}</button>
        <span style={{ fontSize: 8, fontWeight: 800, color: course.color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {noSubject ? course.code.replace(/^[A-Z]+ /, "") : course.code}
        </span>
      </div>
    );
  }

  // ── Phone: planner card ── code + SH, no title ──────────────
  if (isPhone && inSem) {
    return (
      <div
        ref={el => { cardRefs.current[course.id] = el; }}
        draggable
        data-drag-id={course.id}
        data-drag-type="course"
        data-drag-from={semId}
        onDragStart={e => onDragStart(e, course.id, "course", semId)}
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
          position: "relative",
          background: orderViolBg ? "var(--card-bg-viol)" : isCardHov ? "var(--card-bg-hov)" : "var(--card-bg)",
          border: `2px solid ${borderColor}`,
          borderRadius: 5, padding: "1px 4px 1px 8px",
          cursor: "grab", userSelect: "none", touchAction: "manipulation",
          display: "flex", alignItems: "center", gap: 3,
          minHeight: 17, minWidth: 0, overflow: "hidden",
          opacity: dimmed ? 0.35 : 1,
          transition: "opacity 0.15s, border-color 0.15s, background 0.1s",
          boxShadow: isSel ? "inset 0 -2px 0 #999" : isCardHov ? "var(--shadow-card-hov)" : "none",
        }}
      >
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: course.color, borderRadius: "3px 0 0 3px" }} />
        {/* Shrink code + SH when a warning icon is present so code is always readable */}
        <span style={{ fontSize: (isViolated || notOffered || coreqViol) ? 8 : 10, fontWeight: 800, color: course.color, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {course.code}
        </span>
        <span style={{ fontSize: (isViolated || notOffered || coreqViol) ? 7 : 10, color: "var(--text-4)", background: "var(--badge-bg)", borderRadius: 3, padding: "1px 3px", flexShrink: 0 }}>
          {shOverrides[course.id] ?? course.sh}
        </span>
        {(isViolated || notOffered || coreqViol) && (
          <span style={{ fontSize: 11, color: isViolated ? "var(--error-text)" : "var(--warn)", flexShrink: 0 }}>
            {isViolated && violationType === "order" ? "⚡" : isViolated ? "!" : notOffered ? "⚠" : "⚡"}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      ref={el => { if (inSem) cardRefs.current[course.id] = el; }}
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
        flex: inSem ? "1 1 110px" : "1 1 0%", minWidth: 0, minHeight: 58, flexShrink: 1, overflow: "hidden",
        position: "relative",
        background: orderViolBg ? "var(--card-bg-viol)" : isCardHov ? "var(--card-bg-hov)" : "var(--card-bg)",
        border: `2px solid ${borderColor}`,
        borderRadius: 6,
        padding: inSem ? "4px 6px 4px 10px" : "4px 6px 4px 30px",
        cursor: "grab", userSelect: "none",
        touchAction: "manipulation",
        opacity: dimmed ? 0.35 : 1,
        transition: "opacity 0.15s, border-color 0.15s, background 0.1s",
        boxShadow: isSel          ? "inset 0 -4px 0 #999"
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
          title={starredIds.has(course.id) ? t("course.star.remove") : t("course.star.save")}
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
        display: "flex", alignItems: "baseline", gap: 3,
      }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{course.code}</span>
        {course.isCps && <span style={{ fontWeight: 500, fontSize: 8, color: "var(--text-4)", flexShrink: 0 }}>· CPS</span>}
      </div>

      {/* Title */}
      <div style={{
        fontSize: 10, color: "var(--text-3)", lineHeight: 1.25,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 2,
      }}>
        {title || <span style={{ color: "var(--text-5)", fontStyle: "italic" }}>{t("course.no.title")}</span>}
      </div>

      {/* Badges */}
      <div style={{ display: "flex", gap: 3, flexWrap: "wrap", alignItems: "center" }}>
        {course.shMax ? (
          editingSh ? (
            <input
              type="number" autoFocus
              defaultValue={shOverrides[course.id] ?? course.sh}
              min={course.shMin ?? course.sh} max={course.shMax} step={1}
              style={{ width: 38, fontSize: 9, padding: "1px 3px", borderRadius: 3,
                border: "1px solid var(--active)", background: "var(--badge-bg)",
                color: "var(--text)", fontWeight: 700 }}
              onClick={e => e.stopPropagation()}
              onKeyDown={e => {
                if (e.key === "Escape") { setEditingSh(false); return; }
                if (e.key === "Enter") {
                  const v = parseInt(e.target.value, 10);
                  const lo = course.shMin ?? course.sh, hi = course.shMax;
                  if (!isNaN(v) && v >= lo && v <= hi) setShOverride(course.id, v);
                  setEditingSh(false);
                }
              }}
              onBlur={e => {
                const v = parseInt(e.target.value, 10);
                const lo = course.shMin ?? course.sh, hi = course.shMax;
                if (!isNaN(v) && v >= lo && v <= hi) setShOverride(course.id, v);
                setEditingSh(false);
              }}
            />
          ) : (
            <span
              onClick={e => { e.stopPropagation(); setEditingSh(true); }}
              title={t("course.tooltip.variable-sh", { min: course.shMin ?? course.sh, max: course.shMax, unit: creditSystem.getUnitName() })}
              style={{ fontSize: 9, color: "var(--active)", background: "var(--badge-bg)",
                borderRadius: 3, padding: "1px 4px", cursor: "text",
                borderBottom: "1px dashed var(--active)", userSelect: "none" }}
            >
              {shOverrides[course.id] ?? course.sh}/{course.shMax} {creditSystem.getUnitName()}
            </span>
          )
        ) : (
          <span style={{ fontSize: 9, color: "var(--text-4)", background: "var(--badge-bg)", borderRadius: 3, padding: "1px 4px" }}>
            {course.sh} {creditSystem.getUnitName()}
          </span>
        )}
        {isViolated && violationType === "order" && (
          <span title={t("course.tooltip.prereq.order")}
            style={{ fontSize: 9, fontWeight: 700, color: "var(--error-text)", lineHeight: 1 }}>⚡</span>
        )}
        {isViolated && violationType === "missing" && (
          <span title={t("course.tooltip.prereq.missing")}
            style={{ fontSize: 9, fontWeight: 700, color: "var(--error-text)", background: "var(--error-bg)", borderRadius: 3, padding: "1px 3px", lineHeight: 1 }}>
            {t("course.badge.prereq")}
          </span>
        )}
        {coreqViol === "alone" && (
          <span title={t("course.tooltip.coreq.alone")}
            style={{ fontSize: 9, fontWeight: 700, color: "var(--warn)", background: "var(--warn-bg)", border: "1px solid var(--warn-bright)", borderRadius: 3, padding: "1px 3px", lineHeight: 1 }}>
            {t("course.badge.coreq.alone")}
          </span>
        )}
        {coreqViol === "sep" && (
          <span title={t("course.tooltip.coreq.sep")}
            style={{ fontSize: 9, fontWeight: 700, color: "var(--warn)", background: "var(--warn-bg)", border: "1px solid var(--warn-bright)", borderRadius: 3, padding: "1px 3px", lineHeight: 1 }}>
            {t("course.badge.coreq.sep")}
          </span>
        )}
        {notOffered && (() => {
          // Build a probability hint from termHistory if available
          const hist    = course.termHistory ?? {};
          const entries = Object.entries(hist).filter(([c]) => calendar.decodeTermCode(c) === semOffType);
          const tip = entries.length > 0
            ? `${course.code}: offered in ${entries.filter(([,v]) => v).length}/${entries.length} past ${semOffType} terms — override in panel`
            : `${course.code} may not be offered in ${semOffType} — override in panel`;
          return (
            <span title={tip}
              style={{ fontSize: 9, fontWeight: 700, color: "var(--warn)", background: "var(--warn-bg)", borderRadius: 3, padding: "1px 4px" }}>
              {t("course.avail.badge")}
            </span>
          );
        })()}
      </div>
    </div>
  );
}
