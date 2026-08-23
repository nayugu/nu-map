// ═══════════════════════════════════════════════════════════════════
// MAINTENANCE PAGE — the pre-designed screen for a window we chose to take.
//
// Shown only when the schedule says `severity: "offline"` AND the window is
// open. Three properties matter more than how it looks:
//
//   1. IT LETS PEOPLE THROUGH. "Keep using the plan I have open" is the default,
//      not a hidden link, because this app does not need us in order to work:
//      plans are in the visitor's own localStorage and the catalog is already
//      in memory by the time this can appear. Locking a student out of their own
//      degree plan to deploy a bundle is an outage WE cause, and a maintenance
//      page that causes an outage has inverted its own purpose. `hardBlock`
//      removes the hatch for the one case that earns it — a storage migration,
//      where edits made now would be written into a schema about to be replaced
//      and silently lost.
//   2. IT TURNS ITSELF OFF. The end time comes from the window, so when the
//      clock passes it the overlay simply unmounts — no second deploy, no
//      "we're back" flag to remember to flip. See rule 2 in core/maintenance.js.
//   3. IT CANNOT BE THE LAST WORD. If the app never boots at all — the likeliest
//      way to see nothing during a deploy — this component never renders. That
//      case belongs to the recovery screen in index.html, which reads the same
//      schedule from localStorage and says the same thing in ES5. Two layers,
//      because they fail in different places.
//
// The passing-through choice is remembered per window, so a reload does not put
// the wall back up in front of somebody who already decided.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";
import { usePlanner } from "../context/PlannerContext.jsx";
import { useMaintenance } from "../context/MaintenanceContext.jsx";
import { formatInstant, formatRelative } from "../core/maintenanceFormat.js";

const PASS_KEY = "numap.maintenance.passed";

function readPassed() {
  try {
    const v = JSON.parse(localStorage.getItem(PASS_KEY) || "[]");
    return Array.isArray(v) ? v.filter(x => typeof x === "string") : [];
  } catch { return []; }
}

export default function MaintenancePage() {
  const { t, locale, locales } = useLanguage();
  const m = useMaintenance();
  const { exportLibraryJSON } = usePlanner();
  const [passed, setPassed] = useState(readPassed);
  const [saved, setSaved] = useState(false);
  const primary = useRef(null);

  // Focus the primary action — but NOT when this app is embedded in someone
  // else's page. The dev portal renders this screen in a preview iframe, and
  // grabbing focus from inside a 22%-scale thumbnail steals the keystrokes of
  // whoever is typing in the host page. Found by a test that pressed Escape and
  // watched it land in the wrong document.
  useEffect(() => {
    let embedded = false;
    try { embedded = window.top !== window.self; } catch { embedded = true; }
    if (!embedded) primary.current?.focus?.();
  }, []);

  if (!m.blocking) return null;
  if (!m.hardBlock && passed.includes(m.window.id)) return null;

  const rtl = (locales.find(l => l.code === locale)?.dir ?? "ltr") === "rtl";
  // `etaMs` is the forecast while it holds and the deadline otherwise; it is
  // null once we are overrunning, and then there is no honest number to show.
  const back = m.overrunning ? null : formatRelative(m.etaMs, locale);
  const etaAt = m.window.expectedEnd ?? m.window.end;

  const passThrough = () => {
    const next = [...passed.filter(k => k !== m.window.id), m.window.id].slice(-8);
    setPassed(next);
    try { localStorage.setItem(PASS_KEY, JSON.stringify(next)); } catch { /* still lets them through this load */ }
  };

  const btn = (kind) => ({
    padding: "8px 14px", borderRadius: 7, cursor: "pointer",
    fontSize: 12, fontWeight: 700, fontFamily: "inherit",
    background: kind === "primary" ? "var(--link-bg)" : "transparent",
    border: `1px solid ${kind === "primary" ? "var(--link-1)" : "var(--border-2)"}`,
    color: kind === "primary" ? "var(--link-1)" : "var(--text-3)",
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="numap-maint-title"
      style={{
        position: "fixed", inset: 0, zIndex: 99998,
        direction: rtl ? "rtl" : "ltr",
        background: "var(--bg-app)", color: "var(--text-1)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24, textAlign: "center",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* The bar is the loading screen's bar, made indeterminate: it says
          "working on it", which is the one thing a maintenance page is for.
          Reduced motion stops it dead rather than hiding it — a static bar
          still reads as a progress indicator. */}
      {/* The sweep runs with the reading direction, which is why the keyframe is
          built from `rtl` rather than being a constant — index.html's recovery
          screen flips the same animation for `ar` and this screen sits beside it. */}
      <style>{`
        @keyframes numapMaintSweep {
          from { transform: translateX(${rtl ? "250%" : "-100%"}) }
          to   { transform: translateX(${rtl ? "-100%" : "250%"}) }
        }
        @media (prefers-reduced-motion: reduce) { #numap-maint-bar > div { animation: none !important } }
      `}</style>

      <div style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <img
          src={`${import.meta.env.BASE_URL}logo.png`}
          alt=""
          style={{ width: 44, height: 44, objectFit: "contain" }}
        />

        <div id="numap-maint-title" style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em" }}>
          {t("maint.page.title")}
        </div>

        <div id="numap-maint-bar" style={{
          width: 240, height: 4, borderRadius: 99, overflow: "hidden",
          background: "var(--bg-surface-2)",
        }}>
          <div style={{
            width: "40%", height: "100%", borderRadius: 99,
            // The brand red, not `--link-1`. Hard-coded on purpose: this is the
            // logo's colour, the same constant index.html's recovery screen and
            // public/maintenance.html both use, and the point is that all three
            // screens read as the same screen. A theme accent would drift from
            // the other two the first time the palette changed.
            background: "#ef4444",
            animation: "numapMaintSweep 1.5s ease-in-out infinite",
          }} />
        </div>

        {/* Relative first because it is what gets read, absolute under it
            because it is what is true — and NEITHER once the forecast has
            passed. A countdown the reader can see has expired, on a page that
            is still up, reads as abandoned; saying "longer than expected" is
            both honest and better news than that. */}
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-2)" }}>
          {m.overrunning ? t("maint.overrun") : t("maint.page.back", { when: back })}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: -8 }}>
          {m.overrunning ? "" : formatInstant(etaAt, locale)}
        </div>

        <div style={{ fontSize: 12, color: "var(--text-3)", lineHeight: "calc(1.7 * var(--lh-scale, 1))" }}>
          {t(`maint.kind.${m.kind}`)} {t("maint.safe")}
        </div>

        {m.hardBlock && (
          <div style={{ fontSize: 11, color: "var(--text-4)", lineHeight: "calc(1.6 * var(--lh-scale, 1))" }}>
            {t("maint.page.hardblock")}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginTop: 4 }}>
          {!m.hardBlock && (
            <button ref={primary} onClick={passThrough} style={btn("primary")}>
              {t("maint.page.continue")}
            </button>
          )}
          {/* A copy on disk is worth more here than anywhere else in the app:
              this is the one screen a student reaches while worrying about
              whether their plan survived. */}
          <button
            onClick={() => { try { exportLibraryJSON(); setSaved(true); } catch { /* export reports its own errors */ } }}
            style={btn("ghost")}
          >
            {saved ? t("maint.backup.done") : t("maint.backup.action")}
          </button>
          <button
            ref={m.hardBlock ? primary : undefined}
            onClick={() => window.location.reload()}
            style={btn("ghost")}
          >
            {t("maint.reload")}
          </button>
        </div>
      </div>
    </div>
  );
}
