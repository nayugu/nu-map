// ═══════════════════════════════════════════════════════════════════
// DATA ENTITIES  (adapter — what Northeastern publishes, as search records)
//
// The institution's half of the /data search: which kinds of page exist, where
// each kind lives, and which of an entity's strings plays which matching role.
// core/entitySearch.js consumes the result and knows none of it.
//
// Pure: every function takes already-loaded data and returns records. The I/O
// stays in scripts/build-ai-data.js, which is also where the page URLs these
// paths must agree with are generated — the bijection rail checks that
// agreement rather than trusting it.
//
// Adding a kind is one KINDS entry plus one `…Records` function. That is the
// whole extension point, and it is why nothing here is a switch statement.
// ═══════════════════════════════════════════════════════════════════

/**
 * The kinds, in the order their best hit should be offered when several match.
 * `prefix` is joined to a record's `path` to make its URL, so a path never
 * repeats its own directory.
 *
 * `label` is what a result row is tagged with. It is English here because the
 * /data pages are English by design (same rule as the PDF export); the app's
 * own search boxes localize through their own strings.
 */
export const KINDS = [
  { id: "course",    label: "Course",    prefix: "/data/courses/" },
  { id: "program",   label: "Program",   prefix: "/data/" },
  { id: "subject",   label: "Subject",   prefix: "/data/courses/" },
  { id: "professor", label: "Professor", prefix: "/data/professors/" },
  { id: "nupath",    label: "NUpath",    prefix: "/data/nupath/" },
];

/**
 * Nicknames no derivation could produce. Deliberately tiny, and honestly a
 * guess: without query logs there is no way to know what else belongs, and
 * most apparent nicknames ("psych", "bio", "orgo"'s cousin "ochem") already
 * resolve as ordinary prefixes or titles. Only non-derivable ones earn a line.
 *
 * Keyed by course code so a rename of the course cannot orphan the alias
 * silently — a code that stops existing is caught by the build.
 */
export const COURSE_ALIASES = {
  "CHEM 2311": ["orgo", "ochem"],
  "CHEM 2312": ["orgo 2", "ochem 2"],
  "CHEM 2313": ["orgo lab"],
};

/**
 * Course records. The code carries the search weight: core/entitySearch.js
 * tokenizes it, so a half-typed "chem 2" still keeps CHEM 2311 alive. Matching
 * the code by equality alone caused the opposite — 3.39% of prefix queries
 * were non-monotonic and 434 entities were unreachable by their own full name.
 *
 * @param {Array<{subject: string, number: string|number, title: string}>} courses
 */
export function courseRecords(courses) {
  const out = [];
  for (const c of courses) {
    if (!c.subject || c.number == null || !c.title) continue;
    const code = `${c.subject} ${c.number}`;
    out.push({
      kind: "course",
      name: c.title,
      code,
      path: `${c.subject}/${c.number}`,
      aliases: COURSE_ALIASES[code] ?? [],
    });
  }
  return out;
}

/**
 * Subject records. The code is the identifier students actually use ("CHEM"),
 * so it routes; the name is the department's own wording, which is longer and
 * often unlike the code ("CHEM — Chemistry and Chemical Biology").
 *
 * The name falls back to the CODE, because a friendly name is optional in the
 * catalog and filtering on it would drop those subjects out of search while
 * their pages still shipped — an unsearchable page, which is the one outcome
 * this whole surface exists to prevent.
 */
export function subjectRecords(subjects) {
  return subjects
    .filter((s) => s.subject ?? s.code)
    .map((s) => {
      const code = s.subject ?? s.code;
      return { kind: "subject", name: s.name ?? s.title ?? code, code, path: code };
    });
}

/**
 * Program records. The name already contains the degree and the campus
 * ("Chemistry, BS (Boston)"), so there is nothing to add but the acronyms a
 * name cannot state — "cs" for Computer Science. No code: a degree code is not
 * unique, and routing it would lift several hundred programs above every other
 * kind at once.
 *
 * @param {Array<{name: string, page: string}>} programs  `page` is the absolute
 *   page URL the build already computed; the path is taken from it rather than
 *   re-derived, because a second slugifier is a second set of collisions.
 */
export function programRecords(programs, acronymsOf = () => []) {
  const out = [];
  for (const p of programs) {
    if (!p.name || !p.page) continue;
    const path = p.page.split("/data/")[1];
    if (!path) throw new Error(`program page outside /data/: ${p.page}`);
    out.push({ kind: "program", name: p.name, path, acronyms: acronymsOf(p) });
  }
  return out;
}

/**
 * Professor records. A name and nothing else — which is the case the record
 * shape exists to make cheap. Either token order already works, so "ranganathan
 * aanjhan" finds the same person as "aanjhan ranganathan".
 *
 * @param {Object<string, {page: string}>} byName  the letter files' shape
 */
export function professorRecords(byName) {
  const out = [];
  for (const [name, v] of Object.entries(byName)) {
    if (!name || !v?.page) continue;
    const path = v.page.split("/data/professors/")[1];
    if (!path) throw new Error(`professor page outside /data/professors/: ${v.page}`);
    out.push({ kind: "professor", name, path });
  }
  return out;
}

/** NUpath records: 13 codes, each with the registrar's own label. */
export function nupathRecords(nupath) {
  return Object.entries(nupath).map(([code, v]) => ({
    kind: "nupath",
    name: v.label ?? code,
    code,
    path: code,
  }));
}
