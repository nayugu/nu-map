// ═══════════════════════════════════════════════════════════════════
// STATS PANEL — full-screen "plan insights" overlay.
//
// Opened from the 📊 header button; rendered OUTSIDE the scaled planner
// container (App.jsx) so position:fixed measures against the viewport.
//
// Design rule: everything here is DEFINITE — derived only from what the
// user has placed in the plan (planned + already-taken, incl. incoming
// credit). No forecasts (no "typical instructor", seat availability, or
// historical weekday patterns).
//
// Sections: Overview · Composition (by level / by department) · Credit
// Load · Experience. Charts are hand-rolled div/SVG (no dependency).
// ═══════════════════════════════════════════════════════════════════
import { useState, useMemo, useEffect, useLayoutEffect, useRef, Fragment } from "react";
import { usePlanner } from "../context/PlannerContext.jsx";
import { usePort } from "../context/InstitutionContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { IAttributeSystem }   from "../ports/IAttributeSystem.js";
import { ICreditSystem }      from "../ports/ICreditSystem.js";
import { ISpecialTerms }      from "../ports/ISpecialTerms.js";
import { IMajorRequirements } from "../ports/IMajorRequirements.js";
import { subjectColor } from "../core/courseModel.js";
import { enteredGPA, countsInGPA } from "../core/gradeSystem.js";
import { getSemStudySH, inTimeline, filterInTimeline } from "../core/planModel.js";
import { computeGrantedAttrs, resolveTermByDuration } from "../core/specialTermUtils.js";
import {
  levelDistribution, mergeLoadTimeline, longestPrereqChains, courseTier,
} from "../core/planStats.js";
import { SemLabel } from "./SemLabel.jsx";
import CompanyLogo from "./CompanyLogo.jsx";

// Palette (light/dark safe; drawn from SUBJECT_PALETTE hues).
const UG_COLOR   = "#58a6ff";
const GRAD_COLOR = "#a78bfa";
const COOP_COLOR = "#34d399";
const SUMMER_COLOR = "#67e8f9";
const TIER_PALETTE = ["#ffd47e", "#ffb27d", "#ff9b59", "#ff9365", "#ff6b6b", "#fb7185", "#f472b6", "#e879f9"];
const tierColor = (tier) => TIER_PALETTE[Math.min(TIER_PALETTE.length - 1, Math.max(0, tier / 1000 - 1))];

const yearOf = (sem) => (String(sem?.id ?? "").match(/\d{4}/) || [""])[0];
const faviconUrl = (domain) =>
  `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
// Deterministic, distinct colour per company (stable across terms).
const companyColor = (w) => subjectColor(String(w.company || w.companyDomain || w.id || "?").toUpperCase());

// Clean monochrome office-building mark — the neutral fallback when a work
// term has no company logo (replaces the old briefcase emoji). Line-drawn,
// inherits currentColor, reads the same in light and dark.
function BuildingIcon({ size = 16, color = "var(--text-4)" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 21h18" />
      <path d="M6 21V5.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1V21" />
      <path d="M14 21V10a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1v11" />
      <path d="M9 8.6h1.6M9 12h1.6M9 15.4h1.6" strokeWidth="1.5" />
    </svg>
  );
}

// CSS effects injected once with the panel: a rotating glow band (grad-
// courses tile + each work experience) and a soft pulse (grad class chips).
const GLOW_CSS = `
@keyframes numap-spin { to { transform: rotate(360deg); } }
@keyframes numap-glow {
  0%,100% { box-shadow: 0 0 3px var(--glow), 0 0 1px var(--glow); }
  50%     { box-shadow: 0 0 9px var(--glow), 0 0 3px var(--glow); }
}`;

// Container width via ResizeObserver — lets the load chart fit exactly.
function useContainerWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(entries => setW(entries[0].contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// ── Small presentational primitives ─────────────────────────────────

function Section({ title, hint, children }) {
  return (
    <div style={{
      background: "var(--bg-surface)", border: "1px solid var(--border-1)",
      borderRadius: 10, padding: "14px 16px", marginBottom: 12,
    }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: "0.06em",
        textTransform: "uppercase", color: "var(--text-3)", marginBottom: hint ? 3 : 10 }}>{title}</div>
      {hint && <div style={{ fontSize: 11, color: "var(--text-5)", marginBottom: 11, lineHeight: "calc(1.5 * var(--lh-scale, 1))" }}>{hint}</div>}
      {children}
    </div>
  );
}

function StatTile({ label, value, sub, color }) {
  return (
    <div style={{ flex: "1 1 90px", minWidth: 90, background: "var(--bg-surface-2)",
      border: "1px solid var(--border-1)", borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: color ?? "var(--text-1)", lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 3, fontWeight: 600 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--text-5)", marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

// Headline tile wrapped in a slowly-rotating glow band — used to make a
// couple of numbers feel special (grad courses, work terms).
function GlowTile({ label, value, sub, color }) {
  return (
    <div style={{ position: "relative", flex: "1 1 90px", minWidth: 90, borderRadius: 8, padding: 1.5, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: "-60%",
        background: `conic-gradient(from 0deg, transparent 0deg, ${color} 55deg, transparent 135deg, transparent 235deg, ${color} 305deg, transparent 360deg)`,
        animation: "numap-spin 5s linear infinite" }} />
      <div style={{ position: "relative", background: "var(--bg-surface-2)", borderRadius: 6.5, padding: "10px 12px" }}>
        <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1.1, textShadow: `0 0 10px ${color}66` }}>{value}</div>
        <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 3, fontWeight: 600 }}>{label}</div>
        {sub && <div style={{ fontSize: 10, color: "var(--text-5)", marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );
}

// Rotating glow band around arbitrary content (used per work experience).
function GlowBox({ color, radius = 8, children }) {
  return (
    <div style={{ position: "relative", borderRadius: radius, padding: 1.5, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: "-60%",
        background: `conic-gradient(from 0deg, transparent 0deg, ${color} 55deg, transparent 135deg, transparent 235deg, ${color} 305deg, transparent 360deg)`,
        animation: "numap-spin 5s linear infinite" }} />
      <div style={{ position: "relative", background: "var(--bg-surface-2)", borderRadius: radius - 1.5, height: "100%" }}>{children}</div>
    </div>
  );
}

// Stacked proportion bar. Each segment's label (a tier like "2000" or a dept
// like "CS") sits ABOVE the bar, centred over its segment and coloured to
// match it; the segment's credit total is written INSIDE the bar in black.
// Both are shown only when the segment is physically wide enough (measured px
// vs. rough glyph width), so by default only the larger segments are labelled.
function StackBar({ segments, unit }) {
  const [ref, w] = useContainerWidth();
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    // 22px below, a touch more than the 20px between the groups that follow:
    // the bar is a summary of the whole list, so it has to sit apart from it
    // rather than look like the first row's decoration. Both Composition
    // views (by level, by department) share this component and this gap.
    <div ref={ref} style={{ marginBottom: 22 }}>
      {/* labels above, aligned to each segment, in the segment's colour */}
      <div style={{ display: "flex", marginBottom: 3 }}>
        {segments.map((s, i) => {
          const segPx = (s.value / total) * (w || 0);
          const name = s.name ?? `${s.value}`;
          return (
            <div key={i} style={{ width: `${(s.value / total) * 100}%`, textAlign: "center", overflow: "hidden" }}>
              {segPx >= name.length * 6.5 + 6 && (
                <span style={{ fontSize: 11, fontWeight: 800, color: s.color, whiteSpace: "nowrap" }}>{name}</span>
              )}
            </div>
          );
        })}
      </div>
      {/* the bar — credit total inside each segment, in black */}
      <div style={{ display: "flex", height: 20, borderRadius: 6, overflow: "hidden", background: "var(--bg-surface-2)" }}>
        {segments.map((s, i) => {
          const segPx = (s.value / total) * (w || 0);
          const full = `${s.value} ${unit}`;
          const label = segPx >= full.length * 5.7 + 8 ? full
            : segPx >= `${s.value}`.length * 7 + 6 ? `${s.value}` : "";
          return (
            <div key={i} title={s.title} style={{ width: `${(s.value / total) * 100}%`, background: s.color,
              display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
              borderRight: i < segments.length - 1 ? "1px solid var(--bg-surface)" : "none" }}>
              {label && <span style={{ fontSize: 10.5, fontWeight: 800, color: "#000", whiteSpace: "nowrap" }}>{label}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// CORS-readable favicon proxy (wsrv.nl serves Access-Control-Allow-Origin:*),
// so the logo can be drawn to a canvas and read pixel-by-pixel. The Google
// favicon service itself doesn't send CORS headers, which taints the canvas.
const colorSrcUrl = (domain) =>
  `https://wsrv.nl/?url=${encodeURIComponent(`www.google.com/s2/favicons?domain=${domain}&sz=64`)}&w=32&h=32&output=png`;

