// NU Map — Copyright (C) 2025-2026 Nathan Gu and Matthew Gu
// SPDX-License-Identifier: AGPL-3.0-only
// AGPL-3.0-only + attribution term under §7(b); see LICENSING.md and NOTICE.
//
// The public data surface at numap.app/data.
//
// PAGES FIRST: the primary surface is human-readable HTML under /data —
// small plain-text pages, fully expanded (no collapsed content), every
// course/professor/program reference a real link. That same property is
// what makes them the best MACHINE surface too: AI fetch tools read a
// 10 KB page whole, follow verbatim links, and never truncate, where a
// 300 KB JSON gets cut off. The JSON tree under /data/json is the
// developer API: same data, structured, explicitly secondary.
//
//   dist/data.html                     the hub (served at /data)
//   dist/data/courses[.html|/SUBJ|/SUBJ/NUM]
//   dist/data/majors, /minors          program directories
//   dist/data/programs/{slug}          one page per program
//   dist/data/nupath[/CODE]            index + 13 attribute pages
//   dist/data/professors[/A|/name-slug]
//   dist/data/equivalences
//   dist/data/sitemap.xml
//   dist/data/json/**                  the developer JSON API
//
// Runs AFTER `vite build` (writes into dist/), so the repo stays free of
// thousands of generated files. Sources: the same parsed.initial.json
// files that feed the app's hashed chunks, the programs bundle, and the
// course catalog — nothing here can drift from what the app shows.
//
// Rails: refuses a suspiciously small export, fails on slug collisions,
// and fails on any internal link that doesn't resolve to a generated page.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist", "data");
const ORIGIN = "https://numap.app";
const PAGE_ROOT = `${ORIGIN}/data`;
const JSON_ROOT = `${ORIGIN}/data/json`;

const MIN_PROGRAMS = 900;
const MIN_SUBJECTS = 150;
const MIN_COURSES = 6000;

const DISCLAIMER =
  "NU Map is an independent, student-built planner. It is not affiliated with, " +
  "endorsed by, or officially connected to Northeastern University. Data is scraped " +
  "from Northeastern's public catalog and refreshed on a schedule; always confirm " +
  "with the official catalog and an academic advisor.";

const readJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const slugify = (s) => {
  const slug = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) throw new Error(`unsluggable name: "${s}"`);
  return slug;
};

