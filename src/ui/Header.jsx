// ═══════════════════════════════════════════════════════════════════
// HEADER  — sticky timeline header: title, SH counters, controls,
//           relationship legend, co-op/grad conflict warning
// ═══════════════════════════════════════════════════════════════════
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { usePlanner } from "../context/PlannerContext.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { REL_STYLE } from "../core/constants.js";
import { exportReport, getOrderedCourses, filterInTimeline } from "../core/planModel.js";
import { resolveTermByDuration, termSpans, computeGrantedAttrs } from "../core/specialTermUtils.js";
import { THEME_LABELS } from "../core/themes.js";
import { storageKey } from "../data/persistence.js";
import { donateEnabled } from "../core/donate.js";
import { useInstitution } from "../context/InstitutionContext.jsx";
import { useLanguage }    from "../context/LanguageContext.jsx";
import { useTranslation, useTranslatedText, TText, scaleLatinRuns } from "../context/TranslationContext.jsx";
import { ClaudeDot, ClaudeSettings, ClaudeConnectModal, ClaudeProposalCard, ClaudeOAuthModal } from "./ClaudePanel.jsx";
import dataMeta from "../core/dataMeta.json";
import YearStepper    from "./YearStepper.jsx";
import { SemLabel }   from "./SemLabel.jsx";
import NewPlanModal   from "./NewPlanModal.jsx";
import HoverTip       from "./InfoTip.jsx";

// Measured header-row width (logical px) below which the labeled buttons fold
// to icon-only. Above it, labeled buttons wrap into two stacked groups
// automatically via flex-wrap. One breakpoint for every device — phones (always
// narrower than this) land on icons-on-the-right, matching desktop's folded
// look, and app/browser zoom drives the transition the same everywhere.
const HEADER_FOLD_BP = 560;


// Touch scroll-lock for header dropdown panels: consume touchmove at the
// panel's scroll bounds so the gesture never chains into the planner's
// scroll container behind it. Native non-passive listener — React's
// root-level touch listeners are passive, so JSX onTouchMove can't
// preventDefault. See the usage comment inside Header.
function usePopupTouchLock(ref, open) {
  useEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    let startY = 0;
    const onStart = (e) => { startY = e.touches[0].clientY; };
    const onMove  = (e) => {
      const dy       = e.touches[0].clientY - startY;
      const atTop    = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if (el.scrollHeight <= el.clientHeight || (atTop && dy > 0) || (atBottom && dy < 0)) e.preventDefault();
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove",  onMove,  { passive: false });
    return () => { el.removeEventListener("touchstart", onStart); el.removeEventListener("touchmove", onMove); };
  }, [ref, open]);
}

