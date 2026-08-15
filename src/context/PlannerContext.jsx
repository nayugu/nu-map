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
import { createContext, useContext, useState, useRef, useEffect, useMemo, useCallback } from "react";
import { NUM_YEARS } from "../core/constants.js";
import { buildCohortSemesters, deriveSemMaps } from "../core/semGrid.js";
import { extractEdges, coreqPartnersOf } from "../core/courseModel.js";
import { evalPrereqTree } from "../core/prereqEval.js";
import { pruneSemOrders } from "../core/planSchema.js";
import { RATINGS_KEY, readRatings, setRatingField, getRating } from "../core/ratingStore.js";
import { planConditions } from "../core/prereqConditions.js";
import { getSemSH, getOrderedCourses, getConnectionsToDepth, applySubstitutions, inTimeline } from "../core/planModel.js";
import { semesterOccupants, occupantCards, moveReservation, removeReservation, isReservationId } from "../core/reservations.js";
import { reservationEdges } from "../core/reservationEdges.js";
import { satisfiedUnderEveryOption } from "../core/reservationPrereqs.js";
import { dropOnCard as resolveDropOnCard, dropOnSemester, dropOnBank } from "../core/planDrop.js";
import { buildSemesterView, cardIdsIn, cardsIn, loadIn } from "../core/semesterView.js";
import { applySamplePlan as mapSamplePlan } from "../core/applySamplePlan.js";
import { baseId, isInstanceId, takesUsed, resolveAddId, resolveDropId, retakeUnlocked, buildTakesResolver } from "../core/repeatInstances.js";
import { takeConsumesSlot, yieldsCredit, satisfiesGate, enteredGPA, countsInGPA,
         effectiveGradeOfTakes } from "../core/gradeSystem.js";
import { resolveTermByDuration, termSpans } from "../core/specialTermUtils.js";
import { loadSaved, saveState } from "../data/persistence.js";
import { encodePlan, decodePlan, buildShareUrl, getHashPlanParam, getHashCodeParam } from "../core/planShare.js";
import { tabTitle, FIRST_PLAN_NAME } from "../core/tabTitle.js";
import { buildTree, planMove, applyMove, deleteScope, uniqueName, siblingNames,
         topmostNodes, childDepth, MAX_DEPTH, applyReorder,
         siblingsInOrder, SORT_MODES } from "../core/planFolders.js";
import { buildLibraryFile, parseLibraryFile, mergeLibrary,
         libraryToArchive, archiveToLibrary, flatPlanFiles,
         FILE_ENVELOPE_KEYS } from "../core/planLibraryFile.js";
import { writeZip, readZip } from "../core/zipFile.js";
import { useLanguage }     from "./LanguageContext.jsx";
import { usePort }         from "./InstitutionContext.jsx";
import { IInstitution }   from "../ports/IInstitution.js";
import { ICalendar }      from "../ports/ICalendar.js";
import { IClock }         from "../ports/IClock.js";
import { ICourseCatalog } from "../ports/ICourseCatalog.js";
import { ISpecialTerms }  from "../ports/ISpecialTerms.js";
import { IAIAssistant }   from "../ports/IAIAssistant.js";
import { IShareRelay }    from "../ports/IShareRelay.js";
import { IAcceleratedPathway } from "../ports/IAcceleratedPathway.js";
import { pathwaySubstitutions, mergeSubstitutions } from "../core/pathway/shareSet.js";
// Shared pure dry-run — the same applier the MCP server validates with,
// reused here for the proposal ghost preview.
import { applyChangeset as dryRunChangeset } from "../adapters/mcp/plannerActionAdapter.js";

// A shared frozen empty list, so the no-pathway case keeps a stable identity and
// every memo downstream of it skips recomputing.
const EMPTY_SUBS = Object.freeze([]);

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

// The identifying detail of a co-op: the employer, its logo, and the role
// line. The "hide co-op details" privacy toggle strips exactly these while
// leaving the term's structure (type, semester, length) intact.
const COOP_PRIVATE_FIELDS = ["company", "companyDomain", "subline"];
function redactCoopDetails(stp) {
  if (!stp) return stp;
  const out = {};
  for (const [id, entry] of Object.entries(stp)) {
    const clean = { ...entry };
    for (const f of COOP_PRIVATE_FIELDS) delete clean[f];
    out[id] = clean;
  }
  return out;
}

