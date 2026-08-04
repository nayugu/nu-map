// NU Map — Copyright (C) 2025-2026 Nathan Gu and Matthew Gu
// SPDX-License-Identifier: AGPL-3.0-only
// AGPL-3.0-only + attribution term under §7(b); see LICENSING.md and NOTICE.
//
// AI-readable data export — the static "API".
//
// Emits the public catalog as small, stable-URL JSON files that any AI
// with a URL fetcher (claude.ai, ChatGPT, Perplexity, agents) can
// discover via /llms.txt and read directly. Static files on Pages cost
// nothing at any scale — this is deliberately NOT a worker endpoint.
//
//   dist/northeastern/ai/index.json
//   dist/northeastern/ai/programs/index.json
//   dist/northeastern/ai/programs/{year}/{level}/{college}/{slug}.json
//   dist/northeastern/ai/courses/index.json
//   dist/northeastern/ai/courses/{SUBJECT}.json
//
// Runs AFTER `vite build` (writes into dist/), so the repo stays free of
// a thousand generated files. Sources: the same parsed.initial.json
// files that feed the app's hashed chunks, the programs bundle, and the
// course catalog — nothing here can drift from what the app shows.
//
// Rails: refuses to write a suspiciously small export (broken glob,
// empty catalog) and fails the build on slug collisions — a wrong URL
// surface must never ship silently.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist", "northeastern", "ai");
const ORIGIN = "https://numap.app";

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

// One-line prerequisite rendering for the compact subject listings.
const fmtPrereqs = (node) => {
  if (Array.isArray(node)) {
    const parts = node.map(fmtPrereqs).filter(Boolean);
    return parts.length > 1 ? `(${parts.join(" ")})` : parts.join(" ");
  }
  if (typeof node === "string") return node.toLowerCase();
  if (node && node.subject) return `${node.subject} ${node.number}${node.minGrade ? ` (min ${node.minGrade})` : ""}`;
  return "";
};

const slugify = (s) => {
  const slug = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) throw new Error(`unsluggable name: "${s}"`);
  return slug;
};

