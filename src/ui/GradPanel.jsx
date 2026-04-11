// ═══════════════════════════════════════════════════════════════════
// GRAD PANEL  — graduation requirements sidebar
//
// Rendered by BankPanel as an XOR alternative to the course bank.
// Uses graduatenu Major2 JSON schema (local fork) + gradRequirements.js
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
import {
  buildPlacedKeySet,
  allocateMajor,
  allocateMajorWithElectives,
  allocateSections,
} from "../core/gradRequirements.js";

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
  const totalSH = completedSH + plannedSH;
  const maxSH   = Math.max(totalSH, requiredSH, 1);
  const reqFrac = requiredSH > 0 ? requiredSH / maxSH : 0;
  return (
    <div style={{ position: "relative", height: 6, borderRadius: 3, background: "var(--border-2)", overflow: "visible", margin: "4px 0" }}>
      {plannedSH > 0 && (
        <div style={{
          position: "absolute", left: 0,
          width: `${Math.min(100, totalSH / maxSH * 100)}%`,
          height: "100%", background: "var(--link-1)", borderRadius: 3, opacity: 0.45,
        }} />
      )}
      {completedSH > 0 && (
        <div style={{
          position: "absolute", left: 0,
          width: `${Math.min(100, completedSH / maxSH * 100)}%`,
          height: "100%", background: "var(--success)", borderRadius: 3,
        }} />
      )}
      {requiredSH > 0 && (
        <div style={{
          position: "absolute",
          left: `${Math.min(99.5, reqFrac * 100)}%`,
          top: -3, height: 12, width: 2,
          background: "var(--text-3)", borderRadius: 1,
          transform: "translateX(-50%)",
        }} />
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
  const { courseMap, onDragStart, setSelectedId, setShowPanel, selectedId, isPhone } = useContext(GradCtx);
  const pl               = depth * (isPhone ? 4 : 10);
  const rowMB            = isPhone ? 1 : 3;
  const nodeFz           = isPhone ? 8 : 10;
  const rowGap           = isPhone ? 3 : 5;
  const baseIndent       = isPhone ? 2 : 4;

  if (r.type === "COURSE") {
    const course    = courseMap?.[r.key];
    const isSelected = selectedId === r.key;
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
            style={{ fontSize: nodeFz, color: r.sat ? "var(--text-2)" : "var(--text-4)", fontWeight: r.sat ? 600 : 400, userSelect: "none",
              textDecoration: isSelected ? "underline" : hov ? "underline" : "none",
              textDecorationColor: "var(--text-4)",
              textUnderlineOffset: 2 }}>
            {displayLabel}
          </span>
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
          {has && <span style={{ fontSize: nodeFz - 1, color: "var(--text-5)" }}>{open ? "▲" : "▼"}</span>}
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
    r.title ?? r.label; // Ensure t is available for heading

  return (
    <div style={{ paddingLeft: pl, marginBottom: rowMB, opacity: dimmed ? 0.4 : 1 }}>
      <div onClick={(e) => { e.stopPropagation(); has && setOpen(v => !v); }}
        style={{ display: "flex", alignItems: "center", gap: rowGap, paddingLeft: baseIndent, cursor: has ? "pointer" : "default", userSelect: "none" }}>
        <CheckBox sat={r.sat} dimmedCheck={dimmed} />
        <span style={{ fontSize: nodeFz, fontWeight: 600, color: r.sat ? "var(--text-2)" : "var(--text-3)", flex: 1 }}>{heading}</span>
        {has && <span style={{ fontSize: nodeFz - 1, color: "var(--text-5)" }}>{open ? "▲" : "▼"}</span>}
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

  // For pool structures (minRequired < total): display requirement satisfaction, not option count
  const isPoolStructure = sec.minRequired !== undefined && sec.minRequired < sec.total;
  const displaySatCount = isPoolStructure ? Math.min(sec.satCount, sec.minRequired) : sec.satCount;
  const displayTotal = isPoolStructure ? sec.minRequired : sec.total;

  const frac = displayTotal > 0 ? displaySatCount / displayTotal : 0;

  return (
    <div style={{ marginBottom: ph ? 3 : 4, border: "1px solid var(--border-2)", borderRadius: 6, overflow: "hidden" }}>
      {/* Clickable header */}
      <div onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }} style={{
        display: "flex", alignItems: "center", gap: ph ? 4 : 6,
        padding: ph ? "3px 6px" : "5px 8px",
        cursor: "pointer", background: "var(--bg-surface)", userSelect: "none",
      }}>
        <CheckBox sat={sec.sat} />
        <span style={{ flex: 1, fontSize: ph ? 9 : 10, fontWeight: 700, color: sec.sat ? "var(--text-2)" : "var(--text-3)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {sec.title}
        </span>
        <span style={{ fontSize: ph ? 8 : 9, color: "var(--text-5)", marginRight: 2 }}>{displaySatCount}/{displayTotal}</span>
        <span style={{ fontSize: ph ? 8 : 9, color: "var(--text-5)" }}>{open ? "▲" : "▼"}</span>
      </div>
      {/* Progress sliver */}
      <div style={{ padding: ph ? "0 6px" : "0 8px", background: "var(--bg-surface)" }}>
        <ProgressBar frac={frac} color={sec.sat ? "var(--success)" : "var(--warn-bright)"} />
      </div>
      {/* Requirements */}
      {open && (
        <div style={{ padding: ph ? "4px 3px 3px" : "8px 6px 6px", background: "var(--bg-surface-2)" }}>
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

function MinorBlock({ path, placedSet, doneSet, label = "MINOR" }) {
  const { courseMap, majorRequirements } = useContext(GradCtx);
  const [minor, setMinor] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!path) { setMinor(null); setErr(null); return; }
    setLoading(true); setErr(null);
    majorRequirements.loadMinor(path)
      .then(setMinor)
      .catch(e => setErr(e.message))
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
    <>
      <div style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.05em", marginBottom: 4, marginTop: 12 }}>
        {label}
        <span style={{ fontWeight: 400, color: "var(--text-2)", marginLeft: 5 }}>{minor.name}</span>
        {minor.metadata?.verified && (
          <span style={{ marginLeft: 6, fontSize: 8, background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)", borderRadius: 99, padding: "1px 5px" }}>verified</span>
        )}
      </div>

      {showBar && (
        <div style={{
          border: "1px solid var(--border-2)",
          borderRadius: 4,
          padding: "4px 6px",
          margin: "6px 0 8px 0",
          background: "var(--bg-surface)"
        }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 8,
            color: "var(--text-5)",
            marginBottom: 4
          }}>
            <span>
              <span style={{ color: "var(--success)" }}>{doneSat}</span>
              {plannedSat > 0 && <span style={{ color: "var(--link-1)" }}>+{plannedSat}</span>}
              <span>/{totalReq}</span>
            </span>
            <span>{Math.round(totalSat / totalReq * 100)}%</span>
          </div>
          <div style={{ position: "relative", height: 6, borderRadius: 3, background: "var(--border-2)" }}>
            {plannedSat > 0 && (
              <div style={{
                position: "absolute", left: 0,
                width: `${Math.min(100, totalSat / totalReq * 100)}%`,
                height: "100%", background: "var(--link-1)", borderRadius: 3, opacity: 0.45,
              }} />
            )}
            {doneSat > 0 && (
              <div style={{
                position: "absolute", left: 0,
                width: `${Math.min(100, doneSat / totalReq * 100)}%`,
                height: "100%", background: "var(--success)", borderRadius: 3,
                transition: "width 0.2s",
              }} />
            )}
          </div>
        </div>
      )}

      {sections.map((sec, i) => <SectionBlock key={i} sec={sec} />)}
    </>
  );
}

// ── Main panel ───────────────────────────────────────────────────

export default function GradPanel() {
  const [showMajorDetails, setShowMajorDetails] = useState(false);
  const institution = usePort(IInstitution);
  const pfx = institution.storagePrefix;
  const [showProgram, setShowProgram] = useState(() => {
    try { const v = localStorage.getItem(`${pfx}-grad-show-program`); return v === null ? true : v !== "false"; } catch { return true; }
  });
  const {
    placements, placedOut, effectivePlacements, courseMap, totalSHPlaced, totalSHDone, onDragStart, selectedId, setSelectedId, setShowPanel, isPhone,
    specialTermPl,
    major: majorPath, setMajor: setMajorPath,
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
  const minorGroups  = useMemo(() => majorRequirements.getMinorOptionGroups(), [majorRequirements]);

  const [major,    setMajor]    = useState(null);
  const [loadErr,  setLoadErr]  = useState(null);
  const [fetching, setFetching] = useState(false);
  const [showNP,   setShowNP]   = useState(() => {
    try { const v = localStorage.getItem(`${pfx}-grad-show-np`); return v === null ? true : v !== "false"; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem(`${pfx}-grad-show-program`, String(showProgram)); } catch {} }, [showProgram]);
  useEffect(() => { try { localStorage.setItem(`${pfx}-grad-show-np`,      String(showNP));      } catch {} }, [showNP]);

  // Fetch major JSON on path change
  useEffect(() => {
    if (!selPath) { setMajor(null); setLoadErr(null); return; }
    setFetching(true); setLoadErr(null); setMajor(null); setSelConc("");
    majorRequirements.loadMajor(selPath)
      .then(setMajor)
      .catch(e => setLoadErr(e.message))
      .finally(() => setFetching(false));
  }, [selPath]);

  // Reset concentration if not available in newly loaded major
  useEffect(() => {
    if (!major || !selConc) return;
    const opts = major.concentrations?.concentrationOptions ?? [];
    if (!opts.find(c => c.title === selConc)) setSelConc("");
  }, [major]);

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
    const { sections: majorResults, generalElectives } = allocateMajorWithElectives(major, placedSet, courseMap);

    // Add General Electives as the last major section
    const majorWithElectives = [...majorResults, generalElectives];

    // Allocate concentration if present
    if (selConc && major.concentrations) {
      const concSection = major.concentrations.concentrationOptions.find(c => c.title === selConc);
      if (concSection) {
        const concResults = allocateSections([concSection], placedSet, new Set(), courseMap);
        return [...majorWithElectives, ...concResults];
      }
    }

    return majorWithElectives;
  }, [allSections, placedSet, courseMap, major, selConc]);

  // Split back for display: major sections (including General Electives) and concentration (if any)
  const majorSectionsCount = major?.requirementSections?.length ?? 0;
  const majorSections = allocatedSections.slice(0, majorSectionsCount + 1); // +1 for General Electives
  const concSection = allocatedSections.length > majorSectionsCount + 1 ? allocatedSections[majorSectionsCount + 1] : null;

  const satSections = majorSections.filter(s => s.sat).length;
  const overallFrac = majorSections.length > 0 ? satSections / majorSections.length : 0;

  return (
    <GradCtx.Provider value={{ courseMap, onDragStart, selectedId, setSelectedId, setShowPanel, isPhone, attributeSystem, majorRequirements }}>
      <div style={{ overflowY: "auto", overflowX: "hidden", height: "100%", padding: isPhone ? "6px 5px 40px" : "9px 9px 40px" }}>

        {/* ── Program selection (collapsible) ─────────────────── */}
        <div style={{ marginBottom: 10, position: "relative" }}>
          {/* Collapsed: show header with triangle and text */}
          {!showProgram && (
            <div
              onClick={() => setShowProgram(v => !v)}
              style={{
                display: "flex",
                alignItems: "center",
                cursor: "pointer",
                userSelect: "none",
                fontSize: isPhone ? 9 : 11,
                fontWeight: 500,
                color: "var(--text-4)",
                margin: 0,
                padding: 0,
                letterSpacing: 0,
                gap: 5,
              }}
            >
              <span style={{ fontSize: isPhone ? 9 : 10, color: "var(--text-5)", lineHeight: 1 }}>{"▶"}</span>
              <span style={{ fontWeight: 400, color: "var(--text-5)", fontSize: isPhone ? 9 : 11 }}>{t("grad.programSelection")}</span>
            </div>
          )}
          {/* Expanded: show triangle in upper right corner */}
          {showProgram && (
            <>
              <span
                onClick={() => setShowProgram(false)}
                style={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  fontSize: isPhone ? 9 : 10,
                  color: "var(--text-5)",
                  cursor: "pointer",
                  userSelect: "none",
                  padding: isPhone ? "2px 4px" : "3px 6px"
                }}
                title={t("grad.programSelection")}
              >
                ▼
              </span>
              {/* Major selector */}
              <div style={{ marginBottom: 3 }}>
                <div style={{ fontSize: isPhone ? 8 : 10, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.05em", marginBottom: 4 }}>
                  {t("grad.major.label")}
                </div>
                <SearchCombo
                  value={selPath}
                  onChange={setSelPath}
                  groups={majorGroups}
                  placeholder={isPhone ? t("grad.major.search.short") : t("grad.major.search")}
                />
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
            <span style={{ fontSize: 9, color: "var(--text-5)" }}>{showNP ? "▲" : "▼"}</span>
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

                {/* ── Major requirement sections ───────────────────────── */}
        {major && !fetching && (
          <>
            {/*
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: isPhone ? 3 : 5, marginTop: isPhone ? 2 : 4 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: isPhone ? 9 : 10, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.05em" }}>
                  {t("grad.requirements.title")}
                  <span style={{ fontWeight: 400, color: "var(--text-5)", marginLeft: 5 }}>
                    ({satSections}/{majorSections.length})
                  </span>
                </div>
                <div style={{ fontSize: isPhone ? 8 : 9, fontWeight: 600, color: "var(--text-2)", marginTop: 1 }}>
                  {major.name}
                  {major.metadata?.verified && (
                    <span style={{ marginLeft: 6, fontSize: 8, background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)", borderRadius: 99, padding: "1px 5px", verticalAlign: "middle" }}>
                      {t("grad.verified")}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ fontSize: isPhone ? 16 : 22, fontWeight: 900, lineHeight: 1, color: overallFrac === 1 ? "var(--success)" : "var(--text-1)" }}>
                {Math.round(overallFrac * 100)}%
              </div>
            </div>
            <ProgressBar frac={overallFrac} />
            */}
            <div>
              <div
                onClick={() => setShowMajorDetails(v => !v)}
                style={{
                  textAlign: "center",
                  fontSize: isPhone ? 10 : 12,
                  fontWeight: 700,
                  color: "var(--text-3)",
                  margin: isPhone ? "8px 0 4px 0" : "12px 0 7px 0",
                  letterSpacing: "0.05em",
                  cursor: "pointer",
                  userSelect: "none"
                }}
              >
                {t("grad.major.label")}
              </div>
              {showMajorDetails && (
                <div style={{ margin: isPhone ? "2px 0 6px 0" : "3px 0 8px 0", color: "var(--text-2)", fontWeight: 600, fontSize: isPhone ? 9 : 10, textAlign: "center" }}>
                  {major.name}
                  {selConc && <div style={{ fontWeight: 400, color: "var(--text-4)", fontSize: isPhone ? 8 : 9, marginTop: 2 }}>Concentration: {selConc}</div>}
                </div>
              )}
              
              {/* ── Credit bar — always visible ───────────────────────── */}
              <div style={{ marginBottom: 8, padding: "7px 9px", background: "var(--bg-surface)", border: "1px solid var(--border-2)", borderRadius: 6 }}>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginBottom: 4 }}>
                  <div>
                    <div style={{ fontSize: isPhone ? 12 : 16, fontWeight: 900, lineHeight: 1.1,
                      color: requiredSH > 0 && totalSHPlaced >= requiredSH ? "var(--success)" : "var(--text-1)" }}>
                      {totalSHDone}
                      {plannedSH  > 0 && <span style={{ fontSize: 11, color: "var(--text-4)", fontWeight: 500 }}>+{plannedSH}</span>}
                      {requiredSH > 0 && <span style={{ fontSize: 11, color: "var(--text-5)", fontWeight: 400 }}>/{requiredSH}</span>}
                    </div>
                    {!isPhone && (
                      <div style={{ fontSize: 9, color: "var(--text-4)" }}>
                        {t("grad.credits.done", { unit: unitName })}{plannedSH > 0 ? t("grad.credits.planned") : ""}{requiredSH > 0 ? t("grad.credits.required") : ""}
                      </div>
                    )}
                  </div>
                  {major && !isPhone && (
                    <div style={{ marginLeft: "auto", textAlign: "right" }}>
                      {/* 
                      // catalog year
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)" }}>{major.yearVersion}</div>
                      <div style={{ fontSize: 9, color: "var(--text-4)" }}>catalog</div> */}
                    </div>
                  )}
                </div>
                <CreditBar completedSH={totalSHDone} plannedSH={plannedSH} requiredSH={requiredSH} />
                {/* 
                // Legend for progress bar
                {!isPhone && (
                <div style={{ display: "flex", gap: 10, marginTop: 3 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 1, background: "var(--success)" }} />
                    <span style={{ fontSize: 8.5, color: "var(--text-5)" }}>completed</span>
                  </div>
                  {plannedSH > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 1, background: "var(--link-1)", opacity: 0.65 }} />
                      <span style={{ fontSize: 8.5, color: "var(--text-5)" }}>planned</span>
                    </div>
                  )}
                  {requiredSH > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                      <div style={{ width: 2, height: 8, borderRadius: 1, background: "var(--text-3)" }} />
                      <span style={{ fontSize: 8.5, color: "var(--text-5)" }}>required</span>
                    </div>
                  )}
                </div>
                )} */}
              </div>
              
              <div style={{ marginTop: 8 }}>
                {majorSections.map((sec, i) => <SectionBlock key={i} sec={sec} />)}
              </div>
            </div>


            {/* Concentration */}
            {concSection && (
              <>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.05em", marginBottom: 4, marginTop: 10 }}>
                  {t("grad.conc.label")}
                </div>
                <SectionBlock sec={concSection} defaultOpen={true} />
              </>
            )}
          </>
        )}

        {/* ── Minor requirement sections ───────────────────────── */}
        <MinorBlock path={minor1} placedSet={placedSet} doneSet={doneSet} label={t("grad.minor1.label")} />
        <MinorBlock path={minor2} placedSet={placedSet} doneSet={doneSet} label={t("grad.minor2.label")} />

                {/* ── Empty state ──────────────────────────────────────── */}
        {!major && !minor1 && !minor2 && !fetching && !loadErr && (
          <div style={{ textAlign: "center", color: "var(--text-5)", fontSize: 10, paddingTop: 12, lineHeight: 1.7, whiteSpace: "pre-line" }}>
            {t("grad.empty")}
          </div>
        )}
      </div> {/* closes the main padding div */}
    </GradCtx.Provider> 
  ); 
} // closes the function