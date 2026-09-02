#!/usr/bin/env node
/**
 * verify-majors.js
 *
 * Cross-checks every scraped program against the evidence recorded alongside
 * it, and ratchets: a run may improve, never regress.
 *
 * Sibling to check-major-integrity.js, not a replacement. That script asks one
 * internal question (is every section still satisfiable after allocation?);
 * this one asks whether the data still agrees with the catalog it came from.
 * They keep separate baselines on purpose — the integrity baseline is empty
 * and worth defending as such.
 *
 * Usage:
 *   node scripts/verify-majors.js              # verify against the baseline (exit 1 on regression)
 *   node scripts/verify-majors.js --report     # + write docs/verification-report.md
 *   node scripts/verify-majors.js --write      # + write metadata.verification into each program
 *   node scripts/verify-majors.js --update     # rewrite the baseline from current state
 *   node scripts/verify-majors.js --list       # print every discrepancy and exit 0
 *   node scripts/verify-majors.js --program <substring>   # inspect one program
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { verifyProgram, LEVELS, detailText } from './lib/major-verify.js';
import { impossibleSectionTitles } from './lib/major-integrity.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const TREES     = [join(ROOT, 'data/northeastern/programs/undergraduate'), join(ROOT, 'data/northeastern/programs/graduate')];
// catalog-courses.json, NOT all-courses.json. The finding this feeds says a
// requirement "can't be ticked off in the planner", so it must be checked
// against the file the planner actually loads (per CLAUDE.md: the browser app,
// the Node MCP server and the Cloudflare worker all read catalog-courses.json;
// all-courses.json is only the scrape intermediate). Reading the intermediate
// meant reporting CS 4991 as untickable while the app could tick it fine.
const COURSES   = join(ROOT, 'public/northeastern/catalog-courses.json');
const BASELINE  = join(ROOT, 'scripts/major-verify-baseline.json');
const POLICY    = join(ROOT, 'scripts/major-verify-policy.json');
const REPORT    = join(ROOT, 'docs/verification-report.md');

const UPDATE  = process.argv.includes('--update');
const LIST    = process.argv.includes('--list');
const REPORTF = process.argv.includes('--report');
const WRITE   = process.argv.includes('--write');
const ONE     = (() => { const i = process.argv.indexOf('--program'); return i >= 0 ? process.argv[i + 1] : null; })();

// ── Load inputs ───────────────────────────────────────────────────────────────

function walkJson(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkJson(p, out);
    else if (e === 'requirements.json') out.push(p);
  }
  return out;
}

function courseIndex() {
  if (!existsSync(COURSES)) return null;
  try {
    const set = new Set();
    for (const c of JSON.parse(readFileSync(COURSES, 'utf8'))) {
      set.add(`${(c.subject ?? '').toUpperCase().trim()}${parseInt(c.number, 10)}`);
    }
    return set;
  } catch { return null; }
}

const policy   = existsSync(POLICY)   ? JSON.parse(readFileSync(POLICY, 'utf8'))   : {};
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { programs: {}, totals: {} };

// ── Verify every program ──────────────────────────────────────────────────────

export function verifyAll() {
  const index = courseIndex();
  const results = [];

  for (const tree of TREES) {
    for (const file of walkJson(tree)) {
      const id = relative(join(ROOT, 'data/northeastern/programs'), file).replace(/\/requirements\.json$/, '');
      if (ONE && !id.includes(ONE)) continue;
      let program;
      try { program = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }

      const v = verifyProgram({ program, id, courseIndex: index, policy });

      // Fold in the satisfiability invariant so the report is one document.
      const impossible = impossibleSectionTitles(program);
      if (impossible.length) {
        v.discrepancies.unshift({
          check: 'internal-satisfiability', severity: 'high',
          message: `${impossible.length} section(s) can never be completed as written`,
          detail: impossible.slice(0, 12).map(t => ({ key: 'impossibleSection', params: { title: t } })),
        });
        v.counters.impossibleSections = impossible.length;
        v.level = 'review';
      } else {
        v.counters.impossibleSections = 0;
      }

      results.push({ id, file, name: program.name, ...v });
    }
  }
  return results;
}

// ── Ratchet ───────────────────────────────────────────────────────────────────

const COUNTERS = ['tablesUnaccounted', 'leakedMarkers', 'unknownCourses',
                  'planUnexplained', 'duplicateSectionTitles', 'impossibleSections', 'zeroTotal'];

// A program id carries the catalog EDITION:
// `undergraduate/2026/engineering/computer_engineering_bs`.
const EDITION_ID = /^(.+?)\/(\d{4})\/(.+)$/;

/** tree+college+folder → the newest edition of it the baseline knows. */
function newestByShape(programs) {
  const byShape = new Map();
  for (const [id, entry] of Object.entries(programs ?? {})) {
    const m = EDITION_ID.exec(id);
    if (!m) continue;
    const key = `${m[1]}/${m[3]}`;
    const year = Number(m[2]);
    const prev = byShape.get(key);
    if (!prev || year > prev.year) byShape.set(key, { year, id, entry });
  }
  return byShape;
}