const writeJSON = (rel, data) => {
  const p = path.join(OUT, "json", rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // Every file self-roots: wherever a reader lands, the first field points
  // back to the guide. Compact on purpose — this is the developer API; the
  // readable surface is the HTML pages.
  fs.writeFileSync(p, JSON.stringify({ guide: `${ORIGIN}/llms.txt`, ...data }));
};

// ── Gather programs ──────────────────────────────────────────────────
// Tree shape: src/data/majors/{year}/{college}/{programDir}/parsed.initial.json
// (grad-majors mirrors it). The internal id is the path fragment, with
// grad ids prefixed "grad/" — matching programs-bundle ids exactly.

function* walkPrograms(baseDir, idPrefix) {
  const base = path.join(ROOT, "src", "data", baseDir);
  if (!fs.existsSync(base)) throw new Error(`missing program tree: ${base}`);
  for (const year of fs.readdirSync(base).sort()) {
    const yearDir = path.join(base, year);
    if (!fs.statSync(yearDir).isDirectory()) continue;
    if (!/^\d{4}$/.test(year)) throw new Error(`unexpected non-year dir: ${yearDir}`);
    for (const college of fs.readdirSync(yearDir).sort()) {
      const collegeDir = path.join(yearDir, college);
      if (!fs.statSync(collegeDir).isDirectory()) continue;
      for (const prog of fs.readdirSync(collegeDir).sort()) {
        const file = path.join(collegeDir, prog, "parsed.initial.json");
        if (!fs.existsSync(file)) continue;
        yield { id: `${idPrefix}${year}/${college}/${prog}`, year, college, prog, file };
      }
    }
  }
}

export function buildAiData() {
const bundle = readJSON(path.join(ROOT, "public", "northeastern", "programs-bundle.json"));
const bundleById = new Map(bundle.programs.map((p) => [p.id, p]));
const meta = readJSON(path.join(ROOT, "public", "data-meta.json"));
const generatedAt = new Date().toISOString();
const pageQueue = []; // filled by the loops, flushed at the page stage

const programs = [];
const seenUrls = new Map(); // url → id, for collision rails

for (const src of [...walkPrograms("majors", ""), ...walkPrograms("grad-majors", "grad/")]) {
  const parsed = readJSON(src.file);
  if (!parsed.name) throw new Error(`program without a name: ${src.file}`);

  const b = bundleById.get(src.id);
  const level = b?.level ?? (src.id.startsWith("grad/") ? "grad" : "undergrad");
  const rel = `programs/${src.year}/${level}/${slugify(src.college)}/${slugify(src.prog)}.json`;
  const url = `${JSON_ROOT}/${rel}`;

  const clash = seenUrls.get(url);
  if (clash) throw new Error(`slug collision: ${src.id} vs ${clash} → ${url}`);
  seenUrls.set(url, src.id);

  const kind = b?.type ?? (/(^|_)minor$/.test(src.prog) ? "minor" : "major");
  const pageRel = `programs/${src.year}-${level}-${slugify(src.college)}-${slugify(src.prog)}.html`;
  const { metadata, name, ...requirements } = parsed;
  const payload = {
    id: src.id,
    name,
    level,
    kind,
    catalogYear: Number(src.year),
    college: src.college,
    location: b?.location || undefined,
    totalCreditsRequired: b?.totalCreditsRequired,
    concentrationCount: b?.concentrationCount,
    verified: b?.verified ?? metadata?.verified,
    sourceUrl: b?.sourceUrl ?? metadata?.sourceUrl,
    lastEdited: metadata?.lastEdited,
    page: `${PAGE_ROOT}/${pageRel.replace(/\.html$/, "")}`,
    url,
    app: ORIGIN,
    generatedAt,
    disclaimer: DISCLAIMER,
    requirements,
  };
  writeJSON(rel, payload);
  pageQueue.push({
    year: Number(src.year),
    rel: pageRel,
    section: kind === "minor" ? "minors" : "majors",
    title: `${name} — requirements (${src.year} catalog, ${level === "grad" ? "graduate" : "undergraduate"})`,
    heading: name,
    description: `Full degree requirements for ${name} at Northeastern University (${src.year} catalog). From NU Map, a student-built planner not affiliated with Northeastern.`,
    jsonUrl: url,
    kind: "program",
    data: payload,
  });

  programs.push({
    id: src.id, name, level, kind,
    catalogYear: Number(src.year), college: src.college,
    location: b?.location || undefined,
    totalCreditsRequired: b?.totalCreditsRequired,
    page: payload.page, url,
  });
}

if (programs.length < MIN_PROGRAMS) {
  throw new Error(`rails: only ${programs.length} programs (< ${MIN_PROGRAMS}) — refusing to ship a broken export`);
}
programs.sort((a, b2) => a.id.localeCompare(b2.id));
writeJSON("programs/index.json", {
  what: "Every Northeastern program NU Map knows. `page` is the human-readable requirements page (best for reading); `url` is the full requirements JSON.",
  count: programs.length,
  generatedAt,
  disclaimer: DISCLAIMER,
  programs,
});

// ── Courses, split per subject, enriched to match the app's detail
// view (or exceed it) ────────────────────────────────────────────────
// Joins: offering-summary (availability per term, typical meeting days,
// meeting patterns, instructors with student-share) and ratemyhusky
// (professor/course review links). Adds derived data the app computes
// live: `unlocks` (every course that lists this one in its prereqs) and
// decoded term labels. Live seat snapshots are deliberately dropped:
// they are registration-time data, not live availability.

const catalog = readJSON(path.join(ROOT, "public", "northeastern", "catalog-courses.json"));
const offering = readJSON(path.join(ROOT, "public", "northeastern", "offering-summary.json"));
const rmh = readJSON(path.join(ROOT, "public", "northeastern", "ratemyhusky.json"));
const RMH = "https://ratemyhusky.com";
const rmhCourses = new Set(Array.isArray(rmh.courses) ? rmh.courses : []);
const rmhProfs = rmh.profs && typeof rmh.profs === "object" ? rmh.profs : {};

// Banner term codes: YYYY is the ACADEMIC-YEAR END year; Fall runs in
// calendar year YYYY-1. 50 is the merged full summer (AY2026+).
const TERM_LABEL = { 10: (y) => `Fall ${y - 1}`, 30: (y) => `Spring ${y}`,
  32: (y) => `Spring ${y} (Law)`, 40: (y) => `Summer A ${y}`,
  50: (y) => `Full Summer ${y}`, 52: (y) => `Summer A ${y} (Law)`, 60: (y) => `Summer B ${y}` };
const termLabel = (code) => {
  const y = parseInt(String(code).slice(0, 4), 10);
  const fn = TERM_LABEL[String(code).slice(-2)];
  return fn ? fn(y) : String(code);
};

const DOW = ["M", "T", "W", "Th", "F"];

// Reverse prereq index: walk every course's prereq tree (flat arrays
// with "And"/"Or" tokens, possibly nested) collecting course refs.
const unlocksOf = new Map(); // "SUBJ NUM" → Set of dependent course codes
const collectRefs = (node, out) => {
  if (Array.isArray(node)) { for (const n of node) collectRefs(n, out); return; }
  if (node && typeof node === "object" && node.subject && node.number) out.push(node);
};
for (const course of catalog) {
  const refs = [];
  collectRefs(course.prereqs, refs);
  for (const ref of refs) {
    const key = `${ref.subject}${ref.number}`;
    if (!unlocksOf.has(key)) unlocksOf.set(key, new Set());
    unlocksOf.get(key).add(`${course.subject} ${course.number}`);
  }
}

// "Typically offered" mirrors the app's rule: a season counts when the
// course was scheduled in at least two-thirds of that season's terms on
// record since the course first appeared in the offering data.
const seasonOf = (code) => {
  const s = String(code).slice(-2);
  if (s === "10") return "fall";
  if (s === "30" || s === "32") return "spring";
  return "summer"; // 40 / 50 / 52 / 60
};
const allTerms = [...new Set(Object.values(offering).flatMap((o) => Object.keys(o.e ?? {})))].sort();
const typicallyOffered = (off) => {
  const mine = Object.keys(off?.e ?? {}).sort();
  if (!mine.length) return undefined;
  const first = mine[0];
  const out = [];
  for (const season of ["fall", "spring", "summer"]) {
    const universe = allTerms.filter((t) => t >= first && seasonOf(t) === season).length;
    const hits = mine.filter((t) => seasonOf(t) === season).length;
    if (universe > 0 && hits / universe >= 2 / 3) out.push(season);
  }
  return out.length ? out : undefined;
};

const enrich = (course) => {
  const { sections, ...rest } = course;
  const code = `${course.subject}${course.number}`;
  const off = offering[code];

  let offerings;
  if (off) {
    const terms = {};
    for (const t of Object.keys(off.e ?? {}).sort()) {
      terms[t] = { term: termLabel(t), sections: off.s?.[t], enrolled: off.e?.[t], capacity: off.c?.[t] };
    }
    offerings = {
      terms,
      typicalDays: Array.isArray(off.dow) ? DOW.filter((_, i) => (off.dow[i] ?? 0) >= 50) : undefined,
      daysPct: Array.isArray(off.dow)
        ? Object.fromEntries(DOW.map((d, i) => [d, off.dow[i] ?? 0]))
        : undefined,
      meetingPatterns: off.pat,
      campuses: off.cmp,
      formats: off.fmt,
    };
  }

  let instructors;
  if (off?.prof) {
    instructors = {};
    for (const [season, list] of Object.entries(off.prof)) {
      instructors[season] = list.map(([name, sharePct]) => ({
        name, sharePct,
        ...(rmhProfs[name] ? { reviews: `${RMH}/professors/${rmhProfs[name]}` } : {}),
      }));
    }
  }

  const unlocks = unlocksOf.get(code);
  const typical = typicallyOffered(off);
  return {
    ...rest,
    level: parseInt(course.number, 10) < 5000 ? "undergrad" : "grad",
    ...(typical ? { typicallyOffered: typical } : {}),
    catalogUrl: `https://catalog.northeastern.edu/course-descriptions/${course.subject.toLowerCase()}/`,
    ...(rmhCourses.has(code) ? { reviews: `${RMH}/courses/${code}` } : {}),
    ...(offerings ? { offerings } : {}),
    ...(instructors ? { instructors } : {}),
    ...(unlocks ? { unlocks: [...unlocks].sort() } : {}),
  };
};

// ── Cross-page link helpers ──────────────────────────────────────────
// Defined before the subject loop because listing tables use them at
// queue time (const = TDZ if defined later).
const titleOf = new Map();
for (const c of catalog) if (c.subject && c.number) titleOf.set(`${c.subject} ${c.number}`, c.title);

const linkRef = (subject, number) => {
  const code = `${subject} ${number}`;
  return titleOf.has(code)
    ? `<a href="${PAGE_ROOT}/courses/${subject}/${number}" title="${escapeHtml(titleOf.get(code) ?? "")}">${escapeHtml(code)}</a>`
    : escapeHtml(code);
};
const linkCode = (code) => {
  const m = /^([A-Z]{2,6})\s?(\S+)$/.exec(code);
  return m ? linkRef(m[1], m[2]) : escapeHtml(code);
};
// Prereq logic as an indented tree: "one of:" / "all of:" labels with
// nested lists, so the logical hierarchy reads at a glance.
const prereqLeaf = (node) =>
  `${linkRef(node.subject, node.number)}${node.minGrade ? ` <span class="muted">(min ${escapeHtml(node.minGrade)})</span>` : ""}`;
const prereqTreeItems = (node) => {
  if (Array.isArray(node)) {
    const op = node.find((t) => typeof t === "string");
    const items = node.filter((t) => typeof t !== "string").map(prereqTreeItems).filter(Boolean);
    if (!items.length) return "";
    if (items.length === 1) return items[0];
    return `<li><span class="muted">${String(op).toLowerCase() === "or" ? "one of" : "all of"}:</span><ul>${items.join("")}</ul></li>`;
  }
  if (node && node.subject) return `<li>${prereqLeaf(node)}</li>`;
  return "";
};
const prereqTree = (node) => {
  const items = prereqTreeItems(node);
  return items ? `<ul class="req">${items}</ul>` : "";
};

// ── Professors ───────────────────────────────────────────────────────
// Built BEFORE the subject loop so instructor names in course tables can
// link straight to each professor's own page. Every professor gets a tiny
// page of their own (a 2 KB page can never truncate in a fetch tool);
// letter pages are just name directories.
const professors = new Map(); // name → { courses: Map(code → Map(season → sharePct)) }
for (const [code, off] of Object.entries(offering)) {
  if (!off?.prof) continue;
  const m = /^([A-Z]{2,6})(\d+\w*)$/.exec(code);
  const label = m ? `${m[1]} ${m[2]}` : code;
  for (const [season, list] of Object.entries(off.prof)) {
    for (const [name, sharePct] of list) {
      if (!professors.has(name)) professors.set(name, { courses: new Map() });
      const p = professors.get(name);
      if (!p.courses.has(label)) p.courses.set(label, new Map());
      p.courses.get(label).set(season, sharePct);
    }
  }
}
const profNames = [...professors.keys()].sort((a, b2) => a.localeCompare(b2));
// Deterministic slugs: sorted names, collisions get -2, -3, …
const profSlugOf = new Map();
{
  const taken = new Map();
  for (const name of profNames) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
      || "p" + [...name].reduce((h, ch) => (h * 31 + ch.codePointAt(0)) >>> 0, 0);
    const n = (taken.get(base) ?? 0) + 1;
    taken.set(base, n);
    profSlugOf.set(name, n === 1 ? base : `${base}-${n}`);
  }
}
const profLetterOf = (name) => (/^[A-Za-z]/.test(name) ? name[0].toUpperCase() : "_");
const profLink = (name) =>
  `<a href="${PAGE_ROOT}/professors/${profSlugOf.get(name)}">${escapeHtml(name)}</a>`;

// ── Subject JSON + course/subject pages ──────────────────────────────
const bySubject = new Map();
for (const course of catalog) {
  if (!course.subject || !course.number) continue;
  if (!bySubject.has(course.subject)) bySubject.set(course.subject, []);
  bySubject.get(course.subject).push(enrich(course));
}
if (bySubject.size < MIN_SUBJECTS || catalog.length < MIN_COURSES) {
  throw new Error(`rails: ${catalog.length} courses / ${bySubject.size} subjects — refusing to ship a broken export`);
}

const subjects = [];
for (const [subject, courses] of [...bySubject.entries()].sort(([a], [b2]) => a.localeCompare(b2))) {
  if (!/^[A-Z]{2,6}$/.test(subject)) throw new Error(`unexpected subject code: "${subject}"`);
  courses.sort((a, b2) => a.number.localeCompare(b2.number));
  const url = `${JSON_ROOT}/courses/${subject}.json`;
  // The subject file is the FILTER INDEX: every field a query can filter
  // on, one compact row per course, small enough that no fetch tool
  // truncates it. Everything heavyweight (description prose, per-term
  // enrollment, meeting-pattern and instructor-share percentages) answers
  // single-course questions, so it lives one hop away at the course's
  // `detail` page - whose literal URL rides in each row.
  const slim = courses.map((c) => ({
    number: c.number,
    title: c.title,
    credits: c.credits,
    ...(c.creditsMax ? { creditsMax: c.creditsMax } : {}),
    level: c.level,
    ...(c.typicallyOffered ? { typicallyOffered: c.typicallyOffered } : {}),
    ...(c.nuPath?.length ? { nuPath: c.nuPath } : {}),
    ...(c.prereqs?.length ? { prereqs: c.prereqs } : {}),
    ...(c.coreqs?.length ? { coreqs: c.coreqs } : {}),
    ...(c.repeatable ? { repeatable: c.repeatable } : {}),
    ...(c.offerings?.typicalDays?.length ? { typicalDays: c.offerings.typicalDays } : {}),
    ...(c.offerings?.campuses?.length ? { campuses: c.offerings.campuses } : {}),
    ...(c.instructors
      ? { instructors: [...new Set(Object.values(c.instructors).flat().map((i) => i.name))].sort() }
      : {}),
    ...(c.unlocks ? { unlocks: c.unlocks } : {}),
    detail: `${PAGE_ROOT}/courses/${subject}/${c.number}`,
  }));
  const subjectPayload = {
    subject,
    count: courses.length,
    what: "Compact filterable index of every course in this subject. Full detail per course - description, offering history with enrollment, meeting-day and instructor-share percentages, RateMyHusky links - is at its `detail` page (copy the URL verbatim).",
    lastUpdated: meta.lastUpdated,
    generatedAt,
    disclaimer: DISCLAIMER,
    legend: {
      prereqs: "Flat token list: course refs {subject, number, minGrade} joined by 'And'/'Or' strings; nested arrays are parenthesized groups. minGrade is the minimum passing grade required.",
      coreqs: "Courses that must be taken in the same term.",
      level: "undergrad for course numbers below 5000, grad otherwise.",
      typicallyOffered: "Seasons in which the course was scheduled in at least two-thirds of that season's terms on record since it first appeared — a pattern, not a guarantee.",
      typicalDays: "Weekdays on which at least 50% of recent sections met (R means Thursday).",
      instructors: "Names of everyone who taught it in recent terms; per-season shares and review links are on the detail page.",
      unlocks: "Courses that list this course in their prerequisites — what taking it opens up.",
      nuPath: "NUpath general-education attributes this course carries.",
      repeatable: "Whether the course may be taken more than once for credit.",
      detail: "This course's full page: description, offering history, percentages, professors. Fetch it for any single-course question.",
    },
    courses: slim,
  };
  writeJSON(`courses/${subject}.json`, subjectPayload);

  // Subject page: a COMPACT table (no description bodies — full dumps
  // overflowed AI fetch contexts), linking each course's own page.
  const rows = courses.map((c) => {
    const pageUrl = `${PAGE_ROOT}/courses/${subject}/${c.number}`;
    return `<tr><td><a href="${pageUrl}">${escapeHtml(`${subject} ${c.number}`)}</a></td>`
      + `<td>${escapeHtml(c.title)}</td>`
      + `<td>${c.credits}${c.creditsMax ? `–${c.creditsMax}` : ""}</td>`
      + `<td>${c.level === "grad" ? "grad" : "ug"}</td>`
      + `<td>${c.typicallyOffered ? escapeHtml(c.typicallyOffered.join(", ")) : ""}</td>`
      + `<td>${c.nuPath?.length ? escapeHtml(c.nuPath.join(", ")) : ""}</td>`
      + `<td class="muted">${prereqTree(c.prereqs)}</td>`
      + `<td class="muted nowrap">${(() => {
        if (!c.instructors) return "";
        const names = [...new Set(Object.values(c.instructors).flat().map((i) => i.name))].sort();
        return names.map(profLink).join("<br>");
      })()}</td></tr>`;
  }).join("\n");
  pageQueue.push({
    rel: `courses/${subject}.html`,
    section: "courses",
    wide: true,
    title: `${subject} courses at Northeastern — prerequisites, offerings, instructors`,
    heading: `${subject} courses`,
    description: `Every Northeastern ${subject} course with prerequisites, typical offerings and NUpath, linking full detail pages. From NU Map, a student-built planner not affiliated with Northeastern.`,
    jsonUrl: url,
    body: `<table>\n<tr><th>Code</th><th>Title</th><th>SH</th><th>Level</th><th>Usually offered</th><th>NUpath</th><th>Prerequisites</th><th>Recent instructors</th></tr>\n${rows}\n</table>`
      + `<p class="muted">Instructors are from recent scheduled terms; each course page shows them per season with student shares. Blank means no recent scheduled sections on record.</p>`,
  });

  // Per-course pages: small (a few KB), never truncated, and shaped
  // like the queries people actually type ("CS 2500 prerequisites").
  for (const c of courses) {
    pageQueue.push({
      rel: `courses/${subject}/${c.number}.html`,
      section: "courses",
      title: `${subject} ${c.number} — ${c.title} | prerequisites, offerings, professors (Northeastern)`,
      heading: `${subject} ${c.number} — ${c.title}`,
      description: `${subject} ${c.number} ${c.title} at Northeastern: prerequisites, corequisites, offering history, typical meeting days, instructors with student shares, and what it unlocks. From NU Map (not affiliated with Northeastern).`,
      jsonUrl: url,
      kind: "course",
      subject,
      data: c,
    });
  }
  subjects.push({ subject, count: courses.length, page: `${PAGE_ROOT}/courses/${subject}`, url });
}

// ── Professor JSON (letter files with per-season shares) ─────────────
const profsByLetter = new Map();
for (const name of profNames) {
  const letter = profLetterOf(name);
  if (!profsByLetter.has(letter)) profsByLetter.set(letter, {});
  const p = professors.get(name);
  profsByLetter.get(letter)[name] = {
    page: `${PAGE_ROOT}/professors/${profSlugOf.get(name)}`,
    ...(rmhProfs[name] ? { reviews: `${RMH}/professors/${rmhProfs[name]}` } : {}),
    courses: Object.fromEntries([...p.courses.entries()].sort(([a], [b2]) => a.localeCompare(b2))
      .map(([c, seasons]) => [c, Object.fromEntries([...seasons.entries()].sort(([a], [b2]) => a.localeCompare(b2)))])),
  };
}
const profLetters = {};
for (const [letter, profs] of [...profsByLetter.entries()].sort(([a], [b2]) => a.localeCompare(b2))) {
  writeJSON(`professors/${letter}.json`, {
    what: `Instructors whose name starts with "${letter}". courses maps each course to per-season share: the professor's average percent of that season's enrolled students in recent terms (~3 years).`,
    count: Object.keys(profs).length,
    lastUpdated: meta.lastUpdated,
    generatedAt,
    disclaimer: DISCLAIMER,
    professors: profs,
  });
  profLetters[letter] = { count: Object.keys(profs).length, url: `${JSON_ROOT}/professors/${letter}.json` };
}
writeJSON("professors.json", {
  what: "Index of instructors, split by first letter of name so each file stays small. Fetch the letter file for the professor you need; use for professor-based course search.",
  note: "Derived from recent scheduled terms; 'reviews' links RateMyHusky when a profile exists. A few course codes are from recently scheduled terms but no longer in the catalog (retired/renumbered).",
  count: professors.size,
  lastUpdated: meta.lastUpdated,
  generatedAt,
  disclaimer: DISCLAIMER,
  letters: profLetters,
});

// ── NUpath reverse index ─────────────────────────────────────────────
// 13 codes, not 12: competency 9 (writing) is awarded as WF/WD/WI.
const NUPATH_LABELS = {
  ND: "Natural/Designed World", EI: "Creative Expression/Innovation",
  IC: "Interpreting Culture", FQ: "Formal/Quantitative Reasoning",
  SI: "Societies/Institutions", AD: "Analyzing/Using Data",
  DD: "Difference/Diversity", ER: "Ethical Reasoning",
  WF: "First-Year Writing", WD: "Advanced Writing in the Disciplines",
  WI: "Writing Intensive", EX: "Integration Experience", CE: "Capstone Experience",
};
const nupath = Object.fromEntries(Object.entries(NUPATH_LABELS).map(([code, label]) => [code, { label, page: `${PAGE_ROOT}/nupath/${code}`, courses: [] }]));
for (const course of catalog) {
  for (const code of course.nuPath ?? []) {
    if (nupath[code]) nupath[code].courses.push(`${course.subject} ${course.number}`);
  }
}
for (const entry of Object.values(nupath)) entry.courses.sort();
writeJSON("nupath.json", {
  what: "Which courses satisfy each NUpath attribute (Northeastern's general-education grid).",
  note: "13 codes, not 12: the writing competency is awarded as three (WF, WD, WI).",
  lastUpdated: meta.lastUpdated,
  generatedAt,
  disclaimer: DISCLAIMER,
  nupath,
});
writeJSON("courses/index.json", {
  what: "Northeastern's course catalog, split into one JSON file per subject code. `page` is the human-readable listing.",
  courseCount: catalog.length,
  subjectCount: subjects.length,
  titles: `${JSON_ROOT}/courses/titles.json`,
  lastUpdated: meta.lastUpdated,
  generatedAt,
  disclaimer: DISCLAIMER,
  subjects,
});

// ── Titles index: one-fetch topic search across ALL courses ─────────
const titles = Object.fromEntries(
  catalog
    .filter((c) => c.subject && c.number)
    .map((c) => [`${c.subject} ${c.number}`, c.title])
    .sort(([a], [b2]) => a.localeCompare(b2))
);
writeJSON("courses/titles.json", {
  what: "Every course code mapped to its title — fetch this ONE file to search courses by topic, then open the subject page or JSON for details on the matches.",
  count: Object.keys(titles).length,
  lastUpdated: meta.lastUpdated,
  generatedAt,
  disclaimer: DISCLAIMER,
  titles,
});

// ── The page layer ───────────────────────────────────────────────────
// Human-readable pages ARE the primary surface, for people and machines
// alike: small, fully expanded, real links. Sidebar navigation on every
// page, catalog-style. A page either has a rendered body or the build
// fails — there is no raw-JSON fallback.

const pageUrls = [];

const PAGE_CSS =
  "*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,sans-serif;line-height:1.55;color:#1e293b}"
  + "a{color:#dc2626;text-decoration:none}a:hover{text-decoration:underline}"
  // Ghost rail: the nav rests faint and fades in on hover. No pills — the
  // filing slide-out plus darkening is the whole hover language; the
  // current page is red and semibold, permanently slid out.
  + "nav{position:fixed;left:0;top:0;bottom:0;width:190px;display:flex;flex-direction:column;"
  + "font-size:.92rem;opacity:.25;transition:opacity .25s ease}"
  + "nav:hover,nav:focus-within{opacity:1}"
  + "nav .sections{flex:1;display:flex;flex-direction:column;justify-content:center;gap:6px;padding:18px 14px}"
  + "nav .sections a{display:block;padding:4px 14px;color:#64748b;"
  + "transition:transform .16s ease,color .16s ease}"
  + "nav .sections a:hover{transform:translateX(6px);color:#0f172a;text-decoration:none}"
  + "nav .sections a.here{color:#dc2626;font-weight:600;transform:translateX(6px)}"
  + "nav .aux{padding:14px 14px 20px}"
  + "nav .aux a{display:block;color:#94a3b8;font-size:.82rem;padding:3px 14px}"
  + "nav .aux a:hover{color:#475569}"
  // Main truly centers on the viewport when there's room; when the window
  // is too narrow for that, it clears the rail instead.
  + ".layout{padding-left:0}"
  + "main{max-width:780px;margin-left:max(190px,calc((100vw - 780px)/2));margin-right:auto;"
  + "min-width:0;padding:26px 24px 48px;overflow-x:auto}"
  // Table-heavy pages (subject listings) widen with the viewport so each
  // prereq entry and professor name can hold a full unwrapped line.
  + "main.wide{max-width:1240px;margin-left:max(190px,calc((100vw - 1240px)/2))}"
  + ".nowrap{white-space:nowrap}"
  + ".twocol{display:flex;gap:64px;flex-wrap:wrap;justify-content:center}"
  + "ul.letters{list-style:none;margin:.3em 0;padding:0}ul.letters li{margin:2px 0}"
  + ".namelist{width:max-content;max-width:100%;margin:0 auto;list-style:none;padding:0}"
  + ".namelist li{margin:3px 0}"
  // The hub reads as a title card: heading centered, the whole block
  // vertically centered in the viewport. Its directory is a definition
  // list: section name on its own line, description tucked beneath in
  // smaller muted text, one shared left edge.
  + "main.hub{display:flex;flex-direction:column;justify-content:center;min-height:100vh;padding-top:0;padding-bottom:0}"
  + "main.hub h1{text-align:center;margin-bottom:.6em}"
  + ".dir{width:max-content;max-width:100%;margin:0 auto}"
  + ".dir dt{margin-top:1.05em;font-size:1.02rem}"
  + ".dir dd{margin:.1em 0 0;color:#64748b;font-size:.9rem;max-width:34em}"
  + "td ul.req li{white-space:nowrap}"
  + "@media(max-width:760px){nav{position:static;width:auto;opacity:1;"
  + "display:flex;flex-direction:row;flex-wrap:wrap;gap:2px 14px;padding:12px 16px 0}"
  + "nav .sections{display:contents}nav .aux{display:contents}"
  + "nav .sections a,nav .aux a{padding:3px 0;margin:0;font-size:.88rem}"
  + "nav .sections a:hover,nav .sections a.here{transform:none}"
  + "main,main.wide{margin:0 auto}}"
  + "h1{font-size:1.55rem;margin:.1em 0 .3em}"
  + "h2{font-size:1.12rem;margin:1.6em 0 .5em;padding-bottom:.25em;border-bottom:1px solid #e2e8f0}"
  + "h3{font-size:1rem;margin:1.2em 0 .4em}"
  + "table{border-collapse:collapse;width:100%;font-size:.92rem}"
  + "th{text-align:left;background:#f8fafc}th,td{padding:6px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top}"
  + ".chips{margin:.4em 0}.chips span{display:inline-block;background:#f1f5f9;border-radius:999px;padding:2px 12px;margin:2px 4px 2px 0;font-size:.85rem;color:#334155}"
  + ".muted{color:#64748b;font-size:.88rem}"
  + "th.dim,td.dim{color:#94a3b8}"
  + "td ul{margin:0;padding-left:1.1em}td ul ul{padding-left:1.1em}"
  + "ul.req{padding-left:1.2em}ul.req ul{padding-left:1.2em}li{margin:.15em 0}"
  + "details{margin:.5em 0;border:1px solid #e2e8f0;border-radius:10px;padding:.5em .9em}summary{cursor:pointer;font-weight:600}"
  + "footer{margin-top:2.5em;border-top:1px solid #e2e8f0;padding-top:1em;font-size:.82rem;color:#64748b}"
  + "footer code{background:#f1f5f9;padding:0 4px;border-radius:4px;word-break:break-all}"
  + "footer details{border:none;padding:0;margin:0 0 .9em}footer summary{font-weight:400;color:#cbd5e1}"
  + "footer summary:hover{color:#94a3b8}"
  + "footer.tidy{border-top:none;text-align:center;margin-top:1.6em}"
  + "footer.tidy summary{display:inline-block}"
  + "footer.tidy .inner{text-align:left;margin-top:1em;border-top:1px solid #f1f5f9;padding-top:1em}"
  + "pre{white-space:pre-wrap;word-break:break-word;background:#f8fafc;padding:10px;border-radius:8px;font-size:.85rem}";

const NAV_SECTIONS = [
  ["home", "Overview", PAGE_ROOT],
  ["courses", "Courses", `${PAGE_ROOT}/courses`],
  ["majors", "Majors", `${PAGE_ROOT}/majors`],
  ["minors", "Minors", `${PAGE_ROOT}/minors`],
  ["nupath", "NUpath", `${PAGE_ROOT}/nupath`],
  ["professors", "Professors", `${PAGE_ROOT}/professors`],
  ["equivalences", "Equivalences", `${PAGE_ROOT}/equivalences`],
];

// rel "index.html" is the hub, written to dist/data.html and served at /data.
const writePage = ({ rel, section, title, heading, description, jsonUrl, body, wide }) => {
  if (typeof body !== "string") throw new Error(`page without a rendered body: ${rel}`);
  const isHub = rel === "index.html";
  const p = isHub ? path.join(ROOT, "dist", "data.html") : path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // Pages "pretty URLs" 308-redirect any *.html to its extensionless twin,
  // so canonicals and the sitemap must use the extensionless form.
  const url = isHub ? PAGE_ROOT : `${PAGE_ROOT}/${rel.replace(/\.html$/, "")}`;
  pageUrls.push(url);
  const nav = `<div class="sections">` + NAV_SECTIONS.map(([id, label, href]) =>
    `<a href="${href}"${id === section ? ` class="here"` : ""}>${label}</a>`).join("")
    + `</div><div class="aux"><a href="${ORIGIN}">numap.app</a><a href="${ORIGIN}/story">the story</a><a href="${ORIGIN}/llms.txt">AI data guide</a>`
    + (jsonUrl ? `<a href="${jsonUrl}">JSON of this page</a>` : `<a href="${JSON_ROOT}/index.json">JSON API</a>`)
    + `</div>`;
  // The disclaimer is its own bottom section on every page: a hairline bar
  // (the footer's border-top), the disclaimer, the freshness stamp centered
  // on its own line, then the collapsed AI note directly beneath.
  const disclaimerText = `NU Map is an independent, student-built planner — not affiliated
with, endorsed by, or officially connected to Northeastern University. Data comes
from the public catalog on a schedule; confirm with the official catalog and an
advisor.`;
  const stamp = `Data updated ${escapeHtml(meta.lastUpdated)} · page generated ${generatedAt.slice(0, 10)}.`;
  const aiInner = `<p>Full guide: <a href="${ORIGIN}/llms.txt">https://numap.app/llms.txt</a>. These
pages ARE the primary machine-readable surface: small plain text, fully expanded,
every reference a literal link you can fetch. Directories: <code>${PAGE_ROOT}/courses</code>
(a page per subject and per course, pattern <code>${PAGE_ROOT}/courses/{SUBJECT}/{NUMBER}</code>),
<code>${PAGE_ROOT}/majors</code> and <code>${PAGE_ROOT}/minors</code>,
<code>${PAGE_ROOT}/nupath</code>, <code>${PAGE_ROOT}/professors</code>,
<code>${PAGE_ROOT}/equivalences</code>.</p>
<ul>
<li>Structured JSON (developer API): <code>${JSON_ROOT}/index.json</code> lists every
file; all course titles in one file: <code>${JSON_ROOT}/courses/titles.json</code>.</li>
<li>If your fetch tool refuses URLs found on this page (claude.ai's does), navigate
by web search instead — results of a search ARE fetchable:
<code>site:numap.app/data &lt;subject, course, professor, or program name&gt;</code>.
Or ask the user to paste the exact URL you need as their next message.</li>
</ul>`;
  // The hub stays extraordinarily clean: everything below the section list
  // is one faint centered line that expands on click. Interior pages keep
  // the visible disclaimer + stamp.
  const footer = isHub
    ? `<footer class="tidy">
<details>
<summary>About this data — for humans, AI assistants, and developers</summary>
<div class="inner">
<p class="muted">${disclaimerText}</p>
${aiInner}
<p class="muted" style="text-align:center">${stamp}</p>
</div>
</details>
</footer>`
    : `<footer>
<details>
<summary>For AI assistants — reaching any other NU Map data from this page</summary>
${aiInner}
</details>
<p class="muted">${disclaimerText}</p>
<p class="muted" style="text-align:center">${stamp}</p>
</footer>`;
  fs.writeFileSync(p, `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" />
<title>${isHub ? "Data - NU Map" : `${escapeHtml(title)} - NU Map Data`}</title>
<meta name="description" content="${escapeHtml(description)}" />
<link rel="canonical" href="${url}" />
<link rel="icon" type="image/png" href="${ORIGIN}/northeastern/dev_logo.png" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>${PAGE_CSS}</style>
</head><body>
<div class="layout">
<nav>${nav}</nav>
<main class="${[isHub ? "hub" : "", wide ? "wide" : ""].filter(Boolean).join(" ")}">
<h1>${escapeHtml(heading ?? title)}</h1>
${body}
${footer}
</main>
</div>
</body></html>`);
};

// ── Renderers: one per page kind ─────────────────────────────────────
const chips = (arr) => `<p class="chips">${arr.filter(Boolean).map((x) => `<span>${x}</span>`).join("")}</p>`;
const SEASON_LABEL = { fall: "Fall", spring: "Spring", summer: "Summer", sumA: "Summer A", sumB: "Summer B" };
const seasonLabel = (s) => SEASON_LABEL[s] ?? s;
const SEASON_ORDER = ["fall", "spring", "summer", "sumA", "sumB"];
const seasonSort = (a, b2) => {
  const ia = SEASON_ORDER.indexOf(a), ib = SEASON_ORDER.indexOf(b2);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b2);
};

