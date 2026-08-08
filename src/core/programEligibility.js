// ═══════════════════════════════════════════════════════════════════
// PROGRAM ELIGIBILITY  (pure — no React, no I/O)
//
// Answers "could this catalog course count toward a program, and how?" by
// collecting the leaves named in a program's requirement tree, split into
// two buckets:
//
//   required — the course is named directly as a must-take requirement.
//   elective — the course is one of several ways to satisfy a requirement:
//              a "choose N from …" pool (XOM), an OR / under-filled section,
//              or a course-range slot (RANGE).
//
// A single course can land in BOTH buckets across different sections (e.g.
// named in one section, an elective option in another) — the buckets are
// not mutually exclusive. This is the candidate-facing complement to
// allocateNode() in gradRequirements.js (which matches *placed* courses and
// consumes them). Open-ended "any course" electives are not enumerable and
// are never matched here.
// ═══════════════════════════════════════════════════════════════════

import { courseKey } from "./gradRequirements.js";

/**
 * @typedef {Object} EligibleSpec
 * @property {Set<string>} keys   Canonical course keys named directly (COURSE nodes).
 * @property {{subject:string, start:number, end:number, exceptions:Set<string>}[]} ranges
 */

/** @returns {EligibleSpec} an empty spec. */
export function emptySpec() {
  return { keys: new Set(), ranges: [] };
}

function addRange(spec, node) {
  spec.ranges.push({
    subject: node.subject,
    start: node.idRangeStart,
    end: node.idRangeEnd,
    exceptions: new Set((node.exceptions ?? []).map(ex => courseKey(ex.subject, ex.classId))),
  });
}

// `choose` is true once we're inside a "choose from" context — a pool, an OR,
// or an under-filled section — where a reached course is an elective option
// rather than a named must-take.
function walkNode(node, req, elec, choose) {
  if (!node) return;
  if (Array.isArray(node)) { node.forEach(n => walkNode(n, req, elec, choose)); return; }
  switch (node.type) {
    case "COURSE":
      (choose ? elec : req).keys.add(courseKey(node.subject, node.classId));
      break;
    case "RANGE":
      // A range is inherently "any course in this span" → an elective match.
      addRange(elec, node);
      break;
    case "SECTION": {
      const reqs = node.requirements ?? [];
      // "Choose N of M" (min < count) makes the section's children options.
      const underfilled = typeof node.minRequirementCount === "number" && node.minRequirementCount < reqs.length;
      walkNode(reqs, req, elec, choose || underfilled);
      break;
    }
    case "XOM":
      // A single-course XOM is the split-credit pattern (a genuine requirement);
      // any larger pool is a choose-from set of electives.
      if (node.courses?.length === 1 && node.courses[0]?.type === "COURSE") {
        walkNode(node.courses, req, elec, choose);
      } else {
        walkNode(node.courses, req, elec, true);
      }
      break;
    case "OR":
      walkNode(node.courses, req, elec, true);
      break;
    case "AND":
      walkNode(node.courses, req, elec, choose);
      break;
    default:
      break;
  }
}

/**
 * Collect the required/elective specs from a program JSON (or any object
 * exposing `requirementSections`). Safe on null/partial input.
 *
 * @param {Object|null} programData
 * @returns {{required: EligibleSpec, elective: EligibleSpec}}
 */
export function collectEligibleSpec(programData) {
  const required = emptySpec();
  const elective = emptySpec();
  walkNode(programData?.requirementSections, required, elective, false);
  return { required, elective };
}

/**
 * The courses that can answer ONE requirement node, as a single spec.
 *
 * collectEligibleSpec answers "can this course count anywhere in the program" —
 * a whole-program question that deliberately flattens away which section a
 * course belongs to. Slot binding asks the opposite question, "what belongs in
 * THIS reservation", and needs the per-section answer.
 *
 * The required/elective split is unioned rather than kept, because from a
 * slot's point of view that distinction does not exist: a section naming
 * CS 3000 outright and a section offering a choice of eight both answer "what
 * may go here" with a set of courses.
 *
 * @param {Object|null} node  any requirement node, or a SECTION
 * @returns {EligibleSpec}
 */
export function specForNode(node) {
  const spec = emptySpec();
  walkNode(node, spec, spec, false);
  return spec;
}

/** True when a spec names nothing at all — an open-ended "any course" slot. */
export function specIsEmpty(spec) {
  return !spec || (!spec.keys.size && !spec.ranges.length);
}

/** Union several split specs into one `{required, elective}`. */
export function mergeSplitSpecs(...splits) {
  const required = emptySpec();
  const elective = emptySpec();
  for (const s of splits) {
    if (!s) continue;
    s.required?.keys.forEach(k => required.keys.add(k));
    if (s.required?.ranges) required.ranges.push(...s.required.ranges);
    s.elective?.keys.forEach(k => elective.keys.add(k));
    if (s.elective?.ranges) elective.ranges.push(...s.elective.ranges);
  }
  return { required, elective };
}

/**
 * Does a catalog course match a single spec (one bucket)?
 *
 * @param {{id:string, subject:string, number:string}} course
 * @param {EligibleSpec} spec
 * @returns {boolean}
 */
export function courseEligible(course, spec) {
  if (!course || !spec) return false;
  if (spec.keys.has(course.id)) return true;
  if (!spec.ranges.length) return false;
  const num = parseInt(course.number, 10);
  if (Number.isNaN(num)) return false;
  return spec.ranges.some(
    r => course.subject === r.subject &&
         num >= r.start && num <= r.end &&
         !r.exceptions.has(course.id)
  );
}

/**
 * True when a course genuinely counts as an *elective* — it fills a
 * choose-from / range slot AND is not itself a required (core) course of any
 * selected program. A required course can never double as an elective (e.g.
 * a CS technical-elective range spans CS core courses, but those cores are
 * not electives).
 *
 * @param {{id:string, subject:string, number:string}} course
 * @param {EligibleSpec} required
 * @param {EligibleSpec} elective
 */
export function countsAsElectiveOnly(course, required, elective) {
  return courseEligible(course, elective) && !courseEligible(course, required);
}
