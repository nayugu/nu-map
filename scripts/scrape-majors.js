#!/usr/bin/env node
/**
 * scrape-majors.js
 *
 * Scrapes undergraduate degree requirements from catalog.northeastern.edu
 * and outputs parsed.initial.json files in the Major2 schema used by
 * the graduation requirement panel.
 *
 * This is a ground-up replacement for the stale external/graduatenu data.
 * ~45% of combined/joint major programs were missing writing requirements
 * and other sections because the old graduatenu scraper was removed in 2023.
 *
 * Output: src/data/majors/{year}/{college}/{slug}/parsed.initial.json
 *
 * Usage:
 *   node scripts/scrape-majors.js               # preview (no writes)
 *   node scripts/scrape-majors.js --write        # write output files
 *   node scripts/scrape-majors.js --dry-run      # first 5 programs, no write
 *   node scripts/scrape-majors.js --url <url>    # single program URL
 *   node scripts/scrape-majors.js --year 2025    # override catalog year tag
 *
 * Rate limit: 600 ms between requests by default.
 * Override: MAJORS_DELAY_MS=300 node scripts/scrape-majors.js
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname }            from 'path';
import { fileURLToPath }            from 'url';
import { parse as parseHTML }       from 'node-html-parser';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const OUT_ROOT  = join(ROOT, 'src/data/majors');
const BASE      = 'https://catalog.northeastern.edu';
const AZ_URL    = `${BASE}/azindex/`;
const DELAY_MS  = parseInt(process.env.MAJORS_DELAY_MS ?? '600', 10);
const YEAR      = parseInt(process.env.MAJORS_YEAR ?? String(new Date().getFullYear()), 10);

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

/** "Computer Science, BSCS (Boston)" → "computer_science_bscs_(boston)" */
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
  console.log('Fetching AZ index…');
  const html = await fetchPage(AZ_URL);
  const root = parseHTML(html);

  const seen     = new Set();
  const programs = [];

  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    if (!href.startsWith('/undergraduate/')) continue;

    // Degree program pages have ≥4 path segments:
    // /undergraduate/{college}/{department}/{degree}/
    const parts = href.replace(/^\/|\/$/g, '').split('/');
    if (parts.length < 4) continue;

    const url = BASE + href;
    if (seen.has(url)) continue;
    seen.add(url);

    programs.push({
      url,
      college: parts[1],          // e.g. "computer-information-science"
      name:    a.text.trim(),
    });
  }

  console.log(`Found ${programs.length} program URLs`);
  return programs;
}

// ── Credit helpers ────────────────────────────────────────────────────────────

