// ═══════════════════════════════════════════════════════════════════
// BANK PANEL  — right-hand sidebar: Course Bank ↔ Graduation toggle
// ═══════════════════════════════════════════════════════════════════
import { useMemo, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { usePlanner }  from "../context/PlannerContext.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { subjectColor } from "../core/courseModel.js";
import { takesUsed } from "../core/repeatInstances.js";
import { alternativesFor, programIndexSet } from "../core/equivalenceIndex.js";
import { parseCodeTerms, parseCourseCodes, normalizeCodeQuery } from "../core/courseCodeParse.js";
import { useEquivalences } from "./useEquivalences.js";
import SubstitutionPopover from "./SubstitutionPopover.jsx";
import { usePort }        from "../context/InstitutionContext.jsx";
import { ISpecialTerms }  from "../ports/ISpecialTerms.js";
import { IAttributeSystem } from "../ports/IAttributeSystem.js";
import { ICourseCatalog } from "../ports/ICourseCatalog.js";
import { useRelevance }   from "../context/RelevanceContext.jsx";
import { useLanguage }    from "../context/LanguageContext.jsx";
import { useTranslatedText, scaleLatinRuns } from "../context/TranslationContext.jsx";
import CourseCard  from "./CourseCard.jsx";
import GradPanel   from "./GradPanel.jsx";

// One row in the substitution-search dropdown.  Extracted so each row
// can call useTranslatedText on its own title.
function CourseSearchRow({ c, isSelected, onPick }) {
  const title = useTranslatedText(c.title);
  return (
    <div
      onMouseDown={onPick}
      onTouchStart={e => { e.preventDefault(); onPick(); }}
      style={{
        padding: "5px 10px", fontSize: 11, cursor: "pointer",
        background: isSelected ? "var(--bg-surface-2)" : undefined,
        color: isSelected ? "var(--text-1)" : "var(--text-2)",
      }}
      onMouseEnter={e => e.currentTarget.style.background = "var(--bg-surface-2)"}
      onMouseLeave={e => e.currentTarget.style.background = isSelected ? "var(--bg-surface-2)" : ""}
    >
      <div style={{ fontWeight: 600 }}>{c.subject} {c.number}</div>
      <div style={{ fontSize: 10, color: "var(--text-5)" }}>{scaleLatinRuns(title)}</div>
    </div>
  );
}

// ── Course search for substitution input ────────────────────────

function CourseSearch({ courses, value, onChange, placeholder, isPhone = false }) {
  const [query, setQuery] = useState("");
  const [open,  setOpen]  = useState(false);
  const [rect,  setRect]  = useState(null);
  const inputRef = useRef(null);

  // "phys1111" must match a haystack built as "phys 1111" — the same tolerance
  // parseCourseCodes has, so both spellings behave identically here too.
  const q = normalizeCodeQuery(query).toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return [];
    const tokens = q.split(/\s+/).filter(Boolean);
    const withScore = [];
    courses.forEach(c => {
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
    withScore.sort((a, b) => b.score - a.score || a.c.code.localeCompare(b.c.code));
    return withScore.slice(0, 60).map(x => x.c);
  }, [courses, q]);

  const selected = value ? courses.find(c => c.id === value) : null;
  const displayVal = selected ? `${selected.subject} ${selected.number}` : "";

  const updateRect = () => { if (inputRef.current) setRect(inputRef.current.getBoundingClientRect()); };
  const handleFocus  = () => { updateRect(); setQuery(""); setOpen(true); };
  const handleBlur   = () => setTimeout(() => setOpen(false), 300);
  const handleChange = e  => { setQuery(e.target.value); setOpen(true); updateRect(); };
  const select       = id => { onChange(id); setOpen(false); setQuery(""); };

  return (
    <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <input
          ref={inputRef}
          type="text"
          value={open ? query : displayVal}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          style={{
            flex: 1, fontSize: isPhone ? 8 : 10, padding: "4px 6px", minWidth: 0,
            background: "var(--bg-surface-2)", color: "var(--text-2)",
            border: "1px solid var(--border-2)", borderRadius: 4, outline: "none",
          }}
        />
        {value && (
          <button
            onMouseDown={e => { e.preventDefault(); onChange(null); }}
            onTouchStart={e => { e.preventDefault(); onChange(null); }}
            style={{ background: "transparent", border: "none", color: "var(--text-4)", fontSize: 11, cursor: "pointer", padding: "0 2px", flexShrink: 0 }}
          >✕</button>
        )}
      </div>
      {open && rect && createPortal(
        <div style={{
          position: "fixed", zIndex: 9000,
          top: rect.bottom + 2,
          ...(isPhone ? (() => { const w = Math.max(rect.width, window.innerWidth * 0.48); return { width: w, left: Math.min(rect.left, window.innerWidth - w - 4) }; })() : { width: rect.width, left: rect.left }),
          maxHeight: 280, overflowY: "auto",
          background: "var(--bg-surface)", border: "1px solid var(--border-2)",
          borderRadius: 4, boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
          fontFamily: "'InterTight', 'Inter', system-ui, sans-serif", fontSize: 12,
        }}>
          {!q ? (
            <div style={{ padding: "7px 10px", fontSize: 11, color: "var(--text-5)", fontStyle: "italic" }}>Type to search…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "7px 10px", fontSize: 11, color: "var(--text-5)" }}>No results</div>
          ) : filtered.map(c => (
            <CourseSearchRow
              key={c.id}
              c={c}
              isSelected={c.id === value}
              onPick={() => select(c.id)}
            />
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Suggested-substitution row ───────────────────────────────────
//
// Deliberately in the DROPDOWN idiom (code bold + title beneath, like
// CourseSearchRow) rather than the committed-row idiom, which is code-only.
// The tier carries no chrome of its own: A and B are entitlements the catalog
// already grants, so there is nothing to say, and only C shows the same "⚠"
// the panel already uses for an unplaced course. The reason lives in the
// tooltip, so the row stays one line of text.
function SuggestionRow({ alt, course, onApply, onHoverPlus, t, isPhone }) {
  // `course` is resolved by the caller. The index keys courses as "PHYS 1151"
  // while courseMap keys them as "PHYS1151", so looking up alt.to in courseMap
  // silently yields undefined and every title renders blank.
  const to    = course;
  const title = useTranslatedText(to?.title ?? "");
  return (
    <div
      onMouseDown={onApply}
      onTouchStart={e => { e.preventDefault(); onApply(); }}

      style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: isPhone ? "2px 4px" : "4px 6px", marginBottom: 2,
        borderRadius: 4, cursor: "pointer", background: "var(--bg-surface-2)",
        fontSize: isPhone ? 5 : 10,
      }}
      onMouseEnter={e => e.currentTarget.style.background = "var(--bg-surface)"}
      onMouseLeave={e => e.currentTarget.style.background = "var(--bg-surface-2)"}
    >
      <span style={{ fontWeight: 700, color: "var(--link-1)", flexShrink: 0 }}>{alt.from}</span>
      <span style={{ fontSize: isPhone ? 6 : 9, color: "var(--text-5)", flexShrink: 0 }}>→</span>
      <span style={{ fontWeight: 700, color: "var(--text-2)", flexShrink: 0 }}>
        {to ? `${to.subject} ${to.number}` : alt.to}
      </span>
      <span style={{ fontSize: isPhone ? 5 : 9, color: "var(--text-5)", flex: 1, minWidth: 0,
                     overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {scaleLatinRuns(title)}
      </span>
      {/* No per-row "⚠": tier C is the common case, so the glyph appeared on
          essentially every row and stopped carrying information. The caveat and
          the reasoning live in the popover on hover of this "+". */}
      <span
        onMouseEnter={e => onHoverPlus?.(alt, e.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => onHoverPlus?.(null, null)}
        style={{ fontSize: isPhone ? 7 : 11, color: "var(--link-1)", fontWeight: 700,
                 flexShrink: 0, lineHeight: 1, padding: "0 2px", cursor: "pointer" }}
      >+</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────

export default function BankPanel() {
  const {
    courses, bankCourseIds, subjects, courseMap,
    placements, SEM_INDEX,
    bankSearch, setBankSearch,
    bankSort,
    bankTab, setBankTab,
    bankFilters, setBankFilters,
    bankWidth,
    wideCatalog, setWideCatalog, wideWidth, setWideWidth,
    showSubjectKeys, setShowSubjectKeys,
    starredIds, collapsedSubs, setCollapsedSubs,
    onDropBank, onDragStart,
    bankRef, bankResizing, isPhone,
    placedIds,
    placedOut, setPlacedOut,
    dragInfo,
    onDropPlacedOut,
    selectedId, setSelectedId,
    setShowPanel,
    substitutions, addSubstitution, removeSubstitution,
    addSubstitutionGroup, removeSubstitutionGroup,
    major, major2, minor1, minor2,
    studentType,
    claudePreview,
  } = usePlanner();

  const attributeSystem = usePort(IAttributeSystem);
  const courseCatalog   = usePort(ICourseCatalog);
  const { hasProgram, courseRole } = useRelevance();
  const [profQuery, setProfQuery] = useState(""); // professor finder text (UI-only)

  // Repeatable-course takes counter — shown on a bank card once at least one
  // take is planned (the card stays in the bank until its limit is reached).
  const repeatChip = (c) => {
    if (!c.repeatable) return null;
    const used = takesUsed(c.id, placements, placedOut, SEM_INDEX);
    if (!used) return null;
    const max = c.repeatMax ?? "∞";
    // Over the catalog's limit: allowed (trust the user), shown in error red, like an over-max semester.
    const over = c.repeatMax != null && used > c.repeatMax;
    return (
      <span
        title={t("bank.repeat.title").replace("{used}", String(used)).replace("{max}", String(max))}
        style={{
          position: "absolute", bottom: 2, right: 2, zIndex: 2, lineHeight: 1,
          fontSize: isPhone ? 6 : 8, fontWeight: 700,
          color: over ? "var(--error)" : "var(--active)", background: "var(--bg-surface)",
          border: `1px solid ${over ? "var(--error)" : "var(--active)"}`, borderRadius: 99, padding: "2px 4px",
        }}
      >↻ {used}/{max}{over ? " ⚠" : ""}</span>
    );
  };

  const q = bankSearch.trim().toLowerCase();

  // Diacritic- and case-insensitive fold — mirrors the MCP search adapter so
  // "garcia" finds "García" (plannerQueryAdapter.searchCourses).
  const fold = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const courseLevel = c => {
    const n = parseInt(String(c.number).match(/\d+/)?.[0] ?? "", 10);
    return Number.isFinite(n) && n >= 5000 ? "grad" : "undergrad";
  };

  // Unique instructor names across the catalog (offering history) → prof
  // autocomplete suggestions + legitimacy check.
  const professors = useMemo(() => {
    const set = new Set();
    for (const c of courses) {
      const prof = c.offering?.prof;
      if (!prof) continue;
      for (const list of Object.values(prof)) for (const [name] of list) set.add(name);
    }
    return [...set];
  }, [courses]);

  // Facet filters. terms/nupath AND within a category; level matches by
  // membership; the two program toggles OR within their group (a course can
  // count as a required course, an elective option, or both).
  const fTerms   = bankFilters.terms;
  const fLevel   = bankFilters.level;
  const fNupath  = bankFilters.nupath;
  // Professor filter is a set of tags (OR: taught by any of them). The search
  // box only finds professors — it never filters on its own.
  const fProfs   = bankFilters.profs;
  const wantReq  = bankFilters.programReq  && hasProgram;
  const wantElec = bankFilters.programElec && hasProgram;
  const anyFilter = fTerms.length > 0 || fLevel.length > 0 || fNupath.length > 0 || fProfs.length > 0 || wantReq || wantElec;

  const taughtBy = (c, name) => {
    const prof = c.offering?.prof;
    return !!prof && Object.values(prof).some(list => list.some(([n]) => n === name));
  };

  const passesFilters = c => {
    if (fTerms.length && !fTerms.every(term =>
      term === "summer"
        ? (c.terms?.includes("sumA") || c.terms?.includes("sumB"))
        : c.terms?.includes(term)
    )) return false;
    if (fLevel.length && !fLevel.includes(courseLevel(c))) return false;
    if (fNupath.length && !fNupath.every(a => c.attributes?.includes(a))) return false;
    if (fProfs.length && !fProfs.some(name => taughtBy(c, name))) return false;
    if (wantReq || wantElec) {
      // Dynamic: categorize exactly as the Graduation panel would if the course
      // were slotted in now (or its current allocation, if already placed).
      const roles = courseRole(c);
      const isReq  = !!roles && roles.some(r => r.kind === "required");
      const isElec = !!roles && roles.some(r => r.kind === "elective");
      if (!((wantReq && isReq) || (wantElec && isElec))) return false;
    }
    return true;
  };

  const activeFilterCount =
    fTerms.length + fNupath.length + fProfs.length + (fLevel.length ? 1 : 0) + (wantReq ? 1 : 0) + (wantElec ? 1 : 0);
  const toggleTerm = term => setBankFilters(f => ({
    ...f, terms: f.terms.includes(term) ? f.terms.filter(x => x !== term) : [...f.terms, term],
  }));
  // Level is single-select (XOR): every course is either undergrad or grad, so
  // selecting both would be a no-op filter. Picking one switches to it; clicking
  // the active one clears the filter. Kept as a 0-or-1 array so the length-based
  // count/anyFilter/passesFilters logic stays unchanged.
  const toggleLevel = lvl => setBankFilters(f => ({
    ...f, level: f.level.includes(lvl) ? [] : [lvl],
  }));
  const toggleNupath = code => setBankFilters(f => ({
    ...f, nupath: f.nupath.includes(code) ? f.nupath.filter(x => x !== code) : [...f.nupath, code],
  }));
  const addProf    = name => setBankFilters(f => (f.profs.includes(name) ? f : { ...f, profs: [...f.profs, name] }));
  const removeProf = name => setBankFilters(f => ({ ...f, profs: f.profs.filter(x => x !== name) }));
  const toggleProgramReq  = () => setBankFilters(f => ({ ...f, programReq:  !f.programReq  }));
  const toggleProgramElec = () => setBankFilters(f => ({ ...f, programElec: !f.programElec }));
  const clearFilters  = () => setBankFilters({ terms: [], level: [], nupath: [], profs: [], programReq: false, programElec: false });

  // Suggestions for the professor finder — top matches for the typed query,
  // excluding already-tagged names. `profQuery` is UI-only (not a filter).
  const profQ = fold(profQuery.trim());
  const profSug = (() => {
    if (!profQ) return [];
    const starts = [], includes = [];
    for (const name of professors) {
      if (fProfs.includes(name)) continue;
      const f = fold(name);
      if (f.startsWith(profQ)) starts.push(name);
      else if (f.includes(profQ)) includes.push(name);
    }
    starts.sort((a, b) => a.localeCompare(b));
    includes.sort((a, b) => a.localeCompare(b));
    return [...starts, ...includes].slice(0, 8);
  })();

  const bankCourses = useMemo(() => {
    const tokens = q.split(/\s+/).filter(Boolean);
    // A text query OR any active filter searches the whole catalog; otherwise
    // the view is the user's bank (grouped by subject below).
    let list = (q || anyFilter) ? [...courses] : courses.filter(c => bankCourseIds.has(c.id));
    // Phone has no starring, so never apply the starred filter there even if
    // bankTab was set to "starred" (carried over from desktop or via a command).
    if (bankTab === "starred" && !isPhone && !q && !anyFilter) list = list.filter(c => starredIds.has(c.id));
    if (anyFilter) list = list.filter(passesFilters);

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
  }, [courses, bankCourseIds.size, bankTab, starredIds, q, bankSort, placedIds.size, bankFilters, courseRole, hasProgram]);

  const bankBySubject = useMemo(() => {
    if (q || (bankTab === "starred" && !anyFilter)) return null;
    const m = {};
    bankCourses.forEach(c => { (m[c.subject] = m[c.subject] || []).push(c); });
    // Fall through to the flat branch (and its empty-state) when nothing matches.
    return Object.keys(m).length ? m : null;
  }, [bankCourses, q, bankTab, anyFilter]);

  const [sideMode, setSideMode] = useState("bank"); // "bank" | "grad"

  // Claude proposal preview auto-focus: a program change opens the grad
  // panel and scrolls to the affected selector; star/palette/placed-out/
  // substitution changes open the bank (starred tab when stars changed).
  useEffect(() => {
    const f = claudePreview?.focus;
    if (!f) return;
    if (f.kind === "grad") {
      setSideMode("grad");
      const field = f.field === "studentType" ? "major" : (f.field ?? "major");
      setTimeout(() => {
        document.querySelector(`[data-claude-focus="${field}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 350);
    } else if (f.kind === "bank") {
      setSideMode("bank");
      if (f.starred) setBankTab("starred");
    }
  }, [claudePreview?.proposalId]); // eslint-disable-line react-hooks/exhaustive-deps

  const wideResizing = useRef(null);
  useEffect(() => {
    const onMove = e => {
      if (!wideResizing.current) return;
      const dx = wideResizing.current.startX - e.clientX;
      setWideWidth(Math.min(700, Math.max(220, wideResizing.current.startW + dx)));
    };
    const onUp = () => { wideResizing.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [termInfoOpen, setTermInfoOpen] = useState(false);
  const [programInfoOpen, setProgramInfoOpen] = useState(false);
  const [profOpen, setProfOpen] = useState(false);
  const [collapsePlacedOut, setCollapsePlacedOut] = useState(true);
  const [hoveredPlacedOutId, setHoveredPlacedOutId] = useState(null);
  const [collapseSubstitutions, setCollapseSubstitutions] = useState(true);
  // A Claude preview touching these sections force-opens them — otherwise
  // the previewed chip/row would sit invisible behind a collapsed header.
  const pvPlacedOutTouched = !!(claudePreview?.placedOut?.added?.length || claudePreview?.placedOut?.removed?.length);
  const pvSubsTouched      = !!(claudePreview?.substitutions?.added?.length || claudePreview?.substitutions?.removed?.length);
  // One free-text box serves both jobs. Letters and digits delimit each other,
  // so "phys1163", "phys 1163 phys1173" and "PHYS1163,PHYS1173" all parse — and
  // typing two codes states a substitution outright, which is what the old
  // two-field form existed to collect. Nothing has to be picked from a dropdown
  // before results appear, which was the friction in the first version.
  const [subQuery, setSubQuery] = useState("");
  // Hovering a suggestion's "+" explains how we got to it.
  const [subHover, setSubHover] = useState(null);   // { alt, rect }
  // Manual entry stays available, collapsed by default: the index covers 553 of
  // ~8,000 courses and an advisor can approve anything the corpus never saw.
  const [subManual, setSubManual] = useState(false);
  const [subFromId, setSubFromId] = useState(null);
  const [subToId,   setSubToId]   = useState(null);

  // The equivalence index is ~293 KB and only this section reads it, so it is
  // fetched on first expand. A null index means "no suggestions" everywhere,
  // which is exactly the old manual-only behaviour.
  const subsOpen = !collapseSubstitutions || pvSubsTouched;
  const equivIndex = useEquivalences(subsOpen);

  // Tier A means "a program publishes this choice", which is only an answer for
  // a student IN that program — 72% of program-backed pairs come from exactly
  // one. Programs are identified here by the last path segment of the planner's
  // program id ("2026/science/physics_bs" -> "physics_bs"), which is what
  // build-equivalences.js interns. With no program selected the set is empty and
  // every pair reads at its conservative stored tier, which is the honest default.
  const myProgramIx = useMemo(
    () => programIndexSet(equivIndex,
      [major, major2, minor1, minor2].filter(Boolean).map(id => String(id).split("/").pop())),
    [equivIndex, major, major2, minor1, minor2]);


  // The box is a SEARCH over substitutions, never a creator — the manual form
  // below is where an arbitrary pair gets made. So each typed code is a filter:
  // one term finds every swap touching that course, two find the swap between
  // them. "phys1151phys1161" and "phys1151, phys1161" therefore narrow rather
  // than propose, and "phys1163sp1153" simply finds nothing.
  const subTerms = useMemo(() => parseCodeTerms(subQuery), [subQuery]);

  const subSuggestions = useMemo(() => {
    if (!equivIndex || !subTerms.length) return [];
    const [first, second] = subTerms;
    const froms = [];
    for (const id of equivIndex.byCourse.keys()) if (id.startsWith(first)) froms.push(id);
    froms.sort();
    const out = [];
    for (const from of froms) {
      for (const alt of alternativesFor(equivIndex, from, myProgramIx)) {
        if (second && !alt.to.startsWith(second)) continue;
        out.push(alt);
        if (out.length >= 12) return out;
      }
    }
    return out;
  }, [equivIndex, subTerms, myProgramIx]);

  // A complete 4-digit code that is not a real course is worth naming: with
  // prefix matching, "no results" is otherwise indistinguishable from a typo.
  const subUnknownCodes = useMemo(() => {
    if (!subQuery.trim()) return [];
    return parseCourseCodes(subQuery).codes.filter(c => !plannerIdOf.has(c));
  }, [subQuery, plannerIdOf]);



  // Map an index course id ("PHYS 1151") back to a planner course id.

  const applySuggestion = (alt) => {
    const pairs = [{ from: alt.from, to: alt.to }, ...alt.components]
      .map(x => ({ from: plannerIdOf.get(x.from), to: plannerIdOf.get(x.to) }))
      .filter(x => x.from && x.to);
    if (!pairs.length) return;
    addSubstitutionGroup(pairs, { tier: alt.tier, approval: alt.approval });
    setSubQuery("");
  };

  const [hoveredSubId, setHoveredSubId] = useState(null);
  const [typeCollapsed, setTypeCollapsed] = useState({});
  const { themeName } = useTheme();
  const { t } = useLanguage();
  const specialTerms = usePort(ISpecialTerms);
  const companyColor = themeName === "dark" ? "#b0bbc5" : "var(--text-3)";

  return (
    <div style={{ display: "flex", width: (wideCatalog && !isPhone) ? (wideWidth ?? "clamp(240px, 24vw, 340px)") : bankWidth, flexShrink: 0 }}>
      {/* Drag-resize handle — desktop only */}
      {!isPhone && <div
        onMouseDown={e => {
          if (wideCatalog) {
            const startW = wideWidth ?? (bankRef.current?.offsetWidth ?? 300);
            wideResizing.current = { startX: e.clientX, startW };
          } else {
            bankResizing.current = { startX: e.clientX, startW: bankWidth };
          }
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
                onClick={() => { setSideMode("bank"); setBankTab("all"); }}
                style={{
                  flex: 1, fontSize: 7, padding: "3px 0", borderRadius: 4, cursor: "pointer",
                  background: sideMode === "bank" ? "var(--bg-surface)" : "transparent",
                  border: `1px solid ${sideMode === "bank" ? "var(--active)" : "var(--border-2)"}`,
                  color: sideMode === "bank" ? "var(--active)" : "var(--text-4)",
                  fontWeight: sideMode === "bank" ? 700 : 400,
                }}>{t("bank.tab.courses")}</button>
              <button
                onClick={() => setSideMode("grad")}
                style={{
                  flex: 1, fontSize: 7, padding: "3px 0", borderRadius: 4, cursor: "pointer",
                  background: sideMode === "grad" ? "var(--bg-surface)" : "transparent",
                  border: `1px solid ${sideMode === "grad" ? "var(--active)" : "var(--border-2)"}`,
                  color: sideMode === "grad" ? "var(--active)" : "var(--text-4)",
                  fontWeight: sideMode === "grad" ? 700 : 400,
                }}>{t("bank.tab.grad")}</button>
            </div>
          )}

          {/* Desktop: Bank ↔ Graduation toggle */}
          {!isPhone && (
            <div style={{ padding: "7px 8px 5px", display: "flex", gap: 3 }}>
              {[["bank", t("bank.mode.bank")], ["grad", t("bank.mode.grad")]].map(([mode, label]) => (
                <button key={mode} onClick={() => setSideMode(mode)} style={{
                  flex: 1, fontSize: 9, padding: "4px 0", borderRadius: 4, cursor: "pointer",
                  background:  sideMode === mode ? "var(--bg-surface)" : "transparent",
                  border: `1px solid ${sideMode === mode ? "var(--active)" : "var(--border-2)"}`,
                  color: sideMode === mode ? "var(--active)" : "var(--text-4)",
                  fontWeight: sideMode === mode ? 700 : 400,
                }}>{label}</button>
              ))}
              <button
                  onClick={() => setWideCatalog(v => !v)}
                  title="Toggle wide panel"
                  style={{
                    fontSize: 9, padding: "4px 7px", borderRadius: 4, cursor: "pointer", flexShrink: 0,
                    background: wideCatalog ? "var(--bg-surface)" : "transparent",
                    border: `1px solid ${wideCatalog ? "var(--active)" : "var(--border-2)"}`,
                    color: wideCatalog ? "var(--active)" : "var(--text-4)",
                    fontWeight: wideCatalog ? 700 : 400,
                  }}
                >{t("bank.mode.wide")}</button>
            </div>
          )}

        {/* ── Bank-only header controls (desktop: title + subject key + tabs) ── */}
        {!isPhone && sideMode === "bank" && <>
          <div style={{ padding: "0px 9px 4px", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.05em", flex: 1 }}>{t("bank.title")}</span>
            <span style={{ fontSize: 9, color: "var(--text-4)", background: "var(--bg-surface)", borderRadius: 99, padding: "1px 6px" }}>
              {bankCourseIds.size}
            </span>
            <button onClick={() => setShowSubjectKeys(v => !v)} title="Subject color key"
              style={{ background: showSubjectKeys ? "var(--bg-surface)" : "transparent", border: "1px solid var(--border-2)", borderRadius: 4, color: "var(--text-3)", fontSize: 9, cursor: "pointer", padding: "2px 6px" }}>
              {t("bank.colors.button")}
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
            {([["all", t("bank.tab.all")], ["starred", `${t("bank.tab.saved")}${starredIds.size ? ` (${starredIds.size})` : ""}`]]).map(([key, label]) => (
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
              placeholder={t("bank.search.placeholder")}
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

          {/* Filters — same section as the search box (no divider above) */}
          <div>
            <div
              onClick={() => setFiltersOpen(v => !v)}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 8px", cursor: "pointer", userSelect: "none" }}
            >
              <span style={{ fontSize: isPhone ? 5 : 9, fontWeight: 700, letterSpacing: "0.05em", color: activeFilterCount ? "var(--active)" : "var(--text-5)" }}>
                {t("bank.filter.title")}
              </span>
              <span style={{ fontSize: isPhone ? 7 : 9, color: activeFilterCount ? "var(--active)" : "var(--text-5)" }}>{filtersOpen ? "▼" : "▶"}</span>
              {activeFilterCount > 0 && (
                <span style={{ background: "var(--active)", color: "var(--bg-surface)", borderRadius: 99, padding: "0px 5px", fontSize: 8, fontWeight: 700 }}>
                  {activeFilterCount}
                </span>
              )}
              <span style={{ flex: 1 }} />
              {activeFilterCount > 0 && (
                <button onClick={e => { e.stopPropagation(); clearFilters(); }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-4)", fontSize: 9, textDecoration: "underline", padding: 0 }}>
                  {t("bank.filter.clear")}
                </button>
              )}
            </div>

            {filtersOpen && (() => {
              const chip = (active, onClick, label, title) => (
                <button key={label} onClick={onClick} title={title}
                  style={{
                    fontSize: isPhone ? 6 : 9, padding: isPhone ? "2px 5px" : "3px 7px", borderRadius: 99, cursor: "pointer",
                    background: active ? "var(--bg-surface)" : "transparent",
                    border: `1px solid ${active ? "var(--active)" : "var(--border-2)"}`,
                    color: active ? "var(--active)" : "var(--text-4)",
                    fontWeight: active ? 700 : 400, whiteSpace: "nowrap",
                  }}>{label}</button>
              );
              const lbl = { fontSize: isPhone ? 6 : 8, color: "var(--text-4)", letterSpacing: "0.04em", margin: "6px 0 3px" };
              return (
                <div style={{ padding: "0 8px 6px" }}>
                  <div style={{ ...lbl, display: "flex", alignItems: "center", gap: 4 }}>
                    <span>{t("bank.filter.term")}</span>
                    <button
                      onClick={() => setTermInfoOpen(v => !v)}
                      title={t("bank.filter.term.info")}
                      style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        width: 12, height: 12, borderRadius: 99, cursor: "pointer", padding: 0, lineHeight: 1,
                        fontSize: 8, fontWeight: 700,
                        background: termInfoOpen ? "var(--active)" : "transparent",
                        border: `1px solid ${termInfoOpen ? "var(--active)" : "var(--border-2)"}`,
                        color: termInfoOpen ? "var(--bg-surface)" : "var(--text-4)",
                      }}>i</button>
                  </div>
                  {termInfoOpen && (
                    <div style={{ margin: "0 0 4px", padding: "5px 7px", borderRadius: 4, background: "var(--bg-surface)", border: "1px solid var(--border-2)", fontSize: 8.5, color: "var(--text-4)", lineHeight: 1.5 }}>
                      {t("bank.filter.term.explain")}
                    </div>
                  )}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {chip(fTerms.includes("fall"),   () => toggleTerm("fall"),   t("bank.filter.fall"))}
                    {chip(fTerms.includes("spring"), () => toggleTerm("spring"), t("bank.filter.spring"))}
                    {chip(fTerms.includes("summer"), () => toggleTerm("summer"), t("bank.filter.summer"))}
                  </div>

                  <div style={lbl}>{t("bank.filter.level")}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {chip(fLevel.includes("undergrad"), () => toggleLevel("undergrad"), t("bank.filter.undergrad"))}
                    {chip(fLevel.includes("grad"),      () => toggleLevel("grad"),      t("bank.filter.grad"))}
                  </div>

                  <div style={lbl}>{t("bank.filter.nupath")}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {attributeSystem.getGridCodes().map(code =>
                      chip(fNupath.includes(code), () => toggleNupath(code), code, attributeSystem.getLabel(code))
                    )}
                  </div>

                  <div style={lbl}>{t("bank.filter.prof")}</div>
                  {/* Selected professors, as filter tags. The name links out to
                      the instructor's RateMyHusky page (TRACE + RateMyProfessor);
                      only the ✕ removes the filter. */}
                  {fProfs.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
                      {fProfs.map(name => {
                        const rmhUrl = courseCatalog?.profRatingsUrl?.(name) ?? null;
                        return (
                          <span key={name} data-prof-chip={name} style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            fontSize: isPhone ? 6 : 9, padding: isPhone ? "2px 4px 2px 6px" : "3px 5px 3px 7px",
                            borderRadius: 99, background: "var(--bg-surface)",
                            border: "1px solid var(--active)", color: "var(--active)", fontWeight: 700,
                          }}>
                            {rmhUrl ? (
                              <a href={rmhUrl}
                                target="_blank" rel="noopener noreferrer"
                                title={t("bank.filter.prof.view").replace("{name}", name)}
                                style={{ color: "inherit", textDecoration: "none", cursor: "pointer" }}
                                onMouseEnter={e => { e.currentTarget.style.textDecoration = "underline"; }}
                                onMouseLeave={e => { e.currentTarget.style.textDecoration = "none"; }}>
                                {name}
                              </a>
                            ) : (
                              <span>{name}</span>
                            )}
                            <button onClick={() => removeProf(name)} title={t("bank.filter.prof.remove")}
                              style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: isPhone ? 8 : 10, lineHeight: 1, padding: 0 }}>
                              ✕
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ position: "relative" }}>
                    <input
                      value={profQuery}
                      onChange={e => { setProfQuery(e.target.value); setProfOpen(true); }}
                      onFocus={() => setProfOpen(true)}
                      onBlur={() => setTimeout(() => setProfOpen(false), 150)}
                      placeholder={t("bank.filter.prof.placeholder")}
                      style={{
                        width: "100%", boxSizing: "border-box",
                        background: "var(--bg-surface)", border: "1px solid var(--border-2)",
                        borderRadius: 5, color: "var(--text-2)", fontSize: isPhone ? 5 : 10,
                        padding: "5px 24px 5px 8px", outline: "none",
                      }}
                    />
                    {profQuery && (
                      <button onClick={() => { setProfQuery(""); setProfOpen(false); }}
                        style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--text-4)", cursor: "pointer", fontSize: 11, lineHeight: 1, padding: 0 }}>
                        ✕
                      </button>
                    )}
                    {profOpen && profSug.length > 0 && (
                      <div style={{
                        position: "absolute", top: "100%", left: 0, right: 0, zIndex: 30, marginTop: 2,
                        background: "var(--bg-surface)", border: "1px solid var(--border-2)", borderRadius: 5,
                        maxHeight: 168, overflowY: "auto", boxShadow: "0 4px 14px rgba(0,0,0,0.28)",
                      }}>
                        {profSug.map(name => (
                          <button key={name}
                            onMouseDown={e => { e.preventDefault(); addProf(name); setProfQuery(""); setProfOpen(false); }}
                            style={{
                              display: "block", width: "100%", textAlign: "left", padding: "5px 8px",
                              background: "transparent", border: "none", borderBottom: "1px solid var(--border-1)",
                              color: "var(--text-2)", fontSize: isPhone ? 8 : 10, cursor: "pointer",
                            }}>{name}</button>
                        ))}
                      </div>
                    )}
                  </div>

                  {hasProgram && (
                    <>
                      <div style={{ ...lbl, display: "flex", alignItems: "center", gap: 4 }}>
                        <span>{t("bank.filter.program")}</span>
                        <button
                          onClick={() => setProgramInfoOpen(v => !v)}
                          title={t("bank.filter.program.info")}
                          style={{
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            width: 12, height: 12, borderRadius: 99, cursor: "pointer", padding: 0, lineHeight: 1,
                            fontSize: 8, fontWeight: 700,
                            background: programInfoOpen ? "var(--active)" : "transparent",
                            border: `1px solid ${programInfoOpen ? "var(--active)" : "var(--border-2)"}`,
                            color: programInfoOpen ? "var(--bg-surface)" : "var(--text-4)",
                          }}>i</button>
                      </div>
                      {programInfoOpen && (
                        <div style={{ margin: "0 0 4px", padding: "5px 7px", borderRadius: 4, background: "var(--bg-surface)", border: "1px solid var(--border-2)", fontSize: 8.5, color: "var(--text-4)", lineHeight: 1.5, whiteSpace: "pre-line" }}>
                          {t("bank.filter.program.explain")}
                        </div>
                      )}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {chip(wantReq,  toggleProgramReq,  t("bank.filter.program.required"))}
                        {chip(wantElec, toggleProgramElec, t("bank.filter.program.elective"))}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
          </div>

        {/* Placed Out section — undergrad only */}
        {studentType !== "graduate" && <>
          <div
            onClick={() => setCollapsePlacedOut(v => !v)}
            style={{
              display: "flex", alignItems: "center", gap: 5, padding: "6px 8px",
              cursor: "pointer", userSelect: "none", borderTop: "1px solid var(--border-1)",
            }}
          >
            <span style={{ fontSize: isPhone ? 5 : 9, fontWeight: 700, color: pvPlacedOutTouched ? "#fb923c" : "var(--text-5)", letterSpacing: "0.05em" }}>
              {t("bank.section.placedout")}{placedOut.size > 0 ? ` (${placedOut.size})` : ""}
            </span>
            <span style={{ fontSize: isPhone ? 7 : 9, color: "var(--text-5)" }}>{collapsePlacedOut && !pvPlacedOutTouched ? "▶" : "▼"}</span>
          </div>
          {(!collapsePlacedOut || pvPlacedOutTouched) && (
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
              {(placedOut.size > 0 || pvPlacedOutTouched) ? (
                // Union in preview-removed ids so they render as ghosts
                // instead of silently vanishing from the list.
                [...new Set([...placedOut, ...(claudePreview?.placedOut?.removed ?? [])])].map(id => {
                  const c = courseMap[id];
                  if (!c) return null;
                  const pvRemoved = claudePreview?.placedOut?.removed?.includes?.(id);
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
                        // Orange ring when a Claude proposal adds or removes this entry
                        border: claudePreview?.placedOut?.added?.includes?.(id) || pvRemoved
                          ? "1.5px dashed #fb923c" : "1.5px solid transparent",
                        opacity: pvRemoved ? 0.45 : 1,
                        textDecoration: pvRemoved ? "line-through" : selectedId === id || hoveredPlacedOutId === id ? "underline" : "none",
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
                  {t("bank.placedout.hint")}
                </div>
              )}
            </div>
          )}
        </>}

        </>}
        {/* ── End sticky header ── */}
        </div>

        {/* Graduation panel */}
        {sideMode === "grad" && (
          <div style={{ flex: 1, overflowY: "auto", background: "var(--bg-bank)" }}>
            <GradPanel wideCatalog={wideCatalog} />
          </div>
        )}

        {/* Course bank content */}
        {sideMode === "bank" && <>

        {/* ── Substitutions section ────────────────────────────── */}
        <div
          onClick={() => setCollapseSubstitutions(v => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 5, padding: "6px 8px",
            cursor: "pointer", userSelect: "none", borderTop: "1px solid var(--border-1)",
          }}
        >
          <span title={t("bank.sub.desc")}
                style={{ fontSize: isPhone ? 5 : 9, fontWeight: 700, color: pvSubsTouched ? "#fb923c" : "var(--text-5)", letterSpacing: "0.05em" }}>
            {t("bank.section.substitutions")}{substitutions.length > 0 ? ` (${substitutions.length})` : ""}
          </span>
          <span style={{ fontSize: isPhone ? 7 : 9, color: "var(--text-5)" }}>{collapseSubstitutions && !pvSubsTouched ? "▶" : "▼"}</span>
        </div>
        {(!collapseSubstitutions || pvSubsTouched) && (
          <div style={{ padding: "0 8px 8px" }}>

            {(() => {
              // A grouped substitution is ONE decision, so only its head pair
              // gets a row; the rest become a "+N" chip. Ungrouped pairs are
              // unchanged, which is every substitution saved before this.
              const seen = new Set();
              const rows = [];
              for (const sub of substitutions) {
                if (sub.group) {
                  if (seen.has(sub.group)) continue;
                  seen.add(sub.group);
                  const members = substitutions.filter(x => x.group === sub.group);
                  rows.push({ ...sub, extra: members.length - 1, members });
                } else rows.push({ ...sub, extra: 0 });
              }
              // Preview-removed substitutions stay visible as ghosts.
              for (const k of (claudePreview?.substitutions?.removed ?? [])) {
                const [from, to] = k.split("→");
                rows.push({ from, to, pvRemoved: true, extra: 0 });
              }
              return rows;
            })().map(({ from, to, pvRemoved, extra, members, approval }) => {
              const fc = courseMap[from];
              const tc = courseMap[to];
              const fromPlaced = !!placements[from];
              const pvAdded = claudePreview?.substitutions?.added?.includes?.(`${from}→${to}`);
              const underlineStyle = (id) => ({
                textDecoration: selectedId === id || hoveredSubId === id ? "underline" : "none",
                textDecorationStyle: "dotted",
                textDecorationColor: "var(--text-4)",
                textUnderlineOffset: 2,
                cursor: "pointer",
              });
              return (
                <div key={`${from}-${to}`} style={{
                  display: "flex", alignItems: "center", gap: isPhone ? 2 : 5,
                  padding: isPhone ? "1px 3px" : "3px 5px", marginBottom: 2,
                  background: "var(--bg-surface-2)", borderRadius: 4,
                  border: pvAdded || pvRemoved ? "1.5px dashed #fb923c" : "1.5px solid transparent",
                  opacity: pvRemoved ? 0.45 : fromPlaced ? 1 : 0.55,
                  textDecoration: pvRemoved ? "line-through" : "none",
                  fontSize: isPhone ? 5 : 10,
                }}>
                  {!fromPlaced && (
                    <span title="Course A not yet placed in a semester" style={{ fontSize: isPhone ? 7 : 10, flexShrink: 0 }}>⚠</span>
                  )}
                  <span
                    style={{ fontWeight: 700, color: "var(--link-1)", flexShrink: 0, ...underlineStyle(from) }}
                    onClick={() => { setSelectedId(from); setShowPanel(true); }}
                    onMouseEnter={() => setHoveredSubId(from)}
                    onMouseLeave={() => setHoveredSubId(null)}
                  >
                    {fc ? `${fc.subject} ${fc.number}` : from}
                  </span>
                  <span style={{ fontSize: isPhone ? 6 : 9, color: "var(--text-5)", flexShrink: 0 }}>→</span>
                  <span
                    style={{ fontWeight: 700, color: "var(--text-2)", flex: 1, minWidth: 0, ...underlineStyle(to) }}
                    onClick={() => { setSelectedId(to); setShowPanel(true); }}
                    onMouseEnter={() => setHoveredSubId(to)}
                    onMouseLeave={() => setHoveredSubId(null)}
                  >
                    {tc ? `${tc.subject} ${tc.number}` : to}
                  </span>
                  {approval && (
                    <span title={t("bank.sub.approval")}
                          style={{ fontSize: isPhone ? 6 : 9, flexShrink: 0 }}>⚠</span>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); removeSubstitutionGroup(from, to); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-4)", fontSize: isPhone ? 8 : 12, padding: "0 2px", lineHeight: 1, flexShrink: 0 }}
                    title="Remove substitution"
                  >✕</button>
                </div>
              );
            })}

            <div style={{ marginTop: substitutions.length ? 6 : 0 }}>
              {/* ONE box. Type a code to see what can replace it, or type two
                  codes to state the substitution yourself — letters and digits
                  delimit each other, so commas and spaces are optional. This
                  subsumes the old two-field form, so there is nothing to
                  disclose and nothing to press: picking a row is the action. */}
              <input
                type="text"
                value={subQuery}
                onChange={e => setSubQuery(e.target.value)}
                placeholder={t("bank.sub.query.placeholder")}
                style={{
                  width: "100%", fontSize: isPhone ? 8 : 10, padding: "4px 6px",
                  background: "var(--bg-surface-2)", color: "var(--text-2)",
                  border: "1px solid var(--border-2)", borderRadius: 4, outline: "none",
                }}
              />

              {subQuery.trim() && (
                <div style={{ marginTop: 4 }}>
                  {/* Two codes typed: the student stated the pair. */}
                  {/* Partial or complete code: what the corpus offers instead. */}
                  {subSuggestions.map(alt => (
                    <SuggestionRow
                      key={`${alt.from}-${alt.to}`}
                      alt={alt}
                      course={courseMap[plannerIdOf.get(alt.to)]}
                      onApply={() => applySuggestion(alt)}
                      onHoverPlus={(a, rect) => setSubHover(a ? { alt: a, rect } : null)}
                      t={t}
                      isPhone={isPhone}
                    />
                  ))}


                  {/* This box searches SUBSTITUTIONS, not the catalog — but it must
                      never look dead. Mid-typing ("phys116") parses to no code at
                      all, and rendering nothing there reads as a broken dropdown.
                      And with no index loaded, "no alternatives" would be a lie:
                      that is "we could not find out", which is a different thing. */}
                  {subSuggestions.length === 0 && (
                    <div style={{ fontSize: isPhone ? 6 : 9, color: "var(--text-5)", padding: "3px 5px" }}>
                      {!equivIndex ? t("bank.sub.unavailable")
                        : subUnknownCodes.length ? t("bank.sub.unknown", { codes: subUnknownCodes.join(", ") })
                        : !subTerms.length ? t("bank.sub.hint")
                        : t("bank.sub.none")}
                    </div>
                  )}
                </div>
              )}

              {subHover && (
                <SubstitutionPopover
                  alt={subHover.alt}
                  rect={subHover.rect}
                  courseName={courseMap[plannerIdOf.get(subHover.alt.to)]?.title ?? ""}
                />
              )}

              {/* Manual entry: collapsed by default, unchanged in behaviour. The
                  box above covers the common cases, but an advisor can approve a
                  swap the corpus has no evidence for, so this must stay. */}
              <div
                onClick={() => setSubManual(v => !v)}
                style={{ marginTop: 5, fontSize: isPhone ? 6 : 9, color: "var(--text-5)",
                         cursor: "pointer", userSelect: "none" }}
              >
                {subManual ? "▾" : "▸"} {t("bank.sub.manual")}
              </div>

              {subManual && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
                    <CourseSearch courses={courses} value={subFromId} onChange={setSubFromId} placeholder={t("bank.sub.courseA.placeholder")} isPhone={isPhone} />
                    <span style={{ fontSize: 10, color: "var(--text-5)", flexShrink: 0 }}>→</span>
                    <CourseSearch courses={courses} value={subToId} onChange={setSubToId} placeholder={t("bank.sub.courseB.placeholder")} isPhone={isPhone} />
                  </div>
                  <button
                    onClick={() => {
                      if (!subFromId || !subToId || subFromId === subToId) return;
                      addSubstitution(subFromId, subToId);
                      setSubFromId(null);
                      setSubToId(null);
                    }}
                    disabled={!subFromId || !subToId || subFromId === subToId}
                    style={{
                      width: "100%", padding: "4px 0", fontSize: isPhone ? 7 : 10, borderRadius: 4,
                      background: subFromId && subToId && subFromId !== subToId ? "var(--link-1)" : "var(--bg-surface-2)",
                      color: subFromId && subToId && subFromId !== subToId ? "#fff" : "var(--text-4)",
                      border: "1px solid var(--border-2)", cursor: subFromId && subToId && subFromId !== subToId ? "pointer" : "not-allowed",
                    }}
                  >{t("bank.sub.add.button")}</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── WORK EXPERIENCE ── */}
        <div style={{ padding: "6px 7px 4px", borderBottom: "1px solid var(--border-1)" }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.06em", marginBottom: 5 }}>{t("bank.section.work")}</div>

          {(specialTerms?.getTypes() ?? []).map((type, idx) => {
            const collapsed = typeCollapsed[type.id] ?? (idx > 0);
            const attrText  = type.attributeGrants?.length
              ? `satisfies ${type.attributeGrants.join(", ")}`
              : "no attribute grants";
            return (
              <div key={type.id} style={{ marginTop: idx > 0 ? 6 : 0 }}>
                <div
                  onClick={() => setTypeCollapsed(p => ({ ...p, [type.id]: !collapsed }))}
                  style={{ fontSize: 8, fontWeight: 600, color: "var(--text-2)", letterSpacing: "0.05em", marginBottom: collapsed ? 0 : 3, cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 4 }}
                >
                  <span style={{ fontSize: 7, opacity: 0.7 }}>{collapsed ? "▶" : "▼"}</span>{type.label}s
                </div>
                {!collapsed && (type.durations ?? []).map(d => (
                  <div key={d.id}
                    draggable
                    data-drag-id=""
                    data-drag-type="specialTerm"
                    data-drag-typeid={type.id}
                    data-drag-duration={d.duration}
                    onDragStart={e => onDragStart(e, null, "specialTerm", null, { duration: d.duration, typeId: type.id })}
                    style={{ background: "var(--card-bg)", border: "1px solid var(--border-card)", borderRadius: 6, padding: "6px 8px", cursor: "grab", marginBottom: 5 }}
                  >
                    <div style={{ fontSize: 10, fontWeight: 600, color: companyColor, fontFamily: "'Inter', sans-serif", letterSpacing: "0.05em" }}>{d.label}</div>
                    {!isPhone && type.attributeGrants?.length > 0 && (
                      <div style={{ fontSize: 7, color: "var(--text-3)", marginTop: 1 }}>{attrText}</div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}

        </div>

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
                    {sortedCrs.map(c => (
                      <div key={c.id} style={{ position: "relative" }}>
                        <CourseCard course={c} inSem={false} semId={null} noSubject />
                        {repeatChip(c)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div style={{ padding: "4px 6px 6px", display: "flex", flexDirection: "column", gap: 3 }}>
            {bankCourses.length === 0 ? (
              <div style={{ padding: "18px 8px", fontSize: 10, color: "var(--text-6)", textAlign: "center", lineHeight: "calc(1.6 * var(--lh-scale, 1))" }}>
                {bankTab === "starred" && !isPhone && !anyFilter ? (
                  <><div style={{ fontSize: 20, marginBottom: 6 }}>☆</div>{t("bank.empty.saved")}<br /><span style={{ fontSize: 9 }}>{t("bank.empty.saved.hint")}</span></>
                ) : anyFilter ? t("bank.filter.empty") : t("bank.empty.search")}
              </div>
            ) : bankCourses.map(c => {
              return (
                // Dim only courses that can't be (re-)added — a repeatable
                // course with takes left keeps full opacity via bankCourseIds.
                <div key={c.id} style={{ position: "relative", opacity: placedIds.has(c.id) && !bankCourseIds.has(c.id) ? 0.55 : 1 }}>
                  <CourseCard course={c} inSem={false} semId={null} />
                  {repeatChip(c)}
                  {studentType !== "graduate" && !isPhone && (
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
                  )}
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
