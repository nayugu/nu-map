// ═══════════════════════════════════════════════════════════════════
// HEALTH REPORTER — the transport half of the health beacon
//
// The policy (what may be sent, at what rate, in what shape) is in
// src/core/healthBeacon.js and is pure, so every privacy property it claims is
// a unit test. This file is only the wire: it decides WHEN to fire, reads the
// two facts that live in the DOM, and posts once.
//
// Three rules govern everything here, and all three exist because a health
// check that damages the thing it is checking is worse than no health check:
//
//   1. IT CAN NEVER THROW. Every entry point is wrapped. A beacon failing must
//      be indistinguishable, from the app's point of view, from a beacon
//      succeeding. This is not defensive habit — the boot path is exactly where
//      this gets called, and an exception here would cause the outage it exists
//      to report.
//   2. IT NEVER BLOCKS. `sendBeacon` hands the request to the browser and
//      returns immediately; it is not awaited and its result is not read. On a
//      browser without it, `fetch(..., {keepalive: true})` has the same
//      property. Nothing in the render path waits for a network call.
//   3. ONE BEACON PER PAGE LOAD, full stop. Not one per error — one per load.
//      A render crash inside a loop could otherwise fire thousands, which would
//      turn a bug into a self-inflicted denial of service against our own free
//      100,000/day quota, on the day we need the data most.
//
// ── Off unless configured ───────────────────────────────────────────
//
// No endpoint baked into the build means the whole module is inert: `report()`
// returns without touching the network. This mirrors how aiAssistant and
// ratingSharingAvailable are gated in src/config.js, and it means a fork, a
// local dev server, and any build made before the receiver exists all send
// nothing at all — rather than sending to a URL that happens to 404 today.
// ═══════════════════════════════════════════════════════════════════

import { buildPayload, classify, shouldSend } from "../core/healthBeacon.js";

const ENDPOINT = (import.meta.env.VITE_HEALTH_BEACON_URL ?? "").replace(/\/$/, "");

/** One per page load. See rule 3 above. */
let _sent = false;

/**
 * Which build is running.
 *
 * Read from the DOM rather than injected at compile time on purpose: the
 * failure this beacon most needs to attribute is a STALE SHELL referencing a
 * bundle that no longer exists, and in that case the shell in the DOM and the
 * build a compile-time constant would name are different things. The DOM is
 * the one that describes what the browser actually tried to run.
 *
 * Untrusted, like anything from the DOM — buildPayload re-validates the shape.
 */
function buildId() {
  try {
    const el = document.querySelector('script[type="module"][src*="/assets/index-"]');
    const src = el?.getAttribute("src") ?? "";
    return src.split("/").pop() || null;
  } catch { return null; }
}

/**
 * Milliseconds from navigation start to now, or null when the Navigation
 * Timing API is unavailable. Bucketed downstream — never sent raw.
 */
function sinceNavigation() {
  try {
    const t = performance?.now?.();
    return typeof t === "number" ? Math.round(t) : null;
  } catch { return null; }
}

/**
 * Report one boot outcome. Safe to call from anywhere, including a catch block
 * in an error boundary; safe to call more than once (later calls no-op).
 *
 * @param {object} opts
 * @param {string} [opts.outcome]  an OUTCOMES member; omit and pass `error` instead
 * @param {unknown} [opts.error]   anything throwable — reduced to an enum, never sent
 * @param {string} opts.phase      one of PHASES
 * @param {number|null} [opts.ms]  duration; defaults to time since navigation
 * @returns {boolean} whether a beacon was actually dispatched (for tests)
 */
export function report({ outcome, error, phase, ms } = {}) {
  try {
    if (!ENDPOINT || _sent) return false;

    // `classify` is the redaction boundary: whatever `error` is — an Error
    // whose message names a file, a string containing a course code, a whole
    // object — what comes back is one of eight fixed words, and the input is
    // not retained past this line.
    const o = outcome ?? classify(error, { phase });
    if (!shouldSend(o)) {
      // Sampled out. Still marked as sent: the decision is per page load, so a
      // later call must not get a second roll of the dice and quietly raise the
      // effective rate above the ceiling the quota maths depends on.
      _sent = true;
      return false;
    }

    const payload = buildPayload({
      outcome: o,
      phase,
      ms: ms ?? sinceNavigation(),
      build: buildId(),
      ua: navigator?.userAgent ?? "",
    });
    if (!payload) { _sent = true; return false; }

    _sent = true;
    const body = JSON.stringify(payload);

    // sendBeacon is preferred for the reason it exists: it survives the page
    // going away, which is the common case for a boot failure — the user gives
    // up and closes the tab, and that is precisely the visit we most want
    // counted.
    if (navigator?.sendBeacon) {
      // Content-Type must be one CORS treats as simple, or the beacon becomes a
      // preflighted request that sendBeacon cannot make.
      const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
      if (navigator.sendBeacon(`${ENDPOINT}/b`, blob)) return true;
    }
    fetch(`${ENDPOINT}/b`, {
      method: "POST",
      body,
      keepalive: true,
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
    }).catch(() => {});
    return true;
  } catch {
    // Rule 1. There is no error path worth having here: the beacon reporting
    // its own failure is not information anyone can act on.
    return false;
  }
}

/** Test seam — lets a suite drive `report` more than once. Not used by the app. */
export function _resetForTests() { _sent = false; }
