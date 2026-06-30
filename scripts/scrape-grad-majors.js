#!/usr/bin/env node
/**
 * scrape-grad-majors.js
 *
 * Scrapes graduate (master's) program requirements from catalog.northeastern.edu
 * and outputs parsed.initial.json files in the Major2 schema used by
 * the graduation requirement panel.
 *
 * Uses the same HTML parsing logic as scrape-majors.js (undergrad), since
 * catalog.northeastern.edu renders graduate pages with the same structure.
 * Key differences: targets /graduate/ paths, lower credit minimum (20 vs 60),
 * and writes to src/data/grad-majors/ instead of src/data/majors/.
 *
 * Output: src/data/grad-majors/{year}/{college}/{slug}/parsed.initial.json
 *
 * Usage:
 *   node scripts/scrape-grad-majors.js               # preview (no writes)
 *   node scripts/scrape-grad-majors.js --write        # write output files
 *   node scripts/scrape-grad-majors.js --dry-run      # first 5 programs, no write
 *   node scripts/scrape-grad-majors.js --url <url>    # single program URL
 *   node scripts/scrape-grad-majors.js --year 2025    # override catalog year tag
 *
 * Rate limit: 600 ms between requests by default.
 * Override: GRAD_DELAY_MS=300 node scripts/scrape-grad-majors.js
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname }            from 'path';
import { fileURLToPath }            from 'url';
import { parse as parseHTML }       from 'node-html-parser';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const OUT_ROOT  = join(ROOT, 'src/data/grad-majors');
const CHANGE_LOG     = join(ROOT, 'public/northeastern/change-log.json');
const CHANGE_LOG_MAX = 600;
const BASE      = 'https://catalog.northeastern.edu';
const AZ_URL    = `${BASE}/azindex/`;
const DELAY_MS  = parseInt(process.env.GRAD_DELAY_MS ?? '600', 10);
const YEAR      = parseInt(process.env.GRAD_YEAR ?? String(new Date().getFullYear()), 10);

const WRITE   = process.argv.includes('--write');
const DRY_RUN = process.argv.includes('--dry-run');
const URL_ARG = (() => { const i = process.argv.indexOf('--url'); return i >= 0 ? process.argv[i + 1] : null; })();

// ── Utilities ─────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'nu-map-scraper/1.0 (educational planning tool; not for commercial use)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** "Computer Science, MS" → "computer_science_ms" */
function slugify(str) {
  return str.toLowerCase()
    .replace(/[,]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_()\-]/g, '')
    .replace(/_+/g, '_')
    .trim();
}

// ── Program list ──────────────────────────────────────────────────────────────

async function fetchProgramUrls() {
  console.log('Fetching graduate AZ index…');
  const html = await fetchPage(AZ_URL);
  const root = parseHTML(html);

  const seen     = new Set();
  const programs = [];

  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    if (!href.startsWith('/graduate/')) continue;

    // Graduate program pages have ≥4 path segments:
    // /graduate/{college}/{department}/{degree}/
    const parts = href.replace(/^\/|\/$/g, '').split('/');
    if (parts.length < 4) continue;

    const url = BASE + href;
    if (seen.has(url)) continue;
    seen.add(url);

    programs.push({
      url,
      college: parts[1],          // e.g. "khoury-college-computer-sciences"
      name:    a.text.trim(),
    });
  }

  console.log(`Found ${programs.length} graduate program URLs`);
  return programs;
}

// ── Credit helpers ────────────────────────────────────────────────────────────

function extractTotalCredits(root) {
  // Table-based total (some grad pages share the undergrad plangridtotal structure)
  for (const tr of root.querySelectorAll('tr.plangridtotal, tr.listsum, tr.total')) {
    const cells = tr.querySelectorAll('td');
    const cell = cells[cells.length - 1];
    if (!cell) continue;
    const text = cell.text.trim();
    const m = text.match(/(\d+)\s*$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > 20 && n < 150) return n;
    }
  }
  // Most grad pages use prose in a "Program Credit/GPA Requirements" section:
  // "32 total semester hours required" or "36-44 total semester hours required"
  const gradM = root.text.match(/(\d+)(?:-\d+)?\s+total\s+semester\s+hours/i);
  if (gradM) {
    const n = parseInt(gradM[1], 10);
    if (n > 20 && n < 150) return n;
  }
  // Fallback: undergrad-style "Total Hours: X"
  const legacyM = root.text.match(/[Tt]otal\s+[Hh]ours?[\s:]+(\d+)/);
  return legacyM ? parseInt(legacyM[1], 10) : 0;
}

function parseHoursCell(tr) {
  const cell = tr.querySelector('.hourscol');
  if (!cell) return 0;
  const n = parseInt(cell.text.trim(), 10);
  return isNaN(n) ? 0 : n;
}

