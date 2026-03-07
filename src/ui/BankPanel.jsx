// ═══════════════════════════════════════════════════════════════════
// BANK PANEL  — right-hand sidebar: Course Bank ↔ Graduation toggle
// ═══════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import { usePlanner }  from "../context/PlannerContext.jsx";
import { WORK_TERMS } from "../core/constants.js";
import { subjectColor } from "../core/courseModel.js";
import CourseCard  from "./CourseCard.jsx";
import GradPanel   from "./GradPanel.jsx";

export default function BankPanel() {
  const {
    courses, bankCourseIds, subjects, courseMap,
    placements,
    bankSearch, setBankSearch,
    bankSort, setBankSort,
    bankTab, setBankTab,
    bankWidth, setBankWidth,
    showSubjectKeys, setShowSubjectKeys,
    starredIds, collapsedSubs, setCollapsedSubs,
    workPl, onDropBank, onDragStart, cardRefs,
    bankRef, bankResizing, uiScaleRef, isPhone,
    placedIds,
    placedOut, setPlacedOut,
    dragInfo,
    onDropPlacedOut,
    selectedId, setSelectedId,
    setShowPanel,
  } = usePlanner();

  const q = bankSearch.trim().toLowerCase();

  const bankCourses = useMemo(() => {
    const tokens = q.split(/\s+/).filter(Boolean);
    let list = q ? [...courses] : courses.filter(c => bankCourseIds.has(c.id));
    if (bankTab === "starred" && !(q && !isPhone)) list = list.filter(c => starredIds.has(c.id));

    const tieSort =
      bankSort === "za"  ? (a, b) => b.code.localeCompare(a.code) :
      bankSort === "sh↓" ? (a, b) => b.sh - a.sh :
      bankSort === "sh↑" ? (a, b) => a.sh - b.sh :
                           (a, b) => a.code.localeCompare(b.code);

    if (tokens.length) {
      const withScore = [];
      list.forEach(c => {
        const subj    = c.subject.toLowerCase();
        const num     = c.number.toLowerCase();
        const codeHay = `${subj} ${num}`;
        const fullHay = `${codeHay} ${c.title.toLowerCase()}`;
        if (!tokens.every(tok => fullHay.includes(tok))) return;
        const score = tokens.reduce((s, tok) => {
          if (subj === tok)             return s + 8;
          if (subj.startsWith(tok))    return s + 6;
          if (codeHay.startsWith(tok)) return s + 4;
          if (codeHay.includes(tok))   return s + 2;
          return s + 1;
        }, 0);
        withScore.push({ c, score });
      });
      withScore.sort((a, b) => b.score - a.score || tieSort(a.c, b.c));
      return withScore.map(x => x.c);
    }

    if (bankSort === "az")  return [...list].sort((a, b) => a.code.localeCompare(b.code));
    if (bankSort === "za")  return [...list].sort((a, b) => b.code.localeCompare(a.code));
    if (bankSort === "sh↓") return [...list].sort((a, b) => b.sh - a.sh || a.code.localeCompare(b.code));
    if (bankSort === "sh↑") return [...list].sort((a, b) => a.sh - b.sh || a.code.localeCompare(b.code));
    return list;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses, bankCourseIds.size, bankTab, starredIds, q, bankSort, placedIds.size]);

  const bankBySubject = useMemo(() => {
    if (q || bankTab === "starred") return null;
    const m = {};
    bankCourses.forEach(c => { (m[c.subject] = m[c.subject] || []).push(c); });
    return m;
  }, [bankCourses, q, bankTab]);

  const bankWorkIds = new Set(WORK_TERMS.filter(w => !workPl[w.id]).map(w => w.id));
  const [sideMode, setSideMode] = useState("bank"); // "bank" | "grad"

  const [collapsePlacedOut, setCollapsePlacedOut] = useState(true);
  const [hoveredPlacedOutId, setHoveredPlacedOutId] = useState(null);

  return (
    <div style={{ display: "flex", width: bankWidth, flexShrink: 0 }}>
      {/* Drag-resize handle — desktop only */}
      {!isPhone && <div
        onMouseDown={e => {
          bankResizing.current = { startX: e.clientX, startW: bankWidth };
          e.preventDefault();
        }}
        style={{ width: 5, flexShrink: 0, cursor: "col-resize", borderLeft: "1px solid var(--border-1)", background: "transparent" }}
        title="Drag to resize"
      />}

      <div
        ref={bankRef}
        data-drop-bank="true"
        style={{ flex: 1, overflowY: sideMode === "grad" ? "hidden" : "auto", background: "var(--bg-bank)", display: "flex", flexDirection: "column" }}
        onDragOver={sideMode === "bank" ? e => e.preventDefault() : undefined}
        onDrop={sideMode === "bank" ? onDropBank : undefined}
      >
        {/* ── Sticky top bar (always visible) ────────────── */}
        <div style={{ position: "sticky", top: 0, background: "var(--bg-bank)", zIndex: 10, borderBottom: "1px solid var(--border-1)", flexShrink: 0 }}>

          {/* Mobile: 2-tab — Courses (toggles all/saved★) + Grad */}
          {isPhone && (
            <div style={{ padding: "4px 5px 2px", display: "flex", gap: 3 }}>
              <button
                onClick={() => {
                  if (sideMode === "bank") { setBankTab(bankTab === "all" ? "starred" : "all"); }
                  else { setSideMode("bank"); setBankTab("all"); }
                }}
                style={{
                  flex: 1, fontSize: 7, padding: "3px 0", borderRadius: 4, cursor: "pointer",
                  background: sideMode === "bank" ? (bankTab === "starred" ? "var(--warn-bg)" : "var(--bg-surface)") : "transparent",
                  border: `1px solid ${sideMode === "bank" ? (bankTab === "starred" ? "var(--warn-bright)" : "var(--active)") : "var(--border-2)"}`,
                  color: sideMode === "bank" ? (bankTab === "starred" ? "var(--warn-bright)" : "var(--active)") : "var(--text-4)",
                  fontWeight: sideMode === "bank" ? 700 : 400,
                }}>{sideMode === "bank" && bankTab === "starred" ? "★ Saved" : "Courses"}</button>
              <button
                onClick={() => setSideMode("grad")}
                style={{
                  flex: 1, fontSize: 7, padding: "3px 0", borderRadius: 4, cursor: "pointer",
                  background: sideMode === "grad" ? "var(--bg-surface)" : "transparent",
                  border: `1px solid ${sideMode === "grad" ? "var(--active)" : "var(--border-2)"}`,
                  color: sideMode === "grad" ? "var(--active)" : "var(--text-4)",
                  fontWeight: sideMode === "grad" ? 700 : 400,
                }}>Grad</button>
            </div>
          )}

          {/* Desktop: Bank ↔ Graduation toggle */}
          {!isPhone && (
            <div style={{ padding: "7px 8px 5px", display: "flex", gap: 3 }}>
              {[["bank", "Course Bank"], ["grad", "Graduation"]].map(([mode, label]) => (
                <button key={mode} onClick={() => setSideMode(mode)} style={{
                  flex: 1, fontSize: 9, padding: "4px 0", borderRadius: 4, cursor: "pointer",
                  background:  sideMode === mode ? "var(--bg-surface)" : "transparent",
                  border: `1px solid ${sideMode === mode ? "var(--active)" : "var(--border-2)"}`,
                  color: sideMode === mode ? "var(--active)" : "var(--text-4)",
                  fontWeight: sideMode === mode ? 700 : 400,
                }}>{label}</button>
              ))}
            </div>
          )}

        {/* ── Bank-only header controls (desktop: title + subject key + tabs) ── */}
        {!isPhone && sideMode === "bank" && <>
          <div style={{ padding: "0px 9px 4px", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.05em", flex: 1 }}>COURSE BANK</span>
            <span style={{ fontSize: 9, color: "var(--text-4)", background: "var(--bg-surface)", borderRadius: 99, padding: "1px 6px" }}>
              {bankCourseIds.size}
            </span>
            <button onClick={() => setShowSubjectKeys(v => !v)} title="Subject color key"
              style={{ background: showSubjectKeys ? "var(--bg-surface)" : "transparent", border: "1px solid var(--border-2)", borderRadius: 4, color: "var(--text-3)", fontSize: 9, cursor: "pointer", padding: "2px 6px" }}>
              colors
            </button>
          </div>

          {/* Subject colour key */}
          {showSubjectKeys && (
              <div style={{ borderTop: "1px solid var(--border-1)", padding: "6px 8px 8px", display: "flex", flexWrap: "wrap", gap: 4, maxHeight: 160, overflowY: "auto" }}>
              {subjects.map(sub => (
                <div key={sub} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9, color: "var(--text-3)", width: "calc(50% - 2px)" }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: subjectColor(sub), flexShrink: 0 }} />
                  <span style={{ color: subjectColor(sub), fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</span>
                </div>
              ))}
            </div>
          )}

          {/* Tabs */}
          <div style={{ padding: "5px 8px 2px", display: "flex", gap: 4 }}>
            {([["all", "All Courses"], ["starred", `★ Saved${starredIds.size ? ` (${starredIds.size})` : ""}`]]).map(([key, label]) => (
              <button key={key} onClick={() => setBankTab(key)} style={{
                flex: 1, fontSize: 9, padding: "4px 0", borderRadius: 4, cursor: "pointer",
                background: bankTab === key ? (key === "starred" ? "var(--warn-bg)" : "var(--bg-surface)") : "transparent",
                border: `1px solid ${bankTab === key ? (key === "starred" ? "var(--warn-bright)" : "var(--active)") : "var(--border-2)"}`,
                color: bankTab === key ? (key === "starred" ? "var(--warn-bright)" : "var(--active)") : "var(--text-4)",
                fontWeight: bankTab === key ? 700 : 400,
              }}>{label}</button>
            ))}
          </div>
        </>}

        {/* Search + Sort: bank mode, all screen sizes */}
        {sideMode === "bank" && <>
          {/* Search */}
          <div style={{ padding: "3px 8px 2px", position: "relative" }}>
            <input
              value={bankSearch}
              onChange={e => setBankSearch(e.target.value)}
              placeholder="⌕ search"
              style={{
                width: "100%", boxSizing: "border-box",
                background: "var(--bg-surface)", border: `1px solid ${q ? "var(--active)" : "var(--border-2)"}`,
                borderRadius: 5, color: "var(--text-2)", fontSize: isPhone ? 7 : 11,
                padding: "7px 28px 7px 9px", outline: "none",
              }}
            />
            {bankSearch && (
              <button onClick={() => setBankSearch("")}
                style={{ position: "absolute", right: 13, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--text-4)", cursor: "pointer", fontSize: 12, lineHeight: 1, padding: 0 }}>
                &#x2715;
              </button>
            )}
          </div>

                    {/* Sort */}
          <div style={{ display: "flex", gap: 3, padding: "3px 8px 7px" }}>
          </div>

        {/* Placed Out section */}
        <div
          onClick={() => setCollapsePlacedOut(v => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 5, padding: "6px 8px",
            cursor: "pointer", userSelect: "none", borderTop: "1px solid var(--border-1)",
          }}
        >
          <span style={{ fontSize: isPhone ? 5 : 9, fontWeight: 700, color: "var(--text-5)", letterSpacing: "0.05em" }}>
            ↪ PLACED OUT {placedOut.size > 0 ? `(${placedOut.size})` : ""}
          </span>
          <span style={{ fontSize: isPhone ? 7 : 9, color: "var(--text-5)" }}>{collapsePlacedOut ? "▶" : "▼"}</span>
        </div>
        {!collapsePlacedOut && (
          <div
            data-drop-placedout="true"
            onDragOver={e => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={e => {
              e.preventDefault();
              e.stopPropagation();
              if (dragInfo) onDropPlacedOut(dragInfo);
            }}
            style={{
              padding: placedOut.size > 0 ? "0 8px 6px" : "8px",
              display: "flex", flexDirection: "column", gap: 3,
              minHeight: placedOut.size === 0 ? (isPhone ? "40px" : "50px") : "auto",
              border: placedOut.size === 0 ? "2px dashed var(--border-2)" : "none",
              borderRadius: "4px",
              justifyContent: "center",
              alignItems: "center",
              color: "var(--text-5)",
              fontSize: isPhone ? 9 : 10,
            }}
          >
            {placedOut.size > 0 ? (
              Array.from(placedOut).map(id => {
                const c = courseMap[id];
                if (!c) return null;
                return (
                  <div
                    key={id}
                    draggable
                    data-drag-id={id}
                    data-drag-type="course"
                    onDragStart={e => onDragStart(e, id, "course", null)}
                    onClick={() => {
                      setSelectedId(id);
                      setShowPanel(true);
                    }}
                    onMouseEnter={() => setHoveredPlacedOutId(id)}
                    onMouseLeave={() => setHoveredPlacedOutId(null)}
                    style={{
                      display: "flex", alignItems: "center", gap: isPhone ? 4 : 6,
                      padding: isPhone ? "2px 4px" : "3px 6px",
                      background: "var(--bg-surface-2)", borderRadius: 4,
                      cursor: "grab",
                      textDecoration: selectedId === id || hoveredPlacedOutId === id ? "underline" : "none",
                      textDecorationStyle: "dotted",
                      textDecorationColor: "var(--text-4)",
                      textUnderlineOffset: 2,
                      fontSize: isPhone ? 5 : 10,
                    }}
                  >
                    <span style={{ fontSize: isPhone ? 6 : 10, fontWeight: 600, color: "var(--text-2)" }}>{c.code}</span>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        const newSet = new Set(placedOut);
                        newSet.delete(id);
                        setPlacedOut(newSet);
                      }}
                      style={{
                        marginLeft: "auto", background: "none", border: "none",
                        color: "var(--text-4)", cursor: "pointer",
                        fontSize: isPhone ? 10 : 11, padding: "0 4px",
                      }}
                      title="Remove from placed out"
                    >✕</button>
                  </div>
                );
              })
            ) : (
              <div style={{ textAlign: "center", padding: "4px", fontSize: isPhone ? 7 : 10 }}>
                Drag courses here to place them out (no credit, but satisfy prerequisites)
              </div>
            )}
          </div>
        )}
        </>}
        {/* ── End sticky header ── */}
        </div>

        {/* Graduation panel */}
        {sideMode === "grad" && (
          <div style={{ flex: 1, overflowY: "auto", background: "var(--bg-bank)" }}>
            <GradPanel />
          </div>
        )}

        {/* Course bank content */}
        {sideMode === "bank" && <>
        {bankWorkIds.size > 0 && (
          <div style={{ padding: "6px 7px 4px", borderBottom: "1px solid var(--border-1)" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.06em", marginBottom: 5 }}>CO-OPS</div>
            {WORK_TERMS.filter(w => bankWorkIds.has(w.id)).map(wt => (
              <div key={wt.id}
                ref={el => { cardRefs.current[wt.id] = el; }}
                draggable
                data-drag-id={wt.id}
                data-drag-type="work"
                onDragStart={e => onDragStart(e, wt.id, "work", null)}
                style={{ background: "var(--card-bg)", border: `2px solid ${wt.color}`, borderRadius: 6, padding: "6px 8px", cursor: "grab", marginBottom: 5 }}
              >
                <div style={{ fontSize: 11, fontWeight: 900, color: wt.color }}>{wt.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Course list */}
        {bankBySubject ? (
          Object.entries(bankBySubject).sort(([a], [b]) => a.localeCompare(b)).map(([sub, crs]) => {
            const col   = subjectColor(sub);
            const isCol = collapsedSubs[sub] !== false;
            const sortedCrs =
              bankSort === "sh↓" ? [...crs].sort((a, b) => b.sh - a.sh || a.code.localeCompare(b.code))
            : bankSort === "sh↑" ? [...crs].sort((a, b) => a.sh - b.sh || a.code.localeCompare(b.code))
            : bankSort === "za"  ? [...crs].sort((a, b) => b.code.localeCompare(a.code))
            :                      [...crs].sort((a, b) => a.code.localeCompare(b.code));
            return (
              <div key={sub} style={{ borderBottom: "1px solid var(--border-sub)" }}>
                <div
                  onClick={() => setCollapsedSubs(p => ({ ...p, [sub]: p[sub] === false }))}
                  style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 8px", cursor: "pointer", userSelect: "none" }}
                >
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: col, flexShrink: 0 }} />
                  <span style={{ fontSize: isPhone ? 8 : 10, fontWeight: 700, color: col, flex: 1 }}>{sub}</span>
                  <span style={{ fontSize: isPhone ? 7 : 9, color: "var(--text-4)", background: "var(--bg-surface)", borderRadius: 99, padding: "1px 6px" }}>{crs.length}</span>
                  <span style={{ fontSize: isPhone ? 7 : 9, color: "var(--text-4)" }}>{isCol ? "▶" : "▼"}</span>
                </div>
                {!isCol && (
                  <div style={{ padding: "2px 6px 6px", display: "flex", flexDirection: "column", gap: 3 }}>
                    {sortedCrs.map(c => <CourseCard key={c.id} course={c} inSem={false} semId={null} noSubject />)}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div style={{ padding: "4px 6px 6px", display: "flex", flexDirection: "column", gap: 3 }}>
            {bankCourses.length === 0 ? (
              <div style={{ padding: "18px 8px", fontSize: 10, color: "var(--text-6)", textAlign: "center", lineHeight: 1.6 }}>
                {bankTab === "starred" ? (
                  <><div style={{ fontSize: 20, marginBottom: 6 }}>☆</div>No saved courses yet.<br /><span style={{ fontSize: 9 }}>Click ☆ on any course row to save it.</span></>
                ) : "No courses match."}
              </div>
            ) : bankCourses.map(c => {
              return (
                <div key={c.id} style={{ position: "relative", opacity: placedIds.has(c.id) ? 0.55 : 1 }}>
                  <CourseCard course={c} inSem={false} semId={null} />
                  <button
                    onClick={() => {
                      const newSet = new Set(placedOut);
                      if (newSet.has(c.id)) newSet.delete(c.id); else newSet.add(c.id);
                      setPlacedOut(newSet);
                    }}
                    style={{
                      position: "absolute", top: 2, right: 2,
                      fontSize: isPhone ? 6 : 8, padding: "1px 4px",
                      background: placedOut.has(c.id) ? "var(--success-bg)" : "var(--bg-surface)",
                      border: `1px solid ${placedOut.has(c.id) ? "var(--success-border)" : "var(--border-2)"}`,
                      borderRadius: 4, cursor: "pointer",
                      color: placedOut.has(c.id) ? "var(--success)" : "var(--text-4)",
                    }}
                    title={placedOut.has(c.id) ? "Remove placed out" : "Mark as placed out"}
                  >
                    {placedOut.has(c.id) ? "✓" : "↪"}
                  </button>
                  {/* The "in plan" badge is removed because placed courses are filtered out of the bank */}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ height: 40 }} />
        </>}

      </div>
    </div>
  );
}
