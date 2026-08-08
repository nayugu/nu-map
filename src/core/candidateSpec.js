// ═══════════════════════════════════════════════════════════════════
// CANDIDATE SPEC ALGEBRA  (pure — no React, no I/O)
//
// An `EligibleSpec` (see programEligibility.js) is a COMPRESSED SET of courses:
//
//   { keys: Set<"CS3500">, ranges: [{subject, start, end, exceptions: Set}] }
//
// A `MATH 3001–4999` requirement is four numbers, not the 41 ids it happens to
// expand to this month. That is the whole reason candidates are stored this way
// — an expanded list goes stale against the next scrape, a spec cannot.
//
// This file gives that representation the three operations a candidate set
// needs, WITHOUT ever expanding it:
//
//   union      what either requirement admits
//   intersect  what both admit
//   subtract   what is left after removing specific courses
//
// ── Why these are exact, and what "exact" is measured against ───────
//
// A spec denotes a set of REAL courses: the ones `courseEligible` accepts. Two
// specs are equal when they accept the same catalog courses. A key naming a
// course the catalog does not have denotes nothing, so dropping it changes no
// answer — which is what lets `intersect` avoid ever parsing "CS3500" back into
// ("CS", 3500). That parse looks harmless and is not: keys are built by
// `courseKey(subject, id)` with no separator, so recovering the halves means
// guessing where the subject ends, and a single course numbered with a trailing
// letter would silently corrupt the result. Resolving through the course map
// instead makes the operation agree with `courseEligible` BY CONSTRUCTION
// rather than by a second implementation that has to be kept in step.
//
// The denotation each operation must preserve:
//
//   S(spec) = keys ∪ ⋃ᵣ { c : c.subject = r.subject,
//                              r.start ≤ c.number ≤ r.end,
//                              c.id ∉ r.exceptions }
//
// Note `keys` wins over an exception — a course named directly is eligible even
// if some range in the same spec excludes it. `courseEligible` checks keys
// first and returns early, and every operation here preserves that.
// ═══════════════════════════════════════════════════════════════════

import { emptySpec, courseEligible } from "./programEligibility.js";

/**
 * Make a spec safe to hand to `courseEligible`.
 *
 * `courseEligible` reads `spec.keys.has(...)` unguarded, so a half-built spec —
 * `{ranges: []}` from a partial parse, an object from JSON where the Set became
 * an array — throws rather than returning false. Specs arrive from scraped data
 * and from restored plans, so half-built is a real input, not a hypothetical.
 *
 * Normalising here rather than loosening `courseEligible` keeps ONE definition
 * of eligibility. A null-safe copy of that predicate living in this file is the
 * exact shape of bug this codebase keeps paying for.
 *
 * Returns the input unchanged when it is already well formed, so the common
 * path allocates nothing.
 */
function normalizeSpec(spec) {
  if (!spec) return emptySpec();
  const keysOk = spec.keys instanceof Set;
  const rangesOk = Array.isArray(spec.ranges)
    && spec.ranges.every(r => r && r.exceptions instanceof Set);
  if (keysOk && rangesOk) return spec;
  return {
    keys: spec.keys instanceof Set ? spec.keys : new Set(spec.keys ?? []),
    ranges: (Array.isArray(spec.ranges) ? spec.ranges : []).filter(Boolean).map(r => ({
      subject: r.subject, start: r.start, end: r.end,
      exceptions: r.exceptions instanceof Set ? r.exceptions : new Set(r.exceptions ?? []),
    })),
  };
}

/** A spec is never mutated in place; callers may hold on to their inputs. */
export function cloneSpec(spec) {
  const s = normalizeSpec(spec);
  return {
    keys: new Set(s.keys),
    ranges: s.ranges.map(r => ({
      subject: r.subject, start: r.start, end: r.end,
      exceptions: new Set(r.exceptions),
    })),
  };
}

/**
 * Everything either spec admits.
 *
 * The denotation is already a union of pieces, so this is concatenation — no
 * course map needed and nothing to reconcile. It is the cheap direction, and
 * it stays cheap however many specs are combined.
 */
export function unionSpec(a, b) {
  if (!a) return cloneSpec(b);
  if (!b) return cloneSpec(a);
  const out = cloneSpec(a);            // normalises the left side
  const rhs = normalizeSpec(b);        // and the right, so a hole cannot throw
  for (const k of rhs.keys) out.keys.add(k);
  for (const r of rhs.ranges) {
    out.ranges.push({ subject: r.subject, start: r.start, end: r.end,
                      exceptions: new Set(r.exceptions) });
  }
  return out;
}

