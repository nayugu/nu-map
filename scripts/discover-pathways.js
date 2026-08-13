#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// DISCOVER PATHWAYS — stages 1–3 of the accelerated-pathway intake.
//
//   1 DISCOVER  sitemap sweep of every college host, robots-respecting
//   2 FETCH     cache each candidate page, so a claim stays checkable
//   3 CLASSIFY  decide pathway / index / policy / noise, and DIFF
//
// Stage 4 (writing the rules) is deliberately human — see
// docs/plusone-intake-design.md §5.4 for why, in short: "choose two" is
// genuinely ambiguous on the page, `CS 5500 → CS 4500 / CS 4530` is an
// alternation a parser reads as two independent rows (the bug fixed in
// 39f663770a), and Bouvé's own PDF contradicts itself, so a faithful extractor
// would faithfully encode an error.
//
// Stage 5 is scripts/verify-pathways.js.
//
// The academic catalog publishes NO PlusOne course data (measured: 7 stub pages,
// ~450 characters of prose, zero tables), so every pathway is transcribed from a
// college page. This script is how we know WHICH pages, and when they change.
//
// Usage:
//   npm run data:pathways:discover           # sweep, classify, report
//   npm run data:pathways:discover -- --write   # also write inventory + cache
//   … -- --host cos --host khoury            # limit to some hosts
//   … -- --no-fetch                          # sitemaps only, no page fetches
//
// TLS: six hosts serve a broken certificate chain. The npm script sets
// NODE_EXTRA_CA_CERTS; run directly and this script tells you what to do.
// See scripts/lib/certs/README.md.
// ═══════════════════════════════════════════════════════════════════

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  fetchText, newStats, assertHostsReachable, parseRobots, isDisallowed,
  checkTlsSetup, BROKEN_CHAIN_HOSTS,
} from "./lib/pathway-fetch.js";
import {
  parseSitemap, isCandidateUrl, classifyPage, contentHash, diffInventory,
  checkIntakeRails, courseCodesOn, cacheableText, PAGE_KIND,
} from "./lib/pathway-intake.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "data/northeastern/pathways");
const INVENTORY = join(OUT_DIR, "_inventory.json");
const CACHE_DIR = join(OUT_DIR, "_cache");

/** Every host that publishes accelerated-pathway pages. */
const HOSTS = [
  "khoury", "coe", "cos", "cssh", "bouve", "damore-mckim", "camd", "cps",
  "ece", "mie", "cee", "che", "bioe",
];

const argv = process.argv.slice(2);
const WRITE = argv.includes("--write");
const NO_FETCH = argv.includes("--no-fetch");
const only = argv.reduce((acc, a, i) => (a === "--host" && argv[i + 1] ? [...acc, argv[i + 1]] : acc), []);
const hosts = only.length ? HOSTS.filter(h => only.includes(h)) : HOSTS;

const tls = checkTlsSetup();
if (!tls.ok && hosts.some(h => BROKEN_CHAIN_HOSTS.includes(h))) {
  console.warn(`\n⚠ ${tls.hint}\n`);
}

const stats = newStats();
const urlCounts = new Map();

async function sweepHost(host) {
  const base = `https://${host}.northeastern.edu`;
  const robots = await fetchText(`${base}/robots.txt`, { stats, host, timeoutMs: 15_000 });
  const rules = parseRobots(robots);

  // Recursive sitemap expansion. `seen` guards the cycle a mis-generated index
  // can create; depth guards the pathological nesting it cannot.
  const seen = new Set();
  const all = [];
  const walk = async (url, depth = 0) => {
    if (depth > 3 || seen.has(url)) return;
    seen.add(url);
    const xml = await fetchText(url, { stats, host });
    if (!xml) return;
    const { urls, isIndex } = parseSitemap(xml);
    if (isIndex) {
      for (const sub of urls) await walk(sub, depth + 1);
    } else {
      all.push(...urls);
    }
  };
  await walk(`${base}/sitemap_index.xml`);

  urlCounts.set(host, all.length);

  const candidates = [...new Set(all.filter(u => {
    if (!isCandidateUrl(u)) return false;
    let p; try { p = new URL(u).pathname; } catch { return false; }
    return !isDisallowed(p, rules);
  }))].sort();

  return { host, total: all.length, candidates, robotsRules: rules.length };
}

// ── stage 1: sweep ────────────────────────────────────────────────
console.log(`\nsweeping ${hosts.length} hosts…\n`);
const swept = [];
for (const host of hosts) {
  const r = await sweepHost(host);
  swept.push(r);
  const errs = stats.errors.get(host) ?? [];
  console.log(
    `  ${host.padEnd(14)} ${String(r.total).padStart(6)} urls  ` +
    `${String(r.candidates.length).padStart(3)} candidates` +
    (errs.length ? `   ✗ ${errs.length} fetch failure(s): ${errs[0]}` : "")
  );
}

// ── RAIL: unreachable is not empty ────────────────────────────────
const reach = assertHostsReachable(urlCounts, stats);

