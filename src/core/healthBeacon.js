// ═══════════════════════════════════════════════════════════════════
// HEALTH BEACON — the one thing this app could not previously know
//
// On 2026-08-20 a `const` read before its initializer in PlannerContext threw on
// every render. Every visitor got the recovery screen. `npm run build` succeeded,
// 2,018 unit + 93 contract + 254 invariant tests passed, `verify-chart` was green
// at 794 plans, and `/`, the bundle and every JSON asset all returned HTTP 200.
// Nothing was wrong that any existing check could see, and the app was unusable.
//
// It was found because someone happened to look. That is a fine detection strategy
// for five users and no strategy at all for ten thousand, so this module exists to
// make "did the app actually start" a question with an answer.
//
// ── What this is NOT ────────────────────────────────────────────────
//
// It is not analytics. It cannot tell you how many people use NU Map, which
// courses are popular, where visitors are, or whether anyone came back. Those
// are all things a normal product wants and all things that require identifying
// or re-identifying a person, and privacy.html promises we do not do that.
//
// The whole design follows the course-ratings precedent in this repo
// (src/core/courseRatings.js): decide what the minimum sufficient signal is,
// prove the omissions, and let the tests enforce them. The properties are:
//
//   NO IDENTIFIER OF ANY KIND. No session id, no random id, no cookie, no
//     localStorage key. Two beacons from the same browser are not linkable to
//     each other — by us or by anyone with the logs. This is a deliberate trade:
//     without an id we cannot deduplicate server-side or count unique users, and
//     we accept both losses. Unlinkability is worth more than a user count.
//   NO CLOCK FROM THE CLIENT. The receiver stamps its own arrival time. A
//     client timestamp at millisecond precision is a fingerprint.
//   NO FREE TEXT, EVER. Every field is drawn from a closed vocabulary declared
//     below. An error MESSAGE can contain a file path, a course code, a plan
//     name — `classify()` maps a throwable to one of eight enum values and the
//     message itself is discarded before it can reach a payload.
//   NO PLAN DATA, no course, no program, no grade, no locale, no URL, no
//     referrer, no screen size, no UA string.
//   TIMINGS ARE BUCKETED, not raw. A bucket is what you would chart anyway, and
//     a raw millisecond figure is a weak fingerprinting vector for free.
//
// What is left is six small fields, and they are enough to answer the only
// questions that matter at scale: is the app booting, for what share of visits,
// on which build, and when it fails, at which of four phases.
//
// ── Why sampling is a correctness requirement, not a cost saving ────
//
// The receiving Worker is on Cloudflare's free plan: 100,000 requests per day.
// The stated target is 10,000 users inside one minute. An unsampled beacon would
// spend a sixth of the daily budget in that minute and the rest by lunchtime,
// and the day it matters most — an outage, when EVERY visit fails — is the day
// it would exhaust the quota fastest and stop reporting exactly when you need it.
//
// So successes and failures are sampled at different rates, because they carry
// different kinds of information:
//
//   SUCCESS is statistical. You need a rate, not an event. 2% of 10,000 is 200
//     samples, which pins a boot-success rate to well within a percentage point.
//     Sampling harder would not tell you more.
//   FAILURE is individual — one is already news — but during an outage failures
//     are not rare, they are universal. 25% is high enough that a single failing
//     deploy is unmistakable within seconds and low enough that a total outage
//     costs 2,500 requests a minute rather than 10,000.
//
// Both are ceilings on spend under load, which is the property that makes this
// safe to leave switched on.
// ═══════════════════════════════════════════════════════════════════

/** Payload schema version. Bump when a field's MEANING changes, not on additions. */
export const BEACON_VERSION = 1;

/**
 * Every outcome this beacon can report. Closed set, by design: a beacon that
 * can carry an arbitrary string is a beacon that will eventually carry a plan.
 *
 *   ok             the app mounted and the catalog loaded
 *   shell-only     the HTML shell ran but the entry bundle never executed
 *   chunk-dead     a lazy chunk 404'd or was served as HTML (post-deploy stale tab)
 *   catalog-failed courseCatalog.fetchAll() rejected — no planner is possible
 *   render-crash   the RecoveryBoundary caught a throw from the React tree
 *   storage-full   localStorage rejected a write for quota
 *   storage-blocked localStorage is unavailable at all (private mode, embedded webview)
 *   unknown        classify() could not place it — kept so nothing is silently dropped
 */
export const OUTCOMES = Object.freeze([
  "ok",
  "shell-only",
  "chunk-dead",
  "catalog-failed",
  "render-crash",
  "storage-full",
  "storage-blocked",
  "unknown",
]);

/**
 * How far the boot got. Four phases because that is how many places it can stop,
 * and knowing which one narrows a failure to a specific subsystem immediately.
 */
export const PHASES = Object.freeze(["shell", "bundle", "data", "mount"]);

/** Coarse engine class. Not a UA string — a browser family and a form factor. */
export const ENGINES = Object.freeze(["chromium", "webkit", "gecko", "other"]);

/**
 * Sampling rates, per outcome class. See the header for why these two numbers
 * differ and why both are ceilings rather than targets.
 */
export const SAMPLE = Object.freeze({ ok: 0.02, failure: 0.25 });

/**
 * Timing buckets, in milliseconds, as upper bounds.
 *
 * Chosen to straddle the thresholds a reader would actually act on rather than
 * to be evenly spaced: under 1s is good, 1–3s is the normal range on a phone,
 * 3–8s is where a cold 1.4 MB payload on bad campus wifi lands, and over 8s is
 * indistinguishable from broken. `null` for a missing measurement.
 */
