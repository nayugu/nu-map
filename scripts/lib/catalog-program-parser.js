/**
 * catalog-program-parser.js — shared requirement-page parser for
 * scrape-majors.js (undergrad) and scrape-grad-majors.js (graduate).
 *
 * The two scrapers used to carry near-identical private copies of this logic.
 * Of the 15 parsing functions they each defined, 13 were byte-identical; only
 * the credit-total extractor and the requirement walk differed, and both of
 * those differences collapse into the PROFILE object below. Keeping one copy
 * is what makes CLAUDE.md's "fix both paths" rule actually hold.
 *
 * ── What changed in the 2026-08 rewrite ──────────────────────────────────────
 *
 * The old walk was `querySelectorAll('h2, table.sc_courselist')` with a cursor
 * that was set to null after every table. Three consequences, all silent:
 *
 *   1. A heading owned only its FIRST table. Every later table under the same
 *      heading was dropped. Measured across the live undergrad catalog:
 *      **331 of 717 requirement tables dropped on 82 programs.**
 *   2. `<h3>` was never walked at all (undergrad), so the concentration tables
 *      that hang off h3 — most of them — were invisible or misattributed.
 *   3. A table following an unrelated heading was attributed to it. On CS BSCS
 *      the AI concentration became a *mandatory* section titled "Program
 *      Requirement"; on Physics BS an optional concentration became required.
 *
 * The replacement walks a block stream and attributes each table to the
 * NEAREST PRECEDING HEADING OF ANY LEVEL, with a heading owning ALL of its
 * tables. Concentrations are resolved through the page's own anchor graph
 * rather than by matching heading text, because the catalog states the
 * relationship structurally: a "gateway" heading is followed by a <ul> whose
 * links point at the concentration headings.
 *
 * Deliberately NOT text-matching: heading wording varies far too much
 * ("Concentration", "Concentrations", "Computer Science Concentrations",
 * "Political Science Concentrations (Optional)", "Concentration or Electives
 * Option", "Program Options", "Performance Concentration", "Philosophy Major
 * with a Concentration in Law and Ethics"…). Link structure is stable; prose
 * is not.
 */

import { parse as parseHTML } from 'node-html-parser';

// ── Profiles ─────────────────────────────────────────────────────────────────
//
// The complete set of behavioural differences between the two scrapers.
// Everything else is shared.

export const UNDERGRAD_PROFILE = {
  level: 'undergrad',
  pathPrefix: '/undergraduate/',
  // Sanity window for a plausible degree total, used to reject stray numbers.
  creditWindow: [60, 250],
};

export const GRAD_PROFILE = {
  level: 'grad',
  pathPrefix: '/graduate/',
  creditWindow: [20, 150],
};

function parseHoursCell(tr) {
  const cell = tr.querySelector('.hourscol');
  if (!cell) return 0;
  const n = parseInt(cell.text.trim(), 10);
  return isNaN(n) ? 0 : n;
}

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

/**
 * Parse free-text range descriptions into RANGE nodes.
 * Handles: "CS 2500 or higher", "Any ENGW course", "CS 2500-2999",
 *          "CS 2500 and above", "CS 2500 or higher, except CS 5010",
 *          "MATH 3001 to MATH 4999 but not MATH 4000"
 */
