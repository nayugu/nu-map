// ═══════════════════════════════════════════════════════════════════
// GRAD PANEL  — graduation requirements sidebar
//
// Rendered by BankPanel as an XOR alternative to the course bank.
// Uses graduatenu's Major2 JSON schema + gradRequirements.js
//
// Double major: courses count freely toward both majors (NU policy).
// Each major is allocated independently with allocateMajorWithElectives.
// ═══════════════════════════════════════════════════════════════════
import { useState, useMemo, useEffect, useContext, createContext, useRef } from "react";
import { createPortal } from "react-dom";
import VerificationPopover from "./VerificationPopover.jsx";
import { usePlanner }         from "../context/PlannerContext.jsx";
import { usePort }             from "../context/InstitutionContext.jsx";
import { IAttributeSystem }   from "../ports/IAttributeSystem.js";
import { IMajorRequirements } from "../ports/IMajorRequirements.js";
import { ISpecialTerms }      from "../ports/ISpecialTerms.js";
import { ICreditSystem }      from "../ports/ICreditSystem.js";
import { IInstitution }       from "../ports/IInstitution.js";
import { computeGrantedAttrs } from "../core/specialTermUtils.js";
import { resolveConcentration } from "../core/concentrationResolve.js";
import { filterInTimeline } from "../core/planModel.js";
import { setConstraintStatus, effectiveGradeOfTakes, enteredGPA } from "../core/gradeSystem.js";
import { baseId } from "../core/repeatInstances.js";
import { REL_STYLE } from "../core/constants.js";
import { useLanguage }          from "../context/LanguageContext.jsx";
import { useTranslatedText, scaleLatinRuns }    from "../context/TranslationContext.jsx";
import {
  buildPlacedKeySet,
  allocateMajorWithElectives,
  allocateSections,
} from "../core/gradRequirements.js";
import { findNewerMajorVersion, findNewerGradMajorVersion } from "../data/majorLoader.js";
import { rankOptions } from "../core/searchRank.js";

// ── GradCtx (avoids deep prop-drilling through requirement tree) ─────────
// isPhone is included so child nodes (NuPathGrid, ReqNode) can adapt.
const GradCtx = createContext(null);

// ── Shared atoms ─────────────────────────────────────────────────

