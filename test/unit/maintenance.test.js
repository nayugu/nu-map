// ═══════════════════════════════════════════════════════════════════
// MAINTENANCE — the schedule resolver, attacked.
//
// This module decides whether a student can see their degree plan, from a JSON
// file edited by hand under time pressure. The failures worth testing are
// therefore not "does a correct window work" — they are the ones where a
// mistake in that file, or a wrong clock, LOCKS SOMEBODY OUT. So the bulk of
// this file is malformed input, boundary instants and a fuzz pass whose single
// assertion is that nothing but a deliberate `offline` window can ever produce
// `blocking: true`.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveMaintenance, normalizeWindow, phaseOf, auditConfig,
  DEFAULTS, MAX_OFFLINE_HOURS, MAX_WINDOW_DAYS, SEVERITIES, KINDS, FEATURES,
} from "../../src/core/maintenance.js";
import {
  formatRelative, formatInstant, formatWindow,
} from "../../src/core/maintenanceFormat.js";

const HOUR = 3600e3, MIN = 60e3, DAY = 24 * HOUR;
const T0 = Date.parse("2026-08-30T06:00:00Z");

/** A plain, valid window centred on T0. */
const win = (over = {}) => ({
  id: "w1",
  start: new Date(T0).toISOString(),
  end: new Date(T0 + 2 * HOUR).toISOString(),
  severity: "notice",
  kind: "deploy",
  ...over,
});

const cfg = (...ws) => ({ windows: ws });

// ── 1. Fail open ────────────────────────────────────────────────────
//
// Every one of these is a real shape the fetch can return. The SPA catch-all in
// public/_headers means a MISSING file answers with index.html at status 200,
// so "the config is an HTML string" is the ordinary no-file case, not an
// anomaly. None of them may produce a notice, and none may throw.

test("maintenance › garbage resolves to nothing, never throws", () => {
  const junk = [
    null, undefined, "", "   ", 0, 1, NaN, true, false,
    "<!DOCTYPE html><html>", "{not json}", [], {},
    { windows: null }, { windows: "soon" }, { windows: {} }, { windows: [null, 7, "x", []] },
    { window: null }, { window: 42 }, { start: "nope", end: "nope" },
    { windows: [{}] }, { windows: [{ start: T0 }] }, { windows: [{ end: T0 }] },
    Object.create(null), new Date(), () => {},
  ];
  for (const c of junk) {
    const r = resolveMaintenance(c, T0);
    assert.equal(r.phase, "none", `expected nothing for ${JSON.stringify(c)}`);
    assert.equal(r.blocking, false);
    assert.equal(r.window, null);
  }
});

test("maintenance › a broken clock resolves to nothing", () => {
  for (const now of [NaN, Infinity, -Infinity, undefined, null, "2026-08-30"]) {
    assert.equal(resolveMaintenance(cfg(win()), now).phase, "none");
  }
});

test("maintenance › end must be after start", () => {
  const same = new Date(T0).toISOString();
  assert.equal(resolveMaintenance(cfg(win({ end: same })), T0).phase, "none");
  assert.equal(
    resolveMaintenance(cfg(win({ end: new Date(T0 - HOUR).toISOString() })), T0).phase,
    "none",
  );
});

// ── 2. Boundaries ───────────────────────────────────────────────────
//
// Each transition is checked one millisecond either side. An off-by-one here is
// not cosmetic: at `start` it is the difference between a notice and a locked
// door, and at `restoredUntil` it is the difference between clearing itself and
// staying up forever.

test("maintenance › every phase boundary, to the millisecond", () => {
  const w = normalizeWindow(win()).window;
  const announceAt = T0 - DEFAULTS.announceHours * HOUR;
  const imminentAt = T0 - DEFAULTS.imminentMinutes * MIN;
  const end = T0 + 2 * HOUR;
  const cleared = end + DEFAULTS.restoredHours * HOUR;

  const cases = [
    [announceAt - 1, "none"], [announceAt, "scheduled"],
    [imminentAt - 1, "scheduled"], [imminentAt, "imminent"],
    [T0 - 1, "imminent"], [T0, "active"],
    [end - 1, "active"], [end, "restored"],
    [cleared - 1, "restored"], [cleared, "none"],
  ];
  for (const [now, want] of cases) {
    assert.equal(phaseOf(w, now), want, `at ${new Date(now).toISOString()}`);
  }
});

