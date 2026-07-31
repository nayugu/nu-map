export default function YearStepper({ year, canDec = true, canInc = true, onDec, onInc, size = 11 }) {
  const pad = `${Math.round(size / 5)}px ${Math.round(size / 1.6)}px`;
  return (
    <div style={{ display: "flex", alignItems: "center", marginLeft: 4, background: "var(--bg-app)", border: "1px solid var(--border-2)", borderRadius: 5, overflow: "hidden" }}>
      <button onClick={onDec}
        style={{ background: "none", border: "none", color: canDec ? "var(--text-3)" : "var(--border-2)", cursor: canDec ? "pointer" : "not-allowed", padding: pad, fontSize: size }}>◀</button>
      <span style={{ fontSize: size, fontWeight: 700, color: "var(--text-2)", minWidth: size * 3, textAlign: "center" }}>{year}</span>
      <button onClick={onInc}
        style={{ background: "none", border: "none", color: canInc ? "var(--text-3)" : "var(--border-2)", cursor: canInc ? "pointer" : "not-allowed", padding: pad, fontSize: size }}>▶</button>
    </div>
  );
}