function ProgressBar({ frac, color = "var(--success-bar)" }) {
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
        <div style={{ position: "absolute", left: 0, width: `${Math.min(100, totalFrac * 100)}%`, height: "100%", background: "var(--planned-bar)", borderRadius: 3 }} />
      )}
      {completedSH > 0 && (
        <div style={{ position: "absolute", left: 0, width: `${Math.min(100, completedSH / maxSH * 100)}%`, height: "100%", background: "var(--success-bar)", borderRadius: 3 }} />
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
  // Both themes: transparent box, fat emerald SVG check (the ✓ glyph maxes
  // out too thin). The rim is state-dependent: UNFULFILLED keeps the full
  // rim (it's a call to action); once resolved — checked here, or slashed
  // via dimmedCheck when an alternative was picked — the chrome recedes to
  // the same 40% strength as crossed-out alternatives (row opacity 0.4).
  return (
    <span style={{ ...base,
      background: "transparent",
      border: `1px solid ${sat ? "color-mix(in srgb, var(--border-2) 40%, transparent)" : "var(--border-2)"}`,
      color: sat ? "var(--success-mark)" : "var(--text-5)",
    }}>
      {sat && (
        <svg width={sz - 4} height={sz - 4} viewBox="0 0 12 12" style={{ display: "block" }}>
          <path d="M2 6.5 L4.8 9.2 L10 3.2" fill="none" stroke="var(--success-mark)"
            strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

// ── Searchable combobox (matches course-bank search style) ───────────────

export function SearchCombo({ value, onChange, groups, placeholder = "Search…", size = 10 }) {
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
  // Rank by closeness (exact/prefix first) with light typo tolerance, instead of
  // an unordered substring filter. Empty query renders nothing (never all ~1500).
  const filtered = rankOptions(allOptions, query);

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
            flex: 1, fontSize: size, padding: `${Math.round(size / 2.2)}px ${Math.round(size / 1.5)}px`, minWidth: 0,
            background: "var(--bg-surface-2)", color: "var(--text-2)",
            border: "1px solid var(--border-2)", borderRadius: 4, outline: "none",
          }}
        />
        {value && (
          <button
            onMouseDown={e => { e.preventDefault(); select(""); }}
            onTouchStart={e => { e.preventDefault(); select(""); }}
            style={{ background: "transparent", border: "none", color: "var(--text-4)", fontSize: size + 1, cursor: "pointer", padding: "0 2px", flexShrink: 0 }}
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
          fontFamily: "'InterTight', 'Inter', system-ui, sans-serif", fontSize: size + 2,
        }}>
          <div
            onMouseDown={() => select("")}
            onTouchStart={e => { e.preventDefault(); select(""); }}
            style={{
              padding: `${Math.round(size * 0.6)}px ${size}px`, fontSize: size + 1, cursor: "pointer",
              color: "var(--text-5)", borderBottom: "1px solid var(--border-1)",
            }}
          >(None)</div>
          {!q ? (
            <div style={{ padding: `${Math.round(size * 0.7)}px ${size}px`, fontSize: size + 1, color: "var(--text-5)", fontStyle: "italic" }}>{t("bank.search.empty.typing")}</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: `${Math.round(size * 0.7)}px ${size}px`, fontSize: size + 1, color: "var(--text-5)" }}>{t("bank.search.empty.none")}</div>
          ) : (
            filtered.map(o => (
              <div
                key={o.path}
                onMouseDown={() => select(o.path)}
                onTouchStart={e => { e.preventDefault(); select(o.path); }}
                style={{
                  padding: `${Math.round(size * 0.5)}px ${size}px`, fontSize: size + 1, cursor: "pointer",
                  background: o.path === value ? "var(--bg-surface-2)" : undefined,
                  color: o.path === value ? "var(--text-1)" : "var(--text-2)",
                }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--bg-surface-2)"}
                onMouseLeave={e => e.currentTarget.style.background = o.path === value ? "var(--bg-surface-2)" : ""}
              >
                <div style={{ fontWeight: 600 }}>
                  {o.label}{o.location ? ` (${o.location})` : ""}
                </div>
                <div style={{ fontSize: size, color: "var(--text-5)" }}>{o.grp}</div>
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
  return <span style={style}>{scaleLatinRuns(text)}</span>;
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
    const displayLabel = r.label.split(': ')[0];
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
              {scaleLatinRuns(courseTitle)}
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
        <span style={{ fontSize: nodeFz, fontWeight: 600, color: r.sat ? "var(--text-2)" : "var(--text-3)", flex: 1 }}>{scaleLatinRuns(heading)}</span>
        {has && <span style={{ fontSize: nodeFz - 1, color: "var(--text-5)" }}>{open ? "▼" : "▶"}</span>}
      </div>
      {open && has && <div style={{ marginTop: 3 }}>
        {r.children.map((c, i) => <ReqNode key={i} r={c} depth={depth + 1} dimmed={r.type === "OR" && r.sat && !c.sat} />)}
      </div>}
    </div>
  );
}

// ── GPA rules ────────────────────────────────────────────────────
// Constraints over grades, rendered as info — never as requirements a
// course can tick off. With no grades entered every rule reads neutral
// (the arithmetic genuinely says "satisfiable"); entered grades tighten
// it to met / needs-at-least-X / impossible. Impossible is the only red,
// because it is a proof, not a prediction. Fuzzy scopes ("all business
// courses") display their own text and are never computed.

function GpaRules({ program, programKind = "major" }) {
  const { t } = useLanguage();
  const { grades, placements, placedOut, courseMap, SEM_INDEX, isPhone } = usePlanner();
  const rules = program?.gpaRequirements ?? [];

  // Every row carries an explicit scope chip — without one, a rule like
  // "must average to C" is ambiguous between "this section" and "the whole
  // major", which is exactly the misreading the old pick-1 phantom caused.
  const scopeChip = (rule) => {
    switch (rule.scope.kind) {
      case "cumulative": return t("grad.gpa.scope.cumulative");
      case "program":    return t(programKind === "minor" ? "grad.gpa.scope.minor" : "grad.gpa.scope.major");
      case "subjects":   return t("grad.gpa.scope.subjects", { subjects: rule.scope.subjects.join(", ") });
      case "courses":    return t("grad.gpa.scope.courses", { n: (rule.courses ?? []).length });
      default:           return null; // described: its own text carries the scope
    }
  };

  const rows = useMemo(() => {
    if (!rules.length) return [];

    // Effective grade per base course — the latest take counts (replacement).
    const gradeOfBase = (base) => {
      const takes = [];
      for (const [pid, sid] of Object.entries(placements)) {
        if (baseId(pid) !== base) continue;
        const fi = SEM_INDEX[sid];
        if (fi === undefined) continue;
        takes.push({ fi, grade: grades[pid] ?? null });
      }
      for (const pid of placedOut) {
        if (baseId(pid) === base) takes.push({ fi: "out", grade: grades[pid] ?? null });
      }
      return takes.length ? effectiveGradeOfTakes(takes) : null;
    };

    const programKeys = (() => {
      const keys = new Set();
      const walk = (n) => {
        if (!n || typeof n !== "object") return;
        if (n.type === "COURSE" && n.subject) keys.add(`${n.subject}${n.classId}`);
        for (const k of ["requirements", "courses", "children"]) (n[k] ?? []).forEach(walk);
      };
      (program?.requirementSections ?? []).forEach(walk);
      return keys;
    })();

    const entriesFor = (rule) => {
      if (rule.scope.kind === "courses") {
        return (rule.courses ?? []).map(c => {
          const base = `${c.subject}${c.classId}`;
          return { grade: gradeOfBase(base), credits: courseMap[base]?.sh ?? 4 };
        });
      }
      const subjOk = rule.scope.kind === "subjects" ? new Set(rule.scope.subjects) : null;
      const out = [], seen = new Set();
      const consider = (pid, inTL) => {
        if (!inTL) return;
        const base = baseId(pid);
        if (seen.has(base)) return;
        seen.add(base);
        const c = courseMap[base];
        if (!c) return;
        if (subjOk && !subjOk.has(c.subject)) return;
        if (rule.scope.kind === "program" && !programKeys.has(base)) return;
        out.push({ grade: gradeOfBase(base), credits: c.sh ?? 4 });
      };
      for (const [pid, sid] of Object.entries(placements)) consider(pid, SEM_INDEX[sid] !== undefined);
      for (const pid of placedOut) consider(pid, true);
      return out;
    };

    return rules.map(rule => {
      const label = rule.text ?? rule.title ?? "";
      const chip  = scopeChip(rule);
      if (rule.threshold == null || rule.scope.kind === "described") {
        return { mark: "·", color: "var(--text-5)", label, chip, sub: null };
      }
      const entries = entriesFor(rule);
      const st = setConstraintStatus(entries, rule.threshold);
      const anyEntered = entries.some(e => e.grade != null);
      if (st.status === "impossible") {
        return { mark: "✕", color: REL_STYLE["prerequisite-order"].color, label, chip,
                 sub: t("grad.gpa.impossible", { gpa: rule.threshold.toFixed(3) }) };
      }
      if (st.status === "atRisk" && anyEntered) {
        return { mark: "!", color: REL_STYLE["corequisite-viol"].color, label, chip,
                 sub: t("grad.gpa.needed", { grade: st.neededGrade }) };
      }
      if (anyEntered && st.status === "met") {
        return { mark: "✓", color: REL_STYLE.prerequisite.color, label, chip,
                 sub: t("grad.gpa.met") };
      }
      return { mark: "·", color: "var(--text-5)", label, chip,
               sub: anyEntered && st.neededGrade ? t("grad.gpa.needed", { grade: st.neededGrade }) : null };
    });
  }, [rules, grades, placements, placedOut, courseMap, SEM_INDEX, program, programKind, t]);

  if (!rows.length) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: isPhone ? 8 : 10, fontWeight: 700, color: "var(--text-3)",
                    letterSpacing: "0.05em", marginBottom: 4 }}>
        {t("grad.gpa.title")}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
            <span style={{ flexShrink: 0, width: 10, textAlign: "center", fontSize: 9,
                           fontWeight: 800, color: r.color, lineHeight: "14px" }}>{r.mark}</span>
            <div style={{ minWidth: 0 }}>
              {r.chip && (
                <span style={{ display: "inline-block", fontSize: isPhone ? 6.5 : 8, fontWeight: 700,
                               color: "var(--text-4)", background: "var(--badge-bg)",
                               border: "1px solid var(--border-2)", borderRadius: 3,
                               padding: "0px 4px", marginBottom: 2 }}>
                  {r.chip}
                </span>
              )}
              <div style={{ fontSize: isPhone ? 8 : 9.5, lineHeight: 1.45, color: "var(--text-4)" }}>
                {scaleLatinRuns(r.label)}
              </div>
              {r.sub && (
                <div style={{ fontSize: isPhone ? 7.5 : 9, lineHeight: 1.4, color: r.color, marginTop: 1 }}>
                  {r.sub}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── GPA so far ───────────────────────────────────────────────────
// The one place the overall number renders, and only from ENTERED letter
// grades — with none entered this returns null and no GPA exists anywhere
// in the app (the assumed ceiling must never be displayed as a GPA). Lives
// in the graduation panel, a deliberate click from the board: the header
// and the planner appear in every screenshot and screen-share, and this is
// the most sensitive number in the app.
function GpaSoFar() {
  const { t } = useLanguage();
  const { grades, placements, placedOut, courseMap, SEM_INDEX, isPhone } = usePlanner();

  const stat = useMemo(() => {
    const seen = new Set();
    const entries = [];
    const consider = (pid, inTL) => {
      if (!inTL) return;
      const base = baseId(pid);
      if (seen.has(base)) return;
      seen.add(base);
      // Latest take counts (replacement rule).
      const takes = [];
      for (const [p2, sid] of Object.entries(placements)) {
        if (baseId(p2) !== base) continue;
        const fi = SEM_INDEX[sid];
        if (fi !== undefined) takes.push({ fi, grade: grades[p2] ?? null });
      }
      for (const p2 of placedOut) if (baseId(p2) === base) takes.push({ fi: "out", grade: grades[p2] ?? null });
      const g = takes.length ? effectiveGradeOfTakes(takes) : null;
      if (g != null) entries.push({ grade: g, credits: courseMap[base]?.sh ?? 4 });
    };
    for (const [pid, sid] of Object.entries(placements)) consider(pid, SEM_INDEX[sid] !== undefined);
    for (const pid of placedOut) consider(pid, true);
    const gpa = enteredGPA(entries);
    return gpa == null ? null : { gpa, n: entries.filter(e => e.grade != null).length };
  }, [grades, placements, placedOut, courseMap, SEM_INDEX]);

  if (!stat) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
                  padding: "6px 10px", marginBottom: 8, borderRadius: 6,
                  border: "1px solid var(--border-1)" }}>
      <span style={{ fontSize: isPhone ? 8 : 10, fontWeight: 700, color: "var(--text-3)",
                     letterSpacing: "0.05em" }}>
        {t("grad.gpa.sofar")}
      </span>
      <span style={{ fontSize: isPhone ? 9 : 11, fontWeight: 700, color: "var(--text-2)" }}>
        {stat.gpa.toFixed(3)}
        <span style={{ fontSize: isPhone ? 7 : 8.5, fontWeight: 500, color: "var(--text-5)", marginLeft: 5 }}>
          {t("grad.gpa.sofar.n", { n: stat.n })}
        </span>
      </span>
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
      {/* Clickable header — no background, just text. On phone the column is
          too narrow for the title, so only the text is dropped: checkbox,
          counts and the collapse toggle stay. */}
      <div onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }} style={{
        display: "flex", alignItems: "center", gap: ph ? 4 : 6,
        cursor: "pointer", userSelect: "none",
      }}>
        <CheckBox sat={sec.sat} />
        {ph
          ? <span style={{ flex: 1 }} />
          : <span style={{ flex: 1, fontSize: 10, fontWeight: 700, color: sec.sat ? "var(--text-2)" : "var(--text-3)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {scaleLatinRuns(secTitle)}
            </span>}
        <span style={{ fontSize: ph ? 8 : 9, color: "var(--text-5)", marginRight: 2 }}>
          {hasSplit ? (
            <>
              <span style={{ color: "var(--success)" }}>{sec.completedSH}</span>
              {sec.plannedSH > 0 && <span style={{ color: "var(--planned)" }}>+{sec.plannedSH}</span>}
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
          : <ProgressBar frac={frac} color={sec.sat ? "var(--success-bar)" : "var(--success-bar-partial)"} />
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

function NuPathGrid({ covered, sources = {} }) {
  const { isPhone, attributeSystem, setSelectedId, setShowPanel } = useContext(GradCtx);
  const { t } = useLanguage();
  const [activeKey, setActiveKey] = useState(null);

  // Native-tooltip text for hover: which class(es) satisfy this attribute.
  const tipFor = key => {
    const label = attributeSystem.getLabel(key);
    const src = sources[key] ?? [];
    if (!covered.has(key)) return `${label}: ${t("grad.nupath.unsatisfied")}`;
    if (!src.length)       return `${label}: ${t("grad.nupath.granted")}`;
    return `${label}: ${t("grad.nupath.satisfiedBy", { courses: src.map(s => s.code).join(", ") })}`;
  };

  const active    = activeKey;
  const activeSrc = active ? (sources[active] ?? []) : [];

  return (
    <div style={{ marginBottom: 6 }}>
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
      }}>
        {attributeSystem.getGridCodes().map(key => {
          const sat = covered.has(key);
          const isActive = active === key;
          return (
            <div key={key}
              title={tipFor(key)}
              onClick={(e) => { e.stopPropagation(); setActiveKey(k => k === key ? null : key); }}
              style={{
                display: "flex", alignItems: "center", justifyContent: isPhone ? "center" : "flex-start",
                gap: isPhone ? 0 : 4, cursor: "pointer",
                // Natural height with modest vertical padding — wider than tall.
                padding: isPhone ? "4px 2px" : "3px 5px",
                borderRadius: isPhone ? 3 : 4,
                fontSize: 9,
                // Grey chrome; the emerald text alone carries "satisfied"
                // (matches the Stats chips: colour in the type, not the frame).
                // --success-mark, not --success: this grid keeps the vivid
                // step in BOTH themes, so light mode reads the same mint as dark.
                background: "var(--bg-surface)",
                border: `1px solid ${isActive ? "var(--active)" : "var(--border-2)"}`,
                color: sat ? "var(--success-mark)" : "var(--text-5)",
                fontWeight: sat ? 700 : 400,
              }}>
              <span style={{
                flexShrink: 0, fontWeight: 800,
                fontSize: isPhone ? 8.5 : 9,
                lineHeight: 1,
                color: sat ? "var(--success-mark)" : "var(--text-4)",
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

      {/* Click-to-reveal detail: which class satisfies the selected attribute. */}
      {active && (
        <div style={{
          marginTop: 5, padding: "5px 7px", borderRadius: 4,
          background: "var(--bg-surface)", border: "1px solid var(--border-2)",
          fontSize: 9, color: "var(--text-4)", lineHeight: 1.5,
        }}>
          <span style={{ fontWeight: 700, color: "var(--text-3)" }}>{active}</span>
          <span style={{ color: "var(--text-5)" }}> · {attributeSystem.getLabel(active)}</span>
          <div style={{ marginTop: 3 }}>
            {!covered.has(active) ? (
              t("grad.nupath.unsatisfied")
            ) : !activeSrc.length ? (
              t("grad.nupath.granted")
            ) : (
              <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                {t("grad.nupath.satisfiedByLabel")}
                {activeSrc.map(s => (
                  <button key={s.id}
                    onClick={(e) => { e.stopPropagation(); setSelectedId(s.id); setShowPanel(true); }}
                    style={{
                      cursor: "pointer", fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 99,
                      background: "var(--bg-bank)", border: "1px solid var(--nupath-sat-border)",
                      color: "var(--nupath-sat-text)",
                    }}>{s.code}</button>
                ))}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Minor block (loads + validates a minor's requirement sections) ─

/**
 * Fidelity pill — three states, because "no badge" was previously
 * indistinguishable from "never checked".
 *
 *   verified (green) every applicable check passed AND the catalog's own
 *                    sample plan of study existed and was fully explained by
 *                    the parsed requirements
 *   partial  (grey)  everything available passed, but the page offers no
 *                    sample plan, so the strongest check could not run. Every
 *                    minor lands here permanently — they have no such plan.
 *   review   (amber) known discrepancies; the tooltip lists them
 *
 * Grey rather than green for `partial` is the load-bearing choice: a program
 * checked against one source has not earned the same badge as one whose
 * worked example fully corroborates it. Over-claiming to an advisor is worse
 * than saying less.
 */
function VerificationPill({ verification, verified, t, isPhone, isMobile }) {
  const [open, setOpen] = useState(null);   // anchor rect while shown
  const level = verification?.level ?? (verified ? "verified" : null);
  if (!level || level === "unverified") return null;

  // Green / yellow / red, with a word rather than a count. "1 source" and
  // "2 to check" told an advisor nothing — the state has to be readable
  // without knowing how the checking works.
  //
  // Chrome stays neutral and the colour lives in the type, matching the NUPath
  // grid directly above it. A filled badge shouted over a deliberately calm
  // panel; this is a footnote about our confidence, not a status alarm.
  //
  // The colours are REL_STYLE's — the header legend's — read rather than
  // copied so the two can't drift. The mapping is semantic there too: green is
  // "correct", red is "wrong order", yellow is "misplaced, look at this".
  const fg = {
    verified: REL_STYLE.prerequisite.color,
    partial:  REL_STYLE["corequisite-viol"].color,
    review:   REL_STYLE["prerequisite-order"].color,
  }[level] ?? null;
  if (!fg) return null;

  const text = level === "verified" ? t("grad.verify.checked")
             : level === "partial"  ? t("grad.verify.partial")
             : t("grad.verify.review");

  // Two input models, split on the right breakpoint for each concern.
  //
  //   INTERACTION keys off isMobile (<1024px, phone AND tablet), because the
  //   deciding factor is that touch has no hover — a tablet can't reveal the
  //   explanation any more than a phone can.
  //     desktop  hover shows the explanation, click opens the catalog page
  //     touch    tap shows the explanation; the catalog link is deliberately
  //              disabled, since a tap that navigated out of the app was
  //              previously the badge's only behaviour and left its
  //              explanation unreachable
  //
  //   LAYOUT keys off isPhone (<600px), because that is where the badge
  //   actually overflowed the card. A tablet has room to keep it inline.
  const href = verification?.sourceUrl;

  const pill = (
    <span
      onMouseEnter={isMobile ? undefined : e => setOpen(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={isMobile ? undefined : () => setOpen(null)}
      onClick={isMobile ? (e => {
        e.stopPropagation();
        // Read the rect NOW: by the time the state updater runs React has
        // already nulled currentTarget on the pooled event.
        const rect = e.currentTarget.getBoundingClientRect();
        setOpen(o => (o ? null : rect));
      }) : undefined}
      style={{
        fontSize: 8, background: "transparent", color: fg,
        border: `1px solid var(--border-2)`, borderRadius: 99, padding: "1px 5px",
        cursor: "pointer", whiteSpace: "nowrap",
        // inline-block so the vertical margins actually apply — on an inline
        // span they are ignored, and the badge sat flush against the label
        // above and the program name below.
        ...(isPhone
          ? { display: "inline-block", alignSelf: "flex-start", marginTop: 5, marginBottom: 3 }
          : { marginLeft: 6 }),
      }}
    >{text}</span>
  );

  return (
    <>
      {!isMobile && href
        ? <a href={href} target="_blank" rel="noopener noreferrer"
             // The card header toggles expand/collapse; the link must not do both.
             onClick={e => e.stopPropagation()}
             style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>{pill}</a>
        : pill}

      {open && (
        <VerificationPopover
          verification={verification} level={level} rect={open}
          // Only touch needs the popover to accept input, for tap-outside to
          // dismiss. On desktop it stays inert so it can't steal the pointer.
          interactive={isMobile}
          onDismiss={() => setOpen(null)}
        />
      )}
    </>
  );
}

function MinorBlock({ path, onClear, placedSet, doneSet, label = "MINOR", nameColor }) {
  const { courseMap, majorRequirements, isPhone, isMobile } = useContext(GradCtx);
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
          {/* Phone drops the badge to its own line: inline it overflowed the
              card, and the label plus the expand caret already fill the row. */}
          <div style={{ fontSize: isPhone ? 8 : 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.05em" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <span>{scaleLatinRuns(label)}</span>
              {!isPhone && <VerificationPill verification={minor.metadata?.verification}
                                             verified={minor.metadata?.verified} t={t} isMobile={isMobile} />}
              {isPhone && <span style={{ fontSize: 6, color: "var(--text-5)", marginLeft: 4 }}>{expanded ? "▼" : "▶"}</span>}
            </div>
            {isPhone && <VerificationPill verification={minor.metadata?.verification}
                                          verified={minor.metadata?.verified} t={t} isPhone isMobile={isMobile} />}
          </div>
          <div style={{ fontWeight: nameColor ? 700 : 400, color: nameColor ?? "var(--text-2)", fontSize: isPhone ? 7 : 10, marginTop: isPhone ? 3 : 5 }}>{scaleLatinRuns(minorName)}</div>
        </div>
        {!isPhone && <span style={{ fontSize: 9, color: "var(--text-5)", marginTop: 2, flexShrink: 0 }}>{expanded ? "▼" : "▶"}</span>}
      </div>

      {/* Progress bar — always visible */}
      {showBar && (
        <div style={{ padding: "6px 10px 8px" }}>
          {/* Numeric stat line: opt out of the locale-wide CJK tracking and
              never wrap — the phone column is barely wider than the digits. */}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: isPhone ? 8.5 : 10, color: "var(--text-5)", marginBottom: 4, letterSpacing: 0, whiteSpace: "nowrap" }}>
            <span>
              <span style={{ color: "var(--success)" }}>{doneSat}</span>
              {plannedSat > 0 && <span style={{ color: "var(--planned)" }}>+{plannedSat}</span>}
              <span>/{totalReq}</span>
            </span>
            <span>{Math.round(totalSat / totalReq * 100)}%</span>
          </div>
          <div style={{ position: "relative", height: 6, borderRadius: 3, background: "var(--border-2)" }}>
            {plannedSat > 0 && <div style={{ position: "absolute", left: 0, width: `${Math.min(100, totalSat / totalReq * 100)}%`, height: "100%", background: "var(--planned-bar)", borderRadius: 3 }} />}
            {doneSat > 0 && <div style={{ position: "absolute", left: 0, width: `${Math.min(100, doneSat / totalReq * 100)}%`, height: "100%", background: "var(--success-bar)", borderRadius: 3, transition: "width 0.2s" }} />}
          </div>
        </div>
      )}

      {/* Sections — collapsible */}
      {expanded && (
        <div style={{ padding: "0 10px 10px" }}>
          {sections.map((sec, i) => <SectionBlock key={i} sec={sec} />)}
          <GpaRules program={minor} programKind="minor" />
        </div>
      )}
    </div>
  );
}

// ── MajorCard: framed collapsible card for a major's requirements ─
// Frame is a subtle background tint (no border line) matching MinorBlock.
function MajorCard({ label, name, subtitle, verified, verification, progress, expanded, onToggle, isPhone, isMobile, loading, loadingLabel, children, nameColor, subtitleColor }) {
  const { t } = useLanguage();
  return (
    <div style={{ border: "1px solid var(--border-1)", borderRadius: 6, marginBottom: 10 }}>
      {/* Header row: label + triangle toggle */}
      <div onClick={onToggle} style={{ display: "flex", alignItems: "flex-start", padding: "8px 10px 0", cursor: "pointer", userSelect: "none" }}>
        <div style={{ flex: 1 }}>
          {/* Phone puts the badge on its own line: inline it ran past the card
              edge and got clipped. Desktop keeps it beside the label. */}
          <div style={{ fontSize: isPhone ? 8 : 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.05em" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              {/* One span, not the bare array: scaleLatinRuns splits "专业 1" into
                  a CJK part and a scaled Latin run, and as direct flex children
                  those become separate flex items whose separating space
                  collapses. Keeping them in an inline container preserves normal
                  text flow while the row itself stays flex to centre the pill. */}
              <span>{scaleLatinRuns(label)}</span>
              {!isPhone && <VerificationPill verification={verification} verified={verified} t={t} isMobile={isMobile} />}
              {isPhone && <span style={{ fontSize: 6, color: "var(--text-5)", marginLeft: 4 }}>{expanded ? "▼" : "▶"}</span>}
            </div>
            {isPhone && <VerificationPill verification={verification} verified={verified} t={t} isPhone isMobile={isMobile} />}
          </div>
          <div style={{ fontWeight: nameColor ? 700 : 400, color: nameColor ?? "var(--text-2)", fontSize: isPhone ? 7 : 10, marginTop: isPhone ? 3 : 5 }}>{scaleLatinRuns(name)}</div>
          {subtitle && <div style={{ fontWeight: subtitleColor ? 700 : 400, color: subtitleColor ?? "var(--text-4)",
            fontSize: isPhone ? 7 : 9, marginTop: 1,
            /* Indented so it reads as belonging to the program above it
               rather than as a second, equal line. */
            marginInlineStart: isPhone ? 5 : 8 }}>{scaleLatinRuns(subtitle)}</div>}
        </div>
        {!isPhone && progress.requiredSH > 0 && (
          <span style={{ fontSize: 9, color: "var(--text-5)", marginTop: 2, flexShrink: 0 }}>{progress.requiredSH} SH</span>
        )}
        {!isPhone && <span style={{ fontSize: 9, color: "var(--text-5)", marginTop: 2, flexShrink: 0, marginLeft: 4 }}>{expanded ? "▼" : "▶"}</span>}
      </div>

      {/* Progress bar — always visible */}
      {progress.totalReq > 0 && (
        <div style={{ padding: "6px 10px 8px" }}>
          {/* Numeric stat line — same treatment as MinorBlock's above. */}
          <div style={{ fontSize: isPhone ? 8.5 : 10, color: "var(--text-5)", marginBottom: 4, letterSpacing: 0, whiteSpace: "nowrap" }}>
            <span style={{ color: "var(--success)" }}>{progress.doneSat}</span>
            {(progress.totalSat - progress.doneSat) > 0 && <span style={{ color: "var(--planned)" }}>+{progress.totalSat - progress.doneSat}</span>}
            <span> / {progress.totalReq}</span>
          </div>
          <div style={{ position: "relative", height: 6, borderRadius: 3, background: "var(--border-2)" }}>
            {(progress.totalSat - progress.doneSat) > 0 && <div style={{ position: "absolute", left: 0, width: `${Math.min(100, progress.totalSat / progress.totalReq * 100)}%`, height: "100%", background: "var(--planned-bar)", borderRadius: 3 }} />}
            {progress.doneSat > 0 && <div style={{ position: "absolute", left: 0, width: `${Math.min(100, progress.doneSat / progress.totalReq * 100)}%`, height: "100%", background: "var(--success-bar)", borderRadius: 3, transition: "width 0.2s" }} />}
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
    placements, placedOut, effectivePlacements, courseMap, totalSHPlaced, totalSHDone, onDragStart, selectedId, setSelectedId, setShowPanel, isPhone, isMobile,
    specialTermPl, SEM_INDEX,
    major: majorPath, setMajor: setMajorPath,
    major2: major2Path, setMajor2: setMajor2Path,
    conc: selConc, setConc: setSelConc,
    conc2: selConc2, setConc2: setSelConc2,
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
  // inset: draw the ring inside the element's box — needed where an
  // overflow:hidden ancestor (the minor grid) would clip an offset outline.
  const pvMark = (field, { inset = false } = {}) => ({
    "data-claude-focus": field,
    style: claudePreview?.changed?.has?.(field)
      ? inset
        ? { outline: "2px dashed #fb923c", outlineOffset: -2, borderRadius: 6, padding: 4 }
        : { outline: "2px dashed #fb923c", outlineOffset: 3, borderRadius: 6 }
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
  const conc2Name = useTranslatedText(selConc2 || null);

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
    // Resolve through aliases and labels before giving up. A scraper-side
    // rename must not silently wipe a saved selection — titles are the only
    // identity a concentration has, across saved plans, share links and the
    // MCP SET_CONCENTRATION action.
    const still = resolveConcentration(major, selConc);
    if (!still) setSelConc("");
    else if (still.title !== selConc) setSelConc(still.title);
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

  // Timeline-scoped: courses parked outside the cohort range never satisfy
  // requirements (they stay in state, uncounted, until the cohort widens).
  const placedSet = useMemo(
    () => buildPlacedKeySet(filterInTimeline(effectivePlacements, SEM_INDEX), placedOut, courseMap),
    [effectivePlacements, placedOut, courseMap, SEM_INDEX]
  );

  // Real-only placed set: excludes virtual substitution-target entries from effectivePlacements.
  // Used for GE display so substituted courses don't appear twice with doubled SH.
  const realPlacedSet = useMemo(
    () => buildPlacedKeySet(filterInTimeline(placements, SEM_INDEX), placedOut, courseMap),
    [placements, placedOut, courseMap, SEM_INDEX]
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

  const conc2Groups = useMemo(() => {
    const opts = (major2Data?.concentrations?.concentrationOptions ?? []).map(c => ({ path: c.title, label: c.title }));
    return new Map([["Concentrations", opts]]);
  }, [major2Data]);

  // Same stale-title recovery as major 1 — a scraper-side rename must not
  // silently drop the second major's choice either.
  useEffect(() => {
    if (!major2Data || !selConc2) return;
    const still = resolveConcentration(major2Data, selConc2);
    if (!still) setSelConc2("");
    else if (still.title !== selConc2) setSelConc2(still.title);
  }, [major2Data]);

  const npCovered  = useMemo(() => attributeSystem.getCoverage(filterInTimeline(placements, SEM_INDEX), courseMap, computeGrantedAttrs(specialTermPl, specialTerms?.getTypes() ?? [], SEM_INDEX)), [attributeSystem, placements, courseMap, specialTermPl, specialTerms, SEM_INDEX]);
  // Which placed classes satisfy each NUPath code → { [code]: [{id, code}] }.
  // Drives the grid's hover tooltip / click-to-reveal ("which class satisfies it").
  const npSources  = useMemo(() => {
    const m = {};
    for (const id of Object.keys(filterInTimeline(placements, SEM_INDEX))) {
      const c = courseMap[id];
      if (!c?.attributes) continue;
      for (const a of c.attributes) (m[a] = m[a] || []).push({ id: c.id, code: c.code });
    }
    return m;
  }, [placements, courseMap, SEM_INDEX]);
  const plannedSH  = totalSHPlaced - totalSHDone;
  const requiredSH = major?.totalCreditsRequired ?? 0;

    // ── Build combined sections (major + concentration) ─────────────────
  const allSections = useMemo(() => {
    if (!major) return [];
    const sections = [...(major.requirementSections ?? [])];
    if (selConc && major.concentrations) {
      const concSec = resolveConcentration(major, selConc);
      if (concSec) sections.push(concSec);
    }
    return sections;
  }, [major, selConc]);

  // ── Allocate all sections together (shared used set) ────────────────
  // Major gets General Electives automatically appended.
  //
  // Returns the major and concentration parts SEPARATELY rather than one flat
  // array the caller slices apart. The old code recovered the split with
  // `slice(0, major.requirementSections.length + 1)`, which assumes allocation
  // returns exactly one section per input. mergeDuplicateSections breaks that
  // assumption whenever two sections share a title — the concentration then
  // fell off the end and silently rendered as nothing. The parser now
  // guarantees unique titles, but relying on that from here couples the UI to
  // a scraper invariant for no reason.
  const { majorSections, concSection } = useMemo(() => {
    if (!major) return { majorSections: [], concSection: null };

    // Allocate major requirements + General Electives
    const { sections: majorResults, generalElectives, allocatedSet } = allocateMajorWithElectives(major, placedSet, courseMap, doneSet, realPlacedSet);

    // Add General Electives as the last major section
    const majorWithElectives = [...majorResults, generalElectives];

    // Allocate concentration sharing the major's used set so courses already
    // counted toward major requirements can't also satisfy the concentration.
    if (selConc && major.concentrations) {
      const chosen = resolveConcentration(major, selConc);
      if (chosen) {
        const [allocated] = allocateSections([chosen], placedSet, allocatedSet, courseMap);
        return { majorSections: majorWithElectives, concSection: allocated ?? null };
      }
    }

    return { majorSections: majorWithElectives, concSection: null };
  }, [allSections, placedSet, doneSet, realPlacedSet, courseMap, major, selConc]);

  const allocatedSections = concSection ? [...majorSections, concSection] : majorSections;
  const majorSectionsCount = major?.requirementSections?.length ?? 0;

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
    const { sections, generalElectives, allocatedSet } =
      allocateMajorWithElectives(major2Data, placedSet, courseMap, doneSet, realPlacedSet);
    const out = [...sections, generalElectives];
    // Concentration shares this major's used set, so a course already counted
    // toward its requirements can't also satisfy its concentration — the same
    // rule major 1 uses. Across the two majors, courses still double-count
    // freely, per NU policy.
    if (selConc2 && major2Data.concentrations) {
      const chosen = resolveConcentration(major2Data, selConc2);
      if (chosen) out.push(...allocateSections([chosen], placedSet, allocatedSet, courseMap));
    }
    return out;
  }, [major2Data, placedSet, courseMap, doneSet, realPlacedSet, selConc2]);

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
    <GradCtx.Provider value={{ courseMap, onDragStart, selectedId, setSelectedId, setShowPanel, isPhone, isMobile, attributeSystem, majorRequirements, wideCatalog }}>
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
              fontSize: 9, color: "var(--text-3)", lineHeight: "calc(1.5 * var(--lh-scale, 1))",
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
          isMobile={isMobile}
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
          isMobile={isMobile}
                      message={t("grad.stale.program")}
                      removeLabel={t("grad.stale.remove")}
                      onRemove={() => { setMajor2Path(""); setShowMajor2(false); }}
                    />
                  )}

                  {/* The second major's concentration. 51 undergraduate
                      programs require one — BSBA among them — so without this
                      a second major could not express a mandatory choice. */}
                  {major2Data?.concentrations?.concentrationOptions?.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ fontSize: isPhone ? 8 : 10, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.05em", marginBottom: 4 }}>
                        {t("grad.conc.label")}
                      </div>
                      <SearchCombo value={selConc2} onChange={setSelConc2} groups={conc2Groups}
                                   placeholder={isPhone ? t("grad.major.search.short") : t("grad.conc.search")} />
                      {major2Data.concentrations.minOptions > 0 && !selConc2 && (
                        <div style={{ fontSize: 9, color: "var(--warn-bright)", marginTop: 3 }}>
                          ⚠ {major2Data.concentrations.minOptions} concentration{major2Data.concentrations.minOptions > 1 ? "s" : ""} required
                        </div>
                      )}
                    </div>
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
                  <div key={lbl} data-claude-focus={field} style={{ minWidth: 0, overflow: "hidden", ...(pvMark(field, { inset: true }).style ?? {}) }}>
                    <div style={{ fontSize: isPhone ? 7 : 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", marginBottom: 3 }}>{lbl}</div>
                    <SearchCombo value={val} onChange={set} groups={minorGroups} placeholder={isPhone ? t("grad.major.search.short") : t("grad.minor.search")} />
                  </div>
                ))}
              </div>
              )}
            </>
          )}
        </div>

        {/* ── GPA so far — renders ONLY once a letter grade is entered ── */}
        <GpaSoFar />

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
          {showNP && <NuPathGrid covered={npCovered} sources={npSources} />}
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
          nameColor={claudePreview?.changed?.has?.("major") ? "#fb923c" : undefined}
          subtitleColor={claudePreview?.changed?.has?.("conc") ? "#fb923c" : undefined}
          verified={!!major?.metadata?.verified}
          verification={major?.metadata?.verification}
          progress={major1Progress}
          expanded={expandMajor1}
          onToggle={() => setExpandMajor1(v => !v)}
          isPhone={isPhone}
          isMobile={isMobile}
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
          <GpaRules program={major} />
        </MajorCard>}

        {/* ── Major 2 framed card ──────────────────────────────── */}
        {(major2Data || fetching2) && <MajorCard
          label={t("grad.major2.label")}
          name={major2Name}
          subtitle={selConc2 ? conc2Name : null}
          nameColor={claudePreview?.changed?.has?.("major2") ? "#fb923c" : undefined}
          verified={!!major2Data?.metadata?.verified}
          verification={major2Data?.metadata?.verification}
          progress={major2Progress}
          expanded={expandMajor2}
          onToggle={() => setExpandMajor2(v => !v)}
          isPhone={isPhone}
          isMobile={isMobile}
          loading={fetching2}
          loadingLabel={t("grad.loading")}
        >
          {major2Sections.map((sec, i) => <SectionBlock key={i} sec={sec} />)}
          <GpaRules program={major2Data} />
        </MajorCard>}

        {/* ── Minor requirement sections — undergrad only ─────── */}
        {!isGrad && <MinorBlock path={minor1} onClear={() => setMinor1("")} placedSet={placedSet} doneSet={doneSet} label={t("grad.minor1.label")} nameColor={claudePreview?.changed?.has?.("minor1") ? "#fb923c" : undefined} />}
        {!isGrad && <MinorBlock path={minor2} onClear={() => setMinor2("")} placedSet={placedSet} doneSet={doneSet} label={t("grad.minor2.label")} nameColor={claudePreview?.changed?.has?.("minor2") ? "#fb923c" : undefined} />}

                {/* ── Empty state ──────────────────────────────────────── */}
        {!major && !major2Data && !minor1 && !minor2 && !fetching && !loadErr && !majorGone && !major2Gone && (
          <div style={{ textAlign: "center", color: "var(--text-5)", fontSize: 10, paddingTop: 12, lineHeight: "calc(1.7 * var(--lh-scale, 1))", whiteSpace: "pre-line" }}>
            {t("grad.empty")}
          </div>
        )}
      </div> {/* closes the main padding div */}
    </GradCtx.Provider> 
  ); 
} // closes the function