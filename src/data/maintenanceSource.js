// ═══════════════════════════════════════════════════════════════════
// MAINTENANCE SOURCE — the wire half. Policy is src/core/maintenance.js.
//
// Reads public/maintenance.json and answers two questions: what does the
// schedule say, and what time does the SERVER think it is.
//
// ── Why the server's clock ──────────────────────────────────────────
//
// The worst failure available to this feature is a maintenance page shown to
// somebody while the app is perfectly fine. A schedule is absolute times, so
// that failure needs only a wrong local clock — and a laptop whose date is off
// by days is not rare (a dead CMOS battery, a manually-set timezone, a device
// restored from an image). We are already making an HTTP request, and every
// HTTP response carries a `Date` header, so the correction is free: `skewMs` is
// the offset from the local clock to the origin's, and every phase decision
// runs on `Date.now() + skewMs`. No extra request, no time API, no dependency.
//
// ── Why a failed read is silence, not an error ──────────────────────
//
// `public/_headers` documents the sharp edge this file lives on: under the SPA
// catch-all, a path that does not exist answers with index.html at status 200.
// So a build without the file, or a fork, gets `<!DOCTYPE html>` and `r.ok ===
// true`. That is not an anomaly to log — it IS the "no maintenance scheduled"
// answer, and the code treats a parse failure and a network failure alike:
// return null, resolve to `phase: "none"`, say nothing. Same reason the content
// type is checked rather than the status.
//
// ── The localStorage mirror ─────────────────────────────────────────
//
// Written for a reader that cannot call this module: the boot-failure recovery
// screen in index.html runs before any bundle exists, and a failed boot DURING
// a maintenance window is the single most likely way anyone ever sees that
// screen. It reads this key synchronously to say "scheduled maintenance, back
// at X" instead of "something went wrong". The mirror is safe to be stale
// because the windows inside it carry absolute times — an old copy describes an
// old window and therefore matches nothing.
// ═══════════════════════════════════════════════════════════════════

/** Overridable so the schedule can move off the Pages deploy (a Worker, an R2
 *  object) without a code change. Unset → the file shipped with the build. */
const SOURCE = (import.meta.env.VITE_MAINTENANCE_URL ?? "").trim() ||
  `${import.meta.env.BASE_URL}maintenance.json`;

/** ⚠ Also read, in ES5, by index.html. Renaming this is a two-file change. */
export const CACHE_KEY = "numap.maintenance.v1";

/** Poll cadence. Slower when nothing is happening; a minute once something is. */
export const POLL_IDLE_MS = 5 * 60e3;
export const POLL_HOT_MS = 60e3;

/** How often the derived phase is re-evaluated from the clock alone. */
export const TICK_MS = 10e3;

/**
 * Fetch the schedule.
 * @returns {Promise<{config: unknown, skewMs: number}|null>} null = nothing scheduled
 */
export async function fetchMaintenance() {
  try {
    // `?t=` on top of `cache: "no-store"`: the store directive is the real
    // mechanism, the query is belt-and-braces against an intermediary that
    // ignores it. Same pattern as index.html's `nocache()`.
    const url = `${SOURCE}${SOURCE.includes("?") ? "&" : "?"}t=${Date.now()}`;
    const r = await fetch(url, { cache: "no-store", credentials: "omit" });

    // Clock offset first, and taken even from a response we go on to reject:
    // a 404 still tells us the time.
    let skewMs = 0;
    const dateHdr = r.headers?.get?.("date");
    if (dateHdr) {
      const server = Date.parse(dateHdr);
      // `Date` has one-second resolution and the request itself took time, so
      // sub-second precision here is imaginary. Anything past a month apart is
      // more likely a stale intermediary than a real clock, and ignoring it
      // errs toward "not in a window", which is the safe direction.
      if (Number.isFinite(server) && Math.abs(server - Date.now()) < 30 * 24 * 3600e3) {
        skewMs = server - Date.now();
      }
    }

    if (!r.ok) return null;
    // The status is not evidence (see the header comment). The content type is.
    const ctype = r.headers?.get?.("content-type") ?? "";
    if (ctype && !/json/i.test(ctype)) return null;

    const text = await r.text();
    if (!text.trim() || text.trimStart().startsWith("<")) return null;
    const config = JSON.parse(text);

    writeMirror({ config, skewMs });
    return { config, skewMs };
  } catch {
    // Network down, offline, JSON garbage, storage blocked — all the same
    // answer. A schedule we cannot read is not a maintenance window.
    return null;
  }
}

/** @param {{config: unknown, skewMs: number}} v */
function writeMirror(v) {
  try {
    // Only mirror a config that actually schedules something. Writing `{}` on
    // every load would put a useless key in every visitor's storage, and this
    // app already warns people when their storage is full (StorageAlarm).
    const hasWindows =
      Array.isArray(v.config?.windows) ? v.config.windows.length > 0
        : !!(v.config?.window || v.config?.start);
    if (!hasWindows) { localStorage.removeItem(CACHE_KEY); return; }
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...v, fetchedAt: Date.now() }));
  } catch { /* a mirror for a crash screen must never cause one */ }
}

/**
 * Last known schedule, for a load that has not fetched yet. Returning the
 * cached copy means a reload DURING a window shows the notice on the first
 * paint rather than a network round-trip later.
 * @returns {{config: unknown, skewMs: number}|null}
 */
export function readMirror() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object") return null;
    return { config: v.config, skewMs: Number.isFinite(v.skewMs) ? v.skewMs : 0 };
  } catch { return null; }
}

// There is deliberately no `resolveNow(config, skew)` convenience here. It was
// written, nothing imported it, and an exported helper nobody calls is the shape
// of the `overrides` trap in src/config.js — a second way to do the thing that
// drifts from the first. Callers compose `resolveMaintenance(config, Date.now() +
// skewMs)` themselves, which is one line and says what it does.