const COURSE_KNOWN = new Set([
  "subject", "number", "title", "scheduleType", "credits", "creditsMax", "nuPath",
  "description", "coreqs", "prereqs", "level", "typicallyOffered", "catalogUrl",
  "reviews", "offerings", "instructors", "unlocks", "repeatable", "repeatMax", "repeatMaxSH",
  "minGPA",
]);
const renderCourse = (subject, c) => {
  const out = [];
  out.push(chips([
    `${c.credits}${c.creditsMax ? `–${c.creditsMax}` : ""} semester hours`,
    c.level === "grad" ? "Graduate" : "Undergraduate",
    c.scheduleType ? escapeHtml(c.scheduleType) : null,
    ...(c.nuPath ?? []).map((n) => `NUpath ${escapeHtml(n)}`),
    c.typicallyOffered?.length ? `usually offered: ${c.typicallyOffered.join(", ")}` : null,
    c.offerings?.typicalDays?.length ? `typical days: ${c.offerings.typicalDays.join("/")}` : null,
    ...(c.offerings?.campuses ?? []).map(escapeHtml),
    ...(c.offerings?.formats ?? []).map(escapeHtml),
    c.repeatable ? "repeatable for credit" : null,
    c.minGPA ? `requires a ${c.minGPA} GPA` : null,
  ]));
  if (c.description) out.push(`<p>${escapeHtml(c.description)}</p>`);
  if (c.prereqs?.length) out.push(`<h2>Prerequisites</h2>${prereqTree(c.prereqs)}`);
  if (c.coreqs?.length) out.push(`<h2>Corequisites (same term)</h2>${prereqTree(c.coreqs)}`);

  const terms = c.offerings?.terms && Object.keys(c.offerings.terms).length ? c.offerings.terms : null;
  if (terms) {
    out.push(`<h2>Offering history</h2><table><tr><th>Term</th><th>Sections</th><th>Enrolled</th><th>Capacity</th><th class="dim">Full</th><th class="dim">Open seats/section</th></tr>`
      + Object.keys(terms).sort().map((k) => {
        const t = terms[k];
        const full = t.capacity > 0 && t.enrolled != null ? `${Math.round((t.enrolled / t.capacity) * 100)}%` : "";
        const open = t.sections > 0 && t.capacity != null && t.enrolled != null
          ? String(Math.max(0, Math.round((t.capacity - t.enrolled) / t.sections))) : "";
        return `<tr><td>${escapeHtml(t.term ?? k)}</td><td>${t.sections ?? ""}</td><td>${t.enrolled ?? ""}</td><td>${t.capacity ?? ""}</td><td class="dim">${full}</td><td class="dim">${open}</td></tr>`;
      }).join("")
      + `</table><p class="muted">Snapshots from scheduled scrapes — not live seat availability. "Full" can exceed 100% when sections over-enroll.</p>`);
  }
  if (c.offerings?.daysPct || c.offerings?.meetingPatterns?.length) {
    out.push(`<h2>Meeting times</h2>`);
    if (c.offerings.daysPct) {
      out.push(`<p>Share of recent sections by weekday: ${Object.entries(c.offerings.daysPct)
        .map(([d, pct]) => `${d} ${pct}%`).join(" · ")}</p>`);
    }
    if (c.offerings.meetingPatterns?.length) {
      out.push(`<p>Common patterns: ${c.offerings.meetingPatterns
        .map(([pat, pct]) => `${escapeHtml(pat)} (${pct}% of sections)`).join(", ")}
        <span class="muted">— in patterns, R means Thursday</span></p>`);
    }
  }
  if (c.instructors) {
    const seasons = Object.keys(c.instructors).sort(seasonSort);
    out.push(`<h2>Professors</h2>` + seasons.map((s) =>
      `<h3>${escapeHtml(seasonLabel(s))}</h3><ul>` + c.instructors[s].map((i) =>
        `<li>${profLink(i.name)} <span class="muted">(${i.sharePct}% of students)</span>${i.reviews ? ` · <a href="${i.reviews}">reviews</a>` : ""}</li>`
      ).join("") + `</ul>`).join("")
      + `<p class="muted">Percentages are each professor's average share of the season's enrolled students in recent terms.</p>`);
  }
  if (c.unlocks?.length) {
    out.push(`<h2>Unlocks</h2><p>${c.unlocks.map(linkCode).join(", ")}</p>`
      + `<p class="muted">Courses that list ${escapeHtml(`${subject} ${c.number}`)} in their prerequisites.</p>`);
  }
  const links = [
    c.catalogUrl ? `<a href="${c.catalogUrl}">Official catalog (${escapeHtml(subject)} course descriptions)</a>` : null,
    c.reviews ? `<a href="${c.reviews}">Student reviews on RateMyHusky</a>` : null,
    `<a href="${PAGE_ROOT}/courses/${subject}">All ${escapeHtml(subject)} courses</a>`,
    `<a href="${ORIGIN}">Plan it at numap.app</a>`,
  ].filter(Boolean);
  out.push(`<h2>Links</h2><p>${links.join(" · ")}</p>`);

  // Parity net: any field the template doesn't know still ships, so the
  // page never silently loses data.
  const leftover = Object.keys(c).filter((k) => !COURSE_KNOWN.has(k));
  if (leftover.length) {
    out.push(`<h2>More</h2><pre>${escapeHtml(JSON.stringify(Object.fromEntries(leftover.map((k) => [k, c[k]])), null, 1))}</pre>`);
  }
  return out.join("\n");
};