/**
 * The ratchet: no program may verify WORSE than the baseline says it did.
 *
 * ── Why the edition fallback exists ─────────────────────────────────────────
 *
 * Because the id carries the year, the first scrape of a new catalog edition
 * presents every program under an id the baseline has never seen — and the
 * `!base → continue` that follows meant no level was compared and no counter
 * was checked. The ratchet switched itself OFF for the single run in which the
 * parser meets markup nobody has looked at yet, which is the run it exists for.
 * NEU rolled to the 2027 edition on 2026-09-01, so that run is the next one.
 *
 * A program with no entry for its own year is therefore compared against the
 * newest EARLIER edition of the same college/folder. That is strict on purpose:
 * across an edition the input changed as well as nothing else, so a difference
 * may be NEU restructuring a degree rather than us parsing it worse — and
 * telling those apart is a judgement, which is exactly what should happen once,
 * by a person, on the roll. Refusing costs a cycle's delay and says so loudly;
 * shipping an unratcheted edition costs a wrong degree plan and says nothing.
 *
 * `base` is a parameter so this can be tested against a fixture rather than
 * against whatever is committed.
 */
export function compareToBaseline(results, base = baseline) {
  const programs = base?.programs ?? {};
  const byShape = newestByShape(programs);
  const regressions = [];

  for (const r of results) {
    let entry = programs[r.id];
    let against = null;

    if (!entry) {
      const m = EDITION_ID.exec(r.id);
      const alt = m ? byShape.get(`${m[1]}/${m[3]}`) : null;
      if (alt && alt.id !== r.id) { entry = alt.entry; against = alt.id; }
    }
    if (!entry) {
      if (r.level === 'review') regressions.push(`NEW program at 'review': ${r.id}`);
      continue;
    }

    const where = against ? `${r.id} (vs ${against})` : r.id;
    if (LEVELS.indexOf(r.level) > LEVELS.indexOf(entry.level)) {
      regressions.push(`${where}: level ${entry.level} → ${r.level}`);
    }
    for (const c of COUNTERS) {
      const before = entry.counters?.[c] ?? 0, after = r.counters?.[c] ?? 0;
      if (after > before) regressions.push(`${where}: ${c} ${before} → ${after}`);
    }
  }
  return regressions;
}

const tally = results => Object.fromEntries(
  LEVELS.map(l => [l, results.filter(r => r.level === l).length]));

// ── Report ────────────────────────────────────────────────────────────────────