test("maintenance › a finished window clears itself with no second deploy", () => {
  // The property that stops a failed deploy stranding everyone on a
  // maintenance page: nothing has to be shipped for the window to end.
  const c = cfg(win({ severity: "offline" }));
  assert.equal(resolveMaintenance(c, T0 + HOUR).blocking, true);
  assert.equal(resolveMaintenance(c, T0 + 2 * HOUR).blocking, false);
  assert.equal(resolveMaintenance(c, T0 + 100 * DAY).phase, "none");
});

// ── 3. Typos that would lock people out ─────────────────────────────

// ── `end` is a deadline, `expectedEnd` is a forecast ────────────────

test("maintenance › the forecast is what gets quoted, the deadline is what recovers", () => {
  const w = win({
    severity: "offline",
    end: new Date(T0 + 48 * HOUR).toISOString(),        // "at most two days"
    expectedEnd: new Date(T0 + 8 * HOUR).toISOString(), // "we think eight hours"
  });
  const early = resolveMaintenance(cfg(w), T0 + HOUR);
  assert.equal(early.overrunning, false);
  assert.equal(early.etaMs, 7 * HOUR, "quotes the forecast, not the deadline");
  assert.equal(early.endsInMs, 47 * HOUR);
  assert.equal(early.blocking, true);
});

test("maintenance › past the forecast it stops counting down and says so", () => {
  // The failure this prevents: a visible countdown that has run out while the
  // page is still up, which reads as abandoned.
  const w = win({
    severity: "offline",
    end: new Date(T0 + 48 * HOUR).toISOString(),
    expectedEnd: new Date(T0 + 8 * HOUR).toISOString(),
  });
  const over = resolveMaintenance(cfg(w), T0 + 20 * HOUR);
  assert.equal(over.overrunning, true);
  assert.equal(over.etaMs, null, "there is no honest number left to show");
  assert.equal(over.blocking, true, "still down, though");
  // And it still recovers on its own at the deadline.
  assert.equal(resolveMaintenance(cfg(w), T0 + 48 * HOUR).blocking, false);
});

test("maintenance › overrunning is only ever a claim about an ACTIVE window", () => {
  const w = win({ expectedEnd: new Date(T0 + HOUR).toISOString() });
  for (const now of [T0 - 12 * HOUR, T0 - MIN, T0 + 2 * HOUR + MIN]) {
    assert.equal(resolveMaintenance(cfg(w), now).overrunning, false, new Date(now).toISOString());
  }
});

test("maintenance › a nonsense forecast is repaired, never trusted", () => {
  // After the deadline → clamped, because quoting a return later than the
  // guaranteed recovery is incoherent.
  const late = normalizeWindow(win({ expectedEnd: new Date(T0 + 99 * HOUR).toISOString() }));
  assert.equal(late.window.expectedEnd, late.window.end);
  assert.ok(late.problems.some(p => /clamped to end/.test(p)));
  // Before the start, or unparseable → dropped, and the deadline is quoted.
  for (const bad of [new Date(T0 - HOUR).toISOString(), "next tuesday", 0, {}]) {
    const r = normalizeWindow(win({ expectedEnd: bad }));
    assert.equal(r.window.expectedEnd, null, JSON.stringify(bad));
  }
  assert.equal(resolveMaintenance(cfg(win({ expectedEnd: "junk" })), T0 + HOUR).etaMs, HOUR);
});

test("maintenance › a two-day outage is honoured, not demoted", () => {
  // The regression this pins: MAX_OFFLINE_HOURS was 24, so the project's own
  // stated worst case ("off for up to two days while we fix it") was silently
  // turned into a notice — the guard firing on the real case instead of on the
  // typo it exists for.
  const w = win({ severity: "offline", end: new Date(T0 + 48 * HOUR).toISOString() });
  const r = resolveMaintenance(cfg(w), T0 + 24 * HOUR);
  assert.equal(r.severity, "offline");
  assert.equal(r.blocking, true);
  assert.deepEqual(r.problems, []);
  assert.equal(MAX_OFFLINE_HOURS, 72);
});

test("maintenance › an over-long offline window is demoted, not honoured", () => {
  const w = win({
    severity: "offline",
    end: new Date(T0 + (MAX_OFFLINE_HOURS + 1) * HOUR).toISOString(),
  });
  const r = resolveMaintenance(cfg(w), T0 + HOUR);
  assert.equal(r.phase, "active");
  assert.equal(r.severity, "notice", "should demote to a notice");
  assert.equal(r.blocking, false, "must never lock out for an implausible window");
  assert.ok(r.problems.some(p => /demoted/.test(p)), "and must say so");
});