function parseRangeText(raw) {
  const text = raw.trim();

  // Extract exceptions first: ", except CS 5010, CS 5020" / "but not MATH 4000"
  const exceptions = [];
  const excMatch = text.match(/,?\s*(?:except|but\s+not)\s+(.*)/i);
  if (excMatch) {
    for (const chunk of excMatch[1].split(/,\s*|\s+(?:and|or)\s+/i)) {
      const em = chunk.trim().match(/([A-Z]{2,6})\s+(\d+)/);
      if (em) exceptions.push({ type: 'COURSE', subject: em[1], classId: parseInt(em[2], 10) });
    }
  }
  const clean = text.replace(/,?\s*(?:except|but\s+not).*/i, '').trim();

  // "SUBJ NNNN or higher" / "SUBJ NNNN and above"
  let m = clean.match(/^([A-Z]{2,6})\s+(\d+)\s+(?:or\s+higher|and\s+above)/i);
  if (m) return { type: 'RANGE', subject: m[1], idRangeStart: parseInt(m[2], 10), idRangeEnd: 9999, exceptions };

  // "SUBJ NNNN-MMMM" / "SUBJ NNNN–MMMM" / "SUBJ NNNN to [SUBJ ]MMMM" / "… through …"
  m = clean.match(/^([A-Z]{2,6})\s+(\d+)\s*(?:[-–]|\bto\b|\bthrough\b)\s*(?:[A-Z]{2,6}\s+)?(\d+)/i);
  if (m) return { type: 'RANGE', subject: m[1], idRangeStart: parseInt(m[2], 10), idRangeEnd: parseInt(m[3], 10), exceptions };

  // "Any SUBJ course"
  m = clean.match(/^[Aa]ny\s+([A-Z]{2,6})\s+course/i);
  if (m) return { type: 'RANGE', subject: m[1], idRangeStart: 1000, idRangeEnd: 9999, exceptions };

  // Bare "SUBJ NNNN" with no range indicator but inside a range context — treat as lower bound
  m = clean.match(/^([A-Z]{2,6})\s+(\d+)$/);
  if (m && exceptions.length) return { type: 'RANGE', subject: m[1], idRangeStart: parseInt(m[2], 10), idRangeEnd: 9999, exceptions };

  return null;
}

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

