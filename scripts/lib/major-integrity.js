/**
 * major-integrity.js — shared helpers for detecting and repairing "impossible" sections.
 *
 * A requirement section is *impossible* when it is satisfiable in principle (checkSection,
 * where a course may satisfy everything it matches) but unsatisfiable after allocation
 * (allocateMajor, where each course is used at most once within the major). That gap means a
 * course listed in the section is consumed by an earlier section, so a student who takes
 * every listed course still cannot complete it — which never happens in a real, completable
 * degree. The catalog intends the course to count toward both requirements (integrative
 * courses, GPA/credit re-lists, split/supplemental credit). The repair marks such sections
 * `shared: true`; the allocator then evaluates them permissively without consuming courses
 * (see allocateSections in src/core/gradRequirements.js).
 *
 * Used by scripts/scrape-majors.js (auto-mark on every scrape), scripts/migrate-shared-
 * sections.js (fix existing data), and scripts/check-major-integrity.js (regression guard).
 */

import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { checkSection, allocateMajor, courseKey } from '../../src/core/gradRequirements.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ALL_COURSES_PATH = resolve(ROOT, 'public/northeastern/all-courses.json');
const FALLBACK_SH = 4; // only for a named course absent from the catalog (rare)

/**
 * Real catalog, indexed by subject → sorted [{ num, sh }]. A RANGE like "MATH 3001–4999" is
 * an open pool whose members and credit values we should not guess: courses are 4 SH *most*
 * of the time but frequently 3, 1, or 2, and a range holds however many real courses it holds.
 * Loading the actual catalog lets the integrity model use true membership and true credits
 * instead of fabricated stand-ins. Built once and memoized; if the file is absent (e.g. a
 * bare checkout) ranges simply contribute no extra members and the model degrades gracefully.
 */
let COURSE_INDEX;
function courseIndex() {
  if (COURSE_INDEX) return COURSE_INDEX;
  COURSE_INDEX = new Map();
  let all;
  try { all = JSON.parse(readFileSync(ALL_COURSES_PATH, 'utf8')); } catch { return COURSE_INDEX; }
  for (const c of all) {
    const num = parseInt(c.number, 10);
    if (!Number.isFinite(num)) continue;
    const sh = typeof c.credits === 'number' ? c.credits : 0;
    if (!COURSE_INDEX.has(c.subject)) COURSE_INDEX.set(c.subject, []);
    COURSE_INDEX.get(c.subject).push({ num, sh });
  }
  return COURSE_INDEX;
}

/** Real semester-hours for a specific course, or the fallback if it isn't in the catalog. */
function realSh(subject, num) {
  const list = courseIndex().get(subject);
  const hit = list?.find((c) => c.num === num);
  return hit ? hit.sh : FALLBACK_SH;
}

/**
 * Build a *witness* placement for a major: the student takes every named course, PLUS every
 * real catalog course that falls inside each open RANGE pool — each with its true credit value.
 *
 * Named courses are the only contended resource: the same course can be listed in several
 * sections, and single-use allocation lets the first section consume it. A RANGE, by contrast,
 * is an open set of many real courses, which a student satisfies with *additional* courses that
 * appear in no other requirement. Placing only named courses under-represents that — a range's
 * sole "known" members become the few courses that happen to be named elsewhere, so once those
 * are consumed the pool looks impossible. Populating each range from the actual catalog (true
 * membership, true semester-hours — not an assumed count or an assumed 4 SH) models reality, so
 * the impossibility check flags only genuine named-course collisions, never open elective pools.
 * A range with too few real credits to meet its threshold is simply unsatisfiable in principle
 * (checkSection fails too), so it is never mislabeled as a shared/cross-count section.
 */
export function placeEveryCourse(major) {
  const placedSet = new Set();
  const courseMap = {};

  const place = (subject, num, sh) => {
    const k = courseKey(subject, num);
    placedSet.add(k);
    courseMap[k] = { subject, number: String(num), sh };
  };

  // Pass 1: place every named course with its real credit value; collect the ranges.
  const ranges = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'COURSE') { place(node.subject, node.classId, realSh(node.subject, node.classId)); return; }
    if (node.type === 'RANGE')  { ranges.push(node); return; }
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  (major.requirementSections ?? []).forEach(walk);

  // Pass 2: add every real catalog course inside each range (minus its exceptions), so an
  // open pool is satisfied by genuinely-additional electives instead of the named courses it
  // happens to overlap. Named placements are left intact.
  for (const node of ranges) {
    const excluded = new Set((node.exceptions ?? []).map((ex) => courseKey(ex.subject, ex.classId)));
    for (const { num, sh } of courseIndex().get(node.subject) ?? []) {
      if (num < node.idRangeStart || num > node.idRangeEnd) continue;
      const k = courseKey(node.subject, num);
      if (excluded.has(k) || placedSet.has(k)) continue;
      place(node.subject, num, sh);
    }
  }

  return { placedSet, courseMap };
}

/**
 * Return the titles of sections that are satisfiable in principle but impossible after
 * allocation, honoring any `shared` flags already present on the major's sections.
 */
export function impossibleSectionTitles(major) {
  if (!Array.isArray(major.requirementSections)) return [];
  const { placedSet, courseMap } = placeEveryCourse(major);
  const allocated = allocateMajor(major, placedSet, courseMap);
  const allocByTitle = new Map(allocated.map((s) => [s.title, s]));

  const titles = [];
  for (const section of major.requirementSections) {
    if (section.title === 'Required General Electives') continue;
    if (section.shared) continue; // already repaired
    const ideal = checkSection(section, placedSet, courseMap);
    const alloc = allocByTitle.get(section.title);
    if (ideal.sat && alloc && !alloc.sat) titles.push(section.title);
  }
  return titles;
}

/**
 * Mark every impossible section on `major` with `shared: true`, iterating to a fixed point
 * (marking one section shared frees its courses and can resolve others without marking them).
 * Mutates `major` in place. Returns the number of sections newly marked.
 */
export function markSharedSections(major) {
  if (!Array.isArray(major.requirementSections)) return 0;
  let marked = 0;
  for (let pass = 0; pass < 20; pass++) {
    const titles = new Set(impossibleSectionTitles(major));
    if (titles.size === 0) break;
    for (const section of major.requirementSections) {
      if (!section.shared && titles.has(section.title)) {
        section.shared = true;
        marked++;
      }
    }
  }
  return marked;
}
