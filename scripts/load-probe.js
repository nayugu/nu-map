#!/usr/bin/env node
/**
 * load-probe.js — what a visit costs, and how close each platform wall is.
 *
 * ── Why this exists ─────────────────────────────────────────────────
 *
 * NU Map has never been measured above about five users. The question that
 * matters is not "does it work" — it does — but "what runs out first", and
 * every honest answer to that is a number nobody had written down. Four of the
 * five limits this project lives inside are HARD platform walls that fail a
 * DEPLOY rather than a request, which is the worst way to find out: the site
 * does not get slower, it stops updating.
 *
 * Measured 2026-08-22, on the numbers this probe re-derives:
 *
 *   Pages files per site   15,964 / 20,000 (free)     80% consumed
 *   Largest single asset   22.5 / 25 MiB (all plans)  90% consumed
 *   MCP worker heap        60.6 / 128 MB per isolate  47% consumed
 *   Cold-visit payload     ~1.0 MB brotli, 65.6% of it course descriptions
 *
 * None of those move on their own. They move when a scrape adds courses, when
 * a dependency bumps a wasm build, or when someone adds a field — which is
 * exactly when nobody is looking at them. So this is built to run in CI and in
 * a chat, cheaply, and to be diffable across runs.
 *
 * ── The four modes ──────────────────────────────────────────────────
 *
 *   --budget          (default) OFFLINE. Accounts a cold visit from the files
 *                     on disk and reports headroom against every wall. No
 *                     network, ~1 s. This is the one to run before a deploy.
 *
 *   --edge <origin>   One request per boot asset against a real deployment:
 *                     status, transfer encoding, bytes on the wire, and the
 *                     cache headers that decide whether a RETURNING visit
 *                     costs anything at all. 10 requests total.
 *
 *   --worker <origin> The MCP worker's cold-isolate ratio. `getQuery` caches
 *                     the built adapter in a module-global promise, so the
 *                     interesting number is how often that cache is actually
 *                     there.
 *
 *                     Measured twice on production 2026-08-22, minutes apart,
 *                     and the two runs DISAGREED — which is the finding, not
 *                     noise. First run, against a worker that had been idle:
 *                     6/10 warm at ~65 ms, 4/10 cold at ~900 ms. Second run,
 *                     immediately after: 11/12 warm at 23 ms, 1 cold at
 *                     101 ms. The cold ratio is not a property of the worker,
 *                     it is a property of the TRAFFIC — sparse traffic means
 *                     cold isolates, and steady traffic keeps them warm.
 *
 *                     Which is exactly why this matters at 10,000 users: the
 *                     worst cold ratio happens at the ONSET of a burst, when
 *                     many isolates spin up at once and each independently
 *                     pulls ~23 MB. Run this mode against an idle worker to
 *                     see the bad case; a warm one will flatter you.
 *
 *   --load N          Actual concurrency. GATED behind --i-mean-it for any
 *                     non-localhost origin, because pointing synthetic load
 *                     at your own production during registration week is a
 *                     way to cause the outage you were trying to prevent.
 *
 * ── Reading the output ──────────────────────────────────────────────
 *
 * Headroom is reported as percent-consumed against a CITED limit, never as a
 * bare size, because "5 MB" tells you nothing and "80% of a wall that fails
 * the deploy" tells you everything. Limits are in LIMITS below with the date
 * they were verified; re-verify rather than trusting them, they are Cloudflare's
 * to change.
 *
 * `--json out.json` writes the same numbers keyed by metric so two runs diff
 * exactly. A summary that says "bigger" without saying which asset is how the
 * description finding stayed invisible for a year.
 *
 * Usage:
 *   node scripts/load-probe.js
 *   node scripts/load-probe.js --budget --json before.json
 *   node scripts/load-probe.js --edge https://numap.app
 *   node scripts/load-probe.js --worker https://mcp.numap.app --calls 20
 *   node scripts/load-probe.js --diff before.json after.json
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
const flag = (name, dflt = null) => {
  const i = argv.indexOf(name);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
};

// ── Platform limits ──────────────────────────────────────────────────
//
// Every one of these is a HARD limit, verified against Cloudflare's own docs
// on the date shown. They are quoted rather than guessed because a plan built
// on a remembered limit is a plan built on nothing — and two of these differ
// by plan, so the free-tier column is what binds today.
const LIMITS = {
  verifiedOn: "2026-08-22",
  pagesFilesFree: 20_000,        // developers.cloudflare.com/pages/platform/limits
  pagesFilesPaid: 100_000,
  pagesMaxFileBytes: 25 * 1024 * 1024,  // 25 MiB, ALL plans — no paid escape
  workerIsolateBytes: 128 * 1024 * 1024,
  workerCpuMsFree: 10,
  workerCpuMsPaid: 30_000,
  workerSubrequestsFree: 50,
  doRequestsPerSecond: 1_000,    // soft limit, per OBJECT, single-threaded
  doFreeRequestsPerDay: 100_000,
};

// ── The boot payload ─────────────────────────────────────────────────
//
// BLOCKING is exactly the set `courseCatalog.fetchAll()` awaits, because that
// one call is the only thing gating `loading` in PlannerContext (line ~847) —
// so it is precisely the bytes between a user and a usable planner. Anything
// fetched later is DEFERRED and costs a visit nothing at first paint.
//
// all-courses.json is deliberately absent: fetchAll skips it whenever the
// build-time nuPath merge has run (coverage >= 10%), which is the normal case.
// It reappears as a 5.8 MB penalty only when merge-nupath.js did not run, and
// `--budget` flags that separately rather than folding it into the happy path.
const BLOCKING = [
  "northeastern/catalog-courses.json",
  "northeastern/term-history.json",
  "northeastern/offering-summary.json",
  "northeastern/subject-colleges.json",
  "northeastern/subjects.json",
  "northeastern/ratemyhusky.json",
  "northeastern/coop-courses.json",
];

const DEFERRED = [
  "northeastern/course-equivalences.json",
  "northeastern/plan-order.json",
  "northeastern/early-donors.json",
];

// Fetched by the MCP worker on every COLD isolate, from DATA_ORIGIN. Not a
// browser cost at all — an internal fan-out that scales with worker traffic
// and is invisible from the client side, which is why it gets its own line.
const WORKER_FANOUT = [
  "northeastern/catalog-courses.json",
  "northeastern/subject-colleges.json",
  "northeastern/term-history.json",
  "northeastern/offering-summary.json",
  "northeastern/term-details.json",
  "northeastern/programs-bundle.json",
  "northeastern/coop-courses.json",
  "data-meta.json",
];

// ── Formatting ───────────────────────────────────────────────────────

const kb = (n) => `${(n / 1024).toFixed(0)}K`;
const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;
const pct = (n, d) => `${((100 * n) / d).toFixed(1)}%`;

/** A headroom line: consumed / limit, with the verdict a reader should act on. */
function wall(label, used, limit, unit = mb) {
  const share = (100 * used) / limit;
  const mark = share >= 90 ? "!!" : share >= 75 ? " !" : "  ";
  return `${mark} ${label.padEnd(34)} ${String(unit(used)).padStart(11)} / ${String(unit(limit)).padStart(11)}  ${pct(used, limit).padStart(6)}`;
}

