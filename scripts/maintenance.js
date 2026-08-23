#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// MAINTENANCE CLI — schedule a window, or ask what is scheduled.
//
//   npm run maint                         what is scheduled, and what a
//                                         visitor sees right now
//   npm run maint -- schedule --start "2026-08-30 02:00" --for 2h
//   npm run maint -- now --for 20m --severity offline
//   npm run maint -- clear
//
// Nothing writes without `--write`, following the house convention for every
// data script here. A dry run prints the exact JSON it would store AND the
// timeline the app will derive from it — because the mistakes this command can
// make are all schedule mistakes (a window in the wrong month, an announcement
// that fires after the window starts, an `offline` where a `notice` was meant),
// and every one of them is obvious in a timeline and invisible in JSON.
//
// ── One deploy covers the whole event ───────────────────────────────
//
// Times are absolute, so after `--write` the only remaining step is committing
// and pushing: the app announces the window, escalates as it approaches, shows
// the page during it, and clears itself when `end` passes. There is nothing to
// turn off afterwards, and nothing to remember. See docs/maintenance.md.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditConfig, normalizeWindow, phaseOf, resolveMaintenance,
  SEVERITIES, KINDS, FEATURES, BACKUP_LEVELS, DEFAULTS,
  MAX_OFFLINE_HOURS,
} from "../src/core/maintenance.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = resolve(ROOT, "public/maintenance.json");

