/**
 * pathway-extract.js — turn a published PlusOne page into a DRAFT pathway file.
 *
 * Pure: takes HTML, returns data. No network, no I/O, so every rule below can be
 * stress-tested against a fixture.
 *
 * ── What this does and does not decide ────────────────────────────
 *
 * It extracts what the page states STRUCTURALLY — the eligible-majors table, the
 * per-major prerequisites, the course tables — and it refuses to infer anything
 * else. Everything it cannot read becomes a `todo[]` entry on the draft, so the
 * output is honest about being unfinished rather than confidently wrong.
 *
 * The distinction is not squeamishness; it is the bug list. `CS 5500 → CS 4500 /
 * CS 4530` is an ALTERNATION that a row-by-row reader turns into two independent
 * substitutions (shipped, fixed in 39f663770a). Khoury's "choose two" does not
 * say whether it includes the mandatory courses. Bouvé's own PDF contradicts
 * itself. A parser that emitted rules for those would be fluent and wrong, and
 * the cost lands on a student's degree.
 *
 * So: the machine does the transcription, which is where the typos are, and the
 * human does the judgement, which is where the ambiguity is.
 *
 * ── Why eligibility comes out as a RULE ───────────────────────────
 *
 * Every engineering page writes "(and all combined majors)" beside a base major,
 * and NEU names a combined major after both of its halves ("Computer Science and
 * Biology, BS"). So the faithful translation of that phrase is a name match, not
 * a list of ids — the same conclusion the Khoury pages force in prose, where one
 * hand-written id caught 1 of the 71 programmes actually eligible.
 */

import { parse } from "node-html-parser";

/** "BS in Bioengineering (and all combined majors)" and its many spellings. */
const DEGREE_PREFIX = /^(?:BS|BA|BSCS|BACS|BSBA|BSIB|BSCmpE|BSME|BSChE|BSIE|BSEE|BSEnvE|BSBioE|BSCivE)\s+(?:in\s+)?/i;
const COMBINED_HINT = /\(\s*and\s+(?:all\s+)?combined\s+majors?\s*\)/i;
/** A parenthesised home college — "(Khoury)", "(COS)", "(CAMD)", "(CPS)". */
const COLLEGE_HINT = /\(\s*(Khoury|COS|CAMD|CPS|COE|Bouv[eé]|CSSH|DMSB)\s*\)/i;
const COURSE_CODE = /\b([A-Z]{2,6})\s?(\d{4})\b/g;

/** Collapse whitespace and strip zero-width junk WordPress leaves behind. */
const norm = s => String(s ?? "").replace(/​/g, "").replace(/\s+/g, " ").trim();

/**
 * Every table on the page, with the heading that introduces it.
 *
 * The heading matters: an engineering page carries one eligible-majors table PER
 * MS CONCENTRATION (MIE publishes nine tables across three concentrations), and
 * without the heading they collapse into a single wrong list.
 */
export function extractTables(html) {
  const root = parse(String(html ?? ""));
  const out = [];
  for (const table of root.querySelectorAll("table")) {
    const rows = table.querySelectorAll("tr").map(tr =>
      tr.querySelectorAll("th,td").map(c => norm(c.text)));
    if (!rows.length) continue;
    const headings = headingsBefore(table);
    out.push({ heading: mostSpecific(headings), headings, rows });
  }
  return out;
}

/**
 * Every heading preceding a table, nearest first.
 *
 * A chain rather than one heading, because the nearest one is often generic. MIE
 * repeats "Acceptable Undergraduate Pathways" above all FIVE of its
 * concentration tables; the concentration itself ("…Concentration in Materials
 * Science") is a level up. Taking only the nearest merged five different tables
 * into one and silently unioned their prerequisites — every major appearing to
 * need every concentration's prereqs at once.
 */
function headingsBefore(node) {
  const out = [];
  let cur = node;
  while (cur) {
    let sib = cur.previousElementSibling;
    while (sib) {
      if (/^h[1-6]$/i.test(sib.rawTagName ?? "")) {
        out.push({ level: Number(sib.rawTagName.slice(1)), text: norm(sib.text) });
      } else {
        const nested = sib.querySelectorAll?.("h1,h2,h3,h4,h5,h6") ?? [];
        for (let i = nested.length - 1; i >= 0; i--) {
          out.push({ level: Number(nested[i].rawTagName.slice(1)), text: norm(nested[i].text) });
        }
      }
      sib = sib.previousElementSibling;
    }
    cur = cur.parentNode;
  }
  return out.filter(h => h.text);
}