const writeJSON = (rel, data) => {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // Every file self-roots: wherever an AI lands, the first field points
  // back to the guide. Compact on purpose: these files are read by
  // machines, and the larger ones sit near fetch-tool limits.
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
const mirrorQueue = []; // filled by the loops, flushed at the HTML-mirror stage

const programs = [];
const seenUrls = new Map(); // url → id, for collision rails

for (const src of [...walkPrograms("majors", ""), ...walkPrograms("grad-majors", "grad/")]) {
  const parsed = readJSON(src.file);
  if (!parsed.name) throw new Error(`program without a name: ${src.file}`);

  const b = bundleById.get(src.id);
  const level = b?.level ?? (src.id.startsWith("grad/") ? "grad" : "undergrad");
  const rel = `programs/${src.year}/${level}/${slugify(src.college)}/${slugify(src.prog)}.json`;
  const url = `${ORIGIN}/northeastern/ai/${rel}`;

  const clash = seenUrls.get(url);
  if (clash) throw new Error(`slug collision: ${src.id} vs ${clash} → ${url}`);
  seenUrls.set(url, src.id);

  const { metadata, name, ...requirements } = parsed;
  const payload = {
    id: src.id,
    name,
    level,
    kind: b?.type ?? (/(^|_)minor$/.test(src.prog) ? "minor" : "major"),
    catalogYear: Number(src.year),
    college: src.college,
    location: b?.location || undefined,
    totalCreditsRequired: b?.totalCreditsRequired,
    concentrationCount: b?.concentrationCount,
    verified: b?.verified ?? metadata?.verified,
    sourceUrl: b?.sourceUrl ?? metadata?.sourceUrl,
    lastEdited: metadata?.lastEdited,
    url,
    app: ORIGIN,
    generatedAt,
    disclaimer: DISCLAIMER,
    requirements,
  };
  writeJSON(rel, payload);
  mirrorQueue.push({
    year: Number(src.year),
    rel: `programs/${src.year}-${level}-${slugify(src.college)}-${slugify(src.prog)}.html`,
    title: `${name} — requirements (${src.year} catalog, ${level === "grad" ? "graduate" : "undergraduate"})`,
    description: `Full parsed degree requirements for ${name} at Northeastern University (${src.year} catalog). Machine-readable data from NU Map, a student-built planner not affiliated with Northeastern.`,
    jsonUrl: url,
    kind: "program",
    data: payload,
  });

  programs.push({
    id: src.id, name, level, kind: b?.type ?? "major",
    catalogYear: Number(src.year), college: src.college,
    location: b?.location || undefined,
    totalCreditsRequired: b?.totalCreditsRequired, url,
  });
}

if (programs.length < MIN_PROGRAMS) {
  throw new Error(`rails: only ${programs.length} programs (< ${MIN_PROGRAMS}) — refusing to ship a broken export`);
}
programs.sort((a, b2) => a.id.localeCompare(b2.id));
writeJSON("programs/index.json", {
  what: "Every Northeastern program NU Map knows, with a stable URL to its full requirements JSON.",
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
  const url = `${ORIGIN}/northeastern/ai/courses/${subject}.json`;
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
    detail: `${ORIGIN}/northeastern/ai/html/courses/${subject}/${c.number}`,
  }));
  const subjectPayload = {
    subject,
    count: courses.length,
    what: "Compact filterable index of every course in this subject. Full detail per course - description, offering history with enrollment, meeting-day and instructor-share percentages, RateMyHusky links - is at its `detail` URL (copy it verbatim).",
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
      detail: "This course's full text page: description, offering history, percentages, professors. Fetch it for any single-course question.",
    },
    courses: slim,
  };
  writeJSON(`courses/${subject}.json`, subjectPayload);

  // Subject mirror: a COMPACT table (no description bodies — full
  // dumps overflowed AI fetch contexts), linking each course's own page.
  const rows = courses.map((c) => {
    const pageUrl = `${ORIGIN}/northeastern/ai/html/courses/${subject}/${c.number}`;
    return `<tr><td><a href="${pageUrl}">${escapeHtml(`${subject} ${c.number}`)}</a></td>`
      + `<td>${escapeHtml(c.title)}</td>`
      + `<td>${c.credits}${c.creditsMax ? `–${c.creditsMax}` : ""}</td>`
      + `<td>${c.level === "grad" ? "grad" : "ug"}</td>`
      + `<td>${c.typicallyOffered ? escapeHtml(c.typicallyOffered.join(", ")) : ""}</td>`
      + `<td>${c.nuPath?.length ? escapeHtml(c.nuPath.join(", ")) : ""}</td>`
      + `<td class="muted">${escapeHtml(fmtPrereqs(c.prereqs))}</td>`
      + `<td class="muted">${(() => {
        if (!c.instructors) return "";
        const names = [...new Set(Object.values(c.instructors).flat().map((i) => i.name))].sort();
        const shown = names.slice(0, 6).map(escapeHtml).join(", ");
        return names.length > 6 ? `${shown}, <a href="${pageUrl}">+${names.length - 6} more</a>` : shown;
      })()}</td></tr>`;
  }).join("\n");
  mirrorQueue.push({
    rel: `courses/${subject}.html`,
    title: `${subject} courses at Northeastern — prerequisites, offerings, instructors`,
    description: `Every Northeastern ${subject} course with prerequisites, typical offerings and NUpath, linking full detail pages. From NU Map, a student-built planner not affiliated with Northeastern.`,
    jsonUrl: url,
    body: `<table>\n<tr><th>Code</th><th>Title</th><th>SH</th><th>Level</th><th>Usually offered</th><th>NUpath</th><th>Prerequisites</th><th>Recent instructors</th></tr>\n${rows}\n</table>`
      + `<p class="muted">Instructors are from recent scheduled terms; each course page shows them per season with student shares. Blank means no recent scheduled sections on record.</p>`,
  });

  // Per-course pages: small (a few KB), never truncated, and shaped
  // like the queries people actually type ("CS 2500 prerequisites").
  for (const c of courses) {
    mirrorQueue.push({
      rel: `courses/${subject}/${c.number}.html`,
      title: `${subject} ${c.number} — ${c.title} | prerequisites, offerings, professors (Northeastern)`,
      description: `${subject} ${c.number} ${c.title} at Northeastern: prerequisites, corequisites, offering history, typical meeting days, instructors with student shares, and what it unlocks. From NU Map (not affiliated with Northeastern).`,
      jsonUrl: url,
      kind: "course",
      subject,
      data: c,
    });
  }
  subjects.push({ subject, count: courses.length, url });
}