function flattenCourseNodes(reqs) {
  const out = [];
  for (const r of reqs) {
    if (r.type === 'COURSE' || r.type === 'RANGE') out.push(r);
    else if (r.courses) out.push(...flattenCourseNodes(r.courses));
  }
  return out;
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
  let chooseExplicit = false; // true when a "Complete N"/credit comment opened the group
  let splitPendingCredit = null; // split/supplemental credit (SH) awaiting its single course

  function commitPending() {
    if (!pending) return;
    (inChoose ? chooseItems : requirements).push(pending);
    pending = null;
  }

  function commitChooseGroup() {
    if (!inChoose) return;
    inChoose = false;
    if (!chooseItems.length) { chooseItems = []; chooseCreds = 0; chooseCount = 0; chooseExplicit = false; return; }

    if (chooseCreds > 0) {
      // A credit-hour annotation followed by exactly one course is just a required course,
      // not an elective pool. Emit as COURSE so the renderer doesn't show "X/Y SH from pool".
      if (chooseItems.length === 1 && chooseItems[0].type === 'COURSE') {
        requirements.push(chooseItems[0]);
      } else {
        requirements.push({ type: 'XOM', numCreditsMin: chooseCreds, courses: chooseItems });
      }
    } else if (chooseCount === 1 || chooseItems.length <= 2) {
      requirements.push({ type: 'OR', courses: chooseItems });
    } else if (!chooseExplicit) {
      // Group formed only by blockindent, with no "Complete N"/credit instruction —
      // e.g. a bare referenced electives pool whose required count is stated in another
      // section. Default to "pick one" rather than fabricating "take all N courses".
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

    chooseItems = []; chooseCreds = 0; chooseCount = 0; chooseExplicit = false;
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

      // A split/supplemental-credit annotation is awaiting this course → emit as a
      // single-course XOM carrying the section's allotted SH, so the course can satisfy
      // this section while also counting toward the others it appears in.
      if (splitPendingCredit !== null && node.type === 'COURSE') {
        requirements.push({ type: 'XOM', numCreditsMin: splitPendingCredit, courses: [node] });
        splitPendingCredit = null;
        continue;
      }
      splitPendingCredit = null;

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

      // Split/supplemental credit: a per-course annotation cross-counting one course into
      // this section, e.g. "3 semester hours from the following count toward the
      // mathematics/science requirement:" or "…already required above and also fulfills the
      // integrative requirement:". The credit shown (if any) is only the portion allotted to
      // THIS section — the course's full SH is split across the sections it appears in
      // (common in combined-degree programs like IECS). Attach it to the next single course
      // as an XOM so gradRequirements' split-credit path lets it satisfy every section it
      // appears in without inflating total credits.
      if (/(?:counts? toward|fulfills) the .+? requirement/i.test(text)) {
        commitPending();
        splitPendingCredit = parseCreditInstruction(text) ?? 0;
        continue;
      }

      const credits = parseCreditInstruction(text);
      const count   = credits !== null ? null : parseChooseInstruction(text);
      // Last resort: credit is only in the hourscol, not in the comment text.
      // Only used when both text-based parsers come up empty (e.g. "Complete three
      // courses from two of the following breadth areas: [12 in hourscol]").
      const hoursCredit = (credits === null && count === null)
        ? (parseHoursCell(tr) || null) : null;
      const effectiveCredits = credits ?? hoursCredit;

      if (effectiveCredits !== null || count !== null) {
        commitPending();
        commitChooseGroup();
        inChoose     = true;
        chooseCreds  = effectiveCredits ?? 0;
        chooseCount  = count  ?? 0;
        chooseExplicit = true;
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

  // "Choose from N areas" pattern (e.g. MSCS Breadth, AI MS Specialization):
  // An initial comment row specifies a credit minimum for a pool that spans multiple
  // areaheader sub-sections, but uses plain wording ("Complete three courses from two
  // of the following…") so parseCreditInstruction misses it — the credit lives only
  // in the row's hourscol. When detected, merge all areaheader groups into one XOM
  // rather than emitting each area as an independent all-required section.
  if (groups.length >= 3) {
    const initial = groups[0];
    if (initial.title === h2Title && initial.creditHint === 0) {
      const areaGroups = groups.slice(1);
      if (areaGroups.every(g => g.creditHint === 0)) {
        let poolCredit = 0;
        for (const tr of initial.rows) {
          const span = tr.querySelector('span.courselistcomment');
          if (span && !span.getAttribute('class')?.includes('areaheader')) {
            const h = parseHoursCell(tr);
            if (h > 0 && parseCreditInstruction(span.text.trim()) === null) {
              poolCredit = h;
              break;
            }
          }
        }
        if (poolCredit > 0 && parseRowGroup(initial.rows).length === 0) {
          const groups2 = areaGroups.map(g => ({
            title: g.title,
            courses: flattenCourseNodes(parseRowGroup(g.rows)),
          })).filter(g => g.courses.length > 0);
          const allCourses = groups2.flatMap(g => g.courses);
          if (allCourses.length > 0) {
            return [{
              type: 'SECTION',
              title: h2Title,
              requirements: [{ type: 'XOM', numCreditsMin: poolCredit, courses: allCourses, groups: groups2 }],
              minRequirementCount: 1,
            }];
          }
        }
      }
    }
  }

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

export function findLeakedMarkers(obj, path = '') {
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

// ── Requirements region ───────────────────────────────────────────────────────
//
// CourseLeaf renders each tab as a `<div id="…textcontainer">`. Requirement
// tables can live in MORE THAN ONE of them: PhD pages, for example, split
// their requirements across #curriculumtextcontainer and
// #advancedentryphdprogramrequirementstextcontainer. Returning only the first
// match silently halved those programs.
//
// So: take every tab pane that actually contains requirement tables, except
// the Sample Plan of Study (which is an example, not the rule, and whose
// courses must never be read as requirements). Falling back to the whole page
// keeps standalone concentration pages and any future layout working.
function requirementsRoots(pageRoot) {
  return partitionPanes(pageRoot).included;
}

/**
 * Split the page's tab panes into the ones we parse and the ones we skip, with
 * a reason for every skip.
 *
 * Requirement tables live under 27 different container ids across the catalog,
 * including outright typos in NEU's own markup (`programrequiementstextcontainer`,
 * `cirriculumtextcontainer`, `progratextcontainer`). Matching on the id suffix
 * plus "does it actually contain requirement tables" covers all of them;
 * hard-coding `programrequirementstextcontainer` would silently lose 544
 * tables.
 *
 * The Sample Plan of Study pane is the one deliberate exclusion: it is an
 * example schedule, not the requirements, and 4 pages put a courselist table
 * in it. The old parser walked the whole page and so read those as
 * requirements.
 */
function partitionPanes(pageRoot) {
  const included = [], excluded = [];
  for (const d of pageRoot.querySelectorAll('div[id]')) {
    const id = d.getAttribute('id') ?? '';
    if (!/textcontainer$/.test(id)) continue;
    const n = d.querySelectorAll('table.sc_courselist').length;
    if (!n) continue;
    if (/^planofstudy/.test(id)) excluded.push({ id, tables: n, reason: 'sample plan of study' });
    else included.push(d);
  }
  if (included.length) return { included, excluded };

  const named = pageRoot.querySelectorAll('div[id]')
    .filter(d => /requirementstextcontainer$/.test(d.getAttribute('id') ?? ''));
  return { included: named.length ? named : [pageRoot], excluded };
}

/** Single-root convenience for callers that just need the text. */
function requirementsRoot(pageRoot) {
  return requirementsRoots(pageRoot)[0] ?? pageRoot;
}
// ── Credit total ─────────────────────────────────────────────────────────────

/**
 * The program's stated total semester hours.
 *
 * Previously this read `tr.plangridtotal` FIRST — the Sample Plan of Study's
 * total. That is one path's credit load, which legitimately exceeds the
 * minimum (Biology's page says so outright), so the stored number was wrong
 * for most programs. Worse, `tr.listsum, tr.total` could match a courselist
 * subtotal: Chemistry BS stored 138 where both real sources said 134.
 *
 * Priority is now: what the page SAYS is required > what a sample plan adds up
 * to. Returns { value, source } so the verifier can tell a stated total from
 * an inferred one.
 *
 * Never matches "N semester hours in the major" — that is a major-only subtotal
 * (Philosophy says 89, POLS 52) and is not the degree total.
 */
export function parseTotalCredits(pageRoot, profile) {
  const [lo, hi] = profile.creditWindow;
  const inWindow = n => Number.isFinite(n) && n > lo && n < hi;

  // Read across every requirement pane — PhD pages split them.
  const text = requirementsRoots(pageRoot).map(r => r.text).join(' ')
    .replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');

  // Ordered by how explicitly the phrasing claims to be the DEGREE total.
  // The range form ("36–44 total semester hours required") is grad-only and
  // was unhandled, which is why 215 graduate programs stored 0.
  const patterns = [
    [/(\d+)(?:\s*[-–]\s*\d+)?\s+total\s+semester\s+hours?\s+required/i, 'stated-total'],
    [/(\d+)(?:\s*[-–]\s*\d+)?\s+overall\s+semester\s+hours?\s+required/i, 'stated-overall'],
    [/(\d+)(?:\s*[-–]\s*\d+)?\s+total\s+semester\s+hours?/i,             'stated-total'],
    [/(\d+)(?:\s*[-–]\s*\d+)?\s+semester\s+hours?\s+required/i,          'stated-required'],
  ];
  for (const [re, source] of patterns) {
    const m = text.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (inWindow(n)) return { value: n, source };
    }
  }

  // Fall back to the sample plan only when the page states nothing. Scan the
  // whole page here — the plan grid lives in a different tab pane.
  for (const tr of pageRoot.querySelectorAll('tr.plangridtotal')) {
    const m = tr.text.trim().match(/(\d+)\s*$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (inWindow(n)) return { value: n, source: 'plan-grid' };
    }
  }

  const legacy = pageRoot.text.match(/[Tt]otal\s+[Hh]ours?[\s:]+(\d+)/);
  if (legacy) {
    const n = parseInt(legacy[1], 10);
    if (inWindow(n)) return { value: n, source: 'total-hours-row' };
  }

  return { value: 0, source: null };
}

// ── Block stream ─────────────────────────────────────────────────────────────

const HEADING = /^H([2-4])$/;

/**
 * Flatten the requirements region into an ordered stream of the things that
 * matter: headings, requirement tables, and link lists.
 *
 * Walking the DOM in document order (rather than two querySelectorAll passes)
 * is what lets a table find its true owner regardless of heading level.
 */
function blockStream(container) {
  const blocks = [];

  const anchorIds = el =>
    el.querySelectorAll('a[id], a[name]')
      .map(a => a.getAttribute('id') || a.getAttribute('name'))
      .filter(Boolean);

  const visit = node => {
    for (const el of node.childNodes ?? []) {
      const tag = el.tagName;
      if (!tag) continue;

      const hm = HEADING.exec(tag);
      if (hm) {
        const text = el.text.replace(/\u00a0/g, ' ').trim().replace(/\s+/g, ' ');
        const ids  = anchorIds(el);
        // An EMPTY heading is a bookmark, not a section — POLS BA carries two
        // concentration anchors exactly this way. Emitting it as a heading
        // would let it swallow the anchor (leaving the real heading looking
        // like an ordinary requirement) and let it own tables under a blank
        // title. Emit a pure anchor so it stays transparent to both.
        blocks.push(text
          ? { kind: 'heading', level: +hm[1], el, text, ids }
          : { kind: 'anchor', ids });
        continue;
      }

      if (tag === 'TABLE' && (el.getAttribute('class') ?? '').includes('sc_courselist')) {
        blocks.push({ kind: 'table', el });
        continue;
      }
      if (tag === 'UL') {
        // Record it as a possible gateway menu, then KEEP DESCENDING: the
        // catalog nests requirement tables inside <ul class="tightlist"> on
        // some pages (Economics MS hides two there), and treating a list as a
        // leaf made those tables invisible.
        blocks.push({ kind: 'list', el });
        visit(el);
        continue;
      }

      // Anchors also sit in a bare <p> immediately before the heading they name.
      if (tag === 'P') {
        const ids = anchorIds(el);
        if (ids.length) { blocks.push({ kind: 'anchor', ids }); continue; }
      }

      visit(el);
    }
  };

  visit(container);
  return blocks;
}

/**
 * Map every in-page anchor id to the heading it introduces.
 *
 * The catalog places these three ways, all seen in the wild:
 *   <h3><a id="ARIN"></a>Concentration in AI</h3>     (inside the heading)
 *   <h2><a name="visualconc"></a>Concentration in …</h2>
 *   <p><a id="AMPIconc"></a></p><h3>Concentration in …</h3>  (just before it)
 * An anchor inside a heading binds to that heading; otherwise it binds to the
 * next heading in the stream.
 */
function anchorMap(_roots, blocks) {
  const map = new Map();

  // Walk in document order. An anchor binds to the heading it sits inside, or
  // — when it sits in an empty heading or a bare <p> — to the next heading
  // that actually has text.
  const bindNext = from => {
    for (let k = from; k < blocks.length; k++) {
      if (blocks[k].kind === 'heading') return k;
    }
    return undefined;
  };

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind === 'heading' && b.ids?.length) {
      for (const id of b.ids) map.set(id, i);
    } else if (b.kind === 'anchor') {
      const target = bindNext(i + 1);
      if (target !== undefined) for (const id of b.ids) map.set(id, target);
    }
  }
  return map;
}

const CONCENTRATION_HREF = /\/(?:under)?graduate\/[^/]+\/concentrations\//;

/**
 * Fallback classifier for a concentration heading that NO gateway links to.
 *
 * Physics BS is the case: "Astrophysics Concentration (Optional)" carries its
 * table inline with no menu above it, so the structural rule finds nothing and
 * the concentration would ship as a mandatory requirement.
 *
 * This is deliberately the fallback, never the primary test — heading wording
 * across the catalog is far too varied to lead with. Kept narrow, and never
 * applied to a heading that is itself a gateway (a menu like "Computer Science
 * Concentrations" describes options, it isn't one).
 */
const CONCENTRATION_TITLE = [
  /^concentration\s+in\b/i,                       // Concentration in Art History…
  /\bwith\s+a\s+concentration\s+in\b/i,          // Philosophy Major with a Concentration in…
  /\(\s*no\s+concentration\s*\)/i,                // Philosophy Major (No Concentration)
  /\bconcentration\s*(?:\(\s*optional\s*\))?\s*$/i, // Astrophysics Concentration (Optional)
  /\bconcentration\b[^—–]*[—–]/,                  // X Concentration—College of Y
  /^electives?\s+option\b/i,                      // Electives Option (the mutually-exclusive twin)
];

function looksLikeConcentration(text) {
  // "Concentrations" (plural) is an overview heading, not an option.
  if (/\bconcentrations\b/i.test(text) && !/\bconcentration\s+in\b/i.test(text)) return false;
  return CONCENTRATION_TITLE.some(re => re.test(text));
}

/**
 * A heading is a GATEWAY when the list following it is a menu of
 * concentrations — every link either jumps to another heading on this page or
 * points at a /concentrations/ page.
 *
 * Structural, not lexical: this is what catches "Program Options" and
 * "Concentration or Electives Option" without a word list, and what correctly
 * refuses to treat an ordinary bulleted prose list as a menu.
 */
function findGateways(blocks, anchors) {
  const gateways = [];
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].kind !== 'heading') continue;
    const level = blocks[i].level;

    for (let j = i + 1; j < blocks.length; j++) {
      const b = blocks[j];
      if (b.kind === 'heading' && b.level <= level) break;   // left this heading's scope
      if (b.kind !== 'list') continue;

      const links = b.el.querySelectorAll('a[href]')
        .map(a => ({ href: (a.getAttribute('href') ?? '').trim(), label: a.text.trim() }))
        .filter(l => l.href);
      if (!links.length) continue;

      const resolved = links.filter(l =>
        (l.href.startsWith('#') && anchors.has(l.href.slice(1))) || CONCENTRATION_HREF.test(l.href));

      if (resolved.length === links.length) {
        gateways.push({ headingIdx: i, links: resolved });
        break;
      }
    }
  }
  return gateways;
}