// ── Compression ──────────────────────────────────────────────────────
//
// Brotli is what Cloudflare actually serves to every modern browser, so raw
// bytes are the wrong unit for anything user-facing and gzip is the wrong unit
// too. Measured at quality 11 (what a static CDN pre-compresses at), not the
// default 6, because the gap between them is ~20% on JSON and quoting the
// wrong one would overstate every payload here.
function sizes(buf) {
  return {
    raw: buf.length,
    gzip: zlib.gzipSync(buf, { level: 9 }).length,
    brotli: zlib.brotliCompressSync(buf, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length,
  };
}

/** Where the built site is, preferring dist/ (what actually ships) over public/. */
function siteRoot() {
  const dist = join(ROOT, "dist");
  if (existsSync(join(dist, "index.html"))) return { dir: dist, built: true };
  return { dir: join(ROOT, "public"), built: false };
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push({ path: p, size: st.size });
  }
  return out;
}

// ── Mode: --budget (offline) ─────────────────────────────────────────

function budget() {
  const { dir, built } = siteRoot();
  const report = { mode: "budget", built, limits: LIMITS, assets: {}, walls: {} };

  console.log(`\nNU MAP LOAD BUDGET   (${built ? "dist/ — the real build" : "public/ — NOT BUILT, bundle sizes unavailable"})`);
  console.log(`platform limits verified ${LIMITS.verifiedOn}\n`);

  // ── What a cold visit downloads ──
  console.log("COLD VISIT — blocking (gates the planner; PlannerContext awaits fetchAll)");
  console.log(`   ${"asset".padEnd(38)} ${"raw".padStart(8)} ${"gzip".padStart(8)} ${"brotli".padStart(8)}`);
  let blockRaw = 0, blockBr = 0;
  for (const rel of BLOCKING) {
    const p = join(dir, rel);
    if (!existsSync(p)) { console.log(`   ${rel.padEnd(38)}  (absent — optional asset)`); continue; }
    const s = sizes(readFileSync(p));
    report.assets[rel] = s;
    blockRaw += s.raw; blockBr += s.brotli;
    console.log(`   ${rel.padEnd(38)} ${kb(s.raw).padStart(8)} ${kb(s.gzip).padStart(8)} ${kb(s.brotli).padStart(8)}`);
  }

  // The entry bundle is part of the blocking cost even though it is not JSON:
  // nothing renders until it parses, and it is the one asset that is cached
  // `immutable` so it is free on every visit AFTER the first.
  let entry = null;
  const assetsDir = join(dir, "assets");
  if (existsSync(assetsDir)) {
    const e = readdirSync(assetsDir).find((f) => /^index-[^/]+\.js$/.test(f));
    if (e) {
      const s = sizes(readFileSync(join(assetsDir, e)));
      entry = { name: e, ...s };
      report.assets[`assets/${e}`] = s;
      blockRaw += s.raw; blockBr += s.brotli;
      console.log(`   ${("assets/" + e).padEnd(38)} ${kb(s.raw).padStart(8)} ${kb(s.gzip).padStart(8)} ${kb(s.brotli).padStart(8)}`);
    }
  }
  console.log(`   ${"— total blocking —".padEnd(38)} ${kb(blockRaw).padStart(8)} ${"".padStart(8)} ${kb(blockBr).padStart(8)}`);
  report.blocking = { raw: blockRaw, brotli: blockBr };

  console.log("\nCOLD VISIT — deferred (does not gate first paint)");
  let defBr = 0;
  for (const rel of DEFERRED) {
    const p = join(dir, rel);
    if (!existsSync(p)) continue;
    const s = sizes(readFileSync(p));
    report.assets[rel] = s;
    defBr += s.brotli;
    console.log(`   ${rel.padEnd(38)} ${kb(s.raw).padStart(8)} ${kb(s.gzip).padStart(8)} ${kb(s.brotli).padStart(8)}`);
  }
  report.deferred = { brotli: defBr };

  // ── Where the blocking bytes actually go ──
  //
  // Field-level, because the asset-level view says "the catalog is big" and
  // stops there. It is not uniformly big: two thirds of it is one field that
  // renders one course at a time.
  const catPath = join(dir, "northeastern/catalog-courses.json");
  if (existsSync(catPath)) {
    const raw = JSON.parse(readFileSync(catPath, "utf8"));
    const arr = Array.isArray(raw) ? raw : Object.values(raw).flat();
    const cost = new Map();
    for (const c of arr) {
      for (const [k, v] of Object.entries(c)) {
        cost.set(k, (cost.get(k) ?? 0) + JSON.stringify(v).length + k.length + 4);
      }
    }
    const total = [...cost.values()].reduce((a, b) => a + b, 0);
    const ranked = [...cost].sort((a, b) => b[1] - a[1]);
    console.log(`\nCATALOG COMPOSITION  (${arr.length} courses, ${mb(total)} of JSON)`);
    report.catalogFields = {};
    for (const [k, v] of ranked.slice(0, 6)) {
      report.catalogFields[k] = v;
      console.log(`   ${k.padEnd(20)} ${kb(v).padStart(8)}  ${pct(v, total).padStart(6)}`);
    }
    // The split that matters: descriptions are display-only for the ONE
    // selected course, but they ride in the blocking asset for all 7,966.
    const descOnly = JSON.stringify(arr.map((c) => c.description ?? ""));
    const rest = JSON.stringify(arr.map(({ description, ...r }) => r));
    const dS = sizes(Buffer.from(descOnly));
    const rS = sizes(Buffer.from(rest));
    report.descriptionSplit = { description: dS, rest: rS };
    console.log(`   ${"".padEnd(20)}`);
    console.log(`   if split:  descriptions ${kb(dS.brotli)} brotli (deferrable)  |  everything else ${kb(rS.brotli)} brotli`);
    console.log(`   blocking payload would fall ${kb(blockBr)} -> ~${kb(blockBr - dS.brotli)} brotli`);
  }

  // ── Walls ──
  console.log(`\nPLATFORM WALLS   (!! >=90% consumed, ! >=75%)`);
  const all = walk(dir);
  const fileCount = all.length;
  const biggest = all.sort((a, b) => b.size - a.size)[0];
  report.walls.pagesFiles = { used: fileCount, limit: LIMITS.pagesFilesFree };
  report.walls.maxFile = { used: biggest.size, limit: LIMITS.pagesMaxFileBytes, path: relative(dir, biggest.path) };

  console.log(wall("Pages files per site (free)", fileCount, LIMITS.pagesFilesFree, (n) => String(n)));
  console.log(wall(`largest asset`, biggest.size, LIMITS.pagesMaxFileBytes));
  console.log(`   ${"".padEnd(34)} ${relative(dir, biggest.path)}`);

  // Worker fan-out: not a wall by itself, but it sets the cold-start cost and
  // the isolate footprint, and both of those ARE walls.
  let fanRaw = 0;
  for (const rel of WORKER_FANOUT) {
    const p = join(dir, rel);
    if (existsSync(p)) fanRaw += statSync(p).size;
  }
  report.walls.workerFanout = { bytes: fanRaw };
  console.log(`   ${"MCP worker cold-isolate fan-out".padEnd(34)} ${String(mb(fanRaw)).padStart(11)}   (${WORKER_FANOUT.length} subrequests of ${LIMITS.workerSubrequestsFree} free-plan budget)`);
  console.log(`   ${"".padEnd(34)} paid per COLD isolate; run --worker to measure today's ratio`);

  // The 5.8 MB penalty asset. Present in dist is fine; being FETCHED is not.
  const allCourses = join(dir, "northeastern/all-courses.json");
  if (existsSync(allCourses)) {
    const nu = (() => {
      try {
        const raw = JSON.parse(readFileSync(catPath, "utf8"));
        const arr = Array.isArray(raw) ? raw : Object.values(raw).flat();
        return arr.filter((c) => c.nuPath?.length > 0).length / arr.length;
      } catch { return null; }
    })();
    report.nuPathCoverage = nu;
    const armed = nu !== null && nu < 0.10;
    console.log(`   ${"all-courses.json fallback".padEnd(34)} ${String(mb(statSync(allCourses).size)).padStart(11)}   ${armed ? "!! ARMED — nuPath coverage " + pct(nu, 1) + " < 10%, every visit pays this" : "dormant (nuPath coverage " + (nu === null ? "?" : pct(nu, 1)) + ")"}`);
  }

  // ── What 10,000 users in a minute actually costs ──
  //
  // Stated in the user's own terms rather than in bytes, because "1 MB" and
  // "10,000 users" only become a decision when multiplied.
  const burst = 10_000;
  console.log(`\nAT ${burst.toLocaleString()} COLD VISITS IN ONE MINUTE`);
  console.log(`   egress            ${mb(blockBr * burst).padStart(12)}   ${((blockBr * burst * 8) / 60 / 1e9).toFixed(2)} Gbit/s sustained`);
  console.log(`   requests          ${String((BLOCKING.length + 2) * burst).padStart(12)}   across ${BLOCKING.length + 2} assets/visit`);
  console.log(`   served by         Cloudflare Pages edge — static, no origin, no per-request compute`);
  console.log(`   NOT at risk       the CDN. What is at risk is time-to-usable on a phone,`);
  console.log(`                     and every surface below that is NOT a static file.`);
  report.burst = { users: burst, egressBytes: blockBr * burst };

  return report;
}