export default function Header() {
  const {
    courses, totalSHDone, totalSHPlaced, persistEnabled, setPersistEnabled,
    placements, courseMap, effectiveCourseMap, currentSemId, SEMESTERS, SEM_INDEX, SEM_NEXT,
    resetAll, setShowDisclaimer, setShowStats, setShowDonate,
    statsVisible, statsJustUnlocked, ackStatsUnlockFlash,
    showSettings, setShowSettings,
    planEntSem, planEntYear, planGradSem, planGradYear,
    entOrd, gradOrd, semOrd,
    setEntSem, setEntYear, setGradSem, setGradYear,
    coopGradConflicts, specialTermPl, specialTermStartMap, specialTermContMap, semOrders,
    showViolLines, setShowViolLines,
    prereqDepth, setPrereqDepth, unlockDepth, setUnlockDepth,
    manualZoom, setManualZoom, isPhone, isMobile, bankWidth,
    collapseOtherCredits, setCollapseOtherCredits,
    showContLogo, setShowContLogo,
    showUnlocks, setShowUnlocks,
    semTrackingMode, setSemTrackingMode,
    semAdvanceToast, setSemAdvanceToast,
    stickyCourses, setStickyCourses,
    exportPlanJSON, importPlanJSON, copyPlanLink,
    aiAssistantAvailable, claudePreview,
    plans, activePlanId, switchPlan, createPlan, deletePlan, bulkDeletePlans, renamePlan,
    major, major2, conc, minor1, minor2,
    placedOut, substitutions, studentType,
    grades, privateGrades, setPrivateGrades,
  } = usePlanner();

  const { themeName, setThemeName, themeNames } = useTheme();
  const { t, locale, setLocale, locales } = useLanguage();
  const {
    courseTranslationEnabled, setCourseTranslationEnabled,
    catalogLocale, engineTier, modelProgress, modelCached,
    cancelDownload, clearModelCache,
  } = useTranslation();
  const adapter = useInstitution();
  const { attributeSystem, specialTerms, calendar, creditSystem, institution, majorRequirements } = adapter;
  const unitName        = creditSystem.getUnitName();
  // Allow entry year up to next calendar year so incoming students can plan ahead
  // (e.g. a fall 2027 admit setting up their plan in spring 2027).
  const maxEntYear = new Date().getFullYear() + 1;
  const isMaintenanceDay = new Date().getUTCDate() === 1;
  const [showUpdatedDate, setShowUpdatedDate] = useState(false);
  const [showQuickSet, setShowQuickSet] = useState(false);
  const [showClaudeConnect, setShowClaudeConnect] = useState(false);
  const [showPlanMenu, setShowPlanMenu] = useState(false);
  const [showIO, setShowIO] = useState(false);

  // Header dropdowns are XOR — opening any tab closes whichever other one is
  // open, so at most one header popover is visible at a time.
  const toggleHeaderPop = (isOpen, setOpen) => {
    setShowPlanMenu(false); setShowIO(false); setShowQuickSet(false); setShowSettings(false);
    if (!isOpen) setOpen(true);
  };
  // The Stats button appears the moment the plan clears the gate (see
  // PlannerContext). Rather than a toast, the button itself goes filled blue
  // and fades back to a normal header button — same visual vocabulary as the
  // "Link copied!" flash on the snapshot button, just slower, so the eye
  // catches the new tab without anything demanding to be dismissed. Driven off
  // the context latch (not a local false→true watch) because the unlock can
  // land before this component ever mounts; acking it keeps the flash to one.
  const [statsFlash, setStatsFlash] = useState(false);
  const statsFlashTimer = useRef(null);
  const statsPillFired  = useRef(false);
  const statsTextTimer  = useRef(null);
  useEffect(() => () => { clearTimeout(statsFlashTimer.current); clearTimeout(statsTextTimer.current); }, []);
  useEffect(() => {
    if (!statsJustUnlocked) return;
    statsPillFired.current = true;
    setStatsFlash(true);
    // Acking flips the latch back, re-running this effect — so the fade timer
    // lives in a ref rather than in the effect's cleanup, which that re-run
    // would otherwise cancel, leaving the button stuck blue.
    ackStatsUnlockFlash();
    clearTimeout(statsFlashTimer.current);
    statsFlashTimer.current = setTimeout(() => setStatsFlash(false), 1200);
  }, [statsJustUnlocked]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every LATER appearance — an already-unlocked user opening or filling out a
  // plan that clears the keep bar — gets the quiet version: the label and glyph
  // tint blue and fade back, leaving the pill alone. The loud filled flash is
  // reserved for the one-time unlock, so a tab coming back isn't dressed up as
  // something new. Mount-time visibility is not an appearance (the ref starts
  // at whatever was already on screen), so a plain page load stays silent.
  const [statsTextFlash, setStatsTextFlash] = useState(false);
  const statsWasVisible = useRef(statsVisible);
  useEffect(() => {
    const was = statsWasVisible.current;
    statsWasVisible.current = statsVisible;
    if (!statsVisible || was) return;
    // Effects run in declaration order, so the unlock above has already
    // claimed this appearance by the time we get here — don't double-flash it.
    if (statsPillFired.current) { statsPillFired.current = false; return; }
    setStatsTextFlash(true);
    clearTimeout(statsTextTimer.current);
    statsTextTimer.current = setTimeout(() => setStatsTextFlash(false), 1200);
  }, [statsVisible]);

  const [shareLinkCopied, setShareLinkCopied] = useState(false);
  const [shareLinkLocale, setShareLinkLocale] = useState(locale);
  const [planSearch, setPlanSearch] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const lastClickedIdx = useRef(-1);
  const { showNewPlanModal, setShowNewPlanModal } = usePlanner();

  // ── Responsive header: measure the *rendered* width, not window.innerWidth ──
  // The app container is transform:scale(uiScale) on tablet/desktop, so app zoom
  // (and browser zoom) shrink the header's logical width without changing
  // innerWidth. A ResizeObserver on the button row is the one signal that
  // captures every case — phone, iPad, Mac, and every zoom level alike.
  // Above HEADER_COMPACT_BP the two button groups wrap into two stacked rows
  // (pure flex-wrap, no threshold); below it every button folds to icon-only
  // on a single compact row.
  const headerRowRef = useRef(null);
  const [headerRowW, setHeaderRowW] = useState(() => (isMobile ? 400 : 1200));
  useEffect(() => {
    const el = headerRowRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect?.width;
      if (w) setHeaderRowW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const iconOnly = headerRowW < HEADER_FOLD_BP;

  // Phone: give the plan-name button exactly the width its fixed neighbours
  // leave over (SH badges on the left, Group 2 controls on the right — whose
  // width varies live: Claude dot appears when linked, buttons fold to
  // icon-only). Flex-wrap decides line breaks from CONTENT width, not
  // shrunk width, so without this cap a long name forces Group 2 to wrap
  // under even though the name could truncate. The wrap remains the
  // fallback once even a minimal name (48px) can't fit.
  const group2Ref   = useRef(null);
  const shBadgesRef = useRef(null);
  const [planFree, setPlanFree] = useState(70);
  useEffect(() => {
    if (!isPhone || typeof ResizeObserver === "undefined") return;
    const compute = () => {
      const row = headerRowRef.current, g2 = group2Ref.current, b = shBadgesRef.current;
      if (!row || !g2 || !b) return;
      setPlanFree(Math.floor(row.clientWidth - g2.offsetWidth - b.offsetWidth - 14)); // flex gaps + safety
    };
    compute();
    const ro = new ResizeObserver(compute);
    [headerRowRef.current, group2Ref.current, shBadgesRef.current].forEach(el => el && ro.observe(el));
    return () => ro.disconnect();
  }, [isPhone]);
  const planNameMax = Math.max(24, planFree);
  // The name takes every pixel available — the clipped-fade keeps even a
  // very narrow name looking intentional. Only when there isn't room for
  // ~2 faded characters plus the ▾ does the button collapse to the bare
  // "/" (the true minimum, for when the right side grows more tabs).
  // (planFree doesn't depend on the button's own width, so no oscillation.)
  const planSlash = isPhone && planFree < 26;

  // Phone: the header buttons sit in a tight row, so a dropdown anchored to a
  // button's edge (right: 0 / left: 0) can spill off-screen. On phone we instead
  // pin every button popover as a viewport-centred sheet just below the header.
  // phonePopTop tracks the header's bottom edge so the sheet clears it.
  const [phonePopTop, setPhonePopTop] = useState(96);
  const openPhonePop = () => {
    if (isPhone && headerRowRef.current) {
      setPhonePopTop(Math.round(headerRowRef.current.getBoundingClientRect().bottom) + 6);
    }
  };
  // The sheet spans only the planner side — centred within (100vw − bank
  // sidebar), never reaching behind the bank/grad panel on the right.
  const phonePopFixed = isPhone ? {
    position: "fixed", top: phonePopTop, left: `calc((100vw - ${bankWidth}px) / 2)`, right: "auto",
    transform: "translateX(-50%)", width: `calc(100vw - ${bankWidth}px - 16px)`, maxWidth: 360,
    maxHeight: `calc(100dvh - ${phonePopTop + 12}px)`, overflowY: "auto", zIndex: 9500,
  } : null;

  useEffect(() => {
    if (!showPlanMenu) { setPlanSearch(""); setSelectMode(false); setSelectedIds(new Set()); lastClickedIdx.current = -1; return; }
    const close = () => setShowPlanMenu(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [showPlanMenu]);

  useEffect(() => {
    if (!semAdvanceToast) return;
    const id = setTimeout(() => setSemAdvanceToast(null), 4000);
    return () => clearTimeout(id);
  }, [semAdvanceToast]);

  const cycleTheme = e => {
    e.stopPropagation();
    const idx = themeNames.indexOf(themeName);
    setThemeName(themeNames[(idx + 1) % themeNames.length]);
  };

  // Claude proposal preview touches the cohort (entry/graduation/current
  // semester) — flag the 🎓 button orange so the change is discoverable.
  const cohortPreviewChanged = !!claudePreview?.changed &&
    ["entSem", "entYear", "gradSem", "gradYear", "currentSemId"].some(k => claudePreview.changed.has(k));

  const handleExport = e => {
    e.stopPropagation();
    const curIdx     = SEM_INDEX[currentSemId] ?? 0;
    const majorPath  = major  || "";
    const major2Path = major2 || "";
    const concLabel  = conc   || "";
    const minor1Path = minor1 || "";
    const minor2Path = minor2 || "";
    const npCovered  = attributeSystem.getCoverage(filterInTimeline(placements, SEM_INDEX), courseMap, computeGrantedAttrs(specialTermPl, specialTerms.getTypes(), SEM_INDEX));
    // Build set of course keys that are placed in already-completed semesters
    const doneKeys = new Set();
    for (const [id, semId] of Object.entries(placements)) {
      const c = courseMap[id];
      if (!c?.subject || !c?.number) continue;
      if ((SEM_INDEX[semId] ?? 99) < curIdx) doneKeys.add(c.subject + c.number);
    }
    const gradInfo = {
      majorPath, major2Path, concLabel, minor1Path, minor2Path,
      npCovered, doneKeys, totalSHRequired: 0,
      placedOut, substitutions,
      isGrad: studentType === "graduate",
    };
    exportReport(placements, effectiveCourseMap, currentSemId, SEMESTERS, SEM_INDEX, gradInfo, specialTermPl, adapter);
  };

  // EXPORT_PDF ui-command from the MCP integration — the PDF assembly
  // lives here (grad info composition), so PlannerContext raises a DOM
  // event and this listener runs the same export the ⇅ menu does.
  const handleExportRef = useRef(null);

  // ── Dropdown touch scroll-locks (⚙ settings + 🎓 cohort) ─────────
  // The Header (and its dropdowns) render INSIDE the planner's scroll
  // container (App.jsx timeline div), so on touch devices any gesture a
  // panel can't consume — at its scroll bounds, or when it doesn't
  // overflow — chains into the planner behind it. overscroll-behavior
  // doesn't cover every mobile browser, and React's root-level touch
  // listeners are passive (preventDefault is ignored), so this attaches a
  // native non-passive touchmove listener that consumes the gesture at
  // the panel's bounds. Pairs with the .hdr-pop class (index.html).
  const settingsPopRef = useRef(null);
  const quickSetPopRef = useRef(null);
  usePopupTouchLock(settingsPopRef, showSettings);
  usePopupTouchLock(quickSetPopRef, showQuickSet);
  handleExportRef.current = handleExport;
  useEffect(() => {
    const h = () => handleExportRef.current?.({ stopPropagation() {} });
    window.addEventListener("numap:export-pdf", h);
    return () => window.removeEventListener("numap:export-pdf", h);
  }, []);

  const handleCopyHumanReadable = async () => {
    // Gather plan metadata
    const entry = `${planEntSem === 'fall' ? 'Fall' : 'Spring'} ${planEntYear}`;
    const grad = `${planGradSem === 'fall' ? 'Fall' : 'Spring'} ${planGradYear}`;

    // Readable major/minor names from their stored paths (conc is already a label)
    const isGrad = studentType === "graduate";
    const labelFromPath = p => {
      if (!p) return "";
      const parts = p.split('/');
      const folder = parts[parts.length - 2] || '';
      return folder ? majorRequirements.fmtProgramLabel(folder) : '';
    };
    const programLines = [];
    if (isGrad) {
      const prog = labelFromPath(major);
      if (prog) programLines.push(`Program: ${prog}`);
    } else {
      const m1 = labelFromPath(major);
      const m2 = labelFromPath(major2);
      const mn1 = labelFromPath(minor1);
      const mn2 = labelFromPath(minor2);
      if (m1) programLines.push(`Major: ${m1}`);
      if (m2) programLines.push(`Second Major: ${m2}`);
      if (conc) programLines.push(`Concentration: ${conc}`);
      if (mn1) programLines.push(`Minor: ${mn1}`);
      if (mn2) programLines.push(`Second Minor: ${mn2}`);
    }

    const totalSH = totalSHPlaced;
    const completedSH = totalSHDone;
    const plannedSH = totalSHPlaced - totalSHDone;

    // Build semester blocks
    const semLines = [];
    const semById = Object.fromEntries(SEMESTERS.map(s => [s.id, s]));

    // Determine current semester index for "completed" marking
    const currentIdx = SEM_INDEX[currentSemId] ?? 0;

    // Collect placed course IDs for the appendix — timeline only (parked
    // entries aren't part of the plan being exported)
    const allPlacedIds = Object.keys(filterInTimeline(placements, SEM_INDEX));

    // Iterate through semesters in order
    for (const sem of SEMESTERS) {
      const semId = sem.id;
      const idsInSem = getOrderedCourses(semId, placements, semOrders, courseMap);
      const hasStart = !!specialTermStartMap[semId];
      const hasCont  = !!specialTermContMap[semId];

      // Skip empty semesters
      if (idsInSem.length === 0 && !hasStart && !hasCont) continue;

      const semLabel = sem.label;
      const isDone = (SEM_INDEX[semId] ?? 99) < currentIdx;
      const status = isDone ? ' (completed)' : (semId === currentSemId ? ' (in progress)' : '');
      semLines.push(`\n${semLabel}${status}`);

      // Special term continuation row
      if (hasCont && !hasStart) {
        const contId   = specialTermContMap[semId];
        const contData = specialTermPl[contId];
        const contType = contData ? (specialTerms.getTypes() ?? []).find(t => t.id === contData.typeId) : null;
        const contDur  = contType ? resolveTermByDuration(contType.durations, contData.duration) : null;
        if (contDur) {
          const co = contData.company ? ` @ ${contData.company}` : '';
          semLines.push(`  ⤷ ${contType.label}${co} (continues)`);
        }
      }

      // Special term start row
      if (hasStart) {
        const startId   = specialTermStartMap[semId];
        const startData = specialTermPl[startId];
        const startType = startData ? (specialTerms.getTypes() ?? []).find(t => t.id === startData.typeId) : null;
        const startDur  = startType ? resolveTermByDuration(startType.durations, startData.duration) : null;
        if (startDur) {
          const nextSemId = SEM_NEXT[semId];
          const spansNext = termSpans(startDur.weight, sem.weight ?? 1) && !!nextSemId;
          const contPart  = spansNext ? ` (spans into ${semById[nextSemId]?.label ?? nextSemId})` : '';
          const co        = startData.company ? ` @ ${startData.company}` : '';
          const role      = startData.subline ? ` · ${startData.subline}` : '';
          semLines.push(`  ⤷ ${startType.label}${co}${role}${contPart}`);
        }
      }

      // Normal courses – only code, title, SH
      for (const id of idsInSem) {
        const c = courseMap[id];
        if (!c) continue;
        semLines.push(`  - ${c.code}: ${c.title} (${c.sh} ${unitName})`);
      }
    }

    // Build appendix of course descriptions (code, title, SH, description)
    const appendixLines = ['\n\n--- Appendix: Course Descriptions ---'];
    for (const id of allPlacedIds) {
      const c = courseMap[id];
      if (!c) continue;
      const desc = c.desc?.trim() || c.description?.trim() || 'No description available.';
      appendixLines.push(`\n${c.code}: ${c.title}`);
      appendixLines.push(`  Credits: ${c.sh} ${unitName}`);
      appendixLines.push(`  Description: ${desc}`);
    }

    const placedOutLines = placedOut.size > 0
      ? ['\n--- Placed Out (no credit, satisfies prerequisites) ---',
         ...[...placedOut].map(id => { const c = courseMap[id]; return c ? `  - ${c.code}: ${c.title}` : null; }).filter(Boolean)]
      : [];

    const substitutionLines = substitutions.length > 0
      ? ['\n--- Substitutions (course A placed → satisfies course B, credits count once) ---',
         ...substitutions.map(({ from, to }) => {
           const fc = courseMap[from]; const tc = courseMap[to];
           if (!fc || !tc) return null;
           return `  - ${fc.code} → ${tc.code}${placements[from] ? '' : ' ⚠ not placed'}`;
         }).filter(Boolean)]
      : [];

    // Assemble final text
    const fullText = [
      `${institution.appName} Plan: ${plans.find(p => p.id === activePlanId)?.name || 'Untitled'}`,
      ...programLines,
      `Entry: ${entry}`,
      `Graduation: ${grad}`,
      `Total SH: ${totalSH} (completed: ${completedSH}, planned: ${plannedSH})`,
      '',
      '--- Semester Schedule ---',
      ...semLines,
      ...placedOutLines,
      ...substitutionLines,
      ...appendixLines,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(fullText);
      alert(t("header.io.copy.done") ?? "Plan copied to clipboard!");
    } catch (err) {
      alert("Failed to copy: " + err.message);
    }
  };

  const handleReset = e => {
    e.stopPropagation();
    if (!confirm(t("header.reset.confirm"))) return;
    resetAll();
  };

  const handleRefresh = e => {
    e.stopPropagation();
    try { localStorage.removeItem(storageKey(institution.storagePrefix)); } catch {}
    window.location.reload();
  };

  // Toggle selection for one plan, with shift-range support.
  // visiblePlans is the currently displayed list (may be filtered by search).
  const handleSelectToggle = (p, idx, visiblePlans, shiftHeld) => {
    const anchor = lastClickedIdx.current;
    lastClickedIdx.current = idx; // set synchronously so the next shift-click sees it
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (shiftHeld && anchor >= 0 && anchor !== idx) {
        const from = Math.min(anchor, idx);
        const to   = Math.max(anchor, idx);
        const shouldSelect = !prev.has(p.id);
        for (let i = from; i <= to; i++) {
          const id = visiblePlans[i]?.id;
          if (id) shouldSelect ? next.add(id) : next.delete(id);
        }
      } else {
        next.has(p.id) ? next.delete(p.id) : next.add(p.id);
      }
      return next;
    });
  };

  // Renders a single row in the plan switcher list.
  // majorLabel is non-empty only when the row surfaced via a major-name fallback search.
  // idx + visiblePlans enable shift-range selection in select mode.
  const renderPlanRow = (p, majorLabel = "", idx = 0, visiblePlans = plans) => {
    const isChecked = selectedIds.has(p.id);
    const nameSpan = (
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          display: "block", fontSize: isPhone ? 9 : 10,
          fontWeight: !selectMode && p.id === activePlanId ? 700 : 400,
          color: !selectMode && p.id === activePlanId ? "var(--active)" : "var(--text-3)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {!selectMode && p.id === activePlanId ? "● " : ""}{p.name}
        </span>
        {majorLabel && (
          <MajorLabelText label={majorLabel} isPhone={isPhone} />
        )}
      </span>
    );

    if (selectMode) {
      return (
        <div key={p.id} style={{
          display: "flex", alignItems: "center", gap: 6, padding: "4px 10px",
          background: isChecked ? "var(--active-bg)" : "transparent", cursor: "pointer",
        }} onClick={e => handleSelectToggle(p, idx, visiblePlans, e.shiftKey)}>
          <input type="checkbox" checked={isChecked} onChange={() => {}}
            onClick={e => { e.stopPropagation(); handleSelectToggle(p, idx, visiblePlans, e.shiftKey); }}
            style={{ cursor: "pointer", accentColor: "var(--active)", flexShrink: 0 }} />
          {nameSpan}
        </div>
      );
    }

    return (
      <div key={p.id} style={{
        display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
        background: p.id === activePlanId ? "var(--active-bg)" : "transparent",
        cursor: p.id === activePlanId ? "default" : "pointer",
      }} onClick={() => { if (p.id !== activePlanId) { switchPlan(p.id); setShowPlanMenu(false); } }}>
        {nameSpan}
        <button onClick={e => {
          e.stopPropagation();
          const name = prompt(t("header.plan.rename.prompt"), p.name);
          if (name?.trim()) renamePlan(p.id, name.trim());
        }} style={{ background: "none", border: "none", color: "var(--text-5)", cursor: "pointer", fontSize: 10, padding: "0 2px", flexShrink: 0 }}
          title={t("header.plan.rename.title")}>✎</button>
        {plans.length > 1 && (
          <button onClick={e => {
            e.stopPropagation();
            if (confirm(t("header.plan.delete.confirm", { name: p.name }))) { deletePlan(p.id); if (plans.length <= 2) setShowPlanMenu(false); }
          }} style={{ background: "none", border: "none", color: "var(--text-5)", cursor: "pointer", fontSize: 10, padding: "0 2px", flexShrink: 0 }}
            title="Delete">✕</button>
        )}
      </div>
    );
  };

  // Renders the full plan list grouped by student type (undergraduate / graduate).
  // Headers appear only when both groups are present; otherwise a plain flat list.
  // visiblePlans is the combined display order so shift-range selection spans groups.
  const renderGroupedPlans = () => {
    const ug = plans.filter(p => (p.studentType ?? "undergrad") !== "graduate");
    const gr = plans.filter(p => (p.studentType ?? "undergrad") === "graduate");
    const ordered = [...ug, ...gr];

    if (ug.length === 0 || gr.length === 0) {
      return ordered.map((p, i) => renderPlanRow(p, "", i, ordered));
    }

    const groupHeader = label => (
      <div key={`hdr-${label}`} style={{
        padding: "5px 10px 2px", fontSize: isPhone ? 7.5 : 8.5, fontWeight: 700,
        letterSpacing: "0.07em", color: "var(--text-5)", textTransform: "uppercase",
        userSelect: "none",
      }}>{label}</div>
    );

    return (
      <>
        {groupHeader(t("header.plan.group.undergrad"))}
        {ug.map(p => renderPlanRow(p, "", ordered.indexOf(p), ordered))}
        {groupHeader(t("header.plan.group.graduate"))}
        {gr.map(p => renderPlanRow(p, "", ordered.indexOf(p), ordered))}
      </>
    );
  };

  return (
    <>
      {/* ── Sticky header bar ── */}
      <div style={{
        display: "flex", flexDirection: "column", gap: 6, marginBottom: 10,
        position: "sticky", top: 0, zIndex: 30, background: "var(--bg-app)",
        paddingTop: 10, paddingBottom: 8, borderBottom: "1px solid var(--border-1)",
      }}>
        {/* Row 1: title + info — last-updated anchored right, never wraps */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "nowrap", minWidth: 0, overflow: "hidden" }}>
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt={institution.appName} style={{ height: 20, width: 20, objectFit: "contain", flexShrink: 0 }} />
          <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "-0.01em", flexShrink: 0 }}>{institution.appName}</span>
          <span style={{ fontSize: 10, color: "var(--text-6)", flexShrink: 0 }}>·</span>
          {!isPhone && (
            <span style={{ fontSize: 10, color: "var(--text-3)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{t("header.courses.count", { n: courses.length.toLocaleString() })}</span>
          )}
          {!isPhone && (dataMeta.lastUpdated || __COMMIT_DATE__) && (
            <span style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
              <span
                title="Date of last course data refresh"
                style={{
                  fontSize: 9, color: "var(--text-5)", whiteSpace: "nowrap",
                  maxWidth: showUpdatedDate ? 120 : 0,
                  opacity: showUpdatedDate ? 1 : 0,
                  overflow: "hidden",
                  textAlign: "right",
                  marginRight: showUpdatedDate ? 6 : 0,
                  transition: "max-width 0.35s ease, opacity 0.25s ease, margin-right 0.35s ease",
                }}
              >
                updated {dataMeta.lastUpdated || __COMMIT_DATE__}
              </span>
              {/* Donate — an action, so it wears feedback's outlined-pill
                  treatment rather than BETA/updating's solid status fill. The
                  heart sets no color of its own so the parent's hover swap
                  carries it, and inline-flex lets RTL mirror the order.
                  Opens the modal rather than linking out: the QR in there is
                  the fast path, since paying belongs on a phone. */}
              {donateEnabled() && (
                <button
                  onClick={() => setShowDonate(true)}
                  title={t("header.donate.title")}
                  style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.04em",
                    color: "var(--text-5)", background: "transparent",
                    border: "1px solid var(--border-1)", borderRadius: 20,
                    padding: "1px 7px", whiteSpace: "nowrap", lineHeight: "calc(1.7 * var(--lh-scale, 1))",
                    marginRight: 6, display: "inline-flex", alignItems: "center", gap: 3,
                    cursor: "pointer", fontFamily: "inherit",
                    transition: "color 0.2s, border-color 0.2s" }}
                  onMouseEnter={e => { e.currentTarget.style.color = "var(--text-3)"; e.currentTarget.style.borderColor = "var(--border-2)"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "var(--text-5)"; e.currentTarget.style.borderColor = "var(--border-1)"; }}
                >
                  <span aria-hidden="true" style={{ fontSize: 8, lineHeight: 1 }}>♥</span>
                  {t("header.donate")}
                </button>
              )}
              <a
                href="https://forms.gle/CzXE25WRtJnXWE1U9"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.04em",
                  color: "var(--text-5)", textDecoration: "none",
                  border: "1px solid var(--border-1)", borderRadius: 20,
                  padding: "1px 7px", whiteSpace: "nowrap", lineHeight: "calc(1.7 * var(--lh-scale, 1))",
                  marginRight: 6 }}
                onMouseEnter={e => { e.currentTarget.style.color = "var(--text-3)"; e.currentTarget.style.borderColor = "var(--border-2)"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "var(--text-5)"; e.currentTarget.style.borderColor = "var(--border-1)"; }}
              >
                feedback ↗
              </a>
              {isMaintenanceDay && (
                <span title="Catalog data is being refreshed today; some major requirements may update shortly" style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: "0.04em",
                  color: "var(--warn-badge-text)", background: "var(--warn-bg)",
                  border: "1px solid var(--warn-bg)",
                  padding: "1px 7px", borderRadius: 6,
                  userSelect: "none", lineHeight: "calc(1.7 * var(--lh-scale, 1))", marginRight: 4,
                  cursor: "default",
                }}>
                  updating
                </span>
              )}
              <span
                onMouseEnter={() => setShowUpdatedDate(true)}
                onMouseLeave={() => setShowUpdatedDate(false)}
                style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: "0.04em",
                  color: "var(--beta-text)", background: "var(--beta-bg)",
                  padding: "1px 7px", borderRadius: 6,
                  userSelect: "none", boxShadow: "0 1px 2px 0 rgba(0,0,0,0.03)",
                  lineHeight: "calc(1.7 * var(--lh-scale, 1))", transition: "background 0.2s,color 0.2s",
                  cursor: "default",
                }}
              >
                BETA
              </span>
            </span>
          )}
          {/* {isPhone && (dataMeta.lastUpdated || __COMMIT_DATE__) && (
            <>
              <span style={{ flex: 1, display: "flex", alignItems: "center", minWidth: 0, overflow: "hidden" }}>
                <span style={{ fontSize: 9, color: "var(--text-5)", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }} title="Date of last course data refresh">
                  updated {dataMeta.lastUpdated || __COMMIT_DATE__}
                </span>
              </span>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  color: "var(--beta-text)",
                  background: "var(--beta-bg)",
                  padding: "1px 7px",
                  borderRadius: 6,
                  marginLeft: 0,
                  userSelect: "none",
                  boxShadow: "0 1px 2px 0 rgba(0,0,0,0.03)",
                  lineHeight: "calc(1.7 * var(--lh-scale, 1))",
                  transition: "background 0.2s,color 0.2s",
                  alignSelf: "flex-end"
                }}
              >
                BETA
              </span>
            </>
          )} */}
        </div>

        {/* Row 2: Group 1 (SH badges + plan/major) · Group 2 (controls).
            Wraps into two stacked rows when narrow; folds to icon-only below
            HEADER_FOLD_BP(_PHONE). Width is measured via headerRowRef, so
            app/browser zoom drives it the same on phone, iPad, and Mac. */}
        <div ref={headerRowRef} style={{ display: "flex", gap: 4, rowGap: 6, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
          {/* ── Group 1: completed-SH badge · placed-SH badge · plan/major name.
               marginRight:auto pushes Group 2 to the far right on a single line;
               when the row is too narrow, Group 2 wraps beneath as a whole. ── */}
          <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "nowrap", minWidth: 0, marginRight: "auto" }}>
          {/* SH badges — left side (wrapped so the phone plan-name cap can
              measure their live width — the numbers and locale change it) */}
          <div ref={shBadgesRef} style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
          <span style={{ fontSize: isPhone ? 8 : 10, color: "var(--success)", background: "var(--bg-surface)", border: "1px solid var(--success-border)", borderRadius: 4, flexShrink: 0, display: "inline-flex", alignItems: "center", lineHeight: 1, ...(isPhone ? { height: 20, padding: "0 4px" } : { height: 22, padding: "0 7px" }) }}>
            {t("header.credits.done", { n: totalSHDone, unit: unitName })}
          </span>
          <span style={{ fontSize: isPhone ? 8 : 10, color: "var(--text-3)", background: "var(--bg-surface)", border: "1px solid var(--border-2)", borderRadius: 4, flexShrink: 0, display: "inline-flex", alignItems: "center", lineHeight: 1, ...(isPhone ? { height: 20, padding: "0 4px" } : { height: 22, padding: "0 7px" }) }}>
            {/* Phone: bare "{n} SH" — the word "placed" ate the very space the
                plan name needs (real plans read "166 SH placed"). */}
            {isPhone ? `${totalSHPlaced} ${unitName}` : t("header.credits.placed", { n: totalSHPlaced, unit: unitName })}
          </span>
          </div>

          {/* Buttons — right side, icon-only on mobile/tablet */}
        
        {/* Plan switcher dropdown */}
        <div style={{ position: "relative", minWidth: 0, flexShrink: 1 }}>
          <button className="hdr-btn" onClick={e => { e.stopPropagation(); openPhonePop(); toggleHeaderPop(showPlanMenu, setShowPlanMenu); }}
            data-claude-focus="planName"
            style={{ fontSize: isPhone ? 8 : 10, cursor: "pointer", maxWidth: isPhone ? planNameMax : 160,
              overflow: "hidden",
              // A pending RENAME_PLAN proposal marks the plan button orange.
              color: claudePreview?.changed?.has?.("planName") ? "#fb923c" : showPlanMenu ? "var(--text-2)" : "var(--text-4)",
              background: showPlanMenu ? "var(--bg-surface)" : "var(--bg-surface-2)",
              border: `1px ${claudePreview?.changed?.has?.("planName") ? "dashed #fb923c" : `solid ${showPlanMenu ? "var(--active)" : "var(--border-2)"}`}`,
              borderRadius: 5, display: "inline-flex", alignItems: "center", lineHeight: 1, ...(isPhone ? { height: 20, padding: "0 5px" } : { height: 22, padding: "0 8px", whiteSpace: "nowrap" }) }}>
            {(() => {
              // Same clipped-name treatment on every device: the per-character
              // fade lives between a pinned "/" (desktop prefix) and "▾".
              const planName = (plans.find(p => p.id === activePlanId)?.name) || "Plan";
              const hdrRtl = (locales.find(l => l.code === locale)?.dir ?? "ltr") === "rtl";
              if (isPhone && planSlash) return "/";
              if (!isPhone && iconOnly) return "/";
              return (
                <>
                  {!isPhone && <span style={{ flexShrink: 0, marginRight: 4 }}>/</span>}
                  <PlanNameFade text={planName} rtl={hdrRtl} />
                  <span style={{ flexShrink: 0, marginLeft: isPhone ? 3 : 4 }}>▾</span>
                </>
              );
            })()}
          </button>

          {showPlanMenu && (
            <div onClick={e => e.stopPropagation()} className="hdr-pop" style={{
              position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: isPhone ? 9500 : 100,
              background: "var(--bg-surface)", border: "1px solid var(--border-2)", borderRadius: 6,
              padding: "6px 0", minWidth: isPhone ? 130 : 180, maxWidth: isPhone ? "72vw" : undefined,
              boxShadow: "var(--shadow-modal)",
              display: "flex", flexDirection: "column", transformOrigin: "top left",
              fontSize: isPhone ? 9 : 11,
              ...(phonePopFixed || {}),
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 8, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", padding: "3px 10px 5px", borderBottom: "1px solid var(--border-1)" }}>
                <span>{t("header.plans.title")}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {plans.length > 1 && (
                    <button onClick={e => { e.stopPropagation(); setSelectMode(v => !v); setSelectedIds(new Set()); lastClickedIdx.current = -1; }}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 8, padding: 0, fontWeight: 600,
                        color: selectMode ? "var(--active)" : "var(--text-5)" }}>
                      {selectMode ? "Done" : "Select"}
                    </button>
                  )}
                  <span style={{ fontWeight: 400, color: "var(--text-5)", letterSpacing: 0 }}>{plans.length}</span>
                </div>
              </div>

              {/* Search */}
              {plans.length > 3 && (
                <div style={{ padding: "5px 10px 4px", borderBottom: "1px solid var(--border-1)" }}>
                  <input
                    autoFocus
                    value={planSearch}
                    onChange={e => setPlanSearch(e.target.value)}
                    placeholder="Search plans…"
                    style={{
                      width: "100%", boxSizing: "border-box",
                      fontSize: isPhone ? 9 : 10, padding: "3px 7px",
                      border: "1px solid var(--border-2)", borderRadius: 4,
                      background: "var(--bg-surface-2)", color: "var(--text-2)",
                      outline: "none",
                    }}
                  />
                </div>
              )}

              {/* Scrollable plan list */}
              <div style={{ maxHeight: "40vh", overflowY: "auto" }}>
                {(() => {
                  const q = planSearch.trim().toLowerCase();
                  if (!q) return renderGroupedPlans();

                  // Helper: readable major label from a stored plan's major path
                  const getMajorLabel = id => {
                    try {
                      const raw = localStorage.getItem(`${institution.storagePrefix}-plan-data-${id}`);
                      const parts = (JSON.parse(raw || '{}').major || '').split('/');
                      const folder = parts[parts.length - 2] || '';
                      return folder ? majorRequirements.fmtProgramLabel(folder) : '';
                    } catch { return ''; }
                  };

                  // 1st pass: match by name
                  const byName = plans.filter(p => p.name.toLowerCase().includes(q));
                  if (byName.length > 0) return byName.map((p, i) => renderPlanRow(p, "", i, byName));

                  // 2nd pass: fall back to major
                  const byMajor = plans.map(p => ({ p, majorLabel: getMajorLabel(p.id) }))
                    .filter(({ majorLabel }) => majorLabel.toLowerCase().includes(q));

                  if (byMajor.length === 0) return (
                    <div style={{ padding: "8px 10px", fontSize: isPhone ? 9 : 10, color: "var(--text-5)", fontStyle: "italic" }}>
                      No plans match
                    </div>
                  );

                  const byMajorPlans = byMajor.map(x => x.p);
                  return byMajor.map(({ p, majorLabel }, i) => renderPlanRow(p, majorLabel, i, byMajorPlans));
                })()}
              </div>

              <div style={{ borderTop: "1px solid var(--border-1)", padding: "4px 10px 3px" }}>
                {selectMode ? (
                  <button onClick={e => {
                    e.stopPropagation();
                    const count = selectedIds.size;
                    if (count === 0) return;
                    if (count >= plans.length) { alert("You must keep at least one plan."); return; }
                    if (confirm(`Delete ${count} plan${count > 1 ? "s" : ""}?`)) {
                      bulkDeletePlans(Array.from(selectedIds));
                      setSelectMode(false);
                      setSelectedIds(new Set());
                    }
                  }} style={{
                    width: "100%", fontSize: isPhone ? 9 : 10, fontWeight: 700,
                    cursor: selectedIds.size === 0 ? "default" : "pointer",
                    padding: "5px 8px", borderRadius: 5, textAlign: "left",
                    opacity: selectedIds.size === 0 ? 0.4 : 1,
                    background: selectedIds.size > 0 ? "var(--red-soft, #fee2e2)" : "var(--bg-surface-2)",
                    border: `1px solid ${selectedIds.size > 0 ? "var(--red, #ef4444)" : "var(--border-2)"}`,
                    color: selectedIds.size > 0 ? "var(--red, #ef4444)" : "var(--text-5)",
                  }}>
                    {selectedIds.size === 0 ? "Select plans to delete" : `Delete ${selectedIds.size} plan${selectedIds.size > 1 ? "s" : ""}`}
                  </button>
                ) : (
                  <button onClick={e => {
                    e.stopPropagation();
                    setShowPlanMenu(false);
                    setShowNewPlanModal(true);
                  }} style={{
                    width: "100%", fontSize: isPhone ? 9 : 10, fontWeight: 700, cursor: "pointer",
                    background: "var(--bg-surface-2)", padding: "5px 8px", borderRadius: 5,
                    border: "1px solid var(--border-2)", color: "var(--accent)", textAlign: "left",
                  }}>
                    {t("header.plan.new")}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

          </div>{/* ── end Group 1 ── */}

          {/* ── Group 2: Claude dot · I/O · settings · cohort · stats · about.
               A nowrap unit so these controls wrap together beneath Group 1
               when narrow, then fold to icon-only via `iconOnly`. ── */}
          <div ref={group2Ref} style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "nowrap", flexShrink: 0 }}>

        {/* Claude liveness dot — invisible unless the user has linked Claude */}
        <ClaudeDot />

        {/* Input/Output Dropdown */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <button className="hdr-btn" onClick={e => { e.stopPropagation(); openPhonePop(); toggleHeaderPop(showIO, setShowIO); }}
            style={{ fontSize: isPhone ? 8 : 10, cursor: "pointer",
              color: showIO ? "var(--text-2)" : "var(--text-4)",
              background: showIO ? "var(--bg-surface)" : "var(--bg-surface-2)",
              border: `1px solid ${showIO ? "var(--active)" : "var(--border-2)"}`,
              borderRadius: 5, display: "inline-flex", alignItems: "center", lineHeight: 1, ...(iconOnly ? { width: isPhone ? 22 : 26, height: isPhone ? 20 : 22, padding: 0, justifyContent: "center" } : { height: isPhone ? 20 : 22, padding: "0 8px", whiteSpace: "nowrap" }) }}>
            {iconOnly ? "⇅" : `⇅ ${t("header.io.button")}`}
          </button>
          {showIO && (
            <div onClick={e => e.stopPropagation()} style={{
              position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 100,
              background: "var(--bg-surface)", border: "1px solid var(--border-2)", borderRadius: 8,
              padding: "10px 12px", minWidth: 170, boxShadow: "var(--shadow-modal)",
              display: "flex", flexDirection: "column", gap: 7,
              ...(phonePopFixed || {}),
            }}>
              <div style={{ display: "flex", gap: 4 }}>
                <button className="hdr-btn-dd"
                  title={t("header.io.share.title")}
                  onClick={async () => {
                    try {
                      await copyPlanLink(shareLinkLocale);
                      setShareLinkCopied(true);
                      setTimeout(() => setShareLinkCopied(false), 2000);
                    } catch {
                      alert(t("header.io.share.error") ?? "Could not copy link.");
                    }
                  }}
                  style={{ flex: 1, textAlign: "center", fontSize: 10, fontWeight: 700, cursor: "pointer",
                    background: shareLinkCopied ? "var(--active)" : "var(--bg-surface)",
                    padding: "4px 8px", borderRadius: 5,
                    border: `1px solid ${shareLinkCopied ? "var(--active)" : "var(--border-2)"}`,
                    color: shareLinkCopied ? "#fff" : "var(--text-4)",
                    transition: "background 0.2s, color 0.2s, border-color 0.2s" }}>
                  {shareLinkCopied ? (t("header.io.share.done") ?? "Link copied!") : (t("header.io.share") ?? "Snapshot link")}
                </button>
                <select
                  value={shareLinkLocale}
                  onChange={e => setShareLinkLocale(e.target.value)}
                  title={t("header.io.share.locale.title") ?? "Language for recipient"}
                  style={{ fontSize: 10, fontWeight: 700, cursor: "pointer",
                    background: "var(--bg-surface)", color: "var(--text-4)",
                    border: "1px solid var(--border-2)", borderRadius: 5,
                    padding: "4px 6px", flexShrink: 0 }}>
                  {locales.map(l => (
                    <option key={l.code} value={l.code}>{l.code.toUpperCase()}</option>
                  ))}
                </select>
              </div>
              <button className="hdr-btn-dd" onClick={handleCopyHumanReadable} title={t("header.io.copy.title")}
                style={{ width: "100%", textAlign: "center", fontSize: 10, fontWeight: 700, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: "1px solid var(--border-2)", color: "var(--text-4)" }}>
                {t("header.io.copy")}
              </button>
              <button className="hdr-btn-dd" onClick={handleExport} title={t("header.io.export.pdf.title")}
                style={{ width: "100%", textAlign: "center", fontSize: 10, fontWeight: 700, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: "1px solid var(--border-2)", color: "var(--text-4)" }}>
                {t("header.io.export.pdf")}
              </button>
              <HoverTip tip={t("tip.export.json")}>
              <button className="hdr-btn-dd" onClick={exportPlanJSON}
                style={{ width: "100%", textAlign: "center", fontSize: 10, fontWeight: 700, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: "1px solid var(--border-2)", color: "var(--text-4)" }}>
                  {t("header.io.export.json")}
              </button>
              </HoverTip>
              <input type="file" id="plan-import-input" accept=".json" style={{ display: "none" }}
                onChange={e => { if (e.target.files[0]) { importPlanJSON(e.target.files[0]); e.target.value = ""; } }} />
              <HoverTip tip={t("tip.import.json")}>
              <button className="hdr-btn-dd" onClick={() => document.getElementById("plan-import-input").click()}
                style={{ width: "100%", textAlign: "center", fontSize: 10, fontWeight: 700, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: "1px solid var(--border-2)", color: "var(--text-4)" }}>
                  {t("header.io.import.json")}
              </button>
              </HoverTip>
            </div>
          )}
        </div>

        {/** Reset — hidden on all devices (commented out)
        {!isPhone && <button className="hdr-btn" onClick={handleReset} title="Reset all placements"
          style={{ fontSize: 10, color: "var(--text-4)", background: "var(--bg-surface-2)", border: "1px solid var(--border-2)", borderRadius: 5, padding: "3px 8px", cursor: "pointer", whiteSpace: "nowrap" }}>
          {isMobile ? "↺" : "↺ Erase"}
        </button>}
        */}

        {/* ⚙ Settings dropdown — infrequent controls */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <button className="hdr-btn" onClick={e => { e.stopPropagation(); openPhonePop(); toggleHeaderPop(showQuickSet, setShowQuickSet); }}
            style={{ fontSize: isPhone ? 8 : 10, cursor: "pointer",
              color:      showQuickSet ? "var(--text-2)" : "var(--text-4)",
              background: showQuickSet ? "var(--bg-surface)" : "var(--bg-surface-2)",
              border:    `1px solid ${showQuickSet ? "var(--active)" : "var(--border-2)"}`,
              borderRadius: 5, display: "inline-flex", alignItems: "center", lineHeight: 1, ...(iconOnly ? { width: isPhone ? 22 : 26, height: isPhone ? 20 : 22, padding: 0, justifyContent: "center" } : { height: isPhone ? 20 : 22, padding: "0 8px", whiteSpace: "nowrap" }) }}>
            {iconOnly ? "⚙" : `⚙ ${t("header.settings.button")}`}
          </button>

          {showQuickSet && (
            // .hdr-pop = viewport cap + scroll (index.html); the touch lock
            // keeps gestures from chaining into the planner behind.
            <div ref={quickSetPopRef} onClick={e => e.stopPropagation()} className="hdr-pop" style={{
              position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 100,
              background: "var(--bg-surface)", border: "1px solid var(--border-2)", borderRadius: 8,
              padding: "10px 12px", minWidth: 190, boxShadow: "var(--shadow-modal)",
              display: "flex", flexDirection: "column", gap: 7,
              ...(phonePopFixed || {}),
            }}>
              {/* Language picker + course translation toggle — moved to the top */}
              {locales.length > 1 && (
                <div style={{ borderBottom: "1px solid var(--border-1)", paddingBottom: 12, marginBottom: 4 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", marginBottom: 5 }}>{t("header.settings.language")}</div>
                  <LanguagePicker locale={locale} locales={locales} setLocale={setLocale} />

                  {locale !== catalogLocale && (
                    <div style={{ marginTop: 7 }}>
                      <label style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer", userSelect: "none" }}>
                        <input
                          type="checkbox"
                          checked={courseTranslationEnabled}
                          onChange={e => setCourseTranslationEnabled(e.target.checked)}
                          style={{ marginTop: 1, flexShrink: 0, accentColor: "var(--active)" }}
                        />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <HoverTip tip={t("tip.translate")} display="inline-block">
                            <span style={{ fontSize: 10, color: "var(--text-2)" }}>
                              {t("translation.toggle")}
                            </span>
                          </HoverTip>
                          {/* Hint line: changes based on engine + download + cache state */}
                          <span style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 9, color: "var(--text-5)" }}>
                              {engineTier === "native"
                                ? t("translation.toggle.hint.native")
                                : engineTier === "api"
                                  ? "" /* "Online · results cached locally" hint hidden */
                                  : modelProgress
                                    ? `${Math.round((modelProgress.loaded / (modelProgress.total || 1)) * 100)}% ${t("translation.progress.of")} ~890 MB`
                                    : modelCached
                                      ? t("translation.toggle.hint.cached")
                                      : t("translation.toggle.hint.wasm")}
                            </span>
                            {/* Cancel button — visible while downloading */}
                            {engineTier === "wasm" && modelProgress && (
                              <button
                                onMouseDown={e => e.preventDefault()}
                                onClick={cancelDownload}
                                style={{
                                  fontSize: 8, padding: "1px 5px", borderRadius: 3, cursor: "pointer",
                                  background: "transparent", border: "1px solid var(--border-2)",
                                  color: "var(--text-4)", lineHeight: "calc(1.4 * var(--lh-scale, 1))",
                                }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--error)"; e.currentTarget.style.color = "var(--error)"; }}
                                onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border-2)"; e.currentTarget.style.color = "var(--text-4)"; }}
                              >{t("translation.cancel")}</button>
                            )}
                            {/* Clear cache button — for the WASM engine once the model is
                                cached; for API/native engines it clears locally-cached
                                translations (the escape hatch if a bad response was cached) */}
                            {engineTier && !modelProgress && (engineTier !== "wasm" || modelCached) && (
                              <HoverTip tip={t("tip.clearcache")} display="inline-flex">
                              <button
                                onMouseDown={e => e.preventDefault()}
                                onClick={clearModelCache}
                                style={{
                                  fontSize: 8, padding: "1px 5px", borderRadius: 3, cursor: "pointer",
                                  background: "transparent", border: "1px solid var(--border-2)",
                                  color: "var(--text-5)", lineHeight: "calc(1.4 * var(--lh-scale, 1))",
                                }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--error)"; e.currentTarget.style.color = "var(--error)"; }}
                                onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border-2)"; e.currentTarget.style.color = "var(--text-5)"; }}
                              >{t("translation.clear.cache")}</button>
                              </HoverTip>
                            )}
                          </span>
                        </span>
                      </label>
                    </div>
                  )}
                </div>
              )}

              {/* Save toggle */}
              <HoverTip tip={t("tip.save")}>
              <button
                className="hdr-btn-dd"
                onClick={e => {
                  e.stopPropagation();
                  const next = !persistEnabled;
                  setPersistEnabled(next);
                  if (!next) { try { localStorage.setItem(storageKey(institution.storagePrefix), JSON.stringify({ persist: false })); } catch {} }
                }}
                style={{ width: "100%", textAlign: "left", fontSize: 10, fontWeight: 700, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: `1px solid ${persistEnabled ? "var(--success-border)" : "var(--border-2)"}`,
                  color: persistEnabled ? "var(--success)" : "var(--text-4)" }}>
                {persistEnabled ? t("header.settings.save.on") : t("header.settings.save.off")}
              </button>
              </HoverTip>

              {/* Error lines toggle */}
              <HoverTip tip={t("tip.violations")}>
              <button className="hdr-btn-dd" onClick={() => setShowViolLines(v => !v)}
                style={{ width: "100%", textAlign: "left", fontSize: 10, fontWeight: 700, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: `1px solid ${showViolLines ? "var(--error)" : "var(--border-2)"}`,
                  color: showViolLines ? "var(--error)" : "var(--text-4)" }}>
                {showViolLines ? t("header.settings.violations.on") : t("header.settings.violations.off")}
              </button>
              </HoverTip>

              {/* Prereq-tree depth — how far the selection highlight expands.
                  Hidden for now: the multi-hop tree read as confusing. Drop the
                  `false &&` to bring the depth control back (see PlannerContext). */}
              {false && (
              <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 7 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", marginBottom: 5 }}>{t("header.settings.depth")}</div>
                {[
                  { label: t("header.settings.depth.prereq"), value: prereqDepth, set: setPrereqDepth },
                  { label: t("header.settings.depth.unlock"), value: unlockDepth, set: setUnlockDepth },
                ].map(({ label, value, set }) => (
                  <div key={label} style={{ marginBottom: 5 }}>
                    <div style={{ fontSize: 8.5, color: "var(--text-5)", marginBottom: 3 }}>{label}</div>
                    <div style={{ display: "flex", gap: 3 }}>
                      {[1, 2, 3, Infinity].map(d => {
                        const active = value === d;
                        return (
                          <button key={d} onClick={() => set(d)} style={{
                            flex: "1 1 auto", fontSize: 9, padding: "3px 4px", borderRadius: 4, cursor: "pointer",
                            background: active ? "var(--active-bg)" : "transparent",
                            border: `1px solid ${active ? "var(--active)" : "var(--border-2)"}`,
                            color: active ? "var(--active)" : "var(--text-4)",
                            fontWeight: active ? 700 : 400,
                          }}>{d === Infinity ? t("header.settings.depth.max") : d}</button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div style={{ fontSize: 8, color: "var(--text-5)", marginTop: 2, lineHeight: "calc(1.4 * var(--lh-scale, 1))" }}>
                  {t("header.settings.depth.hint")}
                </div>
              </div>
              )}

              {/* Collapse other credits toggle */}
              <HoverTip tip={t("tip.collapse")}>
              <button className="hdr-btn-dd" onClick={() => setCollapseOtherCredits(v => !v)}
                style={{ width: "100%", textAlign: "left", fontSize: 10, fontWeight: 700, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: `1px solid ${collapseOtherCredits ? "var(--active)" : "var(--border-2)"}`,
                  color: collapseOtherCredits ? "var(--active)" : "var(--text-4)" }}>
                {collapseOtherCredits ? t("header.settings.collapse.on") : t("header.settings.collapse.off")}
              </button>
              </HoverTip>

              {/* Keep grades private — a presentation switch for showing the
                  plan to someone else. Hides grades, GPA and everything
                  derived from them, and drops grades from JSON exports.
                  Nothing is deleted; switching it off restores them. */}
              <HoverTip tip={t("tip.privategrades")}>
              <button className="hdr-btn-dd" onClick={() => setPrivateGrades(!privateGrades)}
                style={{ width: "100%", textAlign: "left", fontSize: 10, fontWeight: 700, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: `1px solid ${privateGrades ? "var(--active)" : "var(--border-2)"}`,
                  color: privateGrades ? "var(--active)" : "var(--text-4)" }}>
                {privateGrades ? t("header.settings.privategrades.on") : t("header.settings.privategrades.off")}
              </button>
              </HoverTip>

              {/* Theme toggle */}
              <button className="hdr-btn-dd" onClick={cycleTheme}
                style={{ width: "100%", textAlign: "left", fontSize: 10, fontWeight: 600, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: "1px solid var(--border-2)", color: "var(--text-4)" }}>
                {t(`header.settings.theme.${themeName}`) || THEME_LABELS[themeName] || themeName}
              </button>

              {/* Co-op continuation logo toggle — hidden for now: the logo stays on by default
                  and we like it that way. Drop the `false &&` to bring the toggle back. */}
              {false && (
              <button className="hdr-btn-dd" onClick={() => setShowContLogo(v => !v)}
                style={{ width: "100%", textAlign: "left", fontSize: 10, fontWeight: 400, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: "1px solid var(--border-2)",
                  color: showContLogo ? "var(--text-3)" : "var(--text-5)" }}>
                {showContLogo ? t("header.settings.contlogo.on") : t("header.settings.contlogo.off")}
              </button>
              )}

              {/* Show unlocks toggle */}
              <HoverTip tip={t("tip.unlocks")}>
              <button className="hdr-btn-dd" onClick={() => setShowUnlocks(v => !v)}
                style={{ width: "100%", textAlign: "left", fontSize: 10, fontWeight: 400, cursor: "pointer",
                  background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                  border: "1px solid var(--border-2)",
                  color: showUnlocks ? "var(--text-3)" : "var(--text-5)" }}>
                {showUnlocks ? t("header.settings.unlocks.on") : t("header.settings.unlocks.off")}
              </button>
              </HoverTip>

              {/* Now tracking mode */}
              <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 7 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", marginBottom: 5 }}>{t("header.settings.tracking")}</div>
                <div style={{ display: "flex", gap: 3 }}>
                  {[
                    { id: "live",   labelKey: "header.settings.tracking.live" },
                    { id: "manual", labelKey: "header.settings.tracking.manual" },
                  ].map(({ id, labelKey }) => {
                    const active = semTrackingMode === id;
                    return (
                      <button key={id} onClick={() => setSemTrackingMode(id)} style={{
                        flex: "1 1 auto", fontSize: 9, padding: "3px 4px", borderRadius: 4, cursor: "pointer",
                        background: active ? "var(--active-bg)" : "transparent",
                        border: `1px solid ${active ? "var(--active)" : "var(--border-2)"}`,
                        color: active ? "var(--active)" : "var(--text-4)",
                        fontWeight: active ? 700 : 400,
                      }}>{t(labelKey)}</button>
                    );
                  })}
                </div>
                <div style={{ fontSize: 8, color: "var(--text-5)", marginTop: 4, lineHeight: "calc(1.4 * var(--lh-scale, 1))" }}>
                  {semTrackingMode === "live"   && t("header.settings.tracking.live.hint")}
                  {semTrackingMode === "manual" && t("header.settings.tracking.manual.hint")}
                </div>
              </div>

              {/* Zoom — hidden for now: the buttons mislabel the actual scale (browser zoom
                  often defaults to 125%, so "100%" here is wrong) and browser ⌘+/- covers it. */}
              {false && !isPhone && (
              <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 7 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", marginBottom: 5 }}>{t("header.settings.zoom")}</div>
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                  {/* use [null, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0] to included auto mode */}
                  {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map(v => {
                    const isActive = v === null ? manualZoom == null : manualZoom === v;
                    const label = v == null ? t("header.settings.zoom.auto") : `${Math.round(v * 100)}%`;
                    return (
                      <button key={label} onClick={() => setManualZoom(v)} style={{
                        flex: "1 1 auto", fontSize: 9, padding: "3px 4px", borderRadius: 4, cursor: "pointer",
                        background: isActive ? "var(--active-bg)" : "transparent",
                        border: `1px solid ${isActive ? "var(--active)" : "var(--border-2)"}`,
                        color: isActive ? "var(--active)" : "var(--text-4)",
                        fontWeight: isActive ? 700 : 400,
                      }}>{label}</button>
                    );
                  })}
                </div>
              </div>
              )}
              {/* Cohort dates moved out of Settings — the 🎓 button now shows on
                  every device (including phone) with its own date-picker popover. */}

              {/* Claude — optional integration; a single quiet entry until linked */}
              {aiAssistantAvailable && (
                <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 7, display: "flex", flexDirection: "column", gap: 5 }}>
                  <ClaudeSettings onConnect={() => { setShowQuickSet(false); setShowClaudeConnect(true); }} />
                </div>
              )}

              {/* Links */}
              <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 7, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", marginBottom: 1 }}>{t("header.links.title")}</div>
                <a href={`${import.meta.env.BASE_URL}northeastern/dev.html`} target="_blank" rel="noreferrer"
                  style={{ display: "block", width: "100%", textAlign: "left", fontSize: 10,
                    background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                    border: "1px solid var(--border-2)", color: "var(--text-4)",
                    textDecoration: "none", boxSizing: "border-box",
                    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace", letterSpacing: "0.02em" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "var(--text-4)"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border-2)"}
                >
                  /dev
                </a>
                <a href="https://github.com/nayugu/nu-map" target="_blank" rel="noreferrer"
                  style={{ display: "block", width: "100%", textAlign: "left", fontSize: 10,
                    background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                    border: "1px solid var(--border-2)", color: "var(--text-4)",
                    textDecoration: "none", boxSizing: "border-box",
                    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace", letterSpacing: "0.02em" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "var(--text-4)"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border-2)"}
                >
                  /github
                </a>
                <a href={`${import.meta.env.BASE_URL}privacy.html`} target="_blank" rel="noreferrer"
                  style={{ display: "block", width: "100%", textAlign: "left", fontSize: 10,
                    background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
                    border: "1px solid var(--border-2)", color: "var(--text-4)",
                    textDecoration: "none", boxSizing: "border-box",
                    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace", letterSpacing: "0.02em" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "var(--text-4)"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border-2)"}
                >
                  /privacy
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Cohort date picker — on every device; its popover is the date picker */}
        <div style={{ position: "relative" }}>
          <button
            className="hdr-btn"
            onClick={e => { e.stopPropagation(); openPhonePop(); toggleHeaderPop(showSettings, setShowSettings); }}
            title={t("header.cohort.button.title")}
            style={{
              fontSize: isPhone ? 8 : 10, cursor: "pointer", whiteSpace: "nowrap",
            color: cohortPreviewChanged ? "#fb923c" : showSettings ? "var(--text-2)" : "var(--text-4)",
            background: showSettings ? "var(--bg-surface)" : "var(--bg-surface-2)",
            border: cohortPreviewChanged ? "2px dashed #fb923c" : `1px solid ${showSettings ? "var(--active)" : "var(--border-2)"}`,
              borderRadius: 5, display: "inline-flex", alignItems: "center", lineHeight: 1, whiteSpace: "nowrap",
              ...(iconOnly ? { width: isPhone ? 22 : 26, height: isPhone ? 20 : 22, padding: 0, justifyContent: "center" } : { height: isPhone ? 20 : 22, padding: "0 8px" }),
            }}
          >{iconOnly ? "🎓" : `🎓 ${t("header.cohort.button")}`}</button>

          {showSettings && (
            // Viewport cap + scrolling comes from .hdr-pop (index.html) — a
            // class so the dvh declaration can fall back to vh where dvh is
            // unsupported. The touch scroll-lock effect above pairs with it.
            <div ref={settingsPopRef} onClick={e => e.stopPropagation()} className="hdr-pop" style={{
              position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 100,
              background: "var(--bg-surface)", border: "1px solid var(--border-2)", borderRadius: 8,
              padding: "14px 16px", minWidth: 270, boxShadow: "var(--shadow-modal)",
              display: "flex", flexDirection: "column", gap: 12,
              ...(phonePopFixed || {}),
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.05em" }}>{t("header.cohort.title")}</div>

              {/* Entry */}
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", marginBottom: 6 }}>{t("header.cohort.entry")}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {["fall", "spring"].map(s => {
                    const wouldBe = semOrd(s, planEntYear);
                    const blocked = wouldBe >= gradOrd;
                    return (
                      <button key={s}
                        onClick={() => { if (!blocked) setEntSem(s); }}
                        style={{
                          flex: 1, fontSize: 9, padding: "4px 0", borderRadius: 4,
                          cursor: blocked ? "not-allowed" : "pointer",
                          background: planEntSem === s ? (s === "fall" ? "var(--sel-fall-bg)" : "var(--sel-spr-bg)") : "transparent",
                          border: `1px solid ${planEntSem === s ? (s === "fall" ? "var(--sel-fall-border)" : "var(--sel-spr-border)") : blocked ? "var(--blocked-border)" : "var(--border-2)"}`,
                          color: planEntSem === s ? (s === "fall" ? "var(--sel-fall-text)" : "var(--sel-spr-text)") : blocked ? "var(--blocked-text)" : "var(--text-4)",
                          fontWeight: planEntSem === s ? 700 : 400, opacity: blocked ? 0.4 : 1,
                        }}
                      >{s === "fall" ? t("header.cohort.fall") : t("header.cohort.spring")}</button>
                    );
                  })}
                  <YearStepper
                    year={planEntYear} min={2010} max={maxEntYear}
                    canInc={entOrd + 2 < gradOrd && planEntYear < maxEntYear}
                    onDec={() => { if (planEntYear > 2010) setEntYear(planEntYear - 1); }}
                    onInc={() => { if (entOrd + 2 < gradOrd && planEntYear < maxEntYear) setEntYear(planEntYear + 1); }}
                  />
                </div>
              </div>

              {/* Graduation */}
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", marginBottom: 6 }}>{t("header.cohort.graduation")}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {["fall", "spring"].map(s => {
                    const wouldBe = semOrd(s, planGradYear);
                    const blocked = wouldBe <= entOrd;
                    return (
                      <button key={s}
                        onClick={() => { if (!blocked) setGradSem(s); }}
                        style={{
                          flex: 1, fontSize: 9, padding: "4px 0", borderRadius: 4,
                          cursor: blocked ? "not-allowed" : "pointer",
                          background: planGradSem === s ? (s === "fall" ? "var(--sel-fall-bg)" : "var(--sel-spr-bg)") : "transparent",
                          border: `1px solid ${planGradSem === s ? (s === "fall" ? "var(--sel-fall-border)" : "var(--sel-spr-border)") : blocked ? "var(--blocked-border)" : "var(--border-2)"}`,
                          color: planGradSem === s ? (s === "fall" ? "var(--sel-fall-text)" : "var(--sel-spr-text)") : blocked ? "var(--blocked-text)" : "var(--text-4)",
                          fontWeight: planGradSem === s ? 700 : 400, opacity: blocked ? 0.4 : 1,
                        }}
                      >{s === "fall" ? t("header.cohort.fall") : t("header.cohort.spring")}</button>
                    );
                  })}
                  <YearStepper
                    year={planGradYear} min={2010} max={2040}
                    canDec={gradOrd - 2 > entOrd}
                    onDec={() => { if (gradOrd - 2 > entOrd && planGradYear > 2010) setGradYear(planGradYear - 1); }}
                    onInc={() => { if (planGradYear < 2040) setGradYear(planGradYear + 1); }}
                  />
                </div>
              </div>

              {/* Summary */}
              <div style={{ fontSize: 9, color: "var(--text-6)", lineHeight: "calc(1.6 * var(--lh-scale, 1))", borderTop: "1px solid var(--border-1)", paddingTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <span>{planEntSem === "fall" ? t("header.cohort.fall") : t("header.cohort.spring")} {planEntYear} → {planGradSem === "fall" ? t("header.cohort.fall") : t("header.cohort.spring")} {planGradYear}</span>
                {(planGradYear < planEntYear || (planGradYear === planEntYear && planGradSem === "fall" && planEntSem === "spring"))
                  ? <span style={{ color: "var(--error)" }}>{t("header.cohort.error")}</span>
                  : <span style={{ color: "var(--success)" }}>
                      {t("header.cohort.duration", { yrs: ((planGradYear * 2 + (planGradSem === "fall" ? 1 : 0)) - (planEntYear * 2 + (planEntSem === "fall" ? 1 : 0)) + 1) / 2 })}
                    </span>
                }
              </div>
              {/* Sticky courses toggle */}
              <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 8 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", marginBottom: 5 }}>{t("header.cohort.sticky.label")}</div>
                <HoverTip tip={t("tip.sticky")}>
                <div style={{ display: "flex", borderRadius: 4, overflow: "hidden", border: "1px solid var(--border-2)" }}>
                  {[true, false].map(v => (
                    <button key={String(v)} onClick={() => setStickyCourses(v)}
                      style={{ flex: 1, fontSize: 9, padding: "3px 6px", cursor: "pointer",
                        background: stickyCourses === v ? "var(--active-bg)" : "transparent",
                        border: "none",
                        borderRight: v === true ? "1px solid var(--border-2)" : "none",
                        color: stickyCourses === v ? "var(--active)" : "var(--text-4)",
                        fontWeight: stickyCourses === v ? 700 : 400 }}>
                      {v ? t("header.cohort.sticky.on") : t("header.cohort.sticky.off")}
                    </button>
                  ))}
                </div>
                </HoverTip>
              </div>

            </div>
          )}
        </div>

        {/* Stats button — plan insights overlay. Unlike its neighbours this one
            is earned, not permanent: on every device it's absent until the user
            has built a real plan, and thereafter rides along with whichever
            plan is open (statsVisible, gated in PlannerContext). Flashes blue
            the first time it's ever unlocked. */}
        {statsVisible && (
        <button
          className="hdr-btn"
          onClick={e => { e.stopPropagation(); setShowStats(true); }}
          title={t("stats.button.title")}
          style={{ fontSize: isPhone ? 8 : 10, color: statsFlash ? "#fff" : statsTextFlash ? "var(--active)" : "var(--text-4)", background: statsFlash ? "var(--active)" : "var(--bg-surface-2)", border: `1px solid ${statsFlash ? "var(--active)" : "var(--border-2)"}`, borderRadius: 5, cursor: "pointer", flexShrink: 0, display: "inline-flex", alignItems: "center", lineHeight: 1, whiteSpace: "nowrap", transition: "background 0.55s ease, color 0.55s ease, border-color 0.55s ease", ...(iconOnly ? { width: isPhone ? 22 : 26, height: isPhone ? 20 : 22, padding: 0, justifyContent: "center" } : { height: isPhone ? 20 : 22, padding: "0 8px" }) }}
        >{iconOnly ? <StatChartIcon /> : <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><StatChartIcon />{t("stats.button")}</span>}</button>
        )}

        {/* About button */}
        <button
          className="hdr-btn"
          onClick={e => { e.stopPropagation(); setShowDisclaimer(true); }}
          title={t("header.about.title")}
          style={{ fontSize: isPhone ? 8 : 10, color: "var(--text-4)", background: "var(--bg-surface-2)", border: "1px solid var(--border-2)", borderRadius: 5, cursor: "pointer", flexShrink: 0, display: "inline-flex", alignItems: "center", lineHeight: 1, ...(iconOnly ? { width: isPhone ? 22 : 26, height: isPhone ? 20 : 22, padding: 0, justifyContent: "center" } : { height: isPhone ? 20 : 22, padding: "0 8px", whiteSpace: "nowrap" }) }}
        >{iconOnly ? "ⓘ" : `ⓘ ${t("header.about.button")}`}</button>

          </div>{/* ── end Group 2 ── */}
        </div>{/* end controls row */}
      </div>{/* end header */}

      {/* ── Relationship legend ── */}
      <div style={{ display: "flex", gap: isPhone ? 6 : 10, marginBottom: 8, flexWrap: "nowrap", alignItems: "center", overflow: "hidden" }}>
        {Object.entries(REL_STYLE).filter(([type]) =>
          type !== "corequisite-viol"
          && !(isPhone && (type === "substitution-prereq" || type === "substitution-prereq-order"))
          // grade lines exist only once a grade is entered — until then the
          // legend entry would explain a line that cannot appear
          && !(type === "prerequisite-grade" && !Object.keys(grades ?? {}).length)
        ).map(([type, s]) => (
            <div key={type} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: isPhone ? 8 : 9, color: "var(--text-4)", flexShrink: 0 }}>
            <svg width={isPhone ? 14 : 18} height="6">
              <line x1="0" y1="3" x2={isPhone ? 14 : 18} y2="3" stroke={s.color} strokeWidth="1.5" strokeDasharray={s.dash || ""} />
            </svg>
            <span>{t(`legend.${type}`) || s.label}</span>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 3, fontSize: isPhone ? 8 : 9, color: "var(--text-4)", flexShrink: 0 }}>
          <span style={{ display: "inline-block", width: isPhone ? 10 : 12, height: isPhone ? 10 : 12, borderRadius: 3, border: "2px solid var(--warn-bright)", flexShrink: 0 }} />
          <span>{t("legend.corequisite-viol")}</span>
        </div>
      </div>

      {/* ── Co-op / graduation conflict warning ── */}
      {coopGradConflicts.length > 0 && (
        <div style={{
          margin: "0 0 6px", padding: "9px 12px",
          background: "var(--warn-bg)", border: "1px solid var(--warn-border)",
          borderRadius: 6, display: "flex", alignItems: "flex-start", gap: 8,
        }}>
          <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>⚠️</span>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--warn-bright)", marginBottom: 2 }}>
              {t("header.coop.conflict.title")}
            </div>
            <div style={{ fontSize: 10, color: "var(--warn)", lineHeight: "calc(1.5 * var(--lh-scale, 1))" }}>
              {coopGradConflicts.length === 1
                ? t("header.coop.conflict.single", {
                    label: coopGradConflicts[0].label,
                    sem: planGradSem === "fall" ? t("header.cohort.fall") : t("header.cohort.spring"),
                    year: planGradYear,
                  })
                : t("header.coop.conflict.multi", {
                    labels: coopGradConflicts.map(w => w.label).join(", "),
                    sem: planGradSem === "fall" ? t("header.cohort.fall") : t("header.cohort.spring"),
                    year: planGradYear,
                  })
              }
            </div>
          </div>
        </div>
      )}

      {/* ── New plan modal ── */}
      <NewPlanModal open={showNewPlanModal} onClose={() => setShowNewPlanModal(false)} />
      <ClaudeConnectModal open={showClaudeConnect} onClose={() => setShowClaudeConnect(false)} />
      <ClaudeOAuthModal />
      <ClaudeProposalCard />

      {/* ── Auto-advance toast ── */}
      {semAdvanceToast && (
        <div style={{
          position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 200, background: "var(--bg-surface)", border: "1px solid var(--border-2)",
          borderRadius: 8, padding: "9px 14px", boxShadow: "var(--shadow-modal)",
          display: "flex", alignItems: "center", gap: 10, fontSize: 11,
          color: "var(--text-2)", whiteSpace: "nowrap",
        }}>
          <span>{t("header.settings.tracking.toast")} <strong><SemToastLabel semId={semAdvanceToast} SEMESTERS={SEMESTERS} /></strong></span>
          <button onClick={() => setSemAdvanceToast(null)} style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text-4)", fontSize: 13, lineHeight: 1, padding: 0,
          }}>✕</button>
        </div>
      )}
    </>
  );
}

// Renders a semester name via the shared <SemLabel>, so the toast, the planner rows and the
// availability popover all translate semester names identically. Resolves the semester's type via
// the grid's own `semTypeId` (the documented field for type comparisons) rather than parsing id
// prefixes — no hardcoded semester ids. Falls back to the raw label for non-standard entries.
// Clean monochrome bar-chart glyph for the Stats button (inherits text colour).
function StatChartIcon({ size = 11 }) {
  // Solid bars out-weighed the stroked glyphs beside it (⚙ ⇅) — slimmer
  // bars at 0.72 opacity so the mark reads as light as its neighbours in
  // both themes (opacity blends toward whichever surface is behind it).
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"
      style={{ display: "inline-block", verticalAlign: "-1px", flexShrink: 0, opacity: 0.72 }}>
      <rect x="0.8" y="6.5" width="2.1" height="5" rx="0.6" />
      <rect x="4.95" y="3.5" width="2.1" height="8" rx="0.6" />
      <rect x="9.1" y="1" width="2.1" height="10.5" rx="0.6" />
    </svg>
  );
}

function SemToastLabel({ semId, SEMESTERS }) {
  if (!semId) return null;
  const sem = SEMESTERS.find(s => s.id === semId);
  if (sem?.semTypeId && sem.semTypeId !== "incoming") {
    return <SemLabel typeId={sem.semTypeId} year={Number(semId.replace(/\D/g, "")) || ""} />;
  }
  return <TText>{sem?.label ?? semId}</TText>;
}

/**
 * Language search input with portal dropdown — mirrors CompanySearch UX.
 * Placeholder shows the active locale's native name. Typing filters locales;
 * selecting commits the change and clears the query.
 */
function LanguagePicker({ locale, locales, setLocale }) {
  const [query, setQuery] = useState("");
  const [open,  setOpen]  = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const handler = e => {
      if (wrapRef.current?.contains(e.target)) return;
      setOpen(false);
      setQuery("");
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, []);

  const handleChange = e => {
    const v = e.target.value;
    setQuery(v);
    setOpen(!!v.trim());
  };

  const select = l => {
    setLocale(l.code);
    setQuery("");
    setOpen(false);
  };

  const filtered = query.trim()
    ? locales.filter(l => {
        const q = query.toLowerCase();
        return l.nativeName.toLowerCase().includes(q)
          || l.name.toLowerCase().includes(q)
          || l.code.toLowerCase().includes(q);
      })
    : [];

  const currentNativeName = locales.find(l => l.code === locale)?.nativeName ?? "";

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        value={query}
        onChange={handleChange}
        onFocus={() => setOpen(!!query.trim() && filtered.length > 0)}
        onMouseDown={e => e.stopPropagation()}
        placeholder={currentNativeName}
        style={{
          width: "100%", boxSizing: "border-box",
          fontSize: 10, padding: "4px 7px", borderRadius: 4,
          border: "1px solid var(--border-2)", background: "var(--bg-surface-2)",
          color: "var(--text-3)", outline: "none",
        }}
      />
      {/* Anchored to the input via the DOM (absolute, not a fixed portal) so it
          stays put under the input on iOS when the keyboard shifts the viewport. */}
      {open && filtered.length > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, width: "100%",
          zIndex: 99999,
          background: "var(--bg-surface)", border: "1px solid var(--border-2)",
          borderRadius: 6, boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
          maxHeight: 200, overflowY: "auto",
          fontFamily: "'Inter', system-ui, sans-serif",
        }}>
          {filtered.map(l => (
            <div key={l.code}
              onMouseDown={e => { e.preventDefault(); select(l); }}
              onTouchEnd={e => { e.preventDefault(); select(l); }}
              style={{
                padding: "7px 10px", cursor: "pointer", fontSize: 11,
                color: l.code === locale ? "var(--active)" : "var(--text-2)",
                fontWeight: l.code === locale ? 700 : 400,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--card-bg-hov)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            >
              {l.nativeName}
              {l.code === locale && <span style={{ fontSize: 9, marginLeft: 6 }}>✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Phone plan name that fades out PER CHARACTER when clipped: the last three
    visible characters step down in opacity (whole glyphs — no gradient slicing
    through a stroke, matching the instructor-list opacity language), and
    everything past them is fully invisible, so no glyph ever touches the
    button border. Names that fit render untouched. All characters stay in the
    DOM (only opacity changes), so the measurement is stable across passes. */
function PlanNameFade({ text, rtl }) {
  const ref = useRef(null);
  const [fadeFrom, setFadeFrom] = useState(-1);   // index of first faded char; -1 = fits
  const STEPS = [0.6, 0.32, 0.12];                 // opacity of the last 3 visible chars

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let next = -1;
    if (el.scrollWidth > el.clientWidth + 1) {
      // Last character that fits entirely, with 2px clearance from the edge.
      const box = el.getBoundingClientRect();
      let lastFit = -1;
      for (let i = 0; i < el.children.length; i++) {
        const r = el.children[i].getBoundingClientRect();
        const fits = rtl ? r.left >= box.left + 2 : r.right <= box.right - 2;
        if (fits) lastFit = i; else break;
      }
      next = Math.max(0, lastFit - (STEPS.length - 1));
    }
    if (next !== fadeFrom) setFadeFrom(next);
  });

  return (
    <span ref={ref} style={{ overflow: "hidden", whiteSpace: "nowrap", minWidth: 0 }}>
      {[...text].map((ch, i) => {
        const step = fadeFrom === -1 ? -1 : i - fadeFrom;
        return (
          <span key={i} style={step >= 0 ? { opacity: STEPS[step] ?? 0 } : undefined}>{ch}</span>
        );
      })}
    </span>
  );
}

/** Subline under a plan name when the plan-switcher search matched by major. */
function MajorLabelText({ label, isPhone }) {
  const translated = useTranslatedText(label);
  return (
    <span style={{ display: "block", fontSize: isPhone ? 8 : 9, color: "var(--text-5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {scaleLatinRuns(translated)}
    </span>
  );
}

