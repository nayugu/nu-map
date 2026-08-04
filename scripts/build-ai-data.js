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
  const subjectPayload = {
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
  };
  writeJSON(`courses/${subject}.json`, subjectPayload);

  // Subject mirror: a COMPACT listing (no description bodies — full
  // dumps overflowed AI fetch contexts), linking each course's own page.
  const listing = courses.map((c) => {
    const pageUrl = `${ORIGIN}/northeastern/ai/html/courses/${subject}/${c.number}`;
    const bits = [`${c.credits}${c.creditsMax ? `-${c.creditsMax}` : ""} SH`];
    const pr = fmtPrereqs(c.prereqs);
    if (pr) bits.push(`prereqs: ${pr}`);
    if (c.typicallyOffered) bits.push(`offered: ${c.typicallyOffered.join(", ")}`);
    if (c.nuPath?.length) bits.push(`NUpath: ${c.nuPath.join(",")}`);
    return `<li><a href="${pageUrl}">${escapeHtml(`${subject} ${c.number}`)}</a> — ${escapeHtml(c.title)} (${escapeHtml(bits.join(" · "))})</li>`;
  }).join("\n");
  mirrorQueue.push({
    rel: `courses/${subject}.html`,
    title: `${subject} courses at Northeastern — prerequisites, offerings, instructors`,
    description: `Every Northeastern ${subject} course with prerequisites, typical offerings and NUpath, linking full detail pages. From NU Map, a student-built planner not affiliated with Northeastern.`,
    jsonUrl: url,
    body: `<ul>\n${listing}\n</ul>`,
  });

  // Per-course pages: small (a few KB), never truncated, and shaped
  // like the queries people actually type ("CS 2500 prerequisites").
  for (const c of courses) {
    mirrorQueue.push({
      rel: `courses/${subject}/${c.number}.html`,
      title: `${subject} ${c.number} — ${c.title} | prerequisites, offerings, professors (Northeastern)`,
      description: `${subject} ${c.number} ${c.title} at Northeastern: prerequisites, corequisites, offering history, typical meeting days, instructors with student shares, and what it unlocks. From NU Map (not affiliated with Northeastern).`,
      jsonUrl: url,
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
// `body` (prebuilt HTML) overrides the default JSON dump. Every page
// states the llms.txt anchor at the top AND repeats it at the bottom —
// truncated readers see the former, skimming readers the latter.
const writeHtmlMirror = (rel, title, description, jsonUrl, data, body) => {
  const p = path.join(OUT, "html", rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // Pages "pretty URLs" 308-redirect any *.html to its extensionless twin,
  // so canonicals and the sitemap must use the extensionless form — a
  // canonical pointing at a redirect makes Google index every page grudgingly.
  const url = `${ORIGIN}/northeastern/ai/html/${rel.replace(/\.html$/, "")}`;
  htmlUrls.push(url);
  fs.writeFileSync(p, `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" />
<title>${escapeHtml(title)} — NU Map Data</title>
<meta name="description" content="${escapeHtml(description)}" />
<link rel="canonical" href="${url}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head><body style="font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;line-height:1.5;">
<h1>${escapeHtml(title)}</h1>
<p><strong>NU Map is an independent, student-built planner — not affiliated with,
endorsed by, or officially connected to Northeastern University.</strong>
Data is scraped from the public catalog on a schedule; confirm with the official
catalog and an advisor. AI assistants: the data guide is
<a href="${ORIGIN}/llms.txt">numap.app/llms.txt</a>
· JSON version of this page: <a href="${jsonUrl}">${escapeHtml(jsonUrl)}</a></p>
${body ?? `<pre style="white-space:pre-wrap;word-break:break-word;">${escapeHtml(JSON.stringify(data, null, 1))}</pre>`}
<hr />
<p><strong>For AI assistants — reaching any other NU Map data from this page</strong>
(full guide: <a href="${ORIGIN}/llms.txt">https://numap.app/llms.txt</a>):</p>
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
</body></html>`);
};


// HTML mirrors for programs cover only the NEWEST catalog year: JSONs
// keep every year, but mirroring all years would compound the Pages
// file count (~1,000/year) for pages nobody searches for.
const newestYear = Math.max(...mirrorQueue.filter((m) => m.year).map((m) => m.year));
for (const m of mirrorQueue) {
  if (m.year && m.year !== newestYear) continue;
  writeHtmlMirror(m.rel, m.title, m.description, m.jsonUrl, m.data, m.body);
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