// ── Mode: --edge (real delivery) ─────────────────────────────────────

// Raw bytes off the socket, WITHOUT decoding.
//
// This has to bypass `fetch`, and the reason is worth stating because the
// first version of this probe got it wrong and overstated the payload 6x:
// undici transparently decompresses, so `arrayBuffer().byteLength` is the
// DECODED size, and Cloudflare streams these responses chunked so there is no
// content-length to fall back on either. Reported 5,066K for an asset that is
// 981K on the wire. Counting chunks on the raw stream is the only honest
// measurement, and it is also the only way to see what quality the edge
// actually compressed at — which turned out to be the finding.
function rawFetch(url) {
  return new Promise((resolve, reject) => {
    import("node:https").then(({ default: https }) => {
      const t0 = Date.now();
      const req = https.get(url, { headers: { "Accept-Encoding": "br, gzip" } }, (res) => {
        let bytes = 0;
        res.on("data", (c) => { bytes += c.length; });
        res.on("end", () => resolve({
          status: res.statusCode,
          bytes,
          headers: res.headers,
          ms: Date.now() - t0,
        }));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.setTimeout(30_000, () => { req.destroy(new Error("timeout")); });
    }).catch(reject);
  });
}

async function edge(origin) {
  console.log(`\nEDGE DELIVERY  ${origin}   (bytes are RAW off the socket, not decoded)\n`);
  console.log(`   ${"asset".padEnd(38)} ${"code".padStart(4)} ${"wire".padStart(8)} ${"enc".padStart(6)} ${"cf-cache".padStart(9)} ${"ms".padStart(5)}  cache-control`);
  const report = { mode: "edge", origin, assets: {} };
  let wire = 0;

  for (const rel of ["", "data-meta.json", ...BLOCKING]) {
    const url = `${origin.replace(/\/$/, "")}/${rel}`;
    try {
      const r = await rawFetch(url);
      wire += r.bytes;
      const enc = r.headers["content-encoding"] ?? "identity";
      const cc = r.headers["cache-control"] ?? "(none)";
      const cf = r.headers["cf-cache-status"] ?? "—";
      report.assets[rel || "/"] = { status: r.status, bytes: r.bytes, enc, cfCache: cf, ms: r.ms, cacheControl: cc };
      console.log(`   ${(rel || "/").padEnd(38)} ${String(r.status).padStart(4)} ${kb(r.bytes).padStart(8)} ${enc.padStart(6)} ${cf.padStart(9)} ${String(r.ms).padStart(5)}  ${cc}`);
    } catch (err) {
      report.assets[rel || "/"] = { error: err.message };
      console.log(`   ${(rel || "/").padEnd(38)}  FAILED  ${err.message}`);
    }
  }

  console.log(`\n   total on the wire: ${kb(wire)}`);
  report.wireTotal = wire;

  // Two separate problems, both invisible without this mode, both caused by
  // the same `/*  Cache-Control: no-cache` catch-all in public/_headers.
  //
  // That rule was written for the HTML SHELL, for a real reason documented at
  // length in _headers (a stale shell references a deleted chunk hash and the
  // SPA fallback answers with HTML at status 200, freezing the page). But it
  // is a catch-all, so it also lands on ~8 MB of monthly JSON.
  const revalidating = Object.entries(report.assets)
    .filter(([, a]) => a.cacheControl && /no-cache|max-age=0/.test(a.cacheControl)).length;
  const dynamic = Object.entries(report.assets)
    .filter(([, a]) => a.cfCache === "DYNAMIC").length;
  report.revalidating = revalidating;
  report.dynamic = dynamic;
  console.log(`   ${revalidating} of ${Object.keys(report.assets).length} assets revalidate on EVERY visit (no-cache)`);
  console.log(`   ${dynamic} of ${Object.keys(report.assets).length} report cf-cache-status: DYNAMIC — not held in the edge cache tier`);
  console.log(`   data assets are unhashed, so they cannot be made immutable without a manifest.`);

  // Compression quality. The edge compresses on the fly, and on the fly is not
  // free, so it uses a low brotli quality. Pre-compressing at q11 at build time
  // is strictly better and costs a visitor nothing.
  const { dir } = siteRoot();
  const cat = "northeastern/catalog-courses.json";
  const onDisk = join(dir, cat);
  if (report.assets[cat]?.bytes && existsSync(onDisk)) {
    const best = sizes(readFileSync(onDisk)).brotli;
    const actual = report.assets[cat].bytes;
    report.compressionGap = { edge: actual, q11: best };
    console.log(`\n   COMPRESSION  ${cat}`);
    console.log(`      edge serves  ${kb(actual)}  (on-the-fly brotli, low quality)`);
    console.log(`      brotli q11   ${kb(best)}  (what a build-time pre-compress gives)`);
    console.log(`      every visitor pays ${kb(actual - best)} more than they need to — ${pct(actual - best, best)} overhead`);
  }
  return report;
}

// ── Mode: --worker (cold-isolate ratio) ──────────────────────────────

async function worker(origin, calls) {
  console.log(`\nMCP WORKER ISOLATE CACHE  ${origin}   (${calls} sequential /health calls)\n`);
  const times = [];
  for (let i = 0; i < calls; i++) {
    const t0 = Date.now();
    let status = 0;
    try {
      const res = await fetch(`${origin.replace(/\/$/, "")}/health`);
      status = res.status;
      await res.arrayBuffer();
    } catch { status = -1; }
    const ms = Date.now() - t0;
    times.push({ ms, status });
    console.log(`   call ${String(i + 1).padStart(3)}  ${String(ms).padStart(6)} ms  http ${status}`);
  }

  // The distribution here is bimodal by construction — a warm isolate answers
  // from a module-global promise, a cold one rebuilds from 8 subrequests — so
  // a mean would describe neither population. Split on the midpoint between
  // the extremes and report the two clusters and, above all, the RATIO.
  const ok = times.filter((t) => t.status === 200).map((t) => t.ms).sort((a, b) => a - b);
  const report = { mode: "worker", origin, calls, times };
  if (ok.length >= 2) {
    const mid = (ok[0] + ok[ok.length - 1]) / 2;
    const warm = ok.filter((m) => m < mid);
    const cold = ok.filter((m) => m >= mid);
    const avg = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(0);
    report.warm = { n: warm.length, meanMs: warm.length ? +avg(warm) : null };
    report.cold = { n: cold.length, meanMs: cold.length ? +avg(cold) : null };
    report.coldRatio = cold.length / ok.length;
    console.log(`\n   warm  ${String(warm.length).padStart(3)}/${ok.length}  mean ${warm.length ? avg(warm) : "—"} ms   (module-global cache hit)`);
    console.log(`   cold  ${String(cold.length).padStart(3)}/${ok.length}  mean ${cold.length ? avg(cold) : "—"} ms   (rebuilt: 8 subrequests, ~23 MB, ~200 ms CPU)`);
    console.log(`\n   COLD RATIO ${pct(cold.length, ok.length)} — that share of requests re-pulls the whole dataset.`);
    console.log(`   At scale this is an internal bandwidth amplifier, not just latency:`);
    console.log(`   the fan-out is ~23 MB and it is invisible from the client side.`);
  }
  return report;
}

// ── Mode: --load (concurrency) ───────────────────────────────────────

async function load(target, n, seconds) {
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(target);
  if (!isLocal && !has("--i-mean-it")) {
    console.error(
      `\nREFUSING to drive ${n} concurrent clients at ${target}.\n\n` +
      `This is a live service on a free plan (100,000 Worker requests/day, and a\n` +
      `single-threaded ShareBoxDO with a 1,000 req/s soft cap). A load test here\n` +
      `spends real quota and can cause exactly the outage it is meant to prevent.\n\n` +
      `Point it at a local dev server, or pass --i-mean-it if you have decided\n` +
      `deliberately and know what the quota cost is.\n`);
    process.exitCode = 2;
    return null;
  }

  console.log(`\nLOAD  ${target}   ${n} concurrent, ${seconds}s\n`);
  const deadline = Date.now() + seconds * 1000;
  const lat = [];
  let ok = 0, fail = 0;

  const worker1 = async () => {
    while (Date.now() < deadline) {
      const t0 = Date.now();
      try {
        const res = await fetch(target);
        await res.arrayBuffer();
        (res.ok ? ok++ : fail++);
      } catch { fail++; }
      lat.push(Date.now() - t0);
    }
  };
  await Promise.all(Array.from({ length: n }, worker1));

  lat.sort((a, b) => a - b);
  const q = (p) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] ?? 0;
  const report = {
    mode: "load", target, concurrency: n, seconds,
    requests: lat.length, ok, fail,
    rps: +(lat.length / seconds).toFixed(1),
    p50: q(0.5), p95: q(0.95), p99: q(0.99), max: lat[lat.length - 1] ?? 0,
  };
  console.log(`   requests ${report.requests}   ok ${ok}   failed ${fail}   ${report.rps} req/s`);
  console.log(`   p50 ${report.p50} ms   p95 ${report.p95} ms   p99 ${report.p99} ms   max ${report.max} ms`);
  return report;
}

// ── Mode: --diff ─────────────────────────────────────────────────────

function diff(aPath, bPath) {
  const a = JSON.parse(readFileSync(aPath, "utf8"));
  const b = JSON.parse(readFileSync(bPath, "utf8"));
  console.log(`\nDIFF  ${aPath} -> ${bPath}\n`);
  let moved = 0;

  const cmp = (label, x, y, unit = kb) => {
    if (x === undefined || y === undefined || x === y) return;
    moved++;
    const d = y - x;
    console.log(`   ${label.padEnd(42)} ${String(unit(x)).padStart(10)} -> ${String(unit(y)).padStart(10)}  ${d > 0 ? "+" : ""}${unit(Math.abs(d))}`);
  };

  cmp("blocking payload (brotli)", a.blocking?.brotli, b.blocking?.brotli);
  cmp("deferred payload (brotli)", a.deferred?.brotli, b.deferred?.brotli);
  cmp("Pages file count", a.walls?.pagesFiles?.used, b.walls?.pagesFiles?.used, String);
  cmp("largest asset", a.walls?.maxFile?.used, b.walls?.maxFile?.used, mb);

  // Hashed assets carry a different filename in every build, so comparing by
  // raw key silently drops the entry bundle from the diff — which is the single
  // asset most likely to have moved, since it is the one that contains the code
  // you just changed. Collapse the content hash so the two builds line up.
  const norm = (k) => k.replace(/-[A-Za-z0-9_-]{8,}(\.[a-z]+)$/, "-<hash>$1");
  const fold = (assets) => {
    const out = {};
    for (const [k, v] of Object.entries(assets ?? {})) out[norm(k)] = v;
    return out;
  };
  const fa = fold(a.assets), fb = fold(b.assets);
  for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
    cmp(`  ${k}`, fa[k]?.brotli, fb[k]?.brotli);
  }
  if (!moved) console.log("   nothing moved.");
  return { moved };
}

// ── Main ─────────────────────────────────────────────────────────────

const out = flag("--json");
let report;

if (has("--diff")) {
  const i = argv.indexOf("--diff");
  report = diff(argv[i + 1], argv[i + 2]);
} else if (has("--edge")) {
  report = await edge(flag("--edge", "https://numap.app"));
} else if (has("--worker")) {
  report = await worker(flag("--worker", "https://mcp.numap.app"), Number(flag("--calls", "10")));
} else if (has("--load")) {
  report = await load(flag("--target", "http://localhost:5173/"), Number(flag("--load", "10")), Number(flag("--for", "10")));
} else {
  report = budget();
}

if (out && report) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nwrote ${out}`);
}
console.log();
