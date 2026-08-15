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
import SamplePlanOffer       from "./SamplePlanOffer.jsx";
import PlusOneBlock          from "./PlusOneBlock.jsx";
import { usePort }             from "../context/InstitutionContext.jsx";
import { IAttributeSystem }   from "../ports/IAttributeSystem.js";
import { IMajorRequirements } from "../ports/IMajorRequirements.js";
import { ISpecialTerms }      from "../ports/ISpecialTerms.js";
import { ICreditSystem }      from "../ports/ICreditSystem.js";
import { IInstitution }       from "../ports/IInstitution.js";
import { IAcceleratedPathway } from "../ports/IAcceleratedPathway.js";
import { isEligibleFor } from "../core/pathway/select.js";
import { computeGrantedAttrs, workTermGrants, coopOptionsInPrograms } from "../core/specialTermUtils.js";
import { resolveConcentration } from "../core/concentrationResolve.js";
import { cohortCatalogYear, programIdFromPath } from "../data/programPaths.js";
import { filterInTimeline, applySubstitutions } from "../core/planModel.js";
import { setConstraintStatus, effectiveGradeOfTakes, enteredGPA, countsInGPA, dropVoidTakes, dropUnearnedTakes, COOP_GPA } from "../core/gradeSystem.js";
import { baseId } from "../core/repeatInstances.js";
import { reservedTotals } from "../core/reservations.js";
import { REL_STYLE } from "../core/constants.js";
import { useLanguage }          from "../context/LanguageContext.jsx";
import { useTranslatedText, scaleLatinRuns }    from "../context/TranslationContext.jsx";
import {
  buildPlacedKeySet,
  allocateMajorWithElectives,
  allocateMajorSections,
  allocateSections,
  collectCandidateKeys,
  calculateGeneralElectives,
} from "../core/gradRequirements.js";
import { findNewerMajorVersion, findNewerGradMajorVersion } from "../data/majorLoader.js";
import { rankOptions } from "../core/searchRank.js";

// ── GradCtx (avoids deep prop-drilling through requirement tree) ─────────
// isPhone is included so child nodes (NuPathGrid, ReqNode) can adapt.
export const GradCtx = createContext(null);

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

