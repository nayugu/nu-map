// ═══════════════════════════════════════════════════════════════════
// MAINTENANCE — a schedule, resolved to a phase.
//
// One JSON file (public/maintenance.json) declares windows with ABSOLUTE start
// and end times; this module turns that plus a clock into "what should the user
// see right now". It is pure — no fetch, no DOM, no Date.now() — because every
// property that matters here is a property of this function, and each one is a
// unit test rather than a hope:
//
//   1. FAIL OPEN, always. A missing file, a 404 that answered with the SPA's
//      HTML shell (see public/_headers — a miss under `/*` is a 200, not a 404,
//      so `JSON.parse` failing is the NORMAL missing-file case), a typo'd date,
//      an unknown severity — every one of them resolves to `phase: "none"`.
//      A maintenance notice must never be the thing that takes the app down.
//   2. THE END OF A WINDOW IS CLIENT-DERIVABLE. The window carries its own
//      `end`, so the app turns itself back on with no second deploy and no
//      server to ask. This is a safety property, not a convenience: if coming
//      back up required us to ship a "we're back" file, then a maintenance that
//      overran WITH A FAILED DEPLOY would strand every visitor on a maintenance
//      page indefinitely — the exact case where we are least able to fix it.
//   3. A LONG WINDOW IS A TYPO, and typos here are expensive. A wrong year on a
//      2-hour deploy notice reads as a 365-day outage. Over `MAX_OFFLINE_HOURS`
//      an `offline` window is DEMOTED to `notice` (still say it, never lock
//      anyone out), and over `MAX_WINDOW_DAYS` the window is dropped entirely.
//
// ── Why phases and not a boolean ────────────────────────────────────
//
// "Maintenance mode: on/off" is one flag and four different messages. A student
// 20 hours out needs a date; one 10 minutes out needs to be told now, and told
// what to do about it; one during the window needs to know when it ends; one
// after needs to know it is over, because a planner they left open through a
// deploy may be running a build that no longer exists. So the phases are
// derived from the same two timestamps and each has its own words.
//
// ── And why severity is not the same axis ───────────────────────────
//
// Phase is WHEN, severity is HOW MUCH. They are independent, and conflating
// them is what makes maintenance pages user-hostile: this app's plans live in
// the user's own localStorage and the catalog is a static JSON fetched once, so
// for an already-loaded page there is usually nothing we could take away even
// if we wanted to. `notice` is therefore the default and `offline` has to be
// asked for explicitly — see docs/maintenance.md.
// ═══════════════════════════════════════════════════════════════════

/**
 * How much of the app a window takes away.
 *   notice   — say it, change nothing. The overwhelmingly common case.
 *   degraded — the app works; named network features are expected to fail.
 *   offline  — show the maintenance page over the app.
 * Ordered least → most severe; `SEVERITY_RANK` is the index.
 */
export const SEVERITIES = ["notice", "degraded", "offline"];

/** @type {Record<string, number>} */
export const SEVERITY_RANK = Object.fromEntries(SEVERITIES.map((s, i) => [s, i]));

/**
 * Where the clock is relative to the window. Ordered by urgency, because
 * choosing between two overlapping windows is "show the more urgent one".
 */
export const PHASES = ["none", "scheduled", "imminent", "active", "restored"];

/** Urgency for window selection. `restored` outranks `scheduled`: a window that
 *  just ENDED is news about the page you are looking at; one two days out is not. */
const PHASE_URGENCY = { none: 0, scheduled: 1, restored: 2, imminent: 3, active: 4 };

/**
 * Why we are down. A CLOSED vocabulary, deliberately — not free text.
 *
 * Every user-facing string in this app exists hand-written in all 8 locales
 * (see test/invariant/locale-completeness.test.js), and a free-text `reason`
 * field cannot. A free-text field would therefore have shipped English into a
 * zh/ja/ar panel, which is the bug CatalogNotes already made once. Five kinds
 * cover everything we actually do; `other` is the escape hatch and says only
 * "planned maintenance".
 */
export const KINDS = ["deploy", "data", "migration", "infra", "other"];

/**
 * Features a `degraded` window can name. Closed for the same reason as KINDS —
 * each one has a translated label. An unrecognised id is DROPPED (and reported
 * in `problems`) rather than rendered raw.
 *
 * ⚠ These are DECLARATIVE today: the notice tells the student which features to
 * expect to fail, and nothing in the app is switched off from here. Gating the
 * real code paths (the Claude pairing state machine, the share relay) is a
 * separate change with its own regression surface; `featuresDown` is the hook
 * it would attach to. Do not describe this as a kill switch — it isn't one.
 */