/** Deterministic de-duplication — titles are user-visible keys, so order matters. */
function uniquify(title, used) {
  if (!used.has(title)) { used.add(title); return title; }
  for (let n = 2; ; n++) {
    const candidate = `${title} (${n})`;
    if (!used.has(candidate)) { used.add(candidate); return candidate; }
  }
}

// ── Requirement walk ─────────────────────────────────────────────────────────

/**
 * Parse a program page into requirement sections + concentration options.
 *
 * @param {object} pageRoot  parsed page root
 * @param {object} profile   UNDERGRAD_PROFILE | GRAD_PROFILE
 * @param {object} [ctx]
 * @param {(href: string) => (object|null)} [ctx.resolveExternal]
 *        Loads a /concentrations/ page and returns its parsed root, or null.
 *        Injected so contract tests can run without network.
 * @returns {{requirementSections, concentrations, generalElectiveSH,
 *            tablesPresent, tablesConsumed, warnings}}
 */
export function parseRequirements(pageRoot, profile, ctx = {}) {
  const { included: roots, excluded: excludedPanes } = partitionPanes(pageRoot);
  const blocks = roots.flatMap(r => blockStream(r));
  const anchors  = anchorMap(roots, blocks);
  const gateways = findGateways(blocks, anchors);
  const warnings = [];

  const tablesPresent = blocks.filter(b => b.kind === 'table').length;
  // Reconcile against the whole document, not just the panes we selected.
  // Counting "present" only inside our own selection is self-confirming: when
  // pane selection was wrong, PhD pages reported a tidy 3/3 while half the
  // page went unread. Every table on the page must end up consumed or
  // explicitly excluded.
  const tablesOnPage = pageRoot.querySelectorAll('table.sc_courselist').length;
  const tablesExcluded = excludedPanes.reduce((n, p) => n + p.tables, 0);
  const consumed = new Set();

  // Every table belongs to the nearest preceding heading, whatever its level,
  // and a heading keeps ALL of its tables. This single change is what recovers
  // the 331 dropped tables.
  const owners = new Map();          // heading index → table blocks
  const orphanTables = [];           // tables that precede every heading
  let currentHeading = null;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind === 'heading') { currentHeading = i; continue; }
    if (b.kind !== 'table') continue;
    // A pane can open with a table and no heading (several minors do). Parsing
    // it under a fallback title is strictly better than discarding it — the
    // table's own areaheader rows usually supply real titles anyway.
    if (currentHeading === null) { orphanTables.push(b); continue; }
    if (!owners.has(currentHeading)) owners.set(currentHeading, []);
    owners.get(currentHeading).push(b);
  }

  // Headings reachable from a gateway are concentration content, not
  // requirements — this is what stops "Electives Option" and "Astrophysics
  // Concentration (Optional)" being rendered as mandatory.
  const concHeadings = new Map();    // heading index → link label
  const externalLinks = [];
  const gatewayIdx = new Set(gateways.map(g => g.headingIdx));
  for (const gw of gateways) {
    for (const link of gw.links) {
      if (link.href.startsWith('#')) {
        const idx = anchors.get(link.href.slice(1));
        if (idx !== undefined) concHeadings.set(idx, link.label);
      } else {
        externalLinks.push(link);
      }
    }
  }
  // Concentrations no menu points at (Physics BS's inline "Astrophysics
  // Concentration (Optional)"). Only headings that actually own a table —
  // otherwise a stray mention would create an empty option.
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind !== 'heading' || gatewayIdx.has(i) || concHeadings.has(i)) continue;
    if (owners.has(i) && looksLikeConcentration(b.text)) concHeadings.set(i, undefined);
  }

  const requirementSections  = [];
  const concentrationOptions = [];
  const usedSectionTitles    = new Set();
  const usedConcTitles       = new Set();
  let generalElectiveSH = 0;

  for (const tb of orphanTables) {
    for (const sec of parseTable(tb.el, 'Requirements')) {
      sec.title = uniquify(sec.title, usedSectionTitles);
      requirementSections.push(sec);
    }
    consumed.add(tb);
  }

  for (const [headingIdx, tableBlocks] of owners) {
    const title = blocks[headingIdx].text;

    // "Required General Electives" contributes only its SH — the section is
    // rebuilt at runtime by gradRequirements.calculateGeneralElectives.
    if (/^Required General Electives/i.test(title)) {
      for (const tb of tableBlocks) {
        for (const tr of tb.el.querySelectorAll('tr')) {
          const sh = parseHoursCell(tr);
          if (sh > 0) { generalElectiveSH = sh; break; }
        }
        consumed.add(tb);
      }
      continue;
    }

    if (concHeadings.has(headingIdx)) {
      const reqs = tableBlocks.flatMap(tb => {
        consumed.add(tb);
        return parseTable(tb.el, title).flatMap(s => s.requirements ?? []);
      });
      if (reqs.length) {
        concentrationOptions.push({
          type: 'SECTION',
          // Strip a trailing "—College of …" tag; em/en-dash only, so hyphenated
          // names like "Agent-Based" survive.
          title: uniquify(title.split(/\s*[—–]\s*/)[0].trim(), usedConcTitles),
          label: concHeadings.get(headingIdx) || undefined,
          requirements: reqs,
          minRequirementCount: reqs.length,
        });
      }
      continue;
    }

    for (const tb of tableBlocks) {
      const sections = parseTable(tb.el, title);
      consumed.add(tb);
      for (const s of sections) {
        s.title = uniquify(s.title, usedSectionTitles);
        requirementSections.push(s);
      }
    }
  }

  // Concentrations that live on their own page (the business school pattern).
  if (ctx.resolveExternal) {
    for (const link of externalLinks) {
      const extRoot = ctx.resolveExternal(link.href);
      if (!extRoot) continue;
      const extContainer = requirementsRoot(extRoot);
      const heading = extContainer.querySelector('h2, h1');
      const title = (heading?.text ?? link.label).replace(/\s+/g, ' ').trim();
      const reqs = extContainer.querySelectorAll('table.sc_courselist')
        .flatMap(t => parseTable(t, title).flatMap(s => s.requirements ?? []));
      if (!reqs.length) continue;
      concentrationOptions.push({
        type: 'SECTION',
        title: uniquify(title, usedConcTitles),
        label: link.label || undefined,
        requirements: reqs,
        minRequirementCount: reqs.length,
      });
    }
  }

  const tablesConsumed = consumed.size;
  const unaccounted = tablesOnPage - tablesConsumed - tablesExcluded;
  if (unaccounted > 0) {
    warnings.push(`${unaccounted} of ${tablesOnPage} tables on the page were neither parsed nor excluded`);
  }

  const concentrations = concentrationOptions.length
    ? { minOptions: concentrationMinOptions(blocks, gateways, concHeadings), concentrationOptions }
    : null;

  return { requirementSections, concentrations, generalElectiveSH,
           tablesPresent, tablesConsumed, tablesOnPage, tablesExcluded,
           excludedPanes, warnings };
}