/** Union of many, left to right. */
export function unionAll(specs) {
  let out = emptySpec();
  for (const s of specs ?? []) out = unionSpec(out, s);
  return out;
}

/**
 * Everything BOTH specs admit.
 *
 * Expanding the denotation gives four terms:
 *
 *   (Kₐ ∪ Rₐ) ∩ (K_b ∪ R_b)
 *     = (Kₐ ∩ K_b) ∪ (Kₐ ∩ R_b) ∪ (Rₐ ∩ K_b) ∪ (Rₐ ∩ R_b)
 *
 * The first three are all "a named course that the other spec also accepts", so
 * they collapse into a single pass over both key sets testing `courseEligible`
 * against the opposite spec. The fourth is interval arithmetic per subject.
 *
 * Exceptions UNION on an intersected range: the result must exclude anything
 * either side excluded. That cannot wrongly drop a course named directly,
 * because such a course was already captured by the key terms above and keys
 * win over exceptions.
 *
 * @param {object} courseMap  id → course. Required: it is what makes a key
 *   testable against a range without parsing the key.
 */
export function intersectSpec(rawA, rawB, courseMap = {}) {
  const out = emptySpec();
  if (!rawA || !rawB) return out;
  const a = normalizeSpec(rawA), b = normalizeSpec(rawB);

  // Terms 1–3. A key denotes nothing unless the catalog has that course, so an
  // unknown key is dropped — it could never have matched anything.
  for (const k of [...a.keys, ...b.keys]) {
    const course = courseMap[k];
    if (!course) continue;
    if (courseEligible(course, a) && courseEligible(course, b)) out.keys.add(k);
  }

  // Term 4. Ranges only ever intersect within one subject.
  for (const ra of a.ranges) {
    for (const rb of b.ranges) {
      if (ra.subject !== rb.subject) continue;
      const start = Math.max(ra.start, rb.start);
      const end   = Math.min(ra.end, rb.end);
      if (start > end) continue;
      out.ranges.push({
        subject: ra.subject, start, end,
        exceptions: new Set([...(ra.exceptions ?? []), ...(rb.exceptions ?? [])]),
      });
    }
  }
  return out;
}

/** Intersection of many, left to right. Empty input is the empty spec. */
export function intersectAll(specs, courseMap = {}) {
  const list = (specs ?? []).filter(Boolean);
  if (!list.length) return emptySpec();
  let out = cloneSpec(list[0]);
  for (let i = 1; i < list.length; i++) out = intersectSpec(out, list[i], courseMap);
  return out;
}

/**
 * Everything this spec admits except the given course ids.
 *
 * Removing a key is not enough — the same course may also fall inside a range —
 * so the id is added to every range's exception set as well. That is precisely
 * what `exceptions` already means, so nothing new is being represented.
 */
export function subtractIds(spec, ids) {
  const drop = ids instanceof Set ? ids : new Set(ids ?? []);
  const out = cloneSpec(spec);
  if (!drop.size) return out;
  for (const id of drop) out.keys.delete(id);
  for (const r of out.ranges) for (const id of drop) r.exceptions.add(id);
  return out;
}

/** True when a spec accepts nothing at all (as opposed to "anything"). */
export function isEmptySpec(spec) {
  if (!spec) return true;
  const s = normalizeSpec(spec);
  return s.keys.size === 0 && s.ranges.length === 0;
}

/**
 * The actual course ids, finally.
 *
 * Deliberately the ONLY place expansion happens, and it takes the course map as
 * the universe — so "what is in this set" is always answered against today's
 * catalog rather than against a list frozen at scrape time.
 *
 * @returns {Set<string>}
 */
export function materialize(rawSpec, courseMap) {
  const out = new Set();
  if (!rawSpec || !courseMap) return out;
  const spec = normalizeSpec(rawSpec);
  // Keys first: they are exact and need no scan.
  for (const k of spec.keys) if (courseMap[k]) out.add(k);
  if (!spec.ranges.length) return out;
  for (const id in courseMap) {
    if (out.has(id)) continue;
    if (courseEligible(courseMap[id], spec)) out.add(id);
  }
  return out;
}

/** How many real courses a spec accepts, without building the set. */
export function countSpec(spec, courseMap) {
  return materialize(spec, courseMap).size;
}
