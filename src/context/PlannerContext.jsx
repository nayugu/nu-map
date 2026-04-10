// ═══════════════════════════════════════════════════════════════════
// PLANNER CONTEXT  (application port — React state + action shell)
//
// Create ONE PlannerProvider near the root; children consume via
// usePlanner() instead of drilling props through every layer.
//
// Hexagonal role:
//   • Drives core/* pure functions in response to user events
//   • Calls data/* adapters for I/O
//   • Exposes a typed surface of state + actions to the UI layer
// ═══════════════════════════════════════════════════════════════════
import { createContext, useContext, useState, useRef, useEffect, useMemo } from "react";
import { NUM_YEARS } from "../core/constants.js";
import { buildCohortSemesters, deriveSemMaps } from "../core/semGrid.js";
import { extractEdges, getOfferedFromTerms } from "../core/courseModel.js";
import { evalPrereqTree } from "../core/prereqEval.js";
import { getSemSH, getOrderedCourses, getConnections } from "../core/planModel.js";
import { loadSaved, saveState } from "../data/persistence.js";
import { usePort }         from "./InstitutionContext.jsx";
import { IInstitution }   from "../ports/IInstitution.js";
import { ICalendar }      from "../ports/ICalendar.js";
import { ICourseCatalog } from "../ports/ICourseCatalog.js";
import { ISpecialTerms }  from "../ports/ISpecialTerms.js";

const PlannerContext = createContext(null);

