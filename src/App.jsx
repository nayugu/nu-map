// APP  -- composition root (hexagonal architecture)
import { PlannerProvider, usePlanner } from './context/PlannerContext.jsx';
import { RelevanceProvider }           from './context/RelevanceContext.jsx';
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
import PalettePanel     from './ui/PalettePanel.jsx';
import MigrationBanner  from './ui/MigrationBanner.jsx';
import DevClockPanel    from './ui/DevClockPanel.jsx';

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
      <MigrationBanner />
      {/* {import.meta.env.DEV && <DevClockPanel />} */}
    </div>
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
                <PlannerApp />
              </RelevanceProvider>
            </PlannerProvider>
          </TranslationProvider>
        </LanguageProvider>
      </InstitutionProvider>
    </ThemeProvider>
  );
}
