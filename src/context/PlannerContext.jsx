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
import { extractEdges } from "../core/courseModel.js";
import { evalPrereqTree } from "../core/prereqEval.js";
import { getSemSH, getOrderedCourses, getConnectionsToDepth, applySubstitutions, inTimeline } from "../core/planModel.js";
import { baseId, isInstanceId, takesUsed, resolveAddId, retakeUnlocked, buildTakesResolver } from "../core/repeatInstances.js";
import { takeConsumesSlot, yieldsCredit, satisfiesGate, enteredGPA, countsInGPA,
         effectiveGradeOfTakes } from "../core/gradeSystem.js";
import { resolveTermByDuration, termSpans } from "../core/specialTermUtils.js";
import { loadSaved, saveState } from "../data/persistence.js";
import { encodePlan, decodePlan, buildShareUrl, getHashPlanParam } from "../core/planShare.js";
import { useLanguage }     from "./LanguageContext.jsx";
import { usePort }         from "./InstitutionContext.jsx";
import { IInstitution }   from "../ports/IInstitution.js";
import { ICalendar }      from "../ports/ICalendar.js";
import { IClock }         from "../ports/IClock.js";
import { ICourseCatalog } from "../ports/ICourseCatalog.js";
import { ISpecialTerms }  from "../ports/ISpecialTerms.js";
import { IAIAssistant }   from "../ports/IAIAssistant.js";
// Shared pure dry-run — the same applier the MCP server validates with,
// reused here for the proposal ghost preview.
import { applyChangeset as dryRunChangeset } from "../adapters/mcp/plannerActionAdapter.js";

const PlannerContext = createContext(null);

// Two bars gate the Stats tab — see the "Stats tab gating" block below.
// MIN_* is the one-time unlock: what a plan must reach before the tab is ever
// offered. KEEP_* is the lower bar every plan is measured against afterwards,
// so the tab tracks whether the plan you're looking at right now has enough in
// it to chart (below ~two semesters of courses the panel says nothing), while
// nobody has to re-earn the unlock plan by plan.
// Only courses worth STATS_MIN_SH or more count: 1-SH labs and recitations
// ride along with their lecture (PHYS 1151 alone drags in a lab and a
// recitation), so counting them would let a science student clear the course
// bar with a third fewer real classes.
const STATS_MIN_COURSES  = 12;
const STATS_MIN_TERMS    = 3;
const STATS_KEEP_COURSES = 6;
const STATS_KEEP_TERMS   = 2;
const STATS_MIN_SH       = 3;

const EMPTY_GRADES = Object.freeze({});