const C = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  b: s => `\x1b[1m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
};

// ── Playbooks ───────────────────────────────────────────────────────
//
// The two things that actually happen, each as one command. This exists because
// the flag-by-flag interface asked the wrong question: standing in front of a
// broken deploy, nobody wants to decide `--announce`, `--imminent`, `--backup`
// and `--restored` from first principles — they want to say which of the two
// situations this is and when.
//
// A playbook is only DEFAULTS. Every value stays overridable on the same command
// line, and both run through the identical `schedule()` path as a hand-built
// window, so there is no second implementation to drift.
// There is deliberately only ONE playbook. An `update` playbook existed for a
// day — a short notice around an ordinary push to main — and was deleted,
// because the only user-visible effect of a routine deploy is a tab holding a
// stale shell, and `index.html`'s recovery screen already detects and repairs
// exactly that. Announcing it was announcing a non-event, which is the same
// crying-wolf failure the backup prompt is careful to avoid: notices that fire
// when nothing is wrong are the reason nobody reads the one that matters.
//
// So maintenance means one thing here: THE SITE IS COMING OFF.
const PLAYBOOKS = {
  // "Big bug, site off for safety." Announced two days out, escalated ten
  // minutes before, offline with the graceful-degradation hatch left open, an
  // expected return we can move, and a hard deadline that recovers us even if
  // every deploy fails.
  outage: {
    for: "2d", expect: "8h", severity: "offline", kind: "infra",
    announce: "48h", imminent: "10m", backup: "recommended", restored: "12h",
    _blurb: "a real outage: 48 h notice, 10 min warning, offline with a way through",
  },
};

// ── Arguments ───────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const cmd = (argv[0] && !argv[0].startsWith("--")) ? argv.shift() : "status";
const flags = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith("--")) continue;
  const key = a.replace(/^--/, "");
  const next = argv[i + 1];
  if (next && !next.startsWith("--")) { flags[key] = next; i++; } else { flags[key] = true; }
}

const HOUR = 3600e3, MIN = 60e3;

/**
 * `2h`, `90m`, `45`, `1d` → ms. Bare numbers are MINUTES, because every window
 * we have ever wanted is minutes or hours and "--for 2" meaning two
 * milliseconds would be a silent nonsense.
 */
function parseDuration(s) {
  if (typeof s !== "string") return null;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i.exec(s.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const u = (m[2] || "m").toLowerCase();
  return n * (u === "ms" ? 1 : u === "s" ? 1000 : u === "m" ? MIN : u === "h" ? HOUR : 24 * HOUR);
}

/**
 * A start time. Accepts `now`, `+30m`, or any date string Node can parse.
 *
 * A string with no timezone ("2026-08-30 02:00") is read as LOCAL time on this
 * machine, which is the reading a human typing it expects — and the reason the
 * dry run prints both the local and the UTC form before anything is written.
 */
function parseWhen(s) {
  if (s === "now" || s === true) return Date.now();
  if (typeof s !== "string") return null;
  if (s.startsWith("+")) {
    const d = parseDuration(s.slice(1));
    return d == null ? null : Date.now() + d;
  }
  // "2026-08-30 02:00" → Date.parse wants the T for the local reading.
  const t = Date.parse(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) ? s.replace(" ", "T") : s);
  return Number.isFinite(t) ? t : null;
}

function readConfig() {
  try {
    return JSON.parse(readFileSync(FILE, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return { windows: [] };
    console.error(C.red(`\n  ${FILE} is not valid JSON: ${e.message}`));
    console.error(C.dim("  The app treats an unparseable file as 'nothing scheduled', so this is\n  not an outage — but nothing you schedule will be seen until it is fixed.\n"));
    process.exit(1);
  }
}

function fmt(ms) {
  const d = new Date(ms);
  const local = d.toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
  return `${local}  ${C.dim(d.toISOString())}`;
}

// ── status ──────────────────────────────────────────────────────────

function status() {
  const cfg = readConfig();
  const now = Date.now();
  const audit = auditConfig(cfg, now);
  const state = resolveMaintenance(cfg, now);

  console.log(`\n  ${C.b("public/maintenance.json")}  ${C.dim(`${audit.windows.length} window(s)`)}`);
  console.log(`  ${C.dim(`now  ${fmt(now)}`)}\n`);

  if (!audit.windows.length) {
    console.log(`  ${C.green("Nothing scheduled.")} The app says nothing, the edge serves 200, and\n  there is not even a timer running in the browser.\n`);
  }

  for (const w of audit.windows) {
    const live = w.phase !== "none";
    const tag = w.severity === "offline" ? C.red("offline")
      : w.severity === "degraded" ? C.yellow("degraded") : C.cyan("notice");
    console.log(`  ${live ? "▶" : " "} ${C.b(w.name ?? w.id)}  ${tag}  ${C.dim(w.kind)}${w.hardBlock ? C.red("  hardBlock") : ""}`);
    if (w.name) console.log(`      ${C.dim(w.id)}`);
    timeline(w, now);
    console.log("");
  }

  console.log(`  ${C.b("Right now a visitor sees:")}`);
  if (state.phase === "none") {
    console.log(`    the ordinary app, and no notice at all.\n`);
  } else {
    const seen = {
      scheduled: "a header notice with the window and a countdown",
      imminent: "an escalated header notice" + (state.backup ? " and a backup offer" : ""),
      active: state.blocking
        ? `the maintenance page — HTTP 503 at the edge${state.hardBlock ? ", with no way past" : ", with a 'Continue anyway' link"}`
        : "a header notice saying maintenance is in progress",
      restored: "a 'we're back' notice with a reload button",
    }[state.phase];
    console.log(`    ${seen}`);
    if (state.featuresDown.length) console.log(`    ${C.dim(`named as unavailable: ${state.featuresDown.join(", ")}`)}`);
    console.log("");
  }

  if (audit.stale.length) {
    console.log(`  ${C.dim(`${audit.stale.length} window(s) already finished. They are inert, but`)}`);
    console.log(`  ${C.dim("`npm run maint -- clear --past --write` tidies the file.")}\n`);
  }
  if (audit.problems.length) {
    console.log(`  ${C.yellow("Problems:")}`);
    for (const p of audit.problems) console.log(`    ${p}`);
    console.log("");
  }
}

/** The derived schedule, which is the whole point of the dry run. */
function timeline(w, now) {
  // Row names ARE the phase names, so the `→` marker below can point at the row
  // the app is actually in. They drifted apart once ("announce" vs "scheduled")
  // and the marker silently never appeared for the first phase.
  const rows = [
    ["scheduled", w.start - w.announceHours * HOUR, "header notice appears"],
    ["imminent", w.start - w.imminentMinutes * MIN, "notice escalates" + (w.backup ? `, backup offered (${w.backup})` : "")],
    ["active", w.start, w.severity === "offline" ? "503 + maintenance page" : w.severity === "degraded" ? "notice: features unavailable" : "notice: in progress"],
    // The forecast is a row of its own, because what happens when it passes is
    // a real state change the reader sees — and the commonest mistake here is
    // assuming the site comes BACK at the expected time. It does not; it comes
    // back at the deadline, or when you run `done`.
    ...(w.expectedEnd ? [["expected", w.expectedEnd, "the time we quote; past it, \"taking longer than expected\""]] : []),
    ["restored", w.end, "'we're back' notice"],
    ["cleared", w.end + w.restoredHours * HOUR, "nothing, automatically"],
  ];
  const at = phaseOf(w, now);
  for (const [name, ms, what] of rows) {
    const mark = at === name ? C.green("→") : ms <= now ? C.dim("·") : " ";
    console.log(`      ${mark} ${name.padEnd(10)}${fmt(ms)}  ${C.dim(what)}`);
  }
}

// ── schedule / now ──────────────────────────────────────────────────

/**
 * @param {object} o
 * @param {boolean} [o.immediate] force `--start now`
 * @param {string} [o.playbook] name in PLAYBOOKS; supplies defaults only
 */
function schedule({ immediate, playbook }) {
  if (playbook) {
    // Defaults only — anything the caller typed wins.
    for (const [k, v] of Object.entries(PLAYBOOKS[playbook])) {
      if (k.startsWith("_")) continue;
      if (flags[k] === undefined) flags[k] = v;
    }
    console.log(`\n  ${C.b(playbook)} — ${C.dim(PLAYBOOKS[playbook]._blurb)}`);
  }
  const start = parseWhen(immediate ? "now" : flags.start);
  if (start == null) {
    console.error(C.red(`\n  --start is required (ISO, "2026-08-30 02:00", "now", or "+2h").\n`));
    process.exit(1);
  }
  let end = flags.end ? parseWhen(flags.end) : null;
  if (end == null) {
    const dur = parseDuration(flags.for ?? flags.hours ?? "2h");
    if (dur == null) { console.error(C.red(`\n  --for could not be read: ${flags.for}\n`)); process.exit(1); }
    end = start + dur;
  }

  const severity = flags.severity ?? DEFAULTS.severity;
  if (!SEVERITIES.includes(severity)) {
    console.error(C.red(`\n  --severity must be one of: ${SEVERITIES.join(", ")}\n`));
    process.exit(1);
  }
  const kind = flags.kind ?? "deploy";
  if (!KINDS.includes(kind)) {
    console.error(C.red(`\n  --kind must be one of: ${KINDS.join(", ")}\n`));
    process.exit(1);
  }
  const backup = flags.backup === true ? "optional" : flags.backup ?? false;
  if (backup && !BACKUP_LEVELS.includes(backup)) {
    console.error(C.red(`\n  --backup must be one of: ${BACKUP_LEVELS.join(", ")}\n`));
    process.exit(1);
  }
  const features = typeof flags.features === "string"
    ? flags.features.split(",").map(s => s.trim()).filter(Boolean) : [];
  const unknown = features.filter(f => !FEATURES.includes(f));
  if (unknown.length) {
    console.error(C.red(`\n  unknown --features: ${unknown.join(", ")}`));
    console.error(C.dim(`  known: ${FEATURES.join(", ")}\n`));
    process.exit(1);
  }

  // `--expect` is the forecast we SHOW; `--for`/`--end` is the deadline that
  // recovers us on its own. For an outage of unknown length those are genuinely
  // two numbers: quote eight hours, guarantee two days.
  let expectedEnd = null;
  if (flags.expect) {
    const d = parseDuration(flags.expect) ?? parseWhen(flags.expect);
    if (d == null) { console.error(C.red(`\n  --expect could not be read: ${flags.expect}\n`)); process.exit(1); }
    expectedEnd = d > 1e11 ? d : start + d;   // an absolute time, or a duration
  }

  const win = {
    id: flags.id ?? new Date(start).toISOString().slice(0, 16).replace(/[:T]/g, "-") + `-${kind}`,
    ...(typeof flags.name === "string" && flags.name.trim() ? { name: flags.name.trim() } : {}),
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    ...(expectedEnd ? { expectedEnd: new Date(expectedEnd).toISOString() } : {}),
    severity, kind,
    ...(features.length ? { features } : {}),
    ...(backup ? { backup } : {}),
    // `!= null`, not truthy: `--announce 0m` is a real instruction ("no advance
    // notice"), and a truthiness test silently replaced it with the 24 h default.
    ...(flags.announce != null ? { announceHours: (parseDuration(flags.announce) ?? DEFAULTS.announceHours * HOUR) / HOUR } : {}),
    ...(flags.imminent != null ? { imminentMinutes: (parseDuration(flags.imminent) ?? DEFAULTS.imminentMinutes * MIN) / MIN } : {}),
    ...(flags.restored != null ? { restoredHours: (parseDuration(flags.restored) ?? DEFAULTS.restoredHours * HOUR) / HOUR } : {}),
    ...(flags["hard-block"] ? { hardBlock: true } : {}),
  };

  // Validated by the same code the app runs, so a dry run cannot pass something
  // the browser would then quietly drop or demote.
  const { window: norm, problems } = normalizeWindow(win);
  if (!norm) {
    console.error(C.red("\n  This window would be ignored by the app:"));
    for (const p of problems) console.error(`    ${p}`);
    console.error("");
    process.exit(1);
  }

  const cfg = readConfig();
  // Finished windows are KEPT for a week, not dropped on the next schedule: the
  // dev portal's queue shows them faded as the record of what happened, and
  // pruning them the moment anything new was queued threw that away. A week
  // bounds the file, which every visitor fetches.
  const HISTORY_MS = 7 * 24 * HOUR;
  const kept = (Array.isArray(cfg.windows) ? cfg.windows : []).filter(w => {
    const t = Date.parse(w?.end);
    return !Number.isFinite(t) || t > Date.now() - HISTORY_MS;
  });
  const next = { ...cfg, windows: [...kept, win] };

  console.log(`\n  ${C.b("Window to add")}`);
  console.log(JSON.stringify(win, null, 2).split("\n").map(l => `    ${l}`).join("\n"));
  console.log(`\n  ${C.b("Timeline")}`);
  timeline(norm, Date.now());

  if (problems.length) {
    console.log(`\n  ${C.yellow("Adjusted:")}`);
    for (const p of problems) console.log(`    ${p}`);
  }

  // A window whose announcement is already in the past gives nobody notice. It
  // is sometimes exactly what you want (`now`, something is on fire) and is
  // never what you want by accident, so it gets said out loud either way.
  // A minute of slack: `--start +2d --announce 48h` puts the announcement at
  // almost exactly now, which is the INTENT, and an exact `<=` flagged it as a
  // mistake. Only a meaningfully-past announcement is worth saying.
  if (norm.start - norm.announceHours * HOUR < Date.now() - 60e3) {
    console.log(`\n  ${C.yellow("No advance notice:")} the announcement point is already past, so nobody`);
    console.log(`  ${C.dim("gets a heads-up. Push the start out, or raise --announce, if that matters.")}`);
  }

  if (severity === "offline") {
    console.log(`\n  ${C.red("This closes the door.")} A visitor gets HTTP 503 and the maintenance page.`);
    console.log(`  ${C.dim(`Plans live in the visitor's own browser, so the app itself does not need us —`)}`);
    console.log(`  ${C.dim(`consider --severity notice unless the deployment genuinely cannot serve.`)}`);
    if (flags["hard-block"]) {
      console.log(`  ${C.red("--hard-block removes the 'Continue anyway' link.")} Only correct when an edit`);
      console.log(`  ${C.dim("made during the window would be written into a schema you are replacing.")}`);
    }
    if (norm.durationMs > MAX_OFFLINE_HOURS * HOUR) {
      console.log(`  ${C.yellow(`Over ${MAX_OFFLINE_HOURS}h — the app and the edge both demote this to a notice.`)}`);
    }
  }

  if (!flags.write) {
    console.log(`\n  ${C.dim("Dry run. Re-run with --write to save, then commit and push.")}\n`);
    return;
  }
  writeFileSync(FILE, JSON.stringify(next, null, 2) + "\n");
  console.log(`\n  ${C.green("Written")} to public/maintenance.json`);
  console.log(`  ${C.dim("Commit and push — Pages picks it up on deploy, and nothing needs")}`);
  console.log(`  ${C.dim("turning off afterwards.")}\n`);
}

// ── clear ───────────────────────────────────────────────────────────

function clear() {
  const cfg = readConfig();
  const all = Array.isArray(cfg.windows) ? cfg.windows : [];
  const pastOnly = !!flags.past;
  const kept = pastOnly
    ? all.filter(w => { const t = Date.parse(w?.end); return !Number.isFinite(t) || t > Date.now(); })
    : [];
  const dropped = all.length - kept.length;

  console.log(`\n  ${pastOnly ? "Dropping finished windows" : "Clearing every window"}: ${dropped} of ${all.length}\n`);
  if (!dropped) { console.log(`  ${C.dim("Nothing to do.")}\n`); return; }

  if (!flags.write) {
    console.log(`  ${C.dim("Dry run. Re-run with --write to save.")}\n`);
    return;
  }
  writeFileSync(FILE, JSON.stringify({ ...cfg, windows: kept }, null, 2) + "\n");
  console.log(`  ${C.green("Written")} to public/maintenance.json\n`);
  if (!pastOnly) {
    console.log(`  ${C.dim("Note: an ACTIVE window does not need clearing to end — it ends at its own")}`);
    console.log(`  ${C.dim("`end` time with no deploy. Clear it only to end one EARLY.")}\n`);
  }
}

// ── extend / done: the two things you do WHILE it is happening ──────
//
// "As long as we need to fix it" is not a timestamp, so the schedule cannot be
// written once and left. These are the two adjustments that turn out to be
// needed, and both operate on the window that is currently live.

/** The live window's index in the file, or -1. */
function liveIndex(cfg, now) {
  const all = Array.isArray(cfg.windows) ? cfg.windows : [];
  for (let i = 0; i < all.length; i++) {
    const s = Date.parse(all[i]?.start), e = Date.parse(all[i]?.end);
    if (Number.isFinite(s) && Number.isFinite(e) && now >= s && now < e) return i;
  }
  return -1;
}

function extend() {
  const arg = argv.find(a => !a.startsWith("--")) ?? flags.by ?? flags.for;
  const by = parseDuration(typeof arg === "string" ? arg : "");
  if (by == null) {
    console.error(C.red(`\n  how much? e.g. \`npm run maint -- extend 6h --write\`\n`));
    process.exit(1);
  }
  const cfg = readConfig();
  const now = Date.now();
  const i = liveIndex(cfg, now);
  if (i < 0) { console.error(C.red("\n  No window is open right now — nothing to extend.\n")); process.exit(1); }

  const w = { ...cfg.windows[i] };
  const oldEnd = Date.parse(w.end);
  w.end = new Date(oldEnd + by).toISOString();
  // The forecast moves with the deadline, but only ever forward from NOW —
  // pushing a stale forecast forward by the same amount would keep quoting a
  // time already in the past.
  if (w.expectedEnd) {
    const oldExp = Date.parse(w.expectedEnd);
    w.expectedEnd = new Date(Math.max(oldExp, now) + by).toISOString();
  }

  console.log(`\n  ${C.b(w.id)}`);
  console.log(`    deadline  ${fmt(oldEnd)}  →  ${fmt(Date.parse(w.end))}`);
  if (w.expectedEnd) console.log(`    expected  →  ${fmt(Date.parse(w.expectedEnd))}`);

  const { window: norm, problems } = normalizeWindow(w);
  if (!norm) {
    console.error(C.red("\n  That would make the window unusable:"));
    for (const p of problems) console.error(`    ${p}`);
    process.exit(1);
  }
  if (problems.length) {
    console.log(`\n  ${C.yellow("Adjusted:")}`);
    for (const p of problems) console.log(`    ${p}`);
  }
  if (norm.severity !== w.severity) {
    console.log(`  ${C.yellow(`Severity is now ${norm.severity} — the extension pushed it past the ${MAX_OFFLINE_HOURS}h cap.`)}`);
  }

  if (!flags.write) { console.log(`\n  ${C.dim("Dry run. Re-run with --write to save.")}\n`); return; }
  const next = { ...cfg, windows: cfg.windows.map((x, j) => (j === i ? w : x)) };
  writeFileSync(FILE, JSON.stringify(next, null, 2) + "\n");
  console.log(`\n  ${C.green("Written")}. Commit and push.\n`);
}

