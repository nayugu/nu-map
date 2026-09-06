#!/usr/bin/env node
/**
 * watch-scrape.js — a live progress bar for a scrape that is ALREADY RUNNING.
 *
 * `lib/run-progress.js` makes the scrapers report their own position, which is
 * the right fix and reaches every future run. It cannot help you with the run
 * in front of you right now: the process started before the code changed, and
 * a scrape is 10-20 minutes you do not want to throw away to get a counter.
 *
 * This reads the LOG instead, so it attaches to anything already in flight —
 * including the workflows, which already tee to a file
 * (`… | tee /tmp/majors-log.txt`), and including a run started by someone else.
 * It is read-only: it never touches the scrape, and quitting it does nothing.
 *
 *   node scripts/watch-scrape.js <log-path>
 *   node scripts/watch-scrape.js <log-path> --interval 5
 *
 * The total comes from the scraper's own "Found N program URLs" header, so a
 * log that has not got that far yet reports pages done and no percentage
 * rather than guessing a denominator.
 */
import { readFileSync, existsSync, statSync } from "node:fs";

const argv = process.argv.slice(2);
const LOG = argv.find(a => !a.startsWith("--"));
const iv = argv.indexOf("--interval");
const INTERVAL = (iv >= 0 ? Number(argv[iv + 1]) : 2) * 1000;

if (!LOG) {
  console.error("usage: watch-scrape.js <log-path> [--interval SECONDS]");
  process.exit(2);
}
if (!existsSync(LOG)) {
  console.error(`No such log: ${LOG}`);
  process.exit(2);
}

/** One page line is `  <url> … ` — with or without run-progress's prefix. */
const PAGE = /^\s*(?:\[[^\]]*\]\s*)?https?:\/\/\S+\s+…/gm;
const TOTAL = /Found (\d+) program URLs(?:.*?\+ (\d+)[^)]*?\+ (\d+))?/s;
const DONE = /^Results:/m;

// Rate is measured from what this watcher itself observes, not from the log's
// own history: the file carries no timestamps, so the only honest window is
// the one that starts when you attach. That means the first reading has no
// rate and says so, rather than inventing one from the whole run.
const started = Date.now();
let startCount = null;
let lastLine = "";

function read() {
  const text = readFileSync(LOG, "utf8");
  const pages = (text.match(PAGE) ?? []).length;

  let total = null;
  const m = text.match(TOTAL);
  if (m) total = [m[1], m[2], m[3]].filter(Boolean).reduce((a, b) => a + Number(b), 0);

  const ok = (text.match(/^(?:.*?)(?:OK {2}|↳ )"/gm) ?? []).length;
  const skip = (text.match(/SKIP \(/g) ?? []).length;
  const fail = (text.match(/^\s*(?:FAIL|ERROR|✗)/gm) ?? []).length;

  return { pages, total, ok, skip, fail, finished: DONE.test(text), text };
}

function bar(frac, width = 28) {
  const full = Math.round(frac * width);
  return "█".repeat(full) + "░".repeat(Math.max(0, width - full));
}

function fmt(s) {
  s = Math.round(s);
  if (s < 90) return `${s}s`;
  const mm = Math.floor(s / 60);
  return mm < 90 ? `${mm}m${String(s % 60).padStart(2, "0")}s` : `${(mm / 60).toFixed(1)}h`;
}

function tick() {
  const st = read();
  if (startCount === null) startCount = st.pages;

  const elapsed = (Date.now() - started) / 1000;
  const observed = st.pages - startCount;
  const rate = observed > 0 && elapsed > 0 ? observed / elapsed : null;

  const parts = [];
  if (st.total) {
    const frac = Math.min(1, st.pages / st.total);
    parts.push(`${bar(frac)} ${String(Math.round(frac * 100)).padStart(3)}%`);
    parts.push(`${st.pages}/${st.total}`);
  } else {
    parts.push(`${st.pages} pages`);
  }
  parts.push(`ok ${st.ok}`, `skip ${st.skip}`);
  if (st.fail) parts.push(`FAIL ${st.fail}`);
  if (rate) {
    parts.push(`${(1 / rate).toFixed(1)}s/pg`);
    if (st.total) parts.push(`ETA ${fmt((st.total - st.pages) / rate)}`);
  } else {
    parts.push("measuring…");
  }

  const line = parts.join("  ");
  // Rewrite one line rather than scrolling: this runs beside a scrape whose own
  // output you may also be watching.
  if (process.stdout.isTTY) {
    process.stdout.write(`\r\x1b[2K${line}`);
  } else if (line !== lastLine) {
    console.log(line);
  }
  lastLine = line;

  if (st.finished) {
    const tail = st.text.trim().split("\n").slice(-3).join("\n");
    process.stdout.write(`\n\n${tail}\n`);
    process.exit(0);
  }
  // A log that has stopped growing while the run is unfinished is the case this
  // exists to make visible, so say it rather than sitting at the same number.
  const age = (Date.now() - statSync(LOG).mtimeMs) / 1000;
  if (age > 120 && process.stdout.isTTY) {
    process.stdout.write(`  ⚠ no output for ${fmt(age)}`);
  }
}

tick();
setInterval(tick, INTERVAL);
