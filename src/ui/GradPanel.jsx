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
  allocateMajorWithElectives,
  allocateSections,
} from "../core/gradRequirements.js";
import { findNewerMajorVersion, findNewerGradMajorVersion } from "../data/majorLoader.js";

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

/** Two-segment bar: completed (green) + planned (blue), with an optional required-marker tick. */
function CreditBar({ completedSH, plannedSH, requiredSH, showLabel = true, style }) {
  const totalSH   = completedSH + plannedSH;
  const maxSH     = Math.max(totalSH, requiredSH, 1);
  const reqFrac   = requiredSH > 0 ? requiredSH / maxSH : 0;
  const totalFrac = totalSH / maxSH;
  return (
    <div style={{ position: "relative", height: 6, borderRadius: 3, background: "var(--border-2)", overflow: "visible", margin: "14px 0 4px", ...style }}>
      {plannedSH > 0 && (
        <div style={{ position: "absolute", left: 0, width: `${Math.min(100, totalFrac * 100)}%`, height: "100%", background: "var(--link-1)", borderRadius: 3, opacity: 0.45 }} />
      )}
      {completedSH > 0 && (
        <div style={{ position: "absolute", left: 0, width: `${Math.min(100, completedSH / maxSH * 100)}%`, height: "100%", background: "var(--success)", borderRadius: 3 }} />
      )}
      {requiredSH > 0 && (
        <div style={{ position: "absolute", left: `${Math.min(99.5, reqFrac * 100)}%`, top: -3, height: 12, width: 2, background: "var(--text-3)", borderRadius: 1, transform: "translateX(-50%)" }}>
          {showLabel && (
            <div style={{ position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%)", fontSize: 8, color: "var(--text-4)", whiteSpace: "nowrap", marginBottom: 2, lineHeight: 1 }}>
              {requiredSH}
            </div>
          )}
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
  const { isPhone } = useContext(GradCtx) ?? {};

  const updateRect = () => {
    if (inputRef.current) setRect(inputRef.current.getBoundingClientRect());
  };

  // Keep the portal dropdown pinned to the input as the layout shifts — most
  // importantly when the iOS keyboard pops up and scrolls the input, which
  // otherwise strands the dropdown at its stale focus-time position.
  useEffect(() => {
    if (!open) return;
    const onMove = () => updateRect();
    window.addEventListener("scroll", onMove, true); // capture nested scrolls (the panel)
    window.addEventListener("resize", onMove);
    window.visualViewport?.addEventListener("resize", onMove);
    window.visualViewport?.addEventListener("scroll", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      window.visualViewport?.removeEventListener("resize", onMove);
      window.visualViewport?.removeEventListener("scroll", onMove);
    };
  }, [open]);

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
      {open && rect && (() => {
        // On phone the grad panel is narrow, so widen the dropdown to nearly the
        // full screen (clamped to stay on-screen) instead of the cramped input
        // width. Cap the height to the space above the keyboard so every result
        // stays scrollable rather than hidden behind it.
        const M = 8;
        const vw = window.innerWidth;
        const vvH = window.visualViewport?.height ?? window.innerHeight;
        const dropW = isPhone ? Math.min(vw - M * 2, 460) : rect.width;
        const dropLeft = isPhone
          ? Math.max(M, Math.min(rect.left, vw - dropW - M))
          : rect.left;
        const dropMaxH = isPhone
          ? Math.max(150, Math.min(280, vvH - rect.bottom - 12))
          : 280;
        return createPortal(
        <div style={{
          position: "fixed",
          top: rect.bottom + 2,
          left: dropLeft,
          width: dropW,
          zIndex: 9000,
          maxHeight: dropMaxH, overflowY: "auto",
          WebkitOverflowScrolling: "touch",
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
      );
      })()}
    </div>
  );
}
// ── Requirement tree ─────────────────────────────────────────────

function XomGroupHeader({ title, style }) {
  const text = useTranslatedText(title);
  return <span style={style}>{text}</span>;
}

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
    // Single required course mis-encoded as XOM (scraper artifact: a credit-hour comment
    // row followed by exactly one course course). Render as a plain course row instead of
    // "X/Y SH from elective pool" — the pool framing is misleading when there's one option.
    const singleCourse = r.children?.length === 1 && r.children[0].type === 'COURSE'
      ? r.children[0]
      : null;
    if (singleCourse) {
      return <ReqNode r={{ ...singleCourse, sat: r.sat }} depth={depth} dimmed={dimmed} />;
    }

    const has = r.children?.length > 0;
    const hasGroups = r.groups?.length > 0;
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
          {hasGroups
            ? r.groups.map((g, gi) => (
                <div key={gi}>
                  <div style={{ paddingLeft: baseIndent + (depth + 1) * (isPhone ? 4 : 10), marginTop: gi > 0 ? 4 : 0, marginBottom: 2 }}>
                    <XomGroupHeader title={g.title} style={{ fontSize: nodeFz - 1, fontWeight: 600, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.04em" }} />
                  </div>
                  {g.children.map((c, i) => <ReqNode key={i} r={c} depth={depth + 1} dimmed={r.sat && !c.sat} />)}
                </div>
              ))
            : r.children.map((c, i) => <ReqNode key={i} r={c} depth={depth + 1} dimmed={r.sat && !c.sat} />)
          }
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

  // General electives section uses SH display instead of course count
  const isGeneralElectives = sec.title === 'General Electives' && sec.placedSH !== undefined;
  const hasSplit = isGeneralElectives && sec.completedSH !== undefined;
  const frac = isGeneralElectives
    ? (sec.requiredSH > 0 ? Math.min(sec.placedSH / sec.requiredSH, 1) : 1)
    : (displayTotal > 0 ? displaySatCount / displayTotal : 0);

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
        <span style={{ fontSize: ph ? 8 : 9, color: "var(--text-5)", marginRight: 2 }}>
          {hasSplit ? (
            <>
              <span style={{ color: "var(--success)" }}>{sec.completedSH}</span>
              {sec.plannedSH > 0 && <span style={{ color: "var(--link-1)" }}>+{sec.plannedSH}</span>}
              <span>/{sec.requiredSH} SH</span>
            </>
          ) : isGeneralElectives ? `${sec.placedSH}/${sec.requiredSH} SH`
            : `${displaySatCount}/${displayTotal}`}
        </span>
        <span style={{ fontSize: ph ? 8 : 9, color: "var(--text-5)" }}>{open ? "▼" : "▶"}</span>
      </div>
      {/* Progress sliver */}
      <div style={{ marginTop: 3 }}>
        {hasSplit
          ? <CreditBar completedSH={sec.completedSH} plannedSH={sec.plannedSH} requiredSH={sec.requiredSH} showLabel={false} style={{ margin: 0 }} />
          : <ProgressBar frac={frac} color={sec.sat ? "var(--success)" : "var(--success-bar-partial)"} />
        }
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
  const { t } = useLanguage();
  const [minor, setMinor] = useState(null);
  const [err, setErr] = useState(null);
  const [gone, setGone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const minorName = useTranslatedText(minor?.name ?? null);

  useEffect(() => {
    if (!path) { setMinor(null); setErr(null); setGone(false); return; }
    setLoading(true); setErr(null); setGone(false);
    majorRequirements.loadMinor(path)
      .then(setMinor)
      .catch(e => {
        if (e.message.includes('not found in registry')) {
          // Keep the saved selection; let the user remove it deliberately.
          setGone(true);
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
  if (gone) return (
    <StaleNotice
      isPhone={isPhone}
      message={t("grad.stale.minor", { label })}
      removeLabel={t("grad.stale.remove")}
      onRemove={() => onClear?.()}
    />
  );
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
            {isPhone && <span style={{ fontSize: 6, color: "var(--text-5)", marginLeft: 4 }}>{expanded ? "▼" : "▶"}</span>}
          </div>
          <div style={{ fontWeight: 400, color: "var(--text-2)", fontSize: isPhone ? 7 : 10, marginTop: 2 }}>{minorName}</div>
        </div>
        {!isPhone && <span style={{ fontSize: 9, color: "var(--text-5)", marginTop: 2, flexShrink: 0 }}>{expanded ? "▼" : "▶"}</span>}
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

// ── Stale-selection notice ───────────────────────────────────────
// Shown when a saved program path can no longer be resolved to any current
// catalog entry. The selection is preserved until the user removes it.
function StaleNotice({ message, onRemove, isPhone, removeLabel = "Remove" }) {
  return (
    <div style={{
      marginTop: 4, padding: "5px 7px", borderRadius: 4,
      background: "var(--warn-bg, var(--border-2))",
      border: "1px solid var(--warn-border, var(--border-3))",
      display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
      fontSize: isPhone ? 8 : 9,
    }}>
      <span style={{ color: "var(--text-2)", flex: 1 }}>{message}</span>
      <button
        onClick={onRemove}
        style={{
          fontSize: isPhone ? 7 : 8, padding: "2px 7px", cursor: "pointer",
          borderRadius: 3, border: "1px solid var(--border-3)",
          background: "transparent", color: "var(--text-3)", fontWeight: 600,
        }}
      >
        {removeLabel}
      </button>
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
    studentType,
    setShowNewPlanModal, setNewPlanInitialType,
    claudePreview,
  } = usePlanner();

  const isGrad = studentType === "graduate";

  // Claude proposal preview: outline the selector(s) the changeset touches
  // in orange, and give each an anchor the auto-focus scroll can target.
  const pvMark = (field) => ({
    "data-claude-focus": field,
    style: claudePreview?.changed?.has?.(field)
      ? { outline: "2px dashed #fb923c", outlineOffset: 3, borderRadius: 6 }
      : undefined,
  });

  const selPath    = majorPath || "";
  const setSelPath = setMajorPath;

  const attributeSystem   = usePort(IAttributeSystem);
  const majorRequirements = usePort(IMajorRequirements);
  const specialTerms      = usePort(ISpecialTerms);
  const creditSystem      = usePort(ICreditSystem);
  const unitName          = creditSystem.getUnitName();
  const { t } = useLanguage();

  const majorGroups  = useMemo(
    () => isGrad ? majorRequirements.getGradMajorOptionGroups() : majorRequirements.getMajorOptionGroups(),
    [majorRequirements, isGrad]
  );

  // Translated major name + concentration (no-ops when translation disabled or in source locale).
  const minorGroups  = useMemo(() => majorRequirements.getMinorOptionGroups(), [majorRequirements]);

  const [major,          setMajor]          = useState(null);
  const [loadErr,        setLoadErr]        = useState(null);
  const [fetching,       setFetching]       = useState(false);
  const [newerMajorPath, setNewerMajorPath] = useState(null);
  const [majorGone,      setMajorGone]      = useState(false);
  const majorName = useTranslatedText(major?.name ?? null);
  const concName  = useTranslatedText(selConc || null);

  const [major2Data,    setMajor2Data]    = useState(null);
  const [fetching2,     setFetching2]     = useState(false);
  const [major2Gone,    setMajor2Gone]    = useState(false);
  const major2Name = useTranslatedText(major2Data?.name ?? null);
  const [showMajor2,    setShowMajor2]    = useState(() => major2Path !== "");
  const [showSwitchPrompt, setShowSwitchPrompt] = useState(false);
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
    if (!selPath) { setMajor(null); setLoadErr(null); setNewerMajorPath(null); setMajorGone(false); setSelConc(""); return; }
    setFetching(true); setLoadErr(null); setMajor(null); setNewerMajorPath(null); setMajorGone(false);
    const loader = isGrad ? majorRequirements.loadGradMajor(selPath) : majorRequirements.loadMajor(selPath);
    const findNewer = isGrad ? findNewerGradMajorVersion : findNewerMajorVersion;
    loader
      .then(data => { setMajor(data); setNewerMajorPath(findNewer(selPath)); })
      .catch(e => {
        if (e.message.includes('not found in registry')) {
          // The program could not be resolved to any current catalog entry (renamed
          // away or discontinued). Keep the saved selection and let the user decide —
          // never wipe it silently, or the auto-save would persist the loss.
          setMajorGone(true);
        } else {
          setLoadErr(e.message);
        }
      })
      .finally(() => setFetching(false));
  }, [selPath, isGrad]);

  // Reset concentration if not available in newly loaded major
  useEffect(() => {
    if (!major || !selConc) return;
    const opts = major.concentrations?.concentrationOptions ?? [];
    if (!opts.find(c => c.title === selConc)) setSelConc("");
  }, [major]);

  // Fetch second major JSON on path change
  useEffect(() => {
    if (!major2Path) { setMajor2Data(null); setMajor2Gone(false); return; }
    setFetching2(true); setMajor2Data(null); setMajor2Gone(false);
    const loader2 = isGrad ? majorRequirements.loadGradMajor(major2Path) : majorRequirements.loadMajor(major2Path);
    loader2
      .then(data => setMajor2Data(data))
      .catch(() => setMajor2Gone(true)) // keep the saved path; surface it instead of wiping
      .finally(() => setFetching2(false));
  }, [major2Path, isGrad]);

  const placedSet = useMemo(
    () => buildPlacedKeySet(effectivePlacements, placedOut, courseMap),
    [effectivePlacements, placedOut, courseMap]
  );

  // Real-only placed set: excludes virtual substitution-target entries from effectivePlacements.
  // Used for GE display so substituted courses don't appear twice with doubled SH.
  const realPlacedSet = useMemo(
    () => buildPlacedKeySet(placements, placedOut, courseMap),
    [placements, placedOut, courseMap]
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
    const { sections: majorResults, generalElectives, allocatedSet } = allocateMajorWithElectives(major, placedSet, courseMap, doneSet, realPlacedSet);

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
  }, [allSections, placedSet, doneSet, realPlacedSet, courseMap, major, selConc]);

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
    const { sections, generalElectives } = allocateMajorWithElectives(major2Data, placedSet, courseMap, doneSet, realPlacedSet);
    return [...sections, generalElectives];
  }, [major2Data, placedSet, courseMap, doneSet, realPlacedSet]);

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
            style={{ display: "flex", alignItems: "center", gap: 8, userSelect: "none", marginBottom: showProgram ? 4 : 0 }}
          >
            {/* Heading reads as "Undergrad Program Selection". On desktop the type
                word is tappable to surface the switch-plan prompt; on phone it stays
                a plain bold label — too cramped, and the prompt overflows. */}
            <span
              onClick={() => setShowProgram(v => !v)}
              style={{ fontWeight: 400, color: "var(--text-5)", fontSize: isPhone ? 9 : 11, cursor: "pointer", flex: 1 }}
            >
              <span
                onClick={isPhone ? undefined : (e) => { e.stopPropagation(); setShowSwitchPrompt(v => !v); }}
                style={{ fontWeight: 700, cursor: isPhone ? "inherit" : "pointer" }}
              >{isGrad ? "Graduate" : "Undergrad"}</span>
              {" "}{t("grad.programSelection")}
            </span>
            <span onClick={() => setShowProgram(v => !v)} style={{ fontSize: 9, color: "var(--text-5)", lineHeight: 1, cursor: "pointer", padding: "2px 0" }}>{showProgram ? "▼" : "▶"}</span>
          </div>

          {/* Switch type prompt — desktop only (trigger is disabled on phone) */}
          {showSwitchPrompt && !isPhone && (
            <div style={{
              marginBottom: 8, padding: "8px 10px", borderRadius: 6,
              background: "var(--bg-surface-2)", border: "1px solid var(--border-2)",
              fontSize: 9, color: "var(--text-3)", lineHeight: 1.5,
            }}>
              <div style={{ marginBottom: 6 }}>
                This is {isGrad ? "a Graduate" : "an Undergraduate"} plan. To access {isGrad ? "undergraduate" : "graduate"} programs, create a new plan.
              </div>
              <div style={{ display: "flex", gap: 5 }}>
                <button
                  onClick={() => {
                    const otherType = isGrad ? "undergrad" : "graduate";
                    setNewPlanInitialType(otherType);
                    setShowNewPlanModal(true);
                    setShowSwitchPrompt(false);
                  }}
                  style={{
                    fontSize: 8, fontWeight: 700, padding: "3px 8px", borderRadius: 4,
                    background: "var(--link-bg)", border: "1px solid var(--link-1)",
                    color: "var(--link-1)", cursor: "pointer",
                  }}
                >
                  New {isGrad ? "Undergraduate" : "Graduate"} plan
                </button>
                <button
                  onClick={() => setShowSwitchPrompt(false)}
                  style={{
                    fontSize: 8, padding: "3px 8px", borderRadius: 4,
                    background: "transparent", border: "1px solid var(--border-2)",
                    color: "var(--text-4)", cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {showProgram && (
            <>
              {/* Major selector */}
              <div data-claude-focus="major" style={{ marginBottom: 3, ...(pvMark("major").style ?? {}) }}>
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
                {majorGone && (
                  <StaleNotice
                    isPhone={isPhone}
                    message={t("grad.stale.program")}
                    removeLabel={t("grad.stale.remove")}
                    onRemove={() => setSelPath("")}
                  />
                )}
              </div>

              {/* Concentration selector */}
              {major?.concentrations?.concentrationOptions?.length > 0 && (
                <div data-claude-focus="conc" style={{ marginBottom: 8, marginTop: 8, ...(pvMark("conc").style ?? {}) }}>
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
                <div data-claude-focus="major2" style={{ marginBottom: 8, marginTop: 8, ...(pvMark("major2").style ?? {}) }}>
                  <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
                    <div style={{ fontSize: isPhone ? 8 : 10, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.05em", flex: 1 }}>{t("grad.major2.label")}</div>
                    <button
                      onClick={() => { setMajor2Path(""); setShowMajor2(false); }}
                      style={{ background: "transparent", border: "none", color: "var(--text-5)", fontSize: 12, cursor: "pointer", lineHeight: 1, padding: "0 2px" }}
                      title="Remove second major"
                    >✕</button>
                  </div>
                  <SearchCombo value={major2Path} onChange={setMajor2Path} groups={majorGroups} placeholder={isPhone ? t("grad.major.search.short") : t("grad.major.search")} />
                  {major2Gone && (
                    <StaleNotice
                      isPhone={isPhone}
                      message={t("grad.stale.program")}
                      removeLabel={t("grad.stale.remove")}
                      onRemove={() => { setMajor2Path(""); setShowMajor2(false); }}
                    />
                  )}
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

              {/* Minor selectors — undergrad only */}
              {!isGrad && (
              <div style={{ display: "grid", gridTemplateColumns: isPhone ? "1fr" : "repeat(auto-fit, minmax(120px, 1fr))", gap: isPhone ? 4 : 6, marginTop: 8, marginBottom: 8, width: "100%", boxSizing: "border-box", overflow: "hidden" }}>
                {[[t("grad.minor1.label"), minor1, setMinor1, "minor1"], [t("grad.minor2.label"), minor2, setMinor2, "minor2"]].map(([lbl, val, set, field]) => (
                  <div key={lbl} data-claude-focus={field} style={{ minWidth: 0, overflow: "hidden", ...(pvMark(field).style ?? {}) }}>
                    <div style={{ fontSize: isPhone ? 7 : 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", marginBottom: 3 }}>{lbl}</div>
                    <SearchCombo value={val} onChange={set} groups={minorGroups} placeholder={isPhone ? t("grad.major.search.short") : t("grad.minor.search")} />
                  </div>
                ))}
              </div>
              )}
            </>
          )}
        </div>

        {/* ── Attribute grid — hidden for grad plans and when adapter has no attributes ── */}
        {!isGrad && attributeSystem.getGridCodes().length > 0 && (
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

        {/* ── Minor requirement sections — undergrad only ─────── */}
        {!isGrad && <MinorBlock path={minor1} onClear={() => setMinor1("")} placedSet={placedSet} doneSet={doneSet} label={t("grad.minor1.label")} />}
        {!isGrad && <MinorBlock path={minor2} onClear={() => setMinor2("")} placedSet={placedSet} doneSet={doneSet} label={t("grad.minor2.label")} />}

                {/* ── Empty state ──────────────────────────────────────── */}
        {!major && !major2Data && !minor1 && !minor2 && !fetching && !loadErr && !majorGone && !major2Gone && (
          <div style={{ textAlign: "center", color: "var(--text-5)", fontSize: 10, paddingTop: 12, lineHeight: 1.7, whiteSpace: "pre-line" }}>
            {t("grad.empty")}
          </div>
        )}
      </div> {/* closes the main padding div */}
    </GradCtx.Provider> 
  ); 
} // closes the function