// Program requirements: the parser's node tree, rendered recursively.
const renderNode = (n) => {
  if (!n || typeof n !== "object") return `<li>${escapeHtml(String(n))}</li>`;
  switch (n.type) {
    case "COURSE": {
      const t = titleOf.get(`${n.subject} ${n.classId}`);
      return `<li>${linkRef(n.subject, n.classId)}${t ? ` — ${escapeHtml(t)}` : ""}</li>`;
    }
    case "AND":
      return `<li>All of:<ul>${(n.courses ?? []).map(renderNode).join("")}</ul></li>`;
    case "OR":
      return `<li>One of:<ul>${(n.courses ?? []).map(renderNode).join("")}</ul></li>`;
    case "XOM": {
      const want = n.numCreditsMin != null ? `${n.numCreditsMin} semester hours`
        : n.numRequired != null ? `${n.numRequired} course${n.numRequired === 1 ? "" : "s"}` : "courses";
      return `<li>Choose ${want} from:<ul>${(n.courses ?? []).map(renderNode).join("")}</ul></li>`;
    }
    case "RANGE": {
      const ex = (n.exceptions ?? []).map((e) => linkRef(e.subject, e.classId)).join(", ");
      return `<li>Any ${escapeHtml(n.subject)} course numbered ${n.idRangeStart}–${n.idRangeEnd}${ex ? ` <span class="muted">(except ${ex})</span>` : ""}</li>`;
    }
    case "EXCLUDE":
      return `<li><span class="muted">Excluding</span> ${linkRef(n.subject, n.classId)}</li>`;
    case "SECTION":
      return `<li><strong>${escapeHtml(n.title ?? "")}</strong>${sectionInner(n)}</li>`;
    default:
      // Unknown node kinds must stay visible rather than vanish.
      return `<li><pre>${escapeHtml(JSON.stringify(n, null, 1))}</pre></li>`;
  }
};
const sectionInner = (s) => {
  const reqs = s.requirements ?? [];
  const note = s.minRequirementCount != null && s.minRequirementCount < reqs.length
    ? `<p class="muted">Complete ${s.minRequirementCount} of the following:</p>` : "";
  return `${note}<ul class="req">${reqs.map(renderNode).join("")}</ul>`;
};
const prettyWords = (s) => String(s ?? "").replace(/[-_]+/g, " ").replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
const renderProgram = (p) => {
  const r = p.requirements ?? {};
  const out = [];
  out.push(chips([
    p.level === "grad" ? "Graduate" : "Undergraduate",
    escapeHtml(p.kind ?? "major"),
    `${p.catalogYear} catalog`,
    p.college ? escapeHtml(prettyWords(p.college)) : null,
    p.location ? escapeHtml(p.location) : null,
    r.totalCreditsRequired ? `${r.totalCreditsRequired} semester hours total` : null,
    p.verified ? "verified parse" : "unverified parse — check the source",
  ]));
  if (p.sourceUrl) out.push(`<p><a href="${p.sourceUrl}">Official catalog page for this program</a></p>`);
  for (const s of r.requirementSections ?? []) {
    out.push(`<h2>${escapeHtml(s.title ?? "Requirements")}</h2>${sectionInner(s)}`);
  }
  if (r.concentrations?.concentrationOptions?.length) {
    const con = r.concentrations;
    out.push(`<h2>Concentrations${con.minOptions ? ` <span class="muted">(choose ${con.minOptions})</span>` : ""}</h2>`
      + con.concentrationOptions.map((o) =>
        `<h3>${escapeHtml(o.label ?? o.title ?? "Concentration")}</h3>${sectionInner(o)}`).join(""));
  }
  if (r.gpaRequirements?.length) {
    out.push(`<h2>GPA requirements</h2><ul>${r.gpaRequirements.map((g) => `<li>${escapeHtml(g.text ?? g.title ?? "")}</li>`).join("")}</ul>`);
  }
  if (r.generalElectiveSH) {
    out.push(`<p>Plus ${r.generalElectiveSH} semester hours of general electives.</p>`);
  }
  out.push(`<p class="muted">Parsed from the catalog by NU Map; the <a href="${p.url}">JSON version</a> is the structured machine copy${p.sourceUrl ? `, and the <a href="${p.sourceUrl}">official page</a> is the authority` : ""}.</p>`);
  return out.join("\n");
};

