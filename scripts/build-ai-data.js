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
  fs.writeFileSync(p, JSON.stringify(data, null, 1));
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

// ── Courses, split per subject ───────────────────────────────────────
// `sections` (a registration-time seat snapshot) is deliberately
// dropped: it's bulky and reads as live availability when it isn't.

const catalog = readJSON(path.join(ROOT, "public", "northeastern", "catalog-courses.json"));
const bySubject = new Map();
for (const course of catalog) {
  if (!course.subject || !course.number) continue;
  const { sections, ...rest } = course;
  if (!bySubject.has(course.subject)) bySubject.set(course.subject, []);
  bySubject.get(course.subject).push(rest);
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
    note: "Section/seat snapshots are not included here; they are registration-time data, not live availability.",
    courses,
  });
  subjects.push({ subject, count: courses.length, url });
}
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
  programCount: programs.length,
  courseCount: catalog.length,
  lastUpdated: meta.lastUpdated,
  generatedAt,
  disclaimer: DISCLAIMER,
});

console.log(`AI data export: ${programs.length} programs, ${catalog.length} courses in ${subjects.length} subjects → dist/northeastern/ai/`);