export function SearchCombo({
  value, onChange, groups, placeholder = "Search…", size = 10,
  // Majors are a ~1,500-option list, so an empty query has to render nothing —
  // see `rankOptions` below. Concentrations are a handful per program (measured:
  // median 5, max 30 across the catalog), where the opposite is true: a new
  // student who does not yet know a program's concentrations is better served
  // by seeing all of them on focus, filtering only once they start typing.
  showAllWhenEmpty = false,
}) {
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
  // an unordered substring filter. Empty query renders nothing (never all ~1500) —
  // `rankOptions` itself stays that way for every other caller; the pull-down-on-
  // focus behavior below is opted into per instance, not changed at the source.
  const filtered = q ? rankOptions(allOptions, query) : (showAllWhenEmpty ? allOptions : []);

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
          {!q && !showAllWhenEmpty ? (
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
  const { t }            = useLanguage();
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
    // EXCEPT `accumulate` nodes (e.g. "68 SH of SMFA 3000"): there the SH progress IS the
    // whole point — a repeatable course accrues credit across many term placements, so a
    // plain checkbox would hide that "took it once" isn't "done" the way it is for an
    // ordinary required course. Let those fall through to the pool display below.
    const singleCourse = !r.accumulate && r.children?.length === 1 && r.children[0].type === 'COURSE'
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
            {/* A locale key, not a composed English phrase. This row sat in
                English under a translated parent — the one line in the tree the
                8 locales could not reach, because it was assembled here out of
                two numbers and a literal instead of being looked up. */}
            {t("grad.fromPool", { sat: r.satSh, req: r.reqSh })}
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
  // `t` now comes from the top of the function. It used to be read here, below
  // the COURSE / RANGE / XOM early returns — a hook that only ran for some
  // requirement types, which is the ordering violation React warns about and
  // the reason the pool row could not reach for a key without moving it anyway.
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

// A described rule's text IS the rule, and it's scraped English — route it
// through the same live-translation pipeline course titles use, or a zh/ja
// panel renders a raw English sentence (caught in review).
function DescribedRuleText({ text, style }) {
  const translated = useTranslatedText(text);
  return <span style={style}>{scaleLatinRuns(translated)}</span>;
}

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

  const [open, setOpen] = useState(true);            // whole-section accordion
  const [openRows, setOpenRows] = useState(() => new Set());
  const toggleRow = (i) => setOpenRows(s => {
    const n = new Set(s);
    n.has(i) ? n.delete(i) : n.add(i);
    return n;
  });

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

    // Entries carry their identity so the expansion can show exactly what
    // was (and wasn't) counted — the whole point of a computed number is
    // that its provenance is one click away.
    const entriesFor = (rule) => {
      if (rule.scope.kind === "courses") {
        return (rule.courses ?? []).map(c => {
          const base = `${c.subject}${c.classId}`;
          return { base, grade: gradeOfBase(base), credits: courseMap[base]?.sh ?? 4 };
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
        out.push({ base, grade: gradeOfBase(base), credits: c.sh ?? 4 });
      };
      for (const [pid, sid] of Object.entries(placements)) consider(pid, SEM_INDEX[sid] !== undefined);
      for (const pid of placedOut) consider(pid, true);
      return out;
    };

    return rules.map(rule => {
      const label = rule.text ?? rule.title ?? "";
      const chip  = scopeChip(rule);
      if (rule.threshold == null || rule.scope.kind === "described") {
        return { mark: "·", color: "var(--text-5)", label, chip,
                 threshold: null, sub: null, cur: null, entries: null };
      }
      const entries = entriesFor(rule);
      const st = setConstraintStatus(entries, rule.threshold);
      const anyEntered = entries.some(e => e.grade != null);
      // The scoped average of ENTERED letters — real typed data, so it may
      // render (unlike the assumed ceiling, which never may). Shown with
      // the graded count so a 2-course average can't read as a transcript
      // GPA. Null while nothing in scope is entered.
      const scopedGpa = enteredGPA(entries);
      const nGraded   = entries.filter(e => countsInGPA(e.grade)).length;
      const cur = scopedGpa != null ? { gpa: scopedGpa, n: nGraded } : null;
      const base = { label, chip, threshold: rule.threshold, cur, entries };
      if (st.status === "impossible") {
        return { ...base, mark: "✕", color: REL_STYLE["prerequisite-order"].color,
                 sub: t("grad.gpa.impossible", { gpa: rule.threshold.toFixed(3) }) };
      }
      if (st.status === "atRisk" && anyEntered) {
        return { ...base, mark: "!", color: REL_STYLE["corequisite-viol"].color,
                 sub: t("grad.gpa.needed", { grade: st.neededGrade }) };
      }
      if (anyEntered && st.status === "met") {
        return { ...base, mark: "✓", color: REL_STYLE.prerequisite.color,
                 sub: t("grad.gpa.met") };
      }
      return { ...base, mark: "·", color: "var(--text-5)",
               sub: anyEntered && st.neededGrade ? t("grad.gpa.needed", { grade: st.neededGrade }) : null };
    });
  }, [rules, grades, placements, placedOut, courseMap, SEM_INDEX, program, programKind, t]);

  if (!rows.length) return null;
  return (
    <div style={{ marginTop: 10, borderTop: "1px solid var(--border-2)", paddingTop: 9 }}>
      {/* Section header — same accordion affordance as requirement sections */}
      <div onClick={() => setOpen(v => !v)}
           style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                    cursor: "pointer", userSelect: "none", marginBottom: open ? 6 : 0 }}>
        <span style={{ fontSize: isPhone ? 8 : 10, fontWeight: 700, color: "var(--text-3)",
                       letterSpacing: "0.05em" }}>
          {t("grad.gpa.title")}
        </span>
        <span style={{ fontSize: 8, color: "var(--text-5)" }}>{open ? "▼" : "▶"}</span>
      </div>

      {open && (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((r, i) => {
          const expandable = r.entries != null;
          const isOpen = openRows.has(i);
          return (
            <div key={i}>
              {/* Compact header: mark · scope chip · the bar · the number.
                  The catalog's own sentence lives in the expansion — prose
                  by default is what made the block feel heavy. */}
              <div onClick={expandable ? () => toggleRow(i) : undefined}
                   style={{ display: "flex", gap: 6, alignItems: "center",
                            cursor: expandable ? "pointer" : "default", userSelect: "none" }}>
                {/* Mark only when it SAYS something — a neutral dot next to a
                    boxed chip was chrome without information */}
                {r.mark !== "·" && (
                  <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 800,
                                 color: r.color, lineHeight: "14px" }}>{r.mark}</span>
                )}
                {r.chip && (
                  <span style={{ flexShrink: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
                                 whiteSpace: "nowrap", fontSize: isPhone ? 8 : 9.5, fontWeight: 600,
                                 color: "var(--text-4)" }}>
                    {r.chip}
                  </span>
                )}
                {r.threshold != null ? (
                  <span style={{ flexShrink: 0, fontSize: isPhone ? 8 : 9.5, fontWeight: 600,
                                 color: "var(--text-3)", letterSpacing: 0 }}>
                    ≥ {r.threshold.toFixed(3)}
                  </span>
                ) : (
                  <DescribedRuleText text={r.label}
                    style={{ minWidth: 0, fontSize: isPhone ? 8 : 9.5, lineHeight: 1.4,
                             color: "var(--text-4)" }} />
                )}
                <span style={{ flex: 1 }} />
                {r.cur && (
                  <span title={t("grad.gpa.current", { gpa: r.cur.gpa.toFixed(3), n: r.cur.n })}
                        style={{ flexShrink: 0, fontSize: isPhone ? 8.5 : 10, fontWeight: 700,
                                 color: "var(--text-2)", letterSpacing: 0 }}>
                    {r.cur.gpa.toFixed(3)}
                    <span style={{ fontSize: isPhone ? 6.5 : 8, fontWeight: 500,
                                   color: "var(--text-5)", marginLeft: 3 }}>({r.cur.n})</span>
                  </span>
                )}
                {expandable && (
                  <span style={{ flexShrink: 0, fontSize: 7, color: "var(--text-5)" }}>
                    {isOpen ? "▼" : "▶"}
                  </span>
                )}
              </div>

              {/* Status line, in the mark's colour */}
              {r.sub && (
                <div style={{ fontSize: isPhone ? 7.5 : 9, lineHeight: 1.4, color: r.color,
                              margin: "2px 0 0 0" }}>
                  {r.sub}
                </div>
              )}

              {/* Provenance: exactly what was counted. Graded courses
                  full-strength, ungraded dimmed. (The catalog's sentence
                  used to render here too — pure redundancy: the header
                  already IS the rule, and the sentence is untranslatable
                  scraped English.) */}
              {isOpen && expandable && (
                <div style={{ margin: "5px 0 2px 0", paddingLeft: 8,
                              borderLeft: "2px solid var(--border-2)" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {r.entries.map((e, j) => {
                      const c = courseMap[e.base];
                      const graded = countsInGPA(e.grade);
                      return (
                        <div key={j} style={{ display: "flex", gap: 8, alignItems: "baseline",
                                              fontSize: isPhone ? 7.5 : 9, letterSpacing: 0,
                                              color: graded ? "var(--text-3)" : "var(--text-5)" }}>
                          <span style={{ fontWeight: 700, width: isPhone ? 52 : 64, flexShrink: 0 }}>
                            {c?.code ?? e.base}
                          </span>
                          <span style={{ fontWeight: graded ? 700 : 400, width: 18, flexShrink: 0 }}>
                            {e.grade ?? "–"}
                          </span>
                          <span style={{ color: "var(--text-5)" }}>
                            {Number.isFinite(e.credits) ? e.credits : "?"} SH
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
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
  const { courseMap, isPhone, enteredGpaStat: stat, specialTermPl, studentType } = usePlanner();
  const [open, setOpen] = useState(false);

  // Co-op search eligibility (catalog policy): undergrad 2.000, grad 3.000.
  // Only when the plan actually contains a co-op AND the entered GPA is
  // provably below the bar — same no-false-alarm rule as everything else.
  const coopBar = useMemo(() => {
    if (!stat) return null;
    const hasCoop = Object.values(specialTermPl ?? {}).some(v => v?.typeId === "coop");
    if (!hasCoop) return null;
    const bar = COOP_GPA[studentType === "graduate" ? "graduate" : "undergrad"];
    return stat.gpa < bar - 1e-9 ? bar : null;
  }, [stat, specialTermPl, studentType]);

  if (!stat) return null;
  return (
    <div style={{ padding: "6px 10px", marginBottom: 8, borderRadius: 6,
                  border: "1px solid var(--border-1)" }}>
      <div onClick={() => setOpen(v => !v)}
           style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
                    cursor: "pointer", userSelect: "none" }}>
        <span style={{ fontSize: isPhone ? 8 : 10, fontWeight: 700, color: "var(--text-3)",
                       letterSpacing: "0.05em" }}>
          {t("grad.gpa.sofar")}
        </span>
        <span style={{ fontSize: isPhone ? 9 : 11, fontWeight: 700, color: "var(--text-2)", letterSpacing: 0 }}>
          {stat.gpa.toFixed(3)}
          <span style={{ fontSize: isPhone ? 7 : 8.5, fontWeight: 500, color: "var(--text-5)", marginLeft: 5 }}>
            {t("grad.gpa.sofar.n", { n: stat.n })}
          </span>
          <span style={{ fontSize: 7, color: "var(--text-5)", marginLeft: 5 }}>{open ? "▼" : "▶"}</span>
        </span>
      </div>
      {coopBar && (
        <div style={{ marginTop: 4, fontSize: isPhone ? 7.5 : 9, lineHeight: 1.4,
                      color: REL_STYLE["corequisite-viol"].color }}>
          {t("grad.gpa.coop", { gpa: coopBar.toFixed(3) })}
        </div>
      )}
      {open && (
        <div style={{ marginTop: 5, paddingLeft: 8, borderLeft: "2px solid var(--border-2)",
                      display: "flex", flexDirection: "column", gap: 2 }}>
          {stat.counted.map((e, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline",
                                  fontSize: isPhone ? 7.5 : 9, letterSpacing: 0, color: "var(--text-3)" }}>
              <span style={{ fontWeight: 700, width: isPhone ? 52 : 64, flexShrink: 0 }}>
                {courseMap[e.base]?.code ?? e.base}
              </span>
              <span style={{ fontWeight: 700, width: 18, flexShrink: 0 }}>{e.grade}</span>
              <span style={{ color: "var(--text-5)" }}>
                {Number.isFinite(e.credits) ? e.credits : "?"} SH
              </span>
            </div>
          ))}
        </div>
      )}
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
  //     desktop  hover shows the explanation
  //     touch    tap shows the explanation
  //   The badge no longer navigates: linking the catalog off a "checked" mark
  //   read as if the checkmark itself were the way into the program. The
  //   program name beside it is the catalog link now (see ProgramNameLink);
  //   the badge is purely the "how thoroughly we checked this" footnote,
  //   reachable the same way on desktop and touch.
  //
  //   LAYOUT keys off isPhone (<600px), because that is where the badge
  //   actually overflowed the card. A tablet has room to keep it inline.
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
      {pill}

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
          <ProgramNameLink name={minorName} href={minor.metadata?.verification?.sourceUrl} nameColor={nameColor} isPhone={isPhone} />
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
        <div style={{ padding: "0 10px 6px" }}>
          {sections.map((sec, i) => <SectionBlock key={i} sec={sec} />)}
          <GpaRules program={minor} programKind="minor" />
        </div>
      )}

      {/* Full-width expand/collapse bar — a big target for this long card. */}
      <div style={{ padding: "0 10px 10px" }}>
        <ExpandToggleBar expanded={expanded} onToggle={() => setExpanded(v => !v)} />
      </div>
    </div>
  );
}

// ── ProgramNameLink: the program's name, as the catalog link ─────────
// The program name (e.g. "Industrial Engineering, BSIE (Boston)") is the
// affordance for opening the catalog page — an underlined-on-hover link, the
// thing a reader actually expects to click to reach the program. When there's
// no source URL it degrades to plain text. stopPropagation keeps a click from
// also toggling the card header it sits inside. inline-block so the underline
// hugs the text (not the full row) and the vertical margin applies.
function ProgramNameLink({ name, href, nameColor, isPhone }) {
  const [hov, setHov] = useState(false);
  const base = {
    display: "inline-block",
    fontWeight: nameColor ? 700 : 400,
    fontSize: isPhone ? 7 : 10,
    marginTop: isPhone ? 3 : 5,
  };
  if (!href) return <div style={{ ...base, color: nameColor ?? "var(--text-2)" }}>{scaleLatinRuns(name)}</div>;
  // Muted light-grey, the way an inline UI link reads — it's a secondary
  // affordance, not the loud thing on the card. The claude-preview override
  // (nameColor) still wins so a pending change stays orange.
  const linkColor = nameColor ?? "var(--text-4)";
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        ...base,
        color: linkColor,
        cursor: "pointer",
        textDecoration: hov ? "underline" : "none",
        textDecorationColor: linkColor,
        textUnderlineOffset: 2,
      }}
    >
      {scaleLatinRuns(name)}
    </a>
  );
}

// ── ExpandToggleBar: full-width expand/collapse control for long cards ─
// A whole-program card (a major or minor) is a lot to open, so the tiny
// header caret is easy to miss. This is a big, obvious, horizontally-long
// rounded target: a down chevron when collapsed (click to expand) that flips
// to an up chevron when open (click to collapse). When open it sits at the
// BOTTOM of the expanded content, so a long list can be closed without
// scrolling back up to the header. The header caret is kept as the compact
// affordance alongside it.
export function ExpandToggleBar({ expanded, onToggle }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onToggle(); }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      aria-expanded={expanded}
      style={{
        width: "100%",
        display: "flex", alignItems: "center", justifyContent: "center",
        // Blend into the card: transparent by default, only a faint fill on
        // hover so the target is confirmable without ever looking like a
        // heavy button.
        background: hov ? "var(--bg-surface)" : "transparent",
        border: "1px solid var(--border-2)",
        borderRadius: 99,
        padding: "2px 0",
        cursor: "pointer",
        // The chevron sits at border strength — present, not prominent —
        // and nudges toward text on hover.
        color: hov ? "var(--text-4)" : "var(--border-2)",
        transition: "background 0.15s, color 0.15s",
      }}
    >
      {/* One chevron path, rotated 180° when open — down means "expand", up means "collapse". */}
      <svg width="13" height="8" viewBox="0 0 13 8" aria-hidden="true"
           style={{ display: "block", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
        <path d="M1.5 2 L6.5 6 L11.5 2" fill="none" stroke="currentColor"
              strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}


// ── MajorCard: framed collapsible card for a major's requirements ─
// Frame is a subtle background tint (no border line) matching MinorBlock.
export function MajorCard({ label, name, subtitle, verified, verification, progress, expanded, onToggle, isPhone, isMobile, loading, loadingLabel, children, nameColor, subtitleColor }) {
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
          <ProgramNameLink name={name} href={verification?.sourceUrl} nameColor={nameColor} isPhone={isPhone} />
          {subtitle && <div style={{ fontWeight: subtitleColor ? 700 : 400, color: subtitleColor ?? "var(--text-4)",
            fontSize: isPhone ? 7 : 9, marginTop: 1,
            /* Indented so it reads as belonging to the program above it
               rather than as a second, equal line. */
            marginInlineStart: isPhone ? 5 : 8 }}>{scaleLatinRuns(subtitle)}</div>}
        </div>
        {!isPhone && progress.requiredSH > 0 && (
          <span style={{ fontSize: 9, color: "var(--text-5)", marginTop: 2, flexShrink: 0 }}>{progress.requiredSH} SH</span>
        )}
        {/* The catalog can say the total VARIES rather than omit it — Biology,
            PhD—Advanced Entry publishes "Variable total semester hours
            required". Saying so beats the silence a 0 would otherwise produce,
            which reads as "we could not find one". */}
        {!isPhone && progress.requiredSH === 0 && progress.variableSH && (
          <span style={{ fontSize: 9, color: "var(--text-5)", marginTop: 2, flexShrink: 0 }}>{t("grad.credits.variable")} SH</span>
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
        <div style={{ padding: "0 10px 6px" }}>
          {loading
            ? <div style={{ fontSize: 9, color: "var(--text-5)", padding: "6px 0", textAlign: "center" }}>{loadingLabel}</div>
            : children
          }
        </div>
      )}

      {/* Full-width expand/collapse bar — a big target for this long card. */}
      <div style={{ padding: "0 10px 10px" }}>
        <ExpandToggleBar expanded={expanded} onToggle={onToggle} />
      </div>
    </div>
  );
}

// ── Stale-selection notice ───────────────────────────────────────
// Shown when a saved program path can no longer be resolved to any current
// catalog entry. The selection is preserved until the user removes it.
export function StaleNotice({ message, onRemove, isPhone, removeLabel = "Remove" }) {
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
    placements, placedOut, effectivePlacements, substitutions, effectiveSubstitutions, courseMap, totalSHPlaced, totalSHDone, onDragStart, selectedId, setSelectedId, setShowPanel, isPhone, isMobile,
    specialTermPl, SEM_INDEX,
    major: majorPath, setMajor: setMajorPath,
    major2: major2Path, setMajor2: setMajor2Path,
    plusOne, setPlusOne,
    conc: selConc, setConc: setSelConc,
    conc2: selConc2, setConc2: setSelConc2,
    minor1, setMinor1,
    minor2, setMinor2,
    getSemStatus,
    studentType,
    setShowNewPlanModal, setNewPlanInitialType,
    claudePreview,
    grades,
    planEntSem, planEntYear,
    reservations,
  } = usePlanner();

  const isGrad = studentType === "graduate";

  // What the plan has left undecided. See the note where this renders.
  const reserved = useMemo(() => reservedTotals(reservations), [reservations]);

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
  const acceleratedPathway = usePort(IAcceleratedPathway);
  const unitName          = creditSystem.getUnitName();
  const { t } = useLanguage();

  // Programs are frozen per catalog edition, so the search list shows the
  // edition THIS cohort follows — not simply the newest. One row per
  // program either way; this only decides which year that row is.
  const cohortYear = cohortCatalogYear(planEntSem, planEntYear);
  const majorGroups  = useMemo(
    () => isGrad ? majorRequirements.getGradMajorOptionGroups(cohortYear) : majorRequirements.getMajorOptionGroups(cohortYear),
    [majorRequirements, isGrad, cohortYear]
  );

  // Translated major name + concentration (no-ops when translation disabled or in source locale).
  const minorGroups  = useMemo(() => majorRequirements.getMinorOptionGroups(cohortYear), [majorRequirements, cohortYear]);

  // ── Accelerated pathways (Northeastern: "PlusOne") ──────────────
  // Scoped to the plan's declared major(s): the port returns only pathways an
  // eligible undergraduate could actually enter, and [] for a graduate plan.
  // Both majors are passed because a second major can be the eligible one —
  // Computer Engineering reaches the MS in Computer Science, for instance.
  // EVERY pathway, for an undergraduate plan — not just the ones our data says
  // the student is eligible for. Eligibility is a fact about a published page we
  // transcribed by hand, and gating on it means a wrong transcription silently
  // denies a real student their programme. We show them all and warn instead.
  const plusOneOptions = useMemo(
    () => acceleratedPathway.listPathways({ studentType }),
    [acceleratedPathway, studentType]
  );

  // The declared programmes, as { id, label } — the id gives the college (it is
  // "<year>/<college>/<folder>") and the label is what "and all combined majors"
  // matches on, since NEU names a combined major after both of its halves.
  const myPrograms = useMemo(() => {
    const labelOf = (path) => {
      for (const opts of majorGroups.values()) {
        const hit = opts.find(o => o.path === path);
        if (hit) return hit.label;
      }
      return null;
    };
    return [majorPath, major2Path].filter(Boolean).map(path => ({
      id: programIdFromPath(path),
      label: labelOf(path),
    })).filter(p => p.id);
  }, [majorPath, major2Path, majorGroups]);

  // Pathways the student's own programme is listed for. Not a filter — the
  // dropdown offers everything — but it drives the ORDER and the default, so the
  // common case is one click and the unusual one is still reachable.
  const eligiblePathways = useMemo(
    () => plusOneOptions.filter(p => isEligibleFor(p, myPrograms)),
    [plusOneOptions, myPrograms]
  );

  // SearchCombo keys options on `path`, so the pathway id goes there. Two groups:
  // what this student is listed for, then everything else. A flat alphabetical
  // list buried the relevant pathway among near-identical labels.
  const plusOneGroups = useMemo(() => {
    const map = new Map();
    const eligibleIds = new Set(eligiblePathways.map(p => p.id));
    const push = (key, p) => {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ path: p.id, label: p.label ?? p.id, name: p.label ?? p.id });
    };
    for (const p of plusOneOptions) if (eligibleIds.has(p.id)) push(t("plusone.group.eligible"), p);
    for (const p of plusOneOptions) if (!eligibleIds.has(p.id)) push(t("plusone.group.other"), p);
    return map;
  }, [plusOneOptions, eligiblePathways, t]);

  // A saved pathway that no longer resolves (the college stopped publishing it,
  // or the id changed) must not vanish silently — the block renders a notice and
  // the student removes it deliberately, matching how a stale major behaves.
  const plusOnePathway = useMemo(
    () => (plusOne ? acceleratedPathway.getPathway(plusOne) : null),
    [acceleratedPathway, plusOne]
  );

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
  const [showPlusOnePicker, setShowPlusOnePicker] = useState(() => plusOne !== "");
  // Kept alongside the disabled switch-type prompt below; nothing sets it now.
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
  // Grade-scoped too: a definitively failed take (entered F/U/W) satisfies
  // nothing — dropVoidTakes removes it, and a placed retake restores the
  // course key through its instance id. Identity while no grades exist.
  // ORDER MATTERS: voids drop BEFORE substitutions re-apply — a failed
  // substituting course must not smuggle its virtual target back in
  // (effectivePlacements has the target under its own ungraded id, which
  // dropVoidTakes alone could never remove).
  // A work term registers a real course (COOP 3945), which 37 undergraduate
  // programs name as a requirement. It joins placedSet ONLY — realPlacedSet
  // below feeds General Electives and must stay what the student placed.
  // Which work-term courses this student's programs accept. Majors only:
  // measured over the corpus, 0 of 172 minors name one.
  const coopOptions = useMemo(
    () => coopOptionsInPrograms([major, major2Data], courseMap),
    [major, major2Data, courseMap]
  );

  const placedSet = useMemo(
    () => {
      const set = buildPlacedKeySet(filterInTimeline(applySubstitutions(dropVoidTakes(placements, grades), effectiveSubstitutions), SEM_INDEX), placedOut, courseMap);
      for (const k of workTermGrants(specialTermPl, specialTerms?.getTypes() ?? [], SEM_INDEX, null, coopOptions).planned) set.add(k);
      return set;
    },
    [placements, effectiveSubstitutions, placedOut, courseMap, SEM_INDEX, grades, specialTermPl, specialTerms, coopOptions]
  );

  // Real-only placed set: excludes virtual substitution-target entries from effectivePlacements.
  // Used for GE display so substituted courses don't appear twice with doubled SH.
  const realPlacedSet = useMemo(
    () => buildPlacedKeySet(filterInTimeline(dropVoidTakes(placements, grades), SEM_INDEX), placedOut, courseMap),
    [placements, placedOut, courseMap, SEM_INDEX, grades]
  );

  const doneSet = useMemo(() => {
    // Earned view: F/U/W and I have earned nothing (registrar's grade
    // table) — a completed-semester course only counts as DONE when its
    // entered grade yields credit, or no grade is entered (assumed).
    // Same order as placedSet: voids drop before substitutions re-apply.
    const donePlacements = Object.fromEntries(
      Object.entries(applySubstitutions(dropUnearnedTakes(placements, grades), effectiveSubstitutions))
        .filter(([, semId]) => getSemStatus(semId) === "completed")
    );
    const set = buildPlacedKeySet(donePlacements, placedOut, courseMap);
    // A co-op that has already happened makes its course COMPLETED, not
    // merely planned — otherwise the requirement row reads as still pending
    // for a student who finished the co-op two years ago.
    const isDone = (semId) => getSemStatus(semId) === "completed";
    for (const k of workTermGrants(specialTermPl, specialTerms?.getTypes() ?? [], SEM_INDEX, isDone, coopOptions).completed) set.add(k);
    return set;
  }, [placements, effectiveSubstitutions, placedOut, courseMap, getSemStatus, grades, specialTermPl, specialTerms, SEM_INDEX, coopOptions]);

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

  // Grade-aware: a failed course (entered F/U/W) earns nothing, NUPath
  // attributes included — dropVoidTakes removes it from coverage until a
  // retake restores the base course through its instance id.
  const npCovered  = useMemo(() => attributeSystem.getCoverage(filterInTimeline(dropVoidTakes(placements, grades), SEM_INDEX), courseMap, computeGrantedAttrs(specialTermPl, specialTerms?.getTypes() ?? [], SEM_INDEX)), [attributeSystem, placements, grades, courseMap, specialTermPl, specialTerms, SEM_INDEX]);
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

    // Allocate major requirements first, WITHOUT General Electives yet.
    const { sections: majorResults, allocatedSet } = allocateMajorSections(major, placedSet, courseMap);

    // Allocate concentration sharing the major's used set so courses already
    // counted toward major requirements can't also satisfy the concentration.
    let concAllocated = null;
    if (selConc && major.concentrations) {
      const chosen = resolveConcentration(major, selConc);
      if (chosen) {
        const [allocated] = allocateSections([chosen], placedSet, allocatedSet, courseMap);
        concAllocated = allocated ?? null;
      }
    }

    // General Electives must come AFTER the concentration: a course an XOM pool
    // releases once satisfied (see the cap in allocateNode) is exactly the kind of
    // course a concentration might then claim — computing General Electives before
    // that runs would let it double-count that course as both a general elective
    // and concentration credit.
    const candidateKeys = collectCandidateKeys(
      concAllocated ? [...majorResults, concAllocated] : majorResults, realPlacedSet ?? placedSet
    );
    const generalElectives = calculateGeneralElectives(
      placedSet, allocatedSet, courseMap, major.generalElectiveSH ?? 0, doneSet, candidateKeys, realPlacedSet
    );
    const majorWithElectives = [...majorResults, generalElectives];

    return { majorSections: majorWithElectives, concSection: concAllocated };
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
    // `variableSH` distinguishes "the catalog publishes no total" from "the
    // catalog says the total VARIES" — Biology, PhD—Advanced Entry states
    // "Variable total semester hours required". Both leave requiredSH at 0, so
    // without this the header is equally silent about two different facts.
    return { totalSat, totalReq, doneSat, completedSH: totalSHDone, plannedSH: totalSHPlaced - totalSHDone,
             requiredSH: major?.totalCreditsRequired ?? 0,
             variableSH: major?.totalCreditsSource === "variable" };
  }, [majorSections, major1DoneSections, totalSHDone, totalSHPlaced, major]);

  // ── Second major allocation (courses double-count freely per NU policy) ─
  const major2Sections = useMemo(() => {
    if (!major2Data) return [];
    const { sections, allocatedSet } = allocateMajorSections(major2Data, placedSet, courseMap);
    // Concentration shares this major's used set, so a course already counted
    // toward its requirements can't also satisfy its concentration — the same
    // rule major 1 uses. Across the two majors, courses still double-count
    // freely, per NU policy.
    let concResults = [];
    if (selConc2 && major2Data.concentrations) {
      const chosen = resolveConcentration(major2Data, selConc2);
      if (chosen) concResults = allocateSections([chosen], placedSet, allocatedSet, courseMap);
    }
    // General Electives comes after the concentration is allocated (see the
    // matching comment on majorSections above) so a released XOM-pool course the
    // concentration then claims isn't also double-counted as a general elective.
    const candidateKeys = collectCandidateKeys([...sections, ...concResults], realPlacedSet ?? placedSet);
    const generalElectives = calculateGeneralElectives(
      placedSet, allocatedSet, courseMap, major2Data.generalElectiveSH ?? 0, doneSet, candidateKeys, realPlacedSet
    );
    return [...sections, generalElectives, ...concResults];
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
    return { totalSat, totalReq, doneSat, completedSH: totalSHDone, plannedSH: totalSHPlaced - totalSHDone,
             requiredSH: major2Data?.totalCreditsRequired ?? 0,
             variableSH: major2Data?.totalCreditsSource === "variable" };
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
            {/* Heading reads as "Undergraduate Program Selection".

                The type word USED to be its own click target on desktop,
                opening a "make a plan of the other type" prompt. Disabled: the
                row already collapses on click, so a second target inside it
                did something different with no affordance saying so — a bold
                word is not a button, and two behaviours in one line reads as
                the panel misbehaving. The prompt below is commented out with
                it.

                Nothing is lost. The New Plan modal has its own
                undergrad/graduate toggle, which is the discoverable route to
                the same thing.

                Also now localised: it was hardcoded English, so a Japanese
                planner read "Undergrad プログラム選択". `header.plan.group.*`
                already carries both words in all 8 locales and means exactly
                this — the type a plan belongs to. */}
            <span
              onClick={() => setShowProgram(v => !v)}
              style={{ fontWeight: 400, color: "var(--text-5)", fontSize: isPhone ? 9 : 11, cursor: "pointer", flex: 1 }}
            >
              <span style={{ fontWeight: 700 }}>
                {t(isGrad ? "header.plan.group.graduate" : "header.plan.group.undergrad")}
              </span>
              {" "}{t("grad.programSelection")}
            </span>
            <span onClick={() => setShowProgram(v => !v)} style={{ fontSize: 9, color: "var(--text-5)", lineHeight: 1, cursor: "pointer", padding: "2px 0" }}>{showProgram ? "▼" : "▶"}</span>
          </div>

          {/* ⚠ DISABLED — its only trigger was the bold type word above, which
              was removed for being an invisible second click target inside a
              row that already collapses. Kept rather than deleted because the
              EXPLANATION is still worth something: a student on a graduate plan
              who searches for an undergraduate major finds nothing and is told
              nowhere why. That gap is now unaddressed, and this is the shape of
              the answer if it is picked up again — it just needs a trigger that
              looks like one. Creating the plan itself already works from the
              New Plan modal's own type toggle. */}
          {false && showSwitchPrompt && !isPhone && (
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
                  <SearchCombo value={selConc} onChange={setSelConc} groups={concGroups} placeholder={isPhone ? t("grad.major.search.short") : t("grad.conc.search")} showAllWhenEmpty />
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
                                   placeholder={isPhone ? t("grad.major.search.short") : t("grad.conc.search")} showAllWhenEmpty />
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

              {/* PlusOne selector — undergrad only, and only when this major
                  actually has a published pathway.

                  The emptiness check matters: `+ Add PlusOne` on a plan with no
                  eligible pathway is a dead affordance that teaches the student
                  the feature is broken. `selectPathways` returns [] for a major
                  no college pairs with a master's, so the button simply is not
                  there — the same reason the attribute grid hides itself when
                  the adapter publishes no attributes. */}
              {/* Shown when a pathway is available OR already declared AND STILL
                  RESOLVABLE. The second half used to be bare `plusOne` (any
                  declared id at all), so the ✕ stayed reachable for a student
                  whose major became ineligible — but it also meant a plan
                  whose pathway can no longer be looked up at all (deleted, or
                  the whole feature switched off via acceleratedPathway's
                  HIDDEN flag) still showed this row: an empty search box with
                  nothing in it, since there is nothing left to search. `plusOnePathway`
                  is null in both cases, and the StaleNotice card further down
                  (driven by `plusOne` directly, unaffected by this gate) already
                  owns removing an unresolvable pathway — this row has nothing
                  useful to add once there is nothing to pick from. */}
              {/* `showPlusOnePicker` is separate state, not derived from `plusOne`
                  — the button used to commit straight to
                  `eligiblePathways[0] ?? plusOneOptions[0]`, so a student with NO
                  eligible pathway (everyone outside Khoury today) was silently
                  defaulted into whichever pathway happened to ship first and
                  shown it as "not eligible", reading as "my program has no
                  PlusOne" rather than "we haven't transcribed yours yet". Opening
                  an empty picker instead — the same pattern `showMajor2` already
                  uses — makes the student choose, and `showAllWhenEmpty` lists
                  every pathway (there are only a handful) rather than requiring
                  a search term first, matching the concentration picker. */}
              {!isGrad && (plusOneOptions.length > 0 || plusOnePathway) && (
                (plusOne || showPlusOnePicker) ? (
                  <div data-claude-focus="plusOne" style={{ marginTop: 8, marginBottom: 8, ...(pvMark("plusOne", { inset: true }).style ?? {}) }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
                      <div style={{ fontSize: isPhone ? 7 : 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", flex: 1 }}>
                        {t("plusone.label")}
                      </div>
                      <button
                        onClick={() => { setPlusOne(""); setShowPlusOnePicker(false); }}
                        style={{ background: "transparent", border: "none", color: "var(--text-5)", fontSize: 12, cursor: "pointer", lineHeight: 1, padding: "0 2px" }}
                        title={t("plusone.remove")}
                      >✕</button>
                    </div>
                    <SearchCombo value={plusOne} onChange={setPlusOne} groups={plusOneGroups}
                                 placeholder={isPhone ? t("grad.major.search.short") : t("plusone.search")} showAllWhenEmpty />
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => setShowPlusOnePicker(true)}
                      style={{
                        display: "block", width: "100%", marginTop: 6, marginBottom: 2,
                        padding: "4px 0", background: "transparent",
                        border: "1px dashed var(--border-3)", borderRadius: 4,
                        color: "var(--text-5)", fontSize: isPhone ? 8 : 9,
                        cursor: "pointer", textAlign: "center",
                      }}
                    >{t("plusone.add")}</button>
                    <div style={{ fontSize: isPhone ? 6 : 8, color: "var(--text-5)", textAlign: "center", marginBottom: 8 }}>
                      {t("plusone.coverage.note")}
                    </div>
                  </>
                )
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

        {/* ── What the plan has NOT decided ────────────────────────
            Every section below reads `placements`, which by design cannot see
            a reservation — so a requirement the student has reserved two cards
            for still reads "0/2", and an advisor reads that as "not planned".
            This says otherwise, and says only what it can prove: a count.

            Deliberately not per-section. Marking the sections a card is bound
            to was measured at 17.7% of cards — a median of 2 sections out of 11
            — while 41.7% stay ambiguous and 39.4% are free electives belonging
            to no section. It would add a state that can be wrong to say less.
            A count covers every card and cannot be. ── */}
        {!fetching && reserved.cards > 0 && (
          <div style={{
            fontSize: 10, color: "var(--text-4)", background: "var(--card-bg)",
            border: "1px dashed var(--border)", borderRadius: 4,
            padding: "6px 8px", marginBottom: 8,
          }}>
            {t("grad.reserved.note", { cards: reserved.cards, sh: reserved.sh })}
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
          {/* Belongs to the program you have CHOSEN, so it sits inside the
              card rather than beside the picker. Silent unless it would help —
              see src/core/planTemplate.js for when. */}
          {/* The concentration is part of what the plan IS, not decoration: 93 programs
              require one, their option pools are typically disjoint, and without the pick
              CHART can only plan against the union of all of them. */}
          <SamplePlanOffer path={selPath} isGrad={isGrad} programData={major}
                           concentration={selConc} isPhone={isPhone} />
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

        {/* ── PlusOne — after the minors, matching the selector order above.
               Last of the program cards because it is the only one that is
               about a SECOND degree: everything above it is the bachelor's. ── */}
        {!isGrad && plusOne && (
          plusOnePathway
            ? <PlusOneBlock
                pathway={plusOnePathway}
                eligible={isEligibleFor(plusOnePathway, myPrograms)}
                onClear={() => { setPlusOne(""); setShowPlusOnePicker(false); }}
                nameColor={claudePreview?.changed?.has?.("plusOne") ? "#fb923c" : undefined}
              />
            : <StaleNotice
                isPhone={isPhone}
                message={t("plusone.gone")}
                removeLabel={t("grad.stale.remove")}
                onRemove={() => { setPlusOne(""); setShowPlusOnePicker(false); }}
              />
        )}

        {/* ── GPA so far — always BELOW every major/minor card; renders
               only once a letter grade is entered ── */}
        <GpaSoFar />

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