// ── Directory and cross-cutting pages ────────────────────────────────
const equivalencesData = readJSON(path.join(ROOT, "public", "northeastern", "course-equivalences.json"));
const TIER_LABEL = {
  A: "A — a program explicitly allows either course",
  B: "B — catalog-stated equivalents / cross-listings",
  C: "C — inferred from shared usage; needs advisor approval",
  D: "D — weak signals only",
};

pageQueue.push({
  rel: "courses.html",
  section: "courses",
  title: "All Northeastern subjects — course listings",
  heading: "Subjects",
  description: "Directory of all Northeastern subject codes with course counts; each links a full listing with prerequisites, offerings and NUpath. From NU Map (not affiliated with Northeastern).",
  jsonUrl: `${JSON_ROOT}/courses/index.json`,
  body: `<table><tr><th>Subject</th><th>Courses</th><th></th></tr>`
    + subjects.map((s) => `<tr><td><a href="${s.page}">${s.subject}</a></td><td>${s.count}</td><td class="muted"><a href="${s.url}">JSON</a></td></tr>`).join("")
    + `</table>`,
});

{
  const newest = Math.max(...pageQueue.filter((q) => q.year).map((q) => q.year));
  const current = pageQueue.filter((m) => m.kind === "program" && m.year === newest);
  const directory = (kindLabel, wanted) => {
    const byLevel = { undergrad: new Map(), grad: new Map() };
    for (const m of current) {
      const p = m.data;
      if ((p.kind === "minor") !== (wanted === "minor")) continue;
      const bucket = byLevel[p.level] ?? byLevel.undergrad;
      if (!bucket.has(p.college)) bucket.set(p.college, []);
      bucket.get(p.college).push({ name: p.name, href: p.page });
    }
    const section = (label, bucket) => bucket.size
      ? `<h2>${label}</h2>` + [...bucket.entries()].sort(([a], [b2]) => a.localeCompare(b2)).map(([college, list]) =>
        `<h3>${escapeHtml(prettyWords(college))}</h3><ul>` + list.sort((a, b2) => a.name.localeCompare(b2.name)).map((p) =>
          `<li><a href="${p.href}">${escapeHtml(p.name)}</a></li>`).join("") + `</ul>`).join("")
      : "";
    return section("Undergraduate", byLevel.undergrad) + section("Graduate", byLevel.grad)
      + `<p class="muted">Current catalog year; earlier years are in the <a href="${JSON_ROOT}/programs/index.json">JSON index</a>.</p>`;
  };
  pageQueue.push({
    rel: "majors.html",
    section: "majors",
    title: "Northeastern majors — degree requirements",
    heading: "Majors",
    description: "Every Northeastern major NU Map knows, undergraduate and graduate, grouped by college — each linking its full parsed degree requirements. From NU Map (not affiliated with Northeastern).",
    jsonUrl: `${JSON_ROOT}/programs/index.json`,
    body: directory("majors", "major"),
  });
  pageQueue.push({
    rel: "minors.html",
    section: "minors",
    title: "Northeastern minors — requirements",
    heading: "Minors",
    description: "Every Northeastern minor NU Map knows, grouped by college — each linking its full parsed requirements. From NU Map (not affiliated with Northeastern).",
    jsonUrl: `${JSON_ROOT}/programs/index.json`,
    body: directory("minors", "minor"),
  });
}

