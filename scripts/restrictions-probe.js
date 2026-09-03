#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// RESTRICTIONS PROBE — what is actually on Banner's getRestrictions page?
//
// scrape-availability.js has fetched that page once per CRN since Aug 2026, and
// `classesOf` in lib/class-standing.js keeps only the heading matching
// /following Classes:$/. Everything else — Levels, Majors, Colleges, whatever
// else NEU publishes — is parsed and discarded. The HTTP cost is already sunk;
// the loss is a nine-line filter.
//
// Nobody has ever looked at the discarded part, so before widening the scrape
// we do not know:
//
//   1. which restriction KINDS this registrar actually uses, or at what rate;
//   2. whether `parseRestrictions` even works on them (it has only ever been
//      exercised against Classes — a kind that renders differently returns {}
//      SILENTLY, which is the worst possible failure here);
//   3. the code vocabulary per kind, which decides whether a Banner-code →
//      programId mapping is a 15-entry hand table or an open-ended problem;
//   4. whether a restriction is stable ACROSS SECTIONS and ACROSS TERMS, which
//      is the only thing that could ever license gating on one.
//
// This script answers those four and writes nothing outside the cache. It runs
// `parseRestrictions` UNCHANGED — the point is to measure the parser we have,
// not a better one.
//
// ── SAMPLING IS STRATIFIED, on purpose ─────────────────────────────
//
// A uniform CRN sample answers (1) and (3) but is nearly useless for (4):
// 71.8% of fully-gated course-terms in the corpus have exactly one section, so
// a uniform draw is mostly singletons and "every section agrees" is a census of
// one. So half the budget goes to courses with >= 2 sections, taking ALL of
// their sections, and half to a uniform draw for breadth. Same reasoning as
// chart-sample.js: selecting for the rare stratum is what buys detection power.
//
// ── THE CACHE IS THE POINT, almost as much as the numbers ──────────
//
// Every page fetched is written to .cache/banner/restrictions/<term>/<crn>.html.
// `--replay` then re-runs the whole analysis with zero Banner traffic. There is
// no raw Banner cache anywhere else in this repo, which is why widening the
// parser currently costs a ~30-minute re-fetch per term. This makes the SECOND
// question about restrictions free.
//
// ── USAGE ──────────────────────────────────────────────────────────
//
//   node scripts/restrictions-probe.js                     newest completed term
//   node scripts/restrictions-probe.js --term=202530
//   node scripts/restrictions-probe.js --terms=202510,202530   cross-term
//   node scripts/restrictions-probe.js --sample=400
//   node scripts/restrictions-probe.js --replay            cache only, no network
//   node scripts/restrictions-probe.js --dump=20           print raw page samples
//
// Exits 0 on a clean run. Exits 3 if any sampled page failed to parse into at
// least one heading while its raw HTML clearly contained one — that is the
// silent-{} failure in (2) above, and it must be loud.
// ═══════════════════════════════════════════════════════════════════

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join }                                          from "node:path";
import { fileURLToPath }                                                   from "node:url";

import { parseRestrictions } from "./lib/class-standing.js";
import {
  BASE, getTermList, openTerm, fetchPage, fetchRetry,
  cookieHeader, updateJar, sleep,
} from "./lib/banner-session.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, "..");
const CACHE     = resolve(ROOT, ".cache/banner/restrictions");

const DELAY_MS = parseInt(process.env.BANNER_DELAY_MS || "500", 10);
const RESTR_DELAY_MS = parseInt(process.env.BANNER_RESTR_DELAY_MS || "250", 10);

// ── Args ─────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  const eq = hit.indexOf("=");
  return eq === -1 ? true : hit.slice(eq + 1);
};
const REPLAY  = !!flag("replay", false);
const SAMPLE  = parseInt(flag("sample", "400"), 10);
const DUMP    = parseInt(flag("dump", "0"), 10);
const TERMS   = String(flag("terms", flag("term", "")) || "")
  .split(",").map(s => s.trim()).filter(Boolean);

