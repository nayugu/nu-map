#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// preview-roll — see the catalog roll BEFORE it happens, in a browser.
//
// ── Why this exists ─────────────────────────────────────────────────
//
// Retirement is entirely dark in production. Measured 2026-09-03: of the 7,966
// courses in `catalog-courses.json`, **zero** carry `retired: true` and zero
// carry `retiredSince`. So `course-retention.js`, the `⚠ retired` badge, its
// tooltip and its eight locales have never rendered for a single real course.
// The last full scrape compared the 2025-2026 catalog against itself, which is
// why: no roll, nothing to retire.
//
// On 1 October the monthly job pulls the 2026-2027 catalog and that number goes
// from 0 to roughly 1,070 in one unattended run. A feature whose first
// appearance in production is also its first appearance anywhere is not a
// feature anyone has tested, and "the tests pass" is not an answer to "show me
// one" — this repo's own rule is that a green Node suite says nothing about
// whether the app RENDERS.
//
// So: build the post-roll app locally, from REAL retirements, and serve it.
//
// ── What it does NOT do ─────────────────────────────────────────────
//
// It never writes to `public/`. The shipped `catalog-courses.json` is still the
// 2026 edition, so those courses are legitimately CURRENT and putting them in
// the union today would be false — and would break the disjointness invariant
// on purpose. Everything is written to a scratch directory instead, which also
// keeps it clear of a partner session sharing this checkout.
//
// Usage:
//   node scripts/preview-roll.js                  # cs, serve on a free port
//   node scripts/preview-roll.js --subjects cs,math
//   node scripts/preview-roll.js --port 5illegal  # (any free port)
//   node scripts/preview-roll.js --no-serve       # just build it
// ═══════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, existsSync, cpSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { join, extname } from "node:path";
import { parse as parseHTML } from "node-html-parser";

import { parseSubjectPage } from "./lib/catalog-course-parser.js";
import { deriveRetiredUnion } from "./derive-retired-union.js";
import { keyOfCourse } from "./lib/course-retention.js";

const ROOT     = process.cwd();
const DIST     = join(ROOT, "dist");
const SNAPSHOT = join(ROOT, "data/northeastern/catalog/editions/2026/catalog-courses.json");
const BASE     = "https://catalog.northeastern.edu";

const argv = process.argv.slice(2);
const val  = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const SUBJECTS = (val("--subjects") ?? "cs").split(",").map(s => s.trim()).filter(Boolean);
const SERVE    = !argv.includes("--no-serve");
const OUT      = val("--out") ?? join(
  process.env.TMPDIR ?? "/tmp", "numap-roll-preview");

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".map": "application/json", ".txt": "text/plain",
  ".wasm": "application/wasm",
};

async function liveCourses(slug) {
  const res = await fetch(`${BASE}/course-descriptions/${slug}/`, {
    headers: { "User-Agent": "NU-Map-DataBot/1.0 (preview-roll)", Accept: "text/html" },
  });
  if (res.status === 404) return null;      // subject retired wholesale
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${slug}`);
  return parseSubjectPage(await res.text(), slug.toUpperCase());
}

async function main() {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("No dist/ — run `npm run build` first.");
    process.exit(1);
  }
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8"));

  // ── Which courses does the LIVE edition no longer publish? ──────────
  console.log(`\nPREVIEW OF THE ROLL — subjects: ${SUBJECTS.join(", ")}\n`);
  const wanted = new Set(SUBJECTS.map(s => s.toUpperCase()));
  const live = new Set();
  for (const slug of SUBJECTS) {
    const got = await liveCourses(slug);
    if (got === null) {
      // A subject with no live page is a real, wholesale retirement — 10 of
      // them in the measured roll. Absence of the PAGE is the answer here;
      // it is a fetch FAILURE that must never be read as retirement, and that
      // one throws above rather than being swallowed.
      console.log(`  ${slug.toUpperCase()}: no live page — the whole subject is retired`);
      continue;
    }
    for (const c of got) live.add(keyOfCourse(c));
    console.log(`  ${slug.toUpperCase()}: ${got.length} courses live in 2026-2027`);
  }

  // The simulated post-roll catalog: every course still published, plus every
  // course outside the subjects we probed (untouched, so the app still works).
  const postRoll = snapshot.filter(c => {
    if (!wanted.has(String(c.subject).toUpperCase())) return true;
    return live.has(keyOfCourse(c));
  });
  const { retired } = deriveRetiredUnion(postRoll, [{ year: 2026, rows: snapshot }]);

  console.log(`\n  catalog: ${snapshot.length} → ${postRoll.length}`);
  console.log(`  retired union: ${retired.length}\n`);
  for (const c of retired) {
    console.log(`    ${keyOfCourse(c).padEnd(9)} ${String(c.credits + " SH").padEnd(6)} ${c.title}`);
  }

  // ── Assemble a servable copy. Never public/. ────────────────────────
  mkdirSync(OUT, { recursive: true });
  cpSync(DIST, OUT, { recursive: true });
  writeFileSync(join(OUT, "northeastern/catalog-courses.json"), JSON.stringify(postRoll));
  writeFileSync(join(OUT, "northeastern/retired-courses.json"), JSON.stringify(retired));
  console.log(`\n  built → ${OUT}`);

  if (!SERVE) return;
  const server = createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");
      if (rel.includes("..")) { res.writeHead(403).end(); return; }
      if (rel === "" || rel.endsWith("/")) rel += "index.html";
      let file = join(OUT, rel);
      // SPA fallback, so a deep link still boots the app.
      if (!existsSync(file)) file = join(OUT, "index.html");
      res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(readFileSync(file));
    } catch (e) { res.writeHead(500).end(String(e?.message ?? e)); }
  });
  // A busy port is an ordinary thing to hit — the previous preview is often
  // still up — and crashing with an unhandled 'error' event throws a stack
  // trace at someone who just wanted a URL. Fall back to any free port.
  const port = Number(val("--port")) || 0;
  server.on("error", (e) => {
    if (e.code !== "EADDRINUSE") throw e;
    console.log(`\n  port ${port} is busy — taking a free one instead`);
    server.listen(0, "127.0.0.1");
  });
  server.listen(port, "127.0.0.1", () => {
    const p = server.address().port;
    console.log(`\n  ┌─────────────────────────────────────────────────────────`);
    console.log(`  │  http://127.0.0.1:${p}`);
    console.log(`  │`);
    console.log(`  │  Search the course bank for one of the codes above.`);
    console.log(`  │  It resolves, carries its credits, and shows ⚠ retired.`);
    console.log(`  │  Ctrl-C to stop.`);
    console.log(`  └─────────────────────────────────────────────────────────\n`);
  });
}

main();
