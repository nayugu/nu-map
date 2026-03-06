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
import { DEFAULT_START_YEAR, NUM_YEARS, WORK_TERMS } from "../core/constants.js";
import { buildCohortSemesters, deriveSemMaps } from "../core/semGrid.js";
import { normalizeCourse, extractEdges, getOfferedFromTerms, getSemOfferedType } from "../core/courseModel.js";
import { evalPrereqTree } from "../core/prereqEval.js";
import { getSemSH, getOrderedCourses, getConnections } from "../core/planModel.js";
import { fetchCourses } from "../data/courseLoader.js";
import { loadSaved, saveState } from "../data/persistence.js";

const PlannerContext = createContext(null);

export function PlannerProvider({ children }) {
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
  const _saved = useMemo(() => loadSaved(), []);
  const [placements,       setPlacements]       = useState(() => (_saved?.persist && _saved.placements)       ? _saved.placements       : {});
  const [workPl,           setWorkPl]           = useState(() => (_saved?.persist && _saved.workPl)           ? _saved.workPl           : {});
  const [currentSemId,     setCurrentSemId]     = useState(() => (_saved?.persist && _saved.currentSemId)     ? _saved.currentSemId     : `fall${DEFAULT_START_YEAR}`);
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

  // ── Sticky Courses ──
  const stickySnapshotRef = useRef(null);
  const [stickyCourses, setStickyCourses] = useState(() => {
    try { return localStorage.getItem("ncp-sticky-courses") !== "false"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem("ncp-sticky-courses", String(stickyCourses)); } catch {}
  }, [stickyCourses]);

  // ── UI: Other credits collapse setting ──
  const [collapseOtherCredits, setCollapseOtherCredits] = useState(() => true);
  const updateCollapseOtherCredits = (val) => {
    setCollapseOtherCredits(val);
    try { localStorage.setItem("ncp-collapse-other-credits", String(val)); } catch {}
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
  const [planEntSem,   setPlanEntSem]   = useState(() => { try { return localStorage.getItem("ncp-ent-sem")  || "fall";   } catch { return "fall";   } });
  const [planEntYear,  setPlanEntYear]  = useState(() => { try { return parseInt(localStorage.getItem("ncp-ent-year")  || String(DEFAULT_START_YEAR), 10) || DEFAULT_START_YEAR; } catch { return DEFAULT_START_YEAR; } });
  const [planGradSem,  setPlanGradSem]  = useState(() => { try { return localStorage.getItem("ncp-grad-sem") || "spring"; } catch { return "spring"; } });
  const [planGradYear, setPlanGradYear] = useState(() => { try { return parseInt(localStorage.getItem("ncp-grad-year") || String(DEFAULT_START_YEAR + NUM_YEARS), 10) || DEFAULT_START_YEAR + NUM_YEARS; } catch { return DEFAULT_START_YEAR + NUM_YEARS; } });
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
    () => buildCohortSemesters(planEntSem, planEntYear, planGradSem, planGradYear),
    [planEntSem, planEntYear, planGradSem, planGradYear]
  );
  const { SEM_INDEX, SEM_NEXT, SEM_PREV } = useMemo(() => deriveSemMaps(SEMESTERS), [SEMESTERS]);

  // Ordinal helpers to enforce grad > entry
  const entOrd  = planEntYear  * 2 + (planEntSem  === "spring" ? 1 : 0);
  const gradOrd = planGradYear * 2 + (planGradSem === "spring" ? 1 : 0);

  // ── Refs ─────────────────────────────────────────────────────
  const panelResizing = useRef(null);
  const timelineRef   = useRef();
  const cardRefs      = useRef({});
  const bankRef       = useRef();
  const bankResizing  = useRef(null);
  const undoStack     = useRef([]);
  const redoStack     = useRef([]);
  // Stale-closure escape hatches for keyboard handler
  const stateRef      = useRef({ placements: {}, workPl: {}, semOrders: {} });
  const selectedIdRef = useRef(null);
  const allEdgesRef   = useRef([]);
  const onDropRef      = useRef(null);   // updated each render for touch drag
  const onDropBankRef   = useRef(null);   // updated each render for touch drag → bank
  const touchDragIdRef  = useRef(null);  // card id currently being touch-dragged
  const ghostRef        = useRef(null);  // floating ghost element during touch drag
  const touchStartOff   = useRef({ x: 0, y: 0 }); // finger offset within card
  const isFirstRender = useRef(true);

  // ── Effects: data loading ────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    setLoading(true); setLoadPct(5);
    fetchCourses()
      .then(raw => {
        if (!mounted) return;
        setLoadPct(70);
        const base = Object.fromEntries(
          raw.map(normalizeCourse).filter(Boolean).map(c => [c.id, c])
        );

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
    saveState(persistEnabled, { placements, workPl, currentSemId, collapsedSubs, semOrders, offeredOverrides, shOverrides, bonusSH });
  }, [persistEnabled, placements, workPl, currentSemId, collapsedSubs, semOrders, offeredOverrides, shOverrides, bonusSH]);

  useEffect(() => {
    const h = () => saveState(persistEnabled, { placements, workPl, currentSemId, collapsedSubs, semOrders, offeredOverrides, shOverrides, bonusSH });
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [persistEnabled, placements, workPl, currentSemId, collapsedSubs, semOrders, offeredOverrides, shOverrides, bonusSH]);

  // ── Effects: UI resize ───────────────────────────────────────
  useEffect(() => {
    const update = () => { setAutoScale(computeUiScale(window.innerWidth)); setIsPhone(window.innerWidth < PHONE_BP); setIsMobile(window.innerWidth < MOBILE_BP); };
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect: stale-closure ref sync ───────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    stateRef.current    = { placements, workPl, semOrders };
    allEdgesRef.current = allEdges;
    onDropRef.current     = onDrop;
    onDropBankRef.current  = onDropBank;
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
    const sems = buildCohortSemesters(planEntSem, planEntYear, planGradSem, planGradYear);
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
            const prereqResult = evalPrereqTree(toCourse.prereqs, placements, SEM_INDEX, ti);
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
      }

      setLines(newLines);
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedId, showViolLines, placements, workPl, scrollTick, allEdges, SEM_INDEX]);

  // ── Undo / redo ───────────────────────────────────────────────
  const pushUndo = () => {
    const snap = {
      placements: stateRef.current.placements,
      workPl:     stateRef.current.workPl,
      semOrders:  stateRef.current.semOrders,
    };
    undoStack.current = [...undoStack.current.slice(-49), snap];
    redoStack.current = [];
  };

  const doUndo = () => {
    if (!undoStack.current.length) return;
    const snap = undoStack.current[undoStack.current.length - 1];
    redoStack.current = [...redoStack.current, {
      placements: stateRef.current.placements,
      workPl:     stateRef.current.workPl,
      semOrders:  stateRef.current.semOrders,
    }];
    undoStack.current = undoStack.current.slice(0, -1);
    setPlacements(snap.placements);
    setWorkPl(snap.workPl);
    setSemOrders(snap.semOrders);
  };

  const doRedo = () => {
    if (!redoStack.current.length) return;
    const snap = redoStack.current[redoStack.current.length - 1];
    undoStack.current = [...undoStack.current, {
      placements: stateRef.current.placements,
      workPl:     stateRef.current.workPl,
      semOrders:  stateRef.current.semOrders,
    }];
    redoStack.current = redoStack.current.slice(0, -1);
    setPlacements(snap.placements);
    setWorkPl(snap.workPl);
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
  const placedIds     = useMemo(() => new Set(Object.keys(placements)), [placements]);

  const workStartMap = useMemo(() => {
    const m = {};
    Object.entries(workPl).forEach(([wid, semId]) => { m[semId] = wid; });
    return m;
  }, [workPl]);

  const workContMap = useMemo(() => {
    const m = {};
    Object.entries(workPl).forEach(([wid, semId]) => {
      const nxt = SEM_NEXT[semId];
      if (nxt) m[nxt] = wid;
    });
    return m;
  }, [workPl, SEM_NEXT]);

  const gradSemId = planGradSem === "fall" ? `fall${planGradYear}` : `spr${planGradYear}`;
  const coopGradConflicts = useMemo(() => WORK_TERMS.filter(w => {
    const startSem = workPl[w.id];
    if (!startSem) return false;
    return startSem === gradSemId || SEM_NEXT[startSem] === gradSemId;
  }), [workPl, gradSemId, SEM_NEXT]);

  const prereqViolations = useMemo(() => {
    const v = new Map();
    courses.forEach(c => {
      if (!placements[c.id]) return;
      if (placements[c.id] === "incoming") return;
      if (!c.prereqs?.length) return;
      const ti = SEM_INDEX[placements[c.id]];
      const result = evalPrereqTree(c.prereqs, placements, SEM_INDEX, ti);
      if (result !== "satisfied") v.set(c.id, result);
    });
    return v;
  }, [courses, placements, SEM_INDEX]);

  const coreqViolations = useMemo(() => {
    const v = new Map();
    allEdges.filter(e => e.type === "corequisite").forEach(({ from, to }) => {
      [{ placed: from, partner: to }, { placed: to, partner: from }].forEach(({ placed, partner }) => {
        if (!placements[placed]) return;
        if (placements[placed] === "incoming") return;
        if (!placements[partner]) {
          v.set(placed, "alone");
        } else if (placements[placed] !== placements[partner]) {
          if (v.get(placed) !== "alone") v.set(placed, "sep");
        }
      });
    });
    return v;
  }, [allEdges, placements]);

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
    () => bonusSH + courses.filter(c => placements[c.id]).reduce((s, c) => s + (effectiveCourseMap[c.id]?.sh ?? c.sh), 0),
    [bonusSH, courses, placements, effectiveCourseMap]
  );
  const totalSHDone = useMemo(
    () => bonusSH + courses.filter(c => {
      const sid = placements[c.id];
      return sid && (SEM_INDEX[sid] ?? 99) < currentSemIdx;
    }).reduce((s, c) => s + (effectiveCourseMap[c.id]?.sh ?? c.sh), 0),
    [bonusSH, courses, placements, SEM_INDEX, currentSemIdx, effectiveCourseMap]
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
  const onDragStart = (e, id, type, fromSem) => {
    e.stopPropagation();
    setDragInfo({ id, type, fromSem: fromSem ?? null });
    e.dataTransfer.effectAllowed = "move";
  };

  // Resolve the canonical co-op START semester from any of the 4 drop targets:
  //   spring  → start is spring   (continues into sumA)
  //   sumA    → start is spring   (the preceding semester)
  //   sumB    → start is sumB     (continues into fall)
  //   fall    → start is sumB     (the preceding semester)
  const coopStartFor = semId => {
    const sem = SEMESTERS.find(s => s.id === semId);
    if (!sem) return null;
    // Both sumA and sumB have type "summer" — discriminate by id prefix
    if (sem.type === "spring" || sem.id.startsWith("sumB")) return semId;
    // sumA or fall: the canonical start is the preceding semester
    const prev = SEM_PREV[semId];
    if (!prev) return null;
    const prevSem = SEMESTERS.find(s => s.id === prev);
    if (!prevSem) return null;
    if (prevSem.type === "spring" || prevSem.id.startsWith("sumB")) return prev;
    return null;
  };

  const canDropSem = semId => {
    if (!dragInfo) return false;
    if (dragInfo.type === "work") {
      const startId = coopStartFor(semId);
      if (!startId) return false;
      const contId = SEM_NEXT[startId];
      if (!contId) return false;
      // Reject if either semester in the block is already occupied by a different co-op
      const occupying = dragInfo.id; // the co-op being dragged — its own old slot is fine
      if (workStartMap[startId] && workStartMap[startId] !== occupying) return false;
      if (workContMap[contId]   && workContMap[contId]   !== occupying) return false;
      return true;
    }
    if (workStartMap[semId] || workContMap[semId]) return false;
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
    if (type === "work") {
      // Normalize the drop target to the canonical start of the co-op block
      const startId = coopStartFor(semId);
      if (!startId) { setDragInfo(null); return; }
      setWorkPl(p => {
        const n = { ...p };
        Object.keys(n).forEach(k => { if (k === id) delete n[k]; });
        n[id] = startId;
        return n;
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
    if (type === "work") {
      setWorkPl(p => { const n = { ...p }; delete n[id]; return n; });
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
      const cardEl = e.target.closest('[data-drag-id]');
      if (!cardEl) return;
      const id      = cardEl.dataset.dragId;
      const type    = cardEl.dataset.dragType;
      const fromSem = cardEl.dataset.dragFrom || null;
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

      touchDragIdRef.current = id;
      setDragInfo({ id, type, fromSem });
    };

    const onTouchMove = (e) => {
      if (!touchDragIdRef.current) return;
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
      if (!touchDragIdRef.current) return;
      const id = touchDragIdRef.current;
      const cardEl = cardRefs.current[id];
      if (cardEl) { cardEl.style.opacity = ''; cardEl.style.pointerEvents = ''; }
      removeGhost();
      document.documentElement.style.userSelect = '';
      document.documentElement.style.webkitUserSelect = '';
      const touch  = e.changedTouches[0];
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      const semEl  = target?.closest('[data-sem-id]');
      const bankEl = target?.closest('[data-drop-bank]');
      if (bankEl && onDropBankRef.current) {
        onDropBankRef.current({ preventDefault: () => {} });
      } else if (semEl && onDropRef.current) {
        onDropRef.current(null, semEl.dataset.semId);
      } else {
        setDragInfo(null);
      }
      touchDragIdRef.current = null;
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
    setWorkPl({});
    setSemOrders({});
    setOfferedOverrides({});
    setBonusSH(0);
    setMajor("");
    setConc("");
    setMinor1("");
    setMinor2("");
    // Reset cohort to defaults
    setPlanEntSem("fall");
    setPlanEntYear(DEFAULT_START_YEAR);
    setPlanGradSem("spring");
    setPlanGradYear(DEFAULT_START_YEAR + NUM_YEARS);
    // Also clear any per‑plan localStorage items for cohort (optional, but safe)
    try {
      localStorage.setItem("ncp-ent-sem", "fall");
      localStorage.setItem("ncp-ent-year", String(DEFAULT_START_YEAR));
      localStorage.setItem("ncp-grad-sem", "spring");
      localStorage.setItem("ncp-grad-year", String(DEFAULT_START_YEAR + NUM_YEARS));
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
    placements, workPl, semOrders, shOverrides, bonusSH, currentSemId,
    offeredOverrides, collapsedSubs,
    major, conc, minor1, minor2,
  });

  // Restore a plan data object into all state
  const restorePlan = (d) => {
    setPlacements(d.placements ?? {});
    setWorkPl(d.workPl ?? {});
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
  }, [placements, workPl, currentSemId, semOrders, offeredOverrides, shOverrides, bonusSH, major, conc, minor1, minor2, activePlanId]); // eslint-disable-line react-hooks/exhaustive-deps
  
  // ── Plan JSON export / import ────────────────────────────────
  const exportPlanJSON = () => {
    const data = {
      version: 1,
      exported: new Date().toISOString(),
      entSem: planEntSem, entYear: planEntYear,
      gradSem: planGradSem, gradYear: planGradYear,
      placements, workPl, semOrders, shOverrides, bonusSH, currentSemId,
      offeredOverrides, collapsedSubs,
      major, conc, minor1, minor2,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `numap-plan-${new Date().toISOString().slice(0, 10)}.json`;
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
        setWorkPl(d.workPl ?? {});
        setSemOrders(d.semOrders ?? {});
        setShOverrides(prev => d.shOverrides ?? prev);
        setOfferedOverrides(prev => d.offeredOverrides ?? prev);
        setCollapsedSubs(prev => d.collapsedSubs ?? prev);
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
      } catch (err) {
        alert("Could not read plan file: " + err.message);
      }
    };
    reader.readAsText(file);
  };

  // ── Cohort setters that also persist to localStorage ─────────
  // When stickyCourses is on, snapshot placements + SEMESTERS before changing
  const setEntSem = sem => {
    if (stickyCourses) stickySnapshotRef.current = { placements: { ...placements }, workPl: { ...workPl }, sems: [...SEMESTERS] };
    setPlanEntSem(sem);
    try { localStorage.setItem("ncp-ent-sem", sem); } catch {}
  };
  const setEntYear = year => {
    if (stickyCourses) stickySnapshotRef.current = { placements: { ...placements }, workPl: { ...workPl }, sems: [...SEMESTERS] };
    setPlanEntYear(year);
    try { localStorage.setItem("ncp-ent-year", year); } catch {}
  };
  const setGradSem = sem => {
    if (stickyCourses) stickySnapshotRef.current = { placements: { ...placements }, workPl: { ...workPl }, sems: [...SEMESTERS] };
    setPlanGradSem(sem);
    try { localStorage.setItem("ncp-grad-sem", sem); } catch {}
  };
  const setGradYear = year => {
    if (stickyCourses) stickySnapshotRef.current = { placements: { ...placements }, workPl: { ...workPl }, sems: [...SEMESTERS] };
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

    // Remap co-op placements
    if (snap.workPl) {
      const newWp = {};
      for (const [wid, semId] of Object.entries(snap.workPl)) {
        const idx = oldIds.indexOf(semId);
        if (idx !== -1 && idx < newIds.length) {
          newWp[wid] = newIds[idx];
        } else if (newIds.includes(semId)) {
          newWp[wid] = semId;
        }
        // If the semester no longer exists at all, drop the co-op placement
      }
      setWorkPl(newWp);
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
    placements, workPl, currentSemId, persistEnabled,
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
    stickyCourses, setStickyCourses,
    planEntSem, planEntYear, planGradSem, planGradYear, entOrd, gradOrd,
    panelHeight,
    isPhone, isMobile, uiScale, manualZoom, setManualZoom,
    // Derived
    currentSemIdx, placedIds, workStartMap, workContMap,
    gradSemId, coopGradConflicts,
    prereqViolations, coreqViolations, connectedIds,
    totalSHPlaced, totalSHDone, bonusSH, setBonusSH,
    major, setMajor, conc, setConc, minor1, setMinor1, minor2, setMinor2,
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
    setPlacements, setWorkPl, setSemOrders, setCurrentSemId,
    setEntSem, setEntYear, setGradSem, setGradYear,
    resetAll, exportPlanJSON, importPlanJSON,
    plans, activePlanId, switchPlan, createPlan, deletePlan, renamePlan,
    toggleStar, toggleOffered,
    getSemStatus,
    onDragStart, onDragOver, onDragLeave, onDrop, onDropBank, onDropOnCard,
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