export function PlannerProvider({ children }) {
  const institution    = usePort(IInstitution);
  const calendar       = usePort(ICalendar);
  const courseCatalog  = usePort(ICourseCatalog);
  const specialTerms   = usePort(ISpecialTerms);
  const storagePrefix    = institution.storagePrefix;
  const defaultStartYear = calendar.getDefaultStartYear();

  // ── API state ────────────────────────────────────────────────
  const [courses,  setCourses]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [loadErr,  setLoadErr]  = useState(null);
  const [loadPct,  setLoadPct]  = useState(5);

  // ── Derived from courses ─────────────────────────────────────
  const courseMap = useMemo(() => Object.fromEntries(courses.map(c => [c.id, c])), [courses]);
  const allEdges  = useMemo(() => courses.flatMap(c => extractEdges(c.id, c.prereqs, c.coreqs)), [courses]);
  const subjects  = useMemo(() => [...new Set(courses.map(c => c.subject))].sort(), [courses]);


  // ── Persistent planner state ─────────────────────────────────
  const _saved = useMemo(() => loadSaved(storagePrefix), [storagePrefix]);
  const [placements,       setPlacements]       = useState(() => (_saved?.persist && _saved.placements)       ? _saved.placements       : {});
  const [specialTermPl,    setSpecialTermPl]    = useState(() => {
    if (!_saved?.persist) return {};
    // New format
    if (_saved.specialTermPl) return _saved.specialTermPl;
    // Migrate old workPl + internPl into unified map
    const result = {};
    if (_saved.workPl)   for (const [id, data] of Object.entries(_saved.workPl))   result[id] = { typeId: "coop",   ...data };
    if (_saved.internPl) for (const [id, data] of Object.entries(_saved.internPl)) result[id] = { typeId: "intern", ...data };
    return result;
  });
  const _defSemType = calendar.getSemesterTypes().filter(t => !t.optional)[0];
  const _defSemId   = `${_defSemType?.idPrefix ?? _defSemType?.id ?? "fall"}${defaultStartYear}`;
  const [currentSemId,     setCurrentSemId]     = useState(() => (_saved?.persist && _saved.currentSemId)     ? _saved.currentSemId     : _defSemId);
  const [persistEnabled,   setPersistEnabled]   = useState(() => _saved?.persist !== false);
  const [semOrders,        setSemOrders]        = useState(() => (_saved?.persist && _saved.semOrders)        ? _saved.semOrders        : {});
  const [offeredOverrides, setOfferedOverrides] = useState(() => (_saved?.persist && _saved.offeredOverrides) ? _saved.offeredOverrides : {});
  const [collapsedSubs,    setCollapsedSubs]    = useState(() => (_saved?.persist && _saved.collapsedSubs)    ? _saved.collapsedSubs    : {});
  // Per-plan SH overrides for variable-credit courses (e.g. 1–4 SH → user picks 3).
  const [shOverrides,      setShOverrides]      = useState(() => (_saved?.persist && _saved.shOverrides)      ? _saved.shOverrides      : {});
  // Extra SH that counts toward graduation but isn't tied to a specific course
  // (e.g. AP/IB general credit, transfer credit, test-out hours).
  const [bonusSH, setBonusSH] = useState(() => (_saved?.persist && _saved.bonusSH != null) ? _saved.bonusSH : 0);
  // Plan-specific program selections (major path, concentration label, minor paths)
  const [major,  setMajor]  = useState("");
  const [conc,   setConc]   = useState("");
  const [minor1, setMinor1] = useState("");
  const [minor2, setMinor2] = useState("");
  // Set of course IDs that are placed out (satisfy prereqs, no credit)
  const [placedOut, setPlacedOut] = useState(() => {
    const saved = _saved?.persist && _saved.placedOut;
    return saved ? new Set(saved) : new Set();
  });

  // Substitutions: [{from: courseId, to: courseId}, ...]
  // When "from" is placed, "to" is also virtually placed for requirement checking.
  // Credits are only counted once (from the actual placed "from" course).
  const [substitutions, setSubstitutions] = useState(() => {
    const saved = _saved?.persist && _saved.substitutions;
    return Array.isArray(saved) ? saved : [];
  });

  // ── Sticky Courses ──
  const stickySnapshotRef = useRef(null);
  const [stickyCourses, setStickyCourses] = useState(() => {
    try { return localStorage.getItem("ncp-sticky-courses") !== "false"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem("ncp-sticky-courses", String(stickyCourses)); } catch {}
  }, [stickyCourses]);

  // ── UI: Other credits collapse setting ──
  const [collapseOtherCredits, setCollapseOtherCredits] = useState(() => {
    try { const v = localStorage.getItem("ncp-collapse-other-credits"); return v === null ? true : v !== "false"; } catch { return true; }
  });
  const updateCollapseOtherCredits = (val) => {
    setCollapseOtherCredits(val);
    try { localStorage.setItem("ncp-collapse-other-credits", String(val)); } catch {}
  };

  // ── UI: Show logo on continuation rows ──
  const [showContLogo, setShowContLogo] = useState(() => {
    try { const v = localStorage.getItem("ncp-show-cont-logo"); return v === null ? true : v !== "false"; } catch { return true; }
  });
  const updateShowContLogo = (val) => {
    setShowContLogo(val);
    try { localStorage.setItem("ncp-show-cont-logo", String(val)); } catch {}
  };

  // effectiveCourseMap — same as courseMap but with per-plan sh overrides applied.
  const effectiveCourseMap = useMemo(() => {
    if (!Object.keys(shOverrides).length) return courseMap;
    return Object.fromEntries(
      Object.entries(courseMap).map(([id, c]) => {
        const ov = shOverrides[id];
        if (ov == null || !c.shMax) return [id, c];
        // Preserve the data-minimum as shMin so the edit UI knows the valid range.
        return [id, { ...c, sh: ov, shMin: c.shMin ?? c.sh }];
      })
    );
  }, [courseMap, shOverrides]);

  // ── UI interaction state ──────────────────────────────────────
  const [selectedId,    setSelectedId]    = useState(null);
  const [dragInfo,      setDragInfo]      = useState(null);
  const [hoveredSem,    setHoveredSem]    = useState(null);
  const [hoveredZone,   setHoveredZone]   = useState(null);
  const [hoveredCardId, setHoveredCardId] = useState(null);
  const [showPanel,     setShowPanel]     = useState(false);
  const [lines,         setLines]         = useState([]);
  const [scrollTick,    setScrollTick]    = useState(0);
  const [showViolLines, setShowViolLines] = useState(true);

  // ── Bank state ───────────────────────────────────────────────
  const [bankSearch,      setBankSearch]      = useState("");
  const [bankSort,        setBankSort]        = useState("az");
  const [bankTab,         setBankTab]         = useState("all");
  const [bankWidth,       setBankWidth]       = useState(() => window.innerWidth < 600 ? 88 : Math.min(300, Math.max(200, window.innerWidth * 0.21)));
  const [showSubjectKeys, setShowSubjectKeys] = useState(false);
  const [starredIds,      setStarredIds]      = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("ncp-starred") || "[]")); } catch { return new Set(); }
  });

  // ── Settings / modal state ───────────────────────────────────
  const [showDisclaimer, setShowDisclaimer] = useState(() => {
    try { return !localStorage.getItem("ncp-seen-disclaimer"); } catch { return true; }
  });
  // Default entry/grad sem: first and last non-optional semester types
  const _primarySems = calendar.getSemesterTypes().filter(t => !t.optional);
  const _defEntSem   = _primarySems[0]?.id           ?? "fall";
  const _defGradSem  = _primarySems.at?.(-1)?.id     ?? _defEntSem;
  const [planEntSem,   setPlanEntSem]   = useState(() => { try { return localStorage.getItem("ncp-ent-sem")  || _defEntSem;  } catch { return _defEntSem;  } });
  const [planEntYear,  setPlanEntYear]  = useState(() => { try { return parseInt(localStorage.getItem("ncp-ent-year")  || String(defaultStartYear), 10) || defaultStartYear; } catch { return defaultStartYear; } });
  const [planGradSem,  setPlanGradSem]  = useState(() => { try { return localStorage.getItem("ncp-grad-sem") || _defGradSem; } catch { return _defGradSem; } });
  const [planGradYear, setPlanGradYear] = useState(() => { try { return parseInt(localStorage.getItem("ncp-grad-year") || String(defaultStartYear + NUM_YEARS), 10) || defaultStartYear + NUM_YEARS; } catch { return defaultStartYear + NUM_YEARS; } });
  const [showSettings, setShowSettings] = useState(false);

  // ── Layout state ─────────────────────────────────────────────
  const uiScaleRef  = useRef(1);
  const isPhoneRef  = useRef(window.innerWidth < 600);
  // isPhone = true only for narrow phone viewports (< 600px).
  // Tablets (768px+) and phablets (600–767px) use the standard desktop layout.
  const PHONE_BP  = 600;
  const MOBILE_BP = 1024; // phone + tablet
  const computeUiScale = (w) => w < PHONE_BP ? 0.75 : Math.max(0.7, Math.min(1.5, w / 1440));
  const [autoScale, setAutoScale] = useState(() => computeUiScale(window.innerWidth));
  const [isPhone,  setIsPhone]  = useState(() => window.innerWidth < PHONE_BP);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_BP);
  // panelHeight: half-screen on phone, 210px otherwise. Must come after PHONE_BP.
  const [panelHeight, setPanelHeight] = useState(
    () => window.innerWidth < PHONE_BP ? Math.round(window.innerHeight * 0.5) : 210
  );
  const [manualZoom, setManualZoomRaw] = useState(() => {
    try {
      const stored = localStorage.getItem("ncp-zoom");
      if (stored !== null) { const v = parseFloat(stored); return isNaN(v) ? null : v; }
      return window.innerWidth < PHONE_BP ? null : 1.25;
    } catch { return window.innerWidth < PHONE_BP ? null : 1.25; }
  });
  const setManualZoom = v => {
    setManualZoomRaw(v);
    try { if (v == null) localStorage.removeItem("ncp-zoom"); else localStorage.setItem("ncp-zoom", String(v)); } catch {}
  };
  const uiScale = manualZoom ?? autoScale;
  uiScaleRef.current  = uiScale;
  isPhoneRef.current  = isPhone;

  // ── Dynamic semester grid (cohort-trimmed) ───────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const SEMESTERS = useMemo(
    () => buildCohortSemesters(planEntSem, planEntYear, planGradSem, planGradYear, calendar),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planEntSem, planEntYear, planGradSem, planGradYear]
  );
  const { SEM_INDEX, SEM_NEXT, SEM_PREV } = useMemo(() => deriveSemMaps(SEMESTERS), [SEMESTERS]);

  // Ordinal helpers to enforce grad > entry (institution-agnostic)
  const _semTypes = calendar.getSemesterTypes();
  const _semOrd   = (typeId, year) => year * 100 + Math.max(0, _semTypes.findIndex(t => t.id === typeId));
  const entOrd  = _semOrd(planEntSem,  planEntYear);
  const gradOrd = _semOrd(planGradSem, planGradYear);

  // ── Refs ─────────────────────────────────────────────────────
  const panelResizing = useRef(null);
  const timelineRef   = useRef();
  const cardRefs      = useRef({});
  const bankRef       = useRef();
  const bankResizing  = useRef(null);
  const undoStack     = useRef([]);
  const redoStack     = useRef([]);
  // Stale-closure escape hatches for keyboard handler
  const stateRef      = useRef({ placements: {}, specialTermPl: {}, semOrders: {} });
  const selectedIdRef = useRef(null);
  const allEdgesRef   = useRef([]);
  const onDropRef      = useRef(null);   // updated each render for touch drag
  const onDropBankRef   = useRef(null);   // updated each render for touch drag → bank
  const touchDragIdRef  = useRef(null);  // card id currently being touch-dragged
  const touchDragElRef  = useRef(null);  // actual DOM element being touch-dragged (works for null-id templates)
  const ghostRef        = useRef(null);  // floating ghost element during touch drag
  const touchStartOff   = useRef({ x: 0, y: 0 }); // finger offset within card
  const isFirstRender = useRef(true);
  const touchDragFromRef = useRef(null);
  const touchDragTypeRef = useRef(null);
  const onDropPlacedOutRef = useRef(null);

  // ── Effects: data loading ────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    setLoading(true); setLoadPct(5);
    courseCatalog.fetchAll()
      .then(courses => {
        if (!mounted) return;
        setLoadPct(70);
        const base = Object.fromEntries(courses.map(c => [c.id, c]));
        setLoadPct(100);
        setCourses(Object.values(base));
        setLoading(false);
      })
      .catch(err => {
        if (!mounted) return;
        setLoadErr(err.message);
        setLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  // ── Effects: persistence ──────────────────────────────────────
  useEffect(() => {
    saveState(storagePrefix, persistEnabled, { placements, specialTermPl, currentSemId, collapsedSubs, semOrders, offeredOverrides, shOverrides, bonusSH, placedOut: [...placedOut], substitutions });
  }, [persistEnabled, placements, specialTermPl, currentSemId, collapsedSubs, semOrders, offeredOverrides, shOverrides, bonusSH, substitutions]);

  useEffect(() => {
    const h = () => saveState(persistEnabled, { placements, specialTermPl, currentSemId, collapsedSubs, semOrders, offeredOverrides, shOverrides, bonusSH, placedOut: [...placedOut], substitutions });
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [persistEnabled, placements, specialTermPl, currentSemId, collapsedSubs, semOrders, offeredOverrides, shOverrides, bonusSH]);

  // ── Effects: UI resize ───────────────────────────────────────
  useEffect(() => {
    const update = () => { setAutoScale(computeUiScale(window.innerWidth)); setIsPhone(window.innerWidth < PHONE_BP); setIsMobile(window.innerWidth < MOBILE_BP); };
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect: stale-closure ref sync ───────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    stateRef.current    = { placements, specialTermPl, semOrders };
    allEdgesRef.current = allEdges;
    onDropRef.current     = onDrop;
    onDropBankRef.current  = onDropBank;
    onDropPlacedOutRef.current = onDropPlacedOut;
  });
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  // ── Effects: panel drag-resize (mouse + touch) ─────────────
  useEffect(() => {
    const onMove = e => {
      if (!panelResizing.current) return;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const dy = panelResizing.current.startY - clientY;
      setPanelHeight(Math.min(520, Math.max(90, panelResizing.current.startH + dy)));
    };
    const onUp = () => { panelResizing.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",  onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend",  onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",  onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend",  onUp);
    };
  }, [])

  // ── Effect: keep currentSemId valid on cohort change ─────────
  useEffect(() => {
    const sems = buildCohortSemesters(planEntSem, planEntYear, planGradSem, planGradYear, calendar);
    setCurrentSemId(cur => sems.find(s => s.id === cur) ? cur : (sems[1]?.id ?? sems[0].id));
  }, [planEntSem, planEntYear, planGradSem, planGradYear]);

  // ── Effect: bank resize ───────────────────────────────────────
  useEffect(() => {
    const onMove = e => {
      if (!bankResizing.current) return;
      const dx = (bankResizing.current.startX - e.clientX) / uiScaleRef.current;
      const minW = window.innerWidth < 600 ? 80 : 180;
      setBankWidth(Math.min(640, Math.max(minW, bankResizing.current.startW + dx)));
    };
    const onUp = () => { bankResizing.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",  onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",  onUp);
    };
  }, []);

  // ── Effect: scroll → SVG recalc ──────────────────────────────
  // Depends on `loading` so it re-runs (and finds the DOM node) once
  // the timeline div is actually mounted after data loads.
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const h = () => setScrollTick(t => t + 1);
    el.addEventListener("scroll", h, { passive: true });
    return () => {
      el.removeEventListener("scroll", h);
    };
  }, [loading]);

  // effectivePlacements: real placements + virtual entries for substitution targets.
  // When CS3500 → CS4400 substitution exists and CS3500 is placed in fall2024,
  // CS4400 is added as if placed in fall2024. Credits use only real `placements`.
  const effectivePlacements = useMemo(() => {
    if (!substitutions.length) return placements;
    const result = { ...placements };
    for (const { from, to } of substitutions) {
      const fromSemId = placements[from];
      if (fromSemId) result[to] = fromSemId;
    }
    return result;
  }, [placements, substitutions]);

  // ── Effect: SVG lines ─────────────────────────────────────────
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const getCenter = id => {
        const el = cardRefs.current[id];
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (r.width === 0) return null;
        // On desktop, the app container has transform:scale(uiScale) so we
        // must divide back to SVG local coords.  On phone, transform is 'none'
        // so viewport px === SVG coords — do NOT divide.
        const sc = isPhoneRef.current ? 1 : (uiScaleRef.current || 1);
        return { x: (r.left + r.width  / 2) / sc,
                 y: (r.top  + r.height / 2) / sc };
      };
      const newLines = [];

      // ── Selection-driven lines ───────────────────────────────────
      if (selectedId) {
        getConnections(selectedId, allEdges).forEach(rel => {
          if (!placements[rel.from] || !placements[rel.to]) return;
          // Disable prereq/error lines for courses in 'incoming' semester
          if (placements[rel.from] === "incoming" || placements[rel.to] === "incoming") return;
          const fp = getCenter(rel.from);
          const tp = getCenter(rel.to);
          if (!fp || !tp) return;
          let type = rel.type;
          if (rel.type === "prerequisite") {
            const fromIdx = SEM_INDEX[placements[rel.from]] ?? -1;
            const toIdx   = SEM_INDEX[placements[rel.to]]   ?? -1;
            if (fromIdx >= toIdx) type = "prerequisite-order";
          }
          if (rel.type === "corequisite" && placements[rel.from] !== placements[rel.to]) {
            type = "corequisite-viol";
          }
          newLines.push({ ...rel, type, fp, tp });
        });

        // Substitution-inherited prereq lines for selected course.
        // Case 1: selected course IS the substituting course — draw lines to its inherited dependents.
        // Case 2: selected course depends on a substituted course — draw line from the substituting course.
        substitutions.forEach(({ from: subFrom, to: subTo }) => {
          if (!placements[subFrom] || placements[subFrom] === "incoming") return;
          allEdges.forEach(e => {
            if (e.type !== "prerequisite" || e.from !== subTo) return;
            if (!placements[e.to] || placements[e.to] === "incoming") return;
            if (subFrom !== selectedId && e.to !== selectedId) return;
            const fp = getCenter(subFrom);
            const tp = getCenter(e.to);
            if (!fp || !tp) return;
            const subFromIdx = SEM_INDEX[placements[subFrom]] ?? -1;
            const depIdx     = SEM_INDEX[placements[e.to]]    ?? -1;
            const subType    = subFromIdx < depIdx ? "substitution-prereq" : "substitution-prereq-order";
            newLines.push({ from: subFrom, to: e.to, type: subType, fp, tp });
          });
        });
      }

      // ── Always-on violation lines ────────────────────────────────
      if (showViolLines) {
        allEdges.forEach(rel => {
          // skip edges already drawn by selection logic above
          if (selectedId && (rel.from === selectedId || rel.to === selectedId)) return;
          if (!placements[rel.from] || !placements[rel.to]) return;
          // Disable prereq/error lines for courses in 'incoming' semester
          if (placements[rel.from] === "incoming" || placements[rel.to] === "incoming") return;
          if (rel.type === "prerequisite") {
            // Only draw a red line if the prereq predicate is unsatisfied due to order
            const toCourse = courseMap[rel.to];
            if (!toCourse || !toCourse.prereqs?.length) return;
            const ti = SEM_INDEX[placements[rel.to]];
            const prereqResult = evalPrereqTree(toCourse.prereqs, effectivePlacements, SEM_INDEX, ti);
            if (prereqResult !== "order") return; // Only draw if unsatisfied due to order
            // Now, check if THIS edge is the one out of order
            const fromIdx = SEM_INDEX[placements[rel.from]] ?? -1;
            if (fromIdx < ti) return; // This edge is not the one out of order
            const fp = getCenter(rel.from);
            const tp = getCenter(rel.to);
            if (!fp || !tp) return;
            newLines.push({ ...rel, type: "prerequisite-order", fp, tp });
          } else if (rel.type === "corequisite") {
            if (placements[rel.from] === placements[rel.to]) return; // not violated
            const fp = getCenter(rel.from);
            const tp = getCenter(rel.to);
            if (!fp || !tp) return;
            newLines.push({ ...rel, type: "corequisite-viol", fp, tp });
          }
        });

        // Substitution-inherited prereq violation lines (always-on, mirrors normal prereq logic).
        // Only draw when the substituting course is in the wrong order relative to the dependent.
        substitutions.forEach(({ from: subFrom, to: subTo }) => {
          if (!placements[subFrom] || placements[subFrom] === "incoming") return;
          allEdges.forEach(e => {
            if (e.type !== "prerequisite" || e.from !== subTo) return;
            if (!placements[e.to] || placements[e.to] === "incoming") return;
            // Skip if already drawn by selection logic
            if (selectedId && (subFrom === selectedId || e.to === selectedId)) return;
            const subFromIdx = SEM_INDEX[placements[subFrom]] ?? -1;
            const depIdx     = SEM_INDEX[placements[e.to]]    ?? -1;
            // Only draw violation (wrong order), not green satisfied lines
            if (subFromIdx < depIdx) return;
            const fp = getCenter(subFrom);
            const tp = getCenter(e.to);
            if (!fp || !tp) return;
            newLines.push({ from: subFrom, to: e.to, type: "substitution-prereq-order", fp, tp });
          });
        });
      }

      setLines(newLines);
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedId, showViolLines, placements, effectivePlacements, substitutions, specialTermPl, scrollTick, allEdges, SEM_INDEX]);

  // ── Undo / redo ───────────────────────────────────────────────
  const pushUndo = () => {
    const snap = {
      placements:    stateRef.current.placements,
      specialTermPl: stateRef.current.specialTermPl,
      semOrders:     stateRef.current.semOrders,
    };
    undoStack.current = [...undoStack.current.slice(-49), snap];
    redoStack.current = [];
  };

  const doUndo = () => {
    if (!undoStack.current.length) return;
    const snap = undoStack.current[undoStack.current.length - 1];
    redoStack.current = [...redoStack.current, {
      placements:    stateRef.current.placements,
      specialTermPl: stateRef.current.specialTermPl,
      semOrders:     stateRef.current.semOrders,
    }];
    undoStack.current = undoStack.current.slice(0, -1);
    setPlacements(snap.placements);
    setSpecialTermPl(snap.specialTermPl);
    setSemOrders(snap.semOrders);
  };

  const doRedo = () => {
    if (!redoStack.current.length) return;
    const snap = redoStack.current[redoStack.current.length - 1];
    undoStack.current = [...undoStack.current, {
      placements:    stateRef.current.placements,
      specialTermPl: stateRef.current.specialTermPl,
      semOrders:     stateRef.current.semOrders,
    }];
    redoStack.current = redoStack.current.slice(0, -1);
    setPlacements(snap.placements);
    setSpecialTermPl(snap.specialTermPl);
    setSemOrders(snap.semOrders);
  };

  // ── Effect: keyboard shortcuts ────────────────────────────────
  useEffect(() => {
    const onKey = e => {
      if (e.target.matches("input, textarea, select, [contenteditable]")) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        const selId = selectedIdRef.current;
        const pl    = stateRef.current.placements;
        if (selId && pl[selId]) {
          pushUndo();
          const fromSem = pl[selId];
          const coreqPartners = [...new Set(
            allEdgesRef.current
              .filter(e2 => e2.type === "corequisite" && (e2.from === selId || e2.to === selId))
              .map(e2 => e2.from === selId ? e2.to : e2.from)
          )];
          setPlacements(p => {
            const n = { ...p };
            delete n[selId];
            coreqPartners.forEach(cid => delete n[cid]);
            return n;
          });
          setSemOrders(p => {
            const next = { ...p };
            const toClean = new Set(
              [fromSem, ...coreqPartners.map(cid => pl[cid])].filter(Boolean)
            );
            toClean.forEach(sid => {
              next[sid] = (next[sid] || []).filter(
                id => id !== selId && !coreqPartners.includes(id)
              );
            });
            return next;
          });
          setSelectedId(null);
          setShowPanel(false);
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault(); doUndo();
      }
      if ((e.metaKey || e.ctrlKey) && ((e.key === "z" && e.shiftKey) || e.key === "y")) {
        e.preventDefault(); doRedo();
      }
      if (e.key === "Escape") {
        setSelectedId(null); setShowPanel(false); setShowSettings(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derived plan state ────────────────────────────────────────
  const currentSemIdx = SEM_INDEX[currentSemId] ?? 1;
  const placedIds = useMemo(
    () => new Set([...Object.keys(placements), ...placedOut]),
    [placements, placedOut]
  );

  // ── Unified special-term derived maps ────────────────────────
  // specialTermStartMap: { semId → instanceId } for the starting semester of each placed term.
  // specialTermContMap:  { semId → instanceId } for continuation semesters (weight-based span).
  const [specialTermStartMap, specialTermContMap] = useMemo(() => {
    const startMap = {};
    const contMap  = {};
    const types    = specialTerms?.getTypes() ?? [];
    Object.entries(specialTermPl).forEach(([id, data]) => {
      const { typeId, semId, duration } = data || {};
      if (!semId) return;
      startMap[semId] = id;
      const type = types.find(t => t.id === typeId);
      if (!type) return;
      const durationDesc = resolveTermByDuration(type.durations, duration);
      if (!durationDesc) return;
      const sem = SEMESTERS.find(s => s.id === semId);
      if (!sem) return;
      const semTypeDesc = (calendar.getSemesterTypes() ?? []).find(t => t.id === sem.type);
      const semWeight   = semTypeDesc?.weight ?? 1;
      if (termSpans(durationDesc.weight, semWeight)) {
        const nxt = SEM_NEXT[semId];
        if (nxt) contMap[nxt] = id;
      }
    });
    return [startMap, contMap];
  }, [specialTermPl, specialTerms, calendar, SEMESTERS, SEM_NEXT]);

  // Returns true if a slot (start or cont) is occupied by any special term other than excludeId.
  const isSlotOccupied = (semId, excludeId = null) => {
    const s = specialTermStartMap[semId]; if (s && s !== excludeId) return true;
    const c = specialTermContMap[semId];  if (c && c !== excludeId) return true;
    return false;
  };

  // Returns { valid, startId } for a special-term drag.
  // Delegates to specialTerms.validateDrop() — all placement rules live in the adapter.
  const specialTermDropValid = (typeId, duration, semId, excludeId = null) =>
    specialTerms.validateDrop(typeId, duration, semId, {
      SEMESTERS,
      SEM_PREV,
      SEM_NEXT,
      isOccupied: (sid) => isSlotOccupied(sid, excludeId),
    });

  const _gradSemType = calendar.getSemesterTypes().find(t => t.id === planGradSem);
  const gradSemId    = `${_gradSemType?.idPrefix ?? _gradSemType?.id ?? planGradSem}${planGradYear}`;
  const coopGradConflicts = useMemo(() => {
    const types = specialTerms?.getTypes() ?? [];
    return Object.entries(specialTermPl)
      .filter(([, data]) => {
        const semId = data?.semId;
        if (!semId) return false;
        return semId === gradSemId || SEM_NEXT[semId] === gradSemId;
      })
      .map(([id, data]) => {
        const type = types.find(t => t.id === data.typeId);
        return { id, label: type?.label ?? data.typeId, ...data };
      });
  }, [specialTermPl, gradSemId, SEM_NEXT, specialTerms]);

  const prereqViolations = useMemo(() => {
    const v = new Map();
    courses.forEach(c => {
      if (!placements[c.id] && !placedOut.has(c.id)) return; // not taken at all
      if (placements[c.id] === "incoming") return;
      if (placedOut.has(c.id)) return; // skip placed-out courses – they have no prereq warnings
      if (!c.prereqs?.length) return;
      const ti = SEM_INDEX[placements[c.id]];
      const result = evalPrereqTree(c.prereqs, effectivePlacements, SEM_INDEX, ti, placedOut);
      if (result !== "satisfied") v.set(c.id, result);
    });
    return v;
  }, [courses, placements, effectivePlacements, placedOut, SEM_INDEX]);

  const coreqViolations = useMemo(() => {
    const v = new Map();
    allEdges.filter(e => e.type === "corequisite").forEach(({ from, to }) => {
      [{ placed: from, partner: to }, { placed: to, partner: from }].forEach(({ placed, partner }) => {
        const placedTaken = placements[placed] !== undefined || placedOut.has(placed);
        const partnerTaken = placements[partner] !== undefined || placedOut.has(partner);
        if (!placedTaken) return;
        if (placements[placed] === "incoming") return;
        if (placedOut.has(placed)) return; // skip placed-out courses – they have no coreq warnings
        if (!partnerTaken) {
          v.set(placed, "alone");
        } else if (placements[placed] && placements[partner] && placements[placed] !== placements[partner]) {
          // both placed in different semesters → violation
          if (v.get(placed) !== "alone") v.set(placed, "sep");
        }
        // If one is placed out, no violation (treated as satisfied)
      });
    });
    return v;
  }, [allEdges, placements, placedOut]);

  const connectedIds = useMemo(() => {
    const m = {};
    if (!selectedId) return m;
    getConnections(selectedId, allEdges).forEach(r => {
      const other = r.from === selectedId ? r.to : r.from;
      m[other] = r.type;
    });
    return m;
  }, [selectedId, allEdges]);

  const getSemStatus = semId => {
    const idx = SEM_INDEX[semId];
    if (idx < currentSemIdx)    return "completed";
    if (semId === currentSemId) return "inprogress";
    return "future";
  };

  // ── Totals (use effectiveCourseMap so SH overrides are reflected) ─────────
  const totalSHPlaced = useMemo(
    () => bonusSH + courses
      .filter(c => placements[c.id] && !placedOut.has(c.id))
      .reduce((s, c) => s + (effectiveCourseMap[c.id]?.sh ?? c.sh), 0),
    [bonusSH, courses, placements, placedOut, effectiveCourseMap]
  );

  const totalSHDone = useMemo(
    () => bonusSH + courses.filter(c => {
      const sid = placements[c.id];
      return sid && !placedOut.has(c.id) && (SEM_INDEX[sid] ?? 99) < currentSemIdx;
    }).reduce((s, c) => s + (effectiveCourseMap[c.id]?.sh ?? c.sh), 0),
    [bonusSH, courses, placements, placedOut, SEM_INDEX, currentSemIdx, effectiveCourseMap]
  );

  // ── Star toggle ───────────────────────────────────────────────
  const toggleStar = id => {
    setStarredIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem("ncp-starred", JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  // ── Drag / drop ───────────────────────────────────────────────
  const onDragStart = (e, id, type, fromSem, extra = {}) => {
    e.stopPropagation();
    setDragInfo({ id, type, fromSem: fromSem ?? null, ...extra });
    e.dataTransfer.effectAllowed = "move";
  };

  const canDropSem = semId => {
    if (!dragInfo) return false;
    if (dragInfo.type === "specialTerm") {
      return specialTermDropValid(dragInfo.typeId, dragInfo.duration, semId, dragInfo.id).valid;
    }
    // Course drop — blocked by any occupying special term
    if (specialTermStartMap[semId] || specialTermContMap[semId]) return false;
    return !!SEMESTERS.find(s => s.id === semId);
  };

  const onDragOver = (e, semId) => {
    if (!canDropSem(semId)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setHoveredSem(semId);
  };

  const onDragLeave = () => {
    setHoveredSem(null);
    setHoveredZone(null);
  };

  const onDrop = (e, semId) => {
    if (e?.preventDefault) e.preventDefault();
    setHoveredSem(null); setHoveredZone(null);
    if (!dragInfo) return;
    pushUndo();
    const { id, type } = dragInfo;
    // If the course was placed out, remove it from placedOut
    if (placedOut.has(id)) {
      setPlacedOut(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
    if (type === "specialTerm") {
      const { typeId } = dragInfo;
      const { valid, startId } = specialTermDropValid(typeId, dragInfo.duration, semId, id);
      if (!valid) { setDragInfo(null); return; }
      const duration = dragInfo.duration;
      setSpecialTermPl(prev => {
        const next = { ...prev };
        if (id) delete next[id];
        const newId = id || `${typeId}-${Date.now()}`;
        next[newId] = { ...(id ? prev[id] : {}), typeId, semId: startId, duration };
        return next;
      });
    } else {
      const fromSem = placements[id];
      if (fromSem === semId) { setDragInfo(null); return; }
      // Always move ALL coreq partners together with the dragged course
      const coreqPartners = [...new Set(
        allEdges
          .filter(edge => edge.type === "corequisite" && (edge.from === id || edge.to === id))
          .map(edge => edge.from === id ? edge.to : edge.from)
          .filter(cid => cid !== id)
      )];
      const allMoving = [id, ...coreqPartners];
      setPlacements(p => {
        const n = { ...p, [id]: semId };
        coreqPartners.forEach(cid => { n[cid] = semId; });
        return n;
      });
      setSemOrders(prev => {
        const next = { ...prev };
        // Clean dragged + coreqs from any sems they were in
        if (fromSem && fromSem !== semId)
          next[fromSem] = (next[fromSem] || []).filter(cid => !allMoving.includes(cid));
        coreqPartners.forEach(cid => {
          const cOld = placements[cid];
          if (cOld && cOld !== fromSem && cOld !== semId)
            next[cOld] = (next[cOld] || []).filter(x => x !== cid);
        });
        const baseOrder = next[semId] || getOrderedCourses(semId, placements, prev, courseMap);
        const withoutDropped = baseOrder.filter(cid => !allMoving.includes(cid));
        next[semId] = [...withoutDropped, id, ...coreqPartners];
        return next;
      });
    }
    setDragInfo(null);
  };

  const onDropBank = e => {
    e.preventDefault();
    if (!dragInfo) return;
    pushUndo();
    const { id, type, fromSem } = dragInfo;
    // If the course was placed out, remove it from placedOut
    if (placedOut.has(id)) {
      setPlacedOut(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
    if (type === "specialTerm") {
      if (id) setSpecialTermPl(p => { const n = { ...p }; delete n[id]; return n; });
    } else {
      const coreqPartners = [...new Set(
        allEdges
          .filter(e2 => e2.type === "corequisite" && (e2.from === id || e2.to === id))
          .map(e2 => e2.from === id ? e2.to : e2.from)
      )];
      setPlacements(p => {
        const n = { ...p };
        delete n[id];
        coreqPartners.forEach(cid => delete n[cid]);
        return n;
      });
      setSemOrders(p => {
        const next = { ...p };
        const toClean = new Set([fromSem, ...coreqPartners.map(cid => placements[cid])].filter(Boolean));
        toClean.forEach(sid => {
          next[sid] = (next[sid] || []).filter(cid => cid !== id && !coreqPartners.includes(cid));
        });
        return next;
      });
    }
    setDragInfo(null);
  };

  const onDropPlacedOut = (dragInfo) => {
    console.log('onDropPlacedOut called with:', dragInfo);
    try {
      if (!dragInfo || dragInfo.type !== "course") return;
      pushUndo();
      const { id, fromSem } = dragInfo;

      console.log('onDropPlacedOut called with:', { id, fromSem });

      // Add to placedOut set
      setPlacedOut(prev => {
        console.log('Adding to placedOut:', id);
        return new Set([...prev, id]);
      });

      // If the course was placed in a semester, remove it from placements
      if (placements[id]) {
        console.log('Course was placed in semester:', placements[id]);
        const coreqPartners = [...new Set(
          allEdges
            .filter(edge => edge.type === "corequisite" && (edge.from === id || edge.to === id))
            .map(edge => edge.from === id ? edge.to : edge.from)
        )];
        console.log('Coreq partners:', coreqPartners);

        setPlacements(p => {
          const n = { ...p };
          delete n[id];
          coreqPartners.forEach(cid => delete n[cid]);
          console.log('New placements:', n);
          return n;
        });
        setSemOrders(p => {
          const next = { ...p };
          const toClean = new Set([fromSem, ...coreqPartners.map(cid => placements[cid])].filter(Boolean));
          console.log('Cleaning semesters:', toClean);
          toClean.forEach(sid => {
            next[sid] = (next[sid] || []).filter(cid => cid !== id && !coreqPartners.includes(cid));
          });
          return next;
        });
      } else {
        console.log('Course was not placed (from bank)');
      }

      setDragInfo(null);
    } catch (error) {
      console.error('Error in onDropPlacedOut:', error);
    }
  };

  const onDropOnCard = (e, targetId, targetSemId) => {
    e.preventDefault(); e.stopPropagation();
    setHoveredCardId(null); setHoveredSem(null); setHoveredZone(null);
    if (!dragInfo || dragInfo.type !== "course" || dragInfo.id === targetId) return;
    pushUndo();
    const dragId  = dragInfo.id;
    const fromSem = placements[dragId];
    const targetSemType = SEMESTERS.find(s => s.id === targetSemId)?.type;

    // Always carry all coreq partners of the dragged course
    const coreqPartners = [...new Set(
      allEdges
        .filter(e2 => e2.type === "corequisite" && (e2.from === dragId || e2.to === dragId))
        .map(e2 => e2.from === dragId ? e2.to : e2.from)
        .filter(cid => cid !== dragId)
    )];
    const allMoving = [dragId, ...coreqPartners];

    if (fromSem === targetSemId) {
      // Same-sem reorder (coreqs stay, just reorder the dragged card)
      setSemOrders(prev => {
        const cur = getOrderedCourses(targetSemId, placements, prev, courseMap);
        const fi  = cur.indexOf(dragId), ti = cur.indexOf(targetId);
        if (fi < 0 || ti < 0) return prev;
        const next = [...cur]; next.splice(fi, 1); next.splice(ti, 0, dragId);
        return { ...prev, [targetSemId]: next };
      });
    } else if (targetSemType === "special") {
      // Append to special/incoming sem — carry coreqs along
      setPlacements(p => {
        const n = { ...p, [dragId]: targetSemId };
        coreqPartners.forEach(cid => { n[cid] = targetSemId; });
        return n;
      });
      setSemOrders(prev => {
        const next = { ...prev };
        const toClean = new Set([fromSem, ...coreqPartners.map(cid => placements[cid])].filter(Boolean));
        toClean.forEach(sid => {
          next[sid] = (next[sid] || getOrderedCourses(sid, placements, prev, courseMap)).filter(cid => !allMoving.includes(cid));
        });
        const toOrder = getOrderedCourses(targetSemId, placements, prev, courseMap);
        next[targetSemId] = [...toOrder.filter(cid => !allMoving.includes(cid)), dragId, ...coreqPartners];
        return next;
      });
    } else {
      // Different sem — swap targetId ↔ fromSem, move dragId+coreqs → targetSemId
      const fromOrder = getOrderedCourses(fromSem,     placements, semOrders, courseMap);
      const toOrder   = getOrderedCourses(targetSemId, placements, semOrders, courseMap);
      const fi = fromOrder.indexOf(dragId), ti = toOrder.indexOf(targetId);
      setPlacements(p => {
        const n = { ...p, [dragId]: targetSemId, [targetId]: fromSem };
        coreqPartners.forEach(cid => { n[cid] = targetSemId; });
        return n;
      });
      setSemOrders(prev => {
        const next = { ...prev };
        // nf: remove dragId+coreqs, insert targetId where dragId was
        const nf = fromOrder.filter(c => !allMoving.includes(c));
        nf.splice(Math.min(fi, nf.length), 0, targetId);
        // nt: remove targetId, insert dragId+coreqs where targetId was
        const nt = toOrder.filter(c => c !== targetId);
        nt.splice(Math.min(ti, nt.length), 0, dragId, ...coreqPartners);
        // Remove coreqs from any other sems they were in
        coreqPartners.forEach(cid => {
          const cOld = placements[cid];
          if (cOld && cOld !== fromSem && cOld !== targetSemId)
            next[cOld] = (next[cOld] || []).filter(x => x !== cid);
        });
        next[fromSem]    = nf;
        next[targetSemId] = nt;
        return next;
      });
    }
    setDragInfo(null);
  };

  // ── Touch drag (mobile) ──────────────────────────────────────
  // Ghost element follows the finger; original card dims to 30% opacity.
  // Text selection is suppressed for the duration of the drag.
  useEffect(() => {
    const removeGhost = () => {
      if (ghostRef.current) { ghostRef.current.remove(); ghostRef.current = null; }
    };

    const onTouchStart = (e) => {
      // Let interactive elements handle their own touch (inputs, buttons, selects)
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
      const cardEl = e.target.closest('[data-drag-id]');
      if (!cardEl) return;
      const id       = cardEl.dataset.dragId || null;
      const type     = cardEl.dataset.dragType;
      const fromSem  = cardEl.dataset.dragFrom || null;
      const duration = cardEl.dataset.dragDuration ? parseInt(cardEl.dataset.dragDuration, 10) : undefined;
      const touch   = e.touches[0];
      const rect    = cardEl.getBoundingClientRect();

      // Suppress text selection
      document.documentElement.style.userSelect = 'none';
      document.documentElement.style.webkitUserSelect = 'none';

      // Build ghost clone that floats under the finger
      removeGhost();
      const ghost = cardEl.cloneNode(true);
      ghost.style.position      = 'fixed';
      ghost.style.left          = rect.left + 'px';
      ghost.style.top           = rect.top  + 'px';
      ghost.style.width         = rect.width  + 'px';
      ghost.style.height        = rect.height + 'px';
      ghost.style.pointerEvents = 'none';
      ghost.style.zIndex        = '9999';
      ghost.style.opacity       = '0.92';
      ghost.style.boxShadow     = '0 8px 24px rgba(0,0,0,0.25)';
      ghost.style.transform     = 'scale(1.06)';
      ghost.style.transition    = 'none';
      document.body.appendChild(ghost);
      ghostRef.current = ghost;
      touchStartOff.current = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };

      // Dim original and hide from hit-testing
      cardEl.style.opacity       = '0.3';
      cardEl.style.pointerEvents = 'none';

      touchDragElRef.current = cardEl;
      touchDragIdRef.current = id;
      touchDragTypeRef.current = type;
      touchDragFromRef.current = fromSem;
      setDragInfo({ id, type, fromSem, ...(duration != null ? { duration } : {}) });
    };

    const onTouchMove = (e) => {
      if (!touchDragElRef.current && !touchDragIdRef.current) return;
      e.preventDefault();
      const touch = e.touches[0];
      if (ghostRef.current) {
        ghostRef.current.style.left = (touch.clientX - touchStartOff.current.x) + 'px';
        ghostRef.current.style.top  = (touch.clientY - touchStartOff.current.y) + 'px';
      }
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      const semEl  = target?.closest('[data-sem-id]');
      setHoveredSem(semEl?.dataset.semId ?? null);
    };

    const onTouchEnd = (e) => {
      console.log('Touch end triggered');
      if (!touchDragElRef.current && !touchDragIdRef.current) {
        console.log('No drag in progress');
        return;
      }
      const id = touchDragIdRef.current;
      const type = touchDragTypeRef.current;
      const fromSem = touchDragFromRef.current;
      const cardEl = touchDragElRef.current || cardRefs.current[id];
      if (cardEl) { cardEl.style.opacity = ''; cardEl.style.pointerEvents = ''; }
      touchDragElRef.current = null;
      removeGhost();
      document.documentElement.style.userSelect = '';
      document.documentElement.style.webkitUserSelect = '';
      const touch  = e.changedTouches[0];
      const touchX = touch.clientX, touchY = touch.clientY;
      console.log('Touch coordinates:', { touchX, touchY });
      const target = document.elementFromPoint(touchX, touchY);
      console.log('Element at touch point:', target);
      const semEl  = target?.closest('[data-sem-id]');
      const bankEl = target?.closest('[data-drop-bank]');
      let placedOutEl = target?.closest('[data-drop-placedout]');
      console.log('Direct placedOutEl via closest:', placedOutEl);

      // Fallback: manually check all placed-out containers
      if (!placedOutEl) {
        const placedOutContainers = document.querySelectorAll('[data-drop-placedout]');
        console.log('Number of placed-out containers found:', placedOutContainers.length);
        for (const container of placedOutContainers) {
          const rect = container.getBoundingClientRect();
          console.log('Container rect:', rect);
          if (touchX >= rect.left && touchX <= rect.right && touchY >= rect.top && touchY <= rect.bottom) {
            placedOutEl = container;
            console.log('Found via bounding rect');
            break;
          }
        }
      }

      if (placedOutEl && onDropPlacedOutRef.current && type === 'course') {
        console.log('Dropping on placed out section');
        const dragInfo = { id, type, fromSem };
        onDropPlacedOutRef.current(dragInfo);
      } else if (bankEl && onDropBankRef.current) {
        console.log('Dropping on bank');
        onDropBankRef.current({ preventDefault: () => {} });
      } else if (semEl && onDropRef.current) {
        console.log('Dropping on semester');
        onDropRef.current(null, semEl.dataset.semId);
      } else {
        console.log('No valid drop target, cancelling drag');
        setDragInfo(null);
      }
      touchDragIdRef.current = null;
      touchDragTypeRef.current = null;
      touchDragFromRef.current = null;
      setHoveredSem(null);
      setHoveredZone(null);
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove',  onTouchMove,  { passive: false });
    document.addEventListener('touchend',   onTouchEnd,   { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove',  onTouchMove);
      document.removeEventListener('touchend',   onTouchEnd);
      removeGhost();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Bank helpers ─────────────────────────────────────────────
  const bankCourseIds = useMemo(
    () => new Set(courses.filter(c => !placedIds.has(c.id)).map(c => c.id)),
    [courses, placedIds]
  );

  // ── Reset ────────────────────────────────────────────────────
  const resetPlanToDefaults = () => {
    setPlacements({});
    setSpecialTermPl({});
    setSemOrders({});
    setOfferedOverrides({});
    setBonusSH(0);
    setMajor("");
    setConc("");
    setMinor1("");
    setMinor2("");
    setPlacedOut(new Set());
    // Reset cohort to defaults
    setPlanEntSem(_defEntSem);
    setPlanEntYear(defaultStartYear);
    setPlanGradSem(_defGradSem);
    setPlanGradYear(defaultStartYear + NUM_YEARS);
    // Also clear any per‑plan localStorage items for cohort (optional, but safe)
    try {
      localStorage.setItem("ncp-ent-sem",  _defEntSem);
      localStorage.setItem("ncp-ent-year", String(defaultStartYear));
      localStorage.setItem("ncp-grad-sem", _defGradSem);
      localStorage.setItem("ncp-grad-year", String(defaultStartYear + NUM_YEARS));
    } catch {}
  };
  const resetAll = resetPlanToDefaults;

  // ── Multi-plan management ────────────────────────────────────
  const [plans, setPlans] = useState(() => {
    try {
      const raw = localStorage.getItem("ncp-plan-index");
      if (raw) return JSON.parse(raw);
    } catch {}
    return [{ id: "default", name: "Plan 1" }];
  });
  const [activePlanId, setActivePlanId] = useState(() => {
    try { return localStorage.getItem("ncp-active-plan") || "default"; } catch { return "default"; }
  });

  // Persist plan index whenever it changes
  useEffect(() => {
    try { localStorage.setItem("ncp-plan-index", JSON.stringify(plans)); } catch {}
  }, [plans]);
  useEffect(() => {
    try { localStorage.setItem("ncp-active-plan", activePlanId); } catch {}
  }, [activePlanId]);

  // Capture full plan state as a serializable object
  const captureCurrentPlan = () => ({
    version: 1,
    exported: new Date().toISOString(),
    entSem: planEntSem, entYear: planEntYear,
    gradSem: planGradSem, gradYear: planGradYear,
    placements, specialTermPl, semOrders, shOverrides, bonusSH, currentSemId,
    offeredOverrides, collapsedSubs,
    major, conc, minor1, minor2,
    placedOut: [...placedOut],
  });

  // Restore a plan data object into all state
  // Migrate old workPl+internPl format (saved before specialTermPl refactor)
  const migrateSpecialTermPl = (d) => {
    if (d.specialTermPl) return d.specialTermPl;
    const result = {};
    if (d.workPl)   for (const [id, data] of Object.entries(d.workPl))   result[id] = { typeId: "coop",   ...data };
    if (d.internPl) for (const [id, data] of Object.entries(d.internPl)) result[id] = { typeId: "intern", ...data };
    return result;
  };

  const restorePlan = (d) => {
    setPlacements(d.placements ?? {});
    setSpecialTermPl(migrateSpecialTermPl(d));
    setSemOrders(d.semOrders ?? {});
    setShOverrides(d.shOverrides ?? {});
    setOfferedOverrides(d.offeredOverrides ?? {});
    setCollapsedSubs(d.collapsedSubs ?? {});
    setBonusSH(d.bonusSH ?? 0);
    if (d.currentSemId) setCurrentSemId(d.currentSemId);
    if (d.entSem)  { setPlanEntSem(d.entSem);   try { localStorage.setItem("ncp-ent-sem",  d.entSem);  } catch {} }
    if (d.entYear) { setPlanEntYear(d.entYear);  try { localStorage.setItem("ncp-ent-year", d.entYear); } catch {} }
    if (d.gradSem) { setPlanGradSem(d.gradSem);  try { localStorage.setItem("ncp-grad-sem", d.gradSem); } catch {} }
    if (d.gradYear){ setPlanGradYear(d.gradYear); try { localStorage.setItem("ncp-grad-year",d.gradYear);} catch {} }
    setMajor(d.major ?? "");
    setConc(d.conc ?? "");
    setMinor1(d.minor1 ?? "");
    setMinor2(d.minor2 ?? "");
    setPlacedOut(d.placedOut ? new Set(d.placedOut) : new Set());
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`ncp-plan-data-${activePlanId}`);
      if (raw) {
        const d = JSON.parse(raw);
        restorePlan(d);
      } else {
        resetPlanToDefaults();
      }
    } catch {
      resetPlanToDefaults();
    }
    // Reset bank UI filters to defaults
    setBankSearch("");
    setBankTab("all");
    setBankSort("az");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlanId]);

  // Save current plan to its localStorage slot
  const saveCurrentPlanToSlot = () => {
    try { localStorage.setItem(`ncp-plan-data-${activePlanId}`, JSON.stringify(captureCurrentPlan())); } catch {}
  };

  // Switch to a different plan
  const switchPlan = (id) => {
    if (id === activePlanId) return;
    // Auto-save current plan
    saveCurrentPlanToSlot();
    // Switch to new plan – the useEffect will load its data (or reset)
    setActivePlanId(id);
  };

  // Create a new plan
    const createPlan = (name) => {
    // Auto-save current plan
    saveCurrentPlanToSlot();
    const id = `plan_${Date.now()}`;
    setPlans(prev => [...prev, { id, name }]);
    // Switch to new plan – the useEffect will reset to defaults (no saved data)
    setActivePlanId(id);
  };

  // Delete a plan
  const deletePlan = (id) => {
    if (plans.length <= 1) return; // can't delete last plan
    try { localStorage.removeItem(`ncp-plan-data-${id}`); } catch {}
    const remaining = plans.filter(p => p.id !== id);
    setPlans(remaining);
    if (id === activePlanId) {
      // Switch to first remaining plan – the useEffect will load its data (or reset)
      setActivePlanId(remaining[0].id);
    }
  };

  // Rename a plan
  const renamePlan = (id, name) => {
    setPlans(prev => prev.map(p => p.id === id ? { ...p, name } : p));
  };

  // Auto-save active plan periodically (on every persistence save)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    saveCurrentPlanToSlot();
  }, [placements, specialTermPl, currentSemId, semOrders, offeredOverrides, shOverrides, bonusSH, major, conc, minor1, minor2, activePlanId]); // eslint-disable-line react-hooks/exhaustive-deps
  
  // ── Plan JSON export / import ────────────────────────────────
  const exportPlanJSON = () => {
    const data = {
      version: 1,
      exported: new Date().toISOString(),
      entSem: planEntSem, entYear: planEntYear,
      gradSem: planGradSem, gradYear: planGradYear,
      placements, specialTermPl, semOrders, shOverrides, bonusSH, currentSemId,
      offeredOverrides, collapsedSubs,
      placedOut: [...placedOut], substitutions,
      major, conc, minor1, minor2,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const planName = plans.find(p => p.id === activePlanId)?.name || 'Untitled';
    const sanitizedPlanName = planName.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    const dateStr = new Date().toISOString().slice(0, 10);
    a.download = `${sanitizedPlanName || 'Plan'} - ${institution.shortName ?? institution.name} Map - ${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const importPlanJSON = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (d.version !== 1) { alert("Unrecognized plan file format."); return; }
        pushUndo();
        setPlacements(d.placements ?? {});
        setSpecialTermPl(migrateSpecialTermPl(d));
        setSemOrders(d.semOrders ?? {});
        setShOverrides(prev => d.shOverrides ?? prev);
        setOfferedOverrides(prev => d.offeredOverrides ?? prev);
        setCollapsedSubs(prev => d.collapsedSubs ?? prev);
        setBonusSH(d.bonusSH ?? 0);
        setPlacedOut(new Set(Array.isArray(d.placedOut) ? d.placedOut : []));
        setSubstitutions(Array.isArray(d.substitutions) ? d.substitutions : []);
        if (d.currentSemId) setCurrentSemId(d.currentSemId);
        if (d.entSem)  { setPlanEntSem(d.entSem);   try { localStorage.setItem("ncp-ent-sem",  d.entSem);  } catch {} }
        if (d.entYear) { setPlanEntYear(d.entYear);  try { localStorage.setItem("ncp-ent-year", d.entYear); } catch {} }
        if (d.gradSem) { setPlanGradSem(d.gradSem);  try { localStorage.setItem("ncp-grad-sem", d.gradSem); } catch {} }
        if (d.gradYear){ setPlanGradYear(d.gradYear); try { localStorage.setItem("ncp-grad-year",d.gradYear);} catch {} }
        setMajor(d.major ?? "");
        setConc(d.conc ?? "");
        setMinor1(d.minor1 ?? "");
        setMinor2(d.minor2 ?? "");
      } catch (err) {
        alert("Could not read plan file: " + err.message);
      }
    };
    reader.readAsText(file);
  };

  // ── Cohort setters that also persist to localStorage ─────────
  // When stickyCourses is on, snapshot placements + SEMESTERS before changing
  const setEntSem = sem => {
    if (stickyCourses) stickySnapshotRef.current = { placements: { ...placements }, specialTermPl: { ...specialTermPl }, sems: [...SEMESTERS] };
    setPlanEntSem(sem);
    try { localStorage.setItem("ncp-ent-sem", sem); } catch {}
  };
  const setEntYear = year => {
    if (stickyCourses) stickySnapshotRef.current = { placements: { ...placements }, specialTermPl: { ...specialTermPl }, sems: [...SEMESTERS] };
    setPlanEntYear(year);
    try { localStorage.setItem("ncp-ent-year", year); } catch {}
  };
  const setGradSem = sem => {
    if (stickyCourses) stickySnapshotRef.current = { placements: { ...placements }, specialTermPl: { ...specialTermPl }, sems: [...SEMESTERS] };
    setPlanGradSem(sem);
    try { localStorage.setItem("ncp-grad-sem", sem); } catch {}
  };
  const setGradYear = year => {
    if (stickyCourses) stickySnapshotRef.current = { placements: { ...placements }, specialTermPl: { ...specialTermPl }, sems: [...SEMESTERS] };
    setPlanGradYear(year);
    try { localStorage.setItem("ncp-grad-year", year); } catch {}
  };

  // ── Sticky: remap placements + co-ops after SEMESTERS regenerates ──
  useEffect(() => {
    const snap = stickySnapshotRef.current;
    if (!snap) return;
    stickySnapshotRef.current = null;
    const oldIds = snap.sems.map(s => s.id);
    const newIds = SEMESTERS.map(s => s.id);
    // If semesters didn't actually change, skip
    if (oldIds.length === newIds.length && oldIds.every((id, i) => id === newIds[i])) return;

    // Remap course placements
    const newPl = {};
    for (const [cid, semId] of Object.entries(snap.placements)) {
      const idx = oldIds.indexOf(semId);
      if (idx !== -1 && idx < newIds.length) {
        newPl[cid] = newIds[idx];
      } else if (semId === "incoming" || newIds.includes(semId)) {
        newPl[cid] = semId;
      } else {
        newPl[cid] = newIds[newIds.length - 1];
      }
    }
    setPlacements(newPl);

    // Remap special term placements
    if (snap.specialTermPl) {
      const newStp = {};
      for (const [id, data] of Object.entries(snap.specialTermPl)) {
        const semId = data?.semId;
        if (!semId) continue;
        const idx = oldIds.indexOf(semId);
        if (idx !== -1 && idx < newIds.length) {
          newStp[id] = { ...data, semId: newIds[idx] };
        } else if (newIds.includes(semId)) {
          newStp[id] = data;
        }
        // If the semester no longer exists, drop the placement
      }
      setSpecialTermPl(newStp);
    }
  }, [SEMESTERS]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Offered overrides setter ─────────────────────────────────
  const toggleOffered = (courseId, type, currentList) => {
    setOfferedOverrides(prev => {
      const cur  = prev[courseId] ?? currentList;
      const next = cur.includes(type) ? cur.filter(t => t !== type) : [...cur, type];
      return { ...prev, [courseId]: next };
    });
  };

  // ── Context value ─────────────────────────────────────────────
  const value = {
    // Data
    courses, courseMap, effectiveCourseMap, allEdges, subjects,
    // Load state
    loading, loadErr, loadPct,
    // Planner state
    placements, effectivePlacements, specialTermPl, currentSemId, persistEnabled,
    semOrders, offeredOverrides, collapsedSubs, shOverrides,
    // Semester grid
    SEMESTERS, SEM_INDEX, SEM_NEXT, SEM_PREV,
    // UI state
    selectedId, dragInfo, hoveredSem, hoveredZone, hoveredCardId,
    showPanel, lines, scrollTick, showViolLines,
    // Bank state
    bankSearch, bankSort, bankTab, bankWidth, showSubjectKeys,
    starredIds, bankCourseIds,
    // Settings
    showDisclaimer, showSettings,
    collapseOtherCredits, setCollapseOtherCredits: updateCollapseOtherCredits,
    showContLogo, setShowContLogo: updateShowContLogo,
    stickyCourses, setStickyCourses,
    planEntSem, planEntYear, planGradSem, planGradYear, entOrd, gradOrd,
    panelHeight,
    isPhone, isMobile, uiScale, manualZoom, setManualZoom,
    // Derived
    currentSemIdx, placedIds, specialTermStartMap, specialTermContMap,
    gradSemId, coopGradConflicts,
    prereqViolations, coreqViolations, connectedIds,
    totalSHPlaced, totalSHDone, bonusSH, setBonusSH,
    major, setMajor, conc, setConc, minor1, setMinor1, minor2, setMinor2,
    placedOut, setPlacedOut, 
    // Refs (passed through for DOM measurements)
    timelineRef, cardRefs, bankRef, bankResizing, panelResizing, uiScaleRef,
    // Actions
    setSelectedId, setShowPanel, setDragInfo,
    setHoveredSem, setHoveredZone, setHoveredCardId,
    setShowViolLines,
    setBankSearch, setBankSort, setBankTab, setBankWidth, setShowSubjectKeys,
    setCollapsedSubs,
    setShowDisclaimer, setShowSettings,
    setPersistEnabled,
    setOfferedOverrides,
    setShOverride: (id, value) => setShOverrides(prev => {
      const next = { ...prev };
      if (value === null || value === undefined) delete next[id]; else next[id] = value;
      return next;
    }),
    setPlacements, setSpecialTermPl, setSemOrders, setCurrentSemId,
    setEntSem, setEntYear, setGradSem, setGradYear,
    resetAll, exportPlanJSON, importPlanJSON,
    plans, activePlanId, switchPlan, createPlan, deletePlan, renamePlan,
    toggleStar, toggleOffered,
    getSemStatus,
    substitutions,
    addSubstitution: (fromId, toId) => setSubstitutions(prev =>
      prev.some(s => s.from === fromId && s.to === toId) ? prev : [...prev, { from: fromId, to: toId }]
    ),
    removeSubstitution: (fromId, toId) => setSubstitutions(prev =>
      prev.filter(s => !(s.from === fromId && s.to === toId))
    ),
    onDragStart, onDragOver, onDragLeave, onDrop, onDropBank, onDropOnCard, onDropPlacedOut,
    canDropSem,
    doUndo, doRedo, pushUndo,
  };

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}

/** Consume the planner context. Must be used inside <PlannerProvider>. */
export function usePlanner() {
  const ctx = useContext(PlannerContext);
  if (!ctx) throw new Error("usePlanner must be used inside <PlannerProvider>");
  return ctx;
}