/**
 * The heading that best identifies this table.
 *
 * Prefers one naming a concentration, since that is the distinction that changes
 * what a table means; otherwise the nearest. Generic section labels are skipped
 * because they are the same above every table on the page.
 */
const GENERIC_HEADING = /^(acceptable undergraduate pathways|pathways|overview|eligibility|graduate course sharing|benefits)$/i;
function mostSpecific(headings) {
  const named = headings.find(h => /concentration/i.test(h.text));
  if (named) return named.text;
  const specific = headings.find(h => !GENERIC_HEADING.test(h.text));
  return specific?.text ?? headings[0]?.text ?? null;
}

/** Is this the "Eligible Undergrad Majors | Additional Prerequisites" table? */
export function isEligibilityTable(table) {
  const head = (table.rows?.[0] ?? []).join(" ").toLowerCase();
  return /eligible\s+undergrad/.test(head);
}

/**
 * One eligible-majors row → an eligibility entry.
 *
 * "BS in Bioengineering (and all combined majors)" with prerequisites
 * "ME 2355, ME 2350" becomes
 *
 *     { nameIncludes: "Bioengineering", combined: true, prereqs: ["ME 2355","ME 2350"] }
 *
 * `combined` records what the page said even though `nameIncludes` already
 * behaves that way, so a later reader can tell a deliberate breadth from an
 * accident of matching.
 */
export function eligibilityFromRow(cells) {
  const rawMajor = norm(cells[0]);
  if (!rawMajor) return null;

  const combined = COMBINED_HINT.test(rawMajor);
  const collegeHint = COLLEGE_HINT.exec(rawMajor)?.[1] ?? null;
  const name = norm(rawMajor
    .replace(COMBINED_HINT, "")
    .replace(COLLEGE_HINT, "")
    .replace(DEGREE_PREFIX, "")
    .replace(/,\s*$/, ""));
  if (!name) return null;

  const prereqs = [...norm(cells[1] ?? "").matchAll(COURSE_CODE)]
    .map(m => `${m[1]} ${m[2]}`);

  const entry = { nameIncludes: name };
  if (combined) entry.combined = true;
  if (collegeHint) entry.homeCollege = collegeHint;
  if (prereqs.length) entry.prereqs = [...new Set(prereqs)];
  return entry;
}

/** Course rows: a code, usually a title, usually credits. */
export function coursesFromRow(cells) {
  const joined = cells.join(" ");
  const codes = [...joined.matchAll(COURSE_CODE)].map(m => `${m[1]} ${m[2]}`);
  if (!codes.length) return null;
  const sh = /(\d+(?:\.\d+)?)\s*SH/i.exec(joined);
  return { codes: [...new Set(codes)], sh: sh ? Number(sh[1]) : null, cells };
}

/**
 * Build a draft pathway from a page.
 *
 * @param {object} args
 * @param {string} args.url
 * @param {string} args.html
 * @param {string} [args.id]        proposed pathway id
 * @param {string} [args.college]
 * @param {string} [args.today]     ISO date for `source.retrievedAt`
 * @returns {{draft: object, todo: string[], stats: object}}
 */
