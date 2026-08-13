// NU Map — Copyright (C) 2025-2026 Nathan Gu and Matthew Gu
// SPDX-License-Identifier: AGPL-3.0-only
// AGPL-3.0-only + attribution term under §7(b); see LICENSING.md and NOTICE.
//
// APP  -- composition root (hexagonal architecture)
import { useState }                    from 'react';
import { PlannerProvider, usePlanner } from './context/PlannerContext.jsx';
import { RelevanceProvider }           from './context/RelevanceContext.jsx';
import { CandidatesProvider }          from './context/CandidatesContext.jsx';
import { ThemeProvider }               from './context/ThemeContext.jsx';
import { InstitutionProvider }         from './context/InstitutionContext.jsx';
import { LanguageProvider }            from './context/LanguageContext.jsx';
import { TranslationProvider }         from './context/TranslationContext.jsx';
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
import DevClockPanel    from './ui/DevClockPanel.jsx';
import TermReviewPrompt from './ui/TermReviewPrompt.jsx';
import PastClassRater   from './ui/PastClassRater.jsx';

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
  } = usePlanner();

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
              <RelevanceProvider>
                <CandidatesProvider>
                  <PlannerApp />
                </CandidatesProvider>
              </RelevanceProvider>
            </PlannerProvider>
          </TranslationProvider>
        </LanguageProvider>
      </InstitutionProvider>
    </ThemeProvider>
  );
}