export const FEATURES = ["claude", "share", "ratings", "translation", "catalog"];

/** How strongly we suggest a local backup file. `true` is accepted as "optional". */
export const BACKUP_LEVELS = ["optional", "recommended"];

/** Defaults for every optional field. Exported so the CLI prints the same numbers. */
export const DEFAULTS = {
  severity: "notice",
  kind: "other",
  /** Announce a day ahead: long enough that a student planning tonight hears it,
   *  short enough that a notice is never furniture. */
  announceHours: 24,
  /** The escalation point. Half an hour is about one planning sitting. */
  imminentMinutes: 30,
  /** How long "we're back" stays up after `end`. */
  restoredHours: 2,
  backup: false,
  hardBlock: false,
};

/**
 * Beyond this, an `offline` window is demoted to `notice` (rule 3 above).
 *
 * 72 h, not 24: the intended worst case for this project is "a bug bad enough
 * that the site comes down while we fix it, possibly for two days". A 24 h cap
 * silently demoted exactly that scenario to a notice — the guard firing on the
 * real case instead of on the typo it was written for. Three days still catches
 * a wrong month or year, which is what it is actually for.
 */
export const MAX_OFFLINE_HOURS = 72;
/** Beyond this, the window is dropped entirely — nothing we do lasts a month. */
export const MAX_WINDOW_DAYS = 30;

const HOUR = 3600e3;
const MIN = 60e3;