export function buildDraft({ url, html, id = null, college = null, today = null }) {
  const tables = extractTables(html);
  const root = parse(String(html ?? ""));
  const title = norm(root.querySelector("h1")?.text ?? "");

  const eligTables = tables.filter(isEligibilityTable);
  const todo = [];

  // Eligibility, grouped by the heading that introduced each table — which is
  // how a page expresses "this concentration admits these majors".
  const byConcentration = new Map();
  for (const t of eligTables) {
    const key = t.heading ?? title ?? "";
    const entries = t.rows.slice(1).map(eligibilityFromRow).filter(Boolean);
    if (!entries.length) continue;
    if (!byConcentration.has(key)) byConcentration.set(key, []);
    byConcentration.get(key).push(...entries);
  }

  // Merge to one list when every table agrees; otherwise keep them apart and say
  // so, because collapsing distinct concentration tables invents eligibility.
  const groups = [...byConcentration.entries()];
  let eligibility = [];

  // Unconditional, and deliberately not dependent on the heading logic above.
  // The first version of this warned only when the grouping SAW a difference —
  // and the grouping failed silently on MIE, where five concentration tables all
  // sit under the same generic heading. The result was every major appearing to
  // require every concentration's prerequisites at once, with no todo raised.
  // A guard that only fires when another guard worked is not a guard.
  if (eligTables.length > 1) {
    todo.push(`${eligTables.length} eligible-majors tables on this page. Engineering pages ` +
              `publish ONE PER MS CONCENTRATION with different prerequisites per major — ` +
              `check whether these should become separate requiresMsConcentration entries ` +
              `before trusting the merged prereqs below.`);
  }

  if (groups.length <= 1) {
    eligibility = dedupe(groups[0]?.[1] ?? []);
  } else {
    const sets = groups.map(([, es]) => es.map(e => e.nameIncludes).sort().join("|"));
    if (new Set(sets).size === 1) {
      // ALL groups, not just the first. Taking groups[0] dropped every other
      // concentration's prerequisites on the floor while the todo below cheerfully
      // advised confirming them — losing the very data it warned about. `dedupe`
      // unions prereqs for a repeated major precisely so this merge is lossless.
      eligibility = dedupe(groups.flatMap(([, es]) => es));
      todo.push(`${groups.length} concentration tables list identical majors — merged, ` +
                `with their prerequisites UNIONED. Split them into ` +
                `requiresMsConcentration entries if the prerequisites differ per ` +
                `concentration, which on engineering pages they usually do.`);
    } else {
      eligibility = dedupe(groups.flatMap(([, es]) => es));
      todo.push(`${groups.length} concentration tables list DIFFERENT majors ` +
                `(${groups.map(([h]) => h || "untitled").join("; ")}). They are merged here — ` +
                `split them into requiresMsConcentration entries before shipping.`);
    }
  }

  // Course tables are reported, never turned into shares: which undergraduate
  // requirement a graduate course replaces is the judgement call this refuses to
  // make, and it is where the alternation bug came from.
  const courseTables = tables.filter(t => !isEligibilityTable(t));
  const courses = [];
  for (const t of courseTables) {
    for (const row of t.rows) {
      const c = coursesFromRow(row);
      if (c) courses.push({ heading: t.heading, ...c });
    }
  }

  if (!eligibility.length) todo.push("No eligible-majors table found — eligibility must be written by hand.");
  if (!courses.length) todo.push("No course table found — the shareable courses must be written by hand.");
  todo.push("SHARES are not extracted: which undergraduate requirement each graduate course replaces, " +
            "and whether two rows are an ALTERNATION, are judgement calls. Fill `shares` by hand.");
  todo.push("RULES are not extracted: cap, GPA, per-term limit, timing. Read the page and fill `rules`.");

  const draft = {
    id: id ?? proposeId(url),
    brand: "PlusOne",
    college: college ?? null,
    label: title || null,
    eligibility,
    msPrograms: [],
    shares: [],
    rules: [{ kind: "shareCap", courses: 4, semesterHours: 16 },
            { kind: "admissionNotGuaranteed" }],
    notes: [],
    source: { url, kind: "html", retrievedAt: today ?? new Date().toISOString().slice(0, 10) },
    confidence: "derived",
    todo,
  };

  return {
    draft,
    todo,
    stats: {
      tables: tables.length,
      eligibilityTables: eligTables.length,
      concentrationGroups: groups.length,
      eligibilityEntries: eligibility.length,
      courseRows: courses.length,
      distinctCourses: new Set(courses.flatMap(c => c.codes)).size,
    },
    courses,
  };
}

function dedupe(entries) {
  const seen = new Map();
  for (const e of entries) {
    const key = e.nameIncludes.toLowerCase();
    const prev = seen.get(key);
    if (!prev) { seen.set(key, { ...e }); continue; }
    // Same major in two tables with different prerequisites: keep both, since
    // dropping one would understate what a student must have done.
    if (e.prereqs) prev.prereqs = [...new Set([...(prev.prereqs ?? []), ...e.prereqs])];
    prev.combined ||= e.combined;
  }
  return [...seen.values()];
}

/** "…/plusone-mece/" → "engineering/plusone-mece". Advisory; the author renames. */
function proposeId(url) {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? "pathway";
  } catch { return "pathway"; }
}