function writeReport(results) {
  const totals = tally(results);
  const byCheck = new Map();
  for (const r of results) {
    for (const d of r.discrepancies) {
      if (!byCheck.has(d.check)) byCheck.set(d.check, { severity: d.severity, programs: [] });
      byCheck.get(d.check).programs.push(r);
    }
  }
  const groups = [...byCheck.entries()].sort((a, b) => b[1].programs.length - a[1].programs.length);

  const lines = [];
  lines.push('# Major verification report');
  lines.push('');
  lines.push(`Generated ${new Date().toISOString().slice(0, 10)} by \`npm run data:verify\`.`);
  lines.push('');
  lines.push('> **What this can and cannot tell you.** There is no second authoritative');
  lines.push('> source for Northeastern degree requirements — Degree Works and the');
  lines.push('> CourseLeaf admin are SSO-gated, Banner exposes no program endpoints, and');
  lines.push('> the per-page PDF is the same render as the HTML. These checks confirm we');
  lines.push('> parsed the catalog faithfully. They cannot confirm the catalog is right.');
  lines.push('');
  lines.push(`**${results.length} programs** — ` +
             LEVELS.map(l => `${totals[l]} ${l}`).join(' · '));
  lines.push('');
  lines.push('## Findings by root cause');
  lines.push('');
  lines.push('Grouped by check rather than by program: one parser bug usually wears many');
  lines.push('names, and a list of every affected program is not a work order.');
  lines.push('');
  for (const [check, { severity, programs }] of groups) {
    lines.push(`### \`${check}\` · ${programs.length} program(s) · ${severity}`);
    lines.push('');
    lines.push(programs[0].discrepancies.find(d => d.check === check).message);
    lines.push('');
    for (const p of programs.slice(0, 10)) lines.push(`- ${p.name} — \`${p.id}\``);
    if (programs.length > 10) lines.push(`- …and ${programs.length - 10} more`);
    lines.push('');
  }
  if (!groups.length) lines.push('No discrepancies. Every applicable check passes on every program.\n');

  writeFileSync(REPORT, lines.join('\n'), 'utf8');
  console.log(`Report → ${relative(ROOT, REPORT)}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const results = verifyAll();
  const totals  = tally(results);

  console.log(`\nVerified ${results.length} programs:`);
  for (const l of LEVELS) console.log(`  ${l.padEnd(11)} ${totals[l]}`);

  const flagged = results.filter(r => r.discrepancies.length);
  console.log(`  ${'with issues'.padEnd(11)} ${flagged.length}`);

  if (LIST || ONE) {
    for (const r of flagged.sort((a, b) => a.score - b.score)) {
      console.log(`\n${r.id}  [${r.level}, score ${r.score}]`);
      for (const d of r.discrepancies) {
        console.log(`   ${d.severity.padEnd(6)} ${d.check}: ${d.message}`);
        if (d.detail?.length) for (const x of d.detail) console.log(`            ${detailText(x)}`);
      }
    }
    if (!UPDATE && !REPORTF && !WRITE) return 0;
  }

  if (WRITE) {
    for (const r of results) {
      const program = JSON.parse(readFileSync(r.file, 'utf8'));
      program.metadata = program.metadata ?? {};
      program.metadata.verified = r.level === 'verified';
      program.metadata.verification = {
        level: r.level, kind: r.kind, score: r.score, checkedAt: new Date().toISOString().slice(0, 10),
        // Surfaced so the badge can link straight to the page it was read from.
        ...(program.metadata?.sourceUrl ? { sourceUrl: program.metadata.sourceUrl } : {}),
        sourcesAvailable: r.sourcesAvailable, counters: r.counters,
        // Keep `detail` — it names the specific courses or titles that caused
        // the finding, which is what makes the popover actionable rather than
        // just declarative. Capped at 6 for the shipped file; the full list
        // stays in the report.
        discrepancies: r.discrepancies.map(({ check, severity, message, detail, overflow }) => ({
          check, severity, message,
          ...(detail?.length ? { detail: detail.slice(0, 6),
                                 overflow: (overflow ?? 0) + Math.max(0, detail.length - 6) } : {}),
        })),
      };
      writeFileSync(r.file, JSON.stringify(program, null, 2), 'utf8');
    }
    console.log(`\nWrote metadata.verification into ${results.length} program files.`);
  }

  if (REPORTF) writeReport(results);

  if (UPDATE) {
    const out = {
      generatedAt: new Date().toISOString().slice(0, 10),
      totals,
      programs: Object.fromEntries(results.map(r => [r.id, { level: r.level, counters: r.counters }])),
    };
    writeFileSync(BASELINE, JSON.stringify(out, null, 2) + '\n', 'utf8');
    console.log(`\nBaseline updated → ${relative(ROOT, BASELINE)}`);
    return 0;
  }

  const regressions = compareToBaseline(results);
  if (regressions.length) {
    console.error(`\n❌  ${regressions.length} regression(s) against the baseline:\n`);
    for (const r of regressions.slice(0, 40)) console.error(`   ${r}`);
    if (regressions.length > 40) console.error(`   …and ${regressions.length - 40} more`);
    if (regressions.some(r => r.includes(' (vs '))) {
      console.error(`\n    The "(vs …)" lines compare a NEW catalog edition against the previous`);
      console.error(`    one, because the baseline has no entry for this year. Expect some: NEU`);
      console.error(`    restructures degrees between editions, and that reads the same as a`);
      console.error(`    parser regression from here. Read them before accepting them — this is`);
      console.error(`    the one moment a person is meant to look at a new edition.`);
    }
    console.error(`\n    If these changes are intended, run:  node scripts/verify-majors.js --update\n`);
    return 1;
  }

  console.log('\n✅  No regressions against the baseline.');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