export function PlannerProvider({ children }) {
  const { locale, setLocale, locales } = useLanguage();
  const institution    = usePort(IInstitution);
  const calendar       = usePort(ICalendar);
  const clock          = usePort(IClock);
  const courseCatalog  = usePort(ICourseCatalog);
  const specialTerms   = usePort(ISpecialTerms);
  const aiAssistant    = usePort(IAIAssistant);

  // ── Claude access (pairing + kill switch) ──────────────────────
  // DEFAULT OFF: no sync and no plan access until the user pairs — Claude
  // shows a code in the chat, the user enters it in the Claude panel.
  // Mirrors the adapter's persisted consent into React state so the UI
  // re-renders; claudeAccessRev re-arms the sync effect after (re)enabling
  // (the plan may have changed while access was off).
  const [claudePaired, setClaudePairedRaw] = useState(
    () => aiAssistant?.isPaired?.() ?? false
  );
  const [claudeAccessEnabled, setClaudeAccessEnabledRaw] = useState(
    () => aiAssistant?.isConsentEnabled?.() ?? false
  );
  const [claudeAccessRev, setClaudeAccessRev] = useState(0);
  const setClaudeAccess = (enabled) => {
    aiAssistant?.setConsent?.(enabled);
    setClaudeAccessEnabledRaw((aiAssistant?.isPaired?.() ?? false) && !!enabled);
    if (enabled) setClaudeAccessRev(r => r + 1);
  };
  /** Confirm the code from Claude's chat — the only way access turns on. */
  const confirmClaudePairing = async (code) => {
    const ok = await aiAssistant?.confirmPairing?.(code);
    if (ok) {
      setClaudePairedRaw(true);
      setClaudeAccessEnabledRaw(true);
      setClaudeAccessRev(r => r + 1);
    }
    return !!ok;
  };
  /** Sever the link — reconnecting requires a fresh code. */
  const claudeDisconnect = () => {
    aiAssistant?.disconnect?.();
    setClaudePairedRaw(false);
    setClaudeAccessEnabledRaw(false);
    setClaudeAutoApplyRaw(false);
  };
  // OAuth arrival: claude.ai bounced the user here with ?claude_connect=
  // <pendingId>. The user approves or denies IN THE APP; approval finishes
  // the grant and sends them back to Claude.
  const [claudeOAuthRequest, setClaudeOAuthRequest] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("claude_connect"); }
    catch { return null; }
  });
  const resolveClaudeOAuth = async (approved, { planAccess = true } = {}) => {
    const pendingId = claudeOAuthRequest;
    setClaudeOAuthRequest(null);
    try {
      const clean = new URL(window.location.href);
      clean.searchParams.delete("claude_connect");
      window.history.replaceState({}, "", clean);
    } catch {}
    if (!pendingId) return false;
    if (!approved) {
      // Send the user back to Claude with an access_denied error so the
      // client stops waiting instead of hanging on the callback.
      const denyTo = await aiAssistant?.denyOAuth?.(pendingId);
      if (denyTo) window.location.href = denyTo;
      return false;
    }
    const redirectTo = await aiAssistant?.completeOAuth?.(pendingId, { planAccess });
    if (redirectTo) {
      setClaudePairedRaw(true);
      setClaudeAccessEnabledRaw(planAccess);
      // Push the plan once, awaited, BEFORE leaving for Claude — otherwise
      // this OAuth path navigates away and the server would have no
      // snapshot, so Claude's first read would say "no plan synced".
      if (planAccess) await aiAssistant?.syncPlanNow?.(buildPlanContextRef.current());
      window.location.href = redirectTo;
      return true;
    }
    return false;
  };

  // Auto-apply is opt-in: while off (default), Claude may only propose
  // changes for review — apply_changes is rejected server-side.
  const [claudeAutoApply, setClaudeAutoApplyRaw] = useState(
    () => aiAssistant?.isAutoApplyEnabled?.() ?? false
  );
  const setClaudeAutoApply = (enabled) => {
    aiAssistant?.setAutoApply?.(enabled);
    setClaudeAutoApplyRaw(!!enabled);
  };
  const storagePrefix    = institution.storagePrefix;
  const key              = n => `${storagePrefix}-${n}`;
  const defaultStartYear = calendar.getDefaultStartYear();

  // ── API state ────────────────────────────────────────────────
  const [courses,  setCourses]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [loadErr,  setLoadErr]  = useState(null);
  const [loadPct,  setLoadPct]  = useState(5);

  // ── Derived from courses ─────────────────────────────────────
  const catalogCourseMap = useMemo(() => Object.fromEntries(courses.map(c => [c.id, c])), [courses]);
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
  const [isGraduated, setIsGraduated] = useState(() => { try { return localStorage.getItem(key("graduated")) === "true"; } catch { return false; } });
  // Plan-specific program selections (major path, concentration label, minor paths)
  const [major,       setMajor]          = useState("");
  const [conc,        setConc]           = useState("");
  // Second major's concentration. 51 undergraduate programs REQUIRE one
  // (BSBA among them), so a second major had no way to express a mandatory
  // choice until this existed.
  const [conc2,       setConc2]          = useState("");
  const [minor1,      setMinor1]         = useState("");
  const [minor2,      setMinor2]         = useState("");
  const [major2,      setMajor2]         = useState("");
  const [studentType, setStudentTypeRaw] = useState(() => {
    try { return localStorage.getItem(key("student-type")) || "undergrad"; } catch { return "undergrad"; }
  });
  const setStudentType = (type) => {
    setStudentTypeRaw(type);
    try { localStorage.setItem(key("student-type"), type); } catch {}
    setMajor("");
    setMajor2("");
    setConc(""); setConc2("");
  };
  // Set of course IDs that are placed out (satisfy prereqs, no credit)
  const [placedOut, setPlacedOut] = useState(() => {
    const saved = _saved?.persist && _saved.placedOut;
    return saved ? new Set(saved) : new Set();
  });

  // Grades: { placementInstanceId → "A"|"B+"|…|"F"|"S"|"U"|"I"|"W" }.
  // Entirely optional — an absent entry means "assumed to fulfil everything"
  // (see src/core/gradeSystem.js). Keyed by INSTANCE id so each take of a
  // retaken course carries its own grade. localStorage only: grades are
  // deliberately NOT in planShare's _KEYS allowlist and never reach share
  // links, QR codes, or MCP payloads.
  // RAW storage — the app consumes the filtered `grades` view derived
  // below (after SEM_INDEX), never this directly. Persistence saves raw.
  const [gradesRaw, setGrades] = useState(() => {
    const saved = _saved?.persist && _saved.grades;
    return saved && typeof saved === "object" ? saved : {};
  });

  // Substitutions: [{from: courseId, to: courseId}, ...]
  // When "from" is placed, "to" is also virtually placed for requirement checking.
  // Credits are only counted once (from the actual placed "from" course).
  const [substitutions, setSubstitutions] = useState(() => {
    const saved = _saved?.persist && _saved.substitutions;
    return Array.isArray(saved) ? saved : [];
  });

  // Proposals from Claude — a FIFO queue, reviewed oldest-first (later
  // changesets may assume earlier ones landed). Each entry carries a
  // placements fingerprint from arrival time so the review card can warn
  // when the plan has changed underneath the proposal.
  const [mcpProposals, setMcpProposals] = useState([]);

  // Ghost preview of the proposal under review: the full simulated plan
  // plus diff sets that drive the orange styling on changed elements.
  // null = no preview.
  const [claudePreview, setClaudePreview] = useState(null);

  // While a preview is active, ALL derivations below (credits, audits,
  // violation checks, work-term maps) compute from the simulated plan so
  // every surface renders the proposed world — placements on the grid,
  // programs in the grad panel, totals in the header. Real state vars keep
  // powering persistence, sync, and undo untouched.
  const pv              = claudePreview?.plan ?? null;
  const pvPlacements    = pv?.placements     ?? placements;
  const pvSpecialTerms  = pv?.workExperience ?? specialTermPl;
  const pvBonusSH       = pv?.bonusSH        ?? bonusSH;
  const pvSubstitutions = pv?.substitutions  ?? substitutions;
  const pvShOverrides   = pv?.shOverrides    ?? shOverrides;
  const pvPlacedOut     = useMemo(
    () => (pv ? new Set(pv.placedOut ?? []) : placedOut),
    [pv, placedOut]
  );

  // Repeat instances: a placement key "BASE#n" (an additional take of a
  // repeatable course — see src/core/repeatInstances.js) resolves to a clone
  // of its base course, so every id-keyed consumer (cards, drag, SH sums,
  // ordering, share links, undo) works without knowing about repeats. Clones
  // are materialized for real AND previewed placements so Claude previews of
  // extra takes render like everything else.
  const courseMap = useMemo(() => {
    let clones = null;
    const materialize = (id) => {
      if (catalogCourseMap[id] || !isInstanceId(id)) return;
      const base = catalogCourseMap[baseId(id)];
      if (base) (clones ??= {})[id] = { ...base, id, isRepeatInstance: true };
    };
    Object.keys(placements).forEach(materialize);
    Object.keys(pvPlacements).forEach(materialize);
    pvPlacedOut.forEach(materialize);
    return clones ? { ...catalogCourseMap, ...clones } : catalogCourseMap;
  }, [catalogCourseMap, placements, pvPlacements, pvPlacedOut]);

  // ── Sticky Courses ──
  const stickySnapshotRef = useRef(null);
  const [stickyCourses, setStickyCourses] = useState(() => {
    try { return localStorage.getItem(key("sticky-courses")) !== "false"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem(key("sticky-courses"), String(stickyCourses)); } catch {}
  }, [stickyCourses]);

  // ── UI: Other credits collapse setting ──
  const [collapseOtherCredits, setCollapseOtherCredits] = useState(() => {
    try { const v = localStorage.getItem(key("collapse-other-credits")); return v === null ? true : v !== "false"; } catch { return true; }
  });
  const updateCollapseOtherCredits = (val) => {
    setCollapseOtherCredits(val);
    try { localStorage.setItem(key("collapse-other-credits"), String(val)); } catch {}
  };

  // ── Privacy: hide grades ──
  // A presentation switch for showing the plan to someone else. OFF by
  // default (the feature is opt-in enough already), and deliberately NOT
  // part of the plan: it is per-device, so turning it on to share a screen
  // can never travel into a saved plan, a share link, or an export as a
  // silent setting someone later forgets is active.
  //
  // It hides — it never deletes. Entered grades stay in storage untouched
  // and reappear the moment it's switched off. What it suppresses is every
  // grade-DERIVED surface too (GPA, "! grade" badges, the void fade), so a
  // shoulder-surfer can't reconstruct a failure from its consequences.
  const [privateGrades, setPrivateGrades] = useState(() => {
    try { return localStorage.getItem(key("private-grades")) === "true"; } catch { return false; }
  });
  const updatePrivateGrades = (val) => {
    setPrivateGrades(val);
    try { localStorage.setItem(key("private-grades"), String(val)); } catch {}
  };

  // ── UI: Show logo on continuation rows ──
  const [showContLogo, setShowContLogo] = useState(() => {
    try { const v = localStorage.getItem(key("show-cont-logo")); return v === null ? true : v !== "false"; } catch { return true; }
  });
  const updateShowContLogo = (val) => {
    setShowContLogo(val);
    try { localStorage.setItem(key("show-cont-logo"), String(val)); } catch {}
  };

  // ── UI: Show "Unlocks" section in info panel ──
  const [showUnlocks, setShowUnlocks] = useState(() => {
    try { const v = localStorage.getItem(key("show-unlocks")); return v === "true"; } catch { return false; }
  });
  const updateShowUnlocks = (val) => {
    setShowUnlocks(val);
    try { localStorage.setItem(key("show-unlocks"), String(val)); } catch {}
  };

  // ── Semester tracking mode ──
  const [semTrackingMode, setSemTrackingModeRaw] = useState(() => {
    try { return localStorage.getItem(key("sem-tracking")) || "live"; } catch { return "live"; }
  });
  const updateSemTrackingMode = (mode) => {
    setSemTrackingModeRaw(mode);
    try { localStorage.setItem(key("sem-tracking"), mode); } catch {}
  };
  // Toast shown when auto mode advances the semester: null or label string
  const [semAdvanceToast, setSemAdvanceToast] = useState(null);
  // Dev/test override: when set, replaces clock.now() throughout tracking logic.
  // Set via DevClockPanel in development; always null in production builds.
  const [clockOverride, setClockOverride] = useState(null);
  const clockNow = () => clockOverride ?? clock.now();

  // effectiveCourseMap — moved below the active-grades view (which it
  // consumes and which needs SEM_INDEX/currentSemIdx first).

  // ── UI interaction state ──────────────────────────────────────
  const [selectedId,    setSelectedId]    = useState(null);
  const [dragInfo,      setDragInfo]      = useState(null);
  const [palette,       setPalette]       = useState(() => { try { return JSON.parse(localStorage.getItem(key("palette")) || "[]"); } catch { return []; } });
  const [showPalette,   setShowPalette]   = useState(() => { try { const v = localStorage.getItem(key("show-palette")); return v === null ? false : v !== "false"; } catch { return false; } });
  const [hoveredSem,    setHoveredSem]    = useState(null);
  const [hoveredZone,   setHoveredZone]   = useState(null);
  const [hoveredCardId, setHoveredCardId] = useState(null);
  const [showPanel,     setShowPanel]     = useState(false);
  const [lines,         setLines]         = useState([]);
  const [scrollTick,    setScrollTick]    = useState(0);
  const [showViolLines, setShowViolLines] = useState(true);
  // Prereq-tree depth: how many hops the selection highlight expands, capped
  // independently upstream (prerequisites) and downstream (dependents).
  // Infinity = follow the whole chain. See getConnectionsToDepth.
  // NOTE: the depth UI (Header settings + Stats "Trace on grid") is currently
  // hidden — the multi-hop tree read as confusing — so these stay at 1, which
  // makes connectionEdges reproduce the original 1-degree behaviour exactly.
  // To bring the feature back: default these to Infinity and un-hide the two
  // `{false && …}` blocks in Header.jsx and StatsPanel.jsx.
  const [prereqDepth,   setPrereqDepth]   = useState(1); // upstream hops
  const [unlockDepth,   setUnlockDepth]   = useState(1); // downstream hops

  // ── Bank state ───────────────────────────────────────────────
  const [bankSearch,      setBankSearch]      = useState("");
  const [bankSort,        setBankSort]        = useState("az");
  const [bankTab,         setBankTab]         = useState("all");
  // Search facet filters. Multi-valued facets AND within a category
  // (terms/nupath); single-valued facets match by membership (level).
  //   terms   — ["fall","spring","summer"]  (summer = sumA || sumB)
  //   level   — ["undergrad","grad"]        (course is one level → OR/membership)
  //   nupath  — NUPath attribute codes      (["FQ","ND",...])
  //   profs    — selected instructor-name tags (OR: taught by any of them)
  //   programReq  — counts as a required course in a selected program
  //   programElec — counts as an elective/choose-from option in one
  const [bankFilters,     setBankFilters]     = useState({ terms: [], level: [], nupath: [], profs: [], programReq: false, programElec: false });
  const [bankWidth,       setBankWidth]       = useState(() => window.innerWidth < 600 ? 88 : Math.min(300, Math.max(200, window.innerWidth * 0.21)));
  const [showSubjectKeys, setShowSubjectKeys] = useState(false);
  const [wideCatalog, setWideCatalog] = useState(() => { try { const v = localStorage.getItem("wide-catalog"); return v === "true"; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem("wide-catalog", String(wideCatalog)); } catch {} }, [wideCatalog]); // eslint-disable-line react-hooks/exhaustive-deps
  const [wideWidth, setWideWidth] = useState(() => { try { const v = localStorage.getItem("wide-catalog-width"); return v ? Number(v) : null; } catch { return null; } });
  useEffect(() => { try { if (wideWidth !== null) localStorage.setItem("wide-catalog-width", String(Math.round(wideWidth))); } catch {} }, [wideWidth]); // eslint-disable-line react-hooks/exhaustive-deps
  const [starredIds,      setStarredIds]      = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(key("starred")) || "[]")); } catch { return new Set(); }
  });

  // ── Settings / modal state ───────────────────────────────────
  const [showDisclaimer,   setShowDisclaimer]   = useState(false);
  const [showStats,        setShowStats]        = useState(false);
  // Donate modal. Never auto-opens — only the header ♥ pill or the About
  // modal's /donate button set it, so the app never asks for money unprompted.
  const [showDonate,       setShowDonate]       = useState(false);
  const [showNewPlanModal,    setShowNewPlanModal]    = useState(false);
  const [newPlanInitialType,  setNewPlanInitialType]  = useState(null);
  const [showCohortSetup,  setShowCohortSetup]  = useState(() => {
    // Pure read — the "seen" flag is written on completion (finishOnboarding),
    // not here, so a reload mid-setup re-shows it rather than stranding the user.
    // Append ?onboarding to the URL to force it during development.
    try {
      if (new URLSearchParams(window.location.search).has("onboarding")) return true;
      return !localStorage.getItem(key("seen-cohort-setup"));
    } catch { return false; }
  });
  const [showTour, setShowTour] = useState(false);
  // Default entry/grad sem: first and last non-optional semester types
  const _primarySems = calendar.getSemesterTypes().filter(t => !t.optional);
  const _defEntSem   = _primarySems[0]?.id           ?? "fall";
  const _defGradSem  = _primarySems.at?.(-1)?.id     ?? _defEntSem;
  const [planEntSem,   setPlanEntSem]   = useState(() => { try { return localStorage.getItem(key("ent-sem"))  || _defEntSem;  } catch { return _defEntSem;  } });
  const [planEntYear,  setPlanEntYear]  = useState(() => { try { return parseInt(localStorage.getItem(key("ent-year"))  || String(defaultStartYear), 10) || defaultStartYear; } catch { return defaultStartYear; } });
  const [planGradSem,  setPlanGradSem]  = useState(() => { try { return localStorage.getItem(key("grad-sem")) || _defGradSem; } catch { return _defGradSem; } });
  const [planGradYear, setPlanGradYear] = useState(() => { try { return parseInt(localStorage.getItem(key("grad-year")) || String(defaultStartYear + NUM_YEARS), 10) || defaultStartYear + NUM_YEARS; } catch { return defaultStartYear + NUM_YEARS; } });
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
  // false = panel hugs its content (default, no dead space below); true =
  // the user dragged the handle, so panelHeight is an explicit height that
  // may stretch past the content.
  const [panelHeightManual, setPanelHeightManual] = useState(false);
  const [manualZoom, setManualZoomRaw] = useState(() => {
    try {
      const stored = localStorage.getItem(key("zoom"));
      if (stored !== null) { const v = parseFloat(stored); return isNaN(v) ? null : v; }
      return window.innerWidth < PHONE_BP ? null : 1.25;
    } catch { return window.innerWidth < PHONE_BP ? null : 1.25; }
  });
  const setManualZoom = v => {
    setManualZoomRaw(v);
    try { if (v == null) localStorage.removeItem(key("zoom")); else localStorage.setItem(key("zoom"), String(v)); } catch {}
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

  // When graduated and the live semester has drifted past the plan boundary, treat it as
  // one past the last plan semester so all plan semesters render as completed.
  // (Lives here, not with the other derived plan state below: the active-
  // grades view needs it before takesOf/effectiveCourseMap are derived.)
  const currentSemIdx = SEM_INDEX[pv?.currentSemId ?? currentSemId] ?? (isGraduated ? SEMESTERS.length : 1);
  const _gradSemType = calendar.getSemesterTypes().find(t => t.id === planGradSem);
  const gradSemId    = `${_gradSemType?.idPrefix ?? _gradSemType?.id ?? planGradSem}${planGradYear}`;

  // ── The ACTIVE grade view ─────────────────────────────────────
  // Raw entries (gradesRaw) are STORAGE — they persist untouched. What the
  // rest of the app consumes is this filtered view: only takes that are
  // placed out (transfer) or sit in a COMPLETED semester. Grades are facts
  // about the past; when the user moves "Now in" backward, the affected
  // grades simply stop applying — and return, intact, when it moves forward
  // again. The previous design DELETED them on status change: silent data
  // loss for what should be a reversible act. An invisible grade must never
  // steer the evaluation, but hidden ≠ destroyed.
  const grades = useMemo(() => {
    // Private mode short-circuits here, at the single point every grade
    // consumer reads from — so the GPA block, the badges, the void fade,
    // the retake unlock and the exports all go quiet together, with no
    // per-surface opt-in to forget. Storage (gradesRaw) is untouched.
    if (privateGrades) return EMPTY_GRADES;
    const keys = Object.keys(gradesRaw);
    if (!keys.length) return gradesRaw;
    const out = {};
    for (const pid of keys) {
      if (placedOut.has(pid)) { out[pid] = gradesRaw[pid]; continue; }
      const sid = placements[pid];
      if (sid === undefined) continue;                    // no longer placed
      const idx = SEM_INDEX[sid];
      if (idx === undefined) continue;                    // parked off-timeline
      if (idx < currentSemIdx || (isGraduated && sid === gradSemId)) out[pid] = gradesRaw[pid];
    }
    return out;
  }, [privateGrades, gradesRaw, placements, placedOut, SEM_INDEX, currentSemIdx, isGraduated, gradSemId]);

  // The plan's GPA from ENTERED letter grades — computed ONCE here so every
  // consumer (the graduation panel's readout, co-op eligibility, per-course
  // GPA gates) reads the same number. null while nothing is graded, which is
  // what keeps every GPA-derived warning silent by default.
  // { gpa, n, counted:[{base,grade,credits}] } | null
  const enteredGpaStat = useMemo(() => {
    if (!Object.keys(grades).length) return null;
    const seen = new Set(), entries = [];
    const consider = (pid, inTL) => {
      if (!inTL) return;
      const base = baseId(pid);
      if (seen.has(base)) return;
      seen.add(base);
      const takes = [];
      for (const [p2, sid] of Object.entries(placements)) {
        if (baseId(p2) !== base) continue;
        const fi = SEM_INDEX[sid];
        if (fi !== undefined) takes.push({ fi, grade: grades[p2] ?? null });
      }
      for (const p2 of placedOut) if (baseId(p2) === base) takes.push({ fi: "out", grade: grades[p2] ?? null });
      const g = takes.length ? effectiveGradeOfTakes(takes) : null;
      if (g != null) entries.push({ base, grade: g, credits: courseMap[base]?.sh ?? 4 });
    };
    for (const [pid, sid] of Object.entries(placements)) consider(pid, SEM_INDEX[sid] !== undefined);
    for (const pid of placedOut) consider(pid, true);
    const gpa = enteredGPA(entries);
    if (gpa == null) return null;
    // "from N graded" must mean N courses that actually moved the number.
    // A graded 0-credit recitation contributes no quality points, so
    // including it overstates the basis the figure rests on.
    const counted = entries.filter(e => countsInGPA(e.grade) && (e.credits ?? 0) > 0);
    return { gpa, counted, n: counted.length };
  }, [grades, placements, placedOut, courseMap, SEM_INDEX]);

  // effectiveCourseMap — same as courseMap but with per-plan sh overrides
  // applied, and with GRADE consequences folded in: a take whose entered
  // grade earns no credit (F/U/W/X — takeConsumesSlot) carries sh: 0 here.
  //
  // This is the choke point that makes grades flow downstream AUTOMATICALLY:
  // every credit summation in the app (semester chips, totals, stats,
  // export, general electives) multiplies placements × this map's sh, so
  // one zeroed entry fixes all of them — including consumers not written
  // yet. Patching summers one by one is how the per-semester chip was
  // missed. An I keeps its sh (resolves in place; assumed pass) — only
  // the EARNED views (totalSHDone/doneSet) exclude it, via yieldsCredit.
  // shVoided marks the zeroing for any UI that wants to explain it.
  const effectiveCourseMap = useMemo(() => {
    if (!Object.keys(pvShOverrides).length && !Object.keys(grades).length) return courseMap;
    const out = Object.fromEntries(
      Object.entries(courseMap).map(([id, c]) => {
        const ov = pvShOverrides[id];
        if (ov == null || !c.shMax) return [id, c];
        // Preserve the data-minimum as shMin so the edit UI knows the valid range.
        return [id, { ...c, sh: ov, shMin: c.shMin ?? c.sh }];
      })
    );
    for (const [pid, g] of Object.entries(grades)) {
      if (takeConsumesSlot(g)) continue;
      const c = out[pid];
      if (c) out[pid] = { ...c, sh: 0, shVoided: true };
    }
    return out;
  }, [courseMap, pvShOverrides, grades]);

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
  const stateRef      = useRef({ placements: {}, specialTermPl: {}, semOrders: {}, placedOut: new Set() });
  const buildPlanContextRef = useRef(() => ({})); // sync-payload builder, refreshed each render
  const selectedIdRef = useRef(null);
  const allEdgesRef   = useRef([]);
  const onDropRef      = useRef(null);   // updated each render for touch drag
  const onDropBankRef   = useRef(null);   // updated each render for touch drag → bank
  const touchDragIdRef  = useRef(null);  // card id currently being touch-dragged
  const touchDragElRef  = useRef(null);  // actual DOM element being touch-dragged (works for null-id templates)
  const ghostRef        = useRef(null);  // floating ghost element during touch drag
  const touchStartOff   = useRef({ x: 0, y: 0 }); // finger offset within card
  const isFirstRender = useRef(true);
  // The plan id the live state currently describes. Used to tell "loading
  // the plan we were already showing" (state-v2 is a valid source for
  // anything the slot omits) from "the user switched plans" (the slot is
  // the only truth). Keyed on the ID rather than a first-run flag because
  // StrictMode double-invokes effects in dev: a one-shot flag flips on the
  // first pass and the second pass then takes the wrong branch — which is
  // exactly how the wipe survived its first fix. See restorePlan.
  const restoredPlanId = useRef(null);
  const touchDragFromRef    = useRef(null);
  const touchDragTypeRef    = useRef(null);
  const touchDragTypeIdRef  = useRef(null);
  const touchDragStartedRef = useRef(false); // true once finger moves past drag threshold
  const touchStartPos       = useRef({ x: 0, y: 0 }); // raw finger position at touchstart
  const onDropPlacedOutRef  = useRef(null);
  const onDropPaletteRef    = useRef(null);

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
    saveState(storagePrefix, persistEnabled, { placements, specialTermPl, currentSemId, collapsedSubs, semOrders, offeredOverrides, shOverrides, bonusSH, placedOut: [...placedOut], substitutions, grades: gradesRaw, planId: activePlanId });
  }, [persistEnabled, placements, specialTermPl, currentSemId, collapsedSubs, semOrders, offeredOverrides, shOverrides, bonusSH, substitutions, gradesRaw]);

  useEffect(() => {
    try { localStorage.setItem(key("graduated"), String(isGraduated)); } catch {}
  }, [isGraduated]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try { localStorage.setItem(key("palette"), JSON.stringify(palette)); } catch {}
  }, [palette]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    try { localStorage.setItem(key("show-palette"), String(showPalette)); } catch {}
  }, [showPalette]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // NOTE the storagePrefix: this call was missing it, so saveState read
    // (prefix=persistEnabled, persist=<the data object>, obj=undefined) and
    // wrote {"persist":true} to a junk key on every unload. The last-moment
    // safety net has never actually saved anything.
    const h = () => {
      saveState(storagePrefix, persistEnabled, { placements, specialTermPl, currentSemId, collapsedSubs, semOrders, offeredOverrides, shOverrides, bonusSH, placedOut: [...placedOut], substitutions, grades: gradesRaw, planId: activePlanId });
      // The SLOT is what the app reloads from, so it needs the same net.
      saveCurrentPlanToSlot();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [persistEnabled, placements, specialTermPl, currentSemId, collapsedSubs, semOrders, offeredOverrides, shOverrides, bonusSH, gradesRaw]);

  // ── Effect: semester tracking (live) ─────────────────────────
  // Runs on mount and whenever the tracking mode, plan semesters, or clock changes.
  // 'live' → compute semId from today's date; show a toast if it differs from stored.
  useEffect(() => {
    if (semTrackingMode !== "live") return;
    const computed = calendar.getCurrentSemId(clockNow());
    if (computed && computed !== currentSemId) {
      setCurrentSemId(computed);
      setSemAdvanceToast(computed); // store semId — Header renders it the same way as the planner row
    }
  }, [semTrackingMode, SEMESTERS, clockOverride]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effects: UI resize ───────────────────────────────────────
  useEffect(() => {
    const update = () => { setAutoScale(computeUiScale(window.innerWidth)); setIsPhone(window.innerWidth < PHONE_BP); setIsMobile(window.innerWidth < MOBILE_BP); };
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect: stale-closure ref sync ───────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    stateRef.current    = { placements, specialTermPl, semOrders, placedOut, grades: gradesRaw };
    allEdgesRef.current = allEdges;
    onDropRef.current          = onDrop;
    onDropBankRef.current      = onDropBank;
    onDropPlacedOutRef.current = onDropPlacedOut;
    onDropPaletteRef.current   = onDropPalette;
  });
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  // ── Effects: panel drag-resize (mouse + touch) ─────────────
  useEffect(() => {
    const onMove = e => {
      if (!panelResizing.current) return;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const dy = panelResizing.current.startY - clientY;
      setPanelHeight(Math.min(520, Math.max(90, panelResizing.current.startH + dy)));
      // A manual drag switches the panel from content-hugging (the default)
      // to an explicit height, so pulling UP can stretch past the content.
      setPanelHeightManual(true);
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
    setCurrentSemId(cur => {
      if (sems.find(s => s.id === cur)) return cur; // within plan, keep as-is
      // cur is outside the plan — determine whether it's past graduation (allowed, auto-grad
      // handles it) or before plan start (snap forward).
      const TYPE_ORD = { spring: 0, sumA: 1, sumB: 2, fall: 3 };
      const semOrd = id => { const m = id?.match(/^([a-zA-Z]+)(\d{4})$/); return m ? parseInt(m[2], 10) * 10 + (TYPE_ORD[m[1]] ?? 0) : null; };
      const lastSem = sems[sems.length - 1];
      if (lastSem && semOrd(cur) !== null && semOrd(cur) >= semOrd(lastSem.id)) return cur;
      return sems[1]?.id ?? sems[0]?.id;
    });
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
  const effectivePlacements = useMemo(
    () => applySubstitutions(pvPlacements, pvSubstitutions),
    [pvPlacements, pvSubstitutions]
  );

  // takesOf: base course id → every take of it in the plan, with semester
  // index and entered grade — the resolver evalPrereqTree uses for grade-
  // and retake-aware evaluation. Built over effectivePlacements so
  // substitution-virtual placements keep satisfying prereqs (they carry no
  // grade → assumed). NULL while no grades are entered, so the legacy
  // evaluator path runs bit-for-bit and the default experience cannot
  // change. The construction rules (and why "incoming" must be included)
  // live with the pure builder in gradeSystem.js, where they are testable.
  const takesOf = useMemo(
    () => buildTakesResolver(effectivePlacements, pvPlacedOut, grades, SEM_INDEX),
    [grades, effectivePlacements, pvPlacedOut, SEM_INDEX]
  );

  // Edges of the selected course's prereq tree, expanded to the configured
  // depth (prereqDepth upstream / unlockDepth downstream) over placed courses
  // only — the grid can't draw a line to a card that isn't there, and hopping
  // through an unplaced course would bridge two courses that aren't actually
  // adjacent on the board. Shared by the highlight (connectedIds) and the SVG
  // lines effect; edges are the same objects as allEdges so identity holds.
  const connectionEdges = useMemo(() => {
    if (!selectedId) return [];
    // Edges are keyed by BASE course ids; repeat instances ("BASE#n") have
    // none of their own. A course counts as on-the-board when ANY of its
    // takes is placed; remember one concrete take per base so lines can
    // anchor to a real card.
    const takeOf = {};
    for (const [pid, sid] of Object.entries(placements)) {
      if (sid === "incoming") continue;
      takeOf[baseId(pid)] ??= pid;
    }
    const placedEdges = allEdges.filter(e => takeOf[e.from] && takeOf[e.to]);
    const selBase = baseId(selectedId);
    const edges = getConnectionsToDepth(selBase, placedEdges, prereqDepth, unlockDepth);
    // Re-anchor endpoints onto concrete cards — the take the user actually
    // clicked, and for other courses whose plain id isn't placed, the take
    // that is. Untouched edges keep their allEdges identity (the SVG-lines
    // effect de-dups against it).
    const anchor = (id) =>
      id === selBase ? selectedId
      : (placements[id] && placements[id] !== "incoming") ? id
      : takeOf[id];
    return edges.map(e => {
      const f = anchor(e.from), t = anchor(e.to);
      return f === e.from && t === e.to ? e : { ...e, from: f, to: t };
    });
  }, [selectedId, allEdges, placements, prereqDepth, unlockDepth]);

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
        connectionEdges.forEach(rel => {
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
            // concurrent prereq: same-semester is valid, only flag if strictly after
            if (fromIdx > toIdx || (fromIdx === toIdx && !rel.concurrent)) type = "prerequisite-order";
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
        const drawn = new Set(connectionEdges); // edges the selection block already drew
        allEdges.forEach(rel => {
          // skip edges already drawn by selection logic above
          if (drawn.has(rel)) return;
          if (!placements[rel.from] || !placements[rel.to]) return;
          // Disable prereq/error lines for courses in 'incoming' semester
          if (placements[rel.from] === "incoming" || placements[rel.to] === "incoming") return;
          if (rel.type === "prerequisite") {
            // Only draw a red line if the prereq predicate is unsatisfied due to order
            const toCourse = courseMap[rel.to];
            if (!toCourse || !toCourse.prereqs?.length) return;
            const ti = SEM_INDEX[placements[rel.to]];
            const prereqResult = evalPrereqTree(toCourse.prereqs, effectivePlacements, SEM_INDEX, ti, pvPlacedOut);

            // Grade-blocked: placement satisfied, but an entered grade vetoes
            // the tree. Draw a dotted red from every take of this prereq whose
            // ENTERED grade fails this edge's gate — the line disappears when
            // the grade is cleared or a satisfying retake is placed (the
            // grade-aware result flips back to satisfied). Dead until a grade
            // exists: takesOf is null with none entered.
            if (prereqResult === "satisfied" && takesOf &&
                evalPrereqTree(toCourse.prereqs, effectivePlacements, SEM_INDEX, ti, pvPlacedOut, takesOf) !== "satisfied") {
              for (const [pid, sid] of Object.entries(placements)) {
                if (baseId(pid) !== rel.from) continue;
                if (SEM_INDEX[sid] === undefined || sid === "incoming") continue;
                const g = grades[pid];
                if (g == null || satisfiesGate(g, rel.minGrade)) continue;
                const fp = getCenter(pid);
                const tp = getCenter(rel.to);
                if (fp && tp) newLines.push({ from: pid, to: rel.to, type: "prerequisite-grade", fp, tp });
              }
              return;
            }

            if (prereqResult !== "order") return; // Only draw if unsatisfied due to order
            // Now, check if THIS edge is the one out of order
            const fromIdx = SEM_INDEX[placements[rel.from]] ?? -1;
            if (fromIdx < ti) return; // This edge is not the one out of order
            if (fromIdx === ti && rel.concurrent) return; // same-sem OK for concurrent prereqs
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
  }, [selectedId, connectionEdges, showViolLines, placements, effectivePlacements, substitutions, specialTermPl, scrollTick, allEdges, SEM_INDEX, pvPlacedOut, takesOf, grades]);

  // ── MCP action applier ───────────────────────────────────────────
  // Applies a batch of IPlannerAction actions dispatched by Claude via APPLY events.
  // Mutates all affected state slices in a single React batch.
  function applyMCPActions(actions) {
    // Accumulate all mutations before committing to state.
    // Read current values from stateRef (stale-closure-safe).
    let newPl   = { ...stateRef.current.placements };
    let newStp  = { ...stateRef.current.specialTermPl };
    let newOrd  = { ...stateRef.current.semOrders };

    // These can't be batched from a snapshot, so we build final state from
    // the functional-update form and commit once per action group.
    const poAdds = [], poDels = [], subAdds = [], subDels = [];
    const starAdds = [], starDels = [], palAdds = [], palDels = [];
    const programUpdates = {};
    const shOvUpdates = {};
    const ooUpdates = {};

    // Live placed-out view for repeat-limit checks — evolves with the batch
    // so instance-id assignment stays byte-identical to the MCP-side dry run
    // (plannerActionAdapter mutates its plan.placedOut the same way).
    const poLive = new Set(stateRef.current.placedOut);

    for (const action of actions) {
      switch (action.type) {
        case "ADD_COURSE": {
          // Repeatable + already placed → this ADD is another take under a
          // fresh instance id (same resolveAddId as the MCP-side validator,
          // so both sides assign identical ids). Non-repeatable keeps the
          // documented relocate-on-add semantics. Over-limit takes are
          // allowed (trust the user) and flagged by the UI.
          const course = courseMap[action.courseId];
          const addId = course ? resolveAddId(course, newPl, poLive).id : action.courseId;
          newPl[addId] = action.semId;
          poDels.push(addId); poLive.delete(addId);
          palDels.push(addId); // placing removes from the scratch pad, like drag-drop
          break;
        }
        case "REMOVE_COURSE":
          delete newPl[action.courseId];
          break;
        case "MOVE_COURSE":
          newPl[action.courseId] = action.toSemId;
          break;
        case "ADD_PLACED_OUT":
          poAdds.push(action.courseId); poLive.add(action.courseId);
          delete newPl[action.courseId];
          break;
        case "REMOVE_PLACED_OUT":
          poDels.push(action.courseId); poLive.delete(action.courseId);
          break;
        case "ADD_SUBSTITUTION":
          subAdds.push({ from: action.fromId, to: action.toId });
          break;
        case "REMOVE_SUBSTITUTION":
          subDels.push({ from: action.fromId, to: action.toId });
          break;
        case "ADD_WORK_TERM": {
          const id = `wt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          newStp[id] = { typeId: action.typeId, semId: action.semId, duration: action.duration,
            ...(action.company       != null && { company:       action.company }),
            ...(action.companyDomain != null && { companyDomain: action.companyDomain }),
            ...(action.subline       != null && { subline:       action.subline }),
          };
          break;
        }
        case "REMOVE_WORK_TERM":
          delete newStp[action.instanceId];
          break;
        case "MOVE_WORK_TERM":
          if (newStp[action.instanceId]) newStp[action.instanceId] = { ...newStp[action.instanceId], semId: action.toSemId };
          break;
        case "UPDATE_WORK_TERM":
          if (newStp[action.instanceId]) {
            const cur = { ...newStp[action.instanceId] };
            if (action.company       != null) cur.company       = action.company;
            if (action.companyDomain != null) cur.companyDomain = action.companyDomain;
            if (action.subline       != null) cur.subline       = action.subline;
            newStp[action.instanceId] = cur;
          }
          break;
        case "SET_MAJOR":         programUpdates.major  = action.programId; break;
        case "SET_MAJOR2":        programUpdates.major2 = action.programId; break;
        case "SET_STUDENT_TYPE":  programUpdates.studentType = action.studentType; break;
        case "STAR_COURSE":         starAdds.push(action.courseId); break;
        case "UNSTAR_COURSE":       starDels.push(action.courseId); break;
        case "ADD_TO_PALETTE":      palAdds.push(action.courseId); break;
        case "REMOVE_FROM_PALETTE": palDels.push(action.courseId); break;
        case "SET_CONCENTRATION": programUpdates.conc   = action.label;     break;
        case "SET_MINOR1":        programUpdates.minor1 = action.programId; break;
        case "SET_MINOR2":        programUpdates.minor2 = action.programId; break;
        case "SET_BONUS_SH":      programUpdates.bonusSH = action.amount;   break;
        case "SET_SH_OVERRIDE":
          shOvUpdates[action.courseId] = action.value; // null = clear
          break;
        case "SET_OFFERED_OVERRIDE":
          ooUpdates[action.courseId] ??= {};
          ooUpdates[action.courseId][action.semTypeId] = action.status; // null = clear
          break;
        case "SET_ENTRY":
          programUpdates.entSem  = action.sem;
          programUpdates.entYear = action.year;
          break;
        case "SET_GRADUATION":
          programUpdates.gradSem  = action.sem;
          programUpdates.gradYear = action.year;
          break;
        case "SET_CURRENT_SEM":
          programUpdates.currentSemId = action.semId;
          break;
        case "CREATE_PLAN":    createPlan(action.name, action.cohort ?? null);      break;
        case "RENAME_PLAN":    renamePlan(action.planId, action.name);             break;
        case "SWITCH_PLAN":    switchPlan(action.planId);                          break;
        case "DELETE_PLAN":    deletePlan(action.planId);                          break;
      }
    }

    // Commit placements + work experience + sem orders
    setPlacements(newPl);
    setSpecialTermPl(newStp);

    // Claude-originated applies must NOT trip the staleness warning on the
    // rest of the queue — that warning exists for USER edits made since
    // Claude reasoned about the plan. Refresh remaining fingerprints to
    // the post-apply placements.
    setMcpProposals(prev => prev.length
      ? prev.map(p => ({ ...p, fingerprint: JSON.stringify(newPl) }))
      : prev);

    // Commit placed-out changes
    if (poAdds.length || poDels.length) {
      setPlacedOut(prev => {
        const next = new Set(prev);
        poAdds.forEach(id => next.add(id));
        poDels.forEach(id => next.delete(id));
        return next;
      });
    }

    // Commit substitution changes
    if (subAdds.length || subDels.length) {
      setSubstitutions(prev => {
        let next = [...prev];
        for (const { from, to } of subAdds) {
          if (!next.some(s => s.from === from && s.to === to)) next.push({ from, to });
        }
        for (const { from, to } of subDels) {
          next = next.filter(s => !(s.from === from && s.to === to));
        }
        return next;
      });
    }

    // Commit program / timeline updates. Student type MUST commit first:
    // setStudentType clears major/major2/conc (switching program trees), so
    // running it after the program setters would wipe what the changeset
    // just set (e.g. "switch to grad + set AI MS + ML concentration").
    if ("studentType"   in programUpdates) setStudentType(programUpdates.studentType);
    if ("major"         in programUpdates) setMajor(programUpdates.major);
    if ("major2"        in programUpdates) setMajor2(programUpdates.major2);
    if ("conc"          in programUpdates) setConc(programUpdates.conc);
    if ("conc2"         in programUpdates) setConc2(programUpdates.conc2);
    if ("minor1"        in programUpdates) setMinor1(programUpdates.minor1);
    if ("minor2"        in programUpdates) setMinor2(programUpdates.minor2);
    if ("bonusSH"       in programUpdates) setBonusSH(programUpdates.bonusSH);
    if ("currentSemId"  in programUpdates) setCurrentSemId(programUpdates.currentSemId);
    if ("entSem"        in programUpdates) setEntSem(programUpdates.entSem);
    if ("entYear"       in programUpdates) setEntYear(programUpdates.entYear);
    if ("gradSem"       in programUpdates) setGradSem(programUpdates.gradSem);
    if ("gradYear"      in programUpdates) setGradYear(programUpdates.gradYear);

    // Commit SH overrides
    if (Object.keys(shOvUpdates).length) {
      setShOverrides(prev => {
        const next = { ...prev };
        for (const [id, val] of Object.entries(shOvUpdates)) {
          if (val == null) delete next[id]; else next[id] = val;
        }
        return next;
      });
    }

    // Commit offering overrides
    if (Object.keys(ooUpdates).length) {
      setOfferedOverrides(prev => {
        const next = { ...prev };
        for (const [cid, semMap] of Object.entries(ooUpdates)) {
          const cur = { ...(next[cid] ?? {}) };
          for (const [semTypeId, status] of Object.entries(semMap)) {
            if (status == null) delete cur[semTypeId]; else cur[semTypeId] = status;
          }
          if (Object.keys(cur).length === 0) delete next[cid]; else next[cid] = cur;
        }
        return next;
      });
    }

    // Commit star changes (persisted like toggleStar)
    if (starAdds.length || starDels.length) {
      setStarredIds(prev => {
        const next = new Set(prev);
        starAdds.forEach(id => next.add(id));
        starDels.forEach(id => next.delete(id));
        try { localStorage.setItem(key("starred"), JSON.stringify([...next])); } catch {}
        return next;
      });
    }

    // Commit scratch-pad (palette) changes — placed courses can't be added
    if (palAdds.length || palDels.length) {
      setPalette(prev => {
        let next = prev.filter(id => !palDels.includes(id));
        for (const id of palAdds) {
          if (!next.includes(id) && newPl[id] === undefined) next.push(id);
        }
        return next;
      });
    }
  }

  function executeMCPCommand(cmd) {
    if (!cmd?.type) return;
    switch (cmd.type) {
      case "FOCUS_COURSE":
        setSelectedId(cmd.courseId ?? null);
        if (cmd.courseId) setShowPanel(true);
        break;
      case "OPEN_SEARCH":
        setBankSearch(cmd.query ?? "");
        setBankTab("all");
        break;
      case "SET_BANK_TAB":
        if (["all", "placed", "starred"].includes(cmd.tab)) setBankTab(cmd.tab);
        break;
      case "EXPORT_JSON":
        exportPlanJSON();
        break;
      case "COPY_SHARE_LINK":
        copyPlanLink(locale).catch(() => {});
        break;
      case "EXPORT_PDF":
        // The PDF assembly lives in Header (it composes grad info from the
        // panel); a DOM event keeps this handler UI-agnostic.
        window.dispatchEvent(new CustomEvent("numap:export-pdf"));
        break;
      // Unknown command types are ignored (additive-only registry).
    }
  }

  // ── Undo / redo ───────────────────────────────────────────────
  // Grades ride the undo snapshots: removing a graded course prunes its
  // grade (the cleanup effect), so an undo that restores the placement
  // must restore the grade with it — otherwise undo silently loses data.
  const pushUndo = () => {
    const snap = {
      placements:    stateRef.current.placements,
      specialTermPl: stateRef.current.specialTermPl,
      semOrders:     stateRef.current.semOrders,
      grades:        stateRef.current.grades,
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
      grades:        stateRef.current.grades,
    }];
    undoStack.current = undoStack.current.slice(0, -1);
    setPlacements(snap.placements);
    setSpecialTermPl(snap.specialTermPl);
    setSemOrders(snap.semOrders);
    if (snap.grades) setGrades(snap.grades);
  };

  const doRedo = () => {
    if (!redoStack.current.length) return;
    const snap = redoStack.current[redoStack.current.length - 1];
    undoStack.current = [...undoStack.current, {
      placements:    stateRef.current.placements,
      specialTermPl: stateRef.current.specialTermPl,
      semOrders:     stateRef.current.semOrders,
      grades:        stateRef.current.grades,
    }];
    redoStack.current = redoStack.current.slice(0, -1);
    setPlacements(snap.placements);
    setSpecialTermPl(snap.specialTermPl);
    setSemOrders(snap.semOrders);
    if (snap.grades) setGrades(snap.grades);
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
  // (currentSemIdx moved up next to SEM_INDEX — the active-grades view
  // needs it before takesOf/effectiveCourseMap are derived.)
  // Only takes INSIDE the timeline count as placed. Entries parked outside
  // it (the cohort shrank) stay in state — so they come back when it widens —
  // but they return to the bank and never join any calculation.
  const placedIds = useMemo(
    () => new Set([
      ...Object.keys(placements).filter(id => inTimeline(placements[id], SEM_INDEX)),
      ...placedOut,
    ]),
    [placements, placedOut, SEM_INDEX]
  );

  // ── Unified special-term derived maps ────────────────────────
  // specialTermStartMap: { semId → instanceId } for the starting semester of each placed term.
  // specialTermContMap:  { semId → instanceId } for continuation semesters (weight-based span).
  const [specialTermStartMap, specialTermContMap] = useMemo(() => {
    const startMap = {};
    const contMap  = {};
    const types    = specialTerms?.getTypes() ?? [];
    Object.entries(pvSpecialTerms).forEach(([id, data]) => {
      const { typeId, semId, duration } = data || {};
      if (!semId) return;
      startMap[semId] = id;
      const type = types.find(t => t.id === typeId);
      if (!type) return;
      const durationDesc = resolveTermByDuration(type.durations, duration);
      if (!durationDesc) return;
      const sem = SEMESTERS.find(s => s.id === semId);
      if (!sem) return;
      // sem.weight is already set by semGrid.js from the SemesterType definition.
      // Use it directly — sem.type is the theme ("summer") not the type id ("sumA"/"sumB").
      const semWeight = sem.weight ?? 1;
      if (termSpans(durationDesc.weight, semWeight)) {
        const nxt = SEM_NEXT[semId];
        if (nxt) contMap[nxt] = id;
      }
    });
    return [startMap, contMap];
  }, [pvSpecialTerms, specialTerms, calendar, SEMESTERS, SEM_NEXT]);

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

  const coopGradConflicts = useMemo(() => {
    const types = specialTerms?.getTypes() ?? [];
    return Object.entries(specialTermPl)
      .filter(([, data]) => {
        const semId = data?.semId;
        if (!semId) return false;
        if (semId === gradSemId) return true; // starts in grad sem — always a conflict
        if (SEM_NEXT[semId] !== gradSemId) return false; // not adjacent
        // Adjacent: only a conflict if the term actually spans into the grad semester.
        const type = types.find(t => t.id === data.typeId);
        if (!type) return false;
        const durationDesc = resolveTermByDuration(type.durations, data.duration);
        if (!durationDesc) return false;
        const sem = SEMESTERS.find(s => s.id === semId);
        return termSpans(durationDesc.weight, sem?.weight ?? 1);
      })
      .map(([id, data]) => {
        const type = types.find(t => t.id === data.typeId);
        return { id, label: type?.label ?? data.typeId, ...data };
      });
  }, [specialTermPl, gradSemId, SEM_NEXT, specialTerms, SEMESTERS]);

  const prereqViolations = useMemo(() => {
    const v = new Map();
    courses.forEach(c => {
      if (!pvPlacements[c.id] && !pvPlacedOut.has(c.id)) return; // not taken at all
      if (pvPlacements[c.id] === "incoming") return;
      // Parked outside the timeline (incl. "__overflow:*") → no violation
      // checks; ti would be undefined and flag every prereq as out of order.
      if (pvPlacements[c.id] && !inTimeline(pvPlacements[c.id], SEM_INDEX)) return;
      if (pvPlacedOut.has(c.id)) return; // skip placed-out courses – they have no prereq warnings
      if (!c.prereqs?.length) return;
      const ti = SEM_INDEX[pvPlacements[c.id]];
      const result = evalPrereqTree(c.prereqs, effectivePlacements, SEM_INDEX, ti, pvPlacedOut);
      if (result !== "satisfied") { v.set(c.id, result); return; }
      // Grade layer: placement says satisfied, but an ENTERED grade may veto
      // (an F/U/I/W attempt, or a letter under the ref's minGrade). Only the
      // comparison of the two results can say "blocked by grade" — the
      // evaluator's enum has no such state on purpose. takesOf is null until
      // a grade is entered, so this branch is dead by default.
      if (takesOf) {
        const graded = evalPrereqTree(c.prereqs, effectivePlacements, SEM_INDEX, ti, pvPlacedOut, takesOf);
        if (graded !== "satisfied") v.set(c.id, "grade");
      }
    });
    return v;
  }, [courses, pvPlacements, effectivePlacements, pvPlacedOut, SEM_INDEX, takesOf]);

  const coreqViolations = useMemo(() => {
    const v = new Map();
    allEdges.filter(e => e.type === "corequisite").forEach(({ from, to }) => {
      // Only warn `to` (the course that declared the coreq). Symmetric pairs each
      // have their own edge in both directions, so each side is still covered.
      // Checking `from` as well would falsely warn e.g. CS 2100 for not being
      // co-placed with every course that lists CS 2100 as its coreq.
      const placed = to, partner = from;
      // Parked outside the timeline (incl. "__overflow:*") = off-plan.
      const isHidden = id => placements[id] !== undefined && !inTimeline(placements[id], SEM_INDEX);
      const placedTaken = placements[placed] !== undefined || placedOut.has(placed);
      const partnerTaken = placements[partner] !== undefined || placedOut.has(partner);
      if (!placedTaken) return;
      if (placements[placed] === "incoming") return;
      if (isHidden(placed) || isHidden(partner)) return; // skip while either course is parked off-plan
      if (placedOut.has(placed)) return;
      if (!partnerTaken) {
        v.set(placed, "alone");
      } else if (placements[placed] && placements[partner] && placements[placed] !== placements[partner]) {
        if (v.get(placed) !== "alone") v.set(placed, "sep");
      }
    });
    return v;
  }, [allEdges, placements, placedOut]);

  const connectedIds = useMemo(() => {
    const m = {};
    if (!selectedId) return m;
    // Grid: every course in the placed prereq tree gets highlighted, not just
    // direct neighbours — so mark both endpoints of each tree edge (the selected
    // course itself is skipped; it carries its own selected styling).
    for (const r of connectionEdges) {
      if (r.from !== selectedId && !(r.from in m)) m[r.from] = r.type;
      if (r.to   !== selectedId && !(r.to   in m)) m[r.to]   = r.type;
    }
    // Plus the 1-degree neighbourhood over ALL edges, so a direct prereq/coreq
    // sitting unplaced in the Course Bank still lights up (and isn't dimmed).
    // Bounded to one hop for unplaced courses — no catalog-wide expansion.
    for (const r of allEdges) {
      if (r.from === selectedId && !(r.to   in m)) m[r.to]   = r.type;
      if (r.to   === selectedId && !(r.from in m)) m[r.from] = r.type;
    }
    return m;
  }, [selectedId, connectionEdges, allEdges]);

  // Trace a course's full prerequisite tree on the grid: select it and force
  // both depths to Max so the whole chain lights up regardless of the current
  // depth setting. Used by the Stats panel's "longest prereq chains" list.
  const showPrereqTree = (courseId) => {
    setPrereqDepth(Infinity);
    setUnlockDepth(Infinity);
    setSelectedId(courseId);
    setShowPanel(true);
    setShowStats(false);
  };

  const getSemStatus = semId => {
    if (isGraduated && semId === gradSemId) return "completed";
    const idx = SEM_INDEX[semId];
    if (idx < currentSemIdx)    return "completed";
    if (semId === currentSemId) return "inprogress";
    return "future";
  };

  // Grades follow their course out of the plan: when a placement (or
  // placed-out entry) disappears, its grade entry goes with it — otherwise
  // removing and re-adding a course would silently resurrect an old grade.
  // That is the ONLY destructive pruning. A grade whose semester merely
  // stopped being "completed" is filtered by the active `grades` view, not
  // deleted — moving "Now in" back and forth must be reversible.
  useEffect(() => {
    setGrades(g => {
      const stale = Object.keys(g).filter(k => placements[k] === undefined && !placedOut.has(k));
      if (!stale.length) return g;
      const next = { ...g };
      for (const k of stale) delete next[k];
      return next;
    });
  }, [placements, placedOut]);

  // ── Effect: auto-graduate / auto-ungraduate ───────────────────
  // Must live after gradSemId is declared (line above) to avoid a TDZ ReferenceError in
  // the dependency array. Compares semester IDs by calendar order so a live semester
  // outside the plan boundary (e.g. fall2026 for a plan ending spring2026) still works.
  useEffect(() => {
    const TYPE_ORD = { spring: 0, sumA: 1, sumB: 2, fall: 3 };
    const semOrd = id => {
      const m = id?.match(/^([a-zA-Z]+)(\d{4})$/);
      if (!m) return null;
      return parseInt(m[2], 10) * 10 + (TYPE_ORD[m[1]] ?? 0);
    };
    const curOrd  = semOrd(currentSemId);
    const gradOrd = semOrd(gradSemId);
    if (curOrd === null || gradOrd === null) return;
    if (curOrd > gradOrd) {
      setIsGraduated(true);
    } else if (curOrd < gradOrd) {
      setIsGraduated(false);
    }
  }, [currentSemId, gradSemId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Totals (use effectiveCourseMap so SH overrides are reflected) ─────────
  // Iterate placement keys (not the catalog array) so repeat instances
  // ("BASE#n") each contribute their credits; unknown ids resolve to 0,
  // matching the old courses-array filter.

  // Retakes: a NONREPEATABLE base placed more than once (a failed course
  // being retaken) earns its credits ONCE — the registrar's replacement
  // rule. Degree totals exclude every take but the latest; per-semester
  // load still counts each take (the student sits in the seat both times).
  // Repeatable courses are untouched — their takes accumulate by design.
  const supersededTakes = useMemo(() => {
    const byBase = new Map();
    for (const pid of Object.keys(pvPlacements)) {
      if (!isInstanceId(pid)) continue;
      const b = baseId(pid);
      if (courseMap[b]?.repeatable) continue;
      byBase.set(b, []);
    }
    const out = new Set();
    if (!byBase.size) return out;
    for (const [pid, sid] of Object.entries(pvPlacements)) {
      const b = baseId(pid);
      if (byBase.has(b)) byBase.get(b).push([pid, SEM_INDEX[sid] ?? -1]);
    }
    for (const takes of byBase.values()) {
      takes.sort((a, b) => a[1] - b[1]);
      for (let i = 0; i < takes.length - 1; i++) out.add(takes[i][0]);
    }
    return out;
  }, [pvPlacements, courseMap, SEM_INDEX]);

  // Grade axis: F/U/W/X takes already carry sh 0 in effectiveCourseMap (the
  // choke point — see its comment), so the projection needs no grade filter
  // of its own. The DONE/earned total additionally excludes I via
  // yieldsCredit: an incomplete has earned nothing yet but stays projected.
  const totalSHPlaced = useMemo(
    () => pvBonusSH + Object.entries(pvPlacements)
      .filter(([id, sid]) => inTimeline(sid, SEM_INDEX) && !pvPlacedOut.has(id) && !supersededTakes.has(id))
      .reduce((s, [id]) => s + (effectiveCourseMap[id]?.sh ?? 0), 0),
    [pvBonusSH, pvPlacements, pvPlacedOut, effectiveCourseMap, SEM_INDEX, supersededTakes]
  );

  const totalSHDone = useMemo(
    () => pvBonusSH + Object.entries(pvPlacements).filter(([id, sid]) => {
      if (pvPlacedOut.has(id) || supersededTakes.has(id)) return false;
      if (!yieldsCredit(grades[id])) return false;
      const sidx = SEM_INDEX[sid] ?? 99;
      return isGraduated ? sidx <= currentSemIdx : sidx < currentSemIdx;
    }).reduce((s, [id]) => s + (effectiveCourseMap[id]?.sh ?? 0), 0),
    [pvBonusSH, pvPlacements, pvPlacedOut, SEM_INDEX, currentSemIdx, isGraduated, effectiveCourseMap, supersededTakes, grades]
  );

  // ── Stats tab gating ──────────────────────────────────────────
  // Stats is the one header tab a newcomer gains nothing from: on an empty (or
  // single-term) plan every chart is a blank or one lonely bar, so the button
  // is pure confusion next to genuinely load-bearing tabs. So it's earned, in
  // two stages:
  //
  //   1. UNLOCK (once, ever, across every plan) — STATS_MIN_COURSES courses
  //      across STATS_MIN_TERMS terms. Persisted, because being made to
  //      re-clear a 12-course bar in each new plan would read as the feature
  //      breaking rather than as a gate.
  //   2. SHOW (live, per plan) — the active plan itself must carry
  //      STATS_KEEP_COURSES across STATS_KEEP_TERMS. The tab follows the plan
  //      in front of you: a scratch plan with three courses in it has nothing
  //      to chart, so the button steps out rather than opening an empty panel.
  //
  // Bulk AND spread both matter — the load chart and skyline are about shape
  // over time, which a single stacked term doesn't have. Co-op/work terms
  // count toward the spread. Deliberately measured on the committed plan, not
  // the preview overlay: a Claude proposal the user hasn't accepted shouldn't
  // move the tab in or out from under them.
  const statsGate = useMemo(() => {
    const placed = Object.entries(placements).filter(([id, sid]) =>
      inTimeline(sid, SEM_INDEX) && !placedOut.has(id)
      && (effectiveCourseMap[id]?.sh ?? 0) >= STATS_MIN_SH);
    const terms = new Set(placed.map(([, sid]) => sid));
    for (const data of Object.values(specialTermPl)) {
      if (data?.semId && inTimeline(data.semId, SEM_INDEX)) terms.add(data.semId);
    }
    return { courses: placed.length, terms: terms.size };
  }, [placements, specialTermPl, placedOut, effectiveCourseMap, SEM_INDEX]);

  const [statsUnlocked, setStatsUnlocked] = useState(() => {
    try { return localStorage.getItem(key("stats-unlocked")) === "true"; } catch { return false; }
  });
  // Latch, not an event: the unlock can land while the loading screen is still
  // up (a returning user's plan is restored before the header mounts), so a
  // false→true transition watched from the header would be missed entirely.
  // The header consumes this whenever it mounts and acks it — one flash, ever.
  const [statsJustUnlocked, setStatsJustUnlocked] = useState(false);
  useEffect(() => {
    if (statsUnlocked) return;
    if (statsGate.courses < STATS_MIN_COURSES || statsGate.terms < STATS_MIN_TERMS) return;
    setStatsUnlocked(true);
    setStatsJustUnlocked(true);
    try { localStorage.setItem(key("stats-unlocked"), "true"); } catch {}
  }, [statsUnlocked, statsGate]); // eslint-disable-line react-hooks/exhaustive-deps

  // What the header actually renders on. The unlock bar implies the keep bar,
  // so the tab is always present for the plan that earned it.
  const statsVisible = statsUnlocked
    && statsGate.courses >= STATS_KEEP_COURSES
    && statsGate.terms   >= STATS_KEEP_TERMS;

  // ── Star toggle ───────────────────────────────────────────────
  const toggleStar = id => {
    setStarredIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(key("starred"), JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  // ── Drag / drop ───────────────────────────────────────────────
  // Clear dragInfo whenever any HTML5 drag ends — covers drops outside valid targets
  // where onDrop never fires and dragInfo would otherwise stay set permanently.
  useEffect(() => {
    const clear = () => setDragInfo(null);
    document.addEventListener('dragend', clear);
    return () => document.removeEventListener('dragend', clear);
  }, []);

  const onDragStart = (e, id, type, fromSem, extra = {}) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "move";
    // Defer the dragInfo state update by a frame. Setting it synchronously here
    // re-renders the source mid-`dragstart` — e.g. a grad summer session expands
    // its slot grid 1→2 columns, relaying out the very card being grabbed — which
    // makes the browser abort the drag ("sometimes clicking doesn't drag"). A rAF
    // lets the browser lock in the drag image before any layout change.
    requestAnimationFrame(() => setDragInfo({ id, type, fromSem: fromSem ?? null, ...extra }));
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
      // Repeatable courses: a drag with no source semester (bank, InfoPanel)
      // of an already-placed repeatable course adds ANOTHER take under a
      // fresh instance id; grid drags (fromSem set) keep move semantics.
      // The repeat limit is never enforced (NU Map trusts the user) — takes
      // beyond it just render with the warn treatment.
      // Same call also resolves RETAKES: a nonrepeatable course whose every
      // take carries an entered terminal grade gets a fresh instance id too
      // (NEU allows retaking any course "to earn a better grade"); with no
      // grades entered resolveAddId returns the base id and this is a move,
      // exactly as before.
      let dropId = id;
      if (dragInfo.fromSem == null && placements[id] != null) {
        const course = courseMap[baseId(id)];
        if (course) dropId = resolveAddId(course, placements, placedOut, grades).id;
      }
      const fromSem = placements[dropId];
      if (fromSem === semId) { setDragInfo(null); return; }
      // Always move ALL coreq partners together with the dragged course
      // (repeat instances have no edges of their own, so extra takes move alone)
      const coreqPartners = [...new Set(
        allEdges
          .filter(edge => edge.type === "corequisite" && (edge.from === dropId || edge.to === dropId))
          .map(edge => edge.from === dropId ? edge.to : edge.from)
          .filter(cid => cid !== dropId)
      )];
      const allMoving = [dropId, ...coreqPartners];
      setPlacements(p => {
        const n = { ...p, [dropId]: semId };
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
        next[semId] = [...withoutDropped, dropId, ...coreqPartners];
        return next;
      });
      // Remove from palette if it was there
      setPalette(prev => prev.filter(cid => !allMoving.includes(cid)));
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
      setPalette(prev => prev.filter(cid => cid !== id && !coreqPartners.includes(cid)));
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
      setPlacedOut(prev => new Set([...prev, id]));

      // If the course was placed in a semester, remove it from placements
      if (placements[id]) {
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

      setPalette(prev => prev.filter(cid => cid !== id));
      setDragInfo(null);
    } catch (error) {
      console.error('Error in onDropPlacedOut:', error);
    }
  };

  const onDropPalette = (e) => {
    e?.preventDefault?.();
    if (!dragInfo || dragInfo.type !== "course") return;
    const { id, fromSem } = dragInfo;
    if (palette.includes(id)) { setDragInfo(null); return; }
    pushUndo();
    const coreqPartners = [...new Set(
      allEdges
        .filter(e2 => e2.type === "corequisite" && (e2.from === id || e2.to === id))
        .map(e2 => e2.from === id ? e2.to : e2.from)
        .filter(cid => cid !== id)
    )];
    const allMoving = [id, ...coreqPartners.filter(cid => !palette.includes(cid))];
    // Remove from semester placements & orders
    const toCleanSems = new Set([fromSem, ...allMoving.map(cid => placements[cid])].filter(Boolean));
    if (toCleanSems.size > 0) {
      setPlacements(p => { const n = { ...p }; allMoving.forEach(cid => delete n[cid]); return n; });
      setSemOrders(p => {
        const next = { ...p };
        toCleanSems.forEach(sid => { next[sid] = (next[sid] || []).filter(cid => !allMoving.includes(cid)); });
        return next;
      });
    }
    // Remove from placedOut if needed
    if (placedOut.has(id)) setPlacedOut(prev => { const n = new Set(prev); n.delete(id); return n; });
    setPalette(prev => [...new Set([...prev, ...allMoving])]);
    setShowPalette(true);
    setDragInfo(null);
  };

  const removeFromPalette = (id) => {
    pushUndo();
    setPalette(prev => prev.filter(cid => cid !== id));
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

    const DRAG_THRESHOLD = 8; // px — finger must move this far before drag activates

    const initiateDrag = (cardEl, rect, id, type, fromSem, duration, typeId) => {
      document.documentElement.style.userSelect = 'none';
      document.documentElement.style.webkitUserSelect = 'none';

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

      cardEl.style.opacity       = '0.3';
      cardEl.style.pointerEvents = 'none';

      touchDragStartedRef.current = true;
      setDragInfo({ id, type, fromSem, ...(duration != null ? { duration } : {}), ...(typeId ? { typeId } : {}) });
    };

    const onTouchStart = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
      const cardEl = e.target.closest('[data-drag-id]');
      if (!cardEl) return;
      const touch = e.touches[0];

      // Record pending card info — don't start drag yet; wait for movement threshold
      touchDragStartedRef.current = false;
      touchStartPos.current = { x: touch.clientX, y: touch.clientY };
      touchStartOff.current = { x: touch.clientX - cardEl.getBoundingClientRect().left,
                                y: touch.clientY - cardEl.getBoundingClientRect().top };
      touchDragElRef.current     = cardEl;
      touchDragIdRef.current     = cardEl.dataset.dragId || null;
      touchDragTypeRef.current   = cardEl.dataset.dragType;
      touchDragTypeIdRef.current = cardEl.dataset.dragTypeid || null;
      touchDragFromRef.current   = cardEl.dataset.dragFrom || null;
    };

    const onTouchMove = (e) => {
      if (!touchDragIdRef.current && !touchDragElRef.current) return;
      const touch = e.touches[0];

      // The gesture began on a draggable card (onTouchStart bails otherwise), so
      // this is a drag, not a scroll. Prevent the default from the very first move
      // — on iOS, if the first touchmove isn't cancelled the browser commits to
      // scrolling for the rest of the gesture and the background drags along.
      e.preventDefault();

      if (!touchDragStartedRef.current) {
        const dx = touch.clientX - touchStartPos.current.x;
        const dy = touch.clientY - touchStartPos.current.y;
        if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
        // Threshold crossed — start the drag now
        const cardEl   = touchDragElRef.current;
        const id       = touchDragIdRef.current;
        const type     = touchDragTypeRef.current;
        const fromSem  = touchDragFromRef.current;
        const duration = cardEl?.dataset.dragDuration ? parseInt(cardEl.dataset.dragDuration, 10) : undefined;
        const typeId   = touchDragTypeIdRef.current || undefined;
        const rect     = cardEl.getBoundingClientRect();
        initiateDrag(cardEl, rect, id, type, fromSem, duration, typeId);
      }

      if (ghostRef.current) {
        ghostRef.current.style.left = (touch.clientX - touchStartOff.current.x) + 'px';
        ghostRef.current.style.top  = (touch.clientY - touchStartOff.current.y) + 'px';
      }
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      const semEl  = target?.closest('[data-sem-id]');
      setHoveredSem(semEl?.dataset.semId ?? null);
    };

    const onTouchEnd = (e) => {
      if (!touchDragIdRef.current && !touchDragElRef.current) return;

      const dragStarted = touchDragStartedRef.current;
      const id      = touchDragIdRef.current;
      const type    = touchDragTypeRef.current;
      const fromSem = touchDragFromRef.current;
      const cardEl  = touchDragElRef.current || cardRefs.current[id];

      // Always clean up visual state
      if (cardEl) { cardEl.style.opacity = ''; cardEl.style.pointerEvents = ''; }
      touchDragElRef.current      = null;
      touchDragStartedRef.current = false;
      removeGhost();
      document.documentElement.style.userSelect = '';
      document.documentElement.style.webkitUserSelect = '';
      touchDragIdRef.current     = null;
      touchDragTypeRef.current   = null;
      touchDragTypeIdRef.current = null;
      touchDragFromRef.current   = null;
      setHoveredSem(null);
      setHoveredZone(null);

      if (!dragStarted) {
        // Was a tap, not a drag — leave drop logic alone
        setDragInfo(null);
        return;
      }

      const touch  = e.changedTouches[0];
      const touchX = touch.clientX, touchY = touch.clientY;
      const target = document.elementFromPoint(touchX, touchY);
      const semEl      = target?.closest('[data-sem-id]');
      const bankEl     = target?.closest('[data-drop-bank]');
      const paletteEl  = target?.closest('[data-drop-palette]');
      let placedOutEl  = target?.closest('[data-drop-placedout]');

      if (!placedOutEl) {
        for (const container of document.querySelectorAll('[data-drop-placedout]')) {
          const rect = container.getBoundingClientRect();
          if (touchX >= rect.left && touchX <= rect.right && touchY >= rect.top && touchY <= rect.bottom) {
            placedOutEl = container;
            break;
          }
        }
      }

      if (paletteEl && onDropPaletteRef.current && type === 'course') {
        onDropPaletteRef.current({ preventDefault: () => {} });
      } else if (placedOutEl && onDropPlacedOutRef.current && type === 'course') {
        onDropPlacedOutRef.current({ id, type, fromSem });
      } else if (bankEl && onDropBankRef.current) {
        onDropBankRef.current({ preventDefault: () => {} });
      } else if (semEl && onDropRef.current) {
        onDropRef.current(null, semEl.dataset.semId);
      } else {
        setDragInfo(null);
      }
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
    // A repeatable course stays in the bank while it has unused EFFECTIVE
    // takes left — failed takes hand their slot back, so an F doesn't
    // consume repeatMax. (Limit reached → it disappears, exactly like a
    // placed one-shot course.) A nonrepeatable course REAPPEARS only once
    // every take has definitively failed (F/U/W) — a passed course is
    // locked, and an ungraded or Incomplete one still occupies its slot.
    () => new Set(courses.filter(c =>
      !placedIds.has(c.id) ||
      (c.repeatable && takesUsed(c.id, placements, placedOut, SEM_INDEX, grades) < (c.repeatMax ?? Infinity)) ||
      retakeUnlocked(c, placements, placedOut, grades)
    ).map(c => c.id)),
    [courses, placedIds, placements, placedOut, SEM_INDEX, grades]
  );

  // ── Grades ───────────────────────────────────────────────────
  // Entered per placement instance from the course card; null clears.
  const setGrade = (pid, symbol) => {
    // Private mode is read-only for grades: the UI hides the entry chip,
    // and this is the backstop so no other path (a stale render, a
    // keyboard route, anything added later) can write a value the user
    // cannot see. Refusing beats writing blind over hidden data.
    if (privateGrades) return;
    setGrades(g => {
      if (symbol == null) {
        if (!(pid in g)) return g;
        const next = { ...g };
        delete next[pid];
        return next;
      }
      return g[pid] === symbol ? g : { ...g, [pid]: symbol };
    });
  };

  // ── Reset ────────────────────────────────────────────────────
  const resetPlanToDefaults = () => {
    setPlacements({});
    setSpecialTermPl({});
    setSemOrders({});
    setOfferedOverrides({});
    setBonusSH(0);
    setMajor("");
    setMajor2("");
    setConc(""); setConc2("");
    setMinor1("");
    setMinor2("");
    setStudentTypeRaw("undergrad");
    try { localStorage.setItem(key("student-type"), "undergrad"); } catch {}
    setPlacedOut(new Set());
    setGrades({});
    setPalette([]);
    // Reset cohort to defaults
    setPlanEntSem(_defEntSem);
    setPlanEntYear(defaultStartYear);
    setPlanGradSem(_defGradSem);
    setPlanGradYear(defaultStartYear + NUM_YEARS);
    // Also clear any per‑plan localStorage items for cohort (optional, but safe)
    try {
      localStorage.setItem(key("ent-sem"),  _defEntSem);
      localStorage.setItem(key("ent-year"), String(defaultStartYear));
      localStorage.setItem(key("grad-sem"), _defGradSem);
      localStorage.setItem(key("grad-year"), String(defaultStartYear + NUM_YEARS));
    } catch {}
  };
  const resetAll = resetPlanToDefaults;

  // ── Multi-plan management ────────────────────────────────────
  const [plans, setPlans] = useState(() => {
    try {
      const raw = localStorage.getItem(key("plan-index"));
      if (raw) return JSON.parse(raw);
    } catch {}
    return [{ id: "default", name: "Plan 1" }];
  });
  const [activePlanId, setActivePlanId] = useState(() => {
    try { return localStorage.getItem(key("active-plan")) || "default"; } catch { return "default"; }
  });

  // Persist plan index whenever it changes
  useEffect(() => {
    try { localStorage.setItem(key("plan-index"), JSON.stringify(plans)); } catch {}
  }, [plans]);
  useEffect(() => {
    try { localStorage.setItem(key("active-plan"), activePlanId); } catch {}
  }, [activePlanId]);

  // Browser tab title = "<active plan> — <app>". The static <title> in
  // index.html stays SEO/disclaimer-focused for crawlers (most don't run
  // JS); this only overrides it at runtime for actual users.
  useEffect(() => {
    const name = plans.find(p => p.id === activePlanId)?.name;
    document.title = name ? `${name} - ${institution.appName}` : institution.appName;
  }, [plans, activePlanId, institution.appName]);

  // Keep each plan index entry's studentType up to date so the plan switcher can
  // group plans by undergraduate / graduate. The active plan is synced from live
  // state; other entries are backfilled (once) from their saved plan-data slot.
  useEffect(() => {
    setPlans(prev => {
      let changed = false;
      const next = prev.map(p => {
        let st;
        if (p.id === activePlanId) {
          st = studentType;
        } else if (p.studentType !== undefined) {
          return p;
        } else {
          st = "undergrad";
          try {
            const raw = localStorage.getItem(key(`plan-data-${p.id}`));
            if (raw) st = JSON.parse(raw).studentType ?? "undergrad";
          } catch {}
        }
        if (p.studentType === st) return p;
        changed = true;
        return { ...p, studentType: st };
      });
      return changed ? next : prev;
    });
  }, [studentType, activePlanId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Capture full plan state as a serializable object
  const captureCurrentPlan = () => ({
    version: 1,
    exported: new Date().toISOString(),
    entSem: planEntSem, entYear: planEntYear,
    gradSem: planGradSem, gradYear: planGradYear,
    placements, specialTermPl, semOrders, shOverrides, bonusSH, currentSemId,
    offeredOverrides, collapsedSubs,
    major, major2, conc, conc2, minor1, minor2, studentType,
    placedOut: [...placedOut],
    // Present in plan slots (localStorage) only. Share links go through
    // planShare's _KEYS allowlist, which deliberately omits grades.
    grades: gradesRaw,
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

  /**
   * @param {object} d  the saved plan object
   * @param {{ initial?: boolean }} [opts]
   *   initial: this is the first restore of the ACTIVE plan on mount, where
   *   the live state loaded from state-v2 describes this same plan.
   */
  // Is the live state (loaded from state-v2 at mount) actually about the
  // plan we are being asked to show? state-v2 now carries the plan id it
  // was written for; a snapshot from before that stamp has none, and for
  // those the active plan at load time IS the plan it describes. Only when
  // we can prove a MISMATCH do we discard live state.
  // Deliberately NOT gated on "is this the first run": StrictMode
  // double-invokes effects in dev, so any one-shot flag flips on the first
  // pass and the second pass takes the opposite branch — the exact trap
  // that made two earlier attempts at this fix appear to do nothing. Plan
  // identity is idempotent, so both passes agree.
  const liveStateMatchesPlan = () =>
    _saved?.planId === undefined || _saved.planId === activePlanId;

  const restorePlan = (d, { initial = false } = {}) => {
    setPlacements(d.placements ?? {});
    setSpecialTermPl(migrateSpecialTermPl(d));
    setSemOrders(d.semOrders ?? {});
    setShOverrides(d.shOverrides ?? {});
    setOfferedOverrides(d.offeredOverrides ?? {});
    setCollapsedSubs(d.collapsedSubs ?? {});
    setBonusSH(d.bonusSH ?? 0);
    if (d.currentSemId) setCurrentSemId(d.currentSemId);
    if (d.entSem)  { setPlanEntSem(d.entSem);   try { localStorage.setItem(key("ent-sem"),  d.entSem);  } catch {} }
    if (d.entYear) { setPlanEntYear(d.entYear);  try { localStorage.setItem(key("ent-year"), d.entYear); } catch {} }
    if (d.gradSem) { setPlanGradSem(d.gradSem);  try { localStorage.setItem(key("grad-sem"), d.gradSem); } catch {} }
    if (d.gradYear){ setPlanGradYear(d.gradYear); try { localStorage.setItem(key("grad-year"),d.gradYear);} catch {} }
    setMajor(d.major ?? "");
    setMajor2(d.major2 ?? "");
    setConc(d.conc ?? ""); setConc2(d.conc2 ?? "");
    setMinor1(d.minor1 ?? "");
    setMinor2(d.minor2 ?? "");
    const st = d.studentType ?? "undergrad";
    setStudentTypeRaw(st);
    try { localStorage.setItem(key("student-type"), st); } catch {}
    setPlacedOut(d.placedOut ? new Set(d.placedOut) : new Set());
    // ABSENT ≠ EMPTY, and conflating them destroyed data.
    //
    // Every plan slot written before grades existed has no `grades` key at
    // all. Restoring `d.grades ?? {}` on mount therefore wiped the grades
    // that state-v2 had correctly saved, and the autosave then persisted
    // the empty map over both stores — entered grades gone for good, on an
    // ordinary reload, with nothing the user did to cause it.
    //
    // So: an explicit {} means "this plan has no grades" and is honoured.
    // A MISSING key means "this slot predates grades and knows nothing",
    // and on the initial restore the live state (same plan, loaded from
    // state-v2) is the better source — keep it, and the autosave migrates
    // the slot forward. On a plan SWITCH the key's absence must still
    // clear, or the previous plan's grades would leak into this one.
    if (d.grades && typeof d.grades === "object") setGrades(d.grades);
    else if (!initial) setGrades({});
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key(`plan-data-${activePlanId}`));
      if (raw) {
        const d = JSON.parse(raw);
        // Same plan as the live state (mount, or a StrictMode re-run) →
        // the slot's omissions may be filled from what we already hold.
        restorePlan(d, { initial: restoredPlanId.current === null || restoredPlanId.current === activePlanId });
        restoredPlanId.current = activePlanId;
      } else {
        // No slot at all. That is either a legacy profile whose plan lived
        // only in state-v2 (resetting would throw the live plan away,
        // grades included) or a genuinely new plan (which MUST start
        // empty). Tell them apart by whether the live state belongs to
        // this plan — never by mount-vs-switch, which cannot distinguish a
        // reload that lands on a different plan.
        const keepLive = liveStateMatchesPlan();
        if (!keepLive) resetPlanToDefaults();
        restoredPlanId.current = activePlanId;
      }
    } catch {
      // The slot is unreadable — corrupt or truncated, which is exactly
      // what a quota-exceeded write leaves behind. Wiping to defaults here
      // would destroy the live plan (grades included) because of damage to
      // a MIRROR, so on the initial mount we keep what state-v2 already
      // gave us and let the autosave rewrite a good slot. Only a real plan
      // switch resets, where the live state belongs to a different plan.
      const keepLive = liveStateMatchesPlan();
      if (!keepLive) resetPlanToDefaults();
      restoredPlanId.current = activePlanId;
    }
    // Reset bank UI filters to defaults
    setBankSearch("");
    setBankTab("all");
    setBankSort("az");
    setBankFilters({ terms: [], level: [], nupath: [], profs: [], programReq: false, programElec: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlanId]);

  // Save current plan to its localStorage slot
  const saveCurrentPlanToSlot = () => {
    try { localStorage.setItem(key(`plan-data-${activePlanId}`), JSON.stringify(captureCurrentPlan())); } catch {}
  };

  // Switch to a different plan
  const switchPlan = (id) => {
    if (id === activePlanId) return;
    // Auto-save current plan
    saveCurrentPlanToSlot();
    // Switch to new plan – the useEffect will load its data (or reset)
    setActivePlanId(id);
  };

  // Create a new plan.
  // Optional cohort = { entSem, entYear, gradSem, gradYear, studentType }.
  // When provided, pre-writes a minimal plan snapshot so that the activePlanId
  // useEffect calls restorePlan (with the given cohort) instead of resetPlanToDefaults.
  const createPlan = (name, cohort = null) => {
    saveCurrentPlanToSlot();
    const id = `plan_${Date.now()}`;
    if (cohort) {
      try {
        localStorage.setItem(key(`plan-data-${id}`), JSON.stringify({
          version: 1,
          exported: new Date().toISOString(),
          entSem:  cohort.entSem,
          entYear: cohort.entYear,
          gradSem: cohort.gradSem,
          gradYear: cohort.gradYear,
          studentType: cohort.studentType ?? "undergrad",
          placements: {}, specialTermPl: {}, semOrders: {},
          shOverrides: {}, offeredOverrides: {}, collapsedSubs: {},
          bonusSH: 0, major: "", major2: "", conc: "", conc2: "",
          minor1: "", minor2: "", placedOut: [],
        }));
      } catch {}
    }
    setPlans(prev => [...prev, { id, name, studentType: cohort?.studentType ?? "undergrad" }]);
    setActivePlanId(id);
  };

  // Delete a plan
  const deletePlan = (id) => {
    if (plans.length <= 1) return; // can't delete last plan
    try { localStorage.removeItem(key(`plan-data-${id}`)); } catch {}
    const remaining = plans.filter(p => p.id !== id);
    setPlans(remaining);
    if (id === activePlanId) {
      // Switch to first remaining plan – the useEffect will load its data (or reset)
      setActivePlanId(remaining[0].id);
    }
  };

  // Delete multiple plans at once — avoids stale-closure issue of calling deletePlan in a loop
  const bulkDeletePlans = (ids) => {
    const idSet = new Set(ids);
    const remaining = plans.filter(p => !idSet.has(p.id));
    if (remaining.length === 0) return;
    for (const id of ids) {
      try { localStorage.removeItem(key(`plan-data-${id}`)); } catch {}
    }
    setPlans(remaining);
    if (idSet.has(activePlanId)) setActivePlanId(remaining[0].id);
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
    // EVERY field captureCurrentPlan() writes must appear here. The slot is
    // the store the app RELOADS from (the activePlanId effect calls
    // restorePlan with it), so a field that's captured but not watched is
    // saved to state-v2, never mirrored to the slot, and then overwritten
    // by the stale slot on the next reload — silent data loss that looks
    // like "it didn't save". That was live for grades and placedOut.
  }, [placements, specialTermPl, currentSemId, semOrders, offeredOverrides, shOverrides, bonusSH, major, major2, conc, conc2, minor1, minor2, studentType, activePlanId, planEntSem, planEntYear, planGradSem, planGradYear, gradesRaw, placedOut]); // eslint-disable-line react-hooks/exhaustive-deps
  
  // ── Plan JSON export / import ────────────────────────────────
  const exportPlanJSON = () => {
    // ONE builder for the plan artifact: hand-building a second object here
    // is how grades were silently missing from JSON backups (round-trip
    // data loss). A plan FILE is a local, user-initiated backup — unlike
    // share links it carries grades on purpose; restorePlan reads them back.
    //
    // …unless private mode is on, which is exactly the case where the file
    // is going to someone else. The export is the leak the toggle exists to
    // prevent, so it drops grades even though the local slot keeps them.
    const data = {
      ...captureCurrentPlan(),
      planName: plans.find(p => p.id === activePlanId)?.name || "Plan",
      substitutions,
    };
    if (privateGrades) delete data.grades;
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

  const applyPlanData = (d) => {
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
    if (d.entSem)  { setPlanEntSem(d.entSem);   try { localStorage.setItem(key("ent-sem"),  d.entSem);  } catch {} }
    if (d.entYear) { setPlanEntYear(d.entYear);  try { localStorage.setItem(key("ent-year"), d.entYear); } catch {} }
    if (d.gradSem) { setPlanGradSem(d.gradSem);  try { localStorage.setItem(key("grad-sem"), d.gradSem); } catch {} }
    if (d.gradYear){ setPlanGradYear(d.gradYear); try { localStorage.setItem(key("grad-year"),d.gradYear);} catch {} }
    setMajor(d.major ?? "");
    setMajor2(d.major2 ?? "");
    setConc(d.conc ?? ""); setConc2(d.conc2 ?? "");
    setMinor1(d.minor1 ?? "");
    setMinor2(d.minor2 ?? "");
    const st = d.studentType ?? "undergrad";
    setStudentTypeRaw(st);
    try { localStorage.setItem(key("student-type"), st); } catch {}
  };

  const importPlanJSON = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (d.version !== 1) { alert("Unrecognized plan file format."); return; }
        saveCurrentPlanToSlot();
        const id = `plan_${Date.now()}`;
        const base = d.planName || "Plan";
        const name = base.startsWith('+') ? base : `+ ${base}`;
        try { localStorage.setItem(key(`plan-data-${id}`), JSON.stringify(d)); } catch {}
        setPlans(prev => [...prev, { id, name, studentType: d.studentType ?? "undergrad" }]);
        setActivePlanId(id);
        if (Array.isArray(d.substitutions)) setSubstitutions(d.substitutions);
      } catch (err) {
        alert("Could not read plan file: " + err.message);
      }
    };
    reader.readAsText(file);
  };

  const copyPlanLink = async (targetLocale) => {
    const planName = plans.find(p => p.id === activePlanId)?.name || "Plan";
    const data = {
      ...captureCurrentPlan(),
      substitutions,
      planName,
      locale: targetLocale,
    };
    const encoded = await encodePlan(data);
    const url = buildShareUrl(encoded);
    await navigator.clipboard.writeText(url);
  };

  // Create a new plan slot pre-populated with shared data, then switch to it.
  const importSharedPlan = (d) => {
    saveCurrentPlanToSlot();
    const id = `plan_${Date.now()}`;
    const base = d.planName || "Plan";
    const name = base.startsWith('/') ? '/' + base : '/ ' + base;
    // Pre-write so the activePlanId useEffect finds data and calls restorePlan.
    try { localStorage.setItem(key(`plan-data-${id}`), JSON.stringify(d)); } catch {}
    setPlans(prev => [...prev, { id, name, studentType: d.studentType ?? "undergrad" }]);
    setActivePlanId(id);
    // restorePlan doesn't handle substitutions, so set them directly.
    setSubstitutions(Array.isArray(d.substitutions) ? d.substitutions : []);
    // Apply the sender's chosen locale if it's one we support.
    if (d.locale && locales.some(l => l.code === d.locale)) setLocale(d.locale);
  };

  // Commit the onboarding panel's choices to the live plan, then open the tour.
  //   setup = { studentType, entSem, entYear, gradSem, gradYear, major, major2, conc, minor1, minor2 }
  const finishOnboarding = (setup = {}) => {
    const {
      studentType: st = "undergrad",
      entSem, entYear, gradSem, gradYear,
      major: mj = "", major2: mj2 = "", conc: cc = "", conc2: cc2 = "", minor1: mn1 = "", minor2: mn2 = "",
    } = setup;

    // Apply to the live current plan; the auto-save effect persists it.
    setStudentTypeRaw(st);            try { localStorage.setItem(key("student-type"), st);      } catch {}
    if (entSem)  { setPlanEntSem(entSem);    try { localStorage.setItem(key("ent-sem"),  entSem);  } catch {} }
    if (entYear) { setPlanEntYear(entYear);  try { localStorage.setItem(key("ent-year"), entYear); } catch {} }
    if (gradSem) { setPlanGradSem(gradSem);  try { localStorage.setItem(key("grad-sem"), gradSem); } catch {} }
    if (gradYear){ setPlanGradYear(gradYear); try { localStorage.setItem(key("grad-year"),gradYear);} catch {} }
    setMajor(mj); setMajor2(mj2); setConc(cc); setConc2(cc2); setMinor1(mn1); setMinor2(mn2);
    setPlans(prev => prev.map(p => p.id === activePlanId ? { ...p, studentType: st } : p));

    try { localStorage.setItem(key("seen-cohort-setup"), "1"); } catch {}
    setShowCohortSetup(false);
    // Auto-run the feature tour once, right after first-run setup. Compute the
    // flag defensively so a storage failure still shows the tour on first run.
    let seenTour = false; try { seenTour = !!localStorage.getItem(key("seen-tour")); } catch {}
    if (!seenTour) setShowTour(true);
  };

  // On mount: detect a shared plan in the URL hash and offer to load it as a new plan.
  useEffect(() => {
    const encoded = getHashPlanParam();
    if (!encoded) return;
    history.replaceState(null, '', window.location.pathname + window.location.search);
    decodePlan(encoded)
      .then(d => {
        if (d.version !== 1 && d.version !== 2) { alert("Unrecognized shared plan format."); return; }
        // if (!window.confirm("Load the shared plan? It will open as a new plan alongside your existing ones.")) return;
        importSharedPlan(d);
      })
      .catch(() => alert("Could not decode the shared plan link."));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cohort setters that also persist to localStorage ─────────
  // When stickyCourses is on, snapshot placements + SEMESTERS before changing
  const setEntSem = sem => {
    if (stickyCourses) stickySnapshotRef.current = { placements: { ...placements }, specialTermPl: { ...specialTermPl }, sems: [...SEMESTERS] };
    setPlanEntSem(sem);
    try { localStorage.setItem(key("ent-sem"), sem); } catch {}
  };
  const setEntYear = year => {
    if (stickyCourses) stickySnapshotRef.current = { placements: { ...placements }, specialTermPl: { ...specialTermPl }, sems: [...SEMESTERS] };
    setPlanEntYear(year);
    try { localStorage.setItem(key("ent-year"), year); } catch {}
  };
  const setGradSem = sem => {
    if (stickyCourses) stickySnapshotRef.current = { placements: { ...placements }, specialTermPl: { ...specialTermPl }, sems: [...SEMESTERS] };
    setPlanGradSem(sem);
    try { localStorage.setItem(key("grad-sem"), sem); } catch {}
  };
  const setGradYear = year => {
    if (stickyCourses) stickySnapshotRef.current = { placements: { ...placements }, specialTermPl: { ...specialTermPl }, sems: [...SEMESTERS] };
    setPlanGradYear(year);
    try { localStorage.setItem(key("grad-year"), year); } catch {}
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

    // Follow-slots remap: courses stay in the same slot index across cohort changes.
    // Overflow courses (slot out of range) are marked "__overflow:N" — invisible in both
    // bank and semester rows, but the slot index N is remembered so they restore correctly
    // when the plan expands back. Graduation-trim overflow parks at original semId instead
    // (the semester vanishes from the plan, so it's already invisible and exact-date restore
    // works naturally).
    const remapSemId = (semId) => {
      // Already overflowed from a previous change — try to restore if slot is now in range.
      if (typeof semId === "string" && semId.startsWith("__overflow:")) {
        const n = parseInt(semId.slice(11));
        return (!isNaN(n) && n < newIds.length) ? newIds[n] : semId;
      }
      if (semId === "incoming") return semId;
      const idx = oldIds.indexOf(semId);
      if (idx === -1) return semId; // not in old plan (e.g. came from a prior overflow restore)
      if (idx < newIds.length) return newIds[idx]; // normal follow-slots remap
      // Overflow: slot idx is beyond the new plan.
      // If the semId is gone from the new plan (graduation trim) → park at semId so it
      // reappears automatically when graduation extends back past this date.
      // If the semId is still in the new plan (entry trim pushed it off the end) → use the
      // slot-index marker so it stays invisible and restores to the right slot on revert.
      return newIds.includes(semId) ? `__overflow:${idx}` : semId;
    };

    const newPl = {};
    for (const [cid, semId] of Object.entries(snap.placements)) {
      newPl[cid] = remapSemId(semId);
    }
    setPlacements(newPl);

    // Same rules for work experience / special term placements.
    if (snap.specialTermPl) {
      const newStp = {};
      for (const [id, data] of Object.entries(snap.specialTermPl)) {
        if (!data?.semId) continue;
        newStp[id] = { ...data, semId: remapSemId(data.semId) };
      }
      setSpecialTermPl(newStp);
    }
  }, [SEMESTERS]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Resolve overflow markers when entering follow-slots mode ─────
  // __overflow:N courses are created by follow-slots entry trims. In follow-dates mode
  // they stay invisible (they have no date to park at). When the user switches back to
  // follow-slots, immediately place them at their slot position in the current plan so
  // they become visible again without needing a cohort change.
  useEffect(() => {
    if (!stickyCourses) return;
    const resolveOverflow = semId => {
      if (typeof semId !== "string" || !semId.startsWith("__overflow:")) return null;
      const n = parseInt(semId.slice(11));
      return (!isNaN(n) && n < SEMESTERS.length) ? SEMESTERS[n].id : null;
    };
    setPlacements(prev => {
      let changed = false;
      const next = { ...prev };
      for (const [cid, semId] of Object.entries(prev)) {
        const resolved = resolveOverflow(semId);
        if (resolved) { next[cid] = resolved; changed = true; }
      }
      return changed ? next : prev;
    });
    setSpecialTermPl(prev => {
      let changed = false;
      const next = { ...prev };
      for (const [id, data] of Object.entries(prev)) {
        const resolved = resolveOverflow(data?.semId);
        if (resolved) { next[id] = { ...data, semId: resolved }; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [stickyCourses]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Offered overrides setter ─────────────────────────────────
  // offeredOverrides shape: { courseId: { semTypeId: true | false } }
  // Absent key = auto (probability-based). Cycle: auto → true → false → auto.
  const toggleOffered = (courseId, semTypeId) => {
    setOfferedOverrides(prev => {
      const cur    = prev[courseId];
      const curMap = (!cur || Array.isArray(cur)) ? {} : { ...cur };
      const existing = curMap[semTypeId];
      if (existing === undefined)   curMap[semTypeId] = true;
      else if (existing === true)   curMap[semTypeId] = false;
      else                          delete curMap[semTypeId];
      const next = { ...prev };
      if (Object.keys(curMap).length === 0) delete next[courseId];
      else next[courseId] = curMap;
      return next;
    });
  };

  // ── Effect: AI assistant — sync plan state to MCP server ─────────
  // Debounced: fires 400 ms after the last change so rapid edits don't flood.
  // Placed here (after all variable declarations) so deps like plans/activePlanId
  // are fully initialized before the dependency array is evaluated.
  // Build the sync payload. Kept in a ref (refreshed every render) so
  // one-off awaited syncs — e.g. right before an OAuth redirect leaves
  // the app — can send the current plan without waiting for the debounce.
  buildPlanContextRef.current = () => ({
    planId:    activePlanId,
    planName:  plans.find(p => p.id === activePlanId)?.name ?? "Untitled",
    major, major2, concentration: conc, concentration2: conc2, minor1, minor2,
    majorLabel: null, major2Label: null, minor1Label: null, minor2Label: null,
    studentType,
    currentSemId,
    entSem: planEntSem, entYear: planEntYear,
    gradSem: planGradSem, gradYear: planGradYear,
    placements,
    semOrders,
    workExperience: specialTermPl,
    placedOut: [...placedOut],
    substitutions,
    bonusSH,
    shOverrides,
    offeredOverrides,
    totalSHPlaced,
    totalSHDone,
    prereqViolationCount: prereqViolations.size,
    coreqViolationCount:  coreqViolations.size,
    // Grades never leave the browser (see docs/grades-design.md) — that
    // includes the derived "grade" violation state, which would disclose
    // that a grade was entered and was bad. "missing" is what the grade-
    // aware evaluator itself returns for a vetoed take (the requirement
    // needs another attempt), so the remap stays literally true.
    prereqViolations: Object.fromEntries(
      [...prereqViolations].map(([k, v]) => [k, v === "grade" ? "missing" : v])),
    coreqViolations:  Object.fromEntries(coreqViolations),
    starredIds: [...starredIds],
    palette,
    locale,
    coopGradConflicts,
    selectedCourseId: selectedId,
    allPlans: plans.map(p => ({
      id: p.id, name: p.name, active: p.id === activePlanId,
      ...(p.studentType && { studentType: p.studentType }),
    })),
  });

  useEffect(() => {
    if (!aiAssistant?.notifyChange) return;
    if (aiAssistant.isConsentEnabled && !aiAssistant.isConsentEnabled()) return;
    const timer = setTimeout(() => {
      aiAssistant.notifyChange(buildPlanContextRef.current());
    }, 400);
    return () => clearTimeout(timer);
  }, [ // eslint-disable-line react-hooks/exhaustive-deps
    aiAssistant, placements, specialTermPl, placedOut, substitutions,
    major, major2, conc, conc2, minor1, minor2, studentType, currentSemId, bonusSH, shOverrides,
    offeredOverrides, semOrders, planEntSem, planEntYear, planGradSem, planGradYear,
    selectedId, activePlanId, plans, starredIds, palette, locale,
    prereqViolations, coreqViolations, coopGradConflicts, claudeAccessRev,
  ]);

  // ── Claude ghost preview ──────────────────────────────────────────
  // Simulates a proposal with the SAME pure dry-run the MCP server uses
  // (shared adapter), so what the user previews is exactly what was
  // validated. The grid renders the simulated placements; the diff sets
  // drive the orange ghost styling on affected cards.
  const computeClaudePreview = (proposal) => {
    try {
    // Dry-run the changeset against a full snapshot (adapter field names)
    // so the simulated plan covers EVERY field a proposal can touch, not
    // just placements. The value block swaps these in so the whole UI
    // renders the proposed world; `diff` marks what changed (orange).
    const snap = {
      placements, semOrders,
      placedOut: [...placedOut], substitutions,
      workExperience: specialTermPl, shOverrides, offeredOverrides,
      currentSemId, bonusSH,
      major, major2, concentration: conc, concentration2: conc2, minor1, minor2, studentType,
      entSem: planEntSem, entYear: planEntYear, gradSem: planGradSem, gradYear: planGradYear,
      starredIds: [...starredIds], palette: [...palette],
      planId: activePlanId,
      planName: plans.find(p => p.id === activePlanId)?.name ?? "",
    };
    const { plan: next } = dryRunChangeset(snap, proposal.changeset?.actions ?? [], courseMap);

    // Course-placement diff (drives the grid ghosts).
    const added = {}, moved = {}, removed = new Set();
    for (const [id, sem] of Object.entries(next.placements ?? {})) {
      if (!(id in placements)) added[id] = sem;
      else if (placements[id] !== sem) moved[id] = { from: placements[id], to: sem };
    }
    for (const id of Object.keys(placements)) {
      if (!(id in (next.placements ?? {}))) removed.add(id);
    }

    // Scalar-field diff (drives orange marks on selectors/badges) + a
    // focus target so the right panel opens and scrolls into view.
    const changed = new Set();
    const scalar = { major, major2, conc, conc2, studentType, bonusSH, currentSemId,
      entSem: planEntSem, entYear: planEntYear, gradSem: planGradSem, gradYear: planGradYear,
      minor1, minor2, planName: snap.planName };
    const nextScalar = { major: next.major, major2: next.major2, conc: next.concentration, conc2: next.concentration2,
      studentType: next.studentType, bonusSH: next.bonusSH, currentSemId: next.currentSemId,
      entSem: next.entSem, entYear: next.entYear, gradSem: next.gradSem, gradYear: next.gradYear,
      minor1: next.minor1, minor2: next.minor2, planName: next.planName };
    for (const k of Object.keys(scalar)) if (scalar[k] !== nextScalar[k]) changed.add(k);

    const shOvChanged = new Set();
    for (const id of new Set([...Object.keys(shOverrides), ...Object.keys(next.shOverrides ?? {})]))
      if (shOverrides[id] !== next.shOverrides?.[id]) shOvChanged.add(id);

    const setDiff = (a, b) => {
      const A = new Set(a), B = new Set(b);
      return { added: [...B].filter(x => !A.has(x)), removed: [...A].filter(x => !B.has(x)) };
    };
    const starDiff = setDiff([...starredIds], next.starredIds ?? []);
    const palDiff  = setDiff([...palette], next.palette ?? []);
    const poDiff   = setDiff([...placedOut], next.placedOut ?? []);
    const subKey = s => `${s.from}→${s.to}`;
    const subDiff = setDiff(substitutions.map(subKey), (next.substitutions ?? []).map(subKey));
    // Work-term instances that are new or modified (drive orange term cards).
    const workTermsChanged = new Set();
    for (const [id, wt] of Object.entries(next.workExperience ?? {})) {
      if (JSON.stringify(wt) !== JSON.stringify(specialTermPl[id])) workTermsChanged.add(id);
    }
    const workChanged = workTermsChanged.size > 0 ||
      Object.keys(specialTermPl).some(id => !(next.workExperience ?? {})[id]);
    // Work terms leaving a semester render as ghosts at their ORIGINAL spot
    // (removed → strike-through; moved → origin marker), mirroring how
    // removed courses stay visible instead of silently vanishing.
    const ghostWorkTerms = [];
    for (const [id, orig] of Object.entries(specialTermPl)) {
      const nxt = (next.workExperience ?? {})[id];
      if (!nxt) ghostWorkTerms.push({ id, instance: orig });
      else if (nxt.semId !== orig.semId) ghostWorkTerms.push({ id, instance: orig, moved: true });
    }

    // Where to send the user's attention: programs → grad panel; a placed
    // course → focus it; cohort/credits → header; star/palette → bank.
    const programChanged = ["major", "major2", "conc", "minor1", "minor2", "studentType"].some(k => changed.has(k));
    const firstCourse = Object.keys(added)[0] ?? Object.keys(moved)[0] ?? [...removed][0] ?? null;
    let focus = null;
    if (programChanged)                              focus = { kind: "grad", field: [...changed].find(k => ["major","major2","conc","minor1","minor2","studentType"].includes(k)) };
    else if (firstCourse)                            focus = { kind: "course", courseId: firstCourse };
    else if (changed.has("bonusSH") || [...changed].some(k => k.startsWith("ent") || k.startsWith("grad") || k === "currentSemId" || k === "planName")) focus = { kind: "header" };
    else if (starDiff.added.length || starDiff.removed.length || palDiff.added.length || palDiff.removed.length ||
             poDiff.added.length || poDiff.removed.length || subDiff.added.length || subDiff.removed.length) focus = { kind: "bank", starred: starDiff.added.length + starDiff.removed.length > 0 };

    // Display placements keep removed courses at their original semester so
    // they render as strike-through ghosts instead of silently vanishing.
    // (Audits/credits use the true simulated plan via the pv* sources.)
    const displayPlacements = { ...(next.placements ?? {}) };
    for (const id of removed) displayPlacements[id] = placements[id];

    setClaudePreview({
      proposalId: proposal.proposalId,
      plan: next,
      placements: displayPlacements,
      added, moved, removed,
      changed,                    // scalar field keys
      shOvChanged,
      star: starDiff, palette: palDiff, placedOut: poDiff, substitutions: subDiff,
      workChanged, workTermsChanged, ghostWorkTerms,
      focus,
    });
    } catch (e) {
      // A proposal must never be able to crash the planner. No preview is
      // strictly better than a white screen; the card still shows the
      // action list so the user can review blind or reject.
      console.warn("Claude preview dry-run failed:", e);
      setClaudePreview(null);
    }
  };

  // Manual toggle from the card. A user "hide" is remembered so the
  // auto-preview effect doesn't immediately re-show it.
  const [previewDismissed, setPreviewDismissed] = useState(null); // proposalId the user hid
  const toggleClaudePreview = (proposal) => {
    if (!proposal) { setClaudePreview(null); return; }
    if (claudePreview?.proposalId === proposal.proposalId) {
      setClaudePreview(null);
      setPreviewDismissed(proposal.proposalId);
    } else {
      setPreviewDismissed(null);
      computeClaudePreview(proposal);
    }
  };

  // Preview auto-focus: scroll the first affected course into view. Panel
  // switching (grad panel / bank) is handled where that local state lives
  // (BankPanel); course cards register DOM nodes in cardRefs.
  useEffect(() => {
    const f = claudePreview?.focus;
    if (f?.kind !== "course") return;
    const timer = setTimeout(() => {
      cardRefs.current[f.courseId]?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    }, 250);
    return () => clearTimeout(timer);
  }, [claudePreview?.proposalId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Single source of truth for the preview: whenever the head proposal or
  // the real plan changes, recompute the head proposal's preview against
  // current placements (so it's shown by default and stays accurate through
  // edits), or clear it when there's no proposal or the user hid this one.
  // One effect avoids an ordering race between "auto-show" and
  // "clear-on-mutation" when approving 1 of N changes both at once.
  const headProposalId = mcpProposals[0]?.proposalId ?? null;
  useEffect(() => {
    const head = mcpProposals[0];
    if (head && previewDismissed !== head.proposalId) computeClaudePreview(head);
    else setClaudePreview(null);
  }, [headProposalId, placements, specialTermPl, previewDismissed]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect: AI assistant — handle incoming MCP events ────────────
  // Fresh-closure ref: the effect subscribes once, but plan reads must see
  // current state (same pattern as onDropPaletteRef).
  const readPlanContentsRef = useRef(null);
  readPlanContentsRef.current = (planId) => {
    if (!planId || planId === activePlanId) return captureCurrentPlan();
    try {
      const raw = localStorage.getItem(key(`plan-data-${planId}`));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  };

  useEffect(() => {
    if (!aiAssistant?.onEvent) return;
    const unsubscribe = aiAssistant.onEvent((event) => {
      if (event.type === "REQUEST_PLAN") {
        aiAssistant.respondPlanContents?.(
          event.requestId,
          readPlanContentsRef.current?.(event.planId) ?? null
        );
        return;
      }
      if (event.type === "PROPOSAL") {
        // Dedupe by id: reconnects replay pending proposals (see the
        // server's SSE connect handler), so the same one can arrive twice.
        setMcpProposals(prev => prev.some(p => p.proposalId === event.proposalId) ? prev : [...prev, {
          proposalId:  event.proposalId,
          changeset:   event.changeset,
          meta:        event.meta ?? {},
          fingerprint: JSON.stringify(stateRef.current.placements),
        }]);
        return;
      }
      if (event.type === "PROPOSAL_RESOLVED") {
        setMcpProposals(prev => prev.filter(p => p.proposalId !== event.proposalId));
        return;
      }
      if (event.type === "APPLY") {
        const { actions } = event.changeset ?? {};
        if (!Array.isArray(actions) || !actions.length) return;
        pushUndo();
        applyMCPActions(actions);
        return;
      }
      if (event.type === "COMMAND") {
        executeMCPCommand(event.command);
      }
    });
    return unsubscribe;
  }, [aiAssistant]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Context value ─────────────────────────────────────────────
  const value = {
    // Data
    courses, courseMap, effectiveCourseMap, allEdges, subjects,
    // Load state
    loading, loadErr, loadPct,
    // Planner state
    // While a Claude proposal preview is active, the WHOLE simulated plan
    // renders (placements, work terms, programs, credits, stars, palette…)
    // so every proposal type has a visible preview. All real state (sync,
    // persistence, undo) keeps using the actual state vars.
    placements: claudePreview ? claudePreview.placements : placements,
    effectivePlacements,
    substitutions: pvSubstitutions,
    specialTermPl: pvSpecialTerms,
    currentSemId: pv?.currentSemId ?? currentSemId,
    persistEnabled,
    semOrders,
    offeredOverrides: pv?.offeredOverrides ?? offeredOverrides,
    collapsedSubs,
    shOverrides: pvShOverrides,
    // Semester grid
    SEMESTERS, SEM_INDEX, SEM_NEXT, SEM_PREV,
    // UI state
    selectedId, dragInfo, hoveredSem, hoveredZone, hoveredCardId,
    showPanel, lines, scrollTick, showViolLines,
    prereqDepth, setPrereqDepth, unlockDepth, setUnlockDepth, showPrereqTree,
    // Bank state
    bankSearch, bankSort, bankTab, bankFilters, bankWidth, showSubjectKeys,
    wideCatalog, setWideCatalog, wideWidth, setWideWidth,
    starredIds: pv ? new Set(pv.starredIds ?? []) : starredIds,
    bankCourseIds,
    // Settings
    showDisclaimer, showSettings, showStats, setShowStats,
    statsVisible, statsJustUnlocked, ackStatsUnlockFlash: () => setStatsJustUnlocked(false),
    showDonate, setShowDonate,
    collapseOtherCredits, setCollapseOtherCredits: updateCollapseOtherCredits,
    privateGrades, setPrivateGrades: updatePrivateGrades,
    showContLogo, setShowContLogo: updateShowContLogo,
    showUnlocks, setShowUnlocks: updateShowUnlocks,
    semTrackingMode, setSemTrackingMode: updateSemTrackingMode,
    semAdvanceToast, setSemAdvanceToast,
    clockOverride, setClockOverride,
    stickyCourses, setStickyCourses,
    // Cohort previews swap the displayed values (orange in the 🎓 dropdown)
    // without rebuilding the semester grid — SEMESTERS stays on real state.
    planEntSem:  pv?.entSem   ?? planEntSem,
    planEntYear: pv?.entYear  ?? planEntYear,
    planGradSem: pv?.gradSem  ?? planGradSem,
    planGradYear: pv?.gradYear ?? planGradYear,
    entOrd, gradOrd, semOrd: _semOrd,
    panelHeight, panelHeightManual,
    isPhone, isMobile, uiScale, manualZoom, setManualZoom,
    // Derived
    currentSemIdx, placedIds, specialTermStartMap, specialTermContMap,
    gradSemId, coopGradConflicts,
    isGraduated, setIsGraduated,
    prereqViolations, coreqViolations, connectedIds,
    grades, setGrade, enteredGpaStat,
    totalSHPlaced, totalSHDone,
    bonusSH: pvBonusSH, setBonusSH,
    major:  pv?.major  ?? major,  setMajor,
    major2: pv?.major2 ?? major2, setMajor2,
    conc:   pv?.concentration ?? conc, setConc,
    conc2:  pv?.concentration2 ?? conc2, setConc2,
    minor1: pv?.minor1 ?? minor1, setMinor1,
    minor2: pv?.minor2 ?? minor2, setMinor2,
    studentType: pv?.studentType ?? studentType,
    setStudentType,
    showNewPlanModal, setShowNewPlanModal,
    newPlanInitialType, setNewPlanInitialType,
    placedOut: pvPlacedOut, setPlacedOut,
    // MCP / AI assistant
    mcpProposals,
    // Head proposal was computed against a plan the user has since edited
    // (compared against the REAL placements, not a preview).
    mcpProposalStale: mcpProposals.length > 0 &&
      mcpProposals[0].fingerprint !== JSON.stringify(placements),
    // Per-proposal variant for the queue browser (same REAL-placements rule).
    isProposalStale: (p) => !!p && p.fingerprint !== JSON.stringify(placements),
    claudeAccessEnabled, setClaudeAccess, aiAssistantAvailable: !!aiAssistant,
    claudeAutoApply, setClaudeAutoApply,
    claudePaired, confirmClaudePairing, claudeDisconnect,
    claudeOAuthRequest, resolveClaudeOAuth,
    claudePreview, toggleClaudePreview,
    // Decide the proposal at the head of the queue (FIFO — later
    // changesets may assume earlier ones landed).
    confirmMCPProposal: (accepted) => {
      const head = mcpProposals[0];
      if (!head) return;
      setClaudePreview(null);
      if (accepted) {
        pushUndo();
        applyMCPActions(head.changeset?.actions ?? []);
      }
      aiAssistant?.confirmProposal?.(head.proposalId, accepted);
      setMcpProposals(prev => prev.filter(p => p.proposalId !== head.proposalId));
    },
    // Approve the whole queue at once. Applied as ONE combined changeset
    // (applyMCPActions reads a state snapshot, so per-proposal loops would
    // clobber each other) and ONE undo entry; each proposal still gets its
    // own resolution back to Claude.
    confirmAllMCPProposals: () => {
      if (mcpProposals.length === 0) return;
      setClaudePreview(null);
      pushUndo();
      applyMCPActions(mcpProposals.flatMap(p => p.changeset?.actions ?? []));
      for (const p of mcpProposals) aiAssistant?.confirmProposal?.(p.proposalId, true);
      setMcpProposals([]);
    },
    // Refs (passed through for DOM measurements)
    timelineRef, cardRefs, bankRef, bankResizing, panelResizing, uiScaleRef,
    // Actions
    setSelectedId, setShowPanel, setDragInfo,
    setHoveredSem, setHoveredZone, setHoveredCardId,
    setShowViolLines,
    setBankSearch, setBankSort, setBankTab, setBankFilters, setBankWidth, setShowSubjectKeys,
    setCollapsedSubs,
    setShowDisclaimer, setShowSettings,
    showCohortSetup, setShowCohortSetup, finishOnboarding,
    showTour, setShowTour,
    setPersistEnabled,
    setOfferedOverrides,
    setShOverride: (id, value) => setShOverrides(prev => {
      const next = { ...prev };
      if (value === null || value === undefined) delete next[id]; else next[id] = value;
      return next;
    }),
    setPlacements, setSpecialTermPl, setSemOrders, setCurrentSemId,
    setEntSem, setEntYear, setGradSem, setGradYear,
    resetAll, exportPlanJSON, importPlanJSON, copyPlanLink,
    plans, activePlanId, switchPlan, createPlan, deletePlan, bulkDeletePlans, renamePlan,
    toggleStar, toggleOffered,
    getSemStatus,
    substitutions: pvSubstitutions,
    addSubstitution: (fromId, toId) => setSubstitutions(prev =>
      prev.some(s => s.from === fromId && s.to === toId) ? prev : [...prev, { from: fromId, to: toId }]
    ),
    removeSubstitution: (fromId, toId) => setSubstitutions(prev =>
      prev.filter(s => !(s.from === fromId && s.to === toId))
    ),
    palette: pv?.palette ?? palette, removeFromPalette, onDropPalette, showPalette, setShowPalette,
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