pageQueue.push({
  rel: "nupath.html",
  section: "nupath",
  title: "NUpath — which Northeastern courses satisfy each attribute",
  heading: "NUpath",
  description: "The 13 NUpath general-education attributes at Northeastern, each linking a full page of satisfying courses (the writing competency is three codes: WF, WD, WI). From NU Map (not affiliated with Northeastern).",
  jsonUrl: `${JSON_ROOT}/nupath.json`,
  body: `<table><tr><th>Code</th><th>Attribute</th><th>Courses</th></tr>`
    + Object.entries(nupath).map(([code, e]) =>
      `<tr><td><a href="${e.page}">${escapeHtml(code)}</a></td><td><a href="${e.page}">${escapeHtml(e.label)}</a></td><td>${e.courses.length}</td></tr>`).join("")
    + `</table><p class="muted">13 codes, not 12 — the writing competency is awarded as three (WF, WD, WI).</p>`,
});
for (const [code, e] of Object.entries(nupath)) {
  pageQueue.push({
    rel: `nupath/${code}.html`,
    section: "nupath",
    title: `NUpath ${code} — ${e.label}: every satisfying course`,
    heading: `${code} — ${e.label}`,
    description: `All ${e.courses.length} Northeastern courses satisfying the ${code} (${e.label}) NUpath attribute, each linking its full course page. From NU Map (not affiliated with Northeastern).`,
    jsonUrl: `${JSON_ROOT}/nupath.json`,
    body: `<ul>` + e.courses.map((c) =>
      `<li>${linkCode(c)}${titleOf.has(c) ? ` — ${escapeHtml(titleOf.get(c))}` : ""}</li>`).join("\n") + `</ul>`,
  });
}