// ── Heading grammar ──────────────────────────────────────────────
//
// Banner writes "Must be enrolled in one of the following Majors:" and
// "Cannot be enrolled in one of the following Classes:". We want the KIND
// (the trailing noun) and the POLARITY separately — the kind is what we are
// cataloguing, and the polarity flips the fold (a positive unions across
// sections, a negative only binds when every section carries it).

/**
 * @returns {{kind: string, polarity: "must"|"not"|"info"}|null}
 *
 * `info` is for a heading that carries no enrolment verb at all — measured:
 * "Special Approvals:" with the value "Advisor's Signature", on 15% of the
 * first sample. It is not a gate on who may enrol, it is a statement that a
 * human has to sign, so folding it in with must/not would be a category error.
 * It is also the registrar's own machine-readable "check with your advisor".
 */
export function splitHeading(head) {
  const s = String(head ?? "").trim();
  const m = /^(Must|Cannot|May not)\b.*?following\s+(.+?):$/i.exec(s);
  if (m) return { kind: m[2].trim(), polarity: /^Must/i.test(m[1]) ? "must" : "not" };
  // A bare "Noun:" heading. parseRestrictions already required the colon, so
  // this is the shape every non-gate heading takes.
  const bare = /^([A-Z][A-Za-z /&'-]*):$/.exec(s);
  if (bare) return { kind: bare[1].trim(), polarity: "info" };
  return null;
}

/**
 * Coalesce Banner's `detail-popup-indentation` spans into logical values.
 *
 * ── MEASURED, and a real defect in `parseRestrictions` ─────────────
 *
 * Banner emits one value per span EXCEPT that it splits a label at its commas:
 *
 *     <span …>Toronto</span>  <span …> Canada (TOR)</span>
 *     <span …>Politics</span> <span …> Phil &amp; Econ/Bus Adm (PPBA)</span>
 *
 * Those are ONE campus and ONE major. `parseRestrictions` returns each span as
 * its own value, which inflates every value count and invents a codeless
 * phantom ("Toronto", "Politics") beside a mislabelled real one ("Canada (TOR)").
 *
 * It has been latent because Classes labels never contain a comma, and it does
 * NOT corrupt the shipped `std` data: `standingKey` extracts `(XX)` per value
 * and unions, so the codeless fragment is simply dropped. But it makes any
 * other kind unreadable, so it must be fixed in the parser before a widened
 * scrape stores anything.
 *
 * Rule: a value continues until the span that carries a trailing `(CODE)`.
 * A run that ends without one is emitted as-is — that is the `Special Approvals`
 * case ("Advisor's Signature"), which legitimately has no code.
 *
 * @param {string[]} spans
 * @returns {string[]} logical values
 */
export function coalesceValues(spans) {
  const out = [];
  let buf = [];
  for (const raw of spans ?? []) {
    const s = decodeEntities(String(raw ?? "")).trim();
    if (!s) continue;
    buf.push(s);
    if (/\([A-Za-z0-9._-]{1,12}\)$/.test(s)) { out.push(buf.join(", ")); buf = []; }
  }
  if (buf.length) out.push(buf.join(", "));
  return out;
}

/** Banner double-escapes into JSON; `D&#39;Amore` and `&amp;` both occur. */
export function decodeEntities(s) {
  return String(s ?? "")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&quot;/g, '"').replace(/&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** The parenthesised code in a Banner restriction value, or null. */
export function codeOf(value) {
  const m = /\(\s*([A-Za-z0-9._-]{1,12})\s*\)\s*$/.exec(String(value ?? "").trim());
  return m ? m[1].toUpperCase() : null;
}

/** A value's human label, with the trailing code stripped. */
export function labelOf(value) {
  return String(value ?? "").replace(/\s*\([A-Za-z0-9._-]{1,12}\)\s*$/, "").trim();
}

// ── Cache ────────────────────────────────────────────────────────

const pagePath = (term, crn) => join(CACHE, String(term), `${crn}.html`);

function cacheWrite(term, crn, html) {
  const p = pagePath(term, crn);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, html);
}

function cacheRead(term, crn) {
  const p = pagePath(term, crn);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

function cachedCrns(term) {
  const dir = join(CACHE, String(term));
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith(".html")).map(f => f.slice(0, -5));
}

// ── Section inventory ────────────────────────────────────────────

/**
 * Paginate a term and return `Map<courseId, string[]>` of CRNs per course.
 * This is the only bulk traffic the probe generates: ~15 pages for a 7.4k
 * section term, about 15 seconds at the default pacing.
 */
async function inventory(termCode) {
  await openTerm(termCode, DELAY_MS);
  const byCourse = new Map();
  let offset = 0, total = null;
  while (true) {
    const data = await fetchPage(termCode, offset);
    if (!data?.success) throw new Error(`searchResults refused for ${termCode}`);
    total ??= data.totalCount;
    const rows = data.data ?? [];
    if (!rows.length) break;
    for (const s of rows) {
      const id = `${(s.subject || "").toUpperCase().trim()}${(s.courseNumber || "").trim()}`;
      if (!id || !s.courseReferenceNumber) continue;
      if (!byCourse.has(id)) byCourse.set(id, []);
      byCourse.get(id).push(String(s.courseReferenceNumber));
    }
    offset += rows.length;
    if (total != null && offset >= total) break;
    await sleep(DELAY_MS);
  }
  if (total === 0) {
    // The documented Banner flake: success:true, totalCount:0 on a term that
    // really has thousands of sections. Refuse rather than report "no data".
    throw new Error(`${termCode} returned totalCount 0 — Banner flake, re-run`);
  }
  return byCourse;
}

/**
 * Choose which CRNs to fetch: half the budget on multi-section courses (all
 * their sections, so within-course agreement is measurable), half uniform.
 * Deterministic given the inventory — no RNG, so two runs compare cleanly.
 */
export function chooseCrns(byCourse, budget) {
  const multi = [...byCourse.entries()].filter(([, c]) => c.length >= 2)
    .sort((a, b) => a[0].localeCompare(b[0]));
  const all   = [...byCourse.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const picked = new Map();  // courseId → crns
  let used = 0;

  // Stratum A — multi-section courses, spread across the alphabet by striding
  // rather than taking the first N (ARCH/ARTG would otherwise dominate).
  const half = Math.floor(budget / 2);
  if (multi.length) {
    const stride = Math.max(1, Math.floor(multi.length / Math.max(1, half / 3)));
    for (let i = 0; i < multi.length && used < half; i += stride) {
      const [id, crns] = multi[i];
      const take = crns.slice(0, 8);   // a 21-section course would eat the budget
      picked.set(id, take);
      used += take.length;
    }
  }

  // Stratum B — uniform breadth, one CRN per course.
  const strideB = Math.max(1, Math.floor(all.length / Math.max(1, budget - used)));
  for (let i = 0; i < all.length && used < budget; i += strideB) {
    const [id, crns] = all[i];
    if (picked.has(id)) continue;
    picked.set(id, [crns[0]]);
    used += 1;
  }
  return { picked, used };
}

// ── Fetch ────────────────────────────────────────────────────────

async function fetchRestrictions(termCode, crn) {
  const res = await fetchRetry(
    `${BASE}/searchResults/getRestrictions?term=${termCode}&courseReferenceNumber=${crn}`,
    { headers: { "Cookie": cookieHeader() } }
  );
  updateJar(res);
  return await res.text();
}

/**
 * Gather `{courseId, crn, html}` for one term, from cache when present.
 * In `--replay` the cache IS the sample — no inventory call, no network.
 */
async function gather(termCode) {
  if (REPLAY) {
    const crns = cachedCrns(termCode);
    if (!crns.length) throw new Error(`--replay but nothing cached for ${termCode}`);
    // Course identity is not in the cache; replay answers the kind/vocabulary
    // questions, and the per-course ones are reported as unavailable.
    return crns.map(crn => ({ courseId: null, crn, html: cacheRead(termCode, crn) }));
  }

  process.stdout.write(`  inventory ${termCode}…\n`);
  const byCourse = await inventory(termCode);
  const { picked, used } = chooseCrns(byCourse, SAMPLE);
  const courses = byCourse.size;
  process.stdout.write(
    `    ${courses} courses, ${[...byCourse.values()].reduce((a, c) => a + c.length, 0)} sections` +
    ` → sampling ${used} CRNs across ${picked.size} courses\n`
  );

  const out = [];
  let n = 0;
  for (const [courseId, crns] of picked) {
    for (const crn of crns) {
      let html = cacheRead(termCode, crn);
      if (html == null) {
        html = await fetchRestrictions(termCode, crn);
        cacheWrite(termCode, crn, html);
        await sleep(RESTR_DELAY_MS);
      }
      out.push({ courseId, crn, html });
      if (++n % 100 === 0) process.stdout.write(`    …${n}/${used}\n`);
    }
  }
  return out;
}

// ── Analysis ─────────────────────────────────────────────────────

const pct = (n, d) => d ? `${(100 * n / d).toFixed(1)}%` : "—";

export function analyse(termCode, pages) {
  // Per-kind tallies
  const kinds = new Map();   // "Majors|must" → {pages, values:Map<code,{label,n}>, sizes:[]}
  const perPage = [];        // {courseId, crn, blocks: [{kind, polarity, codes[]}]}
  let withAny = 0, unparsed = 0;
  const unparsedEx = [];
  const unknownHeadings = new Map();

  for (const { courseId, crn, html } of pages) {
    const parsed = parseRestrictions(html);
    const heads = Object.keys(parsed);
    const blocks = [];

    for (const head of heads) {
      const split = splitHeading(head);
      if (!split) { unknownHeadings.set(head, (unknownHeadings.get(head) ?? 0) + 1); continue; }
      const key = `${split.kind}|${split.polarity}`;
      const slot = kinds.get(key) ?? { pages: 0, values: new Map(), sizes: [], rawSizes: [] };
      slot.pages += 1;
      // Both counts, so the report can show how much the comma-split inflated
      // the naive one — that difference IS the parser defect, quantified.
      const values = coalesceValues(parsed[head]);
      slot.rawSizes.push(parsed[head].length);
      slot.sizes.push(values.length);
      const codes = [];
      for (const v of values) {
        const code = codeOf(v) ?? `«${labelOf(v)}»`;
        codes.push(code);
        const rec = slot.values.get(code) ?? { label: labelOf(v), n: 0 };
        rec.n += 1;
        slot.values.set(code, rec);
      }
      kinds.set(key, slot);
      blocks.push({ ...split, codes: codes.sort() });
    }

    if (blocks.length) withAny += 1;

    // (2) the silent-{} check: the raw page clearly carries a heading but the
    // parser produced nothing. This is the failure that would ship in silence.
    const looksLikeHeading = /following\s+[A-Za-z ]+:\s*<\/span>/i.test(html);
    if (looksLikeHeading && !heads.length) {
      unparsed += 1;
      if (unparsedEx.length < 5) unparsedEx.push({ crn, snippet: html.replace(/\s+/g, " ").slice(0, 240) });
    }

    perPage.push({ courseId, crn, blocks });
  }

  return { termCode, pages, kinds, perPage, withAny, unparsed, unparsedEx, unknownHeadings };
}

function reportTerm(a) {
  const n = a.pages.length;
  console.log(`\n══ ${a.termCode} — ${n} sections sampled ══`);
  console.log(`  sections carrying at least one restriction: ${a.withAny} (${pct(a.withAny, n)})`);

  if (!a.kinds.size) { console.log("  NO restriction blocks parsed at all."); return; }

  console.log(`\n  KIND HISTOGRAM  (the question this probe exists for)`);
  const rows = [...a.kinds.entries()].sort((x, y) => y[1].pages - x[1].pages);
  const POL = { must: "must  ", not: "CANNOT", info: "info  " };
  let inflated = 0;
  for (const [key, slot] of rows) {
    const [kind, polarity] = key.split("|");
    const sizes = slot.sizes.slice().sort((p, q) => p - q);
    const med = sizes[Math.floor(sizes.length / 2)];
    const rawTot = slot.rawSizes.reduce((x, y) => x + y, 0);
    const tot    = slot.sizes.reduce((x, y) => x + y, 0);
    inflated += rawTot - tot;
    console.log(
      `    ${POL[polarity] ?? polarity} ${kind.padEnd(18)}` +
      ` ${String(slot.pages).padStart(5)} sections (${pct(slot.pages, n).padStart(6)})` +
      `  ${String(slot.values.size).padStart(4)} distinct codes` +
      `  values/block med ${med}, max ${sizes[sizes.length - 1]}` +
      (rawTot > tot ? `   [${rawTot - tot} comma-split spans coalesced]` : "")
    );
  }
  if (inflated) {
    console.log(`\n  ⚠ parseRestrictions over-counted ${inflated} values on this sample by`);
    console.log(`    splitting labels at their commas. Must be fixed before any widened`);
    console.log(`    scrape stores a non-Classes kind. (Shipped \`std\` is unaffected —`);
    console.log(`    standingKey drops the codeless fragment.)`);
  }

  console.log(`\n  CODE VOCABULARY  (is a mapping table feasible?)`);
  for (const [key, slot] of rows) {
    const [kind, polarity] = key.split("|");
    const top = [...slot.values.entries()].sort((x, y) => y[1].n - x[1].n);
    const shown = top.slice(0, 8).map(([c, r]) => `${c}${r.label ? `=${r.label}` : ""}`).join(", ");
    console.log(`    ${kind} (${polarity}): ${slot.values.size} codes — ${shown}${top.length > 8 ? ", …" : ""}`);
  }

  // (4a) within-course agreement, the stratum A payoff
  const byCourse = new Map();
  for (const p of a.perPage) {
    if (!p.courseId) continue;
    if (!byCourse.has(p.courseId)) byCourse.set(p.courseId, []);
    byCourse.get(p.courseId).push(p);
  }
  const multi = [...byCourse.entries()].filter(([, ps]) => ps.length >= 2);
  if (multi.length) {
    const sig = (p) => p.blocks.map(b => `${b.polarity}:${b.kind}=${b.codes.join("+")}`).sort().join(" | ");
    let same = 0, differ = 0, partial = 0;
    const differEx = [];
    for (const [id, ps] of multi) {
      const sigs = new Set(ps.map(sig));
      const anyEmpty = ps.some(p => !p.blocks.length);
      const allEmpty = ps.every(p => !p.blocks.length);
      if (sigs.size === 1) same += 1;
      else {
        differ += 1;
        if (anyEmpty && !allEmpty) partial += 1;
        if (differEx.length < 6) differEx.push(`${id}: ${[...sigs].map(s => s || "(none)").join("   ≠   ")}`);
      }
    }
    console.log(`\n  WITHIN-COURSE AGREEMENT  (${multi.length} courses with >= 2 sections sampled)`);
    console.log(`    all sections identical: ${same} (${pct(same, multi.length)})`);
    console.log(`    sections DISAGREE:      ${differ} (${pct(differ, multi.length)})` +
                `  — of which ${partial} have some section with no restriction at all`);
    differEx.forEach(e => console.log(`      ≠ ${e}`));
  } else {
    console.log(`\n  WITHIN-COURSE AGREEMENT — unavailable (no multi-section course sampled${REPLAY ? "; --replay loses course identity" : ""})`);
  }

  if (a.unknownHeadings.size) {
    console.log(`\n  HEADINGS THE GRAMMAR DID NOT RECOGNISE`);
    for (const [h, c] of [...a.unknownHeadings].sort((x, y) => y[1] - x[1]).slice(0, 10))
      console.log(`    ${c}×  ${JSON.stringify(h)}`);
  }

  if (a.unparsed) {
    console.log(`\n  ⚠ SILENT PARSE FAILURES: ${a.unparsed} pages contain "following …:" but parsed to {}`);
    a.unparsedEx.forEach(e => console.log(`      CRN ${e.crn}: ${e.snippet}`));
  }
}

/** (4b) cross-term stability — the number that decides whether anything may gate. */
function reportCrossTerm(analyses) {
  const withIds = analyses.filter(a => a.perPage.some(p => p.courseId));
  if (withIds.length < 2) {
    console.log(`\n══ CROSS-TERM STABILITY ══\n  unavailable — need >= 2 terms with course identity`);
    return;
  }
  const sigOf = (a) => {
    const m = new Map();
    for (const p of a.perPage) {
      if (!p.courseId) continue;
      const s = p.blocks.map(b => `${b.polarity}:${b.kind}=${b.codes.join("+")}`).sort().join(" | ");
      if (!m.has(p.courseId)) m.set(p.courseId, new Set());
      m.get(p.courseId).add(s);
    }
    return m;
  };
  const [A, B] = withIds.map(sigOf);
  const shared = [...A.keys()].filter(id => B.has(id));
  let same = 0, differ = 0, appeared = 0, vanished = 0;
  const ex = [];
  for (const id of shared) {
    const a = [...A.get(id)].sort().join(" ;; ");
    const b = [...B.get(id)].sort().join(" ;; ");
    if (a === b) same += 1;
    else {
      differ += 1;
      if (!a.replace(/[\s;]/g, "") && b.replace(/[\s;]/g, "")) appeared += 1;
      if (a.replace(/[\s;]/g, "") && !b.replace(/[\s;]/g, "")) vanished += 1;
      if (ex.length < 8) ex.push(`${id}: [${withIds[0].termCode}] ${a || "(none)"}   →   [${withIds[1].termCode}] ${b || "(none)"}`);
    }
  }
  console.log(`\n══ CROSS-TERM STABILITY  (${withIds[0].termCode} vs ${withIds[1].termCode}) ══`);
  console.log(`  courses sampled in both terms: ${shared.length}`);
  console.log(`    identical restrictions: ${same} (${pct(same, shared.length)})`);
  console.log(`    changed:                ${differ} (${pct(differ, shared.length)})` +
              `  — ${appeared} appeared from nothing, ${vanished} disappeared entirely`);
  ex.forEach(e => console.log(`      Δ ${e}`));
  console.log(`\n  This is the figure that decides whether a restriction may ever GATE.`);
  console.log(`  A restriction that changes term to term cannot be carried forward.`);
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  let terms = TERMS;
  if (!terms.length) {
    if (REPLAY) {
      terms = existsSync(CACHE) ? readdirSync(CACHE).filter(d => /^\d{6}$/.test(d)).sort() : [];
      if (!terms.length) { console.error("--replay with an empty cache and no --term"); process.exit(1); }
    } else {
      const list = await getTermList(30);
      // Newest term that is plausibly complete: skip the two most recent, which
      // Banner is usually still editing.
      terms = [list.map(t => t.code).sort().reverse()[2]].filter(Boolean);
    }
  }
  console.log(`restrictions-probe — terms ${terms.join(", ")}${REPLAY ? "  (replay, no network)" : ""}`);
  console.log(`cache: ${CACHE}`);

  const analyses = [];
  for (const t of terms) {
    const pages = await gather(t);
    const a = analyse(t, pages);
    reportTerm(a);
    analyses.push(a);
  }
  if (analyses.length >= 2) reportCrossTerm(analyses);

  if (DUMP) {
    console.log(`\n══ RAW PAGES (${DUMP}) ══`);
    const withBlocks = analyses[0].pages.filter(p => /following\s+[A-Za-z ]+:/i.test(p.html));
    for (const p of withBlocks.slice(0, DUMP)) {
      console.log(`\n--- CRN ${p.crn} (${p.courseId ?? "?"}) ---`);
      console.log(p.html.replace(/\s+/g, " ").trim().slice(0, 900));
    }
  }

  const broken = analyses.reduce((s, a) => s + a.unparsed, 0);
  if (broken) {
    console.error(`\nFAILED: ${broken} pages carry a heading the parser did not see.`);
    process.exit(3);
  }
  console.log(`\nOK — ${analyses.reduce((s, a) => s + a.pages.length, 0)} pages, no silent parse failures.`);
}

// Only run when invoked directly — the helpers above are imported by
// test/unit/restrictions-probe.test.js, and firing main() on import would
// mean a unit test hits Banner. Same guard as grad-probe.js:325.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err); process.exit(1); });
}