// Dominant (most-frequent) colour of a company logo, ignoring near-black /
// near-white pixels — a systematic per-company accent. Falls back to a stable
// hash colour if the image can't be read.
function useDominantColor(domain, fallback) {
  const [color, setColor] = useState(fallback);
  useEffect(() => {
    setColor(fallback);
    if (!domain) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const S = 24;
        const cv = document.createElement("canvas");
        cv.width = S; cv.height = S;
        const ctx = cv.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, S, S);
        const { data } = ctx.getImageData(0, 0, S, S);
        const buckets = new Map();
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 128) continue;
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          if (max > 232 && min > 210) continue;   // near-white
          if (max < 28) continue;                  // near-black
          const key = `${r >> 4},${g >> 4},${b >> 4}`;
          const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
          e.n += 1; e.r += r; e.g += g; e.b += b;
          buckets.set(key, e);
        }
        let top = null;
        for (const e of buckets.values()) if (!top || e.n > top.n) top = e;
        if (top && !cancelled)
          setColor(`rgb(${Math.round(top.r / top.n)},${Math.round(top.g / top.n)},${Math.round(top.b / top.n)})`);
      } catch { /* tainted canvas — keep fallback */ }
    };
    img.src = colorSrcUrl(domain);
    return () => { cancelled = true; };
  }, [domain, fallback]);
  return color;
}

// A clickable course pill (opens the course info panel). Coloured by its
// department; grad-level courses pulse with a glow in that same dept colour.
function ClassChip({ id, cmap, onOpen, faded, fz = 11 }) {
  const c = cmap[id];
  const deptColor = subjectColor(c?.subject ?? "");
  // Same visual language as a course card: coloured course code on grey card
  // chrome (the previous full-saturation coloured borders read neon in dark
  // mode). Hover matches the card hover tint.
  return (
    <button onClick={() => onOpen(id)} title={c?.title ?? id}
      style={{
        fontSize: fz, fontWeight: 800, padding: "3px 7px", borderRadius: 5, cursor: "pointer",
        background: "var(--card-bg)", color: deptColor, whiteSpace: "nowrap", lineHeight: 1.3,
        border: `1px ${faded ? "dashed" : "solid"} var(--border-card)`, opacity: faded ? 0.4 : 1,
        transition: "background 0.12s, color 0.12s, border-color 0.12s",
      }}
      // Hover inverts: subject-colour fill, near-black code. The palette is
      // uniformly bright (vivid pastel register), so dark text keeps strong
      // contrast on every subject colour in BOTH themes; white wouldn't.
      onMouseEnter={e => { e.currentTarget.style.background = deptColor; e.currentTarget.style.color = "#0b0f14"; e.currentTarget.style.borderColor = deptColor; }}
      onMouseLeave={e => { e.currentTarget.style.background = "var(--card-bg)"; e.currentTarget.style.color = deptColor; e.currentTarget.style.borderColor = "var(--border-card)"; }}>
      {c?.code ?? id}
    </button>
  );
}

// Header + wrapped clickable chips for one group (a level tier or a dept).
// A per-subject GPA on a FIXED 0–4 scale, so rows are comparable at a
// glance rather than by reading digits.
//
// Two deliberate choices:
//  · Fixed-width and right-aligned. The chip used to sit straight after a
//    variable-width subject name, so no two numbers shared an x position
//    and comparison meant reading every one. Aligning the column does more
//    for comparability than any encoding.
//  · A reference tick at 2.000, the threshold nearly every catalog GPA
//    rule uses. A bare 0–4 bar wastes most of its range — real GPAs sit
//    between 2 and 4, where 3.000 and 3.500 differ by an eighth of the
//    width and look alike. The tick restores the comparison that matters
//    (above or below the line, and by how far) without truncating the axis
//    and exaggerating small gaps.
const GPA_SCALE_MAX = 4;
const GPA_REF = 2;
const GPA_BAR_W = 92;      // long enough that a 0.3 difference is visible

/**
 * The shared floor for every meter in the list. A 0-anchored axis wastes
 * most of its length — a plan whose subjects all sit between 3.2 and 3.9
 * renders as five nearly-identical bars in the right quarter.
 *
 * The floor is therefore the highest of 3 / 2 / 0 that still sits at or
 * below EVERY value, so nothing is ever clamped: a single 1.17 drops the
 * whole list to 0 rather than pinning that subject to the left edge where
 * it would be indistinguishable from a 2.000.
 *
 * One floor for the whole list, never per row — a bar length has to mean
 * the same thing on every line or the comparison it exists for is a lie.
 * Because a truncated axis does exaggerate differences, the range is
 * always stated in each meter's tooltip.
 */
function gpaFloor(values) {
  if (!values.length) return 0;
  const min = Math.min(...values);
  return min >= 3 ? 3 : min >= 2 ? 2 : 0;
}