/**
 * Remove a window that has NOT started.
 *
 * Deliberately refuses a live one. Deleting a running window would take the
 * maintenance page down with no "we're back" notice — silently, mid-outage —
 * which is the exact failure `done` exists to avoid. Cancelling something that
 * never began has no such tail, so it really is just a deletion.
 */
function cancel() {
  const id = argv.find(a => !a.startsWith("--")) ?? flags.id;
  if (typeof id !== "string" || !id) {
    console.error(C.red(`\n  which one? \`npm run maint -- cancel <id> --write\` (ids are in \`npm run maint\`)\n`));
    process.exit(1);
  }
  const cfg = readConfig();
  const all = Array.isArray(cfg.windows) ? cfg.windows : [];
  const now = Date.now();
  const i = all.findIndex(w => {
    const { window: n } = normalizeWindow(w);
    return n && n.id === id;
  });
  if (i < 0) { console.error(C.red(`\n  No window with id ${JSON.stringify(id)}.\n`)); process.exit(1); }

  const { window: w } = normalizeWindow(all[i]);
  if (phaseOf(w, now) === "active") {
    console.error(C.red("\n  That window is LIVE. Cancelling it would drop the maintenance page with no"));
    console.error(C.red("  \"we're back\" notice. Use `npm run maint -- done --write` instead.\n"));
    process.exit(1);
  }

  console.log(`\n  Cancelling ${C.b(w.name ?? w.id)} ${C.dim(`(would have started ${fmt(w.start)})`)}\n`);
  if (!flags.write) { console.log(`  ${C.dim("Dry run. Re-run with --write to save.")}\n`); return; }
  writeFileSync(FILE, JSON.stringify({ ...cfg, windows: all.filter((_, j) => j !== i) }, null, 2) + "\n");
  console.log(`  ${C.green("Written")}. Commit and push.\n`);
}

