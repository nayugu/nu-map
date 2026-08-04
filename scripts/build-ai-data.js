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
import { fileURLToPath } from "node:url";

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

const slugify = (s) => {
  const slug = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) throw new Error(`unsluggable name: "${s}"`);
  return slug;
};

const writeJSON = (rel, data) => {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // Compact on purpose: these files are read by machines, and the
  // larger ones (CS.json, professors.json) sit near fetch-tool limits.
  fs.writeFileSync(p, JSON.stringify(data));
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

const bundle = readJSON(path.join(ROOT, "public", "northeastern", "programs-bundle.json"));
const bundleById = new Map(bundle.programs.map((p) => [p.id, p]));
const meta = readJSON(path.join(ROOT, "public", "data-meta.json"));
const generatedAt = new Date().toISOString();

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
  writeJSON(rel, {
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
  writeJSON(`courses/${subject}.json`, {
    subject,
    count: courses.length,
    lastUpdated: meta.lastUpdated,
    generatedAt,
    disclaimer: DISCLAIMER,
    legend: {
      prereqs: "Flat token list: course refs {subject, number, minGrade} joined by 'And'/'Or' strings; nested arrays are parenthesized groups. minGrade is the minimum passing grade required.",
      coreqs: "Courses that must be taken in the same term.",
      "offerings.terms": "Past/scheduled terms by Banner code (YYYY = academic-year END year; Fall runs in YYYY-1). sections/enrolled/capacity are snapshots from the scheduled scrape, NOT live seat availability.",
      "offerings.typicalDays": "Weekdays on which at least 50% of recent sections met.",
      "offerings.daysPct": "Percent of recent sections meeting on each weekday (M/T/W/Th/F).",
      "offerings.meetingPatterns": "[pattern, percent-of-sections] pairs; in patterns like 'MWR', R means Thursday.",
      instructors: "Per season. sharePct = average percent of that season's enrolled students taught by this professor (recent terms). 'reviews' links their RateMyHusky page when one exists.",
      level: "undergrad for course numbers below 5000, grad otherwise.",
      typicallyOffered: "Seasons in which the course was scheduled in at least two-thirds of that season's terms on record since it first appeared — a pattern, not a guarantee.",
      unlocks: "Courses that list this course in their prerequisites — what taking it opens up.",
      nuPath: "NUpath general-education attributes this course carries.",
      repeatable: "Whether the course may be taken more than once for credit (repeatMax / repeatMaxSH cap it).",
    },
    courses,
  });
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
writeJSON("professors.json", {
  what: "Every instructor in the offering data, with the courses they teach and in which seasons. Use for professor-based course search.",
  note: "Derived from recent scheduled terms; 'reviews' links RateMyHusky when a profile exists.",
  count: professors.size,
  lastUpdated: meta.lastUpdated,
  generatedAt,
  disclaimer: DISCLAIMER,
  professors: Object.fromEntries([...professors.entries()]
    .sort(([a], [b2]) => a.localeCompare(b2))
    .map(([name, p]) => [name, {
      ...(rmhProfs[name] ? { reviews: `${RMH}/professors/${rmhProfs[name]}` } : {}),
      courses: Object.fromEntries([...p.courses.entries()].sort(([a], [b2]) => a.localeCompare(b2))
        .map(([c, seasons]) => [c, [...seasons].sort()])),
    }])),
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
  lastUpdated: meta.lastUpdated,
  generatedAt,
  disclaimer: DISCLAIMER,
  subjects,
});

// ── Top-level index ──────────────────────────────────────────────────
writeJSON("index.json", {
  what: "Machine-readable index of NU Map's public Northeastern data. Start at /llms.txt for the guide.",
  llms: `${ORIGIN}/llms.txt`,
  programs: `${ORIGIN}/northeastern/ai/programs/index.json`,
  courses: `${ORIGIN}/northeastern/ai/courses/index.json`,
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
