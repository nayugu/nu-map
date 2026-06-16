// ═══════════════════════════════════════════════════════════════════
// GRAD PANEL  — graduation requirements sidebar
//
// Rendered by BankPanel as an XOR alternative to the course bank.
// Uses graduatenu Major2 JSON schema (local fork) + gradRequirements.js
//
// Double major: courses count freely toward both majors (NU policy).
// Each major is allocated independently with allocateMajorWithElectives.
// ═══════════════════════════════════════════════════════════════════
import { useState, useMemo, useEffect, useContext, createContext, useRef } from "react";
import { createPortal } from "react-dom";
import { usePlanner }         from "../context/PlannerContext.jsx";
import { usePort }             from "../context/InstitutionContext.jsx";
import { IAttributeSystem }   from "../ports/IAttributeSystem.js";
import { IMajorRequirements } from "../ports/IMajorRequirements.js";
import { ISpecialTerms }      from "../ports/ISpecialTerms.js";
import { ICreditSystem }      from "../ports/ICreditSystem.js";
import { IInstitution }       from "../ports/IInstitution.js";
import { computeGrantedAttrs } from "../core/specialTermUtils.js";
import { useLanguage }          from "../context/LanguageContext.jsx";
import { useTranslatedText }    from "../context/TranslationContext.jsx";
import {
  buildPlacedKeySet,
  allocateMajor,
  allocateMajorWithElectives,
  allocateSections,
} from "../core/gradRequirements.js";
import { findNewerMajorVersion } from "../data/majorLoader.js";

// ── GradCtx (avoids deep prop-drilling through requirement tree) ─────────
// isPhone is included so child nodes (NuPathGrid, ReqNode) can adapt.
const GradCtx = createContext(null);

// ── Shared atoms ─────────────────────────────────────────────────

function ProgressBar({ frac, color = "var(--success)" }) {
  return (
    <div style={{ height: 4, borderRadius: 2, background: "var(--border-2)", overflow: "hidden" }}>
      <div style={{
        width: `${Math.min(100, Math.max(0, frac * 100))}%`,
        height: "100%", background: color, borderRadius: 2, transition: "width 0.25s",
      }} />
    </div>
  );
}

/** Two-segment bar: completed (green) + planned (amber), with an optional required-marker line. */
function CreditBar({ completedSH, plannedSH, requiredSH }) {
  const totalSH    = completedSH + plannedSH;
  const maxSH      = Math.max(totalSH, requiredSH, 1);
  const reqFrac    = requiredSH > 0 ? requiredSH / maxSH : 0;
  const totalFrac  = totalSH / maxSH;
  const labelStyle = (color) => ({
    position: "absolute", bottom: "100%", left: "50%",
    transform: "translateX(-50%)", fontSize: 8, color, whiteSpace: "nowrap", marginBottom: 2, lineHeight: 1,
  });
  return (
    <div style={{ position: "relative", height: 6, borderRadius: 3, background: "var(--border-2)", overflow: "visible", margin: "14px 0 4px" }}>
      {plannedSH > 0 && (
        <div style={{ position: "absolute", left: 0, width: `${Math.min(100, totalFrac * 100)}%`, height: "100%", background: "var(--link-1)", borderRadius: 3, opacity: 0.45 }} />
      )}
      {completedSH > 0 && (
        <div style={{ position: "absolute", left: 0, width: `${Math.min(100, completedSH / maxSH * 100)}%`, height: "100%", background: "var(--success)", borderRadius: 3 }} />
      )}
      {/* required tick + label */}
      {requiredSH > 0 && (
        <div style={{ position: "absolute", left: `${Math.min(99.5, reqFrac * 100)}%`, top: -3, height: 12, width: 2, background: "var(--text-3)", borderRadius: 1, transform: "translateX(-50%)" }}>
          <div style={labelStyle("var(--text-4)")}>{requiredSH}</div>
        </div>
      )}
    </div>
  );
}

function CheckBox({ sat, dimmedCheck = false }) {
  const ctx = useContext(GradCtx);
  const ph  = ctx?.isPhone;
  const sz  = ph ? 12 : 14;
  const base = { display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: sz, height: sz, borderRadius: ph ? 2 : 3, flexShrink: 0,
    fontSize: ph ? 7 : 9, fontWeight: 900 };
  if (dimmedCheck) return (
    <span style={{ ...base, background: "var(--bg-surface-2)", border: "1px solid var(--border-2)", color: "var(--text-5)", overflow: "hidden", position: "relative" }}>
      <svg width={sz} height={sz} viewBox={`0 0 ${sz} ${sz}`} style={{ position: "absolute", top: 0, left: 0 }}>
        <line x1="2" y1={sz - 2} x2={sz - 2} y2="2" stroke="var(--text-5)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </span>
  );
  return (
    <span style={{ ...base,
      background: sat ? "var(--success-bg)"   : "var(--bg-surface-2)",
      border: `1px solid ${sat ? "var(--success-border)" : "var(--border-2)"}`,
      color: sat ? "var(--success)" : "var(--text-5)",
    }}>
      {sat ? "✓" : ""}
    </span>
  );
}

// ── Searchable combobox (matches course-bank search style) ───────────────