// ── Course link parsing ───────────────────────────────────────────────────────

function parseCourseLink(a) {
  const text = a.text.trim();
  const m = text.match(/^([A-Z]{2,6})\s+(\d+[A-Z]?)$/);
  if (!m) return null;
  const num = parseInt(m[2], 10);
  if (isNaN(num)) return null;
  return { subject: m[1], classId: num };
}

function firstCourseLink(container) {
  for (const a of container.querySelectorAll('a')) {
    const c = parseCourseLink(a);
    if (c) return c;
  }
  return null;
}

// ── Range text parser ─────────────────────────────────────────────────────────

function parseRangeText(raw) {
  const text = raw.trim();

  const exceptions = [];
  const excMatch = text.match(/,?\s*except\s+(.*)/i);
  if (excMatch) {
    for (const chunk of excMatch[1].split(/,\s*/)) {
      const em = chunk.trim().match(/([A-Z]{2,6})\s+(\d+)/);
      if (em) exceptions.push({ type: 'COURSE', subject: em[1], classId: parseInt(em[2], 10) });
    }
  }
  const clean = text.replace(/,?\s*except.*/i, '').trim();

  let m = clean.match(/^([A-Z]{2,6})\s+(\d+)\s+(?:or\s+higher|and\s+above)/i);
  if (m) return { type: 'RANGE', subject: m[1], idRangeStart: parseInt(m[2], 10), idRangeEnd: 9999, exceptions };

  m = clean.match(/^([A-Z]{2,6})\s+(\d+)\s*[-–]\s*(\d+)/);
  if (m) return { type: 'RANGE', subject: m[1], idRangeStart: parseInt(m[2], 10), idRangeEnd: parseInt(m[3], 10), exceptions };

  m = clean.match(/^[Aa]ny\s+([A-Z]{2,6})\s+course/i);
  if (m) return { type: 'RANGE', subject: m[1], idRangeStart: 1000, idRangeEnd: 9999, exceptions };

  m = clean.match(/^([A-Z]{2,6})\s+(\d+)$/);
  if (m && exceptions.length) return { type: 'RANGE', subject: m[1], idRangeStart: parseInt(m[2], 10), idRangeEnd: 9999, exceptions };

  return null;
}

// ── Row group parser ──────────────────────────────────────────────────────────

function parseChooseInstruction(text) {
  const WORD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
  const m = text.match(/(?:complete|choose|select|take)\s+(\w+)\s+of/i);
  if (!m) return null;
  const w = m[1].toLowerCase();
  return WORD[w] ?? (parseInt(w, 10) || null);
}

function parseCreditInstruction(text) {
  const m = text.match(/(\d+)\s+(?:credit|semester)\s+hours?/i);
  return m ? parseInt(m[1], 10) : null;
}