function GpaMeter({ value, title, color, provisional = false, floor = 0 }) {
  const span = GPA_SCALE_MAX - floor;
  const pct = Math.max(0, Math.min(1, (value - floor) / span)) * 100;
  const below = value < GPA_REF;
  const showRef = floor < GPA_REF;   // the 2.000 line, when it is on-scale
  return (
    // A single graded course is dimmed rather than hidden. Suppressing it
    // entirely meant a student who had finished one course in a subject
    // entered a grade and saw nothing — a broken affordance, and worse than
    // the thing suppression was guarding against. Dimming keeps the data
    // visible while saying "not settled yet"; the exact basis (1 of 3) is
    // in the tooltip.
    <span title={title} style={{ display: "inline-flex", alignItems: "center", gap: 7,
      flexShrink: 0, cursor: "default", letterSpacing: 0,
      opacity: provisional ? 0.5 : 1 }}>
      <span style={{ position: "relative", width: GPA_BAR_W, height: 6, borderRadius: 3,
        background: "var(--border-2)", overflow: "hidden", display: "inline-block" }}>
        {/* The SUBJECT's colour, not a semantic green: this bar is part of
            the row's identity, and every other subject mark in the panel
            (chips, stripes, StackBar segments) is already keyed that way.
            Below/above the threshold is carried by position against the
            tick, and by the figure's colour — not by recolouring the fill,
            which would fight the palette. */}
        <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`,
          background: color ?? "var(--text-4)", borderRadius: 3 }} />
        {/* The 2.000 reference, over the fill so it stays legible — drawn
            only while it is inside the range. Once the floor rises to 2 or
            3 every subject is above it and the line would just pin itself
            to the left edge, implying a threshold that is no longer in
            play. */}
        {showRef && (
          <span style={{ position: "absolute", left: `${((GPA_REF - floor) / span) * 100}%`, top: -1, bottom: -1,
            width: 1, background: "var(--bg-surface)", opacity: 0.95 }} />
        )}
      </span>
      <span style={{ fontSize: 11, fontWeight: 700,
        color: below ? "var(--warn)" : "var(--text-3)",
        width: 30, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {value.toFixed(2)}
      </span>
    </span>
  );
}

function CourseGroup({ title, sub, badge, badgeSlot = false, ids, cmap, onOpen, fadedIds }) {
  return (
    // Deliberately asymmetric spacing: the header stays tight to its OWN
    // chips (5px below), while the gap to the NEXT group is wide. Proximity
    // is what makes each subject read as one block — at a uniform 11px the
    // last IE chip sat as close to the CS header as to its own, so the eye
    // had to use the bold weight alone to find the boundaries.
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5, gap: 8 }}>
        {/* With a GPA column the subject name takes a fixed width, so every
            meter starts at the SAME left edge — reading down the column is
            the whole point. Only in that mode: the by-level view's titles
            ("2000-level") are far longer and must stay free-width. */}
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text-2)", flexShrink: 0,
                       ...(badgeSlot ? { width: 52 } : {}) }}>{title}</span>
        {/* LEFT of the subline, not right of it. Reserving a right-hand slot
            left a ragged hole on every ungraded subject — which is most of
            them — so the absence was louder than the data. Here an empty
            meter just widens the gap that already separates label from
            subline, and reads as nothing at all. */}
        {badgeSlot && (
          <span style={{ width: GPA_BAR_W + 37, display: "inline-flex", flexShrink: 0 }}>
            {badge && <GpaMeter value={badge.value} title={badge.title} color={badge.color} provisional={badge.provisional} floor={badge.floor ?? 0} />}
          </span>
        )}
        <span style={{ fontSize: 12, color: "var(--text-4)", flex: 1, textAlign: "right", minWidth: 0 }}>{sub}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {ids.map(id => <ClassChip key={id} id={id} cmap={cmap} onOpen={onOpen} faded={fadedIds?.has(id)} fz={12.5} />)}
      </div>
    </div>
  );
}

// ── Skyline: dept columns × level bands, every chip a clickable unit ──
// One figure carries both flat views at once: column order = credit
// magnitude (byDept arrives SH-sorted), vertical position = level band.
// Bands run contiguously from the lowest to the highest tier present —
// an empty band is information (a dept skipped a level). Grad bands
// (≥5000) rule and label in the grad colour. Incoming-credit chips fade.
// Because the grid is sparse by nature it carries ZOOM controls (CSS
// `zoom`, so layout and scrollbars track the scale).
function Skyline({ byDept, cmap, unit, onOpen, fadedIds }) {
  // Canvas-style viewport: pinch zoom (a macOS trackpad pinch reaches the
  // browser as ctrl+wheel; a touchscreen pinch is two moving touches),
  // anchored at the cursor/pinch midpoint, plus grab-and-drag panning.
  // SMOOTHNESS: gestures fire several events per frame and CSS `zoom`
  // re-lays-out the grid, so the gesture writes zoom + scroll to the DOM
  // imperatively, at most once per animation frame — React state (the %
  // pill) only syncs once the gesture settles. Native listeners are
  // NON-PASSIVE (React's synthetic handlers can't preventDefault the
  // page zoom); plain scrolling and touch drag pan natively.
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const wrapRef = useRef(null);
  const gridRef = useRef(null);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const clamp = (z) => Math.min(1.6, Math.max(0.55, z));
    let target = null;                       // { z, vx, vy } — latest within this frame
    let raf = 0, settle = 0;
    const flush = () => {
      raf = 0;
      if (!target || !gridRef.current) return;
      const z0 = zoomRef.current, z1 = clamp(target.z);
      if (z1 !== z0) {
        // Keep the viewport point (vx, vy) fixed: CSS `zoom` scales the
        // scroll geometry, so re-derive the content point and re-aim.
        gridRef.current.style.zoom = z1;
        el.scrollLeft = ((el.scrollLeft + target.vx) / z0) * z1 - target.vx;
        el.scrollTop  = ((el.scrollTop  + target.vy) / z0) * z1 - target.vy;
        zoomRef.current = z1;
      }
      target = null;
      clearTimeout(settle);
      settle = setTimeout(() => setZoom(zoomRef.current), 140); // sync the % pill
    };
    const queueZoom = (z, vx, vy) => {
      target = { z, vx, vy };
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const onWheel = (e) => {
      if (!e.ctrlKey) return;                // plain wheel/two-finger keeps panning
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const base = target?.z ?? zoomRef.current;
      queueZoom(base * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    };
    let pinch = null;                        // { d0, z0 }
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTouchStart = (e) => { if (e.touches.length === 2) pinch = { d0: dist(e.touches), z0: zoomRef.current }; };
    const onTouchMove = (e) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
      queueZoom(pinch.z0 * (dist(e.touches) / pinch.d0), mx, my);
    };
    const onTouchEnd = (e) => { if (e.touches.length < 2) pinch = null; };
    // Grab-and-drag panning (mouse). Chips stay clickable — drags starting
    // on a button are left alone.
    let drag = null;
    const onMouseDown = (e) => {
      if (e.button !== 0 || e.target.closest("button")) return;
      drag = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
      el.style.cursor = "grabbing";
      e.preventDefault();
    };
    const onMouseMove = (e) => {
      if (!drag) return;
      el.scrollLeft = drag.sl - (e.clientX - drag.x);
      el.scrollTop  = drag.st - (e.clientY - drag.y);
    };
    const onMouseUp = () => { drag = null; el.style.cursor = "grab"; };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      cancelAnimationFrame(raf); clearTimeout(settle);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const cells = new Map();          // `${subject}|${tier}` → ids
  const tierTotals = new Map();     // tier → { sh, n }  (the numbers ARE the point)
  const present = [];
  for (const g of byDept) {
    for (const id of g.ids) {
      const tier = courseTier(cmap[id]?.number) ?? 0;
      present.push(tier);
      const k = `${g.subject}|${tier}`;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(id);
      const tt = tierTotals.get(tier) ?? { sh: 0, n: 0 };
      tt.sh += cmap[id]?.sh ?? 0; tt.n += 1;
      tierTotals.set(tier, tt);
    }
  }
  if (!byDept.length || !present.length) return null;
  const lo = Math.min(...present), hi = Math.max(...present);
  const tiers = [];
  for (let tr = hi; tr >= lo; tr -= 1000) tiers.push(tr);

  const rule = (tier) => `1px dashed ${tier >= 5000 ? GRAD_COLOR + "66" : "var(--border-1)"}`;
  return (
    <div style={{ position: "relative" }}>
      {zoom !== 1 && (
        <button onClick={() => { zoomRef.current = 1; if (gridRef.current) gridRef.current.style.zoom = 1; setZoom(1); }} title="Reset zoom"
          style={{ position: "absolute", top: -4, right: 0, zIndex: 5,
            fontSize: 9.5, fontVariantNumeric: "tabular-nums", lineHeight: 1, padding: "3px 7px",
            background: "var(--bg-surface-2)", border: "1px solid var(--border-2)", borderRadius: 99,
            color: "var(--text-4)", cursor: "pointer" }}>
          {Math.round(zoom * 100)}%
        </button>
      )}
      {/* The bounded canvas: pan/zoom activates only inside this frame. */}
      <div ref={wrapRef} style={{
        overflow: "auto", maxHeight: 480, cursor: "grab",
        overscrollBehavior: "contain", userSelect: "none",
        border: "1px solid var(--border-1)", borderRadius: 8,
        background: "var(--bg-surface-2)",
      }}>
        <div ref={gridRef} style={{
          zoom,
          display: "grid", columnGap: 8,
          gridTemplateColumns: `78px repeat(${byDept.length}, minmax(92px, 1fr))`,
          minWidth: byDept.length * 100 + 86,
          paddingRight: 10, paddingBottom: 10,
        }}>
          {/* header row: the per-department aggregates — FROZEN (sticky top),
              like the tier gutter (sticky left), so the axes stay readable
              while panning the sparse canvas. The corner pins both ways. */}
          <div style={{ position: "sticky", top: 0, left: 0, zIndex: 3, background: "var(--bg-surface-2)" }} />
          {byDept.map(g => (
            <div key={g.subject} style={{ position: "sticky", top: 0, zIndex: 2,
              background: "var(--bg-surface-2)", padding: "8px 0 7px 2px" }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: subjectColor(g.subject) }}>{g.subject}</div>
              <div style={{ fontSize: 10.5, color: "var(--text-4)", fontVariantNumeric: "tabular-nums", marginTop: 1 }}>
                {g.sh} {unit} · {g.count}
              </div>
            </div>
          ))}
          {/* level bands: the gutter carries each band's aggregate */}
          {tiers.map(tier => {
            const tt = tierTotals.get(tier);
            return (
              <Fragment key={tier}>
                <div style={{ position: "sticky", left: 0, zIndex: 1,
                  background: "var(--bg-surface-2)", borderTop: rule(tier), padding: "5px 0 5px 10px" }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, fontVariantNumeric: "tabular-nums",
                    color: tier >= 5000 ? GRAD_COLOR : "var(--text-4)" }}>{tier}</div>
                  {tt && (
                    <div style={{ fontSize: 10, color: "var(--text-5)", fontVariantNumeric: "tabular-nums", marginTop: 1 }}>
                      {tt.sh} {unit} · {tt.n}
                    </div>
                  )}
                </div>
                {byDept.map(g => (
                  <div key={g.subject} style={{ borderTop: rule(tier), padding: "5px 0 9px", minHeight: 14,
                    display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
                    {(cells.get(`${g.subject}|${tier}`) ?? []).map(id => (
                      <ClassChip key={id} id={id} cmap={cmap} onOpen={onOpen} faded={fadedIds?.has(id)} fz={12.5} />
                    ))}
                  </div>
                ))}
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// One work experience, wrapped in a glow band whose colour is taken from
// the company logo's dominant colour (falling back to a stable hash).
function WorkCard({ w }) {
  const color = useDominantColor(w.companyDomain, companyColor(w));
  return (
    <GlowBox color={color} radius={8}>
      <div style={{ padding: "9px 10px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
          {w.companyDomain
            ? <CompanyLogo key={w.companyDomain} domain={w.companyDomain} size={26} />
            : <div style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 6,
                background: "var(--bg-surface)", border: "1px solid var(--border-1)",
                display: "flex", alignItems: "center", justifyContent: "center" }}>
                <BuildingIcon size={15} color="var(--text-4)" />
              </div>}
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-1)", overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.company || w.typeLabel}</div>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {w.subline || w.typeLabel}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-5)", marginTop: 2 }}>
          {w.semTypeId && w.year ? <SemLabel typeId={w.semTypeId} year={w.year} /> : null}
          {w.durLabel ? ` · ${w.durLabel}` : ""}
        </div>
      </div>
    </GlowBox>
  );
}

// ── Credit-load line chart ───────────────────────────────────────────
// Plots EVERY term from entry to graduation (summers merged). A term with
// classes is a point (y = credits); the first and last such terms get an
// enlarged "milestone" dot. Terms with no classes — empty terms or co-op /
// work terms (both read as a break) — carry no dot: the line runs dotted +
// faint across them, and co-op columns (or a Summer A / B half) are shaded
// with the company logo. Width tracks the container.
function LoadChart({ rows, fullTimeMin, semesterMax, shortSem }) {
  const [ref, cw] = useContainerWidth();

  const H = 190, padL = 30, padR = 14, padT = 20, padB = 30;
  const W = Math.max(280, cw || 280);
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const m = rows.length;
  const colW = m > 0 ? plotW / m : plotW;
  const xFor = (k) => padL + (k + 0.5) * colW;

  const shVals = rows.filter(r => r.sh > 0).map(r => r.sh);
  const yMin = Math.min(12, ...(shVals.length ? shVals : [12]));
  let yMax = Math.max(22, ...(shVals.length ? shVals : [22]));
  if (yMax <= yMin) yMax = yMin + 1;
  const yFor = (v) => padT + plotH * (1 - (v - yMin) / (yMax - yMin));

  // First / last term that actually has classes — the study span the line
  // spans and where the milestone dots sit.
  const creditIdx = rows.map((r, i) => (r.sh > 0 ? i : -1)).filter(i => i >= 0);
  const firstC = creditIdx[0], lastC = creditIdx[creditIdx.length - 1];

  // Line y for a term: its credits, or a straight interpolation between the
  // nearest credit-bearing terms (so breaks read as a straight dotted run).
  const lineVal = (k) => {
    const r = rows[k];
    if (r.sh > 0) return r.sh;
    let l = k - 1; while (l >= 0 && !(rows[l].sh > 0)) l -= 1;
    let rr = k + 1; while (rr < m && !(rows[rr].sh > 0)) rr += 1;
    if (l >= 0 && rr < m) return rows[l].sh + (rows[rr].sh - rows[l].sh) * ((k - l) / (rr - l));
    if (l >= 0) return rows[l].sh;
    if (rr < m) return rows[rr].sh;
    return (yMin + yMax) / 2;
  };
  const pts = rows.map((r, k) => ({ x: xFor(k), y: yFor(lineVal(k)), r, sh: r.sh }));

  const ticks = [];
  const tickStep = yMax - yMin <= 12 ? 4 : 6;
  for (let v = yMin; v <= yMax + 0.01; v += tickStep) ticks.push(Math.round(v));
  if (ticks[ticks.length - 1] !== yMax) ticks.push(yMax);
  const labelEvery = colW < 34 ? 2 : 1;

  // Group consecutive work terms that belong to the same instance into one
  // "run" (a 6-month co-op spans two term columns but is a single stint), so
  // the chart shades the whole span and draws exactly one centred logo.
  const coopRuns = [];
  rows.forEach((r, k) => {
    if (!r.hasWork) return;
    const n = r.slots.length;
    const spans = [];
    r.slots.forEach((s, i) => {
      if (s.occupied) spans.push([padL + (k + i / n) * colW, padL + (k + (i + 1) / n) * colW]);
    });
    if (!spans.length) return;
    const prev = coopRuns[coopRuns.length - 1];
    if (prev && prev.endK === k - 1 && r.workId != null && prev.workId === r.workId) {
      prev.spans.push(...spans);
      prev.endK = k;
    } else {
      coopRuns.push({ workId: r.workId, domain: r.work?.companyDomain, spans, endK: k });
    }
  });

  return (
    <div ref={ref} style={{ width: "100%" }}>
      {m > 0 && (
        <svg width={W} height={H} style={{ display: "block" }}>
          {semesterMax > fullTimeMin && (
            <rect x={padL} width={plotW} y={yFor(Math.min(yMax, semesterMax))}
              height={Math.max(0, yFor(Math.max(yMin, fullTimeMin)) - yFor(Math.min(yMax, semesterMax)))}
              fill={UG_COLOR} opacity="0.06" />
          )}
          {ticks.map((v, i) => (
            <g key={i}>
              <line x1={padL} y1={yFor(v)} x2={padL + plotW} y2={yFor(v)} stroke="var(--border-1)" opacity="0.6" />
              <text x={padL - 6} y={yFor(v) + 3} textAnchor="end" fontSize="9.5" fill="var(--text-5)">{v}</text>
            </g>
          ))}
          {/* co-op shaded columns / summer halves + ONE centred logo per stint.
              Consecutive terms of the same instance (a 6-month co-op's start +
              continuation) merge into a single block so the logo sits centred
              across the whole span instead of repeating / splitting per term. */}
          {coopRuns.map((run, ri) => {
            const x0 = Math.min(...run.spans.map(s => s[0]));
            const x1 = Math.max(...run.spans.map(s => s[1]));
            const logoX = (x0 + x1) / 2;
            const domain = run.domain;
            // Back-to-back stints would fuse into one block — a hairline
            // surface-coloured seam marks the boundary between DIFFERENT
            // work terms (never the outer edges).
            const prev = coopRuns[ri - 1];
            const touchesPrev = prev && Math.abs(x0 - Math.max(...prev.spans.map(s => s[1]))) < 0.5;
            return (
              <g key={`coop-${ri}`}>
                {run.spans.map(([a, b], i) => (
                  <rect key={i} x={a} y={padT} width={Math.max(0, b - a)} height={plotH} fill={COOP_COLOR} opacity="0.14" />
                ))}
                {touchesPrev && (
                  <line x1={x0} y1={padT} x2={x0} y2={padT + plotH} stroke="var(--bg-surface)" strokeWidth="2" strokeDasharray="6 4" strokeDashoffset="3" opacity="0.7" />
                )}
                {domain
                  ? <image href={faviconUrl(domain)} xlinkHref={faviconUrl(domain)} x={logoX - 9} y={padT + 6} width="18" height="18" />
                  : <svg x={logoX - 9} y={padT + 6} width="18" height="18" viewBox="0 0 24 24" fill="none"
                      stroke="var(--text-4)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 21h18" />
                      <path d="M6 21V5.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1V21" />
                      <path d="M14 21V10a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1v11" />
                      <path d="M9 8.6h1.6M9 12h1.6M9 15.4h1.6" strokeWidth="1.5" />
                    </svg>}
              </g>
            );
          })}
          {/* connecting segments across the study span (dotted over breaks) */}
          {firstC != null && pts.slice(firstC, lastC).map((p, i) => {
            const k = firstC + i;
            const q = pts[k + 1];
            const dotted = p.sh === 0 || q.sh === 0;
            return (
              <line key={`seg-${k}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y}
                stroke={UG_COLOR} strokeWidth={dotted ? 1.5 : 2.5}
                strokeDasharray={dotted ? "3 3" : ""} opacity={dotted ? 0.45 : 1} strokeLinecap="round" />
            );
          })}
          {/* points — only terms with classes; milestone dot at first + last */}
          {pts.map((p, k) => {
            if (!(p.sh > 0)) return null;
            const milestone = k === firstC || k === lastC;
            const col = p.r.type === "summer" ? SUMMER_COLOR : UG_COLOR;
            return (
              <g key={`pt-${k}`}>
                {milestone && <circle cx={p.x} cy={p.y} r="8" fill={col} opacity="0.18" />}
                <circle cx={p.x} cy={p.y} r={milestone ? 5 : 3.5} fill={col} stroke="var(--bg-surface)" strokeWidth={milestone ? 2 : 1.5} />
                <text x={p.x} y={p.y - (milestone ? 9 : 7)} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--text-3)">{p.sh}</text>
              </g>
            );
          })}
          {/* x labels — every term */}
          {rows.map((r, k) => (k % labelEvery === 0) && (
            <text key={`xl-${r.id}`} x={xFor(k)} y={H - 9} textAnchor="middle" fontSize="9.5" fill="var(--text-5)">
              {shortSem(r)}{String(yearOf(r.repSem)).slice(2)}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────

export default function StatsPanel() {
  const {
    showStats, setShowStats, setSelectedId, setShowPanel,
    placements, courseMap, effectiveCourseMap, SEMESTERS, SEM_INDEX,
    specialTermPl, specialTermStartMap, specialTermContMap, totalSHPlaced, bonusSH,
    semesterLoad,
    major, studentType, isPhone, grades, privateCoop,
  } = usePlanner();

  const attributeSystem = usePort(IAttributeSystem);
  const creditSystem    = usePort(ICreditSystem);
  const specialTerms    = usePort(ISpecialTerms);
  const majorReq        = usePort(IMajorRequirements);
  const { t } = useLanguage();


  const unit = creditSystem.getUnitName();
  const [compView, setCompView] = useState("dept"); // "dept" | "total" (by level) | "sky"
  const toggleBtn = (id, label) => {
    const active = compView === id;
    return (
      <button key={id} onClick={() => setCompView(id)} style={{
        flex: "1 1 auto", fontSize: 11.5, fontWeight: active ? 700 : 500, padding: "4px 8px",
        borderRadius: 5, cursor: "pointer",
        background: active ? "var(--active-bg)" : "transparent",
        border: `1px solid ${active ? "var(--active)" : "var(--border-2)"}`,
        color: active ? "var(--active)" : "var(--text-4)",
      }}>{label}</button>
    );
  };
  const cmap = effectiveCourseMap ?? courseMap;
  // Timeline-scoped: entries parked outside the cohort range (incl.
  // "__overflow:*") are kept in state but count toward NO statistic.
  const placedIds = useMemo(
    () => Object.keys(placements).filter(id => cmap[id] && inTimeline(placements[id], SEM_INDEX)),
    [placements, cmap, SEM_INDEX]
  );

  const openCourse = (id) => { setSelectedId(id); setShowPanel(true); setShowStats(false); };

  // Incoming credit (AP / IB / transfer bonus + courses in the incoming row).
  const incomingSH = useMemo(() => {
    let s = bonusSH ?? 0;
    for (const id of Object.keys(placements))
      if (placements[id] === "incoming" && cmap[id]) s += cmap[id].sh ?? 0;
    return s;
  }, [bonusSH, placements, cmap]);

  const nupath = useMemo(() => {
    const granted = computeGrantedAttrs(specialTermPl ?? {}, specialTerms.getTypes(), SEM_INDEX);
    const covered = attributeSystem.getCoverage(filterInTimeline(placements, SEM_INDEX), cmap, granted);
    const grid = attributeSystem.getGridCodes();
    return { covered: grid.filter(c => covered.has(c)).length, total: grid.length };
  }, [placements, cmap, specialTermPl, attributeSystem, specialTerms, SEM_INDEX]);

  // Transfer / incoming-credit courses — faded in chains, excluded from depth.
  const incomingSet = useMemo(
    () => new Set(Object.keys(placements).filter(id => placements[id] === "incoming")),
    [placements]
  );

  // Semester ordinal per placed course — enforces prereq-chain ordering.
  const order = useMemo(() => {
    const o = {};
    for (const id of placedIds) o[id] = SEM_INDEX[placements[id]];
    return o;
  }, [placedIds, placements, SEM_INDEX]);

  const levels = useMemo(() => levelDistribution(placedIds, cmap), [placedIds, cmap]);
  const chains = useMemo(
    () => longestPrereqChains(placedIds, cmap, { excludeFromDepth: incomingSet, order }),
    [placedIds, cmap, incomingSet, order]
  );

  const bySubjThenNum = (a, b) => {
    const A = cmap[a], B = cmap[b];
    return (A?.subject ?? "").localeCompare(B?.subject ?? "") || (A?.number ?? "").localeCompare(B?.number ?? "");
  };
  const byNum = (a, b) => (cmap[a]?.number ?? "").localeCompare(cmap[b]?.number ?? "");

  // Group placed courses by level tier (dept-clustered within) and by dept.
  const byTier = useMemo(() => {
    const g = new Map();
    for (const id of placedIds) {
      const tier = courseTier(cmap[id]?.number);
      if (tier == null) continue;
      if (!g.has(tier)) g.set(tier, []);
      g.get(tier).push(id);
    }
    return [...g.entries()].sort((a, b) => a[0] - b[0]).map(([tier, ids]) => ({
      tier, ids: ids.sort(bySubjThenNum), sh: ids.reduce((s, id) => s + (cmap[id]?.sh ?? 0), 0),
    }));
  }, [placedIds, cmap]);

  const byDept = useMemo(() => {
    const g = new Map();
    for (const id of placedIds) {
      const subj = cmap[id]?.subject;
      if (!subj) continue;
      if (!g.has(subj)) g.set(subj, []);
      g.get(subj).push(id);
    }
    return [...g.entries()].map(([subject, ids]) => {
      const sorted = ids.sort(byNum);
      // Per-subject GPA from ENTERED grades only — genuinely new
      // information (nothing else in the app shows "how am I doing in CS
      // versus everything else"), and the shape behind the subject-scoped
      // catalog rules like Khoury's 2.000 across CS/CY/DS/IS.
      //
      // Same core helper the graduation panel uses, so the two can never
      // disagree, and null whenever nothing in this subject is graded —
      // which also makes it vanish under private mode, since the grades
      // view is empty there.
      const gpa = enteredGPA(sorted.map(id => ({
        grade: grades[id] ?? null, credits: cmap[id]?.sh,
      })));
      // Count only courses that actually CARRY WEIGHT. A graded 0-credit
      // recitation contributes no quality points (credit × points), so
      // counting it overstated the basis — and let a subject clear the
      // "needs 2 graded" gate on a single weighted course, which is the
      // very "4.000 from one course" case that gate exists to stop.
      const graded = sorted.filter(id =>
        countsInGPA(grades[id]) && (cmap[id]?.sh ?? 0) > 0).length;
      return {
        subject, ids: sorted, count: sorted.length,
        sh: sorted.reduce((s, id) => s + (cmap[id]?.sh ?? 0), 0),
        gpa, graded,
      };
    }).sort((a, b) => b.sh - a.sh || a.subject.localeCompare(b.subject));
  }, [placedIds, cmap, grades]);

  // Reserve the GPA column only when at least one subject actually has
  // one, so an ungraded plan sees the same layout it always did.
  const anyDeptGpa = useMemo(
    () => byDept.some(g => g.gpa != null && g.graded >= 1), [byDept]);
  // One floor for every meter, derived from the whole visible set.
  const gpaScaleFloor = useMemo(
    () => gpaFloor(byDept.filter(g => g.gpa != null && g.graded >= 1).map(g => g.gpa)),
    [byDept]);

  // Credit-load timeline: summers as one bucket, per-half co-op occupancy
  // (Summer A / B) from the start + continuation maps so spanning co-ops
  // shade the terms they actually run through.
  const timeline = useMemo(() => {
    const buckets = mergeLoadTimeline(SEMESTERS);
    const instOf = (semId) => specialTermStartMap[semId] || specialTermContMap[semId] || null;
    let realCount = 0, realSum = 0;
    const rows = buckets.map(b => {
      // Co-op-occupied terms read as work terms — their parked courses don't
      // count toward the plotted load (they stay in the plan, recoverable).
      const sh = b.semIds.reduce((s, id) => s + semesterLoad(id), 0);
      const slots = b.semIds.map(id => {
        const inst = instOf(id);
        return { semId: id, occupied: !!inst, instId: inst || null, work: inst ? specialTermPl[inst] : null };
      });
      const hasWork = slots.some(s => s.occupied);
      const firstOcc = slots.find(s => s.occupied);
      const work   = firstOcc?.work ?? null;
      // instId groups the terms of one multi-term co-op (a 6-month co-op's
      // start + continuation share it) so the chart draws a single logo.
      const workId = firstOcc?.instId ?? null;
      if (b.type !== "summer" && sh > 0) { realCount += 1; realSum += sh; }
      return { ...b, sh, slots, hasWork, work, workId, isPureCoop: hasWork && sh === 0 };
    });
    return { rows, avg: realCount ? realSum / realCount : 0 };
  }, [SEMESTERS, placements, cmap, specialTermPl, specialTermStartMap, specialTermContMap]);

  const work = useMemo(() => {
    const types = specialTerms.getTypes();
    let months = 0;
    // Timeline-scoped: a co-op parked outside the cohort range must not
    // count toward work terms, months, or companies.
    const items = Object.entries(specialTermPl ?? {})
      .filter(([, w]) => inTimeline(w.semId, SEM_INDEX))
      .map(([id, w]) => {
      const type = types.find(x => x.id === w.typeId);
      const dur = type ? resolveTermByDuration(type.durations, w.duration) : null;
      months += dur?.duration ?? 0;
      const sem = SEMESTERS.find(s => s.id === w.semId);
      return {
        id, ...w,
        typeLabel: type?.label ?? w.typeId,
        durLabel: dur ? (dur.label ?? `${dur.duration} mo`) : "",
        semTypeId: sem?.semTypeId, year: yearOf(sem),
        order: SEM_INDEX[w.semId] ?? 0,
      };
    }).sort((a, b) => b.order - a.order);
    return { items, months, companies: new Set(items.filter(i => i.company).map(i => i.company)).size };
  }, [specialTermPl, specialTerms, SEMESTERS, SEM_INDEX]);

  if (!showStats) return null;

  const empty = placedIds.length === 0;
  const shMaxRef = creditSystem.getSemesterMax(studentType);
  const shMin = creditSystem.getFullTimeMin(studentType);
  const shortSem = (row) => row.type === "summer"
    ? t("stats.sem.short.summer")
    : t(`stats.sem.short.${row.type}`) || row.type;


  return (
    <div
      onClick={() => setShowStats(false)}
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "rgba(0,0,0,0.55)", display: "flex",
        alignItems: "flex-start", justifyContent: "center",
        padding: isPhone ? "0" : "40px 20px",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <style>{GLOW_CSS}</style>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          // The CARD is the scroller (not the backdrop): the sticky header
          // pins to the card's own top edge and scrolled content is clipped
          // by it — nothing can render in the strip above the header.
          width: "100%", maxWidth: 720, background: "var(--bg-app)",
          border: "1px solid var(--border-2)", borderRadius: isPhone ? 0 : 14,
          boxShadow: "var(--shadow-modal)",
          height: isPhone ? "100dvh" : undefined,
          maxHeight: isPhone ? "100dvh" : "calc(100dvh - 80px)",
          overflowY: "auto",
          color: "var(--text-1)",
        }}
      >
        {/* Header */}
        <div style={{
          position: "sticky", top: 0, zIndex: 1, background: "var(--bg-app)",
          borderBottom: "1px solid var(--border-1)", borderRadius: isPhone ? 0 : "14px 14px 0 0",
          padding: "13px 16px", display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontSize: 15.5, fontWeight: 800, letterSpacing: "-0.01em", display: "inline-flex", alignItems: "center", gap: 7 }}>
            <svg width="15" height="15" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" style={{ color: "var(--active)" }}>
              <rect x="0.5" y="6.5" width="2.6" height="5" rx="0.6" />
              <rect x="4.7" y="3.5" width="2.6" height="8" rx="0.6" />
              <rect x="8.9" y="1" width="2.6" height="10.5" rx="0.6" />
            </svg>
            {t("stats.title")}
          </span>
          <button onClick={() => setShowStats(false)} style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text-4)", fontSize: 17, lineHeight: 1, padding: 4,
          }} title={t("stats.close")}>✕</button>
        </div>

        <div style={{ padding: 12 }}>
          {empty ? (
            <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-5)", fontSize: 13 }}>
              {t("stats.empty")}
            </div>
          ) : (
            <>
              {/* ── 1 · OVERVIEW ── */}
              <Section title={t("stats.section.overview")} hint={t("stats.overview.hint")}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                  <StatTile label={t("stats.tile.planned")} value={totalSHPlaced}
                    sub={incomingSH > 0 ? t("stats.tile.inclIncoming", { n: incomingSH, unit }) : unit} color={UG_COLOR} />
                  <StatTile label={t("stats.tile.courses")} value={placedIds.length} sub={t("stats.tile.coursesSub")} />
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-3)" }}>{t("stats.nupath")}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 800, color: nupath.covered >= nupath.total ? COOP_COLOR : "var(--text-2)" }}>
                      {nupath.covered}/{nupath.total}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 3 }}>
                    {Array.from({ length: nupath.total }).map((_, i) => (
                      <div key={i} style={{ flex: 1, height: 7, borderRadius: 3,
                        background: i < nupath.covered ? COOP_COLOR : "var(--bg-surface-2)" }} />
                    ))}
                  </div>
                </div>
              </Section>

              {/* ── 2 · COMPOSITION ──
                  Three modes: the two flat chip inventories (by department —
                  the default — and by level) plus Skyline (dept columns ×
                  level bands, zoomable; incoming-credit chips fade). */}
              <Section title={t("stats.section.composition")}>
                <div style={{ display: "flex", gap: 5, marginBottom: 12 }}>
                  {toggleBtn("dept", t("stats.comp.dept"))}
                  {toggleBtn("total", t("stats.comp.total"))}
                  {toggleBtn("sky", t("stats.comp.sky"))}
                </div>

                {compView === "sky" ? (
                  <Skyline byDept={byDept} cmap={cmap} unit={unit} onOpen={openCourse} fadedIds={incomingSet} />
                ) : compView === "total" ? (
                  <>
                    <StackBar unit={unit} segments={byTier.map(g => ({
                      value: g.sh, color: tierColor(g.tier), name: `${g.tier}`,
                      title: `${t("stats.level.tier", { tier: g.tier })}: ${g.sh} ${unit}`,
                    }))} />
                    {byTier.map((g, i) => {
                      const prev = byTier[i - 1];
                      const cutoff = prev && prev.tier < 5000 && g.tier >= 5000;
                      return (
                        <div key={g.tier}>
                          {cutoff && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "2px 0 9px" }}>
                              <div style={{ flex: 1, height: 1, background: GRAD_COLOR, opacity: 0.5 }} />
                              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: GRAD_COLOR, textTransform: "uppercase" }}>{t("stats.level.gradline")}</span>
                              <div style={{ flex: 1, height: 1, background: GRAD_COLOR, opacity: 0.5 }} />
                            </div>
                          )}
                          <CourseGroup
                            title={t("stats.level.tier", { tier: g.tier })}
                            sub={t("stats.dept.value", { sh: g.sh, unit, n: g.ids.length })}
                            ids={g.ids} cmap={cmap} onOpen={openCourse} fadedIds={incomingSet}
                          />
                        </div>
                      );
                    })}
                  </>
                ) : (
                  <>
                    <StackBar unit={unit} segments={byDept.map(g => ({
                      value: g.sh, color: subjectColor(g.subject), name: g.subject,
                      title: `${g.subject}: ${g.sh} ${unit}`,
                    }))} />
                    {byDept.map(g => (
                      <CourseGroup key={g.subject}
                        title={g.subject}
                        badgeSlot={anyDeptGpa}
                        sub={t("stats.dept.value", { sh: g.sh, unit, n: g.count })}
                        // A quiet chip beside the title, not a fourth
                        // "·"-separated clause on the subline — the row
                        // already carries credits and a class count, and a
                        // fourth fact made it unreadable.
                        //
                        // Requires TWO graded courses. "4.000 GPA (1
                        // graded)" beside 15 CS classes reads as "my CS
                        // GPA is 4.0" when fourteen courses have no grade
                        // at all; the average of a single number is not an
                        // average, and presenting it as one is the kind of
                        // confident-but-hollow figure this whole feature
                        // is supposed to avoid. The basis (2 of 15) lives
                        // in the tooltip: it is a caveat, not a headline.
                        // Shown from ONE weighted graded course, dimmed
                        // until there are two — see GpaMeter.
                        badge={g.gpa != null && g.graded >= 1 ? {
                          value: g.gpa,
                          color: subjectColor(g.subject),
                          provisional: g.graded < 2,
                          floor: gpaScaleFloor,
                          title: t("stats.dept.gpa", { gpa: g.gpa.toFixed(3), n: g.graded, total: g.count })
                                 + " · " + t("stats.dept.gpa.scale", { min: gpaScaleFloor.toFixed(1), max: "4.0" }),
                        } : null}
                        ids={g.ids} cmap={cmap} onOpen={openCourse} fadedIds={incomingSet}
                      />
                    ))}
                  </>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <StatTile label={t("stats.level.undergrad")} value={levels.undergrad.count} sub={`${levels.undergrad.sh} ${unit}`} color={UG_COLOR} />
                  <GlowTile label={t("stats.level.grad")} value={levels.grad.count} sub={`${levels.grad.sh} ${unit}`} color={GRAD_COLOR} />
                </div>
              </Section>

              {/* ── 3 · CREDIT LOAD ── */}
              <Section title={t("stats.section.load")} hint={t("stats.load.hint")}>
                <LoadChart rows={timeline.rows} fullTimeMin={shMin} semesterMax={shMaxRef} shortSem={shortSem} />
                <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "var(--text-5)" }}>
                    <span style={{ width: 16, height: 2, background: UG_COLOR, display: "inline-block" }} />{t("stats.load.legend.line")}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "var(--text-5)" }}>
                    <span style={{ width: 16, height: 10, background: COOP_COLOR, opacity: 0.3, display: "inline-block", borderRadius: 2 }} />{t("stats.load.legend.coop")}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <StatTile label={t("stats.load.avg")} value={timeline.avg.toFixed(1)} sub={`${unit} / ${t("stats.load.term")}`} />
                </div>
              </Section>

              {/* ── 4 · EXPERIENCE & DEPTH ── */}
              <Section title={t("stats.section.experience")}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-4)", marginBottom: 8 }}>{t("stats.work.title")}</div>
                {work.items.length === 0 ? (
                  <div style={{ fontSize: 11.5, color: "var(--text-5)", marginBottom: 12 }}>{t("stats.work.none")}</div>
                ) : (
                  <>
                    {/* Compact one-line summary (replaces the three big tiles). */}
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "2px 10px",
                      fontSize: 12, color: "var(--text-4)", marginBottom: 12 }}>
                      <span><b style={{ color: "var(--text-2)", fontWeight: 800 }}>{work.items.length}</b> {t("stats.work.terms")}</span>
                      <span style={{ color: "var(--text-6)" }}>·</span>
                      <span><b style={{ color: "var(--text-2)", fontWeight: 800 }}>{work.months}</b> {t("stats.work.months")}</span>
                      {!privateCoop && <>
                        <span style={{ color: "var(--text-6)" }}>·</span>
                        <span><b style={{ color: "var(--text-2)", fontWeight: 800 }}>{work.companies}</b> {t("stats.work.companies")}</span>
                      </>}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
                      {work.items.map(w => <WorkCard key={w.id} w={w} />)}
                    </div>
                  </>
                )}

                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-4)", margin: "14px 0 4px" }}>{t("stats.chains.title")}</div>
                {chains.length === 0 ? (
                  <div style={{ fontSize: 11.5, color: "var(--text-5)" }}>{t("stats.chains.none")}</div>
                ) : (
                  <>
                  <div style={{ fontSize: 10, color: "var(--text-5)", marginBottom: 7, lineHeight: "calc(1.45 * var(--lh-scale, 1))" }}>{t("stats.chains.note")}</div>
                  {chains.map((ch, i) => (
                    <div key={i} style={{ marginBottom: 8 }}>
                      {/* "Trace on grid" (showPrereqTree) hidden with the prereq-tree
                          depth feature — the multi-hop tree read as confusing. */}
                      <div style={{ fontSize: 10.5, color: "var(--text-5)", marginBottom: 3 }}>{t("stats.chains.depth", { n: ch.len })}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 3 }}>
                        {ch.path.map((id, j) => (
                          <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                            <ClassChip id={id} cmap={cmap} onOpen={openCourse} faded={incomingSet.has(id)} />
                            {j < ch.path.length - 1 && <span style={{ color: "var(--text-5)", fontSize: 11.5 }}>→</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                  </>
                )}
              </Section>

              <div style={{ fontSize: 10, color: "var(--text-6)", textAlign: "center", padding: "4px 0 8px" }}>
                {t("stats.footer")}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