// ── stage 2 + 3: fetch, classify ──────────────────────────────────
const entries = [];
if (!NO_FETCH) {
  const total = swept.reduce((n, s) => n + s.candidates.length, 0);
  console.log(`\nfetching and classifying ${total} candidate pages…\n`);
  for (const { host, candidates } of swept) {
    for (const url of candidates) {
      const html = await fetchText(url, { stats, host });
      if (!html) { entries.push({ url, host, kind: "unfetchable", hash: null }); continue; }
      const { kind, signals } = classifyPage(url, html);
      const hash = await contentHash(html);
      entries.push({
        url, host, kind, hash,
        courseCodes: kind === PAGE_KIND.PATHWAY ? courseCodesOn(html).length : undefined,
        signals,
      });
      if (WRITE) {
        const slug = new URL(url).pathname.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "index";
        mkdirSync(join(CACHE_DIR, host), { recursive: true });
        // Visible text, not raw HTML — see cacheableText for why. A first
        // comment line carries the URL so a cached file is self-identifying.
        writeFileSync(join(CACHE_DIR, host, `${slug}.txt`),
                      `# ${url}\n# fetched ${new Date().toISOString().slice(0, 10)}\n\n` +
                      cacheableText(html));
      }
    }
  }
}

// ── report ────────────────────────────────────────────────────────
const byKind = entries.reduce((m, e) => (m[e.kind] = (m[e.kind] ?? 0) + 1, m), {});
console.log("\nclassified:", JSON.stringify(byKind));

const pathwayPages = entries.filter(e => e.kind === PAGE_KIND.PATHWAY);
console.log(`\n=== ${pathwayPages.length} PATHWAY pages ===`);
for (const e of pathwayPages) {
  console.log(`  [${String(e.courseCodes).padStart(3)} codes] ${e.url}`);
}
for (const kind of [PAGE_KIND.INDEX, PAGE_KIND.POLICY]) {
  const list = entries.filter(e => e.kind === kind);
  if (!list.length) continue;
  console.log(`\n=== ${list.length} ${kind.toUpperCase()} pages ===`);
  for (const e of list) console.log("  ", e.url);
}
const bad = entries.filter(e => e.kind === "unfetchable");
if (bad.length) {
  console.log(`\n=== ${bad.length} UNFETCHABLE ===`);
  for (const e of bad) console.log("  ", e.url);
}

// ── which pathway pages do we already model? ──────────────────────
const shipped = [];
for (const f of walkJson(OUT_DIR)) {
  try {
    const p = JSON.parse(readFileSync(f, "utf8"));
    if (p?.source?.url) shipped.push(p.source.url);
  } catch { /* _inventory.json and friends are not pathways */ }
}
const shippedSet = new Set(shipped.map(normalise));
const unmodelled = pathwayPages.filter(e => !shippedSet.has(normalise(e.url)));
console.log(`\ncoverage: ${pathwayPages.length - unmodelled.length}/${pathwayPages.length} ` +
            `pathway pages have a pathway file`);
if (unmodelled.length) {
  console.log(`\n=== ${unmodelled.length} NOT YET MODELLED ===`);
  for (const e of unmodelled) console.log("  ", e.url);
}

// ── diff against the committed inventory ──────────────────────────
const previous = existsSync(INVENTORY) ? JSON.parse(readFileSync(INVENTORY, "utf8")) : null;
if (previous?.entries) {
  const d = diffInventory(previous.entries, entries);
  console.log(`\ndrift vs committed inventory: ` +
              `+${d.added.length} added, -${d.gone.length} gone, ~${d.changed.length} changed`);
  for (const u of d.added) console.log("   + ", u);
  for (const u of d.gone) console.log("   - ", u, "  (a source we cite may have vanished)");
  for (const u of d.changed) console.log("   ~ ", u, "  (content moved — re-read the rules)");
}

// ── rails ─────────────────────────────────────────────────────────
//
// Candidates come from the SWEEP, not from `entries`. With --no-fetch there are
// no entries at all, so reading them here reported "0 candidates" and would have
// failed the rediscovery rail on every no-fetch run once an inventory existed —
// a rail that fires on its own diagnostic mode is worse than no rail.
const sweptCandidates = swept.flatMap(s => s.candidates);
const rails = checkIntakeRails({
  hosts: hosts.length,
  totalUrls: [...urlCounts.values()].reduce((a, b) => a + b, 0),
  candidates: sweptCandidates,
  // Only compare against a previous run of the same shape: a --host-limited run
  // legitimately sees a fraction of the inventory and must not read as a regression.
  previousCandidates: only.length ? [] : (previous?.entries?.map(e => e.url) ?? []),
  unreachable: reach.failures,
});

console.log(`\nswept ${rails.stats.totalUrls} urls across ${rails.stats.hosts} hosts, ` +
            `${rails.stats.candidates} candidates, ${stats.failed} fetch failures`);

if (!rails.ok) {
  console.error(`\n✗ intake rails failed — NOT writing:\n`);
  for (const f of rails.failures) console.error("   •", f);
  console.error("");
  process.exit(1);
}

if (WRITE) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(INVENTORY, JSON.stringify({
    generatedAt: new Date().toISOString().slice(0, 10),
    note: "Discovered by scripts/discover-pathways.js. `kind` is classified from " +
          "the fetched page, not the URL. A `pathway` page with no pathway file is " +
          "work to do; see docs/plusone-intake-design.md.",
    hosts: swept.map(s => ({ host: s.host, urls: s.total, candidates: s.candidates.length })),
    entries: entries.map(({ signals, ...rest }) => rest),
  }, null, 1) + "\n");
  console.log(`✓ wrote ${INVENTORY.replace(ROOT + "/", "")}` +
              (NO_FETCH ? "" : ` and ${entries.length - bad.length} cached pages`));
} else {
  console.log("\n(dry run — pass --write to emit the inventory and page cache)");
}

function walkJson(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name.startsWith("_")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkJson(p));
    else if (name.endsWith(".json")) out.push(p);
  }
  return out;
}

function normalise(u) {
  return String(u).replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "").toLowerCase();
}