function done() {
  const cfg = readConfig();
  const now = Date.now();
  const i = liveIndex(cfg, now);
  if (i < 0) { console.error(C.red("\n  No window is open right now — nothing to end.\n")); process.exit(1); }

  // `end = now`, NOT delete. Deleting the window would take the notice down
  // instantly and silently; ending it moves the window into its `restored`
  // phase, which is what produces the "we're back — reload if anything looks
  // off" message. Coming back needs to be as announced as going down was.
  const w = { ...cfg.windows[i], end: new Date(now).toISOString() };
  delete w.expectedEnd;
  const { window: norm } = normalizeWindow(w);
  const restoredH = norm?.restoredHours ?? DEFAULTS.restoredHours;

  console.log(`\n  ${C.b(w.id)} ends now.`);
  console.log(`    ${C.dim(`"We're back" shows for ${restoredH}h, then clears itself.`)}`);
  if (!flags.write) { console.log(`\n  ${C.dim("Dry run. Re-run with --write to save.")}\n`); return; }
  const next = { ...cfg, windows: cfg.windows.map((x, j) => (j === i ? w : x)) };
  writeFileSync(FILE, JSON.stringify(next, null, 2) + "\n");
  console.log(`\n  ${C.green("Written")}. Commit and push to bring the site back.\n`);
}