// ── Professor reverse index (the app's PROFESSOR filter) ─────────────
const professors = new Map(); // name → { reviews?, courses: Map(code → Set(seasons)) }
for (const [code, off] of Object.entries(offering)) {
  if (!off?.prof) continue;
  const m = /^([A-Z]{2,6})(\d+\w*)$/.exec(code);
  const label = m ? `${m[1]} ${m[2]}` : code;
  for (const [season, list] of Object.entries(off.prof)) {
    for (const [name] of list) {
      if (!professors.has(name)) professors.set(name, { courses: new Map() });
      const p = professors.get(name);
      if (!p.courses.has(label)) p.courses.set(label, new Set());
      p.courses.get(label).add(season);
    }
  }
}
// Split by surname-agnostic FIRST letter of the display name so no
// single file can overflow an AI fetch context (the monolith hit
// 581 KB, which silently truncated — losing professors N–Z).
const profsByLetter = new Map();
for (const [name, p] of [...professors.entries()].sort(([a], [b2]) => a.localeCompare(b2))) {
  const letter = /^[A-Za-z]/.test(name) ? name[0].toUpperCase() : "_";
  if (!profsByLetter.has(letter)) profsByLetter.set(letter, {});
  profsByLetter.get(letter)[name] = {
    ...(rmhProfs[name] ? { reviews: `${RMH}/professors/${rmhProfs[name]}` } : {}),
    courses: Object.fromEntries([...p.courses.entries()].sort(([a], [b2]) => a.localeCompare(b2))
      .map(([c, seasons]) => [c, [...seasons].sort()])),
  };
}
const profLetters = {};
for (const [letter, profs] of [...profsByLetter.entries()].sort(([a], [b2]) => a.localeCompare(b2))) {
  writeJSON(`professors/${letter}.json`, {
    what: `Instructors whose name starts with "${letter}", with the courses they teach per season.`,
    count: Object.keys(profs).length,
    lastUpdated: meta.lastUpdated,
    generatedAt,
    disclaimer: DISCLAIMER,
    professors: profs,
  });
  profLetters[letter] = { count: Object.keys(profs).length, url: `${ORIGIN}/northeastern/ai/professors/${letter}.json` };
}
writeJSON("professors.json", {
  what: "Index of instructors, split by first letter of name so each file stays small. Fetch the letter file for the professor you need; use for professor-based course search.",
  note: "Derived from recent scheduled terms; 'reviews' links RateMyHusky when a profile exists.",
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
const nupath = Object.fromEntries(Object.entries(NUPATH_LABELS).map(([code, label]) => [code, { label, courses: [] }]));
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
  what: "Northeastern's course catalog, split into one JSON file per subject code.",
  courseCount: catalog.length,
  subjectCount: subjects.length,
  titles: `${ORIGIN}/northeastern/ai/courses/titles.json`,
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
  what: "Every course code mapped to its title — fetch this ONE file to search courses by topic, then fetch courses/{SUBJECT}.json for full details on the matches.",
  count: Object.keys(titles).length,
  lastUpdated: meta.lastUpdated,
  generatedAt,
  disclaimer: DISCLAIMER,
  titles,
});

// ── Indexable HTML mirrors (search as the transport) ─────────────────
// Some AI fetch tools (claude.ai's) only fetch URLs that appear in
// SEARCH RESULTS or the user's messages — never URLs found in fetched
// files. Raw JSON rarely gets indexed, but HTML does: each subject and
// program gets a search-friendly HTML page with the full data embedded
// as readable text, so a "site:numap.app MATH courses" hit IS the data,
// zero extra hops. A generated sitemap lists them all.

const htmlUrls = [];
const HTML_ROOT = `${ORIGIN}/northeastern/ai/html`;

