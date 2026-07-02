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

import { checkSection, allocateMajor, courseKey } from '../../src/core/gradRequirements.js';

/** Build "student took every named course" placement set + minimal courseMap for a major. */
export function placeEveryCourse(major) {
  const placedSet = new Set();
  const courseMap = {};
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'COURSE') {
      const k = courseKey(n.subject, n.classId);
      placedSet.add(k);
      courseMap[k] = { subject: n.subject, number: String(n.classId), sh: 4 };
    }
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  (major.requirementSections ?? []).forEach(walk);
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