function parseRowGroup(rows) {
  const requirements = [];

  let pending     = null;
  let inChoose    = false;
  let chooseItems = [];
  let chooseCreds = 0;
  let chooseCount = 0;

  function commitPending() {
    if (!pending) return;
    (inChoose ? chooseItems : requirements).push(pending);
    pending = null;
  }

  function commitChooseGroup() {
    if (!inChoose) return;
    inChoose = false;
    if (!chooseItems.length) { chooseItems = []; chooseCreds = 0; chooseCount = 0; return; }

    if (chooseCreds > 0) {
      if (chooseItems.length === 1 && chooseItems[0].type === 'COURSE') {
        requirements.push(chooseItems[0]);
      } else {
        requirements.push({ type: 'XOM', numCreditsMin: chooseCreds, courses: chooseItems });
      }
    } else if (chooseCount === 1 || chooseItems.length <= 2) {
      requirements.push({ type: 'OR', courses: chooseItems });
    } else {
      requirements.push({
        type: '_CHOOSE',
        minCount: chooseCount || chooseItems.length,
        courses: chooseItems,
      });
    }

    chooseItems = []; chooseCreds = 0; chooseCount = 0;
  }

  for (const tr of rows) {
    const cls = tr.getAttribute('class') ?? '';

    if (cls.includes('orclass')) {
      const codecol = tr.querySelector('td.codecol');
      if (!codecol) continue;
      const c = firstCourseLink(codecol);
      if (!c) continue;
      const node = { type: 'COURSE', ...c };

      if (pending?.type === 'COURSE' || pending?.type === 'AND') {
        pending = { type: 'OR', courses: [pending, node] };
      } else if (pending?.type === 'OR') {
        pending.courses.push(node);
      } else {
        const arr = inChoose ? chooseItems : requirements;
        const last = arr[arr.length - 1];
        if (last?.type === 'COURSE' || last?.type === 'AND') {
          arr[arr.length - 1] = { type: 'OR', courses: [last, node] };
        } else if (last?.type === 'OR') {
          last.courses.push(node);
        }
      }
      continue;
    }

    const codecol = tr.querySelector('td.codecol');

    if (codecol) {
      const isIndented = !!codecol.querySelector('div.blockindent');
      const container  = isIndented ? codecol.querySelector('div.blockindent') : codecol;
      const primary    = firstCourseLink(container);
      if (!primary) continue;

      const andCourses = [];
      for (const span of codecol.querySelectorAll('span.blockindent')) {
        const c = firstCourseLink(span);
        if (c) andCourses.push(c);
      }

      const node = andCourses.length
        ? { type: 'AND', courses: [{ type: 'COURSE', ...primary }, ...andCourses.map(c => ({ type: 'COURSE', ...c }))] }
        : { type: 'COURSE', ...primary };

      if (isIndented) {
        commitPending();
        if (!inChoose) inChoose = true;
        pending = node;
      } else {
        commitPending();
        if (inChoose) commitChooseGroup();
        pending = node;
      }
      continue;
    }

    const wide = tr.querySelector('td[colspan="2"]');
    if (!wide) continue;

    const rangeSpan = wide.querySelector('span.commentindent');
    if (rangeSpan) {
      const node = parseRangeText(rangeSpan.text.trim());
      if (node) {
        commitPending();
        (inChoose ? chooseItems : requirements).push(node);
      }
      continue;
    }

    const commentSpan = wide.querySelector('span.courselistcomment');
    if (commentSpan && !commentSpan.getAttribute('class')?.includes('areaheader')) {
      const text = commentSpan.text.trim();

      const credits = parseCreditInstruction(text);
      const count   = credits ? null : parseChooseInstruction(text);

      if (credits !== null || count !== null) {
        commitPending();
        commitChooseGroup();
        inChoose    = true;
        chooseCreds = credits ?? 0;
        chooseCount = count  ?? 0;
      }
      continue;
    }
  }

  commitPending();
  commitChooseGroup();

  return requirements.map(r => {
    if (r.type !== '_CHOOSE') return r;
    if (r.courses.length <= 2 || r.minCount === 1) return { type: 'OR', courses: r.courses };
    return { type: 'XOM', numCreditsMin: r.minCount * 4, courses: r.courses };
  });
}

// ── Table parser ──────────────────────────────────────────────────────────────

function parseTable(table, h2Title) {
  const rows = table.querySelectorAll('tr');

  const groups = [];
  let cur = null;

  for (const tr of rows) {
    const cls = tr.getAttribute('class') ?? '';
    if (cls.includes('hidden') && cls.includes('noscript')) continue;

    const isAreaHeader =
      cls.includes('areaheader') ||
      !!tr.querySelector('span.areaheader, span.courselistcomment.areaheader');

    if (isAreaHeader) {
      if (cur) groups.push(cur);
      const span    = tr.querySelector('span.areaheader, span.courselistcomment.areaheader');
      const title   = span?.text?.trim() ?? tr.text.trim().replace(/\s+/g, ' ');
      const credits = parseHoursCell(tr);
      cur = { title, creditHint: credits, rows: [] };
    } else {
      if (!cur) cur = { title: h2Title, creditHint: 0, rows: [] };
      cur.rows.push(tr);
    }
  }
  if (cur?.rows.length) groups.push(cur);

  if (!groups.length) return [];

  return groups.map(g => {
    const requirements = parseRowGroup(g.rows);
    if (!requirements.length) return null;

    if (g.creditHint > 0) {
      return {
        type: 'SECTION',
        title: g.title,
        requirements: [{ type: 'XOM', numCreditsMin: g.creditHint, courses: requirements }],
        minRequirementCount: 1,
      };
    }

    return {
      type: 'SECTION',
      title: g.title,
      requirements,
      minRequirementCount: requirements.length,
    };
  }).filter(Boolean);
}

// ── Full page parser ──────────────────────────────────────────────────────────

function parseRequirements(root) {
  const requirementSections = [];
  const concentrationOptions = [];
  let generalElectiveSH = 0;

  const blocks = root.querySelectorAll('h2, table.sc_courselist');
  let currentH2 = null;

  for (const el of blocks) {
    if (el.tagName === 'H2') {
      currentH2 = el.text.trim().replace(/\s+/g, ' ');
      continue;
    }

    if (!currentH2) continue;

    if (/^Concentration in /i.test(currentH2)) {
      const sections = parseTable(el, currentH2);
      if (sections.length === 1) concentrationOptions.push(sections[0]);
      currentH2 = null;
      continue;
    }

    if (/^Required General Electives/i.test(currentH2)) {
      for (const tr of el.querySelectorAll('tr')) {
        const sh = parseHoursCell(tr);
        if (sh > 0) { generalElectiveSH = sh; break; }
      }
      currentH2 = null;
      continue;
    }

    const sections = parseTable(el, currentH2);
    sections.forEach(s => { s._h2 = currentH2; });
    requirementSections.push(...sections);
    currentH2 = null;
  }

  const titleCount = {};
  requirementSections.forEach(s => { titleCount[s.title] = (titleCount[s.title] ?? 0) + 1; });
  requirementSections.forEach(s => {
    if (titleCount[s.title] > 1 && s._h2 && s._h2 !== s.title) {
      s.title = `${s.title} (${s._h2})`;
    }
    delete s._h2;
  });

  const concentrations = concentrationOptions.length
    ? { minOptions: 1, concentrationOptions }
    : null;

  return { requirementSections, concentrations, generalElectiveSH };
}

