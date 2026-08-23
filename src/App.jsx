// NU Map — Copyright (C) 2025-2026 Nathan Gu and Matthew Gu
// SPDX-License-Identifier: AGPL-3.0-only
// AGPL-3.0-only + attribution term under §7(b); see LICENSING.md and NOTICE.
//
// APP  -- composition root (hexagonal architecture)
import { useState, useEffect }         from 'react';
import { PlannerProvider, usePlanner } from './context/PlannerContext.jsx';
import { RelevanceProvider }           from './context/RelevanceContext.jsx';
import { CandidatesProvider }          from './context/CandidatesContext.jsx';
import { ThemeProvider }               from './context/ThemeContext.jsx';
import { InstitutionProvider }         from './context/InstitutionContext.jsx';
import { LanguageProvider }            from './context/LanguageContext.jsx';
import { TranslationProvider }         from './context/TranslationContext.jsx';
import { MaintenanceProvider }         from './context/MaintenanceContext.jsx';
import { institutionAdapter }          from './config.js';
import LoadingScreen   from './ui/LoadingScreen.jsx';
import RelationLines   from './ui/RelationLines.jsx';
import Header          from './ui/Header.jsx';
import SemRow          from './ui/SemRow.jsx';
import SummerRow       from './ui/SummerRow.jsx';
import GraduationRow   from './ui/GraduationRow.jsx';
import BankPanel       from './ui/BankPanel.jsx';
import InfoPanel       from './ui/InfoPanel.jsx';
import DisclaimerModal  from './ui/DisclaimerModal.jsx';
import DonateModal      from './ui/DonateModal.jsx';
import OnboardingModal  from './ui/OnboardingModal.jsx';
import FeatureTour       from './ui/FeatureTour.jsx';
import StatsPanel       from './ui/StatsPanel.jsx';
import PlanLibrary      from './ui/PlanLibrary.jsx';
import PalettePanel     from './ui/PalettePanel.jsx';
import MigrationBanner  from './ui/MigrationBanner.jsx';
import StorageAlarm     from './ui/StorageAlarm.jsx';
import MaintenancePage   from './ui/MaintenancePage.jsx';
import DevClockPanel    from './ui/DevClockPanel.jsx';
import TermReviewPrompt from './ui/TermReviewPrompt.jsx';
import PastClassRater   from './ui/PastClassRater.jsx';
import { scrollCardIntoView, overlayHeight } from './ui/smoothScroll.js';

// Main planner layout -- consumes PlannerContext
function PlannerApp() {
  const {
    loading, loadErr, loadPct,
    uiScale, isPhone, bankWidth,
    showPanel, panelHeight,
    SEMESTERS,
    timelineRef,
    setSelectedId, setShowPanel,
    studentType,
    revealTarget, cardRefs,
  } = usePlanner();

  // ── Reveal: the DOM half of "scroll the grid to that course" ──────
  // The context decides WHICH card (see `revealCourse`); this runs the scroll,
  // because only here are the element, the scroll container and the two insets
  // that hide parts of it — the sticky header, the info panel — all in reach.
  //
  // Two frames, then retries: the same state change that asks for the reveal
  // may also be un-collapsing the section the card sits in, and SemRow opens
  // that in an effect of its own, so the node can be a frame or two late. A
  // card that never appears (removed while the reveal was in flight) just runs
  // out of tries and nothing moves.
  useEffect(() => {
    if (!revealTarget) return;
    let cancelled = false, timer = null, tries = 0;
    const attempt = () => {
      if (cancelled) return;
      const el = cardRefs.current?.[revealTarget.pid];
      // A ref left behind by an unmounted card is detached, and a detached
      // node measures 0 — which is also what an un-laid-out one measures, so
      // both cases are simply "not ready yet".
      if (!el || el.getBoundingClientRect().height === 0) {
        if (tries++ < 6) timer = setTimeout(attempt, 50);
        return;
      }
      const container = timelineRef.current;
      const scale = isPhone ? 1 : (uiScale || 1);
      scrollCardIntoView(container, el, {
        scale,
        topInset: overlayHeight(container, '[data-timeline-header]', scale),
        // The info panel is drawn OVER the timeline, not beside it, so its
        // height is viewport the card must not land in. Measured, because it
        // hugs its content: `panelHeight` is only the cap.
        bottomInset: overlayHeight(document, '[data-info-panel]', scale),
      });
    };
    const raf = requestAnimationFrame(() => requestAnimationFrame(attempt));
    return () => { cancelled = true; cancelAnimationFrame(raf); clearTimeout(timer); };
  }, [revealTarget]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || loadErr) {
    return <LoadingScreen loadErr={loadErr} loadPct={loadPct} />;
  }

  // Build semester rows: pair consecutive sumA + sumB into one SummerRow
  const semRows = [];
  let i = 0;
  while (i < SEMESTERS.length) {
    const sem  = SEMESTERS[i];
    const next = SEMESTERS[i + 1];
    // Graduate plans don't use incoming credit
    if (sem.id === 'incoming' && studentType === 'graduate') { i += 1; continue; }
    if (
      sem.type === 'summer' &&
      next?.type === 'summer' &&
      next.id.replace('sumB', '') === sem.id.replace('sumA', '')
    ) {
      semRows.push(<SummerRow key={sem.id} semA={sem} semB={next} />);
      i += 2;
    } else if (sem.type === 'summer') {
      semRows.push(<SummerRow key={sem.id} semA={sem} semB={undefined} />);
      i += 1;
    } else {
      semRows.push(<SemRow key={sem.id} sem={sem} />);
      i += 1;
    }
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0,
      width: '100vw', height: '100vh',
      background: 'var(--bg-app)', overflow: 'hidden',
    }}>
      <div style={{
        position: isPhone ? 'relative' : 'absolute', top: 0, left: 0,
        width:  isPhone ? '100vw'             : `${100 / uiScale}vw`,
        height: isPhone ? '100dvh'            : `${100 / uiScale}vh`,
        minWidth:  isPhone ? undefined : undefined,
        minHeight: isPhone ? undefined : undefined,
        transformOrigin: '0 0',
        transform: isPhone ? 'none' : `scale(${uiScale})`,
        display: 'flex',
        fontFamily: "'Inter', system-ui, sans-serif",
        background: 'var(--bg-app)',
        color: 'var(--text-1)',
        overflow: 'hidden',
        fontSize: 13,
      }}>
        {/* SVG relation lines (fixed overlay) */}
        <RelationLines />

        {/* Left scratch pad — desktop only */}
        {!isPhone && <PalettePanel />}

        {/* Scrollable timeline */}
        <div
          ref={timelineRef}
          style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: isPhone ? `0 10px ${showPanel ? panelHeight + 24 : 90}px 10px` : '0 10px 240px 10px' }}
          onClick={() => { setSelectedId(null); setShowPanel(false); }}
        >
          <Header />
          {semRows}
          <GraduationRow />
        </div>

        {/* Right-hand sidebar + panels */}
        <BankPanel />
        <InfoPanel />
      </div>
      {/* Rendered outside the scaled container so it's unaffected by zoom */}
      <DisclaimerModal />
      <DonateModal />
      <OnboardingModal />
      <FeatureTour />
      <StatsPanel />
      <PlanLibrary />
      <MigrationBanner />
      {/* Non-modal, and below the content it is warning about: the useful response is
          to export or delete a plan, which needs the app rather than a dialog over it. */}
      <StorageAlarm />
      <TermReviewPreview />
      {/* {import.meta.env.DEV && <DevClockPanel />} */}
    </div>
  );
}