// One shared clean design: every mirror is a real human-readable page
// (the raw-JSON <pre> dump is gone — a page either has a renderer or
// the build fails). Inline CSS keeps each page self-contained.
const PAGE_CSS =
  "body{font-family:system-ui,-apple-system,sans-serif;max-width:820px;margin:0 auto;padding:24px 20px 40px;line-height:1.55;color:#1e293b}"
  + "a{color:#dc2626;text-decoration:none}a:hover{text-decoration:underline}"
  + "h1{font-size:1.6rem;margin:.2em 0 .3em}"
  + "h2{font-size:1.12rem;margin:1.6em 0 .5em;padding-bottom:.25em;border-bottom:1px solid #e2e8f0}"
  + "h3{font-size:1rem;margin:1.2em 0 .4em}"
  + "table{border-collapse:collapse;width:100%;font-size:.92rem}"
  + "th{text-align:left;background:#f8fafc}th,td{padding:6px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top}"
  + ".chips{margin:.4em 0}.chips span{display:inline-block;background:#f1f5f9;border-radius:999px;padding:2px 12px;margin:2px 4px 2px 0;font-size:.85rem;color:#334155}"
  + ".muted{color:#64748b;font-size:.88rem}"
  + "ul.req{padding-left:1.2em}ul.req ul{padding-left:1.2em}li{margin:.15em 0}"
  + "details{margin:.5em 0;border:1px solid #e2e8f0;border-radius:10px;padding:.5em .9em}summary{cursor:pointer;font-weight:600}"
  + "header{font-size:.85rem;color:#64748b;margin-bottom:14px}header a{color:#64748b;font-weight:600}"
  + "footer{margin-top:2.5em;border-top:1px solid #e2e8f0;padding-top:1em;font-size:.82rem;color:#64748b}"
  + "footer code{background:#f1f5f9;padding:0 4px;border-radius:4px;word-break:break-all}"
  + "footer details{border:none;padding:0;margin:0}footer summary{font-weight:400;color:#94a3b8}"
  + "pre{white-space:pre-wrap;word-break:break-word;background:#f8fafc;padding:10px;border-radius:8px;font-size:.85rem}";