test("maintenance › a wrong-year window is dropped entirely", () => {
  const w = win({ end: new Date(T0 + (MAX_WINDOW_DAYS + 1) * DAY).toISOString() });
  const r = resolveMaintenance(cfg(w), T0 + HOUR);
  assert.equal(r.phase, "none");
  assert.ok(r.problems.some(p => /cap, dropped/.test(p)));
});

test("maintenance › hardBlock is ignored unless the window is offline", () => {
  for (const severity of ["notice", "degraded"]) {
    const r = resolveMaintenance(cfg(win({ severity, hardBlock: true })), T0 + HOUR);
    assert.equal(r.hardBlock, false, severity);
    assert.ok(r.problems.some(p => /hardBlock ignored/.test(p)), severity);
  }
  const ok = resolveMaintenance(cfg(win({ severity: "offline", hardBlock: true })), T0 + HOUR);
  assert.equal(ok.hardBlock, true);
});

test("maintenance › the escalation can never precede the announcement", () => {
  // `--announce 15m --imminent 30m` is an easy slip, and it would make the
  // FIRST thing a student ever hears be "starts in 30 minutes".
  const { window: w } = normalizeWindow(win({ announceHours: 0.25, imminentMinutes: 30 }));
  assert.equal(w.imminentMinutes, 15);
  assert.equal(phaseOf(w, T0 - 20 * MIN), "none");
  assert.equal(phaseOf(w, T0 - 15 * MIN), "imminent");
});

// ── 4. Vocabularies ─────────────────────────────────────────────────

test("maintenance › unknown severity, kind and features degrade to the safe default", () => {
  const r = resolveMaintenance(
    cfg(win({ severity: "OFFLINE", kind: "hacking", features: ["claude", "banner", 7, null, "claude"] })),
    T0 + HOUR,
  );
  assert.equal(r.severity, DEFAULTS.severity, "case-sensitive: not offline");
  assert.equal(r.blocking, false);
  assert.equal(r.kind, DEFAULTS.kind);
  assert.deepEqual(r.window.features, ["claude"], "unknown dropped, duplicate collapsed");
  // severity + kind + three unusable feature entries ("banner", 7, null).
  assert.equal(r.problems.filter(p => /unknown/.test(p)).length, 5);
});

test("maintenance › every declared vocabulary member survives normalization", () => {
  // A vocabulary the resolver silently rejects is a feature nobody can use.
  for (const severity of SEVERITIES) {
    assert.equal(normalizeWindow(win({ severity })).window.severity, severity);
  }
  for (const kind of KINDS) {
    assert.equal(normalizeWindow(win({ kind })).window.kind, kind);
  }
  assert.deepEqual(normalizeWindow(win({ features: FEATURES })).window.features, FEATURES);
});

test("maintenance › backup accepts true as 'optional' and rejects anything else", () => {
  assert.equal(normalizeWindow(win({ backup: true })).window.backup, "optional");
  assert.equal(normalizeWindow(win({ backup: "recommended" })).window.backup, "recommended");
  assert.equal(normalizeWindow(win({ backup: false })).window.backup, false);
  const bad = normalizeWindow(win({ backup: "URGENT" }));
  assert.equal(bad.window.backup, false);
  assert.ok(bad.problems.some(p => /unknown backup/.test(p)));
});

// ── 5. What each phase is allowed to ask for ────────────────────────

test("maintenance › a backup is asked for only while there is time to make one", () => {
  const c = cfg(win({ backup: "recommended" }));
  assert.equal(resolveMaintenance(c, T0 - 12 * HOUR).backup, "recommended", "scheduled");
  assert.equal(resolveMaintenance(c, T0 - 5 * MIN).backup, "recommended", "imminent");
  assert.equal(resolveMaintenance(c, T0 + HOUR).backup, false, "active: too late to be useful");
  assert.equal(resolveMaintenance(c, T0 + 2.5 * HOUR).backup, false, "restored: would read as loss");
});

