// ═══════════════════════════════════════════════════════════════════
// RELATION LINES  — SVG overlay for prereq / coreq bezier curves
// ═══════════════════════════════════════════════════════════════════
import { usePlanner } from "../context/PlannerContext.jsx";
import { REL_STYLE } from "../core/constants.js";

export default function RelationLines() {
  const { lines, bankWidth, isPhone } = usePlanner();

  return (
    <svg style={{
      position: "fixed", top: 0, left: 0,
      // On phone the bank is narrow and mobile browsers can clip fixed SVGs at
      // their own bounding rect even with overflow:visible.  Use full viewport
      // width so no bezier path is ever silently cut off.
      width: isPhone ? "100vw" : `calc(100% - ${bankWidth}px)`,
      height: "100vh",
      pointerEvents: "none", zIndex: 40, overflow: "visible",
    }}>
      <defs>
        {Object.entries(REL_STYLE).map(([type, s]) => (
          <marker key={type} id={`dot-${type}`} markerWidth="5" markerHeight="5" refX="2.5" refY="2.5">
            <circle cx="2.5" cy="2.5" r="2" fill={s.color} />
          </marker>
        ))}
      </defs>

      {lines.map((ln, i) => {
        const s    = REL_STYLE[ln.type] ?? REL_STYLE.prerequisite;
        const dx   = ln.tp.x - ln.fp.x;
        const dy   = ln.tp.y - ln.fp.y;
        const adx  = Math.abs(dx);
        const ady  = Math.abs(dy);
        const pull = Math.max(adx * 0.45, ady * 0.45, 60);
        // Use tangents aligned with the dominant axis so lines never loop.
        // Horizontal connection → horizontal tangents; vertical → vertical.
        let d;
        if (adx >= ady) {
          // Mostly horizontal: push control points in the direction of travel
          const sx = Math.sign(dx) || 1;
          d = `M ${ln.fp.x} ${ln.fp.y} C ${ln.fp.x + sx * pull} ${ln.fp.y} ${ln.tp.x - sx * pull} ${ln.tp.y} ${ln.tp.x} ${ln.tp.y}`;
        } else {
          // Mostly vertical (e.g. same-column coreqs): use vertical tangents
          const sy = Math.sign(dy) || 1;
          d = `M ${ln.fp.x} ${ln.fp.y} C ${ln.fp.x} ${ln.fp.y + sy * pull} ${ln.tp.x} ${ln.tp.y - sy * pull} ${ln.tp.x} ${ln.tp.y}`;
        }
        return (
          <path
            key={i} d={d}
            stroke={s.color} strokeWidth="1.5" fill="none"
            strokeDasharray={s.dash}
            markerEnd={`url(#dot-${ln.type})`}
            opacity="0.75"
          />
        );
      })}
    </svg>
  );
}