// Professors: index → letter directories (by first AND last name) → one
// page per professor.
const lastNameOf = (name) => {
  const t = name.trim().split(/\s+/);
  return t[t.length - 1];
};
const profsByLastLetter = new Map();
for (const name of profNames) {
  const ln = lastNameOf(name);
  const letter = /^[A-Za-z]/.test(ln) ? ln[0].toUpperCase() : "_";
  if (!profsByLastLetter.has(letter)) profsByLastLetter.set(letter, []);
  profsByLastLetter.get(letter).push(name);
}
for (const arr of profsByLastLetter.values()) {
  arr.sort((a, b2) => lastNameOf(a).localeCompare(lastNameOf(b2)) || a.localeCompare(b2));
}
const letterCol = (label, entries, hrefOf) =>
  `<div><h2>${label}</h2><ul class="letters">`
  + entries.map(([letter, count]) => `<li><a href="${hrefOf(letter)}">${letter}</a> <span class="muted">(${count})</span></li>`).join("")
  + `</ul></div>`;
pageQueue.push({
  rel: "professors.html",
  section: "professors",
  title: "Northeastern professors — who teaches what",
  heading: "Professors",
  description: "Every Northeastern instructor in recent scheduled terms, with the courses they teach, per-season student shares, and RateMyHusky review links. From NU Map (not affiliated with Northeastern).",
  jsonUrl: `${JSON_ROOT}/professors.json`,
  body: `<p>${professors.size} instructors from recent scheduled terms (~3 years). Each professor has their own page with courses, seasons, and share of students taught.</p>
<div class="twocol">`
    + letterCol("By first name",
      [...profsByLetter.entries()].sort(([a], [b2]) => a.localeCompare(b2)).map(([l, profs]) => [l, Object.keys(profs).length]),
      (l) => `${PAGE_ROOT}/professors/${l}`)
    + letterCol("By last name",
      [...profsByLastLetter.entries()].sort(([a], [b2]) => a.localeCompare(b2)).map(([l, names]) => [l, names.length]),
      (l) => `${PAGE_ROOT}/professors/last/${l}`)
    + `</div>`,
});
for (const [letter, names] of [...profsByLastLetter.entries()].sort(([a], [b2]) => a.localeCompare(b2))) {
  pageQueue.push({
    rel: `professors/last/${letter}.html`,
    section: "professors",
    title: `Northeastern professors — last names starting with ${letter}`,
    heading: `Professors — ${letter} (last name)`,
    description: `Northeastern instructors whose last name starts with "${letter}", each linking their own page with courses, seasons, and share of students taught. From NU Map (not affiliated with Northeastern).`,
    jsonUrl: `${JSON_ROOT}/professors.json`,
    body: `<ul class="namelist">` + names.map((name) => {
      const ln = lastNameOf(name);
      const first = name.slice(0, name.length - ln.length).trim();
      return `<li><a href="${PAGE_ROOT}/professors/${profSlugOf.get(name)}">${escapeHtml(first ? `${ln}, ${first}` : ln)}</a></li>`;
    }).join("\n") + `</ul>`,
  });
}
for (const [letter, profs] of [...profsByLetter.entries()].sort(([a], [b2]) => a.localeCompare(b2))) {
  pageQueue.push({
    rel: `professors/${letter}.html`,
    section: "professors",
    title: `Northeastern professors — ${letter}`,
    heading: `Professors — ${letter}`,
    description: `Northeastern instructors whose name starts with "${letter}", each linking their own page with courses, seasons, and share of students taught. From NU Map (not affiliated with Northeastern).`,
    jsonUrl: `${JSON_ROOT}/professors/${letter}.json`,
    body: `<ul class="namelist">` + Object.entries(profs).map(([name, p]) =>
      `<li><a href="${p.page}">${escapeHtml(name)}</a> <span class="muted">(${Object.keys(p.courses).length} course${Object.keys(p.courses).length === 1 ? "" : "s"})</span></li>`).join("\n") + `</ul>`,
  });
  for (const [name, p] of Object.entries(profs)) {
    const rows = Object.entries(p.courses).map(([code, seasons]) => {
      const when = Object.entries(seasons).sort(([a], [b2]) => seasonSort(a, b2))
        .map(([s, pct]) => `${seasonLabel(s)} ${pct}%`).join(" · ");
      return `<tr><td>${linkCode(code)}</td><td>${titleOf.has(code) ? escapeHtml(titleOf.get(code)) : `<span class="muted">no longer in the catalog</span>`}</td><td>${escapeHtml(when)}</td></tr>`;
    }).join("\n");
    pageQueue.push({
      rel: `professors/${profSlugOf.get(name)}.html`,
      section: "professors",
      title: `${name} — Northeastern courses taught`,
      heading: name,
      description: `Courses ${name} teaches at Northeastern, with seasons and the average share of students taught in recent terms${p.reviews ? ", plus student reviews" : ""}. From NU Map (not affiliated with Northeastern).`,
      jsonUrl: `${JSON_ROOT}/professors/${letter}.json`,
      body: (p.reviews ? `<p><a href="${p.reviews}">Student reviews on RateMyHusky</a></p>` : "")
        + `<table><tr><th>Course</th><th>Title</th><th>When taught · share of students</th></tr>\n${rows}\n</table>`
        + `<p class="muted">Share = this professor's average percent of that season's enrolled students across recent terms (~3 years). Seasons not listed had other instructors.</p>`
        + `<p><a href="${PAGE_ROOT}/professors/${letter}">All professors — ${escapeHtml(letter)}</a></p>`,
    });
  }
}