// ── help ────────────────────────────────────────────────────────────

function help() {
  console.log(`
  ${C.b("maintenance")} — schedule a NU Map maintenance window

  ${C.b("THE ONLY CASE THAT NEEDS THIS")}
  ${C.dim("Ordinary pushes to main need nothing at all — index.html's recovery")}
  ${C.dim("screen already handles the one visible effect (a tab on a stale shell).")}
  ${C.dim("Maintenance is for when the SITE COMES OFF.")}

    ${C.cyan("npm run maint -- outage --start \"2026-08-30 22:00\" --expect 8h --write")}
        ${C.dim(PLAYBOOKS.outage._blurb)}
        ${C.dim("--expect is what we TELL people; --for (default 2d) is the hard")}
        ${C.dim("deadline the site recovers itself at even if every deploy fails.")}

    ${C.dim("Un-scheduling — a window always STARTS from the schedule, so these")}
    ${C.dim("are the only two ways one ever ends early:")}
    ${C.cyan("npm run maint -- done --write")}        ${C.dim("stop a LIVE one → \"we're back\" notice")}
    ${C.cyan("npm run maint -- cancel <id> --write")} ${C.dim("drop one that has not started")}
    ${C.cyan("npm run maint -- extend 6h --write")}   ${C.dim("push the deadline out instead")}

  ${C.b("EVERYTHING ELSE")}

  ${C.b("npm run maint")}                             show the schedule and what visitors see
  ${C.b("npm run maint -- schedule")} [flags]         build a window by hand
  ${C.b("npm run maint -- now")} [flags]              one starting immediately
  ${C.b("npm run maint -- clear")} [--past] [--write] remove windows outright

  ${C.b("flags")} ${C.dim("(a playbook only sets defaults — anything here still wins)")}
    --start <when>     ISO, "2026-08-30 02:00" (local), "now", "+2h"
    --for <dur>        2h, 90m, 45 (minutes), 1d          default 2h
                       THE DEADLINE — the site recovers itself here
    --expect <dur>     the return time we SHOW, if sooner than the deadline
    --end <when>       instead of --for
    --severity <s>     ${SEVERITIES.join(" | ")}          default ${DEFAULTS.severity}
    --kind <k>         ${KINDS.join(" | ")}
    --features <list>  comma-separated: ${FEATURES.join(",")}
    --backup <level>   ${BACKUP_LEVELS.join(" | ")}
    --announce <dur>   how early the notice appears        default ${DEFAULTS.announceHours}h
    --imminent <dur>   when it escalates                   default ${DEFAULTS.imminentMinutes}m
    --hard-block       remove the "Continue anyway" hatch  (offline only)
    --name <text>      what to call it in the dev portal queue (never shown
                       to students — that is what --kind is for)
    --id <id>          override the generated id
    --write            actually save

  ${C.dim("Docs: docs/maintenance.md")}
`);
}

switch (cmd) {
  case "status": status(); break;
  case "schedule": case "add": schedule({ immediate: false }); break;
  case "now": schedule({ immediate: true }); break;
  case "outage": schedule({ immediate: false, playbook: "outage" }); break;
  case "extend": extend(); break;
  case "done": done(); break;
  case "cancel": cancel(); break;
  case "clear": case "off": clear(); break;
  case "help": case "--help": help(); break;
  default:
    console.error(C.red(`\n  unknown command: ${cmd}`));
    help();
    process.exit(1);
}