function extractTotalCredits(root) {
  // Most pages have a "Total Credit Hours  134" row in the listsum
  for (const tr of root.querySelectorAll('tr.listsum, tr.total')) {
    const cells = tr.querySelectorAll('td');
    if (cells.length >= 2) {
      const n = parseInt(cells[cells.length - 1].text.trim(), 10);
      if (!isNaN(n) && n > 60 && n < 250) return n;
    }
  }
  // Fallback: scan raw text
  const m = root.text.match(/[Tt]otal\s+[Cc]redit\s+[Hh]ours?[\s:]+(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function parseHoursCell(tr) {
  const cell = tr.querySelector('.hourscol');
  if (!cell) return 0;
  const n = parseInt(cell.text.trim(), 10);
  return isNaN(n) ? 0 : n;
}

// ── Course link parsing ───────────────────────────────────────────────────────

/** Returns { subject, classId } or null. classId is a number. */
function parseCourseLink(a) {
  const text = a.text.trim();
  // "CS 3000" or "MATH 1341"
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

/**
 * Parse free-text range descriptions into RANGE nodes.
 * Handles: "CS 2500 or higher", "Any ENGW course", "CS 2500-2999",
 *          "CS 2500 and above", "CS 2500 or higher, except CS 5010"
 */
function parseRangeText(raw) {
  const text = raw.trim();

  // Extract exceptions first: ", except CS 5010, CS 5020"
  const exceptions = [];
  const excMatch = text.match(/,?\s*except\s+(.*)/i);
  if (excMatch) {
    for (const chunk of excMatch[1].split(/,\s*/)) {
      const em = chunk.trim().match(/([A-Z]{2,6})\s+(\d+)/);
      if (em) exceptions.push({ type: 'COURSE', subject: em[1], classId: parseInt(em[2], 10) });
    }
  }
  const clean = text.replace(/,?\s*except.*/i, '').trim();

  // "SUBJ NNNN or higher" / "SUBJ NNNN and above"
  let m = clean.match(/^([A-Z]{2,6})\s+(\d+)\s+(?:or\s+higher|and\s+above)/i);
  if (m) return { type: 'RANGE', subject: m[1], idRangeStart: parseInt(m[2], 10), idRangeEnd: 9999, exceptions };

  // "SUBJ NNNN-MMMM" or "SUBJ NNNN–MMMM"
  m = clean.match(/^([A-Z]{2,6})\s+(\d+)\s*[-–]\s*(\d+)/);
  if (m) return { type: 'RANGE', subject: m[1], idRangeStart: parseInt(m[2], 10), idRangeEnd: parseInt(m[3], 10), exceptions };

  // "Any SUBJ course"
  m = clean.match(/^[Aa]ny\s+([A-Z]{2,6})\s+course/i);
  if (m) return { type: 'RANGE', subject: m[1], idRangeStart: 1000, idRangeEnd: 9999, exceptions };

  // Bare "SUBJ NNNN" with no range indicator but inside a range context — treat as lower bound
  m = clean.match(/^([A-Z]{2,6})\s+(\d+)$/);
  if (m && exceptions.length) return { type: 'RANGE', subject: m[1], idRangeStart: parseInt(m[2], 10), idRangeEnd: 9999, exceptions };

  return null;
}

// ── Row group parser ──────────────────────────────────────────────────────────

/**
 * Parse "choose N" count from a comment string.
 * "Complete one of the following" → 1
 * "Select two of the following"   → 2
 * Returns null if not a choose-N instruction.
 */
function parseChooseInstruction(text) {
  const WORD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
  const m = text.match(/(?:complete|choose|select|take)\s+(\w+)\s+of/i);
  if (!m) return null;
  const w = m[1].toLowerCase();
  return WORD[w] ?? (parseInt(w, 10) || null);
}

/**
 * Parse "N credit hours" from a comment string.
 * "Select 12 credit hours from the following" → 12
 */
function parseCreditInstruction(text) {
  const m = text.match(/(\d+)\s+(?:credit|semester)\s+hours?/i);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Convert a flat list of <tr> elements into a requirements array.
 * Handles: COURSE, AND (lab pairs), OR (orclass rows), RANGE (commentindent),
 *          XOM/OR groups introduced by "choose N" comment rows.
 */
function parseRowGroup(rows) {
  const requirements = [];

  // Pending state
  let pending       = null;   // last node awaiting possible OR alternatives
  let inChoose      = false;  // inside a "choose N" or "X credit hours" block
  let chooseItems   = [];     // options accumulated in choose block
  let chooseCreds   = 0;      // credit threshold (XOM)
  let chooseCount   = 0;      // pick-N count (OR / minRequirementCount)

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
      requirements.push({ type: 'XOM', numCreditsMin: chooseCreds, courses: chooseItems });
    } else if (chooseCount === 1 || chooseItems.length <= 2) {
      requirements.push({ type: 'OR', courses: chooseItems });
    } else {
      // Pick N of M: emit as a SECTION node inline so the outer section can wrap it
      // For now emit the items directly; the section's minRequirementCount will be set
      // by the caller when it knows the choose count.  Tag the group for the caller.
      requirements.push({
        type: '_CHOOSE',        // internal marker; caller converts
        minCount: chooseCount || chooseItems.length,
        courses: chooseItems,
      });
    }

    chooseItems = []; chooseCreds = 0; chooseCount = 0;
  }

  for (const tr of rows) {
    const cls = tr.getAttribute('class') ?? '';

    // ── OR-alternative row (class="orclass …") ────────────────────────────────
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
        // No pending — append to last item in the current accumulator
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

    // ── Regular codecol row ───────────────────────────────────────────────────
    if (codecol) {
      // Indented option? (blockindent DIV wrapping the link)
      const isIndented = !!codecol.querySelector('div.blockindent');
      const container  = isIndented ? codecol.querySelector('div.blockindent') : codecol;
      const primary    = firstCourseLink(container);
      if (!primary) continue;

      // AND sub-courses: <span class="blockindent">and CS 3101</span>
      const andCourses = [];
      for (const span of codecol.querySelectorAll('span.blockindent')) {
        const c = firstCourseLink(span);
        if (c) andCourses.push(c);
      }

      const node = andCourses.length
        ? { type: 'AND', courses: [{ type: 'COURSE', ...primary }, ...andCourses.map(c => ({ type: 'COURSE', ...c }))] }
        : { type: 'COURSE', ...primary };

      if (isIndented) {
        // Options inside a "choose N" block
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

    // ── colspan=2 row (comment, range, or choose instruction) ─────────────────
    const wide = tr.querySelector('td[colspan="2"]');
    if (!wide) continue;

    // RANGE: <span class="courselistcomment commentindent"> inside blockindent div
    const rangeSpan = wide.querySelector('span.commentindent');
    if (rangeSpan) {
      const node = parseRangeText(rangeSpan.text.trim());
      if (node) {
        commitPending();
        (inChoose ? chooseItems : requirements).push(node);
      }
      continue;
    }

    // Comment (not an areaheader): "Complete one of the following", "Select 12 credit hours…"
    const commentSpan = wide.querySelector('span.courselistcomment');
    if (commentSpan && !commentSpan.getAttribute('class')?.includes('areaheader')) {
      const text = commentSpan.text.trim();

      const credits = parseCreditInstruction(text);
      const count   = credits ? null : parseChooseInstruction(text);

      if (credits !== null || count !== null) {
        commitPending();
        commitChooseGroup();
        inChoose     = true;
        chooseCreds  = credits ?? 0;
        chooseCount  = count  ?? 0;
      }
      continue;
    }
  }

  commitPending();
  commitChooseGroup();

  // Post-process: expand _CHOOSE markers into proper OR/XOM nodes
  return requirements.map(r => {
    if (r.type !== '_CHOOSE') return r;
    if (r.courses.length <= 2 || r.minCount === 1) return { type: 'OR', courses: r.courses };
    return { type: 'XOM', numCreditsMin: r.minCount * 4, courses: r.courses };
  });
}

// ── Table parser ──────────────────────────────────────────────────────────────

/**
 * Parse a sc_courselist <table> into an array of SECTION nodes.
 *
 * If the table contains areaheader rows they act as sub-section boundaries.
 * Each sub-section becomes its own SECTION node.  If there are no areaheaders
 * the whole table becomes one SECTION using h2Title.
 */
function parseTable(table, h2Title) {
  const rows = table.querySelectorAll('tr');

  // Split rows on areaheader boundaries
  const groups = [];   // [{ title, creditHint, rows[] }]
  let cur = null;

  for (const tr of rows) {
    // Skip hidden noscript thead rows
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
      // The section header specifies a credit total → wrap in XOM
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

  // Walk through h2 + table.sc_courselist pairs in document order.
  // We collect all block-level elements and step through them tracking
  // the most recently seen h2 as context for the next table.
  const blocks = root.querySelectorAll('h2, table.sc_courselist');
  let currentH2 = null;

  for (const el of blocks) {
    if (el.tagName === 'H2') {
      currentH2 = el.text.trim().replace(/\s+/g, ' ');
      continue;
    }

    // TABLE
    if (!currentH2) continue;

    // Concentrations get their own bucket
    if (/^Concentration in /i.test(currentH2)) {
      const sections = parseTable(el, currentH2);
      if (sections.length === 1) concentrationOptions.push(sections[0]);
      // Reset so the next table isn't attributed to this concentration
      currentH2 = null;
      continue;
    }

    // Skip the empty "Required General Electives" placeholder;
    // gradRequirements.js generates this dynamically.
    if (/^Required General Electives/i.test(currentH2)) {
      currentH2 = null;
      continue;
    }

    const sections = parseTable(el, currentH2);
    requirementSections.push(...sections);
    currentH2 = null;
  }

  const concentrations = concentrationOptions.length
    ? { minOptions: 1, concentrationOptions }
    : null;

  return { requirementSections, concentrations };
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
  const { requirementSections, concentrations } = parseRequirements(root);

  if (!requirementSections.length) return null;

  return {
    name,
    metadata:  { verified: false, lastEdited: new Date().toLocaleDateString('en-US'), branch: 'main' },
    totalCreditsRequired,
    yearVersion: YEAR,
    requirementSections,
    ...(concentrations ? { concentrations } : {}),
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
}

main().catch(err => { console.error(err); process.exit(1); });
