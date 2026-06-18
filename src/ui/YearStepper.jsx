export default function YearStepper({ year, canDec = true, canInc = true, onDec, onInc }) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginLeft: 4, background: "var(--bg-app)", border: "1px solid var(--border-2)", borderRadius: 5, overflow: "hidden" }}>
      <button onClick={onDec}
        style={{ background: "none", border: "none", color: canDec ? "var(--text-3)" : "var(--border-2)", cursor: canDec ? "pointer" : "not-allowed", padding: "2px 7px", fontSize: 11 }}>◀</button>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", minWidth: 34, textAlign: "center" }}>{year}</span>
      <button onClick={onInc}
        style={{ background: "none", border: "none", color: canInc ? "var(--text-3)" : "var(--border-2)", cursor: canInc ? "pointer" : "not-allowed", padding: "2px 7px", fontSize: 11 }}>▶</button>
    </div>
  );
}