// ── Dev-only preview of the term review sheet ──────────────────────
// `?preview=review`, following the same convention RecoveryBoundary uses
// for `?preview=crash`. The real trigger (a completed term, some weeks
// after its end date) is not wired yet, and this exists so the sheet can
// be looked at without faking a system clock. DEV-gated, so it cannot
// reach a production bundle.
function TermReviewPreview() {
  const { SEMESTERS, placements, courseMap } = usePlanner();
  const search = window.location.search;
  const past = import.meta.env.DEV && /[?&]preview=past\b/.test(search);
  const on   = past || (import.meta.env.DEV && /[?&]preview=review\b/.test(search));
  const [open, setOpen] = useState(on);
  if (!on || !open) return null;

  // ?preview=past — the retrospective entry point, which owns its own term
  // selection, so it needs nothing assembled here.
  if (past) {
    return (
      <PastClassRater
        onSubmitOne={one => console.log("[preview] submit one", one)}
        onDismiss={() => setOpen(false)}
      />
    );
  }

  // Take whichever semester actually holds courses, so the sheet has rows
  // to draw against a real plan rather than a fixture.
  const bySem = {};
  for (const [pid, p] of Object.entries(placements ?? {})) {
    if (p?.semId) (bySem[p.semId] ??= []).push([pid, p]);
  }
  const semId = Object.keys(bySem).sort(
    (a, b) => bySem[b].length - bySem[a].length,
  )[0];
  const sem = SEMESTERS.find(s => s.id === semId);
  const rows = (bySem[semId] ?? []).map(([pid, p]) => {
    const c = courseMap?.[p.courseId] ?? {};
    return {
      pid,
      courseId: p.courseId,
      code:  c.code  ?? p.courseId,
      title: c.title ?? "",
      instructors: [],   // real instructors come from Banner once wired
    };
  });

  return (
    <TermReviewPrompt
      termLabel={sem?.label ?? sem?.id ?? "Term"}
      termCode={sem?.id ?? "preview"}
      rows={rows}
      onSubmit={(termCode, drafts) => console.log("[preview] submit", termCode, drafts)}
      onDismiss={() => setOpen(false)}
    />
  );
}

// Root -- wraps everything in context providers
// InstitutionProvider must be outside PlannerProvider because PlannerContext
// (and any component) can call usePort() to read the active adapter.
// wire() merges the institution's overrides on top of the generic defaults.
export default function App() {
  return (
    <ThemeProvider storagePrefix={institutionAdapter.institution.storagePrefix}>
      <InstitutionProvider adapter={institutionAdapter}>
        <LanguageProvider>
          <TranslationProvider catalogLocale={institutionAdapter.institution?.contentLocale ?? institutionAdapter.institution?.defaultLocale ?? "en"}>
            <PlannerProvider>
              {/* Inside PlannerProvider so the notice and the page can offer the
                  one-click library backup, and OUTSIDE PlannerApp so both still
                  render while the catalog is loading or has failed to load —
                  which is precisely when a maintenance window is the
                  explanation. `children` is built here, not in the provider, so
                  the provider's 10 s tick never re-renders this subtree; see
                  MaintenanceContext. */}
              <MaintenanceProvider>
                <RelevanceProvider>
                  <CandidatesProvider>
                    <PlannerApp />
                  </CandidatesProvider>
                </RelevanceProvider>
                <MaintenancePage />
              </MaintenanceProvider>
            </PlannerProvider>
          </TranslationProvider>
        </LanguageProvider>
      </InstitutionProvider>
    </ThemeProvider>
  );
}