/**
 * How many concentrations the program actually requires.
 *
 * Was hardcoded to 1, which marked genuinely optional concentrations
 * ("Political Science Concentrations (Optional)", "Astrophysics Concentration
 * (Optional)") as required. Read from the gateway heading and its intro prose.
 */
function concentrationMinOptions(blocks, gateways, concHeadings = new Map()) {
  let best = null;

  // A lexically-detected option states its own optionality in its heading —
  // "Astrophysics Concentration (Optional)" has no gateway to read it from.
  for (const idx of concHeadings.keys()) {
    if (gateways.some(g => g.headingIdx === idx)) continue;
    if (/\(\s*optional\s*\)/i.test(blocks[idx]?.text ?? '')) best = 0;
  }
  for (const gw of gateways) {
    const heading = blocks[gw.headingIdx];
    const parts = [heading.text];
    // The rule is usually stated in the paragraph between heading and list.
    let sib = heading.el.nextElementSibling;
    for (let n = 0; sib && n < 4; n++, sib = sib.nextElementSibling) {
      if (sib.tagName === 'P') parts.push(sib.text);
      if (sib.tagName === 'UL') break;
    }
    const text = parts.join(' ').replace(/\s+/g, ' ');

    let v = null;
    if (/\(\s*optional\s*\)/i.test(heading.text)) v = 0;
    else if (/\bis\s+optional\b/i.test(text))     v = 0;
    else if (/\btwo\s+concentrations?\s+(?:are\s+)?required\b/i.test(text)) v = 2;
    else if (/\bone\s+concentration\s+is\s+required\b/i.test(text)) v = 1;
    else if (/\b(?:pick|select|choose|complete)\s+one\b/i.test(text))  v = 1;
    else if (/\brequired\b/i.test(heading.text))  v = 1;

    if (v !== null) best = best === null ? v : Math.max(best, v);
  }
  // No explicit statement → keep the historical default rather than regress.
  return best === null ? 1 : best;
}