// ── Validate no internal markers escape into output ───────────────────────────
function findLeakedMarkers(obj, path = '') {
  if (!obj || typeof obj !== 'object') return [];
  const leaks = [];
  if (obj.type === '_CHOOSE') leaks.push(path);
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      v.forEach((item, i) => leaks.push(...findLeakedMarkers(item, `${path}.${k}[${i}]`)));
    } else if (v && typeof v === 'object') {
      leaks.push(...findLeakedMarkers(v, `${path}.${k}`));
    }
  }
  return leaks;
}

// ── Output path ───────────────────────────────────────────────────────────────

function outPath(college, slug) {
  return join(OUT_ROOT, String(YEAR), college, slug, 'parsed.initial.json');
}

// ── Scrape one program ────────────────────────────────────────────────────────

async function scrapeProgram(url) {
  const html = await fetchPage(url);
  const root = parseHTML(html);

  const name = root.querySelector('#page-title h1, h1.page-title, h1')
    ?.text?.trim()
    ?.replace(/\s+/g, ' ')
    ?? '';

  const totalCreditsRequired     = extractTotalCredits(root);
  const { requirementSections, concentrations, generalElectiveSH } = parseRequirements(root);

  if (!requirementSections.length) return null;

  return {
    name,
    metadata:  { verified: false, lastEdited: new Date().toLocaleDateString('en-US'), branch: 'main' },
    totalCreditsRequired,
    yearVersion: YEAR,
    requirementSections,
    ...(concentrations ? { concentrations } : {}),
    ...(generalElectiveSH > 0 ? { generalElectiveSH } : {}),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  let programs;

  if (URL_ARG) {
    const parts = URL_ARG.replace(BASE, '').replace(/^\/|\/$/g, '').split('/');
    programs = [{ url: URL_ARG, college: parts[1] ?? 'unknown', name: '' }];
  } else {
    programs = await fetchProgramUrls();
    if (DRY_RUN) {
      programs = programs.slice(0, 5);
      console.log('Dry-run: processing first 5 programs only');
    }
  }

  let done = 0, skipped = 0, failed = 0, written = 0;

  for (const prog of programs) {
    process.stdout.write(`  ${prog.url} … `);
    try {
      const data = await scrapeProgram(prog.url);

      if (!data) {
        console.log('SKIP (no requirements found)');
        skipped++;
      } else {
        const slug = slugify(data.name || prog.college);
        const path = outPath(prog.college, slug);
        const concCount = data.concentrations?.concentrationOptions?.length ?? 0;
        console.log(`OK  "${data.name}" — ${data.requirementSections.length} sections${concCount ? ` + ${concCount} concentrations` : ''}, ${data.totalCreditsRequired} SH`);

        const leaks = findLeakedMarkers(data);
        if (leaks.length) {
          console.warn(`  ⚠  _CHOOSE markers not converted at: ${leaks.join(', ')}`);
        }

        if (WRITE) {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, JSON.stringify(data, null, 2));
          written++;
        }
        done++;
      }
    } catch (err) {
      console.log(`FAIL  ${err.message}`);
      failed++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`\nResults: ${done} scraped, ${written} written, ${skipped} skipped, ${failed} failed`);
  if (!WRITE && !DRY_RUN && done > 0) console.log('Run with --write to save output files.');

  if (WRITE) {
    let changeLog = { runs: [] };
    if (existsSync(CHANGE_LOG)) {
      try { changeLog = JSON.parse(readFileSync(CHANGE_LOG, 'utf8')); } catch {}
    }
    changeLog.runs = changeLog.runs ?? [];
    changeLog.runs.unshift({
      type:      'grad-majors',
      subject:   '🎓 Graduate Program Requirements',
      timestamp: new Date().toISOString(),
      done, written, skipped, failed,
    });
    if (changeLog.runs.length > CHANGE_LOG_MAX) changeLog.runs = changeLog.runs.slice(0, CHANGE_LOG_MAX);
    writeFileSync(CHANGE_LOG, JSON.stringify(changeLog, null, 2) + '\n', 'utf8');
    console.log(`Wrote ${CHANGE_LOG}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
