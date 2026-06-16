// Dev-only: time-travel panel for testing semester tracking modes.
// Rendered only when import.meta.env.DEV is true (stripped from prod builds).
import { usePlanner }  from '../context/PlannerContext.jsx';
import { usePort }     from '../context/InstitutionContext.jsx';
import { ICalendar }   from '../ports/ICalendar.js';

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function DevClockPanel() {
  const { clockOverride, setClockOverride, semTrackingMode } = usePlanner();
  const calendar = usePort(ICalendar);

  const simDate   = clockOverride ?? new Date();
  const simYear   = simDate.getFullYear();
  const simMonth  = simDate.getMonth(); // 0-based

  const shift = (months) => {
    const d = new Date(simYear, simMonth + months, 15);
    setClockOverride(d);
  };

  const computedSemId = calendar.getCurrentSemId?.(simDate) ?? "—";

  return (
    <div style={{
      position: "fixed", bottom: 16, right: 16, zIndex: 9999,
      background: "var(--bg-surface)", border: "1.5px solid var(--warn-bright)",
      borderRadius: 8, padding: "8px 12px", boxShadow: "var(--shadow-modal)",
      fontFamily: "monospace", fontSize: 11, color: "var(--text-2)",
      display: "flex", flexDirection: "column", gap: 5, minWidth: 170,
    }}>
      <div style={{ fontWeight: 800, color: "var(--warn-bright)", letterSpacing: "0.08em", fontSize: 9 }}>
        DEV · CLOCK
      </div>

      {/* Month stepper */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button onClick={() => shift(-1)} style={btnStyle}>◀</button>
        <span style={{ flex: 1, textAlign: "center", fontWeight: 700 }}>
          {MONTH_NAMES[simMonth]} {simYear}
        </span>
        <button onClick={() => shift(1)}  style={btnStyle}>▶</button>
      </div>

      {/* What getCurrentSemId returns at this date */}
      <div style={{ fontSize: 10, color: "var(--text-4)" }}>
        <span style={{ color: "var(--text-5)" }}>sem → </span>
        <span style={{ color: "var(--active)", fontWeight: 700 }}>{computedSemId}</span>
      </div>

      {/* Current tracking mode */}
      <div style={{ fontSize: 9, color: "var(--text-5)" }}>
        mode: <span style={{ color: "var(--text-3)" }}>{semTrackingMode}</span>
        {clockOverride && <span style={{ color: "var(--warn-bright)" }}> · simulated</span>}
      </div>

      {/* Reset to real date */}
      {clockOverride && (
        <button onClick={() => setClockOverride(null)} style={{ ...btnStyle, width: "100%", marginTop: 2, fontSize: 9 }}>
          ↺ real date
        </button>
      )}
    </div>
  );
}

const btnStyle = {
  background: "var(--bg-surface-2)", border: "1px solid var(--border-2)",
  borderRadius: 4, color: "var(--text-3)", cursor: "pointer",
  padding: "2px 7px", fontSize: 11,
};