function SearchCombo({ value, onChange, groups, placeholder = "Search…" }) {
  const [query, setQuery] = useState("");
  const [open,  setOpen]  = useState(false);
  const [rect,  setRect]  = useState(null);
  const inputRef = useRef(null);
  const { t } = useLanguage();

  const updateRect = () => {
    if (inputRef.current) setRect(inputRef.current.getBoundingClientRect());
  };

  const allOptions = useMemo(() => {
    const list = [];
    for (const [grp, opts] of groups.entries()) {
      for (const o of opts) list.push({ ...o, grp });
    }
    return list;
  }, [groups]);

  const q        = query.trim().toLowerCase();
  const filtered = q
    ? allOptions.filter(o =>
        o.label.toLowerCase().includes(q) ||
        o.grp.toLowerCase().includes(q)  ||
        (o.folder ?? "").toLowerCase().includes(q)).slice(0, 60)
    : [];                        // never render all ~1500 items unfiltered

  const sel = value ? allOptions.find(o => o.path === value) : null;
  // Always show the selected label when not editing, otherwise show the query
  const displayVal = open ? query : (sel ? `${sel.label}${sel.location ? ` (${sel.location})` : ""}` : "");

  const handleFocus  = () => { updateRect(); setQuery(""); setOpen(true); };
  // Use 300ms so touch-tap can fire mousedown/touchstart before dropdown closes
  const handleBlur   = () => setTimeout(() => setOpen(false), 300);
  const handleChange = e  => { setQuery(e.target.value); setOpen(true); };
  const select       = path => { onChange(path); setOpen(false); setQuery(""); };

  return (
    <div style={{ position: "relative", width: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <input
          ref={inputRef}
          type="text"
          value={displayVal}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          style={{
            flex: 1, fontSize: 10, padding: "4px 6px", minWidth: 0,
            background: "var(--bg-surface-2)", color: "var(--text-2)",
            border: "1px solid var(--border-2)", borderRadius: 4, outline: "none",
          }}
        />
        {value && (
          <button
            onMouseDown={e => { e.preventDefault(); select(""); }}
            onTouchStart={e => { e.preventDefault(); select(""); }}
            style={{ background: "transparent", border: "none", color: "var(--text-4)", fontSize: 11, cursor: "pointer", padding: "0 2px", flexShrink: 0 }}
          >✕</button>
        )}
      </div>
      {open && rect && createPortal(
        <div style={{
          position: "fixed",
          top: rect.bottom + 2,
          left: rect.left,
          width: rect.width,
          zIndex: 9000,
          maxHeight: 280, overflowY: "auto",
          background: "var(--bg-surface)", border: "1px solid var(--border-2)",
          borderRadius: 4, boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
          fontFamily: "'Inter', system-ui, sans-serif", fontSize: 12,
        }}>
          <div
            onMouseDown={() => select("")}
            onTouchStart={e => { e.preventDefault(); select(""); }}
            style={{
              padding: "6px 10px", fontSize: 11, cursor: "pointer",
              color: "var(--text-5)", borderBottom: "1px solid var(--border-1)",
            }}
          >— None —</div>
          {!q ? (
            <div style={{ padding: "7px 10px", fontSize: 11, color: "var(--text-5)", fontStyle: "italic" }}>{t("bank.search.empty.typing")}</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "7px 10px", fontSize: 11, color: "var(--text-5)" }}>{t("bank.search.empty.none")}</div>
          ) : (
            filtered.map(o => (
              <div
                key={o.path}
                onMouseDown={() => select(o.path)}
                onTouchStart={e => { e.preventDefault(); select(o.path); }}
                style={{
                  padding: "5px 10px", fontSize: 11, cursor: "pointer",
                  background: o.path === value ? "var(--bg-surface-2)" : undefined,
                  color: o.path === value ? "var(--text-1)" : "var(--text-2)",
                }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--bg-surface-2)"}
                onMouseLeave={e => e.currentTarget.style.background = o.path === value ? "var(--bg-surface-2)" : ""}
              >
                <div style={{ fontWeight: 600 }}>
                  {o.label}{o.location ? ` (${o.location})` : ""}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-5)" }}>{o.grp}</div>
              </div>
            ))
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
// ── Requirement tree ─────────────────────────────────────────────

function ReqNode({ r, depth = 0, dimmed = false }) {
  const [open, setOpen]  = useState(true);
  const [hov,  setHov]   = useState(false);
  const { courseMap, onDragStart, setSelectedId, setShowPanel, selectedId, isPhone, wideCatalog } = useContext(GradCtx);
  const pl               = depth * (isPhone ? 4 : 10);
  const rowMB            = isPhone ? 1 : 3;
  const nodeFz           = isPhone ? 8 : 10;
  const rowGap           = isPhone ? 3 : 5;
  const baseIndent       = isPhone ? 2 : 4;

  // Translation hooks — must be called unconditionally; pass null when not applicable.
  const courseTitle      = useTranslatedText(r.type === "COURSE" ? courseMap?.[r.key]?.title : null);
  const sectionHeading   = useTranslatedText(r.type !== "COURSE" && r.type !== "RANGE" && r.type !== "XOM" ? (r.title ?? null) : null);

  if (r.type === "COURSE") {
    const course       = courseMap?.[r.key];
    const isSelected   = selectedId === r.key;
    const displayLabel = r.label.split(' — ')[0];
    return (
      <div style={{ paddingLeft: pl + baseIndent, marginBottom: rowMB, opacity: dimmed ? 0.4 : 1 }}>
        <div
          style={{ display: "flex", alignItems: "center", gap: rowGap, cursor: course ? "grab" : "default" }}
          draggable={!!course}
          onDragStart={course ? e => {
            e.stopPropagation();
            onDragStart(e, r.key, "course", null);
          } : undefined}
          onClick={course ? e => {
            e.stopPropagation();
            setSelectedId(r.key);
            setShowPanel(true);
          } : undefined}
          title={course ? (isPhone ? r.label : `Drag to place • click to preview`) : undefined}
        >
          <CheckBox sat={r.sat} dimmedCheck={dimmed} />
          <span
            onMouseEnter={course ? () => setHov(true) : undefined}
            onMouseLeave={course ? () => setHov(false) : undefined}
            style={{
              fontSize: nodeFz, color: r.sat ? "var(--text-2)" : "var(--text-4)", fontWeight: r.sat ? 600 : 400, userSelect: "none",
              textDecoration: isSelected ? "underline" : hov ? "underline" : "none",
              textDecorationColor: "var(--text-4)",
              textUnderlineOffset: 2,
              ...(wideCatalog ? { minWidth: 90, flexShrink: 0 } : {}),
            }}>
            {displayLabel}
          </span>
          {wideCatalog && course?.title && (
            <span style={{
              flex: 1, minWidth: 0, fontSize: nodeFz, color: "var(--text-5)",
              fontWeight: 400, userSelect: "none",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {courseTitle}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (r.type === "RANGE") return (
    <div style={{ display: "flex", alignItems: "center", gap: rowGap, paddingLeft: pl + baseIndent, marginBottom: rowMB, opacity: dimmed ? 0.4 : 1 }}>
      <CheckBox sat={r.sat} dimmedCheck={dimmed} />
      <span style={{ fontSize: nodeFz, color: r.sat ? "var(--text-2)" : "var(--text-4)" }}>
        {r.sat ? `${r.matched.slice(0, 3).join(", ")}${r.matched.length > 3 ? ` +${r.matched.length - 3}` : ""} (${r.subject} range)` : r.label}
      </span>
    </div>
  );

  if (r.type === "XOM") {
    const has = r.children?.length > 0;
    return (
      <div style={{ paddingLeft: pl, marginBottom: rowMB, opacity: dimmed ? 0.4 : 1 }}>
        <div onClick={(e) => { e.stopPropagation(); has && setOpen(v => !v); }}
          style={{ display: "flex", alignItems: "center", gap: rowGap, paddingLeft: baseIndent, cursor: has ? "pointer" : "default", userSelect: "none" }}>
          <CheckBox sat={r.sat} dimmedCheck={dimmed} />
          <span style={{ fontSize: nodeFz, fontWeight: 600, color: r.sat ? "var(--text-2)" : "var(--text-3)", flex: 1 }}>
            {r.satSh}/{r.reqSh} SH from elective pool
          </span>
          {has && <span style={{ fontSize: nodeFz - 1, color: "var(--text-5)" }}>{open ? "▼" : "▶"}</span>}
        </div>
        {open && has && <div style={{ marginTop: 3 }}>
          {r.children.map((c, i) => <ReqNode key={i} r={c} depth={depth + 1} dimmed={r.sat && !c.sat} />)}
        </div>}
      </div>
    );
  }

  // AND / OR / nested SECTION
  const has = r.children?.length > 0;
  const { t } = useLanguage(); // Moved this line to the top of the function
  const heading =
    r.type === "AND" ? t("grad.allOf", { count: r.satCount ?? 0, total: r.total ?? 0 }) :
    r.type === "OR"  ? t("grad.oneOf", { count: r.satCount ?? 0, total: r.total ?? 0 }) :
    sectionHeading || (r.label ?? "");

  return (
    <div style={{ paddingLeft: pl, marginBottom: rowMB, opacity: dimmed ? 0.4 : 1 }}>
      <div onClick={(e) => { e.stopPropagation(); has && setOpen(v => !v); }}
        style={{ display: "flex", alignItems: "center", gap: rowGap, paddingLeft: baseIndent, cursor: has ? "pointer" : "default", userSelect: "none" }}>
        <CheckBox sat={r.sat} dimmedCheck={dimmed} />
        <span style={{ fontSize: nodeFz, fontWeight: 600, color: r.sat ? "var(--text-2)" : "var(--text-3)", flex: 1 }}>{heading}</span>
        {has && <span style={{ fontSize: nodeFz - 1, color: "var(--text-5)" }}>{open ? "▼" : "▶"}</span>}
      </div>
      {open && has && <div style={{ marginTop: 3 }}>
        {r.children.map((c, i) => <ReqNode key={i} r={c} depth={depth + 1} dimmed={r.type === "OR" && r.sat && !c.sat} />)}
      </div>}
    </div>
  );
}

// ── Section accordion ────────────────────────────────────────────

function SectionBlock({ sec, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  const ctx = useContext(GradCtx);
  const ph  = ctx?.isPhone;
  const { t } = useLanguage(); // Added this line to use t in this function
  const secTitle = useTranslatedText(sec.title);

  // For pool structures (minRequired < total): display requirement satisfaction, not option count
  const isPoolStructure = sec.minRequired !== undefined && sec.minRequired < sec.total;
  const displaySatCount = isPoolStructure ? Math.min(sec.satCount, sec.minRequired) : sec.satCount;
  const displayTotal = isPoolStructure ? sec.minRequired : sec.total;

  const frac = displayTotal > 0 ? displaySatCount / displayTotal : 0;

  return (
    <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: ph ? 5 : 7, marginBottom: ph ? 5 : 7 }}>
      {/* Clickable header — no background, just text */}
      <div onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }} style={{
        display: "flex", alignItems: "center", gap: ph ? 4 : 6,
        cursor: "pointer", userSelect: "none",
      }}>
        <CheckBox sat={sec.sat} />
        <span style={{ flex: 1, fontSize: ph ? 9 : 10, fontWeight: 700, color: sec.sat ? "var(--text-2)" : "var(--text-3)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {secTitle}
        </span>
        <span style={{ fontSize: ph ? 8 : 9, color: "var(--text-5)", marginRight: 2 }}>{displaySatCount}/{displayTotal}</span>
        <span style={{ fontSize: ph ? 8 : 9, color: "var(--text-5)" }}>{open ? "▼" : "▶"}</span>
      </div>
      {/* Progress sliver */}
      <div style={{ marginTop: 3 }}>
        <ProgressBar frac={frac} color={sec.sat ? "var(--success)" : "var(--success-bar-partial)"} />
      </div>
      {/* Requirements */}
      {open && (
        <div style={{ paddingTop: ph ? 4 : 5 }}>
          {sec.warnings?.map((w, i) => (
            <div key={i} style={{ fontSize: ph ? 8 : 9, color: "var(--warn-bright)", marginBottom: ph ? 3 : 4, paddingLeft: 4, borderLeft: "2px solid var(--warn-bright)" }}>
              ⚠ {w}
            </div>
          ))}
          {sec.children.map((r, i) => (
            <ReqNode key={i} r={r} dimmed={isPoolStructure && !r.sat && sec.satCount >= sec.minRequired} />
          ))}
          {isPoolStructure && sec.minRequired > 0 && (
            <div style={{ fontSize: ph ? 8 : 9, color: "var(--text-5)", marginTop: ph ? 3 : 4, paddingLeft: 4, fontStyle: "italic" }}>
              {t("grad.requiresOutOf", { count: sec.minRequired, total: sec.children?.length ?? sec.total })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── NUPath grid ──────────────────────────────────────────────────

function NuPathGrid({ covered }) {
  const { isPhone, attributeSystem } = useContext(GradCtx);
  return (
    <div style={{
      display: "grid",
      // Phone: 3 equal columns → 5 rows, cells naturally wider than tall.
      // Desktop: auto-fit as before.
      gridTemplateColumns: isPhone
        ? "repeat(3, 1fr)"
        : "repeat(auto-fit, minmax(130px, 1fr))",
      width: "100%",
      boxSizing: "border-box",
      gap: isPhone ? 2 : 3,
      marginBottom: 6,
    }}>
      {attributeSystem.getGridCodes().map(key => {
        const sat = covered.has(key);
        return (
          <div key={key} style={{
            display: "flex", alignItems: "center", justifyContent: isPhone ? "center" : "flex-start",
            gap: isPhone ? 0 : 4,
            // Natural height with modest vertical padding — wider than tall.
            padding: isPhone ? "4px 2px" : "3px 5px",
            borderRadius: isPhone ? 3 : 4,
            fontSize: 9,
            background: "var(--bg-surface)",
            border: `1px solid ${sat ? "var(--nupath-sat-border)" : "var(--border-2)"}`,
            color: sat ? "var(--nupath-sat-text)" : "var(--text-5)",
            fontWeight: sat ? 700 : 400,
          }}>
            <span style={{
              flexShrink: 0, fontWeight: 800,
              fontSize: isPhone ? 8.5 : 9,
              lineHeight: 1,
              color: sat ? "var(--nupath-sat-text)" : "var(--text-4)",
            }}>{key}</span>
            {!isPhone && (
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {attributeSystem.getLabel(key)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Minor block (loads + validates a minor's requirement sections) ─

function MinorBlock({ path, onClear, placedSet, doneSet, label = "MINOR" }) {
  const { courseMap, majorRequirements, isPhone } = useContext(GradCtx);
  const [minor, setMinor] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const minorName = useTranslatedText(minor?.name ?? null);

  useEffect(() => {
    if (!path) { setMinor(null); setErr(null); return; }
    setLoading(true); setErr(null);
    majorRequirements.loadMinor(path)
      .then(setMinor)
      .catch(e => {
        if (e.message.includes('not found in registry')) {
          onClear?.();
        } else {
          setErr(e.message);
        }
      })
      .finally(() => setLoading(false));
  }, [path]);

  const sections = useMemo(() => {
    if (!minor) return [];
    const minorSections = (minor.requirementSections ?? []).filter(
      section => section.title !== 'Required General Electives'
    );
    return allocateSections(minorSections, placedSet, new Set(), courseMap);
  }, [minor, placedSet, courseMap]);

  const doneSections = useMemo(() => {
    if (!minor || !doneSet) return [];
    const minorSections = (minor.requirementSections ?? []).filter(
      section => section.title !== 'Required General Electives'
    );
    return allocateSections(minorSections, doneSet, new Set(), courseMap);
  }, [minor, doneSet, courseMap]);

  // Sum using the SAME logic as SectionBlock's display numbers
  const { totalSat, totalReq, doneSat } = useMemo(() => {
    let sumSat = 0, sumReq = 0, sumDone = 0;
    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      const isPoolStructure = sec.minRequired !== undefined && sec.minRequired < (sec.total ?? 0);
      const displayTotal = isPoolStructure ? sec.minRequired : (sec.total ?? 0);
      if (displayTotal > 0) {
        sumSat += isPoolStructure ? Math.min(sec.satCount ?? 0, sec.minRequired) : (sec.satCount ?? 0);
        sumReq += displayTotal;
        if (doneSections[i]) {
          const ds = doneSections[i];
          sumDone += isPoolStructure ? Math.min(ds.satCount ?? 0, sec.minRequired) : (ds.satCount ?? 0);
        }
      }
    }
    return { totalSat: sumSat, totalReq: sumReq, doneSat: sumDone };
  }, [sections, doneSections]);

  const plannedSat = totalSat - doneSat;
  const showBar = totalReq > 0;

  if (!path) return null;
  if (loading) return <div style={{ fontSize: 9, color: "var(--text-5)", padding: "6px 0" }}>Loading…</div>;
  if (err) return <div style={{ fontSize: 9, color: "var(--error-text)" }}>Error: {err}</div>;
  if (!minor) return null;

  return (
    <div style={{ border: "1px solid var(--border-1)", borderRadius: 6, marginBottom: 10 }}>
      {/* Header row: label + triangle toggle */}
      <div onClick={() => setExpanded(v => !v)} style={{ display: "flex", alignItems: "flex-start", padding: "8px 10px 0", cursor: "pointer", userSelect: "none" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: isPhone ? 8 : 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.05em" }}>
            {label}
            {minor.metadata?.verified && (
              <span style={{ marginLeft: 6, fontSize: 8, background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)", borderRadius: 99, padding: "1px 5px" }}>verified</span>
            )}
          </div>
          <div style={{ fontWeight: 400, color: "var(--text-2)", fontSize: isPhone ? 7 : 10, marginTop: 2 }}>{minorName}</div>
        </div>
        <span style={{ fontSize: 9, color: "var(--text-5)", marginTop: 2, flexShrink: 0 }}>{expanded ? "▼" : "▶"}</span>
      </div>

      {/* Progress bar — always visible */}
      {showBar && (
        <div style={{ padding: "6px 10px 8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-5)", marginBottom: 4 }}>
            <span>
              <span style={{ color: "var(--success)" }}>{doneSat}</span>
              {plannedSat > 0 && <span style={{ color: "var(--link-1)" }}>+{plannedSat}</span>}
              <span>/{totalReq}</span>
            </span>
            <span>{Math.round(totalSat / totalReq * 100)}%</span>
          </div>
          <div style={{ position: "relative", height: 6, borderRadius: 3, background: "var(--border-2)" }}>
            {plannedSat > 0 && <div style={{ position: "absolute", left: 0, width: `${Math.min(100, totalSat / totalReq * 100)}%`, height: "100%", background: "var(--link-1)", borderRadius: 3, opacity: 0.45 }} />}
            {doneSat > 0 && <div style={{ position: "absolute", left: 0, width: `${Math.min(100, doneSat / totalReq * 100)}%`, height: "100%", background: "var(--success)", borderRadius: 3, transition: "width 0.2s" }} />}
          </div>
        </div>
      )}

      {/* Sections — collapsible */}
      {expanded && (
        <div style={{ padding: "0 10px 10px" }}>
          {sections.map((sec, i) => <SectionBlock key={i} sec={sec} />)}
        </div>
      )}
    </div>
  );
}

// ── MajorCard: framed collapsible card for a major's requirements ─
// Frame is a subtle background tint (no border line) matching MinorBlock.
function MajorCard({ label, name, subtitle, verified, verifiedLabel, progress, expanded, onToggle, isPhone, loading, loadingLabel, children }) {
  return (
    <div style={{ border: "1px solid var(--border-1)", borderRadius: 6, marginBottom: 10 }}>
      {/* Header row: label + triangle toggle */}
      <div onClick={onToggle} style={{ display: "flex", alignItems: "flex-start", padding: "8px 10px 0", cursor: "pointer", userSelect: "none" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: isPhone ? 8 : 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.05em" }}>
            {label}
            {verified && (
              <span style={{ marginLeft: 6, fontSize: 8, background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)", borderRadius: 99, padding: "1px 5px" }}>{verifiedLabel}</span>
            )}
            {isPhone && <span style={{ fontSize: 6, color: "var(--text-5)", marginLeft: 4 }}>{expanded ? "▼" : "▶"}</span>}
          </div>
          <div style={{ fontWeight: 400, color: "var(--text-2)", fontSize: isPhone ? 7 : 10, marginTop: 2 }}>{name}</div>
          {subtitle && <div style={{ fontWeight: 400, color: "var(--text-4)", fontSize: isPhone ? 7 : 9, marginTop: 1 }}>{subtitle}</div>}
        </div>
        {!isPhone && progress.requiredSH > 0 && (
          <span style={{ fontSize: 9, color: "var(--text-5)", marginTop: 2, flexShrink: 0 }}>{progress.requiredSH} SH</span>
        )}
        {!isPhone && <span style={{ fontSize: 9, color: "var(--text-5)", marginTop: 2, flexShrink: 0, marginLeft: 4 }}>{expanded ? "▼" : "▶"}</span>}
      </div>

      {/* Progress bar — always visible */}
      {progress.totalReq > 0 && (
        <div style={{ padding: "6px 10px 8px" }}>
          <div style={{ fontSize: 10, color: "var(--text-5)", marginBottom: 4 }}>
            <span style={{ color: "var(--success)" }}>{progress.doneSat}</span>
            {(progress.totalSat - progress.doneSat) > 0 && <span style={{ color: "var(--link-1)" }}>+{progress.totalSat - progress.doneSat}</span>}
            <span> / {progress.totalReq}</span>
          </div>
          <div style={{ position: "relative", height: 6, borderRadius: 3, background: "var(--border-2)" }}>
            {(progress.totalSat - progress.doneSat) > 0 && <div style={{ position: "absolute", left: 0, width: `${Math.min(100, progress.totalSat / progress.totalReq * 100)}%`, height: "100%", background: "var(--link-1)", borderRadius: 3, opacity: 0.45 }} />}
            {progress.doneSat > 0 && <div style={{ position: "absolute", left: 0, width: `${Math.min(100, progress.doneSat / progress.totalReq * 100)}%`, height: "100%", background: "var(--success)", borderRadius: 3, transition: "width 0.2s" }} />}
          </div>
        </div>
      )}

      {/* Requirement sections — collapsible */}
      {expanded && (
        <div style={{ padding: "0 10px 10px" }}>
          {loading
            ? <div style={{ fontSize: 9, color: "var(--text-5)", padding: "6px 0", textAlign: "center" }}>{loadingLabel}</div>
            : children
          }
        </div>
      )}
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────

export default function GradPanel({ wideCatalog = false }) {
  const institution = usePort(IInstitution);
  const pfx = institution.storagePrefix;

  const [showProgram, setShowProgram] = useState(() => {
    try { const v = localStorage.getItem(`${pfx}-grad-show-program`); return v === null ? true : v !== "false"; } catch { return true; }
  });
  const {
    placements, placedOut, effectivePlacements, courseMap, totalSHPlaced, totalSHDone, onDragStart, selectedId, setSelectedId, setShowPanel, isPhone,
    specialTermPl,
    major: majorPath, setMajor: setMajorPath,
    major2: major2Path, setMajor2: setMajor2Path,
    conc: selConc, setConc: setSelConc,
    minor1, setMinor1,
    minor2, setMinor2,
    getSemStatus,
  } = usePlanner();

  const selPath    = majorPath || "";
  const setSelPath = setMajorPath;

  const attributeSystem   = usePort(IAttributeSystem);
  const majorRequirements = usePort(IMajorRequirements);
  const specialTerms      = usePort(ISpecialTerms);
  const creditSystem      = usePort(ICreditSystem);
  const unitName          = creditSystem.getUnitName();
  const { t } = useLanguage();

  const majorGroups  = useMemo(() => majorRequirements.getMajorOptionGroups(), [majorRequirements]);

  // Translated major name + concentration (no-ops when translation disabled or in source locale).
  const minorGroups  = useMemo(() => majorRequirements.getMinorOptionGroups(), [majorRequirements]);

  const [major,          setMajor]          = useState(null);
  const [loadErr,        setLoadErr]        = useState(null);
  const [fetching,       setFetching]       = useState(false);
  const [newerMajorPath, setNewerMajorPath] = useState(null);
  const majorName = useTranslatedText(major?.name ?? null);
  const concName  = useTranslatedText(selConc || null);

  const [major2Data,    setMajor2Data]    = useState(null);
  const [fetching2,     setFetching2]     = useState(false);
  const major2Name = useTranslatedText(major2Data?.name ?? null);
  const [showMajor2,    setShowMajor2]    = useState(() => major2Path !== "");
  const [showNP,        setShowNP]        = useState(() => {
    try { const v = localStorage.getItem(`${pfx}-grad-show-np`); return v === null ? true : v !== "false"; } catch { return true; }
  });
  const [expandMajor1,  setExpandMajor1]  = useState(() => {
    try { const v = localStorage.getItem(`${pfx}-grad-expand-major1`); return v === null ? true : v !== "false"; } catch { return true; }
  });
  const [expandMajor2,  setExpandMajor2]  = useState(() => {
    try { const v = localStorage.getItem(`${pfx}-grad-expand-major2`); return v === null ? true : v !== "false"; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem(`${pfx}-grad-show-program`,   String(showProgram));  } catch {} }, [showProgram]);
  useEffect(() => { try { localStorage.setItem(`${pfx}-grad-show-np`,        String(showNP));       } catch {} }, [showNP]);
  useEffect(() => { try { localStorage.setItem(`${pfx}-grad-expand-major1`,  String(expandMajor1)); } catch {} }, [expandMajor1]);
  useEffect(() => { try { localStorage.setItem(`${pfx}-grad-expand-major2`,  String(expandMajor2)); } catch {} }, [expandMajor2]);

  // Fetch major JSON on path change
  useEffect(() => {
    if (!selPath) { setMajor(null); setLoadErr(null); setNewerMajorPath(null); return; }
    setFetching(true); setLoadErr(null); setMajor(null); setSelConc(""); setNewerMajorPath(null);
    majorRequirements.loadMajor(selPath)
      .then(data => { setMajor(data); setNewerMajorPath(findNewerMajorVersion(selPath)); })
      .catch(e => {
        if (e.message.includes('not found in registry')) {
          // Stale path from an old plan — clear it silently so the user can pick a new major
          setSelPath("");
        } else {
          setLoadErr(e.message);
        }
      })
      .finally(() => setFetching(false));
  }, [selPath]);

  // Reset concentration if not available in newly loaded major
  useEffect(() => {
    if (!major || !selConc) return;
    const opts = major.concentrations?.concentrationOptions ?? [];
    if (!opts.find(c => c.title === selConc)) setSelConc("");
  }, [major]);

  // Fetch second major JSON on path change
  useEffect(() => {
    if (!major2Path) { setMajor2Data(null); return; }
    setFetching2(true); setMajor2Data(null);
    majorRequirements.loadMajor(major2Path)
      .then(data => setMajor2Data(data))
      .catch(() => setMajor2Path(""))
      .finally(() => setFetching2(false));
  }, [major2Path]);

  const placedSet = useMemo(
    () => buildPlacedKeySet(effectivePlacements, placedOut, courseMap),
    [effectivePlacements, placedOut, courseMap]
  );

  const doneSet = useMemo(() => {
    const donePlacements = Object.fromEntries(
      Object.entries(effectivePlacements).filter(([, semId]) => getSemStatus(semId) === "completed")
    );
    return buildPlacedKeySet(donePlacements, placedOut, courseMap);
  }, [effectivePlacements, placedOut, courseMap, getSemStatus]);

  const concGroups = useMemo(() => {
    const opts = (major?.concentrations?.concentrationOptions ?? []).map(c => ({ path: c.title, label: c.title }));
    return new Map([["Concentrations", opts]]);
  }, [major]);

  const npCovered  = useMemo(() => attributeSystem.getCoverage(placements, courseMap, computeGrantedAttrs(specialTermPl, specialTerms?.getTypes() ?? [])), [attributeSystem, placements, courseMap, specialTermPl, specialTerms]);
  const plannedSH  = totalSHPlaced - totalSHDone;
  const requiredSH = major?.totalCreditsRequired ?? 0;

    // ── Build combined sections (major + concentration) ─────────────────
  const allSections = useMemo(() => {
    if (!major) return [];
    const sections = [...(major.requirementSections ?? [])];
    if (selConc && major.concentrations) {
      const concSec = major.concentrations.concentrationOptions.find(c => c.title === selConc);
      if (concSec) sections.push(concSec);
    }
    return sections;
  }, [major, selConc]);

  // ── Allocate all sections together (shared used set) ────────────────
  // Major gets General Electives automatically appended
  const allocatedSections = useMemo(() => {
    if (!major) return [];

    // Allocate major requirements + General Electives
    const { sections: majorResults, generalElectives, allocatedSet } = allocateMajorWithElectives(major, placedSet, courseMap);

    // Add General Electives as the last major section
    const majorWithElectives = [...majorResults, generalElectives];

    // Allocate concentration sharing the major's used set so courses already
    // counted toward major requirements can't also satisfy the concentration.
    if (selConc && major.concentrations) {
      const concSection = major.concentrations.concentrationOptions.find(c => c.title === selConc);
      if (concSection) {
        const concResults = allocateSections([concSection], placedSet, allocatedSet, courseMap);
        return [...majorWithElectives, ...concResults];
      }
    }

    return majorWithElectives;
  }, [allSections, placedSet, courseMap, major, selConc]);

  // Split back for display: major sections (including General Electives) and concentration (if any)
  const majorSectionsCount = major?.requirementSections?.length ?? 0;
  const majorSections = allocatedSections.slice(0, majorSectionsCount + 1); // +1 for General Electives
  const concSection = allocatedSections.length > majorSectionsCount + 1 ? allocatedSections[majorSectionsCount + 1] : null;

  // Done-only allocation for Major 1 progress bar (uses doneSet instead of placedSet)
  const major1DoneSections = useMemo(() => {
    if (!major) return [];
    const { sections, generalElectives } = allocateMajorWithElectives(major, doneSet, courseMap);
    return [...sections, generalElectives].slice(0, majorSectionsCount + 1);
  }, [major, doneSet, courseMap, majorSectionsCount]);

  const major1Progress = useMemo(() => {
    let totalSat = 0, totalReq = 0, doneSat = 0;
    for (let i = 0; i < majorSections.length; i++) {
      const sec = majorSections[i];
      const isPool = sec.minRequired !== undefined && sec.minRequired < (sec.total ?? 0);
      const displayTotal = isPool ? sec.minRequired : (sec.total ?? 0);
      if (displayTotal > 0) {
        totalSat += isPool ? Math.min(sec.satCount ?? 0, sec.minRequired) : (sec.satCount ?? 0);
        totalReq += displayTotal;
        const ds = major1DoneSections[i];
        if (ds) doneSat += isPool ? Math.min(ds.satCount ?? 0, sec.minRequired) : (ds.satCount ?? 0);
      }
    }
    return { totalSat, totalReq, doneSat, completedSH: totalSHDone, plannedSH: totalSHPlaced - totalSHDone, requiredSH: major?.totalCreditsRequired ?? 0 };
  }, [majorSections, major1DoneSections, totalSHDone, totalSHPlaced, major]);

  // ── Second major allocation (courses double-count freely per NU policy) ─
  const major2Sections = useMemo(() => {
    if (!major2Data) return [];
    const { sections, generalElectives } = allocateMajorWithElectives(major2Data, placedSet, courseMap);
    return [...sections, generalElectives];
  }, [major2Data, placedSet, courseMap]);

  const major2DoneSections = useMemo(() => {
    if (!major2Data) return [];
    const { sections, generalElectives } = allocateMajorWithElectives(major2Data, doneSet, courseMap);
    return [...sections, generalElectives];
  }, [major2Data, doneSet, courseMap]);

  const major2Progress = useMemo(() => {
    let totalSat = 0, totalReq = 0, doneSat = 0;
    for (let i = 0; i < major2Sections.length; i++) {
      const sec = major2Sections[i];
      const isPool = sec.minRequired !== undefined && sec.minRequired < (sec.total ?? 0);
      const displayTotal = isPool ? sec.minRequired : (sec.total ?? 0);
      if (displayTotal > 0) {
        totalSat += isPool ? Math.min(sec.satCount ?? 0, sec.minRequired) : (sec.satCount ?? 0);
        totalReq += displayTotal;
        const ds = major2DoneSections[i];
        if (ds) doneSat += isPool ? Math.min(ds.satCount ?? 0, sec.minRequired) : (ds.satCount ?? 0);
      }
    }
    return { totalSat, totalReq, doneSat, completedSH: totalSHDone, plannedSH: totalSHPlaced - totalSHDone, requiredSH: major2Data?.totalCreditsRequired ?? 0 };
  }, [major2Sections, major2DoneSections, totalSHDone, totalSHPlaced, major2Data]);

  const satSections = majorSections.filter(s => s.sat).length;
  const overallFrac = majorSections.length > 0 ? satSections / majorSections.length : 0;

  return (
    <GradCtx.Provider value={{ courseMap, onDragStart, selectedId, setSelectedId, setShowPanel, isPhone, attributeSystem, majorRequirements, wideCatalog }}>
      <div style={{ overflowY: "auto", overflowX: "hidden", height: "100%", padding: isPhone ? "6px 5px 40px" : "9px 9px 40px" }}>

        {/* ── Program selection (collapsible) ─────────────────── */}
        <div style={{ marginBottom: 10, position: "relative" }}>
          {/* Collapsed: show header with triangle and text */}
          <div
            onClick={() => setShowProgram(v => !v)}
            style={{
              display: "flex", alignItems: "center", gap: 5, cursor: "pointer",
              marginBottom: showProgram ? 4 : 0, userSelect: "none",
            }}
          >
            <span style={{ fontWeight: 400, color: "var(--text-5)", fontSize: isPhone ? 9 : 11, flex: 1 }}>{t("grad.programSelection")}</span>
            <span style={{ fontSize: 9, color: "var(--text-5)", lineHeight: 1 }}>{showProgram ? "▼" : "▶"}</span>
          </div>
          {showProgram && (
            <>
              {/* Major selector */}
              <div style={{ marginBottom: 3 }}>
                <div style={{ fontSize: isPhone ? 8 : 10, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.05em", marginBottom: 4 }}>
                  {showMajor2 ? t("grad.major1.label") : t("grad.major.label")}
                </div>
                <SearchCombo
                  value={selPath}
                  onChange={setSelPath}
                  groups={majorGroups}
                  placeholder={isPhone ? t("grad.major.search.short") : t("grad.major.search")}
                />
                {newerMajorPath && (
                  <div style={{
                    marginTop: 4, padding: "5px 7px", borderRadius: 4,
                    background: "var(--info-bg, var(--border-2))",
                    border: "1px solid var(--info-border, var(--border-3))",
                    display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
                    fontSize: isPhone ? 8 : 9,
                  }}>
                    <span style={{ color: "var(--text-2)", flex: 1 }}>
                      A {newerMajorPath.match(/\/(\d{4})\//)?.[1]} version of this major is available.
                    </span>
                    <button
                      onClick={() => setSelPath(newerMajorPath)}
                      style={{
                        fontSize: isPhone ? 7 : 8, padding: "2px 7px", cursor: "pointer",
                        borderRadius: 3, border: "1px solid var(--accent)",
                        background: "var(--accent)", color: "white", fontWeight: 600,
                      }}
                    >
                      Switch
                    </button>
                    <button
                      onClick={() => setNewerMajorPath(null)}
                      style={{
                        fontSize: isPhone ? 7 : 8, padding: "2px 7px", cursor: "pointer",
                        borderRadius: 3, border: "1px solid var(--border-3)",
                        background: "transparent", color: "var(--text-4)",
                      }}
                    >
                      Keep
                    </button>
                  </div>
                )}
              </div>

              {/* Concentration selector */}
              {major?.concentrations?.concentrationOptions?.length > 0 && (
                <div style={{ marginBottom: 8, marginTop: 8 }}>
                  <div style={{ fontSize: isPhone ? 8 : 10, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.05em", marginBottom: 4 }}>
                    {t("grad.conc.label")}
                  </div>
                  <SearchCombo value={selConc} onChange={setSelConc} groups={concGroups} placeholder={isPhone ? t("grad.major.search.short") : t("grad.conc.search")} />
                  {major.concentrations.minOptions > 0 && !selConc && (
                    <div style={{ fontSize: 9, color: "var(--warn-bright)", marginTop: 3 }}>
                      ⚠ {major.concentrations.minOptions} concentration{major.concentrations.minOptions > 1 ? "s" : ""} required
                    </div>
                  )}
                </div>
              )}

              {/* Second major selector */}
              {showMajor2 ? (
                <div style={{ marginBottom: 8, marginTop: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
                    <div style={{ fontSize: isPhone ? 8 : 10, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.05em", flex: 1 }}>{t("grad.major2.label")}</div>
                    <button
                      onClick={() => { setMajor2Path(""); setShowMajor2(false); }}
                      style={{ background: "transparent", border: "none", color: "var(--text-5)", fontSize: 12, cursor: "pointer", lineHeight: 1, padding: "0 2px" }}
                      title="Remove second major"
                    >✕</button>
                  </div>
                  <SearchCombo value={major2Path} onChange={setMajor2Path} groups={majorGroups} placeholder={isPhone ? t("grad.major.search.short") : t("grad.major.search")} />
                </div>
              ) : (
                <button
                  onClick={() => setShowMajor2(true)}
                  style={{
                    display: "block", width: "100%", marginTop: 6, marginBottom: 8,
                    padding: "4px 0", background: "transparent",
                    border: "1px dashed var(--border-3)", borderRadius: 4,
                    color: "var(--text-5)", fontSize: isPhone ? 8 : 9,
                    cursor: "pointer", textAlign: "center",
                  }}
                >{t("grad.major2.add")}</button>
              )}

              {/* Minor selectors */}
              <div style={{ display: "grid", gridTemplateColumns: isPhone ? "1fr" : "repeat(auto-fit, minmax(120px, 1fr))", gap: isPhone ? 4 : 6, marginTop: 8, marginBottom: 8, width: "100%", boxSizing: "border-box", overflow: "hidden" }}>
                {[[t("grad.minor1.label"), minor1, setMinor1], [t("grad.minor2.label"), minor2, setMinor2]].map(([lbl, val, set]) => (
                  <div key={lbl} style={{ minWidth: 0, overflow: "hidden" }}>
                    <div style={{ fontSize: isPhone ? 7 : 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", marginBottom: 3 }}>{lbl}</div>
                    <SearchCombo value={val} onChange={set} groups={minorGroups} placeholder={isPhone ? t("grad.major.search.short") : t("grad.minor.search")} />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── Attribute grid — hidden when adapter has no attributes ── */}
        {attributeSystem.getGridCodes().length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div onClick={(e) => { e.stopPropagation(); setShowNP(v => !v); }} style={{
            display: "flex", alignItems: "center", gap: 5, cursor: "pointer", marginBottom: 4, userSelect: "none",
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.05em", flex: 1 }}>
              {attributeSystem.getSystemName()} <span style={{ fontWeight: 400, color: "var(--text-5)" }}>({npCovered.size}/{attributeSystem.getGridCodes().length})</span>
            </span>
            <span style={{ fontSize: 9, color: "var(--text-5)" }}>{showNP ? "▼" : "▶"}</span>
          </div>
          {showNP && <NuPathGrid covered={npCovered} />}
        </div>
        )}

        {/* ── Loading / error ─────────────────────────────────── */}
        {fetching && (
          <div style={{ fontSize: 10, color: "var(--text-4)", padding: "12px 0", textAlign: "center" }}>{t("grad.loading")}</div>
        )}
        {loadErr && (
          <div style={{ fontSize: 10, color: "var(--error-text)", background: "var(--error-bg)", border: "1px solid var(--error)", borderRadius: 4, padding: "6px 8px", marginBottom: 8 }}>
            Error: {loadErr}
          </div>
        )}

        {/* ── Major 1 framed card ──────────────────────────────── */}
        {major && !fetching && <MajorCard
          label={showMajor2 ? t("grad.major1.label") : t("grad.major.label")}
          name={majorName}
          subtitle={selConc ? concName : null}
          verified={!!major?.metadata?.verified}
          verifiedLabel={t("grad.verified")}
          progress={major1Progress}
          expanded={expandMajor1}
          onToggle={() => setExpandMajor1(v => !v)}
          isPhone={isPhone}
        >
          {majorSections.map((sec, i) => <SectionBlock key={i} sec={sec} />)}
          {concSection && (
            <>
              <div style={{ fontSize: isPhone ? 8 : 10, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.05em", marginBottom: 4, marginTop: 10 }}>
                {t("grad.conc.label")}
              </div>
              <SectionBlock sec={concSection} defaultOpen={true} />
            </>
          )}
        </MajorCard>}

        {/* ── Major 2 framed card ──────────────────────────────── */}
        {(major2Data || fetching2) && <MajorCard
          label={t("grad.major2.label")}
          name={major2Name}
          verified={!!major2Data?.metadata?.verified}
          verifiedLabel={t("grad.verified")}
          progress={major2Progress}
          expanded={expandMajor2}
          onToggle={() => setExpandMajor2(v => !v)}
          isPhone={isPhone}
          loading={fetching2}
          loadingLabel={t("grad.loading")}
        >
          {major2Sections.map((sec, i) => <SectionBlock key={i} sec={sec} />)}
        </MajorCard>}

        {/* ── Minor requirement sections ───────────────────────── */}
        <MinorBlock path={minor1} onClear={() => setMinor1("")} placedSet={placedSet} doneSet={doneSet} label={t("grad.minor1.label")} />
        <MinorBlock path={minor2} onClear={() => setMinor2("")} placedSet={placedSet} doneSet={doneSet} label={t("grad.minor2.label")} />

                {/* ── Empty state ──────────────────────────────────────── */}
        {!major && !major2Data && !minor1 && !minor2 && !fetching && !loadErr && (
          <div style={{ textAlign: "center", color: "var(--text-5)", fontSize: 10, paddingTop: 12, lineHeight: 1.7, whiteSpace: "pre-line" }}>
            {t("grad.empty")}
          </div>
        )}
      </div> {/* closes the main padding div */}
    </GradCtx.Provider> 
  ); 
} // closes the function