const writeHtmlMirror = (rel, title, description, jsonUrl, body) => {
  if (typeof body !== "string") throw new Error(`mirror without a rendered body: ${rel}`);
  const p = path.join(OUT, "html", rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // Pages "pretty URLs" 308-redirect any *.html to its extensionless twin,
  // so canonicals and the sitemap must use the extensionless form — a
  // canonical pointing at a redirect makes Google index every page grudgingly.
  const url = rel === "index.html" ? `${HTML_ROOT}/` : `${HTML_ROOT}/${rel.replace(/\.html$/, "")}`;
  htmlUrls.push(url);
  fs.writeFileSync(p, `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" />
<title>${escapeHtml(title)} — NU Map Data</title>
<meta name="description" content="${escapeHtml(description)}" />
<link rel="canonical" href="${url}" />
<link rel="icon" type="image/png" href="${ORIGIN}/northeastern/dev_logo.png" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>${PAGE_CSS}</style>
</head><body>
<header><a href="${HTML_ROOT}/">NU Map Data</a> · <a href="${ORIGIN}">numap.app planner</a> · <a href="${ORIGIN}/llms.txt">AI data guide</a>${jsonUrl ? ` · <a href="${jsonUrl}">JSON of this page</a>` : ""}</header>
<h1>${escapeHtml(title)}</h1>
<p class="muted">NU Map is an independent, student-built planner — not affiliated
with, endorsed by, or officially connected to Northeastern University. Data comes
from the public catalog on a schedule; confirm with the official catalog and an
advisor. Data updated ${escapeHtml(meta.lastUpdated)} · page generated ${generatedAt.slice(0, 10)}.</p>
${body}
<footer>
<details>
<summary>For AI assistants — reaching any other NU Map data from this page</summary>
<p>Full guide: <a href="${ORIGIN}/llms.txt">https://numap.app/llms.txt</a>.</p>
<ul>
<li>Courses by subject — prereq logic, offerings, instructors, unlocks: exact
per-subject URLs are in <code>${ORIGIN}/northeastern/ai/courses/index.json</code>
(pattern: <code>${ORIGIN}/northeastern/ai/courses/{SUBJECT}.json</code>, e.g.
CS.json). All course titles in one file:
<code>${ORIGIN}/northeastern/ai/courses/titles.json</code>.</li>
<li>Programs (majors and minors, requirements): <code>${ORIGIN}/northeastern/ai/programs/index.json</code>
— look up the program's own URL there, never guess slugs.</li>
<li>NUpath attributes: <code>${ORIGIN}/northeastern/ai/nupath.json</code> ·
Professors: <code>${ORIGIN}/northeastern/ai/professors.json</code> (an index by
first letter of name).</li>
<li>If your fetch tool refuses URLs found on this page (claude.ai's does), navigate
by web search instead — results of a search ARE fetchable:
<code>site:numap.app/northeastern/ai/html &lt;subject, course, or program name&gt;</code>.
A page like this one exists for every subject, course, and current program. Or ask
the user to paste the exact URL you need as their next message.</li>
</ul>
</details>
</footer>
</body></html>`);
};

// ── Renderers: one per page kind ─────────────────────────────────────
const titleOf = new Map();
for (const c of catalog) if (c.subject && c.number) titleOf.set(`${c.subject} ${c.number}`, c.title);

const linkRef = (subject, number) => {
  const code = `${subject} ${number}`;
  return titleOf.has(code)
    ? `<a href="${HTML_ROOT}/courses/${subject}/${number}" title="${escapeHtml(titleOf.get(code) ?? "")}">${escapeHtml(code)}</a>`
    : escapeHtml(code);
};
const linkCode = (code) => {
  const m = /^([A-Z]{2,6})\s?(\S+)$/.exec(code);
  return m ? linkRef(m[1], m[2]) : escapeHtml(code);
};
const chips = (arr) => `<p class="chips">${arr.filter(Boolean).map((x) => `<span>${x}</span>`).join("")}</p>`;
const SEASON_LABEL = { fall: "Fall", spring: "Spring", summer: "Summer", sumA: "Summer A", sumB: "Summer B" };
const seasonLabel = (s) => SEASON_LABEL[s] ?? s;

// Prereq logic as a readable sentence with linked course refs.
const prereqHtml = (node) => {
  if (Array.isArray(node)) {
    const parts = node.map(prereqHtml).filter(Boolean);
    return parts.length > 1 ? `(${parts.join(" ")})` : parts.join(" ");
  }
  if (typeof node === "string") return node.toLowerCase();
  if (node && node.subject) {
    return `${linkRef(node.subject, node.number)}${node.minGrade ? ` <span class="muted">(min ${escapeHtml(node.minGrade)})</span>` : ""}`;
  }
  return "";
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
  if (c.prereqs?.length) out.push(`<h2>Prerequisites</h2><p>${prereqHtml(c.prereqs)}</p>`);
  if (c.coreqs?.length) out.push(`<h2>Corequisites (same term)</h2><p>${prereqHtml(c.coreqs)}</p>`);

  const terms = c.offerings?.terms && Object.keys(c.offerings.terms).length ? c.offerings.terms : null;
  if (terms) {
    out.push(`<h2>Offering history</h2><table><tr><th>Term</th><th>Sections</th><th>Enrolled</th><th>Capacity</th></tr>`
      + Object.keys(terms).sort().map((k) => {
        const t = terms[k];
        return `<tr><td>${escapeHtml(t.term ?? k)}</td><td>${t.sections ?? ""}</td><td>${t.enrolled ?? ""}</td><td>${t.capacity ?? ""}</td></tr>`;
      }).join("")
      + `</table><p class="muted">Snapshots from scheduled scrapes — not live seat availability.</p>`);
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
    const order = ["fall", "spring", "summer", "sumA", "sumB"];
    const seasons = Object.keys(c.instructors).sort((a, b2) => (order.indexOf(a) + 99) - (order.indexOf(b2) + 99) || order.indexOf(a) - order.indexOf(b2));
    out.push(`<h2>Professors</h2>` + seasons.map((s) =>
      `<p><strong>${escapeHtml(seasonLabel(s))}:</strong> ` + c.instructors[s].map((i) =>
        `${escapeHtml(i.name)} <span class="muted">(${i.sharePct}% of students)</span>${i.reviews ? ` <a href="${i.reviews}">reviews</a>` : ""}`
      ).join(" · ") + `</p>`).join("")
      + `<p class="muted">Percentages are each professor's average share of the season's enrolled students in recent terms.</p>`);
  }
  if (c.unlocks?.length) {
    out.push(`<h2>Unlocks</h2><p>${c.unlocks.map(linkCode).join(", ")}</p>`
      + `<p class="muted">Courses that list ${escapeHtml(`${subject} ${c.number}`)} in their prerequisites.</p>`);
  }
  const links = [
    c.catalogUrl ? `<a href="${c.catalogUrl}">Official catalog (${escapeHtml(subject)} course descriptions)</a>` : null,
    c.reviews ? `<a href="${c.reviews}">Student reviews on RateMyHusky</a>` : null,
    `<a href="${HTML_ROOT}/courses/${subject}">All ${escapeHtml(subject)} courses</a>`,
    `<a href="${ORIGIN}">Plan it at numap.app</a>`,
  ].filter(Boolean);
  out.push(`<h2>Links</h2><p>${links.join(" · ")}</p>`);

  // Parity net: any field the template doesn't know still ships, so the
  // HTML page never silently loses data the JSON row no longer carries.
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
const renderProgram = (p) => {
  const r = p.requirements ?? {};
  const pretty = (s) => String(s ?? "").replace(/[-_]+/g, " ").replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
  const out = [];
  out.push(chips([
    p.level === "grad" ? "Graduate" : "Undergraduate",
    escapeHtml(p.kind ?? "major"),
    `${p.catalogYear} catalog`,
    p.college ? escapeHtml(pretty(p.college)) : null,
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
        `<details><summary>${escapeHtml(o.label ?? o.title ?? "Concentration")}</summary>${sectionInner(o)}</details>`).join(""));
  }
  if (r.gpaRequirements?.length) {
    out.push(`<h2>GPA requirements</h2><ul>${r.gpaRequirements.map((g) => `<li>${escapeHtml(g.text ?? g.title ?? "")}</li>`).join("")}</ul>`);
  }
  if (r.generalElectiveSH) {
    out.push(`<p>Plus ${r.generalElectiveSH} semester hours of general electives.</p>`);
  }
  out.push(`<p class="muted">Parsed from the catalog by NU Map; the <a href="${p.url}">JSON version</a> is the canonical machine copy${p.sourceUrl ? `, and the <a href="${p.sourceUrl}">official page</a> is the authority` : ""}.</p>`);
  return out.join("\n");
};

// ── Cross-cutting pages: hub, directories, nupath, professors, equivalences ──
const equivalencesData = readJSON(path.join(ROOT, "public", "northeastern", "course-equivalences.json"));
const TIER_LABEL = {
  A: "A — a program explicitly allows either course",
  B: "B — catalog-stated equivalents / cross-listings",
  C: "C — inferred from shared usage; needs advisor approval",
  D: "D — weak signals only",
};

mirrorQueue.push({
  rel: "courses.html",
  title: "All Northeastern subjects — course listings",
  description: "Directory of all Northeastern subject codes with course counts; each links a full listing with prerequisites, offerings and NUpath. From NU Map (not affiliated with Northeastern).",
  jsonUrl: `${ORIGIN}/northeastern/ai/courses/index.json`,
  body: `<table><tr><th>Subject</th><th>Courses</th><th></th></tr>`
    + subjects.map((s) => `<tr><td><a href="${HTML_ROOT}/courses/${s.subject}">${s.subject}</a></td><td>${s.count}</td><td class="muted"><a href="${s.url}">JSON</a></td></tr>`).join("")
    + `</table>`,
});

{
  const current = mirrorQueue.filter((m) => m.kind === "program" && m.year === Math.max(...mirrorQueue.filter((q) => q.year).map((q) => q.year)));
  const pretty = (s) => String(s ?? "").replace(/[-_]+/g, " ").replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
  const byLevel = { undergrad: new Map(), grad: new Map() };
  for (const m of current) {
    const p = m.data;
    const bucket = byLevel[p.level] ?? byLevel.undergrad;
    if (!bucket.has(p.college)) bucket.set(p.college, []);
    bucket.get(p.college).push({ name: p.name, kind: p.kind, href: `${HTML_ROOT}/${m.rel.replace(/\.html$/, "")}` });
  }
  const section = (label, bucket) => `<h2>${label}</h2>` + [...bucket.entries()].sort(([a], [b2]) => a.localeCompare(b2)).map(([college, list]) =>
    `<h3>${escapeHtml(pretty(college))}</h3><ul>` + list.sort((a, b2) => a.name.localeCompare(b2.name)).map((p) =>
      `<li><a href="${p.href}">${escapeHtml(p.name)}</a>${p.kind === "minor" ? ` <span class="muted">(minor)</span>` : ""}</li>`).join("") + `</ul>`).join("");
  mirrorQueue.push({
    rel: "programs.html",
    title: "All Northeastern majors and minors — degree requirements",
    description: "Directory of every Northeastern program NU Map knows — majors and minors, undergraduate and graduate — each linking its full parsed requirements. From NU Map (not affiliated with Northeastern).",
    jsonUrl: `${ORIGIN}/northeastern/ai/programs/index.json`,
    body: section("Undergraduate", byLevel.undergrad) + section("Graduate", byLevel.grad)
      + `<p class="muted">Current catalog year; earlier years are in the <a href="${ORIGIN}/northeastern/ai/programs/index.json">JSON index</a>.</p>`,
  });
}

mirrorQueue.push({
  rel: "nupath.html",
  title: "NUpath — which Northeastern courses satisfy each attribute",
  description: "Every course satisfying each of the 13 NUpath general-education attributes at Northeastern (the writing competency is three codes: WF, WD, WI). From NU Map (not affiliated with Northeastern).",
  jsonUrl: `${ORIGIN}/northeastern/ai/nupath.json`,
  body: Object.entries(nupath).map(([code, e]) =>
    `<details><summary>${escapeHtml(code)} — ${escapeHtml(e.label)} <span class="muted">(${e.courses.length} courses)</span></summary><p>${e.courses.map(linkCode).join(", ")}</p></details>`).join(""),
});

for (const [letter, profs] of [...profsByLetter.entries()].sort(([a], [b2]) => a.localeCompare(b2))) {
  mirrorQueue.push({
    rel: `professors/${letter}.html`,
    title: `Northeastern professors — ${letter}`,
    description: `Northeastern instructors whose name starts with "${letter}", with the courses they teach per season and student review links. From NU Map (not affiliated with Northeastern).`,
    jsonUrl: `${ORIGIN}/northeastern/ai/professors/${letter}.json`,
    body: Object.entries(profs).map(([name, p]) =>
      `<p><strong>${escapeHtml(name)}</strong>${p.reviews ? ` <a href="${p.reviews}">reviews</a>` : ""} — `
      + Object.entries(p.courses).map(([code, seasons]) => `${linkCode(code)} <span class="muted">(${seasons.map(seasonLabel).join(", ")})</span>`).join("; ")
      + `</p>`).join("\n"),
  });
}
mirrorQueue.push({
  rel: "professors.html",
  title: "Northeastern professors — who teaches what",
  description: "Every Northeastern instructor in recent scheduled terms, with the courses they teach per season and RateMyHusky review links, split by first letter. From NU Map (not affiliated with Northeastern).",
  jsonUrl: `${ORIGIN}/northeastern/ai/professors.json`,
  body: `<p>${professors.size} instructors from recent scheduled terms, split by the first letter of their name:</p><p>`
    + [...profsByLetter.entries()].sort(([a], [b2]) => a.localeCompare(b2))
      .map(([letter, profs]) => `<a href="${HTML_ROOT}/professors/${letter}">${letter}</a> <span class="muted">(${Object.keys(profs).length})</span>`).join(" · ")
    + `</p>`,
});

{
  const tiers = { A: [], B: [], C: [], D: [] };
  for (const pair of equivalencesData.pairs ?? []) (tiers[pair.t] ?? tiers.D).push(pair);
  const table = (list) => `<table><tr><th>Course</th><th>Course</th></tr>`
    + list.sort((a, b2) => a.a.localeCompare(b2.a)).map((p) => `<tr><td>${linkCode(p.a)}</td><td>${linkCode(p.b)}</td></tr>`).join("") + `</table>`;
  mirrorQueue.push({
    rel: "equivalences.html",
    title: "Course equivalences and substitutions at Northeastern",
    description: "Course substitution suggestions by evidence tier: program-stated, catalog-stated, and inferred pairs (inferred ones need advisor approval). From NU Map (not affiliated with Northeastern).",
    jsonUrl: `${ORIGIN}/northeastern/course-equivalences.json`,
    body: `<p>Substitution suggestions by evidence tier. <strong>Every substitution needs
your advisor's sign-off</strong> — tiers only say how strong the written evidence is.</p>`
      + ["A", "B", "C"].map((t) => `<h2>Tier ${escapeHtml(TIER_LABEL[t])} <span class="muted">(${tiers[t].length} pairs)</span></h2>${table(tiers[t])}`).join("")
      + `<h2>Tier ${escapeHtml(TIER_LABEL.D)} <span class="muted">(${tiers.D.length} pairs)</span></h2>
<p class="muted">Too weak to list here; they live in the <a href="${ORIGIN}/northeastern/course-equivalences.json">JSON file</a> with their evidence.</p>`,
  });
}

mirrorQueue.push({
  rel: "titles.html",
  title: "Every Northeastern course title in one file",
  description: "All Northeastern course codes and titles in a single machine-readable file for topic search, with the subject directory for humans. From NU Map (not affiliated with Northeastern).",
  jsonUrl: `${ORIGIN}/northeastern/ai/courses/titles.json`,
  body: `<p>The one-fetch topic index: every course code mapped to its title lives in
<a href="${ORIGIN}/northeastern/ai/courses/titles.json">titles.json</a> (~330 KB).
Humans browsing by subject want the <a href="${HTML_ROOT}/courses">subject
directory</a> instead; each subject page lists its courses with prerequisites and
links to full course pages.</p>`,
});

mirrorQueue.push({
  rel: "index.html",
  title: "NU Map Data — Northeastern courses, majors and professors",
  description: "Human-readable directory of NU Map's public Northeastern data: every course with prerequisites and professors, every major and minor with requirements, NUpath, and course equivalences. Machine version at numap.app/llms.txt.",
  jsonUrl: `${ORIGIN}/northeastern/ai/index.json`,
  body: `<ul>
<li><a href="${HTML_ROOT}/courses">Courses by subject</a> — ${catalog.length} courses in ${subjects.length} subjects: prerequisites, offering history, meeting days, professors, and what each course unlocks.</li>
<li><a href="${HTML_ROOT}/programs">Majors and minors</a> — ${programs.length} programs with full parsed degree requirements.</li>
<li><a href="${HTML_ROOT}/nupath">NUpath</a> — which courses satisfy each of the 13 general-education attributes.</li>
<li><a href="${HTML_ROOT}/professors">Professors</a> — who teaches what, per season, with review links.</li>
<li><a href="${HTML_ROOT}/equivalences">Course equivalences</a> — substitution suggestions by evidence tier.</li>
<li><a href="${HTML_ROOT}/titles">Course titles index</a> — topic search across all ~${Math.round(catalog.length / 1000)}k courses.</li>
</ul>
<p>AI assistants: everything here is also plain JSON — start at
<a href="${ORIGIN}/llms.txt">numap.app/llms.txt</a>. Humans: the interactive planner
is <a href="${ORIGIN}">numap.app</a>.</p>`,
});

// HTML mirrors for programs cover only the NEWEST catalog year: JSONs
// keep every year, but mirroring all years would compound the Pages
// file count (~1,000/year) for pages nobody searches for.
const newestYear = Math.max(...mirrorQueue.filter((m) => m.year).map((m) => m.year));
for (const m of mirrorQueue) {
  if (m.year && m.year !== newestYear) continue;
  const body = m.body
    ?? (m.kind === "course" ? renderCourse(m.subject, m.data)
      : m.kind === "program" ? renderProgram(m.data)
      : undefined);
  writeHtmlMirror(m.rel, m.title, m.description, m.jsonUrl, body);
}

// Generated sitemap for the mirrors, under the already-exempt /northeastern/ai/
// path; robots.txt points search engines at it.
fs.writeFileSync(path.join(OUT, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
  + htmlUrls.map((u) => `  <url><loc>${u}</loc><changefreq>monthly</changefreq></url>`).join("\n")
  + `\n</urlset>\n`);

// ── Top-level index ──────────────────────────────────────────────────
writeJSON("index.json", {
  what: "Machine-readable index of NU Map's public Northeastern data. Start at /llms.txt for the guide.",
  llms: `${ORIGIN}/llms.txt`,
  html: `${HTML_ROOT}/`,
  programs: `${ORIGIN}/northeastern/ai/programs/index.json`,
  courses: `${ORIGIN}/northeastern/ai/courses/index.json`,
  courseTitles: `${ORIGIN}/northeastern/ai/courses/titles.json`,
  nupath: `${ORIGIN}/northeastern/ai/nupath.json`,
  professors: `${ORIGIN}/northeastern/ai/professors.json`,
  equivalences: `${ORIGIN}/northeastern/course-equivalences.json`,
  programCount: programs.length,
  courseCount: catalog.length,
  lastUpdated: meta.lastUpdated,
  generatedAt,
  disclaimer: DISCLAIMER,
});

console.log(`AI data export: ${programs.length} programs, ${catalog.length} courses in ${subjects.length} subjects → dist/northeastern/ai/`);
}

// CLI entry: `node scripts/build-ai-data.js` (the Vite plugin imports
// buildAiData instead, so importing this module must not execute it).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildAiData();
}
