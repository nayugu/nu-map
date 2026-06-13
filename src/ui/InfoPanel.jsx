// ═══════════════════════════════════════════════════════════════════
// INFO PANEL  — bottom drawer for selected course details
// ═══════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { usePlanner } from "../context/PlannerContext.jsx";
import { usePort }                  from "../context/InstitutionContext.jsx";
import { IAttributeSystem }         from "../ports/IAttributeSystem.js";
import { ICreditSystem }            from "../ports/ICreditSystem.js";
import { ICalendar }                from "../ports/ICalendar.js";
import { ICourseCatalog }           from "../ports/ICourseCatalog.js";
import { REL_STYLE } from "../core/constants.js";
import { getConnections } from "../core/planModel.js";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useTranslation, useCourseTranslation, TText } from "../context/TranslationContext.jsx";

export default function InfoPanel() {
  const {
    showPanel, setShowPanel, selectedId, setSelectedId,
    courseMap, allEdges, offeredOverrides, setOfferedOverrides,
    panelHeight, panelResizing, isPhone, isMobile,
    showUnlocks, bankWidth, showPalette,
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
        position: "fixed", bottom: 0,
        left: isPhone ? 0 : (showPalette ? 100 : 18),
        right: isPhone ? 0 : bankWidth,
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
          {/* Top row: course info + right column + close */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14, width: "100%" }}>
            <CourseInfo selCourse={selCourse} navTo={navTo} />

            {/* Desktop only: two separate columns */}
            {!isMobile && (
              <CourseOfferingHistory
                selCourse={selCourse}
                offeredOverrides={offeredOverrides}
                setOfferedOverrides={setOfferedOverrides}
              />
            )}
            {!isMobile && showUnlocks && selEdges.length > 0 && (
              <RelationshipList selCourse={selCourse} selEdges={selEdges} courseMap={courseMap} />
            )}

            {/* Tablet: single narrow right column — Relationships under Offered */}
            {isMobile && !isPhone && (
              <div style={{ width: 175, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                <CourseOfferingHistory
                  selCourse={selCourse}
                  offeredOverrides={offeredOverrides}
                  setOfferedOverrides={setOfferedOverrides}
                  compact
                />
                {showUnlocks && selEdges.length > 0 && (
                  <RelationshipList selCourse={selCourse} selEdges={selEdges} courseMap={courseMap} compact />
                )}
              </div>
            )}

            {/* Close */}
            <button
              onClick={() => { setShowPanel(false); setSelectedId(null); }}
              style={{ background: "transparent", border: "none", color: "var(--text-4)", fontSize: 16, cursor: "pointer", lineHeight: 1, padding: "0 2px", flexShrink: 0 }}
            >✕</button>
          </div>

          {/* Phone: offered + unlocks beneath main info */}
          {isPhone && (
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", width: "100%" }}>
              <CourseOfferingHistory
                selCourse={selCourse}
                offeredOverrides={offeredOverrides}
                setOfferedOverrides={setOfferedOverrides}
              />
              {showUnlocks && selEdges.length > 0 && (
                <RelationshipList selCourse={selCourse} selEdges={selEdges} courseMap={courseMap} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CourseInfo({ selCourse, navTo }) {
  const { courseMap, onDragStart, placements } = usePlanner();
  const attributeSystem = usePort(IAttributeSystem);
  const creditSystem    = usePort(ICreditSystem);
  const calendar        = usePort(ICalendar);
  const courseCatalog   = usePort(ICourseCatalog);
  const { t, locale, locales } = useLanguage();
  const { modelProgress, engineTier, catalogLocale, courseTranslationEnabled, setCourseTranslationEnabled, cancelDownload } = useTranslation();
  const { title, desc, isTranslating } = useCourseTranslation(selCourse);

  const catalogUrl = courseCatalog?.courseUrl?.(selCourse) ?? null;
  const [codeHover, setCodeHover] = useState(false);

  const dir     = locales.find(l => l.code === locale)?.dir ?? "ltr";
  const isNonEn = locale !== catalogLocale;

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, background: selCourse.color, color: "var(--badge-bg)", borderRadius: 3, padding: "2px 8px", fontWeight: 800, letterSpacing: "0.04em" }}>
          {selCourse.isCps ? `${selCourse.subject} · CPS` : selCourse.subject}
        </span>
        <span
          draggable
          data-drag-id={selCourse.id}
          data-drag-type="course"
          onDragStart={e => onDragStart(e, selCourse.id, "course", null)}
          onMouseEnter={() => setCodeHover(true)}
          onMouseLeave={() => setCodeHover(false)}
          title={t("info.drag.title")}
          style={{
            fontSize: 14, fontWeight: 800, cursor: "grab", userSelect: "none",
            textDecoration: codeHover ? "underline" : "none",
            textDecorationStyle: "dotted",
            textDecorationColor: "var(--text-6)",
            textUnderlineOffset: 3,
          }}
        >{selCourse.code}</span>
        <span
          dir={isNonEn ? dir : undefined}
          style={{
            fontSize: 12, color: "var(--text-3)",
            opacity: isTranslating ? 0.45 : 1,
            transition: "opacity 0.2s",
          }}
        >{title}</span>
        <span style={{ fontSize: 10, color: "var(--text-4)", background: "var(--badge-bg)", border: "1px solid var(--border-1)", borderRadius: 3, padding: "1px 6px" }}>
          {selCourse.sh} {creditSystem.getUnitName()}
        </span>
        {selCourse.scheduleType && (
          <span style={{ fontSize: 9, color: "var(--text-3)", background: "var(--bg-surface)", border: "1px solid var(--border-2)", borderRadius: 3, padding: "1px 6px" }}>
            <TText>{selCourse.scheduleType}</TText>
          </span>
        )}
        {selCourse.attributes?.map(np => (
          <span key={np} title={attributeSystem.getLabel(np)}
            style={{ fontSize: 9, color: "var(--nupath-text)", background: "var(--nupath-bg)", border: "1px solid var(--nupath-border)", borderRadius: 3, padding: "1px 5px", cursor: "default" }}>
            {np}
          </span>
        ))}
        {catalogUrl && (
          <a href={catalogUrl} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 9, color: "var(--text-5)", textDecoration: "none", marginLeft: 2 }}
            onMouseEnter={e => { e.currentTarget.style.color = "var(--text-3)"; e.currentTarget.style.textDecoration = "underline"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "var(--text-5)"; e.currentTarget.style.textDecoration = "none"; }}>
            {t("info.catalog.link")}
          </a>
        )}
      </div>

      {/* Non-English: nudge to enable translation, or show download progress */}
      {isNonEn && !courseTranslationEnabled && (
        <div style={{ marginBottom: 5, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, color: "var(--text-5)" }}>{t("translation.english.note")}</span>
          <button
            onClick={() => setCourseTranslationEnabled(true)}
            style={{
              fontSize: 9, padding: "1px 7px", borderRadius: 3, cursor: "pointer",
              background: "var(--bg-surface-2)", border: "1px solid var(--border-2)",
              color: "var(--text-3)",
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "var(--active)"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border-2)"}
          >{t("translation.enable")}</button>
        </div>
      )}
      {isNonEn && courseTranslationEnabled && engineTier === "wasm" && modelProgress && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <span style={{ fontSize: 9, color: "var(--text-4)", flex: 1 }}>
              {t("translation.downloading")}
              {modelProgress.total > 0 && (
                <span style={{ marginLeft: 4, color: "var(--text-5)" }}>
                  {Math.round((modelProgress.loaded / modelProgress.total) * 100)}%{" "}
                  {t("translation.progress.of")} ~890 MB
                </span>
              )}
            </span>
            <button
              onClick={cancelDownload}
              title={t("translation.cancel.title")}
              style={{
                fontSize: 9, padding: "1px 6px", borderRadius: 3, cursor: "pointer",
                background: "transparent", border: "1px solid var(--border-2)",
                color: "var(--text-4)", lineHeight: 1.4, flexShrink: 0,
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--error)"; e.currentTarget.style.color = "var(--error)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border-2)"; e.currentTarget.style.color = "var(--text-4)"; }}
            >{t("translation.cancel")}</button>
          </div>
          <div style={{ height: 2, borderRadius: 99, background: "var(--border-1)", overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 99, background: "var(--active)",
              width: modelProgress.total > 0
                ? `${Math.round((modelProgress.loaded / modelProgress.total) * 100)}%`
                : "30%",
              transition: "width 0.3s ease",
            }} />
          </div>
        </div>
      )}

      {selCourse.desc && (
        <div
          dir={isNonEn ? dir : undefined}
          style={{
            fontSize: 11, color: "var(--text-3)", lineHeight: 1.55, marginBottom: 4,
            opacity: isTranslating ? 0.45 : 1,
            transition: "opacity 0.2s",
          }}
        >
          <DescriptionWithLinks
            text={desc}
            courseMap={courseMap}
            placements={placements}
            navTo={navTo}
            onDragStart={onDragStart}
          />
        </div>
      )}
      {selCourse.prereqs?.length > 0 && (
        <div style={{ fontSize: 10, color: "var(--text-4)", background: "var(--badge-bg)", border: "1px solid var(--border-1)", borderRadius: 4, padding: "4px 8px", marginTop: 4, lineHeight: 1.9 }}>
          <span style={{ color: "var(--error)", fontWeight: 700 }}>{t("info.prereqs")} </span>
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
        title={c ? `${c.title}${item.concurrent ? " (may be taken concurrently)" : ""} — click to view, drag to place` : id}
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

function RelationshipList({ selCourse, selEdges, courseMap, compact = false }) {
  const { t } = useLanguage();

  // Only show courses this course unlocks (outgoing prereqs) and coreqs.
  // Incoming prereqs are already shown in the "Prereqs:" line above.
  const isCoreq = type => type === "corequisite" || type === "corequisite-viol";
  const unlocks = selEdges.filter(rel => isCoreq(rel.type) || rel.from === selCourse.id);

  if (unlocks.length === 0) return null;

  return (
    <div style={{ width: compact ? "100%" : "fit-content", flexShrink: 0, display: "flex", flexDirection: "column", paddingRight: compact ? 0 : 12 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.06em", marginBottom: 5 }}>
        {t("info.relationships.title")}
      </div>
      <div style={{ overflowY: "auto", maxHeight: 220, paddingRight: 14 }}>
        {unlocks.map((rel, i) => {
          const isOut  = rel.from === selCourse.id;
          const other  = courseMap[isOut ? rel.to : rel.from];
          const rs     = REL_STYLE[rel.type];
          const coreq  = isCoreq(rel.type);
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
              <span title={other?.title || undefined}
                style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)" }}>
                {other?.code || (isOut ? rel.to : rel.from)}
              </span>
              {coreq && (
                <span style={{ fontSize: 8, background: `${rs?.color}20`, color: rs?.color, borderRadius: 3, padding: "1px 4px", whiteSpace: "nowrap" }}>
                  {t("legend.corequisite")}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const YR_CELL = 20; // px per year column

function CourseOfferingHistory({ selCourse, offeredOverrides, setOfferedOverrides, compact = false }) {
  const cal         = usePort(ICalendar);
  const { t }       = useLanguage();
  const semTypes    = cal.getSemesterTypes();
  const termHistory = selCourse.termHistory ?? {};
  const hasHistory  = Object.keys(termHistory).length > 0;
  const birth       = selCourse.birthTermCode ?? null;

  // Build lookup: { semTypeId → { calYear → offered:boolean } }
  // Pre-birth terms are excluded — they represent the course not yet existing, not a "not offered" signal.
  const byType = {};
  for (const [code, offered] of Object.entries(termHistory)) {
    if (birth !== null && Number(code) < birth) continue;
    const semType = cal.decodeTermCode(code);
    const yr      = cal.getTermCodeYear?.(code);
    if (semType && yr != null) {
      (byType[semType] ??= {})[yr] = offered;
    }
  }

  // Latest year with data per semType — simply the max key in each byType row.
  const latestPastYearByType = {};
  for (const [semType, yrMap] of Object.entries(byType)) {
    const yrs = Object.keys(yrMap).map(Number);
    if (yrs.length) latestPastYearByType[semType] = Math.max(...yrs);
  }

  // Global year range — defines shared fixed columns across all semType rows.
  const allYearNums   = Object.values(byType).flatMap(m => Object.keys(m).map(Number));
  const globalMinYear = allYearNums.length ? Math.min(...allYearNums) : 0;
  const globalMaxYear = allYearNums.length ? Math.max(...allYearNums) : 0;
  const totalCols     = allYearNums.length ? globalMaxYear - globalMinYear + 1 : 0;
  const histWidth     = totalCols * YR_CELL;

  // Explicit overrides: { semTypeId: true | false }.
  // Old array format (pre-refactor saves) is ignored gracefully → treated as no override.
  const rawOvr     = offeredOverrides[selCourse.id];
  const ovrMap     = (rawOvr && !Array.isArray(rawOvr)) ? rawOvr : {};
  const hasOverride = Object.keys(ovrMap).length > 0;

  // Historical offering probability for a given semTypeId (null if no data or < 2 post-birth entries).
  // Pre-birth entries are excluded: a false entry before birthTermCode means the course didn't
  // exist yet, not that it was offered and stopped. Requires ≥ 2 entries to flag as not offered
  // so sparse data for new courses doesn't produce a misleading 0% probability.
  function semTypeProb(semTypeId) {
    const entries = Object.entries(termHistory)
      .filter(([code]) => (birth === null || Number(code) >= birth)
                       && cal.decodeTermCode(code) === semTypeId);
    if (entries.length < 2) return null;
    return entries.filter(([, v]) => v).length / entries.length;
  }

  // Write an explicit override (true/false) or clear it (undefined → delete key).
  function setOverride(semTypeId, value) {
    setOfferedOverrides(prev => {
      const cur    = prev[selCourse.id];
      const curMap = (!cur || Array.isArray(cur)) ? {} : { ...cur };
      if (value === undefined) { delete curMap[semTypeId]; }
      else { curMap[semTypeId] = value; }
      const next = { ...prev };
      if (Object.keys(curMap).length === 0) delete next[selCourse.id];
      else next[selCourse.id] = curMap;
      return next;
    });
  }

  // Click cycle: auto → forced-on → forced-off → auto
  function cycleOverride(semTypeId) {
    const cur = ovrMap[semTypeId];
    if (cur === undefined)    setOverride(semTypeId, true);
    else if (cur === true)    setOverride(semTypeId, false);
    else                      setOverride(semTypeId, undefined);
  }

  function resetAllOverrides(e) {
    e.stopPropagation();
    setOfferedOverrides(prev => { const n = { ...prev }; delete n[selCourse.id]; return n; });
  }

  return (
    <div style={{ flexShrink: 0, width: compact ? "100%" : "auto", display: "flex", flexDirection: "column", paddingRight: compact ? 0 : 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.06em" }}>
          {t("info.offered.title")}
        </span>
        {hasOverride && (
          <button onClick={resetAllOverrides}
            style={{ fontSize: 8, color: "var(--text-5)", background: "none", border: "1px solid var(--border-card)", borderRadius: 3, cursor: "pointer", padding: "0 4px", lineHeight: "14px" }}>
            reset
          </button>
        )}
      </div>

      {semTypes.map(({ id, label, shortLabel }) => {
        const yrMap  = byType[id] ?? {};
        const prob   = semTypeProb(id);              // null | 0..1
        const ovr    = ovrMap[id];                   // true | false | undefined

        const probPct       = prob === null ? 0 : prob;
        const labelDim      = ovr === false || (ovr === undefined && prob !== null && prob <= 0.5);
        const latestPastYr  = latestPastYearByType[id] ?? null;
        const probHint      = prob === null ? "No history" : `${Math.round(probPct * 100)}% historically`;
        const ovrHint       = ovr === true ? " — forced on" : ovr === false ? " — forced off" : "";
        const ctrlTip       = `${label}: ${probHint}${ovrHint} — click to cycle override`;

        return (
          <div key={id}
            style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, userSelect: "none" }}>

            {/* Semtype label */}
            <span title={label}
              style={{ fontSize: 10, color: labelDim ? "var(--text-5)" : "var(--text-2)", width: 24, flexShrink: 0 }}>
              {shortLabel}
            </span>

            {/* Year history — one fixed column per calendar year, all years in global range */}
            {histWidth > 0 && (
              <div style={{ width: histWidth, position: "relative", flexShrink: 0, height: 14 }}>
                {Object.entries(yrMap).map(([yrStr, offered]) => {
                  const yr       = Number(yrStr);
                  const right    = (globalMaxYear - yr) * YR_CELL;
                  const isLatest = yr === latestPastYr;
                  return (
                    <span key={yr}
                      title={`${label} ${yr}: ${offered ? "offered" : "not offered"}${isLatest ? " — latest data" : ""}`}
                      style={{
                        position: "absolute", right,
                        width: YR_CELL - (isLatest ? 2 : 0),
                        textAlign: "center",
                        fontSize: 9, fontWeight: isLatest ? 800 : 700,
                        lineHeight: "12px",
                        fontVariantNumeric: "tabular-nums",
                        color: offered ? "var(--text-2)" : "var(--text-5)",
                        opacity: offered ? 1 : 0.35,
                        ...(isLatest ? {
                          border: "1px solid rgba(128,128,128,0.25)",
                          borderRadius: 2,
                          marginTop: 1,
                        } : {}),
                      }}>
                      {String(yr).slice(-2)}
                    </span>
                  );
                })}
              </div>
            )}

            {/* 3-state control: auto (gradient fill) → forced-on (✓) → forced-off (✕) */}
            <button
              title={ctrlTip}
              onClick={e => { e.stopPropagation(); cycleOverride(id); }}
              style={{
                flexShrink: 0,
                position: "relative",
                width: 14, height: 14,
                border: `1.5px solid ${ovr === true ? "#22c55e" : ovr === false ? "var(--error)" : "var(--border-1)"}`,
                borderRadius: 3,
                background: "transparent",
                cursor: "pointer",
                padding: 0,
                overflow: "hidden",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
              {ovr === undefined && (
                <div style={{
                  position: "absolute", bottom: 0, left: 0, right: 0,
                  height: `${probPct * 100}%`,
                  background: "var(--text-3)", opacity: 0.4,
                  pointerEvents: "none",
                }} />
              )}
              {ovr === true && (
                <div style={{ position: "absolute", inset: 0, background: "#22c55e", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 9, color: "#fff", lineHeight: 1, fontWeight: 700 }}>✓</span>
                </div>
              )}
              {ovr === false && (
                <div style={{ position: "absolute", inset: 0, background: "rgba(232,101,90,0.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 8, color: "var(--error)", lineHeight: 1, fontWeight: 700 }}>✕</span>
                </div>
              )}
            </button>
          </div>
        );
      })}

      <div style={{ fontSize: 8.5, color: "var(--text-5)", fontStyle: "italic", marginTop: 10, lineHeight: 1.4, width: 0, minWidth: "100%" }}>
        {hasHistory ? t("info.offered.hint") : t("info.offered.nodata")}
      </div>
    </div>
  );
}
