// ═══════════════════════════════════════════════════════════════════
// MAINTENANCE CONTEXT
//
// Cross-cutting app infrastructure, parallel to ThemeContext and
// LanguageContext — NOT part of the hexagonal institution adapter system. The
// schedule is about OUR deployment, not about the institution.
//
// Three jobs, and nothing else: hold the fetched schedule, hold a clock, and
// hand out the resolved phase. All the judgement is in src/core/maintenance.js
// (pure, tested); all the network is in src/data/maintenanceSource.js.
//
// ── Why children never re-render on the tick ────────────────────────
//
// The provider re-evaluates the phase every 10 s while a window is live, and it
// wraps the whole app. That would be a full-tree re-render six times a minute
// if `children` were built here — but it is passed IN, so its element identity
// is unchanged across the provider's own state updates and React bails out of
// that subtree. Only actual context consumers (the notice, the page) re-render.
// If you ever move the app's element construction INTO this file, that property
// is gone and this becomes a performance bug.
//
// The tick is armed only while `phase !== "none"`. With nothing scheduled there
// is no timer at all, which is the state 99% of loads are in.
// ═══════════════════════════════════════════════════════════════════
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { resolveMaintenance, SEVERITIES } from "../core/maintenance.js";
import {
  fetchMaintenance, readMirror, POLL_HOT_MS, POLL_IDLE_MS, TICK_MS,
} from "../data/maintenanceSource.js";

const MaintenanceContext = createContext(null);

/**
 * Local-only design preview: `?maint=offline`, `?maint=imminent`, …
 *
 * Same gate and same reason as index.html's `?preview=recovery` — a maintenance
 * page is a screen we need to be able to look at and sharpen without editing
 * the live schedule, and one that production users must never be able to summon
 * by URL. `import.meta.env.DEV` alone would be enough for `npm run dev`, but the
 * hostname test also covers a locally served production build, which is what
 * `npm run test:boot` drives.
 */
function previewConfig() {
  try {
    const ok = import.meta.env.DEV || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname);
    if (!ok) return null;
    const want = new URLSearchParams(location.search).get("maint");
    if (!want) return null;
    const now = Date.now();
    const H = 3600e3;
    // A severity names an ACTIVE window; a phase name puts a plain notice into
    // that phase. Either way the window is short and real, so every downstream
    // rule (including the offline-duration cap) applies unchanged.
    const base = { id: `preview-${want}`, kind: "deploy", backup: "recommended", features: ["claude", "share"] };
    if (SEVERITIES.includes(want)) {
      return { windows: [{ ...base, severity: want, start: now - 20 * 60e3, end: now + 40 * 60e3 }] };
    }
    if (want === "scheduled") return { windows: [{ ...base, severity: "notice", start: now + 6 * H, end: now + 8 * H }] };
    if (want === "imminent") return { windows: [{ ...base, severity: "offline", start: now + 11 * 60e3, end: now + 2 * H }] };
    if (want === "restored") return { windows: [{ ...base, severity: "offline", start: now - 2 * H, end: now - 3 * 60e3 }] };
    // Overrunning: the forecast has passed, the deadline has not. A state the
    // real world reaches often and no other preview can reach at all.
    if (want === "overrun") {
      return { windows: [{ ...base, severity: "offline", start: now - 5 * H, expectedEnd: now - H, end: now + 20 * H }] };
    }
    return null;
  } catch { return null; }
}

export function MaintenanceProvider({ children }) {
  // Declared above every consumer below it, deliberately — reading a preview
  // three times would also mean parsing the URL three times per mount.
  const preview = useMemo(previewConfig, []);
  // Lazily seeded from the localStorage mirror so a reload during a window
  // shows the notice on the FIRST paint instead of one network round-trip
  // later. The mirror holds absolute times, so a stale copy resolves to
  // "nothing scheduled" on its own.
  const [src, setSrc] = useState(() => (preview ? { config: preview, skewMs: 0 } : readMirror() ?? { config: null, skewMs: 0 }));
  const [now, setNow] = useState(() => Date.now());
  const frozen = useRef(!!preview);

  const state = useMemo(
    () => resolveMaintenance(src.config, now + (src.skewMs || 0)),
    [src, now],
  );

  // ── Fetch + poll ──────────────────────────────────────────────────
  const phase = state.phase;
  useEffect(() => {
    if (frozen.current) return;   // a preview must not be overwritten by the real file
    let live = true;
    const pull = async () => {
      const got = await fetchMaintenance();
      // A read that failed leaves the previous answer standing rather than
      // clearing it: one flaky request in the middle of a window should not
      // make the notice flicker away. Only a SUCCESSFUL read that no longer
      // contains the window takes it down — which is how an early finish is
      // published (edit the file, ship, the app clears itself).
      if (live && got) setSrc(got);
      if (live) setNow(Date.now());
    };
    pull();
    const every = phase === "none" ? POLL_IDLE_MS : POLL_HOT_MS;
    const iv = setInterval(pull, every);
    // A laptop that slept through the whole window wakes with a stale phase and
    // a stale clock, and `setInterval` does not fire while suspended. Both
    // events below are the cheap fix, and `online` covers the tunnel case.
    const wake = () => { if (document.visibilityState === "visible") pull(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", pull);
    return () => {
      live = false;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", pull);
    };
  }, [phase]);

  // ── Tick ──────────────────────────────────────────────────────────
  // Only while something is live: the countdown needs it, and the transitions
  // (imminent → active → restored → gone) must not wait for a poll.
  useEffect(() => {
    if (phase === "none") return;
    const iv = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(iv);
  }, [phase]);

  const value = useMemo(() => ({
    ...state,
    /** Is a named feature expected to be unavailable right now?
     *  DECLARATIVE — see the note on FEATURES in core/maintenance.js. */
    isFeatureDown: (id) => state.featuresDown.includes(id),
  }), [state]);

  return <MaintenanceContext.Provider value={value}>{children}</MaintenanceContext.Provider>;
}

/**
 * Resolved maintenance state. Safe outside the provider — returns the inert
 * "nothing scheduled" shape rather than throwing, because a feature whose whole
 * job is to be unobtrusive must never be the reason a component crashes.
 */
export function useMaintenance() {
  return useContext(MaintenanceContext) ?? {
    phase: "none", severity: null, kind: null, window: null,
    startsInMs: null, endsInMs: null, backup: false, featuresDown: [],
    blocking: false, hardBlock: false, problems: [],
    isFeatureDown: () => false,
  };
}