export function PlannerProvider({ children }) {
  // `t` is memoized on locale in LanguageContext, so taking it here adds no
// render churn; importPlanJSON needs it to report failures in the user's
// language instead of the raw English it used to alert().
const { locale, setLocale, locales, t } = useLanguage();
  const institution    = usePort(IInstitution);
  const calendar       = usePort(ICalendar);
  const clock          = usePort(IClock);
  const courseCatalog  = usePort(ICourseCatalog);
  const specialTerms   = usePort(ISpecialTerms);
  const aiAssistant    = usePort(IAIAssistant);
  const shareRelay     = usePort(IShareRelay);
  const acceleratedPathway = usePort(IAcceleratedPathway);

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
  // Cards in a semester that have no course yet. Their own map, never in
  // `placements` — see src/core/reservations.js on why the audit must not be
  // able to see one.
  const [reservations,     setReservations]     = useState(() => (_saved?.persist && _saved.reservations) ? _saved.reservations : {});
  // Which sample plan this canvas was built from, if any: {programKey, planLabel}.
  //
  // Provenance, and the reason the offer to load one can come BACK. "Offer when
  // the canvas is empty" looks sufficient and is not — load a plan, change
  // major, and the canvas is no longer empty, so an emptiness rule goes silent
  // forever and the student keeps the old major's plan with no way out.
  //
  // It proves the canvas STARTED as a sample plan. It does not prove the
  // student has left it alone, so replacing is still destructive.
  const [appliedTemplate,  setAppliedTemplate]  = useState(() => (_saved?.persist && _saved.appliedTemplate) ? _saved.appliedTemplate : null);
  // A sample plan chosen during first-run setup, waiting for the cohort that
  // setup also chose. Never persisted — it exists for one render.
  const [pendingSamplePlan, setPendingSamplePlan] = useState(null);
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
  // Declared accelerated BS/MS pathway id (Northeastern: "PlusOne"), or "".
  // Undergraduate plans only. One field: the shares are DERIVED from the
  // pathway plus what is placed, never stored — see core/pathway/shareSet.js.
  const [plusOne,     setPlusOne]        = useState("");
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

  // Non-course prereq conditions the plan itself satisfies — a graduate plan
  // IS graduate program admission, which 209 catalog courses list as the OR
  // alternative to their undergraduate prereq chain (see prereqConditions.js).
  // Preview-aware like everything else here, so a SET_STUDENT_TYPE preview
  // re-evaluates prereqs for the proposed world.
  const prereqConditions = useMemo(
    () => planConditions({ studentType: pv?.studentType ?? studentType }),
    [pv?.studentType, studentType]
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

    // Accumulated-credit repeatable-course requirements (XOM `accumulate: true`, e.g. "68
    // SH of SMFA 3000" — see gradRequirements.js) need the real summed credit across every
    // term a course was repeated; the requirement layer only ever sees this deduplicated
    // map, one entry per base course key, so a repeat's own SH would otherwise be invisible
    // to it. Sum each instance's EFFECTIVE sh (its shOverride, since a repeatable/variable-
    // credit course like SMFA 3000 is exactly what shOverrides exists for — a fixed default
    // would never reach 68) onto the base key as `repeatTotalSh`, mirroring the same
    // computation plannerQueryAdapter.js does for the MCP audit path.
    const repeatTotals = {};
    for (const id of Object.keys(placements)) {
      const base = baseId(id);
      const c = catalogCourseMap[base];
      if (!c) continue;
      const sh = pvShOverrides[id] ?? c.sh ?? 0;
      repeatTotals[base] = (repeatTotals[base] ?? 0) + sh;
    }

    const merged = clones ? { ...catalogCourseMap, ...clones } : catalogCourseMap;
    if (!Object.keys(repeatTotals).length) return merged;
    const withRepeats = { ...merged };
    for (const [base, total] of Object.entries(repeatTotals)) {
      withRepeats[base] = { ...withRepeats[base], repeatTotalSh: total };
    }
    return withRepeats;
  }, [catalogCourseMap, placements, pvPlacements, pvPlacedOut, pvShOverrides]);

  // ── Sticky Courses ──
  const stickySnapshotRef = useRef(null);
  const [stickyCourses, setStickyCourses] = useState(() => {
    try { return localStorage.getItem(key("sticky-courses")) !== "false"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem(key("sticky-courses"), String(stickyCourses)); } catch {}
  }, [stickyCourses]);

  // ── UI: Other credits collapse setting ──
  //
  // Defaults OFF, so a course a student adds is VISIBLE where they put it.
  // Collapsing is the tidier view once you know the layout, but for someone
  // meeting the planner for the first time a card that vanishes into a folded
  // row reads as the app having lost it — and "did that work?" is the worst
  // question a first action can raise. Anyone who prefers the compact view
  // turns it on once and the choice persists.
  const [collapseOtherCredits, setCollapseOtherCredits] = useState(() => {
    try {
      const v = localStorage.getItem(key("collapse-other-credits"));
      // Chosen explicitly at some point — that choice wins, always.
      if (v !== null) return v !== "false";

      // Never chosen, so a default applies. But "never chosen" covers two very
      // different people: someone opening the app for the first time, and
      // someone who has used it for months and simply never touched this
      // toggle. Changing a default is only free for the first.
      //
      // So a RETURNING install keeps the old behaviour. `seen-cohort-setup` is
      // written when first-run setup completes, which makes it the honest
      // marker for "has used this app before". Their layout does not move
      // under them, and the toggle is still there if they want the change.
      //
      // A saved plan counts too: someone who cleared that flag, or who started
      // before it existed, is plainly not a new user, and their plan is exactly
      // the thing that should not rearrange itself.
      const seen  = !!localStorage.getItem(key("seen-cohort-setup"));
      const hasPlan = Object.keys(_saved?.placements ?? {}).length > 0;
      return seen || hasPlan;
    } catch { return false; }
  });
  const updateCollapseOtherCredits = (val) => {
    setCollapseOtherCredits(val);
    try { localStorage.setItem(key("collapse-other-credits"), String(val)); } catch {}
  };

  // ── Your own course ratings (hours / difficulty) ──
  // Deliberately NOT part of the plan, and not in a plan slot. A grade
  // belongs to a scenario — it moves the GPA, gates prereqs, decides
  // whether a requirement is met. A rating belongs to you: you sat in that
  // course once, whichever plan you happen to be looking at. Keeping it
  // out of the plan means it survives switching, deleting and importing
  // plans, and — the part that matters — it cannot ride into an export or
  // a share link at all, structurally rather than by remembering a flag at
  // each of the four doors. See src/core/ratingStore.js.
  const [ratings, setRatings] = useState(() => {
    try { return readRatings(localStorage.getItem(key(RATINGS_KEY))); }
    catch { return {}; }
  });
  const setRating = useCallback((courseId, semId, field, value) => {
    setRatings(prev => {
      const next = setRatingField(prev, courseId, semId, field, value);
      try { localStorage.setItem(key(RATINGS_KEY), JSON.stringify(next)); } catch {}
      return next;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const ratingFor = useCallback(
    (courseId, semId) => getRating(ratings, courseId, semId), [ratings]);

  // ── Consent to contribute ratings ──
  // Three states, not a boolean: "unasked" is not "no", and treating it as
  // one would either nag someone who declined or, worse, let a first
  // submission slip out from a default. Nothing may ever leave the device
  // while this is anything other than "on".
  //
  // Per-device rather than per-plan, and never part of a plan slot: a
  // consent decision must not ride into a share link or an exported file,
  // where it would silently become someone else's answer.
  const [ratingConsent, setRatingConsentRaw] = useState(() => {
    try {
      const v = localStorage.getItem(key("rating-consent"));
      return v === "on" || v === "off" ? v : "unasked";
    } catch { return "unasked"; }
  });
  const setRatingConsent = useCallback((val) => {
    const v = val === "on" || val === "off" ? val : "unasked";
    setRatingConsentRaw(v);
    try { localStorage.setItem(key("rating-consent"), v); } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** The single gate every submission path must pass through. */
  const mayShareRatings = ratingConsent === "on";

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

  // ── Privacy: hide co-op company / role ──
  // Same shape and spirit as privateGrades: it hides, never deletes. The
  // company, logo and role stay in storage and reappear when switched off.
  // What it suppresses is the co-op's identity everywhere the plan is shown
  // or sent — the board, exports, share links, PDFs and Claude — while the
  // term itself (type, dates, length) stays visible.
  const [privateCoop, setPrivateCoop] = useState(() => {
    try { return localStorage.getItem(key("private-coop")) === "true"; } catch { return false; }
  });
  const updatePrivateCoop = (val) => {
    setPrivateCoop(val);
    try { localStorage.setItem(key("private-coop"), String(val)); } catch {}
  };
  // Single choke point for everything that READS the plan for display or
  // export: consumers see this, never the raw specialTermPl, so there's no
  // per-surface opt-in to forget. Storage keeps the raw values untouched.
  const specialTermPlSafe = useMemo(
    () => privateCoop ? redactCoopDetails(pvSpecialTerms) : pvSpecialTerms,
    [privateCoop, pvSpecialTerms]
  );

  // ── UI: Show logo on continuation rows ──
  const [showContLogo, setShowContLogo] = useState(() => {
    try { const v = localStorage.getItem(key("show-cont-logo")); return v === null ? true : v !== "false"; } catch { return true; }
  });
  const updateShowContLogo = (val) => {
    setShowContLogo(val);
    try { localStorage.setItem(key("show-cont-logo"), String(val)); } catch {}
  };

  // ── UI: Show "Unlocks" section in info panel ──
  // Default on: purely additive info (a course's outgoing prereqs/coreqs),
  // gated on there being any to show, so there's no clutter cost. Anyone who
  // explicitly turned it off keeps that choice — same pattern as showContLogo.
  const [showUnlocks, setShowUnlocks] = useState(() => {
    try { const v = localStorage.getItem(key("show-unlocks")); return v === null ? true : v !== "false"; } catch { return true; }
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
  // Which folder a new plan lands in — set before opening the modal by
  // "+ New plan" inside a folder; null means root.
  const [newPlanFolderId,     setNewPlanFolderId]     = useState(null);
  const [showPlanLibrary,     setShowPlanLibrary]     = useState(false);
  // Arriving on a share-code link (a scanned QR) as a first-time visitor is
  // the COMMON case for that link, and first-run onboarding is exactly wrong
  // for it twice over: it covers the import confirm, and finishing it writes
  // entry/grad/type onto the plan that was just imported, silently replacing
  // the cohort the sender chose. The shared plan already carries all of it,
  // so onboarding is deferred while the code is redeemed — and restored (see
  // Header) if the code turns out to be dead, because then the visitor really
  // is a first-timer with nothing.
  //
  // Read here, in a render-phase initializer, because Header strips the hash
  // in an effect — by the time effects run the evidence is gone.
  const [onboardingDeferredForShare] = useState(() => {
    try {
      return !!getHashCodeParam() && !localStorage.getItem(key("seen-cohort-setup"));
    } catch { return false; }
  });
  const [showCohortSetup,  setShowCohortSetup]  = useState(() => {
    // Pure read — the "seen" flag is written on completion (finishOnboarding),
    // not here, so a reload mid-setup re-shows it rather than stranding the user.
    // Append ?onboarding to the URL to force it during development.
    try {
      if (new URLSearchParams(window.location.search).has("onboarding")) return true;
      if (getHashCodeParam()) return false;
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
  // Monotonic tail for minted plan ids — see `newPlanId`.
  const planIdSeq     = useRef(0);
  // True while a directory picker is open. Only one may exist at a time, and
  // a dialog left open must never wedge export for the rest of the session.
  const exportBusy    = useRef(false);
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
    saveState(storagePrefix, persistEnabled, { placements, reservations, specialTermPl, currentSemId, collapsedSubs, semOrders, offeredOverrides, shOverrides, bonusSH, placedOut: [...placedOut], substitutions, grades: gradesRaw, appliedTemplate, planId: activePlanId });
  }, [persistEnabled, placements, reservations, specialTermPl, currentSemId, collapsedSubs, semOrders, offeredOverrides, shOverrides, bonusSH, substitutions, gradesRaw]);

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
      saveState(storagePrefix, persistEnabled, { placements, reservations, specialTermPl, currentSemId, collapsedSubs, semOrders, offeredOverrides, shOverrides, bonusSH, placedOut: [...placedOut], substitutions, grades: gradesRaw, appliedTemplate, planId: activePlanId });
      // The SLOT is what the app reloads from, so it needs the same net.
      saveCurrentPlanToSlot();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [persistEnabled, placements, reservations, specialTermPl, currentSemId, collapsedSubs, semOrders, offeredOverrides, shOverrides, bonusSH, substitutions, gradesRaw]);

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
    // `reservations` is here so snapshotPlan can reach it — undo reads state
    // through this ref, so a field absent here is a field undo cannot restore.
    stateRef.current    = { placements, reservations, specialTermPl, semOrders, placedOut, grades: gradesRaw, appliedTemplate };
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

  // ── Scrolling and the SVG lines ──────────────────────────────
  // There used to be a scroll listener here that bumped a `scrollTick` state
  // so the lines effect below re-measured every card on every scroll event —
  // a full provider re-render plus a full re-measure per frame, which is why
  // the lines lagged and looked frozen while the timeline moved.
  //
  // They don't need re-measuring. Every line endpoint is a card INSIDE the
  // timeline, so a scroll moves all of them by the same amount: the picture
  // is unchanged, only shifted. RelationLines translates the overlay by that
  // shift on each scroll event, which is exact and costs no React work. All
  // this side owes it is the offset the current geometry was measured at.
  const linesScrollRef = useRef(0);

  // effectivePlacements: real placements + virtual entries for substitution targets.
  // When CS3500 → CS4400 substitution exists and CS3500 is placed in fall2024,
  // CS4400 is added as if placed in fall2024. Credits use only real `placements`.
  // ── Accelerated-pathway (PlusOne) substitutions ─────────────────
  //
  // A declared pathway contributes its published graduate→undergraduate swaps.
  // They are DERIVED here, never stored: `noGradIfUgDone` requires a share to
  // disappear once the undergraduate version is in the plan, which a saved copy
  // could not do without a sync step, and deriving keeps one source of truth
  // when the pathway data is next updated.
  //
  // Pre-arming every candidate is inert by construction: applySubstitutions
  // fires only `if (placements[from])`, so declaring a pathway changes nothing
  // until a graduate course is actually placed.
  const pathwayForPlan = useMemo(
    () => (plusOne && studentType !== "graduate"
      ? acceleratedPathway.getPathway(plusOne)
      : null),
    [plusOne, studentType, acceleratedPathway]
  );

  const pathwaySubs = useMemo(
    () => (pathwayForPlan
      ? pathwaySubstitutions({ pathway: pathwayForPlan, placements: pvPlacements, placedOut: pvPlacedOut })
      : EMPTY_SUBS),
    [pathwayForPlan, pvPlacements, pvPlacedOut]
  );

  // What satisfaction is computed against. The student's own list stays separate
  // (and is what persists, shares and appears in the substitutions editor) so
  // derived entries can never be "removed" into a saved state that contradicts
  // the pathway.
  const effectiveSubstitutions = useMemo(
    () => mergeSubstitutions(pvSubstitutions, pathwaySubs),
    [pvSubstitutions, pathwaySubs]
  );

  const effectivePlacements = useMemo(
    () => applySubstitutions(pvPlacements, effectiveSubstitutions),
    [pvPlacements, effectiveSubstitutions]
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
  // Edges a reservation borrows from the courses it could become, so a card
  // reading "IE 3412 or MATH 3081" connects to an IE 4516 that requires either.
  // Only what holds under EVERY option, and only for cards that name their
  // options — see src/core/reservationEdges.js.
  //
  // Deliberately NOT merged into `allEdges`. That array also drives coreq
  // partner lookup for drags (six call sites), and a synthesised corequisite
  // would put a reservation id into `coreqPartners`, which is a list of courses
  // to move. Lines are the only consumer that should see these.
  const reservationLineEdges = useMemo(
    () => reservationEdges(reservations, allEdges, { courseMap: effectiveCourseMap }),
    [reservations, allEdges, effectiveCourseMap]);

  const lineEdges = useMemo(
    () => (reservationLineEdges.length ? [...allEdges, ...reservationLineEdges] : allEdges),
    [allEdges, reservationLineEdges]);

  // WHERE A CARD SITS, reservations included.
  //
  // `placements` answers a different question — "what counts toward the degree"
  // — and by design can never hold a reservation. Drawing a line is a question
  // about position, so it must ask this instead, or every synthesised edge is
  // discarded at the gate for having an endpoint that is not a placement.
  //
  // `semesterOccupants` is the shared derivation (the same one the grid and
  // ordering use); building a third combined map by hand here is exactly the
  // duplication the isolation invariants exist to prevent. It returns
  // `placements` unchanged when there are no reservations, so this is free for
  // a plan without any.
  const cardSemOf = useMemo(
    () => semesterOccupants(placements, reservations), [placements, reservations]);

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
    // A reservation is on the board too. It is not in `placements` — that map
    // answers "what counts toward the degree" and must never see one — so it is
    // added here, where the question is only "is there a card to draw to".
    for (const r of Object.values(reservations)) {
      if (r?.semId && r.semId !== "incoming") takeOf[r.id] ??= r.id;
    }
    const placedEdges = lineEdges.filter(e => takeOf[e.from] && takeOf[e.to]);
    const selBase = baseId(selectedId);
    const edges = getConnectionsToDepth(selBase, placedEdges, prereqDepth, unlockDepth);
    // Re-anchor endpoints onto concrete cards — the take the user actually
    // clicked, and for other courses whose plain id isn't placed, the take
    // that is. Untouched edges keep their allEdges identity (the SVG-lines
    // effect de-dups against it).
    const anchor = (id) =>
      id === selBase ? selectedId
      : isReservationId(id) ? id            // a reservation has no takes to resolve
      : (placements[id] && placements[id] !== "incoming") ? id
      : takeOf[id];
    return edges.map(e => {
      const f = anchor(e.from), t = anchor(e.to);
      return f === e.from && t === e.to ? e : { ...e, from: f, to: t };
    });
  }, [selectedId, lineEdges, reservations, placements, prereqDepth, unlockDepth]);

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
          // Position questions, so they read the combined view — an endpoint
          // may be a reservation, which is never in `placements`.
          const fromSem = cardSemOf[rel.from], toSem = cardSemOf[rel.to];
          if (!fromSem || !toSem) return;
          // Disable prereq/error lines for courses in 'incoming' semester
          if (fromSem === "incoming" || toSem === "incoming") return;
          const fp = getCenter(rel.from);
          const tp = getCenter(rel.to);
          if (!fp || !tp) return;
          let type = rel.type;
          if (rel.type === "prerequisite") {
            const fromIdx = SEM_INDEX[fromSem] ?? -1;
            const toIdx   = SEM_INDEX[toSem]   ?? -1;
            // concurrent prereq: same-semester is valid, only flag if strictly after
            if (fromIdx > toIdx || (fromIdx === toIdx && !rel.concurrent)) type = "prerequisite-order";
          }
          if (rel.type === "corequisite" && fromSem !== toSem) {
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
            const prereqResult = evalPrereqTree(toCourse.prereqs, effectivePlacements, SEM_INDEX, ti, pvPlacedOut, null, prereqConditions);

            // Grade-blocked: placement satisfied, but an entered grade vetoes
            // the tree. Draw a dotted red from every take of this prereq whose
            // ENTERED grade fails this edge's gate — the line disappears when
            // the grade is cleared or a satisfying retake is placed (the
            // grade-aware result flips back to satisfied). Dead until a grade
            // exists: takesOf is null with none entered.
            if (prereqResult === "satisfied" && takesOf &&
                evalPrereqTree(toCourse.prereqs, effectivePlacements, SEM_INDEX, ti, pvPlacedOut, takesOf, prereqConditions) !== "satisfied") {
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

      // The offset these coordinates were measured at. RelationLines shifts
      // the overlay by whatever the timeline has scrolled since, so the lines
      // stay glued to their cards without another measure pass.
      linesScrollRef.current = timelineRef.current?.scrollTop ?? 0;
      setLines(newLines);
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedId, connectionEdges, showViolLines, placements, cardSemOf, effectivePlacements, substitutions, specialTermPl, allEdges, SEM_INDEX, pvPlacedOut, takesOf, grades, prereqConditions]);

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
            // Only written when true: absent means a domestic work term, which
            // is the default 147 of 152 co-op requirement nodes want.
            ...(action.abroad === true && { abroad: true }),
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
            // Deleted rather than set false, so the stored shape stays "absent
            // means domestic" and a share link never carries a redundant key.
            if (action.abroad != null) { if (action.abroad) cur.abroad = true; else delete cur.abroad; }
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
        // Recoverable for 30 days, and one ⌘Z in the library puts it back. That
        // matters most on THIS door: a delete Claude performed is the one the
        // user is least likely to have meant.
        case "DELETE_PLAN":    deleteNodes([action.planId]);                      break;
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
  /**
   * Everything an edit can change, captured in one place.
   *
   * This shape existed three times — pushUndo, and the counter-push inside
   * each of doUndo and doRedo — and `reservations` was added to none of them.
   * So loading a plan and pressing undo removed its courses and left every
   * reserved card behind, and moving or deleting a reservation could not be
   * undone at all.
   *
   * One function, because a field added to two of three copies is the exact
   * bug that produced that.
   */
  const snapshotPlan = () => ({
    placements:    stateRef.current.placements,
    reservations:  stateRef.current.reservations,
    specialTermPl: stateRef.current.specialTermPl,
    semOrders:     stateRef.current.semOrders,
    grades:        stateRef.current.grades,
    // Undoing the load of a sample plan must also forget that it was loaded,
    // or the offer stays suppressed for a plan that is no longer there.
    appliedTemplate: stateRef.current.appliedTemplate ?? null,
  });

  /** Apply a snapshot. The mirror of snapshotPlan, and the only reader of it. */
  const restoreSnapshot = (snap) => {
    setPlacements(snap.placements);
    // A snapshot taken before this field existed has no key; treating that as
    // "none" would delete cards an undo was never asked to touch.
    if (snap.reservations) setReservations(snap.reservations);
    setSpecialTermPl(snap.specialTermPl);
    setSemOrders(snap.semOrders);
    if (snap.grades) setGrades(snap.grades);
    // Undefined means a snapshot from before this field existed — leave
    // provenance alone rather than clearing something the undo never touched.
    if (snap.appliedTemplate !== undefined) setAppliedTemplate(snap.appliedTemplate);
  };

  const pushUndo = () => {
    undoStack.current = [...undoStack.current.slice(-49), snapshotPlan()];
    redoStack.current = [];
  };

  const doUndo = () => {
    if (!undoStack.current.length) return;
    const snap = undoStack.current[undoStack.current.length - 1];
    redoStack.current = [...redoStack.current, snapshotPlan()];
    undoStack.current = undoStack.current.slice(0, -1);
    restoreSnapshot(snap);
  };

  const doRedo = () => {
    if (!redoStack.current.length) return;
    const snap = redoStack.current[redoStack.current.length - 1];
    undoStack.current = [...undoStack.current, snapshotPlan()];
    redoStack.current = redoStack.current.slice(0, -1);
    restoreSnapshot(snap);
  };

  // ── Effect: keyboard shortcuts ────────────────────────────────
  useEffect(() => {
    const onKey = e => {
      if (e.target.matches("input, textarea, select, [contenteditable]")) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        const selId = selectedIdRef.current;
        const pl    = stateRef.current.placements;
        // A reservation deletes with the same key as a course, because to the
        // student it is the same act — it just lives in a different map.
        if (selId && isReservationId(selId)) {
          pushUndo();
          setReservations(prev => removeReservation(prev, selId));
          setSelectedId(null);
          return;
        }
        if (selId && pl[selId]) {
          pushUndo();
          const fromSem = pl[selId];
          const coreqPartners = coreqPartnersOf(allEdgesRef.current, selId);
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
      const result = evalPrereqTree(c.prereqs, effectivePlacements, SEM_INDEX, ti, pvPlacedOut, null, prereqConditions);
      if (result !== "satisfied") {
        // An undecided card may already guarantee this. A plan placing
        // "IE 3412 or MATH 3081" before IE 4516 — whose prerequisite is exactly
        // that choice — satisfies it whichever way the student decides, so
        // warning about it is false. Cleared ONLY when every option satisfies
        // the prerequisite tree, which is a stronger test than the edge rule in
        // reservationEdges.js: both options appear in "A AND B" while neither
        // satisfies it.
        const guaranteed = satisfiedUnderEveryOption(c, ti, {
          reservations, placements: effectivePlacements, semIndex: SEM_INDEX,
          placedOut: pvPlacedOut, courseMap, conditions: prereqConditions,
        });
        if (guaranteed !== true) v.set(c.id, result);
        return;
      }
      // Grade layer: placement says satisfied, but an ENTERED grade may veto
      // (an F/U/I/W attempt, or a letter under the ref's minGrade). Only the
      // comparison of the two results can say "blocked by grade" — the
      // evaluator's enum has no such state on purpose. takesOf is null until
      // a grade is entered, so this branch is dead by default.
      if (takesOf) {
        const graded = evalPrereqTree(c.prereqs, effectivePlacements, SEM_INDEX, ti, pvPlacedOut, takesOf, prereqConditions);
        if (graded !== "satisfied") v.set(c.id, "grade");
      }
    });
    return v;
  }, [courses, pvPlacements, effectivePlacements, pvPlacedOut, SEM_INDEX, takesOf, prereqConditions, reservations, courseMap]);

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
    for (const r of lineEdges) {
      if (r.from === selectedId && !(r.to   in m)) m[r.to]   = r.type;
      if (r.to   === selectedId && !(r.from in m)) m[r.from] = r.type;
    }
    return m;
  }, [selectedId, connectionEdges, lineEdges]);

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
  // PLANNED credit — what this plan comes to if it is carried out. Reserved
  // credit belongs here: a freshly loaded template is roughly half reservations,
  // and excluding them would report a four-year degree as half a degree and
  // read as broken. It is deliberately NOT in totalSHDone below, which is
  // credit EARNED — nothing is earned for a course nobody has chosen.
  const totalSHReserved = useMemo(
    () => Object.values(reservations).reduce(
      (s, r) => s + (inTimeline(r.semId, SEM_INDEX) ? (r.sh ?? 0) : 0), 0),
    [reservations, SEM_INDEX]
  );

  const totalSHPlaced = useMemo(
    () => pvBonusSH + totalSHReserved + Object.entries(pvPlacements)
      .filter(([id, sid]) => inTimeline(sid, SEM_INDEX) && !pvPlacedOut.has(id) && !supersededTakes.has(id))
      .reduce((s, [id]) => s + (effectiveCourseMap[id]?.sh ?? 0), 0),
    [pvBonusSH, totalSHReserved, pvPlacements, pvPlacedOut, effectiveCourseMap, SEM_INDEX, supersededTakes]
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

  // ── The grid's combined view ─────────────────────────────────────
  // ONE answer to "what is in this semester". Twelve call sites used to derive
  // it themselves and each had to choose correctly between the raw maps and a
  // combined one; three shipped bugs came from that choice, not from its
  // difficulty. See src/core/semesterView.js.
  //
  // Built from pvPlacements, NOT `placements`. While a Claude proposal is
  // previewed, pvPlacements is the SIMULATED plan and every other surface
  // renders it; a view built from the real state would have shown the grid the
  // student's actual courses while the header and grad panel showed the
  // proposal. Reservations are unsimulated on purpose — no proposal action
  // touches them yet, so they carry over unchanged and stay visible under a
  // preview rather than blinking out of the plan.
  const semView = useMemo(
    () => buildSemesterView({ placements: pvPlacements, reservations, courseMap: effectiveCourseMap }),
    [pvPlacements, reservations, effectiveCourseMap]);

  /** The cards in a semester, in draw order. The only way to ask. */
  const semesterCards = useCallback(
    (semId) => cardsIn(semId, semView, semOrders), [semView, semOrders]);
  /** Their ids, for consumers that key by id. */
  const semesterCardIds = useCallback(
    (semId) => cardIdsIn(semId, semView, semOrders), [semView, semOrders]);
  /** A semester's study load, reservations included — term load, never degree credit. */
  const semesterLoad = useCallback(
    (semId) => loadIn(semId, semView, specialTermStartMap, specialTermContMap),
    [semView, specialTermStartMap, specialTermContMap]);

  // Kept for the drop resolver, which needs the raw pair to compute against a
  // hypothetical order inside a state updater.
  const gridPlacements = semView.occupants;
  const gridCourseMap  = semView.cards;

  // ── Reveal: scroll the grid to a course ──────────────────────────
  // Naming a course anywhere in the app — a bank row, a prereq chip, a
  // requirement row, a NUPath witness, an MCP FOCUS_COURSE — should take the
  // student TO it when it is in their plan. Selecting a card the user cannot
  // see highlights nothing and draws relation lines off screen.
  //
  // This half is state only: which card, and unhiding it. The measuring and
  // the animation are DOM work and live in ui/smoothScroll.js, driven from
  // App.jsx — a context that reached into the ui layer would invert the
  // dependency the hexagon exists to keep one-way.
  const [revealTarget, setRevealTarget] = useState(null); // { pid, n }

  /**
   * Ask the timeline to show the card for `rawId`, if there is one.
   *
   * The id handed in is NOT reliably a card id. The grad panel and the info
   * panel's links deal in base course keys ("CS3500"); the stats panel and
   * the NUPath witnesses deal in real placement ids, which for a retake is
   * "CS3500#2". Resolving one to the other is the whole reason this is a
   * shared action rather than a `scrollIntoView` at each call site.
   */
  const revealCourse = useCallback((rawId) => {
    if (!rawId) return false;
    let pid = null;
    if (gridPlacements[rawId] !== undefined) pid = rawId;
    else {
      // Not placed under that exact id — find the take that IS on the board.
      // Earliest term wins, deliberately: with CS2500 and CS2500#2 both
      // placed, "show me CS2500" means the one the student took first, and
      // any rule that depends on object key order would be a coin flip.
      const base = baseId(rawId);
      let bestIdx = Infinity;
      for (const [id, sid] of Object.entries(gridPlacements)) {
        if (baseId(id) !== base) continue;
        const idx = SEM_INDEX[sid] ?? Infinity;
        if (idx < bestIdx) { bestIdx = idx; pid = id; }
      }
    }
    // Not in the plan, or parked outside the cohort's years: there is no card
    // on screen, so there is nothing to scroll to and we do nothing at all.
    // Silence is the honest answer — a scroll to "somewhere" would be worse.
    const semId = pid ? gridPlacements[pid] : null;
    if (!semId || !inTimeline(semId, SEM_INDEX)) return false;

    // A card inside a COLLAPSED section is not something scrolling can reach.
    // Special/incoming rows collapse through `collapsedSubs`, which lives
    // here; the low-credit ("other") zone collapses through local state in
    // SemRow/SummerRow, which watch `revealTarget` and open themselves once.
    const semType = SEMESTERS.find(s => s.id === semId)?.type;
    const isSubRow = semType !== "fall" && semType !== "spring" && semType !== "summer";
    if (isSubRow && collapsedSubs[semId] !== false) {
      // Same map as the bank's per-subject collapse, keyed by semester id
      // there and by subject code here — disjoint key spaces, one store.
      setCollapsedSubs(p => ({ ...p, [semId]: false }));
    }

    // Counter, not just the id: clicking the same course twice must scroll
    // twice (the user may have scrolled away in between), and identical
    // state would not re-run the effect.
    setRevealTarget(prev => ({ pid, n: (prev?.n ?? 0) + 1 }));
    return true;
  }, [gridPlacements, SEM_INDEX, SEMESTERS, collapsedSubs]);

  // Every course-identifying click already sets `selectedId` — that is what
  // "the user pointed at this course" means here. Hanging the reveal off it
  // covers all ~14 of those sites at once, including ones added later, rather
  // than asking each to remember. Nothing else writes `selectedId`: it is not
  // restored from storage and no drop or import sets it, so this cannot fire
  // on its own.
  useEffect(() => {
    if (selectedId) revealCourse(selectedId);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Lay out a department's published plan.
   *
   * Strictly additive: a course already placed stays where it is, and nothing
   * is removed. Goes through pushUndo like any other edit, so a student who
   * does not like the result gets it back in one step.
   */
  /**
   * Load a department's sample plan onto this canvas.
   *
   * `programKey` records WHICH program's plan this is, so the offer to load one
   * can come back when the student changes major — see `appliedTemplate`.
   * Callers that omit it (the temporary loader) still work; they just leave no
   * provenance, and the offer behaves as though none had been loaded.
   */
  const applySamplePlanToPlan = (plan, programData = null, startYearIndex = 0, programKey = null,
                                { replace = false } = {}) => {
    const result = mapSamplePlan(plan, {
      semesters: SEMESTERS, courseMap,
      // REPLACE lays the plan out on a clean canvas rather than beside what is
      // there. A sample plan assumes year 1 is your first year with nothing
      // done, so merging it into an existing plan produces a lopsided canvas
      // that is neither the student's nor the department's. Destructive, which
      // is why the caller confirms and why pushUndo below is the way back.
      placements:    replace ? {} : placements,
      reservations:  replace ? {} : reservations,
      specialTermPl: replace ? {} : specialTermPl,
      programData, startYearIndex,
      // The adapter states durations as objects ({id,label,duration,weight});
      // the mapper compares months, so pass the numbers.
      coopDurations: (specialTerms?.getTypes?.() ?? [])
        .find(t => t.id === "coop")?.durations?.map(d => d.duration) ?? [6],
    });
    pushUndo();
    setPlacements(result.placements);
    setReservations(result.reservations);
    setSpecialTermPl(result.specialTermPl);
    if (programKey) setAppliedTemplate({ programKey, planLabel: plan?.label ?? "" });
    return result;
  };

  // Apply a sample plan chosen during first-run setup, once the cohort chosen
  // in that same step has actually landed. finishOnboarding cannot do it
  // inline: its own setPlanEntSem/setPlanGradYear calls have not flushed, so
  // SEMESTERS there is still the timeline the app booted with, and a four-year
  // plan would be filed against the wrong years.
  useEffect(() => {
    if (!pendingSamplePlan) return;
    applySamplePlanToPlan(pendingSamplePlan.plan, null, 0, pendingSamplePlan.programKey);
    setPendingSamplePlan(null);
  }, [pendingSamplePlan, SEMESTERS]); // eslint-disable-line react-hooks/exhaustive-deps

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

  /**
   * Draw the drag image ourselves, from a copy parked on <body>.
   *
   * Safari renders NO drag image for an element inside a transformed
   * ancestor, and on desktop this whole app lives inside
   * `transform: scale(uiScale)` (App.jsx) for the zoom control. So a dragged
   * course went invisible the moment it left the cursor and reappeared where
   * it landed: the drop always worked, which is exactly why it read as a
   * rendering glitch. Chrome and Firefox rasterise it regardless, so it
   * looked correct everywhere else.
   *
   * The clone goes on <body>, OUTSIDE the scaled container, and re-applies
   * the same scale itself — otherwise the ghost would be the layout size
   * rather than the size actually on screen, and would not line up with the
   * card the user grabbed. It has to be in the document for the browser to
   * rasterise it, and has to survive the current frame, so it is parked
   * offscreen and removed on the next tick.
   *
   * Best-effort: any failure leaves the browser's own default image, which is
   * what every non-Safari browser was using anyway.
   */
  const setCardDragImage = (e) => {
    try {
      const el = e.currentTarget;
      const rect = el?.getBoundingClientRect?.();
      if (!rect?.width || !rect.height || !el.offsetWidth) return;
      const scale = rect.width / el.offsetWidth;
      const clone = el.cloneNode(true);
      Object.assign(clone.style, {
        position: "fixed", top: "-10000px", left: "-10000px", margin: "0",
        width: `${el.offsetWidth}px`, height: `${el.offsetHeight}px`,
        transformOrigin: "0 0", transform: `scale(${scale})`,
        pointerEvents: "none", opacity: "1",
      });
      document.body.appendChild(clone);
      // Grab point, in the ghost's own coordinates — so the card stays under
      // the cursor exactly where it was picked up.
      e.dataTransfer.setDragImage(clone, e.clientX - rect.left, e.clientY - rect.top);
      setTimeout(() => clone.remove(), 0);
    } catch { /* default drag image */ }
  };

  const onDragStart = (e, id, type, fromSem, extra = {}) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "move";
    // Safari will not render a drag image unless the drag carries DATA. Chrome
    // and Firefox are lenient and synthesise a ghost from the source element
    // anyway, so for years this looked fine everywhere except Safari, where a
    // dragged course went invisible mid-flight and only reappeared once it
    // landed — the drop itself always worked, which is why it read as a
    // rendering glitch rather than a missing call. The plan-library tree sets
    // this and has never had the problem; the canvas did not and always has.
    // Wrapped because a few browsers throw here when a drag is already active.
    try { e.dataTransfer.setData("text/plain", String(id)); } catch {}
    setCardDragImage(e);
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

    // A reservation dropped anywhere in a term is a move, and it moves in
    // `reservations`. Falling through to the course path below would write a
    // reservation id into `placements` — the pollution the whole split exists
    // to prevent, and what made cards vanish or behave oddly after a drag.
    const resMove = dropOnSemester({ placements, reservations, semOrders }, { dragId: id, semId });
    if (resMove) { setReservations(resMove.reservations); setDragInfo(null); return; }

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
      const dropId = resolveDropId(dragInfo, { placements, courseMap, placedOut, grades });
      const fromSem = placements[dropId];
      if (fromSem === semId) { setDragInfo(null); return; }
      // Always move ALL coreq partners together with the dragged course
      // (repeat instances have no edges of their own, so extra takes move alone)
      const coreqPartners = coreqPartnersOf(allEdges, dropId);
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
        const baseOrder = next[semId] || getOrderedCourses(semId, gridPlacements, prev, gridCourseMap);
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

    // Dragging a reservation to the bank removes it from the plan. There is no
    // bank entry to return it to — it was never a course — so this is a delete,
    // which is what the gesture means for a card with nothing behind it.
    const resDel = dropOnBank({ placements, reservations, semOrders }, { dragId: id });
    if (resDel) { setReservations(resDel.reservations); setDragInfo(null); return; }

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
      const coreqPartners = coreqPartnersOf(allEdges, id);
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
    // Placing out means "I already have credit for this course". There is no
    // course yet, so the gesture has no meaning — ignored rather than half-done.
    if (isReservationId(dragInfo?.id)) { setDragInfo(null); return; }
    try {
      if (!dragInfo || dragInfo.type !== "course") return;
      pushUndo();
      const { id, fromSem } = dragInfo;

      // Add to placedOut set
      setPlacedOut(prev => new Set([...prev, id]));

      // If the course was placed in a semester, remove it from placements
      if (placements[id]) {
        // Placing out a lecture unschedules its recitation: the pair is only
        // meaningful as a pair, and leaving the partner alone on the board
        // would be a card with nothing it belongs to.
        const coreqPartners = coreqPartnersOf(allEdges, id);

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

      setPalette(prev => prev.filter(cid => cid !== id));
      setDragInfo(null);
    } catch (error) {
      console.error('Error in onDropPlacedOut:', error);
    }
  };

  const onDropPalette = (e) => {
    // The palette holds courses to place later. A reservation is already in the
    // plan and names no course, so there is nothing to park.
    if (isReservationId(dragInfo?.id)) { setDragInfo(null); return; }
    e?.preventDefault?.();
    if (!dragInfo || dragInfo.type !== "course") return;
    const { id, fromSem } = dragInfo;
    if (palette.includes(id)) { setDragInfo(null); return; }
    pushUndo();
    const coreqPartners = coreqPartnersOf(allEdges, id);
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
    // The SAME resolution the semester drop does. A drag from outside the grid
    // of a course already in the plan is an ADD — another take of a repeatable,
    // or a retake once every take is graded — not a move. Dropping on a card
    // used to skip this entirely, so the identical gesture added a take on a
    // term's empty space and moved the existing take onto a card.
    const dragId = resolveDropId(dragInfo, { placements, courseMap, placedOut, grades });

    // Reservations at either end of the gesture. The decision is a pure
    // function (src/core/planDrop.js) so each case can be enumerated in a test
    // — this logic lived inline as setX calls, where three separate bugs
    // shipped because nothing could exercise it.
    // Every drop that is purely a REORDER goes through the shared resolver,
    // whatever the two cards are. Keeping a second copy of "which side of the
    // target does it land on" is what made a forward drag a no-op: the copy
    // below removed the card and then inserted at the target's OLD index, which
    // after the removal is the position it came from. Backward drags worked, so
    // it read as a per-semester quirk rather than one rule with a missing case.
    //
    // The course path below still owns what only it does — placing out,
    // special-term validation, cross-term coreq carrying.
    const sameSemReorder = !isReservationId(dragId) && placements[dragId] === targetSemId;
    // A card dragged in from OUTSIDE the grid — the bank, the requirements
    // panel, the info panel — has no seat, so it cannot swap; it can only take
    // the target's place. Routed to the shared resolver with the rest.
    //
    // The legacy path below assumes the dragged card has a seat and writes
    // `placements[targetId] = placements[dragId]`, which for one of these drags
    // is `undefined` — un-placing the card that was dropped on. The reservation
    // half of the same family was a silent no-op. One rule now covers both.
    const noSeat = !isReservationId(dragId) && placements[dragId] == null;
    if (isReservationId(dragId) || isReservationId(targetId) || sameSemReorder || noSeat) {
      const next = resolveDropOnCard(
        { placements, reservations, semOrders },
        { dragId, targetId, targetSemId },
        {
          gridPlacements, gridCourseMap,
          coreqPartners: coreqPartnersOf(allEdges, dragId),
          // The resolver asks about the DISPLACED card too, so a swap through
          // this door carries both sides' corequisites.
          partnersOf: (id) => coreqPartnersOf(allEdges, id),
        },
      );
      if (next) {
        setPlacements(next.placements);
        setReservations(next.reservations);
        setSemOrders(next.semOrders);
      }
      setDragInfo(null);
      return;
    }

    const fromSem = placements[dragId];
    const targetSemType = SEMESTERS.find(s => s.id === targetSemId)?.type;

    // Always carry all coreq partners of the dragged course
    const coreqPartners = coreqPartnersOf(allEdges, dragId);
    const allMoving = [dragId, ...coreqPartners];

    // ── And the DISPLACED card carries its own ──────────────────────
    //
    // Dropping onto an occupied card in another term is a SWAP: the target
    // goes back to the semester the dragged card left. It was the only card
    // in the app that moved semester without its corequisites — so dragging
    // CS 3500 onto CS 3000 sent CS 3000 across the board and left CS 3001
    // behind, a coreq violation created by the very rule that exists to
    // prevent them. Every other path moves one card in one direction, which
    // is why this hid: the bug needed a target that was both occupied and in
    // a different term.
    //
    // The dragged card's group wins any overlap. If the two cards are each
    // other's partners they are already in `allMoving` and must not be split
    // apart by being sent in opposite directions.
    const targetPartners = coreqPartnersOf(allEdges, targetId, allMoving);
    const allSwapped = [targetId, ...targetPartners];

    if (targetSemType === "special") {
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
          next[sid] = (next[sid] || getOrderedCourses(sid, gridPlacements, prev, gridCourseMap)).filter(cid => !allMoving.includes(cid));
        });
        const toOrder = getOrderedCourses(targetSemId, gridPlacements, prev, gridCourseMap);
        next[targetSemId] = [...toOrder.filter(cid => !allMoving.includes(cid)), dragId, ...coreqPartners];
        return next;
      });
    } else {
      // Different sem — swap targetId ↔ fromSem, move dragId+coreqs → targetSemId
      const fromOrder = getOrderedCourses(fromSem,     gridPlacements, semOrders, gridCourseMap);
      const toOrder   = getOrderedCourses(targetSemId, gridPlacements, semOrders, gridCourseMap);
      const fi = fromOrder.indexOf(dragId), ti = toOrder.indexOf(targetId);
      setPlacements(p => {
        const n = { ...p, [dragId]: targetSemId, [targetId]: fromSem };
        coreqPartners.forEach(cid => { n[cid] = targetSemId; });
        // After the dragged group, so an id claimed by both lands with the
        // card that was actually dragged.
        targetPartners.forEach(cid => { n[cid] = fromSem; });
        return n;
      });
      setSemOrders(prev => {
        const next = { ...prev };
        // nf: remove dragId+coreqs, insert targetId+its coreqs where dragId was
        const nf = fromOrder.filter(c => !allMoving.includes(c) && !allSwapped.includes(c));
        nf.splice(Math.min(fi, nf.length), 0, ...allSwapped);
        // nt: remove targetId+its coreqs, insert dragId+coreqs where it was
        const nt = toOrder.filter(c => !allSwapped.includes(c));
        nt.splice(Math.min(ti, nt.length), 0, dragId, ...coreqPartners);
        // Remove either group from any OTHER sem it was in — a partner does
        // not have to have been sitting with the card it belongs to.
        coreqPartners.forEach(cid => {
          const cOld = placements[cid];
          if (cOld && cOld !== fromSem && cOld !== targetSemId)
            next[cOld] = (next[cOld] || []).filter(x => x !== cid);
        });
        targetPartners.forEach(cid => {
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
    // Reservations are plan contents like any other card. Left behind, a reset
    // plan keeps every reserved cell — a term full of "Khoury Elective" in a
    // plan with no courses and no major, which reads as the reset having
    // failed rather than as anything deliberate.
    setReservations({});
    // A reset canvas came from nothing. Keeping the provenance would suppress
    // the offer to load a sample plan that is no longer there — the exact
    // failure the field exists to prevent, pointed the other way.
    setAppliedTemplate(null);
    setSpecialTermPl({});
    setSemOrders({});
    setOfferedOverrides({});
    // These four drifted out of the reset while `restorePlan` kept handling
    // them, so a plan created down the no-slot path inherited the PREVIOUS
    // plan's credit-hour overrides and applied requirement substitutions —
    // and `captureCurrentPlan` then wrote them into the new slot as though
    // they had always belonged to it. Silently wrong numbers in a plan the
    // advisor believes is empty, which is the worst shape a bug can take
    // here.
    setSubstitutions([]);
    setShOverrides({});
    setCollapsedSubs({});
    setCurrentSemId(_defSemId);          // its own initial value, not null
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
      const v = raw ? JSON.parse(raw) : null;
      // Validated like `folders` is, and for the same reason: a key that
      // parses to an object, or to [], reaches render as a non-array and the
      // first `plans.map` throws — a blank app that reloads blank every time,
      // because the bad value is still in storage. A truncated write, a hand
      // edit or another tab can all produce one.
      if (Array.isArray(v) && v.length && v.every(p => p && typeof p.id === "string")) return v;
    } catch {}
    return [{ id: "default", name: FIRST_PLAN_NAME }];
  });
  // Whether the plan index EXISTED before this session — read once, in a lazy
  // initializer, because the persist effect below writes the key on mount and
  // would make every visitor look like a returning one a tick later. Used only
  // by the tab title (see below).
  const [hadStoredPlans] = useState(() => {
    try { return !!localStorage.getItem(key("plan-index")); } catch { return false; }
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

  // ── Folders ──────────────────────────────────────────────────────
  // Folder membership lives on the plan INDEX (`parentId`), never in a plan's
  // data slot: moving a plan you aren't currently viewing must not require a
  // read-modify-write of another plan's snapshot. That also keeps
  // captureCurrentPlan/restorePlan untouched, so the plan-persistence
  // invariant test has nothing new to police.
  //
  // Three keys, deliberately separate:
  //   folder-index — the structure (id, name, parentId)
  //   folder-open  — which folders are expanded. VIEW state, and it has to be
  //                  separate: search force-opens every folder holding a match,
  //                  so if expansion were part of the structure, clearing a
  //                  query would either leave the tree splayed open or need a
  //                  save/restore dance around every keystroke.
  //   folder-sort  — 'name' | 'recent' | 'manual'
  const [folders, setFolders] = useState(() => {
    try {
      const raw = localStorage.getItem(key("folder-index"));
      const v = raw ? JSON.parse(raw) : null;
      if (Array.isArray(v)) return v;
    } catch {}
    return [];
  });
  const [openFolders, setOpenFolders] = useState(() => {
    try {
      const raw = localStorage.getItem(key("folder-open"));
      const v = raw ? JSON.parse(raw) : null;
      if (Array.isArray(v)) return new Set(v);
    } catch {}
    return new Set();
  });
  // An unrecognised stored value falls back to 'name' rather than being
  // trusted: this key predates 'manual', and a future mode removed in a later
  // version must not leave the library sorting by a rule that no longer exists.
  const [folderSort, setFolderSort] = useState(() => {
    try {
      const v = localStorage.getItem(key("folder-sort"));
      return SORT_MODES.includes(v) ? v : "name";
    } catch { return "name"; }
  });

  useEffect(() => {
    try { localStorage.setItem(key("folder-index"), JSON.stringify(folders)); } catch {}
  }, [folders]);
  useEffect(() => {
    try { localStorage.setItem(key("folder-open"), JSON.stringify([...openFolders])); } catch {}
  }, [openFolders]);
  useEffect(() => {
    try { localStorage.setItem(key("folder-sort"), folderSort); } catch {}
  }, [folderSort]);

  // The derived tree — one per (plans, folders) so the header dropdown, the
  // library panel and keyboard navigation all read the same structure.
  const planTree = useMemo(() => buildTree({ plans, folders }), [plans, folders]);

  // ── Folder undo/redo, and retained plan data ─────────────────────
  // A recursive folder delete is the one unrecoverable action in the library,
  // so deleting a plan NO LONGER removes its `plan-data-<id>` slot. The slot
  // stays and the id is tombstoned, which makes undo a pure index restore —
  // nothing has to be reconstructed. Tombstones are swept after TRASH_TTL so
  // abandoned slots cannot grow without bound in a 5 MB store.
  //
  // History is snapshots, not inverse commands: the plan index and folder list
  // hold only ids, names and parents, so a snapshot is a few hundred bytes and
  // cannot drift out of sync with the operation it is meant to reverse.
  const TRASH_TTL_DAYS = 30;
  const TRASH_TTL_MS = TRASH_TTL_DAYS * 24 * 60 * 60 * 1000;
  const FOLDER_HISTORY_MAX = 50;

  const [planTrash, setPlanTrash] = useState(() => {
    try {
      const raw = localStorage.getItem(key("plan-trash"));
      const v = raw ? JSON.parse(raw) : null;
      if (v && typeof v === "object" && !Array.isArray(v)) return v;
    } catch {}
    return {};
  });
  const [folderPast, setFolderPast] = useState([]);
  const [folderFuture, setFolderFuture] = useState([]);

  useEffect(() => {
    try { localStorage.setItem(key("plan-trash"), JSON.stringify(planTrash)); } catch {}
  }, [planTrash]);

  // Sweep expired tombstones once per session — this is the only thing that
  // ever reclaims a deleted plan's storage.
  useEffect(() => {
    const now = Date.now();
    const expired = Object.keys(planTrash).filter(id => now - (planTrash[id]?.deletedAt ?? 0) > TRASH_TTL_MS);
    if (expired.length === 0) return;
    for (const id of expired) {
      try { localStorage.removeItem(key(`plan-data-${id}`)); } catch {}
    }
    setPlanTrash(prev => {
      const next = { ...prev };
      for (const id of expired) delete next[id];
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Deleted plans that can still be brought back, newest first.
   *
   * A tombstone is only honest if its slot is still there, so this checks.
   * The sweep runs once per session; a tombstone whose slot went missing some
   * other way (a cleared origin, a hand-edited store) must not be offered as
   * restorable and then restore an empty plan.
   */
  const trashedPlans = useMemo(() => {
    const out = [];
    for (const [id, rec] of Object.entries(planTrash)) {
      let alive = false;
      try { alive = localStorage.getItem(key(`plan-data-${id}`)) != null; } catch {}
      if (!alive) continue;
      out.push({ id, name: rec?.name || "Plan", deletedAt: rec?.deletedAt ?? 0 });
    }
    return out.sort((a, b) => b.deletedAt - a.deletedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planTrash, storagePrefix]);

  /**
   * Put a deleted plan back at the top level.
   *
   * Its slot never went anywhere — deleting only removed the index record —
   * so this is a pure index restore, the same thing undo does. It returns to
   * ROOT rather than to the folder it came from: that folder may itself have
   * been deleted, and re-creating a chain of folders to hold one restored
   * plan invents structure the user did not ask for. Undo is the way back to
   * exactly where it was; this is the way back from a reload, where the undo
   * history is gone and the plan is otherwise unreachable.
   */
  const restorePlanFromTrash = (id) => {
    const rec = planTrash[id];
    if (!rec) return { ok: false, reason: "gone" };
    let raw = null;
    try { raw = localStorage.getItem(key(`plan-data-${id}`)); } catch {}
    if (raw == null) return { ok: false, reason: "gone" };
    if (plans.some(p => p.id === id)) return { ok: false, reason: "gone" };

    let studentType = "undergrad";
    try { studentType = JSON.parse(raw).studentType === "graduate" ? "graduate" : "undergrad"; } catch {}

    pushFolderHistory();
    setPlans(prev => [...prev, {
      // Deduplicated like every other name at root: a plan deleted because a
      // replacement already exists would otherwise come back as its twin.
      id, studentType,
      name: uniqueName(siblingNames(planTree, null), rec.name || "Plan"),
      parentId: null, lastOpened: Date.now(),
    }]);
    setPlanTrash(prev => { const next = { ...prev }; delete next[id]; return next; });
    return { ok: true, id };
  };

  /**
   * `activePlanId` must always name a plan that exists.
   *
   * Nothing asserted it, and two routes break it. Under storage pressure the
   * index write can fail (it is the large key) while the 12-byte active-plan
   * write succeeds, so a reload names a plan the index never got. And with
   * two tabs open, one tab deleting the plan the OTHER has active leaves
   * `active-plan` pointing at it — `deleteNodes` only reseats the pointer
   * when the plan it deleted was active in ITS tab.
   *
   * The symptom is quiet and permanent: no row is marked active, the header
   * falls back to a default name, and the autosave keeps writing a slot no
   * index lists. Reseating costs nothing when the pointer is already valid.
   */
  useEffect(() => {
    if (!plans.length) return;
    if (plans.some(p => p.id === activePlanId)) return;
    setActivePlanId(plans[0].id);
  }, [plans, activePlanId]);

  /**
   * Adopt the plan index when ANOTHER TAB changes it.
   *
   * Without this, two tabs are last-writer-wins over the whole library, and
   * the loser is whichever tab writes second — not whichever is stale. An
   * advisor with the library open in one tab and a student's plan in another
   * is the normal case, and the catastrophic version needs no delete at all:
   * an old tab writes the index on ANY change to `plans`, including
   * `switchPlan` stamping `lastOpened`. So merely clicking a plan in a
   * morning tab could erase every plan created in the afternoon one.
   *
   * Adopting on the `storage` event keeps a tab from ever being stale enough
   * to do that. `storage` fires only in OTHER tabs of the same origin, so
   * this cannot loop against our own writes.
   *
   * Deliberately NOT adopted: `active-plan`. Which plan this tab is looking
   * at is local to this tab, and yanking the canvas out from under someone
   * because another window switched plans would be its own bug. The dangling
   * guard below reseats it if the plan it names really is gone.
   */
  useEffect(() => {
    const onStorage = (e) => {
      if (e.storageArea && e.storageArea !== localStorage) return;
      if (!e.key || e.newValue == null) return;
      const parse = (fallback) => {
        try { const v = JSON.parse(e.newValue); return v ?? fallback; } catch { return fallback; }
      };
      if (e.key === key("plan-index")) {
        const v = parse(null);
        if (Array.isArray(v) && v.length && v.every(p => p && typeof p.id === "string")) setPlans(v);
      } else if (e.key === key("folder-index")) {
        const v = parse(null);
        if (Array.isArray(v)) setFolders(v);
      } else if (e.key === key("plan-trash")) {
        const v = parse(null);
        if (v && typeof v === "object" && !Array.isArray(v)) setPlanTrash(v);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storagePrefix]);

  const folderSnapshot = () => ({ plans, folders, activePlanId });

  /** Record the pre-mutation state. Call immediately before mutating. */
  const pushFolderHistory = () => {
    setFolderPast(prev => [...prev.slice(-(FOLDER_HISTORY_MAX - 1)), folderSnapshot()]);
    setFolderFuture([]);
  };

  const applyFolderSnapshot = (snap) => {
    const alive = new Set(snap.plans.map(p => p.id));
    // Tombstone whatever this snapshot drops, revive whatever it restores —
    // so undo and redo both keep the trash consistent with the index.
    setPlanTrash(prev => {
      const next = { ...prev };
      for (const id of alive) delete next[id];
      for (const p of plans) {
        if (!alive.has(p.id)) next[p.id] = { name: p.name, deletedAt: Date.now() };
      }
      return next;
    });
    const switching = snap.activePlanId !== activePlanId && alive.has(snap.activePlanId);
    // Flush live state to the outgoing plan's slot first, exactly as
    // switchPlan does — otherwise the pending edits land in the wrong plan.
    if (switching) saveCurrentPlanToSlot();
    setPlans(snap.plans);
    setFolders(snap.folders);
    const keptFolders = new Set(snap.folders.map(f => f.id));
    setOpenFolders(prev => new Set([...prev].filter(id => keptFolders.has(id))));
    if (switching) setActivePlanId(snap.activePlanId);
  };

  const undoFolders = () => {
    if (folderPast.length === 0) return false;
    const snap = folderPast[folderPast.length - 1];
    setFolderPast(prev => prev.slice(0, -1));
    setFolderFuture(prev => [...prev, folderSnapshot()]);
    applyFolderSnapshot(snap);
    return true;
  };

  const redoFolders = () => {
    if (folderFuture.length === 0) return false;
    const snap = folderFuture[folderFuture.length - 1];
    setFolderFuture(prev => prev.slice(0, -1));
    setFolderPast(prev => [...prev, folderSnapshot()]);
    applyFolderSnapshot(snap);
    return true;
  };

  const toggleFolder = (id) => setOpenFolders(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const setFolderOpen = (id, isOpen) => setOpenFolders(prev => {
    const next = new Set(prev);
    isOpen ? next.add(id) : next.delete(id);
    return next;
  });

  /** Create a folder. Returns its id, or null when the depth cap blocks it. */
  const createFolder = (name, parentId = null) => {
    const parent = parentId ?? null;
    if (childDepth(planTree, parent) > MAX_DEPTH - 1) return null;
    // Date.now() alone collides when two folders are made in the same tick —
    // "New Folder with Selection" immediately followed by another does that.
    const id = `fold_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const finalName = uniqueName(siblingNames(planTree, parent), (name ?? "").trim() || "untitled folder");
    pushFolderHistory();
    setFolders(prev => [...prev, { id, name: finalName, parentId: parent }]);
    if (parent) setFolderOpen(parent, true);
    return id;
  };

  /**
   * "New Folder with Selection" — create a folder and move the selection into
   * it in ONE commit.
   *
   * Doing this as createFolder() then moveNodesTo() cannot work: moveNodesTo
   * validates against `planTree`, which is memoized on the current render and
   * therefore does not contain the folder that was just created. Validating
   * against a probe tree built from the pending arrays is the whole point.
   */
  const createFolderWithNodes = (ids, name) => {
    const top = topmostNodes(planTree, ids);
    if (top.length === 0) return { ok: false, reason: "noop" };
    // Common parent when they share one, root otherwise — the folder appears
    // where the user was already looking.
    const parents = new Set(top.map(id => planTree.parentOf.get(id) ?? null));
    const parent = parents.size === 1 ? [...parents][0] : null;
    if (childDepth(planTree, parent) > MAX_DEPTH - 1) return { ok: false, reason: "depth" };

    const id = `fold_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const rec = {
      id,
      name: uniqueName(siblingNames(planTree, parent), (name ?? "").trim() || "untitled folder"),
      parentId: parent,
    };
    const nextFolders = [...folders, rec];
    const probe = buildTree({ plans, folders: nextFolders });
    const verdict = planMove(probe, top, id);
    if (!verdict.ok) return verdict;

    const moved = applyMove({ plans, folders: nextFolders }, verdict.moving, id);
    pushFolderHistory();
    setPlans(moved.plans);
    setFolders(moved.folders);
    setFolderOpen(id, true);
    return { ok: true, id };
  };

  const renameFolder = (id, name) => {
    const clean = (name ?? "").trim();
    if (!clean) return;
    pushFolderHistory();
    setFolders(prev => prev.map(f => f.id === id ? { ...f, name: clean } : f));
  };

  /**
   * Move plans and/or folders into `targetId` (null = root).
   * Returns the planMove verdict so the caller can explain a refusal
   * (a drag that silently snaps back is the worst possible outcome).
   */
  const moveNodesTo = (ids, targetId) => {
    const target = targetId ?? null;
    const verdict = planMove(planTree, ids, target);
    if (!verdict.ok) return verdict;
    const next = applyMove({ plans, folders }, verdict.moving, target);
    pushFolderHistory();
    setPlans(next.plans);
    setFolders(next.folders);
    if (target) setFolderOpen(target, true); // reveal where it landed
    return verdict;
  };

  /**
   * Place `ids` immediately before `beforeId` among their siblings under
   * `parentId`, or at the end when `beforeId` is null. Only meaningful under
   * the 'manual' sort — the other modes derive order from the records
   * themselves, so a stored position would be invisible and confusing.
   *
   * Cross-parent drops move first, then position, so dragging a plan into a
   * folder AND to a spot inside it is one undo step.
   */
  const reorderNodes = (ids, parentId, beforeId = null) => {
    const target = parentId ?? null;
    // Anything not already under `target` has to be moved there first.
    const needsMove = ids.some((id) => {
      const rec = [...plans, ...folders].find((r) => r.id === id);
      return (rec?.parentId ?? null) !== target;
    });
    let base = { plans, folders };
    let tree = planTree;
    if (needsMove) {
      const verdict = planMove(planTree, ids, target);
      if (!verdict.ok) return verdict;
      base = applyMove(base, verdict.moving, target);
      tree = buildTree(base);
    }
    const next = applyReorder(base, tree, ids, target, beforeId, { sortMode: "manual", locale });
    if (!next.ok) return next;
    pushFolderHistory();
    setPlans(next.plans);
    setFolders(next.folders);
    if (target) setFolderOpen(target, true);
    return { ok: true };
  };

  /** Siblings of one kind under a parent, in the order they currently render. */
  const orderedSiblings = (parentId, kind) =>
    siblingsInOrder(planTree, parentId ?? null, kind, { sortMode: folderSort, locale });

  /**
   * What a delete of `ids` would remove — for the confirmation dialog.
   *
   * `contained` counts only what the delete reaches BEYOND the named targets,
   * so deleting one empty folder doesn't announce "0 plans and 1 folders".
   */
  const previewDelete = (ids) => {
    const targets = topmostNodes(planTree, ids);
    const scope = deleteScope(planTree, ids);
    const targetFolders = targets.filter(id => planTree.folderIds.has(id)).length;
    const survivors = plans.length - scope.planIds.length;
    return {
      ...scope, targets, survivors, blocked: survivors < 1,
      contained: {
        plans: scope.planIds.length - (targets.length - targetFolders),
        folders: scope.folderIds.length - targetFolders,
      },
    };
  };

  /**
   * Recursive delete of any mix of plans and folders.
   *
   * `deleteScope` normalizes first, so a selection holding both a folder and
   * something inside it counts that child once. At least one plan must always
   * survive — this is the only place that invariant lives — and the replacement
   * active plan is chosen from the survivors, so the slot-load effect can
   * never read a key this delete dropped from the index.
   *
   * The plan-data slots are deliberately LEFT IN PLACE and tombstoned, which
   * is what makes this undoable; the TRASH_TTL sweep reclaims them later.
   */
  const deleteNodes = (rawIds) => {
    // Ids that name nothing were passed straight through: classified as
    // plans, tombstoned with an empty name, counted as casualties in the
    // confirmation dialog, and reported as a successful delete. An MCP
    // `DELETE_PLAN` for an id that does not exist is the obvious way in.
    const ids = [...new Set(rawIds ?? [])].filter(id => planTree.byId.has(id));
    if (!ids.length) return { ok: false, reason: "unknown", folderIds: [], planIds: [] };
    const scope = deleteScope(planTree, ids);
    const doomedPlans = new Set(scope.planIds);
    const remaining = plans.filter(p => !doomedPlans.has(p.id));
    if (remaining.length === 0) return { ok: false, reason: "last-plan", ...scope };

    pushFolderHistory();
    const now = Date.now();
    setPlanTrash(prev => {
      const next = { ...prev };
      for (const id of scope.planIds) {
        next[id] = { name: plans.find(p => p.id === id)?.name ?? "", deletedAt: now };
      }
      return next;
    });
    const doomedFolders = new Set(scope.folderIds);
    if (doomedFolders.size) {
      setFolders(prev => prev.filter(f => !doomedFolders.has(f.id)));
      setOpenFolders(prev => {
        const next = new Set(prev);
        for (const id of doomedFolders) next.delete(id);
        return next;
      });
    }
    setPlans(remaining);
    if (doomedPlans.has(activePlanId)) setActivePlanId(remaining[0].id);
    return { ok: true, ...scope };
  };

  // Browser tab title = "✎ <active plan> · <app>", but only once the tab is
  // actually the user's document — a crawler renders the app with empty
  // storage and must keep index.html's SEO title. Both the scheme and the
  // reason the override is conditional live in core/tabTitle.js.
  useEffect(() => {
    const next = tabTitle({ plans, activePlanId, placements, hadStoredPlans, appName: institution.appName });
    if (next) document.title = next;
  }, [plans, activePlanId, placements, hadStoredPlans, institution.appName]);

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

  // Capture full plan state as a serializable object.
  //
  // Everything that leaves this plan goes through here — the localStorage
  // slot, the exported file, the zip archive, the share link — so it is the
  // one place worth tidying at. `pruneSemOrders` drops term-order entries
  // naming cards the plan no longer holds: invisible in the app, but they
  // accumulate silently and ride into every file as references to nothing.
  // It leaves cards parked outside the timeline alone, on purpose — see the
  // note on the helper.
  const captureCurrentPlan = () => pruneSemOrders({
    version: 1,
    exported: new Date().toISOString(),
    entSem: planEntSem, entYear: planEntYear,
    gradSem: planGradSem, gradYear: planGradYear,
    // Reservations travel with the plan everywhere placements do — a plan slot,
    // a share link, an exported file. Omitting them was the same defect the
    // substitutions note below describes: the state exists, the capture does
    // not write it, and a reload silently returns a plan missing half of its
    // later years.
    placements, reservations, specialTermPl, semOrders, shOverrides, bonusSH, currentSemId,
    offeredOverrides, collapsedSubs,
    major, major2, conc, conc2, minor1, minor2, plusOne, studentType,
    placedOut: [...placedOut],
    // restorePlan reads `substitutions`, but capture never wrote it, so the
    // slot — which is what a reload restores from — always came back without
    // them and the restore wiped the list to []. Every applied substitution was
    // lost on refresh.
    substitutions,
    // Present in plan slots (localStorage) only. Share links go through
    // planShare's _KEYS allowlist, which deliberately omits grades.
    grades: gradesRaw,
    // Which sample plan this canvas came from. It travels with the plan for the
    // same reason reservations do: without it, switching slots and back makes
    // the app re-offer a plan that is already loaded — and, worse, forget that
    // a canvas belongs to a major the student has since changed.
    appliedTemplate,
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
    // Absent is not the same as empty — the same rule grades and substitutions
    // follow below. A slot written before reservations existed has no key at
    // all, and on the INITIAL restore of the active plan the live state is the
    // better source: treating absence as "none" there would wipe a plan the
    // student had just loaded but which had not yet been autosaved.
    if (d.reservations && typeof d.reservations === "object") setReservations(d.reservations);
    else if (!initial) setReservations({});
    // Same ABSENT ≠ EMPTY rule. A slot written before this field existed has no
    // key; clearing provenance there would re-offer a plan already loaded. But
    // switching to a slot that genuinely has none must clear it, or the new
    // canvas inherits the previous plan's origin.
    if (d.appliedTemplate !== undefined) setAppliedTemplate(d.appliedTemplate);
    else if (!initial) setAppliedTemplate(null);
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
    setPlusOne(d.plusOne ?? "");
    const st = d.studentType ?? "undergrad";
    setStudentTypeRaw(st);
    try { localStorage.setItem(key("student-type"), st); } catch {}
    setPlacedOut(d.placedOut ? new Set(d.placedOut) : new Set());
    // Same ABSENT ≠ EMPTY rule as grades below. restorePlan never touched
    // substitutions at all, so switching plans carried the previous plan's
    // list across, and the slot — which had no key, because capture omitted
    // it — cleared them on reload.
    if (Array.isArray(d.substitutions)) setSubstitutions(d.substitutions);
    else if (!initial) setSubstitutions([]);
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

  /**
   * A plan id that cannot collide with one minted a moment ago.
   *
   * `plan_${Date.now()}` was fine while plans were created one gesture at a
   * time, and stopped being fine the moment a SELECTION could be duplicated:
   * that loop runs synchronously, so every copy was minted inside the same
   * millisecond and got the same id. Measured: 5 of 5 identical. The second
   * copy then overwrote the first's slot and the index carried duplicate ids,
   * which `buildTree` collapses into one node — silent data loss.
   *
   * The counter, not the clock, is what guarantees it: `plans` is stale
   * inside a synchronous loop (setPlans has not committed yet), so checking
   * existing ids cannot help. The timestamp only keeps ids unique ACROSS
   * sessions, where the counter restarts.
   */
  const newPlanId = () => `plan_${Date.now().toString(36)}${(planIdSeq.current++).toString(36)}`;

  // Save current plan to its localStorage slot
  const saveCurrentPlanToSlot = () => {
    try { localStorage.setItem(key(`plan-data-${activePlanId}`), JSON.stringify(captureCurrentPlan())); } catch {}
  };

  // Switch to a different plan
  const switchPlan = (id) => {
    if (id === activePlanId) return;
    // Auto-save current plan
    saveCurrentPlanToSlot();
    // Stamp the open so the library's "Recently opened" sort has something to
    // order by. Index-only, so it never touches the plan's snapshot.
    setPlans(prev => prev.map(p => p.id === id ? { ...p, lastOpened: Date.now() } : p));
    // Switch to new plan – the useEffect will load its data (or reset)
    setActivePlanId(id);
  };

  // Create a new plan.
  // Optional cohort = { entSem, entYear, gradSem, gradYear, studentType }.
  // When provided, pre-writes a minimal plan snapshot so that the activePlanId
  // useEffect calls restorePlan (with the given cohort) instead of resetPlanToDefaults.
  // parentId files the new plan straight into a folder ("+ New plan" from
  // inside one); null puts it at the root.
  /**
   * @param {object} [seed]  content the new plan is BORN with, merged over the
   *   empty slot. Creating a plan and then writing into it would race the
   *   activePlanId effect that loads the slot back, so anything the plan
   *   should start with has to be in the slot before it exists.
   */
  const createPlan = (name, cohort = null, parentId = null, seed = null) => {
    saveCurrentPlanToSlot();
    const id = newPlanId();
    if (cohort) {
      // A failed write here USED to be swallowed, after which the plan was
      // added to the index and switched to anyway — so a full quota produced
      // a plan whose slot had never been written. For a bare new plan that is
      // survivable (a new plan is empty), but with a `seed` — the sample-plan
      // "open as new plan" and the duplicate path — the user asked for
      // content and would have got an empty canvas with no error. Index and
      // slot are two halves of one record; refuse to create half of one.
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
          minor1: "", minor2: "", plusOne: "", placedOut: [],
          ...(seed ?? {}),
        }));
      } catch (err) {
        // Only a SEEDED plan aborts. An unseeded one is meant to be empty, so
        // a lost slot costs nothing the autosave will not rewrite; a seeded
        // one that arrives empty is a silent lie about what was created.
        if (seed) {
          alert(t(/quota/i.test(String(err)) ? "folders.io.err.quota" : "folders.io.err.write"));
          return null;
        }
      }
    }
    setPlans(prev => [...prev, {
      id, name, studentType: cohort?.studentType ?? "undergrad",
      parentId: parentId ?? null, lastOpened: Date.now(),
    }]);
    if (parentId) setFolderOpen(parentId, true);
    setActivePlanId(id);
    return id;
  };

  /**
   * Copy a plan, beside the original, with everything in it.
   *
   * This is the advisor's most-repeated act and it had no verb: "keep what you
   * have, and let's see what a different major looks like". Without it the
   * only way to branch a plan was to export it and import it back, which
   * renames it, drops it at the root, and loses the advisee it was filed to.
   *
   * Deliberately does NOT switch to the copy. Duplicating is a filing act, not
   * a navigation one — the same reason Finder leaves you where you are — and
   * an advisor mid-conversation should not have the canvas change under them.
   *
   * The slot is written BEFORE the index record and a failed write aborts, so
   * a copy can never exist in the index with no data behind it.
   *
   * @param {boolean} [history=true] push an undo snapshot. Pass false when
   *   duplicating a SELECTION: each copy would otherwise push its own
   *   snapshot, and because they all read the same render's `plans` those
   *   snapshots are identical — so one ⌘Z undid all three copies and the next
   *   two did nothing at all.
   * @returns {{ok: true, id: string}|{ok: false, reason: 'read'|'quota'|'write'}}
   */
  const duplicatePlan = (id, history = true) => {
    const src = plans.find(p => p.id === id);
    if (!src) return { ok: false, reason: "read" };
    // Flush first: duplicating the plan you are editing must copy what is on
    // screen, not the last thing written to its slot.
    saveCurrentPlanToSlot();
    const snap = planSnapshot(id);
    if (!snap) return { ok: false, reason: "read" };

    const newId = newPlanId();
    try {
      localStorage.setItem(key(`plan-data-${newId}`), JSON.stringify(snap));
    } catch (err) {
      return { ok: false, reason: /quota/i.test(String(err)) ? "quota" : "write" };
    }
    if (history) pushFolderHistory();
    setPlans(prev => [...prev, {
      id: newId,
      name: uniqueName(siblingNames(planTree, src.parentId ?? null), src.name ?? "Plan"),
      studentType: src.studentType ?? "undergrad",
      parentId: src.parentId ?? null,
      lastOpened: Date.now(),
      // The copy belongs to the same advisee — that is the whole point of
      // duplicating it, and re-filing it by hand every time is the friction
      // this verb exists to remove.
      ...(src.student ? { student: src.student } : {}),
    }]);
    return { ok: true, id: newId };
  };

  // Deleting a plan has exactly ONE implementation — `deleteNodes` above.
  //
  // There used to be two more here, `deletePlan` and `bulkDeletePlans`, and the
  // difference was not cosmetic: they called `localStorage.removeItem` on the
  // slot straight away, so the same plan was recoverable for 30 days when
  // deleted in the library and gone forever when deleted from the header
  // dropdown or by an MCP `DELETE_PLAN`. Worse, they never called
  // `pushFolderHistory`, so an OLDER history entry still listed the plan: one
  // ⌘Z in the library put the index record back while its slot was already
  // erased, and the plan reopened empty. A second door that deletes differently
  // is how that happens, so the door is gone rather than merely aligned.

  /**
   * Rename a plan.
   *
   * Pushes history ITSELF, because not doing so was worse than "rename is not
   * undoable": the next ⌘Z restored a snapshot carrying the OLD name, so an
   * unrelated undo silently reverted a rename made minutes earlier. Only the
   * library door compensated; the header's ✎ and MCP `RENAME_PLAN` did not.
   *
   * The name is trimmed and an empty one is refused here rather than at each
   * door — both UI doors already guarded, MCP did not, so Claude could set a
   * plan's name to "".
   *
   * @param {boolean} [history=true] pass false when batching under one snapshot
   */
  const renamePlan = (id, name, history = true) => {
    const clean = String(name ?? "").trim();
    if (!clean) return { ok: false, reason: "empty" };
    if (history) pushFolderHistory();
    setPlans(prev => prev.map(p => p.id === id ? { ...p, name: clean } : p));
    return { ok: true };
  };

  // Associate a plan with a student (the advisee it belongs to), or clear the
  // association. Index-only, exactly like `parentId` and `name`: it identifies
  // and files the plan in the library, it is NOT part of the plan's academic
  // snapshot, and it must never leave the browser — a share link encodes
  // plan-data via the registry and never the index, so an advisee's name cannot
  // ride along by construction. An empty value drops the field entirely, so an
  // unassigned plan is a record with no `student` key (the same "absent, not
  // empty" shape `parentId` uses for "at root").
  const setPlanStudent = (id, student, history = true) => {
    const clean = (student ?? "").trim();
    // Same reasoning as renamePlan: without a snapshot of its own, the next
    // ⌘Z reverts an assignment nobody was undoing. `history: false` is for the
    // bulk assign, which covers the whole batch with one snapshot.
    if (history) pushFolderHistory();
    setPlans(prev => prev.map(p => {
      if (p.id !== id) return p;
      if (!clean) { const { student: _drop, ...rest } = p; return rest; }
      return { ...p, student: clean };
    }));
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
  }, [placements, reservations, appliedTemplate, specialTermPl, currentSemId, collapsedSubs, semOrders, offeredOverrides, shOverrides, bonusSH, major, major2, conc, conc2, minor1, minor2, plusOne, studentType, activePlanId, planEntSem, planEntYear, planGradSem, planGradYear, gradesRaw, placedOut, substitutions]); // eslint-disable-line react-hooks/exhaustive-deps
  
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
    if (privateCoop) data.specialTermPl = redactCoopDetails(data.specialTermPl);
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

  // ── Library (multi-plan) export / import ─────────────────────
  //
  // The single-plan door above and this one make the SAME privacy promises:
  // both run the snapshot through the same two toggles. A bulk file is the
  // heavier artifact — many advisees' names and grades in one place — so it
  // being quietly more permissive than the single export is exactly the
  // failure to avoid.
  const libraryRedact = (d) => {
    const out = { ...d };
    if (privateGrades) delete out.grades;
    if (privateCoop) out.specialTermPl = redactCoopDetails(out.specialTermPl);
    return out;
  };

  /** The saved snapshot for a plan; live capture for the one being edited. */
  const planSnapshot = (id) => {
    if (id === activePlanId) return captureCurrentPlan();
    try {
      const raw = localStorage.getItem(key(`plan-data-${id}`));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  };

  /** @param {string[]|null} ids selected nodes, or null for the whole library */
  const exportLibraryJSON = (ids = null) => {
    saveCurrentPlanToSlot();
    const doc = buildLibraryFile(planTree, ids, planSnapshot, { redact: libraryRedact });
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().slice(0, 10);
    const label = ids == null ? "Library" : `${doc.plans.length} plans`;
    a.download = `${label} - ${institution.shortName ?? institution.name} Map - ${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return { plans: doc.plans.length, folders: doc.folders.length };
  };

  /**
   * The same export as an ARCHIVE: one ordinary single-plan file per plan,
   * folders as directories. For browsing the library outside the app and for
   * pulling one plan out to hand to the student it belongs to — each entry
   * opens with the ordinary Load.
   *
   * @param {string[]|null} ids
   */
  const exportLibraryZip = (ids = null) => {
    saveCurrentPlanToSlot();
    const doc = buildLibraryFile(planTree, ids, planSnapshot, { redact: libraryRedact });
    const enc = new TextEncoder();
    const bytes = writeZip(libraryToArchive(doc).map(e => ({
      path: e.path, data: enc.encode(JSON.stringify(e.json, null, 2)),
    })));
    const blob = new Blob([bytes], { type: "application/zip" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().slice(0, 10);
    const label = ids == null ? "Library" : `${doc.plans.length} plans`;
    a.download = `${label} - ${institution.shortName ?? institution.name} Map - ${dateStr}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return { plans: doc.plans.length, folders: doc.folders.length };
  };

  /**
   * Export a selection INTO A FOLDER THE USER PICKS, keeping the folder tree.
   *
   * This is the primary export path, and the reason is a hard browser limit
   * rather than a preference: writing N files as N downloads trips the
   * "allow multiple downloads?" permission bubble, and until it is answered
   * every file after the first is silently dropped. So the honest-looking
   * flat export quietly produced ONE file out of forty. A directory picker
   * asks once, in the OS's own dialog, and then writes as many files as it
   * likes.
   *
   * Structure survives because the paths are the same ones the archive
   * already computes — `libraryToArchive` yields "Advisees/Jane Doe.json" —
   * only written into real directories instead of into a zip. No new notion
   * of structure, and no zip involved.
   *
   * What a selection means, which is the same rule delete and export already
   * use (`deleteScope`):
   *   - selecting a FOLDER takes everything inside it, and it lands as a
   *     folder in the destination;
   *   - a plan whose parent folder is NOT selected lands at the top of the
   *     destination, because exporting one plan out of a folder should not
   *     rebuild the chain of folders it happened to live under.
   * Empty folders are created explicitly — they have no file to imply them,
   * so nothing else would carry them across.
   *
   * Chromium-only (Firefox and Safari ship no File System Access API), so the
   * caller falls back to individual downloads there.
   *
   * @returns {Promise<{ok: true, plans, folders}|{ok: false, reason: 'unsupported'|'cancelled'|'write'}>}
   */
  /**
   * THE export. A selection becomes one ordinary plan file per plan, flat.
   *
   * Three rules, all deliberate:
   *
   *   1. PLANS ONLY. A folder is never exported as a thing; selecting one
   *      contributes the plans inside it. `buildLibraryFile` already computes
   *      that closure (the same one delete uses), so a mixed selection of
   *      folders and plans at any depth resolves to a plain set of plans.
   *   2. FLAT. The folder tree is how the library is organised in the app, not
   *      how files should be arranged on disk. Names are deduplicated globally
   *      because flat files share one directory — two advisees' "Current"
   *      would otherwise overwrite each other, which is silent loss at the
   *      exact moment the user believes they are taking a backup.
   *   3. NEVER ONE AGGREGATE FILE. N plans is N files.
   *
   * MANY PLANS ARE NEVER MANY DOWNLOADS. That is the whole design, and it is
   * forced by a browser rule no amount of JavaScript can talk its way around:
   *
   *   Chrome (and Edge) gate a SECOND download from the same page behind a
   *   per-site "Automatic downloads" permission. The first file of a burst
   *   always lands; the rest wait on a prompt. If that prompt is ever
   *   dismissed or blocked — and dismissing it is the easy accident — the
   *   origin is remembered as BLOCKED and every later multi-file export
   *   silently yields exactly one file. Forever. Nothing in the page can
   *   detect it, re-ask, or work around it.
   *
   * "Repeat Save JSON N times" is therefore not implementable, however
   * reasonable it sounds: Save JSON works precisely because it is ONE
   * download, which is the only kind that needs no permission.
   *
   * So each route below issues at most one download, or none:
   *
   *   1 plan                        → one download. Always allowed, everywhere.
   *   N plans, directory picker     → files written straight into a folder the
   *     (Chrome, Edge)                user picks. NO downloads at all, so the
   *                                   blocked permission is irrelevant.
   *   N plans, no picker            → one .zip. One download, so it cannot be
   *     (Safari, Firefox)             throttled; it expands to the same
   *                                   individual plan files.
   *
   * The picker must be reached with the click's user activation still intact,
   * so everything before it here is synchronous.
   *
   * Never throws. Failure comes back as a reason the UI can name.
   *
   * @param {string[]|null} ids  selected nodes, or null for the whole library
   * @returns {Promise<{ok: true, plans: number, via: 'download'|'folder'|'zip'}
   *                  |{ok: false, reason: 'empty'|'cancelled'|'busy'|'write'}>}
   */
  const exportPlansFlat = async (ids = null) => {
    let doc;
    try {
      saveCurrentPlanToSlot();
      doc = buildLibraryFile(planTree, ids, planSnapshot, { redact: libraryRedact });
    } catch {
      return { ok: false, reason: "write" };
    }
    if (!doc.plans.length) return { ok: false, reason: "empty" };

    const suffix = `${institution.shortName ?? institution.name} Map`;
    const dateStr = new Date().toISOString().slice(0, 10);
    // The bodies come from core so they can be tested: every one must be a
    // file the ordinary single-plan Load can open by itself.
    const fileOf = (f) => ({
      name: `${f.name} - ${suffix} - ${dateStr}.json`,
      text: JSON.stringify(f.json, null, 2),
    });

    const download = (file) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(
        file.blob ?? new Blob([file.text], { type: "application/json" }));
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Held far longer than the single-plan export's 1 s. Forty downloads
      // queue behind one another, and revoking a blob the browser has not
      // started reading yet cancels that download — which would look exactly
      // like the bug this whole function exists to fix.
      setTimeout(() => URL.revokeObjectURL(a.href), 120_000);
    };

    const files = flatPlanFiles(doc).map(fileOf);

    // One plan: a plain download. No permission involved anywhere.
    if (files.length === 1) {
      try { download(files[0]); return { ok: true, plans: 1, via: "download" }; }
      catch { return { ok: false, reason: "write" }; }
    }

    /** All of them, as ONE download. Cannot be gated; unzips to the same files. */
    const asZip = () => {
      try {
        const enc = new TextEncoder();
        const bytes = writeZip(files.map(f => ({ path: f.name, data: enc.encode(f.text) })));
        download({ name: `${files.length} plans - ${suffix} - ${dateStr}.zip`,
                   blob: new Blob([bytes], { type: "application/zip" }) });
        return { ok: true, plans: files.length, via: "zip" };
      } catch { return { ok: false, reason: "write" }; }
    };

    if (typeof window !== "undefined" && typeof window.showDirectoryPicker === "function") {
      // Only one picker may be open at a time; a second call while one is up
      // rejects. Guarded by a ref so a dialog left open cannot wedge export,
      // and cleared in `finally` so a dismissal cannot either.
      if (exportBusy.current) return { ok: false, reason: "busy" };
      exportBusy.current = true;
      let dir = null;
      try {
        dir = await window.showDirectoryPicker({ mode: "readwrite", id: "numap-export" });
      } catch (err) {
        if (err && err.name === "AbortError") return { ok: false, reason: "cancelled" };
        dir = null;                        // policy block or lost gesture → zip
      } finally {
        exportBusy.current = false;
      }
      if (dir) {
        try {
          for (const f of files) {
            const handle = await dir.getFileHandle(f.name, { create: true });
            const w = await handle.createWritable();
            await w.write(f.text);
            await w.close();
          }
          return { ok: true, plans: files.length, via: "folder" };
        } catch { return { ok: false, reason: "write" }; }
      }
    }

    return asZip();
  };

  /** Read one dropped file into an incoming {folders, plans}, whatever it is. */
  const readOneImport = async (file) => {
    const isZip = /\.zip$/i.test(file.name) || file.type === "application/zip";
    if (isZip) {
      let entries;
      try {
        entries = await readZip(new Uint8Array(await file.arrayBuffer()));
      } catch (e) {
        return { ok: false, reason: /unsafe/.test(String(e)) ? "unsafe" : "notzip" };
      }
      const dec = new TextDecoder();
      return archiveToLibrary(entries.map(e => ({ path: e.path, text: dec.decode(e.data) })));
    }
    const text = await file.text();
    const asLibrary = parseLibraryFile(text);
    if (asLibrary.ok) return asLibrary;
    // Not a library document — a plain single-plan file is the other thing a
    // user can reasonably hand us, and selecting a pile of them is exactly how
    // an unzipped export arrives back.
    if (asLibrary.reason === "kind") {
      try {
        const d = JSON.parse(text);
        if (d && typeof d === "object" && d.version === 1) {
          const { planName, planStudent, ...rest } = d;
          return { ok: true, folders: [], plans: [{
            id: "single", name: planName || file.name.replace(/\.json$/i, "") || "Plan",
            parentId: null,
            // The advisee a plan is filed to is index-only, so a per-plan file
            // carries it in the envelope or loses it entirely — which is what
            // used to happen to a whole roster on export → import.
            ...(typeof planStudent === "string" && planStudent.trim()
              ? { student: planStudent.trim() } : {}),
            studentType: d.studentType === "graduate" ? "graduate" : "undergrad",
            data: rest,
          }] };
        }
      } catch { /* falls through to the reason below */ }
    }
    return { ok: false, reason: asLibrary.reason };
  };

  /**
   * Import any mix of files — a .zip, library documents, loose single-plan
   * files — as ONE merge under one dated folder.
   *
   * Merging them together rather than one import per file is what keeps the
   * undo honest: selecting forty plans is a single act to the user, so it is a
   * single ⌘Z.
   *
   * @returns {Promise<{ok: true, plans, folders, atRoot, failed}|{ok: false, reason}>}
   */
  const importLibraryFiles = async (files, folderName) => {
    const list = [...(files ?? [])];
    if (!list.length) return { ok: false, reason: "read" };

    const folders = [];
    const plans = [];
    let failed = 0;
    let lastReason = "read";
    for (let i = 0; i < list.length; i++) {
      const got = await readOneImport(list[i]);
      if (!got.ok) { failed++; lastReason = got.reason; continue; }
      // Each file owns its own id space; namespace them so two files that
      // both call a folder "f1" cannot collide when merged together.
      const ns = (id) => `${i}:${id}`;
      for (const f of got.folders) folders.push({ ...f, id: ns(f.id), parentId: f.parentId == null ? null : ns(f.parentId) });
      for (const p of got.plans)   plans.push({ ...p, id: ns(p.id), parentId: p.parentId == null ? null : ns(p.parentId) });
    }
    // Folders with no plans is a VALID library — `parseLibraryFile` rejects
    // only a document that is empty of both — so exporting one empty folder
    // and importing it back used to fail with "Couldn't read that file",
    // which is both wrong and alarming. Only report a read failure when
    // something actually failed to read.
    if (!plans.length && !folders.length) {
      return { ok: false, reason: failed ? lastReason : "empty" };
    }

    let written = [];
    try {
      saveCurrentPlanToSlot();
      let n = 0;
      const newId = () => `imp_${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const m = mergeLibrary({ folders, plans }, newId, folderName);
      for (const s of m.slots) {
        localStorage.setItem(key(`plan-data-${s.id}`), JSON.stringify(s.data));
        written.push(s.id);
      }
      pushFolderHistory();
      setFolders(prev => [...prev, ...(m.folder ? [m.folder] : []), ...m.folders]);
      setPlans(prev => [...prev, ...m.plans]);
      if (m.folder) setFolderOpen(m.folder.id, true);
      return { ok: true, plans: m.plans.length, folders: m.folders.length, atRoot: m.atRoot, failed };
    } catch (err) {
      // Roll the slots back. They were written one at a time, so a failure
      // part-way (a full store — exactly when a big import fails) left the
      // earlier ones with no index record and no tombstone: invisible to the
      // Trash sheet AND to the TTL sweep, which only walks `planTrash`. They
      // would have held quota for the life of the profile, which is the last
      // thing a store that just ran out needs.
      for (const id of written) {
        try { localStorage.removeItem(key(`plan-data-${id}`)); } catch {}
      }
      return { ok: false, reason: /quota/i.test(String(err)) ? "quota" : "write" };
    }
  };

  const applyPlanData = (d) => {
    pushUndo();
    setPlacements(d.placements ?? {});
    // Reservations travel with placements through EVERY door: a plan slot, a
    // share link, an imported file. This one was missed, so opening a shared
    // plan or importing a backup arrived with the named courses and none of the
    // reserved cards — which for a later year is most of the plan.
    setReservations(d.reservations ?? {});
    // Provenance travels through this door too. An imported or shared plan that
    // was built from a sample plan should not be offered that same plan again.
    setAppliedTemplate(d.appliedTemplate ?? null);
    setSpecialTermPl(migrateSpecialTermPl(d));
    setSemOrders(d.semOrders ?? {});
    setShOverrides(prev => d.shOverrides ?? prev);
    setOfferedOverrides(prev => d.offeredOverrides ?? prev);
    setCollapsedSubs(prev => d.collapsedSubs ?? prev);
    setBonusSH(d.bonusSH ?? 0);
    setPlacedOut(new Set(Array.isArray(d.placedOut) ? d.placedOut : []));
    // `initial` belongs to restorePlan, which is a SIBLING of this function —
    // referencing it here threw a ReferenceError, and _isEmpty drops an empty
    // array from the payload, so every plan without substitutions took that
    // branch. Opening a share link or importing a file died before reaching
    // the fields below it.
    //
    // The distinction restorePlan draws does not apply here anyway: this
    // applies a COMPLETE plan the user chose to open, so absent means none.
    // A slot being merged into live state is the only case where absent can
    // mean "keep what we have".
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
    setPlusOne(d.plusOne ?? "");
    const st = d.studentType ?? "undergrad";
    setStudentTypeRaw(st);
    try { localStorage.setItem(key("student-type"), st); } catch {}
  };

  /**
   * Open a single saved plan file as a new plan.
   *
   * The slot is written BEFORE the index gains a record, and a failed write
   * aborts instead of being swallowed. It used to be
   * `try { setItem(...) } catch {}` followed unconditionally by the index push
   * and a switch, so a full quota produced a plan that the index insisted
   * existed and whose data had never been written — the app then switched to
   * it and showed an empty canvas with no error at all. Index and slot are the
   * two halves of one record; nothing may create one without the other.
   *
   * Errors are localized and reported by reason, like every other import door;
   * `err.message` used to be shown to the user raw.
   */
  const importPlanJSON = (file) => {
    const fail = (reason) => { alert(t(`folders.io.err.${reason}`)); return { ok: false, reason }; };
    const reader = new FileReader();
    reader.onload = () => {
      let d;
      try { d = JSON.parse(reader.result); } catch { fail("json"); return; }
      if (!d || typeof d !== "object" || Array.isArray(d)) { fail("json"); return; }
      if (d.version !== 1) { fail("version"); return; }

      saveCurrentPlanToSlot();
      const id = newPlanId();
      // Coerced, not trusted: a file or share payload whose `planName` is a
      // number threw a TypeError on `.startsWith` — which the hash path then
      // reported as "Could not decode the shared plan link", the wrong
      // diagnosis for a payload that decoded perfectly well.
      const base = (typeof d.planName === "string" && d.planName.trim()) || "Plan";
      const name = base.startsWith("+") ? base : `+ ${base}`;
      // The envelope is index data, not plan body — it must not be written
      // into the slot, where it would ride along in every later export.
      const body = { ...d };
      for (const k of FILE_ENVELOPE_KEYS) delete body[k];
      try {
        localStorage.setItem(key(`plan-data-${id}`), JSON.stringify(body));
      } catch (err) {
        fail(/quota/i.test(String(err)) ? "quota" : "write");
        return;
      }
      // Undoable, exactly as a library import is: opening the wrong file is
      // the same mistake whichever door it came through.
      pushFolderHistory();
      setPlans(prev => [...prev, {
        id, name, studentType: d.studentType ?? "undergrad",
        parentId: null, lastOpened: Date.now(),
        ...(typeof d.planStudent === "string" && d.planStudent.trim()
          ? { student: d.planStudent.trim() } : {}),
      }]);
      setActivePlanId(id);
      if (Array.isArray(d.substitutions)) setSubstitutions(d.substitutions);
    };
    reader.onerror = () => fail("read");
    reader.readAsText(file);
  };

  // ONE encoder for everything that leaves the browser as a snapshot —
  // the URL fragment and the share-by-code relay carry the identical
  // artifact, so the _KEYS allowlist (no grades, ever) governs both.
  const encodeSharePayload = async (targetLocale) => {
    const planName = plans.find(p => p.id === activePlanId)?.name || "Plan";
    const data = {
      ...captureCurrentPlan(),
      planName,
      locale: targetLocale,
    };
    // Share links carry co-op company/role by default; the privacy toggle
    // strips them so a shared plan can't reveal where you worked.
    if (privateCoop) data.specialTermPl = redactCoopDetails(data.specialTermPl);
    return encodePlan(data);
  };

  const copyPlanLink = async (targetLocale) => {
    const url = buildShareUrl(await encodeSharePayload(targetLocale));
    await navigator.clipboard.writeText(url);
  };

  // ── Share by code (one-shot relay — see ports/IShareRelay) ────
  // Park the snapshot payload under a short code the sender can just say
  // out loud; the recipient redeems it once and it burns server-side.
  const createShareCode = async (targetLocale) => {
    return shareRelay.createShareCode(await encodeSharePayload(targetLocale));
  };

  // Cancel = claim your own code and discard the payload. Burns it
  // atomically with zero extra server surface; already-claimed/expired
  // codes just no-op.
  const cancelShareCode = async (code) => {
    try { await shareRelay.claimShareCode(code); } catch { /* already gone — same outcome */ }
  };

  // Unload-safe flavor: revoke the code as the tab disappears, so a
  // closed tab never leaves a ticket parked on the server.
  const abandonShareCode = (code) => shareRelay.abandonShareCode?.(code);

  // Pickup feedback: the socket interrupt, with polling as backstop.
  const shareCodeStatus = (code) => shareRelay.shareCodeStatus?.(code);
  const watchShareCode = (code, onPickedUp) => shareRelay.watchShareCode?.(code, onPickedUp) ?? null;

  // Redeem a code and decode — the caller confirms with the user before
  // importSharedPlan actually touches any state.
  const claimShareCode = async (code) => {
    const payload = await shareRelay.claimShareCode(code);
    const d = await decodePlan(payload);
    if (d.version !== 1 && d.version !== 2) throw new Error("bad_payload");
    return d;
  };

  // Create a new plan slot pre-populated with shared data, then switch to it.
  const importSharedPlan = (d) => {
    saveCurrentPlanToSlot();
    const id = newPlanId();
    const base = (typeof d.planName === "string" && d.planName.trim()) || "Plan";
    const name = base.startsWith('/') ? '/' + base : '/ ' + base;
    // Pre-write so the activePlanId useEffect finds data and calls restorePlan.
    //
    // A failed write here is the WORST of the three places this pattern
    // appeared, and it used to be swallowed: a share code is burned
    // server-side the moment it is claimed, so losing the payload loses the
    // shared plan permanently — with no error, showing an empty canvas under
    // the sender's plan name. Index and slot are two halves of one record.
    try {
      localStorage.setItem(key(`plan-data-${id}`), JSON.stringify(d));
    } catch (err) {
      alert(t(/quota/i.test(String(err)) ? "folders.io.err.quota" : "folders.io.err.write"));
      return;
    }
    setPlans(prev => [...prev, {
      id, name, studentType: d.studentType ?? "undergrad",
      parentId: null, lastOpened: Date.now(),
    }]);
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
      samplePlan = null, samplePlanKey = null,
    } = setup;

    // Apply to the live current plan; the auto-save effect persists it.
    setStudentTypeRaw(st);            try { localStorage.setItem(key("student-type"), st);      } catch {}
    if (entSem)  { setPlanEntSem(entSem);    try { localStorage.setItem(key("ent-sem"),  entSem);  } catch {} }
    if (entYear) { setPlanEntYear(entYear);  try { localStorage.setItem(key("ent-year"), entYear); } catch {} }
    if (gradSem) { setPlanGradSem(gradSem);  try { localStorage.setItem(key("grad-sem"), gradSem); } catch {} }
    if (gradYear){ setPlanGradYear(gradYear); try { localStorage.setItem(key("grad-year"),gradYear);} catch {} }
    setMajor(mj); setMajor2(mj2); setConc(cc); setConc2(cc2); setMinor1(mn1); setMinor2(mn2);
    setPlans(prev => prev.map(p => p.id === activePlanId ? { ...p, studentType: st } : p));

    // The sample plan is laid out against the cohort set just above, and those
    // setters have not flushed yet — SEMESTERS is still the OLD timeline at
    // this point. So it is queued, and an effect applies it once the new
    // timeline exists. Applying here would file a four-year plan against
    // whatever dates the app happened to boot with.
    if (samplePlan) setPendingSamplePlan({ plan: samplePlan, programKey: samplePlanKey });

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
    workExperience: privateCoop ? redactCoopDetails(specialTermPl) : specialTermPl,
    placedOut: [...placedOut],
    substitutions,
    bonusSH,
    shOverrides,
    offeredOverrides,
    totalSHPlaced,
    totalSHReserved,
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
    major, major2, conc, conc2, minor1, minor2, plusOne, studentType, currentSemId, bonusSH, shOverrides,
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
      workExperience: privateCoop ? redactCoopDetails(specialTermPl) : specialTermPl, shOverrides, offeredOverrides,
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
    const programChanged = ["major", "major2", "conc", "minor1", "minor2", "plusOne", "studentType"].some(k => changed.has(k));
    const firstCourse = Object.keys(added)[0] ?? Object.keys(moved)[0] ?? [...removed][0] ?? null;
    let focus = null;
    if (programChanged)                              focus = { kind: "grad", field: [...changed].find(k => ["major","major2","conc","minor1","minor2","plusOne","studentType"].includes(k)) };
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
  // (BankPanel). Goes through `revealCourse` like every other jump, so a
  // preview of a 1 SH course opens the collapsed zone it lands in instead of
  // scrolling to a card nobody can see.
  useEffect(() => {
    const f = claudePreview?.focus;
    if (f?.kind !== "course") return;
    const timer = setTimeout(() => { revealCourse(f.courseId); }, 250);
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
    let d;
    if (!planId || planId === activePlanId) d = captureCurrentPlan();
    else {
      try {
        const raw = localStorage.getItem(key(`plan-data-${planId}`));
        d = raw ? JSON.parse(raw) : null;
      } catch { d = null; }
    }
    if (!d) return null;
    // This reply leaves the browser (→ MCP → Claude), so it gets the
    // same scrubbing as the live sync: grades NEVER ride an MCP payload
    // (unconditional — grades-design.md "Never do"), and the co-op
    // privacy toggle applies. Both slot data and captureCurrentPlan
    // carry the raw values, so scrub here, at the exit.
    d = { ...d };
    delete d.grades;
    if (privateCoop) d.specialTermPl = redactCoopDetails(d.specialTermPl);
    return d;
  };

  /**
   * The APPLY and COMMAND handlers, re-pointed every render.
   *
   * The subscription below is registered ONCE (`[aiAssistant]` is a stable
   * port), so anything it calls directly is a mount-time closure. That is
   * already known here — `readPlanContentsRef` exists for exactly this on the
   * read path — but the WRITE path called `applyMCPActions` directly, and its
   * damage is not a stale read:
   *
   *   `DELETE_PLAN` → `deleteNodes` computes the survivors from the mount-time
   *   `plans` and calls `setPlans(remaining)` non-functionally. So every plan
   *   created since page load vanished from the index and every plan deleted
   *   since page load came back — and the vanished ones kept their slots with
   *   no tombstone, invisible to both the Trash sheet and the TTL sweep, so
   *   they held quota permanently.
   *
   *   `CREATE_PLAN`/`SWITCH_PLAN` → `saveCurrentPlanToSlot` wrote the
   *   mount-time canvas into the mount-time plan's slot, so asking Claude to
   *   switch plans after an afternoon of editing overwrote that plan with its
   *   state as of page load.
   *
   * An advisor pairs a session once and works in it for hours, which is
   * precisely the case where "mount-time" and "now" diverge most.
   */
  const mcpApplyRef = useRef(null);
  mcpApplyRef.current = { applyMCPActions, executeMCPCommand, pushUndo };

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
        // Through the ref, never the closure — see mcpApplyRef above.
        mcpApplyRef.current?.pushUndo();
        mcpApplyRef.current?.applyMCPActions(actions);
        return;
      }
      if (event.type === "COMMAND") {
        mcpApplyRef.current?.executeMCPCommand(event.command);
      }
    });
    return unsubscribe;
  }, [aiAssistant]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Context value ─────────────────────────────────────────────
  const value = {
    // Data
    courses, courseMap, effectiveCourseMap, allEdges, subjects,
    // The grid's view: real placements plus a position for every reservation,
    // and a card for each. Everything that LAYS OUT a semester reads these and
    // needs no cases for reservations. Everything that totals credit toward the
    // DEGREE keeps reading `placements`, which cannot contain one.
    reservations, setReservations,
    appliedTemplate, setAppliedTemplate,
    semesterCards, semesterCardIds, semesterLoad, semView,
    applySamplePlanToPlan,
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
    // What satisfaction is computed against: the student's own swaps plus the
    // ones a declared accelerated pathway contributes. `substitutions` above
    // stays the EDITABLE list — the substitutions editor and every persistence
    // door read that one, so a derived entry can never be saved or removed.
    effectiveSubstitutions,
    specialTermPl: specialTermPlSafe,
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
    revealCourse, revealTarget,
    showPanel, lines, linesScrollRef, showViolLines,
    prereqDepth, setPrereqDepth, unlockDepth, setUnlockDepth, showPrereqTree,
    // Bank state
    bankSearch, bankSort, bankTab, bankFilters, bankWidth,
    wideCatalog, setWideCatalog, wideWidth, setWideWidth,
    starredIds: pv ? new Set(pv.starredIds ?? []) : starredIds,
    bankCourseIds,
    // Settings
    showDisclaimer, showSettings, showStats, setShowStats,
    statsVisible, statsJustUnlocked, ackStatsUnlockFlash: () => setStatsJustUnlocked(false),
    showDonate, setShowDonate,
    collapseOtherCredits, setCollapseOtherCredits: updateCollapseOtherCredits,
    privateGrades, setPrivateGrades: updatePrivateGrades,
    privateCoop, setPrivateCoop: updatePrivateCoop,
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
    prereqViolations, coreqViolations, connectedIds, prereqConditions,
    grades, setGrade, enteredGpaStat,
    ratings, setRating, ratingFor,
    ratingConsent, setRatingConsent, mayShareRatings,
    totalSHPlaced, totalSHDone,
    bonusSH: pvBonusSH, setBonusSH,
    major:  pv?.major  ?? major,  setMajor,
    major2: pv?.major2 ?? major2, setMajor2,
    conc:   pv?.concentration ?? conc, setConc,
    conc2:  pv?.concentration2 ?? conc2, setConc2,
    minor1: pv?.minor1 ?? minor1, setMinor1,
    minor2: pv?.minor2 ?? minor2, setMinor2,
    plusOne: pv?.plusOne ?? plusOne, setPlusOne,
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
    setBankSearch, setBankSort, setBankTab, setBankFilters, setBankWidth,
    setCollapsedSubs,
    setShowDisclaimer, setShowSettings,
    showCohortSetup, setShowCohortSetup, onboardingDeferredForShare, finishOnboarding,
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
    exportLibraryJSON, exportLibraryZip, exportPlansFlat, importLibraryFiles,
    shareRelayAvailable: !!shareRelay, createShareCode, claimShareCode, cancelShareCode, abandonShareCode, shareCodeStatus, watchShareCode, importSharedPlan,
    plans, activePlanId, switchPlan, createPlan, duplicatePlan, renamePlan, setPlanStudent,
    // Folders — structure, view state, and the mutations that respect both.
    folders, planTree, openFolders, toggleFolder, setFolderOpen,
    folderSort, setFolderSort,
    createFolder, createFolderWithNodes, renameFolder, moveNodesTo, deleteNodes, previewDelete,
    trashedPlans, restorePlanFromTrash, TRASH_TTL_DAYS,
    reorderNodes, orderedSiblings,
    pushFolderHistory, undoFolders, redoFolders,
    folderCanUndo: folderPast.length > 0, folderCanRedo: folderFuture.length > 0,
    showPlanLibrary, setShowPlanLibrary,
    newPlanFolderId, setNewPlanFolderId,
    toggleStar, toggleOffered,
    getSemStatus,
    substitutions: pvSubstitutions,
    // What satisfaction is computed against: the student's own swaps plus the
    // ones a declared accelerated pathway contributes. `substitutions` above
    // stays the EDITABLE list — the substitutions editor and every persistence
    // door read that one, so a derived entry can never be saved or removed.
    effectiveSubstitutions,
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