test("maintenance › features are named as down only while the window is open", () => {
  const c = cfg(win({ severity: "degraded", features: ["claude", "share"] }));
  assert.deepEqual(resolveMaintenance(c, T0 - HOUR).featuresDown, []);
  assert.deepEqual(resolveMaintenance(c, T0 + HOUR).featuresDown, ["claude", "share"]);
  assert.deepEqual(resolveMaintenance(c, T0 + 3 * HOUR).featuresDown, []);
});

// ── 6. Choosing between windows ─────────────────────────────────────

test("maintenance › the more urgent window wins, then the earlier one", () => {
  const soon = win({ id: "soon", start: new Date(T0).toISOString(), end: new Date(T0 + HOUR).toISOString() });
  const later = win({ id: "later", start: new Date(T0 + 10 * HOUR).toISOString(), end: new Date(T0 + 11 * HOUR).toISOString() });
  // `soon` is active, `later` is only scheduled.
  assert.equal(resolveMaintenance(cfg(later, soon), T0 + 10 * MIN).window.id, "soon");

  const a = win({ id: "a", start: new Date(T0 + 5 * HOUR).toISOString(), end: new Date(T0 + 6 * HOUR).toISOString() });
  const b = win({ id: "b", start: new Date(T0 + 8 * HOUR).toISOString(), end: new Date(T0 + 9 * HOUR).toISOString() });
  // Both merely scheduled → the one that happens first.
  assert.equal(resolveMaintenance(cfg(b, a), T0).window.id, "a");
});

test("maintenance › one bad window does not suppress a good one", () => {
  const r = resolveMaintenance(cfg({ start: "???" }, win({ severity: "offline" })), T0 + HOUR);
  assert.equal(r.blocking, true);
  assert.ok(r.problems.some(p => /window\[0\]/.test(p)), "and the bad one is reported by index");
});

test("maintenance › a name is carried for the queue, trimmed and capped", () => {
  // OURS, not the student's: it is never rendered in the app, which is the only
  // reason it can be free text at all — a student-facing string would have to
  // exist in all eight locales, which is why `kind` is a closed vocabulary.
  assert.equal(normalizeWindow(win({ name: "  Fix the prereq crash  " })).window.name, "Fix the prereq crash");
  assert.equal(normalizeWindow(win({ name: "x".repeat(200) })).window.name.length, 80);
  for (const bad of [undefined, null, "", "   ", 42, {}, []]) {
    assert.equal(normalizeWindow(win({ name: bad })).window.name, null, JSON.stringify(bad));
  }
  // And it never changes what a visitor is shown.
  const a = resolveMaintenance(cfg(win({ severity: "offline" })), T0 + HOUR);
  const b = resolveMaintenance(cfg(win({ severity: "offline", name: "anything" })), T0 + HOUR);
  assert.equal(a.blocking, b.blocking);
  assert.equal(a.kind, b.kind);
  assert.equal(a.etaMs, b.etaMs);
});

test("maintenance › an id is derived when absent, and stable across calls", () => {
  const w = win(); delete w.id;
  const a = resolveMaintenance(cfg(w), T0 + HOUR).window.id;
  const b = resolveMaintenance(cfg(w), T0 + 90 * MIN).window.id;
  assert.equal(a, b);
  assert.ok(a.includes("2026-08-30T06:00"), a);
  // A junk id is replaced rather than trusted — it keys a dismissal record.
  const junk = resolveMaintenance(cfg(win({ id: "a b/c\n" })), T0 + HOUR);
  assert.ok(!junk.window.id.includes(" "));
  assert.ok(junk.problems.some(p => /unusable id/.test(p)));
});

// ── 7. The one assertion that matters most ──────────────────────────