/** @param {unknown} v @returns {number|null} finite epoch ms, or null */
function parseTime(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string" || !v.trim()) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/** @param {unknown} v @param {number} lo @param {number} hi @param {number} dflt */
function clampNum(v, lo, hi, dflt) {
  if (typeof v !== "number" || !Number.isFinite(v)) return dflt;
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Validate and fill in one raw window.
 *
 * Never throws, and never returns a half-usable object: either the window is
 * coherent enough to show or `window` is null and `problems` says why. The
 * caller (and `npm run maint:status`) shows `problems` even for a window that
 * survived — a demoted severity or a dropped feature id is exactly the kind of
 * mistake that is invisible until a student sees it.
 *
 * @param {unknown} raw
 * @returns {{window: object|null, problems: string[]}}
 */
export function normalizeWindow(raw) {
  const problems = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { window: null, problems: ["not an object"] };
  }

  const start = parseTime(raw.start);
  const end = parseTime(raw.end);
  if (start == null) problems.push("start is missing or unparseable");
  if (end == null) problems.push("end is missing or unparseable");
  if (start == null || end == null) return { window: null, problems };

  // ── `end` is a DEADLINE; `expectedEnd` is a forecast ──────────────
  //
  // "We'll be down as long as it takes to fix it" is the real shape of an
  // unplanned outage, and it cannot be expressed by one timestamp. So there are
  // two, doing different jobs, and neither can do the other's:
  //
  //   `end`         the latest we stay down, full stop. This is what makes the
  //                 window self-clearing (rule 2), so it must exist even when
  //                 nobody knows the real answer — set it generously.
  //   `expectedEnd` what we TELL people, and what `Retry-After` says. Optional.
  //
  // When the forecast passes and the deadline has not, the state is
  // `overrunning`, and every surface says "taking longer than expected" instead
  // of counting down to a time that has already gone by. A countdown that has
  // visibly expired while the page is still up is the single fastest way to
  // make a maintenance page look abandoned.
  let expectedEnd = parseTime(raw.expectedEnd);
  if (raw.expectedEnd != null && expectedEnd == null) {
    problems.push("expectedEnd is unparseable — ignored");
  }
  if (expectedEnd != null && expectedEnd > end) {
    problems.push("expectedEnd is after end — clamped to end");
    expectedEnd = end;
  }
  if (expectedEnd != null && expectedEnd <= start) {
    problems.push("expectedEnd is not after start — ignored");
    expectedEnd = null;
  }
  if (end <= start) {
    problems.push("end is not after start");
    return { window: null, problems };
  }
  const durationMs = end - start;
  if (durationMs > MAX_WINDOW_DAYS * 24 * HOUR) {
    problems.push(`window spans ${Math.round(durationMs / (24 * HOUR))} days — over the ${MAX_WINDOW_DAYS}-day cap, dropped as a typo`);
    return { window: null, problems };
  }

  let severity = typeof raw.severity === "string" ? raw.severity : DEFAULTS.severity;
  if (!SEVERITIES.includes(severity)) {
    problems.push(`unknown severity ${JSON.stringify(raw.severity)} — treated as ${DEFAULTS.severity}`);
    severity = DEFAULTS.severity;
  }
  // Rule 3: an implausibly long lockout is a typo, and the conservative repair
  // is to keep TELLING people and stop BLOCKING them.
  if (severity === "offline" && durationMs > MAX_OFFLINE_HOURS * HOUR) {
    problems.push(`offline window is ${Math.round(durationMs / HOUR)}h — over the ${MAX_OFFLINE_HOURS}h cap, demoted to notice`);
    severity = "notice";
  }

  let kind = typeof raw.kind === "string" ? raw.kind : DEFAULTS.kind;
  if (!KINDS.includes(kind)) {
    problems.push(`unknown kind ${JSON.stringify(raw.kind)} — treated as ${DEFAULTS.kind}`);
    kind = DEFAULTS.kind;
  }

  const features = [];
  if (raw.features != null) {
    if (!Array.isArray(raw.features)) {
      problems.push("features is not an array — ignored");
    } else {
      for (const f of raw.features) {
        if (FEATURES.includes(f)) { if (!features.includes(f)) features.push(f); }
        else problems.push(`unknown feature ${JSON.stringify(f)} — dropped`);
      }
    }
  }

  let backup = DEFAULTS.backup;
  if (raw.backup === true) backup = "optional";
  else if (typeof raw.backup === "string" && BACKUP_LEVELS.includes(raw.backup)) backup = raw.backup;
  else if (raw.backup != null && raw.backup !== false) {
    problems.push(`unknown backup ${JSON.stringify(raw.backup)} — treated as off`);
  }

  const announceHours = clampNum(raw.announceHours, 0, 720, DEFAULTS.announceHours);
  if (raw.announceHours != null && announceHours !== raw.announceHours) {
    problems.push(`announceHours ${JSON.stringify(raw.announceHours)} clamped to ${announceHours}`);
  }
  // The escalation cannot precede the announcement — a window that shouts
  // "30 minutes left" as the FIRST thing the user ever hears about it is worse
  // than useless, and `--announce 15m --imminent 30m` is an easy slip.
  let imminentMinutes = clampNum(raw.imminentMinutes, 0, 1440, DEFAULTS.imminentMinutes);
  if (imminentMinutes > announceHours * 60) imminentMinutes = announceHours * 60;

  const restoredHours = clampNum(raw.restoredHours, 0, 72, DEFAULTS.restoredHours);

  // `hardBlock` removes the "keep working" hatch, so it is meaningless — and
  // dangerous if it ever stopped being meaningless — anywhere but `offline`.
  const hardBlock = severity === "offline" && raw.hardBlock === true;
  if (raw.hardBlock === true && severity !== "offline") {
    problems.push(`hardBlock ignored: only applies to severity "offline"`);
  }

  // An id keys dismissals. Derived when absent rather than refused: a window
  // with no id is still a real window, and the derivation is stable across
  // loads because it is made of the window's own timestamps.
  // A human label for the queue in the dev portal ("Fix the prereq crash").
  // OURS, not the student's: it is never rendered in the app, which is what lets
  // it be free text at all — a student-facing string would have to exist in all
  // eight locales, and that is precisely why `kind` is a closed vocabulary.
  // Trimmed and capped so a paste accident cannot make the queue unreadable.
  const name = typeof raw.name === "string" && raw.name.trim()
    ? raw.name.trim().slice(0, 80)
    : null;

  const rawId = typeof raw.id === "string" && /^[\w.:-]{1,64}$/.test(raw.id) ? raw.id : null;
  if (raw.id != null && !rawId) problems.push(`unusable id ${JSON.stringify(raw.id)} — derived one instead`);
  const id = rawId ?? `${new Date(start).toISOString()}/${new Date(end).toISOString()}`;

  return {
    window: {
      id, name, start, end, expectedEnd, durationMs, severity, kind, features, backup,
      announceHours, imminentMinutes, restoredHours, hardBlock,
    },
    problems,
  };
}

/**
 * Which phase a normalized window is in at `now`.
 * @param {object} w normalized window
 * @param {number} now epoch ms
 * @returns {'none'|'scheduled'|'imminent'|'active'|'restored'}
 */
export function phaseOf(w, now) {
  const announceAt = w.start - w.announceHours * HOUR;
  const imminentAt = w.start - w.imminentMinutes * MIN;
  const restoredUntil = w.end + w.restoredHours * HOUR;
  if (now >= restoredUntil) return "none";
  if (now >= w.end) return "restored";
  if (now >= w.start) return "active";
  if (now >= imminentAt) return "imminent";
  if (now >= announceAt) return "scheduled";
  return "none";
}

/** The inert answer. One object shape for every caller, always. */
const NOTHING = Object.freeze({
  phase: "none",
  severity: null,
  kind: null,
  window: null,
  startsInMs: null,
  endsInMs: null,
  /** What to SHOW as the return time: the forecast if there is one, else the
   *  deadline. Null once it is in the past — see `overrunning`. */
  etaMs: null,
  /** Forecast passed, deadline has not. "Taking longer than expected." */
  overrunning: false,
  backup: false,
  featuresDown: Object.freeze([]),
  blocking: false,
  hardBlock: false,
  problems: Object.freeze([]),
});

/**
 * Resolve a whole config against a clock.
 *
 * Accepts `{windows: [...]}`, `{window: {...}}`, a bare array, or a bare window
 * object — every shape a human editing the file by hand might reasonably write.
 * Anything else, including `null` from a failed fetch or a failed parse, is
 * `phase: "none"` (rule 1).
 *
 * @param {unknown} config
 * @param {number} now epoch ms, ALREADY skew-corrected by the caller
 * @returns {typeof NOTHING}
 */
export function resolveMaintenance(config, now) {
  if (!Number.isFinite(now)) return NOTHING;

  let raws = null;
  if (Array.isArray(config)) raws = config;
  else if (config && typeof config === "object") {
    if (Array.isArray(config.windows)) raws = config.windows;
    else if (config.window && typeof config.window === "object") raws = [config.window];
    else if (config.start != null || config.end != null) raws = [config];
  }
  if (!raws || !raws.length) return NOTHING;

  const problems = [];
  let best = null;
  let bestPhase = "none";

  raws.forEach((raw, i) => {
    const { window: w, problems: ps } = normalizeWindow(raw);
    for (const p of ps) problems.push(`window[${i}]: ${p}`);
    if (!w) return;
    const phase = phaseOf(w, now);
    if (phase === "none") return;
    // More urgent wins; equal urgency → the one that starts sooner, so two
    // notices a week apart announce in the order they will happen.
    if (
      PHASE_URGENCY[phase] > PHASE_URGENCY[bestPhase] ||
      (PHASE_URGENCY[phase] === PHASE_URGENCY[bestPhase] && best && w.start < best.start)
    ) {
      best = w;
      bestPhase = phase;
    }
  });

  if (!best) return { ...NOTHING, problems };

  // The forecast is what we quote, until it stops being true.
  const target = best.expectedEnd ?? best.end;
  const overrunning = bestPhase === "active" && best.expectedEnd != null && now >= best.expectedEnd;

  return {
    phase: bestPhase,
    severity: best.severity,
    kind: best.kind,
    window: best,
    startsInMs: best.start - now,
    endsInMs: best.end - now,
    etaMs: overrunning ? null : target - now,
    overrunning,
    // Asking for a backup only means something while there is still time to
    // make one — and after the window it would read as "we may have lost it".
    backup: bestPhase === "scheduled" || bestPhase === "imminent" ? best.backup : false,
    featuresDown: bestPhase === "active" ? best.features : [],
    // The one line that decides whether a student can see their degree plan.
    blocking: bestPhase === "active" && best.severity === "offline",
    hardBlock: bestPhase === "active" && best.severity === "offline" && best.hardBlock,
    problems,
  };
}

/**
 * Every problem in a config, for the CLI and for a test — including windows
 * that are already in the past, which the resolver correctly ignores and a
 * human editing the file should still be told about.
 * @param {unknown} config
 * @param {number} now
 */
export function auditConfig(config, now = Date.now()) {
  const out = { problems: [], stale: [], windows: [] };
  let raws = Array.isArray(config) ? config
    : Array.isArray(config?.windows) ? config.windows
      : config?.window ? [config.window]
        : config?.start != null ? [config] : [];
  raws.forEach((raw, i) => {
    const { window: w, problems } = normalizeWindow(raw);
    for (const p of problems) out.problems.push(`window[${i}]: ${p}`);
    if (!w) return;
    const phase = phaseOf(w, now);
    out.windows.push({ ...w, phase, index: i });
    if (phase === "none" && w.end < now) out.stale.push({ ...w, index: i });
  });
  return out;
}