export const MS_BUCKETS = Object.freeze([500, 1000, 2000, 3000, 5000, 8000, 15000]);

/**
 * Bucket a duration to its upper bound, or "15000+" past the last one.
 * @param {number|null|undefined} ms
 * @returns {number|string|null}
 */
export function bucketMs(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  for (const b of MS_BUCKETS) if (ms <= b) return b;
  return `${MS_BUCKETS[MS_BUCKETS.length - 1]}+`;
}

/**
 * Browser engine family from a UA string.
 *
 * Deliberately lossy and deliberately done HERE rather than at the receiver: a
 * receiver that gets the full UA string has already been given the fingerprint,
 * and a promise that it is discarded on arrival is a promise about a system the
 * user cannot inspect. Reducing it in the browser means the identifying version
 * never leaves the device at all.
 *
 * Order matters: Edge and Opera both claim Chrome, and Chrome on iOS is WebKit,
 * but every one of those collapses to a family here anyway, so the only ordering
 * that matters is testing WebKit before Chromium's Safari token.
 *
 * @param {string} ua
 * @returns {string} one of ENGINES
 */
export function engineOf(ua) {
  const s = String(ua ?? "");
  if (/Firefox\/|FxiOS/i.test(s)) return "gecko";
  if (/Chrome\/|Chromium\/|CriOS|Edg\//i.test(s)) return "chromium";
  if (/Safari\/|AppleWebKit/i.test(s)) return "webkit";
  return "other";
}

/**
 * Map a throwable — or a storage verdict, or nothing — onto one OUTCOME.
 *
 * This is the redaction boundary. Everything above it may hold a message, a
 * stack, a file path or a course code; nothing below it does. The function takes
 * the arbitrary thing and returns an enum member, and the caller keeps no
 * reference to the input.
 *
 * @param {unknown} err
 * @param {{phase?: string}} [ctx]
 * @returns {string} one of OUTCOMES
 */
export function classify(err, { phase } = {}) {
  if (!err) return "ok";

  // Reading a property off a throwable can itself throw — a getter that
  // raises, a Proxy with a trap, a `message` whose toString blows up. That is
  // not hypothetical padding: the contract suite found this by feeding
  // classify a Proxy, and it mattered because this function is the redaction
  // boundary. A boundary that can throw is one a caller might route around,
  // and the route around a redactor is an unredacted value.
  //
  // So every read is guarded and the fallbacks are empty strings, which fall
  // through to the phase-based verdict below — less information, never wrong
  // information.
  let name = "", msg = "";
  try {
    name = (typeof err === "object" && err !== null && "name" in err) ? String(err.name) : "";
  } catch { name = ""; }
  try {
    msg = (typeof err === "object" && err !== null && "message" in err)
      ? String(err.message)
      : String(err);
  } catch { msg = ""; }

  let code;
  try { code = err?.code; } catch { code = undefined; }

  // Storage first: these are the two failures with a specific user remedy, and
  // persistence.js already draws the same distinction for the same reason.
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22) {
    return "storage-full";
  }
  if (/localStorage|storage is not available|access to storage/i.test(msg)) return "storage-blocked";

  // A dead lazy chunk. The message shapes here are the same ones index.html
  // watches for, kept in step deliberately — they are Vite's and the browser's
  // wording, not ours.
  if (/Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload/i.test(msg)) {
    return "chunk-dead";
  }
  if (/Could not load course catalog|Got HTML \(not JSON\)|HTTP \d+ from /i.test(msg)) {
    return "catalog-failed";
  }
  if (phase === "shell") return "shell-only";
  if (phase === "mount" || phase === "data") return "render-crash";
  return "unknown";
}

/**
 * Should this beacon be sent at all?
 *
 * `rand` is injected so the sampling rate is testable as a rate rather than
 * asserted as a constant — the tests draw thousands and check the proportion,
 * which is the only way to catch an off-by-one in the comparison.
 *
 * @param {string} outcome
 * @param {() => number} [rand]
 * @returns {boolean}
 */
export function shouldSend(outcome, rand = Math.random) {
  const rate = outcome === "ok" ? SAMPLE.ok : SAMPLE.failure;
  return rand() < rate;
}

/**
 * Build the payload, or return null if nothing may be sent.
 *
 * Returning a plain object rather than posting it is what makes every privacy
 * claim above a unit test instead of a comment: the contract suite enumerates
 * the keys, feeds hostile inputs (an Error whose message is a whole plan, a UA
 * string with a device id in it, a raw millisecond timing) and asserts none of
 * it survives.
 *
 * @param {object} input
 * @param {string} input.outcome    one of OUTCOMES
 * @param {string} input.phase      one of PHASES
 * @param {number|null} [input.ms]  duration to bucket
 * @param {string|null} [input.build] entry bundle hash, e.g. "index-efHGYLEJ.js"
 * @param {string} [input.ua]       navigator.userAgent, reduced to a family here
 * @returns {object|null}
 */
export function buildPayload({ outcome, phase, ms = null, build = null, ua = "" }) {
  if (!OUTCOMES.includes(outcome)) return null;
  const p = PHASES.includes(phase) ? phase : "shell";

  // The build hash is the highest-value field here — the 2026-08-20 outage was
  // one deploy, and a failure rate you cannot attribute to a build tells you
  // something is wrong without telling you what to roll back. It is still
  // constrained to the shape Vite emits, because it arrives from the DOM and
  // anything read from the DOM is untrusted input.
  const b = typeof build === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(build) ? build : null;

  return {
    v: BEACON_VERSION,
    o: outcome,
    p,
    ms: bucketMs(ms),
    b,
    e: engineOf(ua),
  };
}