test("maintenance › fuzz: nothing but a real offline window can block", () => {
  const pool = [
    undefined, null, 0, 1, -1, NaN, "", "x", true, false, [], {},
    "notice", "degraded", "offline", "OFFLINE", "none",
    "2026-08-30T06:00:00Z", "2026-08-30", "tomorrow", T0, T0 + HOUR, -T0,
    1e15, -1e15, "1e999", "9999-01-01T00:00:00Z",
  ];
  const pickFrom = (seed) => pool[seed % pool.length];
  let blocked = 0;
  for (let i = 0; i < 4000; i++) {
    const raw = {
      id: pickFrom(i), start: pickFrom(i * 7 + 1), end: pickFrom(i * 13 + 2),
      severity: pickFrom(i * 3), kind: pickFrom(i * 5), features: pickFrom(i * 11),
      backup: pickFrom(i * 17), hardBlock: pickFrom(i * 19),
      announceHours: pickFrom(i * 23), imminentMinutes: pickFrom(i * 29),
      restoredHours: pickFrom(i * 31),
    };
    // Pure garbage almost never lands on a valid window by accident, so every
    // eighth case is a REAL offline window with one field still mutated. That
    // is the case the assertion below exists for: without it this test passes
    // by never reaching the branch it claims to guard.
    if (i % 8 === 0) {
      raw.severity = "offline";
      raw.start = new Date(T0).toISOString();
      raw.end = new Date(T0 + 2 * HOUR).toISOString();
    }
    const now = [T0, T0 + HOUR, T0 - DAY, 0, Date.now()][i % 5];
    // Must not throw, whatever it is handed.
    const r = resolveMaintenance({ windows: [raw] }, now);
    assert.ok(SEVERITIES.includes(r.severity) || r.severity === null);
    if (r.blocking) {
      blocked++;
      // Every block must be justifiable from the input, with no exceptions.
      assert.equal(r.severity, "offline");
      assert.equal(r.phase, "active");
      assert.ok(r.window.start <= now && now < r.window.end);
      assert.ok(r.window.durationMs <= MAX_OFFLINE_HOURS * HOUR);
    }
  }
  // A fuzz pass that never reached the interesting branch would be a test that
  // always passes; this asserts the corpus actually exercised it.
  assert.ok(blocked > 0, "fuzz never produced a blocking window — the pool is wrong");
});

// ── 8. The audit the CLI prints ─────────────────────────────────────

test("maintenance › auditConfig reports past windows the resolver ignores", () => {
  const past = win({ id: "old", start: "2026-01-01T00:00:00Z", end: "2026-01-01T02:00:00Z" });
  const a = auditConfig(cfg(past, win()), T0 - 30 * HOUR);
  assert.equal(a.windows.length, 2);
  assert.equal(a.stale.length, 1);
  assert.equal(a.stale[0].id, "old");
});

test("maintenance › auditConfig tolerates the same garbage as the resolver", () => {
  for (const c of [null, undefined, "x", [], {}, { windows: [null] }]) {
    const a = auditConfig(c, T0);
    assert.ok(Array.isArray(a.windows) && Array.isArray(a.problems) && Array.isArray(a.stale));
  }
});

// ── 9. Formatting, which runs on a screen shown during an outage ────

test("maintenance format › never throws, whatever the locale or number", () => {
  const locales = ["en", "zh", "ar", "hi", "ja", "ko", "es", "fr", "xx-YY", "", null, undefined, "@@@"];
  const values = [0, 1, -1, 1000, -1000, 60e3, 3600e3, 86400e3, 1e15, NaN, Infinity, -Infinity];
  for (const lc of locales) {
    for (const v of values) {
      assert.equal(typeof formatRelative(v, lc), "string");
      assert.equal(typeof formatInstant(v, lc), "string");
      assert.equal(typeof formatWindow(v, v + HOUR, lc), "string");
    }
  }
});

test("maintenance format › a countdown never rounds to zero", () => {
  // "in 0 minutes" is not a thing anyone says, and this runs right up to the
  // instant a window opens.
  for (const ms of [1, 100, 999, 1001, 29e3, 31e3, 59e3, 61e3]) {
    const s = formatRelative(ms, "en");
    assert.ok(!/\b0\b/.test(s), `${ms} → ${s}`);
  }
  // The documented unit thresholds, pinned: minutes up to 90, hours to 36,
  // then days. These are what keep the escalation phase accurate to under a
  // minute, which is the only place the countdown drives an action.
  assert.match(formatRelative(89 * MIN, "en"), /89 minutes/);
  assert.match(formatRelative(91 * MIN, "en"), /2 hours/);
  assert.match(formatRelative(35 * HOUR, "en"), /35 hours/);
  assert.match(formatRelative(40 * HOUR, "en"), /2 days/);
  assert.match(formatRelative(-3 * MIN, "en"), /ago/);
});

test("maintenance format › a window always states its timezone", () => {
  // The whole reason the absolute time is shown: "2 AM" without a zone is a
  // lie to anyone reading it from another one.
  const s = formatWindow(T0, T0 + 2 * HOUR, "en");
  assert.ok(s.includes("–"), s);
  assert.ok(/[A-Z]{2,5}|GMT|UTC/.test(s), `no timezone in ${s}`);
});