{
  const tiers = { A: [], B: [], C: [], D: [] };
  for (const pair of equivalencesData.pairs ?? []) (tiers[pair.t] ?? tiers.D).push(pair);
  const table = (list) => `<table><tr><th>Course</th><th>Course</th></tr>`
    + list.sort((a, b2) => a.a.localeCompare(b2.a)).map((p) => `<tr><td>${linkCode(p.a)}</td><td>${linkCode(p.b)}</td></tr>`).join("") + `</table>`;
  pageQueue.push({
    rel: "equivalences.html",
    section: "equivalences",
    title: "Course equivalences and substitutions at Northeastern",
    heading: "Equivalences",
    description: "Course substitution suggestions by evidence tier: program-stated, catalog-stated, and inferred pairs (inferred ones need advisor approval). From NU Map (not affiliated with Northeastern).",
    jsonUrl: `${ORIGIN}/northeastern/course-equivalences.json`,
    body: `<p>Substitution suggestions by evidence tier. <strong>Every substitution needs
your advisor's sign-off</strong> — tiers only say how strong the written evidence is.</p>`
      + ["A", "B", "C"].map((t) => `<h2>Tier ${escapeHtml(TIER_LABEL[t])} <span class="muted">(${tiers[t].length} pairs)</span></h2>${table(tiers[t])}`).join("")
      + `<h2>Tier ${escapeHtml(TIER_LABEL.D)} <span class="muted">(${tiers.D.length} pairs)</span></h2>
<p class="muted">Too weak to list here; they live in the <a href="${ORIGIN}/northeastern/course-equivalences.json">JSON file</a> with their evidence.</p>`,
  });
}

// The hub — served at /data, the human-readable front door.
pageQueue.push({
  rel: "index.html",
  section: "home",
  title: "Northeastern courses, majors and professors",
  heading: "Overview",
  description: "Browse NU Map's public Northeastern data: every course with prerequisites, offering history and professors; every major and minor with requirements; NUpath; course equivalences. Free, no login. AI guide at numap.app/llms.txt.",
  jsonUrl: `${JSON_ROOT}/index.json`,
  body: `<dl class="dir">
<dt><a href="${PAGE_ROOT}/courses">Courses</a></dt>
<dd>${catalog.length.toLocaleString("en-US")} courses in ${subjects.length} subjects — prerequisites, offering history, meeting days, professors, unlocks. A page per subject and per course.</dd>
<dt><a href="${PAGE_ROOT}/majors">Majors</a></dt>
<dd>Full degree requirements, undergraduate and graduate, grouped by college.</dd>
<dt><a href="${PAGE_ROOT}/minors">Minors</a></dt>
<dd>Same, for every minor.</dd>
<dt><a href="${PAGE_ROOT}/nupath">NUpath</a></dt>
<dd>Which courses satisfy each of the 13 general-education attributes.</dd>
<dt><a href="${PAGE_ROOT}/professors">Professors</a></dt>
<dd>${professors.size.toLocaleString("en-US")} instructors — who teaches what, when, and what share of students.</dd>
<dt><a href="${PAGE_ROOT}/equivalences">Equivalences</a></dt>
<dd>Substitution suggestions by evidence tier.</dd>
</dl>`,
});

// Program pages cover only the NEWEST catalog year: JSONs keep every
// year, but pages for old years would compound the Pages file count
// (~1,000/year) for pages nobody searches for.
const newestYear = Math.max(...pageQueue.filter((m) => m.year).map((m) => m.year));
for (const m of pageQueue) {
  if (m.year && m.year !== newestYear) continue;
  const body = m.body
    ?? (m.kind === "course" ? renderCourse(m.subject, m.data)
      : m.kind === "program" ? renderProgram(m.data)
      : undefined);
  writePage({ rel: m.rel, section: m.section, title: m.title, heading: m.heading, description: m.description, jsonUrl: m.jsonUrl, body, wide: m.wide });
}

// Link-integrity rail: every internal page href in every generated page
// must point at a page this build generated. A renamed rel or a bad slug
// helper must fail the build, never ship a dead link. (/data/json/ links
// are files, not pages — they're validated by construction.)
{
  const generated = new Set(pageUrls);
  const dead = new Map();
  const scanFile = (p) => {
    const html = fs.readFileSync(p, "utf8");
    for (const m of html.matchAll(/href="(https:\/\/numap\.app\/data\/[^"#]*)"/g)) {
      if (m[1].startsWith(`${JSON_ROOT}/`)) continue;
      if (!generated.has(m[1])) dead.set(m[1], p);
    }
  };
  const scan = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) { if (f !== "json") scan(p); continue; }
      if (f.endsWith(".html")) scanFile(p);
    }
  };
  scan(OUT);
  scanFile(path.join(ROOT, "dist", "data.html"));
  if (dead.size) {
    const sample = [...dead.entries()].slice(0, 5).map(([u, f]) => `${u} (in ${path.basename(f)})`).join("\n  ");
    throw new Error(`rails: ${dead.size} dead internal links, e.g.\n  ${sample}`);
  }
}

// Generated sitemap for the pages; robots.txt points search engines at it.
fs.writeFileSync(path.join(OUT, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
  + pageUrls.map((u) => `  <url><loc>${u}</loc><changefreq>monthly</changefreq></url>`).join("\n")
  + `\n</urlset>\n`);

// ── Top-level JSON index ─────────────────────────────────────────────
writeJSON("index.json", {
  what: "Machine-readable index of NU Map's public Northeastern data. The human-readable pages under /data are the primary surface (small, fully expanded, every reference a link); this JSON tree is the structured developer API. Start at /llms.txt for the guide.",
  llms: `${ORIGIN}/llms.txt`,
  pages: PAGE_ROOT,
  programs: `${JSON_ROOT}/programs/index.json`,
  courses: `${JSON_ROOT}/courses/index.json`,
  courseTitles: `${JSON_ROOT}/courses/titles.json`,
  nupath: `${JSON_ROOT}/nupath.json`,
  professors: `${JSON_ROOT}/professors.json`,
  equivalences: `${ORIGIN}/northeastern/course-equivalences.json`,
  programCount: programs.length,
  courseCount: catalog.length,
  lastUpdated: meta.lastUpdated,
  generatedAt,
  disclaimer: DISCLAIMER,
});

// Sync the served data-meta.json to the catalog actually shipping in this
// build. The scrape stamps its own count, but later commits legitimately
// grow the catalog between scrapes (re-parses, grad merges), and a stored
// count drifts — the app showed 7,966 while /data claimed 7,938. Deriving
// it here makes served-count ≠ served-catalog structurally impossible.
fs.writeFileSync(path.join(ROOT, "dist", "data-meta.json"),
  JSON.stringify({ ...meta, courseCount: catalog.length }));

console.log(`Data surface: ${programs.length} programs, ${catalog.length} courses in ${subjects.length} subjects, ${professors.size} professors → ${pageUrls.length} pages + JSON API at dist/data/`);
}

// CLI entry: `node scripts/build-ai-data.js` (the Vite plugin imports
// buildAiData instead, so importing this module must not execute it).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildAiData();
}
