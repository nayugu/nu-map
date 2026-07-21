// ═══════════════════════════════════════════════════════════════════
// INFO PANEL  — bottom drawer for selected course details
// ═══════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { SemLabel } from "./SemLabel.jsx";

export default function InfoPanel() {
  const {
    showPanel, setShowPanel, selectedId, setSelectedId,
    courseMap, allEdges, offeredOverrides, setOfferedOverrides,
    panelHeight, panelResizing, isPhone, isMobile,
    showUnlocks, bankWidth, showPalette, wideCatalog, wideWidth,
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
        right: isPhone ? 0 : (wideCatalog ? (wideWidth ?? Math.min(340, Math.max(240, window.innerWidth * 0.24))) : bankWidth),
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
              <RelationshipList selCourse={selCourse} selEdges={selEdges} courseMap={courseMap} navTo={navTo} />
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
                  <RelationshipList selCourse={selCourse} selEdges={selEdges} courseMap={courseMap} navTo={navTo} compact />
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
                <RelationshipList selCourse={selCourse} selEdges={selEdges} courseMap={courseMap} navTo={navTo} />
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

function RelationshipList({ selCourse, selEdges, courseMap, navTo, compact = false }) {
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
          const isOut   = rel.from === selCourse.id;
          const otherId = isOut ? rel.to : rel.from;
          const other   = courseMap[otherId];
          const rs      = REL_STYLE[rel.type];
          const coreq   = isCoreq(rel.type);
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
              <span title={other ? `${other.title} — click to view` : undefined}
                onClick={other ? (e => { e.stopPropagation(); navTo(otherId); }) : undefined}
                onMouseEnter={other ? (e => { e.currentTarget.style.textDecoration = "underline"; }) : undefined}
                onMouseLeave={other ? (e => { e.currentTarget.style.textDecoration = "none"; }) : undefined}
                style={{ fontSize: 10, fontWeight: 700, color: other?.color || "var(--text-3)",
                  cursor: other ? "pointer" : "default", textUnderlineOffset: 2, userSelect: "none" }}>
                {other?.code || otherId}
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

const YR_CELL = 22; // px per year column (framed enrollment gauges)
const ROW_H   = 18; // px height of a gauge row (year labelled in the header above)

// Weekday boxes for the typical meeting pattern. `dow` = [Mon..Fri] % of sections meeting
// that day — each box is shaded by frequency, so "mostly MWR, some TF" reads at a glance.
// Day letters are localised (e.g. 月火水木金 in Japanese) via the "info.offered.weekdays" key.
function WeekdayStrip({ dow, color }) {
  const { t } = useLanguage();
  const labels = (t("info.offered.weekdays") || "M,T,W,Th,F").split(",");
  return (
    <div style={{ display: "flex", gap: 3 }}>
      {labels.map((label, i) => {
        const pct = dow?.[i] ?? 0;                       // 0..100
        const on  = pct > 0;
        const op  = on ? 0.1 + 0.7 * (pct / 100) : 0;    // faint floor → strong at 100%
        return (
          <span key={i} title={`${label}: ${pct}%`}
            style={{
              position: "relative", overflow: "hidden",
              minWidth: 19, height: 19, borderRadius: 4, padding: "0 3px",
              display: "flex", alignItems: "center", justifyContent: "center",
              border: `1px solid ${on ? "transparent" : "var(--border-1)"}`,
            }}>
            {on && <span style={{ position: "absolute", inset: 0, background: color || "var(--text-3)", opacity: op }} />}
            <span style={{
              position: "relative",
              fontSize: 10, fontWeight: pct >= 50 ? 800 : 600,
              color: on ? "var(--text-1)" : "var(--text-5)",
              opacity: on ? 1 : 0.5,
            }}>
              {label}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function CourseOfferingHistory({ selCourse, offeredOverrides, setOfferedOverrides, compact = false }) {
  const cal         = usePort(ICalendar);
  const { t }       = useLanguage();
  // Order rows Spring → Summer → Fall (Fall last), so each calendar-year column reads
  // top-to-bottom in chronological order — Fall is the last term of its calendar year.
  const semTypesRaw = cal.getSemesterTypes();
  const semTypes    = [
    ...semTypesRaw.filter(s => s.id !== "fall"),
    ...semTypesRaw.filter(s => s.id === "fall"),
  ];
  const termHistory = selCourse.termHistory ?? {};
  const hasHistory  = Object.keys(termHistory).length > 0;
  const birth       = selCourse.birthTermCode ?? null;

  // Per-term enrollment detail (completed terms only): { e:{enrolled}, c:{capacity}, s:{sections}, fmt[], cmp[], dow[], lab }
  const offering = selCourse.offering ?? null;
  const enrMap = offering?.e ?? {};   // enrolled count  → fill% (height) = enr/cap
  const capMap = offering?.c ?? {};   // capacity        → open = max(0, cap - enr)
  const secMap = offering?.s ?? {};   // section count   → colour uses open ÷ sections

  // Hover popover state: which gauge cell the pointer is over (desktop only — hover never
  // fires on touch, so phones simply keep the plain gauges). Holds the cell's numbers plus
  // its on-screen rect so the popover can anchor to it.
  const [hoverCell, setHoverCell] = useState(null);

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

  // Parallel lookups per (semType, year): enrolled, capacity, section count. Everything the
  // gauges and popover need (open, fill%, open-per-section) is derived from these three.
  const enrByType = {};
  const capByType = {};
  const secByType = {};
  for (const [code, cap] of Object.entries(capMap)) {
    if (birth !== null && Number(code) < birth) continue;
    const semType = cal.decodeTermCode(code);
    const yr      = cal.getTermCodeYear?.(code);
    if (semType && yr != null) {
      (capByType[semType] ??= {})[yr] = cap;
      (enrByType[semType] ??= {})[yr] = enrMap[code] ?? 0;
      (secByType[semType] ??= {})[yr] = secMap[code] ?? 1;
    }
  }
  // Colour by OPEN SEATS PER SECTION — the real "can I get a seat (in a section I can take)?"
  // signal. Captures class size (1 of 2 = full) AND how thinly open seats spread (5 sections
  // with 5 open ≈ 1 each = a scramble). A diverging ramp built from the app's own subject
  // colours, which are already max-saturation, so each extreme IS the given colour and the
  // near-threshold ends are lighter tints of it:
  //   wide-open → ENVR green #34d399   (light mint #a7f3d0 near the 6-seat threshold)
  //   jammed    → #e31f2b = ECON #f87171 ⊗ ENLR #e94560 (the two reds multiplied = darkest)
  //               (light coral #fca5a5 near the threshold)
  // No yellow. Height still shows fill %, so height = how-full, colour = can-I-get-in.
  const SEATS_ROOM = 6;    // ≥ this open/section = "room" (green side)
  const ROOM_OPEN  = 15;   // ≥ this = wide open (fully-saturated ENVR green)
  const lerpRGB = (A, B, t) => { const c = A.map((x, i) => Math.round(x + (B[i] - x) * t)); return `rgb(${c[0]},${c[1]},${c[2]})`; };
  const seatColor = (v) => {
    if (v == null) return "#34d399";
    if (v >= SEATS_ROOM) {
      // room: pale mint (near threshold) → saturated ENVR green (wide open)
      const t = Math.min(1, (v - SEATS_ROOM) / (ROOM_OPEN - SEATS_ROOM));  // 6→0 (pale) .. 15+→1 (saturated)
      return lerpRGB([216, 250, 209], [52, 211, 141], t);                 // #d8fad1 → #34d38d (pale end has a faint warm/yellow tint)
    }
    // competitive: pale coral (near threshold) → darkest combined red, leaning coral (jammed)
    const t = (SEATS_ROOM - 1 - Math.max(0, v)) / (SEATS_ROOM - 1);       // 5→0 (pale) .. 0→1 (darkest)
    return lerpRGB([254, 207, 204], [238, 72, 78], t);                    // #fecfcc → #ee484e (pale end: only a whisper of warmth — coral+yellow muddies fast)
  };
  // Diverging legend: the two sides get EQUAL halves of the bar with the pale transition dead
  // centre — competitive (coral) fills the left 50%, roomy (green) the right 50% — instead of a
  // raw 0→ROOM_OPEN domain that would shove the transition off to ~40% and leave the sides
  // visibly lopsided. `seatsToPos` maps an open-per-section value to its 0..1 spot on the bar;
  // the gradient and the hover pointer both use it, so the bar stays an exact key to the colours.
  const seatsToPos = (v) => v <= SEATS_ROOM
    ? (Math.max(0, v) / SEATS_ROOM) * 0.5                                    // 0→0 … 6→0.5
    : 0.5 + Math.min(1, (v - SEATS_ROOM) / (ROOM_OPEN - SEATS_ROOM)) * 0.5;  // 6→0.5 … 15+→1
  const posToSeats = (p) => p <= 0.5
    ? (p / 0.5) * SEATS_ROOM
    : SEATS_ROOM + ((p - 0.5) / 0.5) * (ROOM_OPEN - SEATS_ROOM);
  const seatGradient = Array.from({ length: 25 }, (_, i) => {
    const p = i / 24;
    return `${seatColor(posToSeats(p))} ${Math.round(p * 100)}%`;
  }).join(", ");

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

  // Typical meeting days as a per-weekday frequency gradient. Competitiveness is intentionally
  // NOT summarized in words — the per-term fill shading on the cells above shows it directly.
  const dow    = offering?.dow ?? null;                 // [M,T,W,Th,F] % of sections
  const anyDay = dow?.some(v => v > 0) ?? false;

  return (
    <div style={{ flexShrink: 0, width: compact ? "100%" : "fit-content", display: "flex", flexDirection: "column", padding: compact ? 0 : "0 12px 0 6px" }}>
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

      {/* Legend intentionally omitted — the year header + shaded gauges are self-explanatory. */}

      {/* Year header — labels the columns once, above the gauges */}
      {histWidth > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <span style={{ width: 24, flexShrink: 0 }} />
          <div style={{ width: histWidth, position: "relative", flexShrink: 0, height: 11 }}>
            {Array.from({ length: totalCols }, (_, i) => globalMinYear + i).map(yr => (
              <span key={yr} style={{
                position: "absolute", right: (globalMaxYear - yr) * YR_CELL + 2,
                width: YR_CELL - 4, textAlign: "center",
                fontSize: 8.5, fontWeight: 700, color: "var(--text-4)",
                fontVariantNumeric: "tabular-nums",
              }}>{String(yr).slice(-2)}</span>
            ))}
          </div>
          <span style={{ width: 14, flexShrink: 0 }} />
        </div>
      )}

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
            style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, userSelect: "none" }}>

            {/* Semtype label */}
            <span title={label}
              style={{ fontSize: 10, color: labelDim ? "var(--text-5)" : "var(--text-2)", width: 24, flexShrink: 0 }}>
              {shortLabel}
            </span>

            {/* Year history — one framed enrollment gauge per calendar year */}
            {histWidth > 0 && (
              <div style={{ width: histWidth, position: "relative", flexShrink: 0, height: ROW_H }}>
                {Object.entries(yrMap).map(([yrStr, offered]) => {
                  if (!offered) return null;                        // not offered that year → blank slot
                  const yr    = Number(yrStr);
                  const right = (globalMaxYear - yr) * YR_CELL;
                  const cap   = capByType[id]?.[yr] ?? null;        // capacity
                  const hasData = cap != null && cap > 0;
                  const enr   = hasData ? (enrByType[id]?.[yr] ?? 0) : null;
                  const sec   = secByType[id]?.[yr] ?? 1;           // section count
                  const open  = hasData ? Math.max(0, cap - enr) : null;   // seats remaining
                  const fill  = hasData ? Math.round((enr / cap) * 100) : null; // fill %  → height
                  const perSec = open != null ? open / sec : null;  // seats per section  → colour
                  const cell = { id, label, yr, enr, cap, open, sec, fill, perSec };
                  return (
                    <span key={yr}
                      onMouseEnter={hasData ? e => setHoverCell({ ...cell, rect: e.currentTarget.getBoundingClientRect() }) : undefined}
                      onMouseLeave={hasData ? () => setHoverCell(c => (c && c.yr === yr && c.label === label) ? null : c) : undefined}
                      style={{
                        position: "absolute", right: right + 2, bottom: 0,
                        width: YR_CELL - 4,
                        height: ROW_H,
                        borderRadius: 3, overflow: "hidden",
                        cursor: hasData ? "help" : "default",
                        // Thick but subtle frame = the 100% reference so the fill reads as a
                        // clear fraction; the year is labelled once in the header above.
                        border: "2px solid var(--border-2)",
                      }}>
                      {fill != null && (
                        <span style={{
                          position: "absolute", left: 0, right: 0, bottom: 0,
                          height: `${Math.max(4, Math.min(100, fill))}%`,
                          background: seatColor(perSec),
                          opacity: 0.85,
                          pointerEvents: "none",
                        }} />
                      )}
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
                // Neutral / monochrome on purpose: the traffic-light palette is reserved for
                // the enrollment-fill cells, so this override control never competes with it.
                border: `1.5px solid ${ovr === true ? "var(--text-3)" : "var(--border-1)"}`,
                borderRadius: 3,
                background: "transparent",
                cursor: "pointer",
                padding: 0,
                overflow: "hidden",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
              {ovr === true && (
                <span style={{ fontSize: 9, lineHeight: 1, fontWeight: 800, color: "var(--text-1)" }}>✓</span>
              )}
              {ovr === false && (
                <span style={{ fontSize: 8, lineHeight: 1, fontWeight: 800, color: "var(--text-4)" }}>✕</span>
              )}
            </button>
          </div>
        );
      })}

      <div style={{ fontSize: 8.5, color: "var(--text-5)", fontStyle: "italic", marginTop: 9, lineHeight: 1.4, width: 0, minWidth: "100%" }}>
        {hasHistory ? t("info.offered.hint") : t("info.offered.nodata")}
      </div>

      {dow && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.06em", marginBottom: 5 }}>
            {t("info.offered.schedule")}
          </div>
          {anyDay
            ? <WeekdayStrip dow={dow} color={selCourse.color} />
            : <span style={{ fontSize: 10, color: "var(--text-3)", fontStyle: "italic" }}>{t("info.offered.async")}</span>}
        </div>
      )}

      {hoverCell && (
        <OfferingPopover
          cell={hoverCell}
          gradient={seatGradient}
          markerPos={seatsToPos(hoverCell.perSec ?? 0) * 100}
          color={seatColor(hoverCell.perSec)}
        />
      )}
    </div>
  );
}

// Rich hover card for a single availability gauge (desktop only). Anchors to the hovered cell's
// on-screen rect (position: fixed) and explains the colour: the exact numbers behind the cell,
// the open-seats-per-section value that drives the shade, and the full colour scale with a
// pointer marking where this term lands on it.
function OfferingPopover({ cell, gradient, markerPos, color }) {
  const { t, locale, locales } = useLanguage();
  const dir = locales.find(l => l.code === locale)?.dir ?? "ltr";   // popover follows locale direction
  const { id, yr, enr, cap, open, sec, fill, perSec, rect } = cell;

  // Header = "<semester> <year>", rendered by the shared <SemLabel> so it's translated identically
  // to the planner rows (see SemLabel.jsx for the naming/translation rules).
  const header = <SemLabel typeId={id} year={yr} />;

  const WIDTH = 246;
  const GAP   = 22;   // horizontal clearance between the cell and the popover
  const EDGE  = 8;    // min clearance from any viewport edge

  // Anchor to the hovered CELL, off to its right, with the "open ÷ sections = …" equation line
  // level with the cell's vertical centre. Flip to the left of the cell if there's no room, and
  // clamp inside the viewport so it can never be cut off. Rendered through a portal to
  // document.body so it escapes the app container's transform:scale (which would otherwise throw
  // fixed-positioning coordinates completely off).
  const ref     = useRef(null);
  const lineRef = useRef(null);   // the per-section equation line, aligned to the cell centre
  const [placed, setPlaced] = useState(null);   // {top, left} once measured
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const lineMid = lineRef.current
      ? lineRef.current.offsetTop + lineRef.current.offsetHeight / 2
      : h / 2;
    let left = rect.right + GAP;                                    // to the right of the cell…
    if (left + WIDTH > window.innerWidth - EDGE) left = rect.left - GAP - WIDTH;  // …or left if tight
    left = Math.min(Math.max(EDGE, left), window.innerWidth - WIDTH - EDGE);
    let top = (rect.top + rect.bottom) / 2 - lineMid;              // line level with cell centre
    top = Math.min(Math.max(EDGE, top), window.innerHeight - h - EDGE);
    setPlaced({ top: Math.round(top), left: Math.round(left) });
  }, [rect]);

  const style = {
    position: "fixed",
    left: placed ? placed.left : Math.round(rect.right + GAP),
    top:  placed ? placed.top  : Math.round(rect.top),
    zIndex: 9000,
    width: WIDTH,
    padding: "13px 15px 14px",
    background: "var(--bg-surface)",
    border: "1px solid var(--border-card)",
    borderRadius: 8,
    boxShadow: "var(--shadow-modal)",
    pointerEvents: "none",
    fontVariantNumeric: "tabular-nums",
    fontFamily: "'Inter', system-ui, sans-serif",
    direction: dir,                               // RTL locales (Arabic) flip the layout…
    visibility: placed ? "visible" : "hidden",   // avoid a first-frame flash at the pre-measure spot
  };

  const pos = Math.max(0, Math.min(100, markerPos));                   // marker along the diverging ramp
  const sectionWord = sec === 1 ? t("info.offered.pop.section") : t("info.offered.pop.sections");

  return createPortal(
    <div ref={ref} style={style}>
      {/* Header — rendered with the planner's exact label patterns (see `header` above) so the
          popover title always matches the corresponding planner row's translation. */}
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-1)", marginBottom: 12 }}>
        {header}
      </div>

      {/* Two derivations, each an explicit division ending in the value that drives one visual
          channel: enrolled ÷ seats = fill% (gauge HEIGHT), open ÷ sections = per-section (gauge
          COLOUR). The per-section result is tinted with the gauge's own colour so the number and
          the shade are visibly the same thing; labelled operands + ÷ keep them from reading as
          products, and each derived value sits with its own equation (no split-off header %). */}
      {/* Result-forward stats: the derived number leads (big), its plain-language meaning sits
          beside it, and the derivation is a muted line beneath. The derivation is dir="ltr" (maths
          reads left-to-right even in RTL) with every translated word <bdi>-isolated so an Arabic
          label can't reorder the numbers. 90% needs no word-label (percent is self-evident); the
          per-section figure gets one because a bare 3.20 is easy to misread. */}
      {/* Fullness → gauge height */}
      <div style={{ marginBottom: 14 }}>
        <b style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)", lineHeight: 1.1 }}>{fill}%</b>
        <div dir="ltr" style={{ fontSize: 10, color: "var(--text-5)", fontVariantNumeric: "tabular-nums", marginTop: 3, textAlign: dir === "rtl" ? "right" : "left" }}>
          <span style={{ color: "var(--text-4)" }}>{enr}</span> <bdi>{t("info.offered.pop.enrolled")}</bdi>
          <span> ÷ </span>
          <span style={{ color: "var(--text-4)" }}>{cap}</span> <bdi>{t("info.offered.pop.seats")}</bdi>
        </div>
      </div>

      {/* Open per section → gauge colour (result tinted with that colour) */}
      <div ref={lineRef} style={{ marginBottom: 15 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          <b style={{ fontSize: 16, fontWeight: 700, color, lineHeight: 1.1 }}>{(perSec ?? 0).toFixed(2)}</b>
          <span style={{ fontSize: 9.5, color: "var(--text-5)" }}>{t("info.offered.pop.avgDesc")}</span>
        </div>
        <div dir="ltr" style={{ fontSize: 10, color: "var(--text-5)", fontVariantNumeric: "tabular-nums", marginTop: 3, textAlign: dir === "rtl" ? "right" : "left" }}>
          <span style={{ color: "var(--text-4)" }}>{open}</span> <bdi>{t("info.offered.pop.open")}</bdi>
          <span> ÷ </span>
          <span style={{ color: "var(--text-4)" }}>{sec}</span> <bdi>{sectionWord}</bdi>
        </div>
      </div>

      {/* The colour scale, with a pointer where this term lands */}
      <div style={{ position: "relative", height: 9, borderRadius: 5, background: `linear-gradient(to right, ${gradient})`, marginTop: 2 }}>
        <span style={{
          position: "absolute", top: -3, bottom: -3, left: `${pos}%`,
          width: 2, transform: "translateX(-1px)",
          background: "var(--text-1)", borderRadius: 1,
          boxShadow: "0 0 0 1.5px var(--bg-surface)",
        }} />
      </div>
      {/* dir="ltr" so the labels stay physically aligned with the bar (which is always drawn
          left→red … right→green): packed under the red end, wide-open under the green end. */}
      <div dir="ltr" style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 8, color: "var(--text-5)", fontWeight: 500 }}>
        <bdi>{t("info.offered.pop.packed")}</bdi>
        <bdi>{t("info.offered.pop.open2")}</bdi>
      </div>
    </div>,
    document.body
  );
}
