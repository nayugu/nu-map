// ═══════════════════════════════════════════════════════════════════
// GRAD REQUIREMENTS  (pure validation — no React, no I/O)
//
// Works against the Major2 JSON schema, whose requirement vocabulary
// (COURSE / AND / OR / XOM / RANGE / SECTION) originates with
// sandboxnu/graduatenu (AGPL-3.0).
//
// PROVENANCE. The validation core (checkReq / checkSection /
// validateMajor) was reimplemented from
// docs/major2-validation-spec.md, which was derived only from the
// requirement vocabulary observed in our own program data, our own
// test suite, and the result contract our own consumers require.
// graduatenu's major2-validation.ts was not consulted. An earlier
// implementation of these three functions had been written with
// reference to that file to an extent the authors no longer recall;
// it was replaced for that reason. See LICENSING.md §9.1.
//
// Equivalence of the replacement was established differentially:
// identical results across all 1,006 programs in the shipped data
// × 5 placed-set variants (29,310 sections) and all 1,192 distinct
// requirement-node shapes, with the allocation pass unperturbed.
//
// All functions are pure: given a Major2 object and the current set
// of placed courses, they return a plain result tree suitable for
// rendering in GradPanel.
// ═══════════════════════════════════════════════════════════════════

// ── Course key helpers ───────────────────────────────────────────

/** Canonical course key: "CS3500" (no space, no separator). */
export const courseKey = (subject, id) => `${subject}${id}`;

/**
 * Get canonical keys of all co‑requisites of a course.
 */
function getCorequisiteKeys(course, courseMap) {
  const keys = [];
  if (course && course.coreqs) {
    for (const cq of course.coreqs) {
      if (cq && cq.subject && cq.number) {
        keys.push(courseKey(cq.subject, cq.number));
      }
    }
  }
  return keys;
}

/**
 * Build a Set of canonical course keys for every placed course.
 * Only courses that exist in courseMap are included.
 */
export function buildPlacedKeySet(placements, placedOut = new Set(), courseMap) {
  const keys = new Set();
  // Add placed courses (pass effectivePlacements to include substitution targets)
  for (const id of Object.keys(placements)) {
    const c = courseMap[id];
    if (c) keys.add(courseKey(c.subject, c.number));
  }
  // Add placed out courses
  for (const id of placedOut) {
    const c = courseMap[id];
    if (c) keys.add(courseKey(c.subject, c.number));
  }
  return keys;
}

// ── Requirement checking ─────────────────────────────────────────
//
// Implemented from docs/major2-validation-spec.md, which specifies the
// satisfaction rules for each requirement type and the result contract our
// own consumers (GradPanel, scripts/lib/major-integrity.js) rely on.

/** Credit hours assumed when a course record carries none. */
const DEFAULT_SH = 4;

/** Credit hours for a canonical course key. */
const creditsOf = (courseMap, key) => courseMap[key]?.sh ?? DEFAULT_SH;

/** RANGE matches are display keys ("CS 3500"); canonical keys have no space. */
const toCanonicalKey = (displayKey) => displayKey.replace(/\s+/g, '');

/** Join child labels for the compound-requirement label text. */
const labelList = (children) => children.map(c => c.label).join(', ');

/** Evaluate each child of a compound requirement. */
const checkAll = (nodes, placedSet, courseMap) =>
  (nodes ?? []).map(node => checkReq(node, placedSet, courseMap));

/**
 * Placed courses matching a RANGE, as display keys, in placed-set order.
 * Courses unknown to the course map, whose number does not parse, or listed
 * in `exceptions` are skipped.
 */
function matchRange(req, placedSet, courseMap) {
  const exceptions = req.exceptions ?? [];
  const matched = [];
  for (const key of placedSet) {
    const course = courseMap[key];
    if (!course || course.subject !== req.subject) continue;
    const number = parseInt(course.number, 10);
    if (Number.isNaN(number)) continue;
    if (number < req.idRangeStart || number > req.idRangeEnd) continue;
    if (exceptions.some(ex => courseKey(ex.subject, ex.classId) === key)) continue;
    matched.push(`${course.subject} ${course.number}`);
  }
  return matched;
}

/**
 * Credit hours a satisfied result contributes to an enclosing XOM pool.
 * Descends the result tree: a COURSE contributes its own credits, a RANGE the
 * credits of everything it matched, anything else the sum over its children.
 * Unsatisfied results contribute nothing.
 */
function satisfiedCredits(result, courseMap) {
  if (!result.sat) return 0;
  if (result.type === 'COURSE') return creditsOf(courseMap, result.key);
  if (result.type === 'RANGE') {
    return result.matched.reduce(
      (sum, displayKey) => sum + creditsOf(courseMap, toCanonicalKey(displayKey)), 0);
  }
  if (result.children?.length) {
    return result.children.reduce((sum, child) => sum + satisfiedCredits(child, courseMap), 0);
  }
  return 0;
}

/**
 * Per-type checkers, dispatched on `type`. Each takes the requirement node and
 * returns its result object; see the result contract in the spec.
 *
 * Null-prototype so that a scraped `type` colliding with an Object.prototype
 * member ("constructor", "toString") misses cleanly instead of resolving to an
 * inherited function.
 */
const CHECKERS = Object.assign(Object.create(null), {
  // A single named course.
  COURSE(req, placedSet) {
    const key = courseKey(req.subject, req.classId);
    const note = req.description ? `: ${req.description}` : '';
    return {
      type: 'COURSE', key, sat: placedSet.has(key),
      label: `${req.subject} ${req.classId}${note}`,
    };
  },

  // Every listed requirement. Vacuously satisfied when empty.
  AND(req, placedSet, courseMap) {
    const children = checkAll(req.courses, placedSet, courseMap);
    const satCount = children.filter(c => c.sat).length;
    return {
      type: 'AND', sat: satCount === children.length,
      satCount, total: children.length, children,
      label: `All of (${labelList(children)})`,
    };
  },

  // Any one of the listed requirements.
  OR(req, placedSet, courseMap) {
    const children = checkAll(req.courses, placedSet, courseMap);
    return {
      type: 'OR', sat: children.some(c => c.sat), children,
      label: `One of (${labelList(children)})`,
    };
  },

  // A credit-hour threshold over a pool. `groups`, where present, is display
  // metadata read only by the allocation pass.
  XOM(req, placedSet, courseMap) {
    const pool = req.courses ?? [];

    // Split credit: one course cross-counted into this section for part of its
    // credit. Satisfaction turns only on taking it, and the credit reported is
    // the allotment — never the course's full value, which would inflate totals
    // in every section listing it.
    if (pool.length === 1 && pool[0].type === 'COURSE') {
      const child = checkReq(pool[0], placedSet, courseMap);
      const allotted = req.numCreditsMin ?? creditsOf(courseMap, child.key);
      return {
        type: 'XOM', sat: child.sat,
        satSh: child.sat ? allotted : 0, reqSh: allotted,
        children: [child], label: child.label,
      };
    }

    const children = checkAll(pool, placedSet, courseMap);
    const satSh = children.reduce((sum, child) => sum + satisfiedCredits(child, courseMap), 0);
    return {
      type: 'XOM', sat: satSh >= req.numCreditsMin,
      satSh, reqSh: req.numCreditsMin, children,
      label: `${req.numCreditsMin}+ SH from pool`,
    };
  },

  // Any placed course inside a subject's number window.
  RANGE(req, placedSet, courseMap) {
    const matched = matchRange(req, placedSet, courseMap);
    return {
      type: 'RANGE', sat: matched.length > 0, matched,
      subject: req.subject,
      start: req.idRangeStart, end: req.idRangeEnd,
      label: `Any ${req.subject} ${req.idRangeStart}–${req.idRangeEnd}`,
    };
  },

  // Sections nest, and nested ones follow the same rule as top-level.
  SECTION(req, placedSet, courseMap) {
    return checkSection(req, placedSet, courseMap);
  },
});

/**
 * Check a single requirement node against the placed course set.
 *
 * An unrecognised type yields an unsatisfied result rather than throwing: a
 * malformed catalogue must not take the planner down.
 */
export function checkReq(req, placedSet, courseMap) {
  const checker = CHECKERS[req.type];
  if (!checker) {
    return { type: req.type ?? 'UNKNOWN', sat: false, label: String(req.type ?? 'Unknown') };
  }
  return checker(req, placedSet, courseMap);
}

/**
 * Check a section, top-level or nested. Satisfied once at least
 * `minRequirementCount` of its requirements are.
 */
export function checkSection(section, placedSet, courseMap) {
  const children = checkAll(section.requirements, placedSet, courseMap);
  const satCount = children.filter(c => c.sat).length;
  return {
    type: 'SECTION',
    title: section.title ?? '',
    warnings: section.warnings ?? [],
    sat: satCount >= section.minRequirementCount,
    satCount,
    minRequired: section.minRequirementCount,
    total: children.length,
    children,
  };
}

/**
 * Check every section of a major, in declaration order.
 *
 * Retained for completeness of this layer; the app reaches requirements through
 * allocateMajorWithElectives, and major-integrity uses checkSection directly.
 */
export function validateMajor(major, placedSet, courseMap) {
  return (major.requirementSections ?? []).map(s => checkSection(s, placedSet, courseMap));
}

// ── Credit totals ────────────────────────────────────────────────

/** Total SH of all placed courses. */
export function getTotalPlacedSH(placements, courseMap) {
  return Object.keys(placements).reduce((sum, id) => {
    const c = courseMap[id];
    return sum + (c?.sh ?? 0);
  }, 0);
}

// ── Allocation functions (prevent double-counting within a major) ──

/**
 * Build General Electives section: tracks courses placed but unallocated to major requirements.
 * These are "free choice" courses that count towards total credit hours but don't fulfill
 * any specific major requirement (can exceed required minimum).
 */
function buildGeneralElectivesSection(placedSet, sectionResults, courseMap) {
  // Collect all courses already allocated to major requirements
  const allocatedKeys = new Set();
  for (const section of sectionResults) {
    if (section.allocatedCourses) {
      section.allocatedCourses.forEach(k => allocatedKeys.add(k));
    }
  }

  // Find placed courses that are NOT allocated
  const generalElectiveKeys = [];
  let generalElectiveSH = 0;
  for (const key of placedSet) {
    if (!allocatedKeys.has(key)) {
      generalElectiveKeys.push(key);
      const course = courseMap[key];
      if (course) {
        generalElectiveSH += course.sh ?? 4;
      }
    }
  }

  // Build children array: one course per child
  const children = generalElectiveKeys.map(key => {
    const course = courseMap[key];
    return {
      type: 'COURSE',
      key,
      sat: true,
      label: course ? `${course.subject} ${course.number}` : key,
    };
  });

  return {
    type: 'SECTION',
    title: 'General Electives',
    warnings: [],
    sat: true,
    satCount: generalElectiveKeys.length,
    minRequired: 0,
    total: generalElectiveKeys.length,
    children,
    allocatedCourses: new Set(generalElectiveKeys),
    placedSH: generalElectiveSH,
    requiredSH: 0,
  };
}

/**
 * Merge sections that share the same title (parser bug in some combined majors).
 * Requirements are unioned by identity key; minRequirementCount takes the max.
 */
function mergeDuplicateSections(sections) {
  const seen = new Map(); // title → index in result
  const result = [];
  for (const section of sections) {
    const title = section.title;
    if (title && seen.has(title)) {
      const existing = result[seen.get(title)];
      const existingKeys = new Set(
        existing.requirements.map(r =>
          r.type === 'COURSE' ? `C:${r.subject}:${r.classId}` :
          r.type === 'RANGE'  ? `R:${r.subject}:${r.idRangeStart}:${r.idRangeEnd}` : null
        ).filter(Boolean)
      );
      for (const req of (section.requirements ?? [])) {
        const key =
          req.type === 'COURSE' ? `C:${req.subject}:${req.classId}` :
          req.type === 'RANGE'  ? `R:${req.subject}:${req.idRangeStart}:${req.idRangeEnd}` : null;
        if (!key || !existingKeys.has(key)) {
          existing.requirements = [...existing.requirements, req];
          if (key) existingKeys.add(key);
        }
      }
      existing.minRequirementCount = Math.max(
        existing.minRequirementCount ?? 0,
        section.minRequirementCount ?? 0
      );
    } else {
      if (title) seen.set(title, result.length);
      result.push({ ...section, requirements: [...(section.requirements ?? [])] });
    }
  }
  return result;
}

/**
 * Allocate courses to sections of a major, ensuring each course is used at most once.
 * Returns an array of section result objects, each with an additional `allocatedCourses` Set.
 * Automatically appends General Electives section at the end.
 */
export function allocateMajor(major, placedSet, courseMap) {
  const used = new Set();
  // Filter out "Required General Electives" placeholder - we generate our own
  const sectionsToAllocate = mergeDuplicateSections(
    (major.requirementSections ?? []).filter(
      section => section.title !== 'Required General Electives'
    )
  );
  const sectionResults = allocateSections(sectionsToAllocate, placedSet, used, courseMap);

  // Add General Electives section (tracks unallocated courses)
  const generalElectives = buildGeneralElectivesSection(placedSet, sectionResults, courseMap);
  sectionResults.push(generalElectives);

  return sectionResults;
}

/**
 * Collect all placed course keys that appear anywhere in a requirement result tree,
 * including inside unsatisfied AND nodes. Used to prevent a placed course from showing
 * in both a requirement section (as a candidate) and general electives simultaneously.
 * OR nodes are handled by only taking their committed allocatedCourses — unsatisfied
 * OR alternatives remain available for general electives.
 */
function collectCandidateKeys(sections, placedSet) {
  const keys = new Set();
  function visit(node) {
    if (!node) return;
    if (node.type === 'COURSE') {
      if (node.key && placedSet.has(node.key)) keys.add(node.key);
      return;
    }
    if (node.type === 'OR') {
      node.allocatedCourses?.forEach(k => keys.add(k));
      return;
    }
    node.allocatedCourses?.forEach(k => keys.add(k));
    (node.children ?? []).forEach(visit);
  }
  sections.forEach(visit);
  return keys;
}

/**
 * Allocate courses to an array of sections, sharing the same used set.
 */
export function allocateSections(sections, placedSet, globalUsed, courseMap) {
  const results = [];
  for (const section of sections) {
    // A hole in the array yields a placeholder rather than a crash. Index alignment
    // with `requirementSections` is load-bearing — `requirementDemand` and
    // `requirementBinding` both read `alloc[i]` against `sections[i]` — so the
    // placeholder has to occupy its slot rather than be skipped.
    if (!section || typeof section !== 'object') {
      results.push({ type: 'SECTION', title: '', warnings: [], sat: false, satCount: 0,
                     minRequired: 0, total: 0, children: [], allocatedCourses: new Set() });
      continue;
    }
    // Cross-count section (integrative/GPA re-lists, shared/split credit): its courses are
    // deliberately counted toward multiple requirements, so it must not be starved by, nor
    // starve, the sections that also list those courses. Evaluate it permissively (empty
    // originalUsed → never blocked by an earlier section) and do NOT commit its courses to
    // the global used set. Its allocatedCourses still exclude those courses from General
    // Electives, so credit is not double-counted toward the total.
    if (section.shared) {
      results.push(allocateSection(section, placedSet, new Set(), new Set(), courseMap));
      continue;
    }
    // Make a working copy of the global used set for this section
    const workingUsed = new Set(globalUsed);
    // Process the section with its own working set, and pass the original global set as 'originalUsed'
    const sectionResult = allocateSection(section, placedSet, workingUsed, globalUsed, courseMap);
    results.push(sectionResult);
    // After the section, commit its new allocations to the global set
    workingUsed.forEach(key => globalUsed.add(key));
  }
  return results;
}

/**
 * Allocate courses to a single section.
 */
/**
 * Normalize "pick N from pool" sections by flattening nested choice nodes.
 *
 * Systematic approach to handle various structures:
 * 1. SECTION with single choice wrapper (OR/AND with no explicit minRequirementCount):
 *    SECTION { requirements: [OR { courses: [N courses] }] }
 *    → Set minRequirementCount=1 and flatten choice node courses
 *
 * 2. SECTION with minRequirementCount < total containing mixed choice/course/range nodes:
 *    SECTION { minRequirementCount: 1, requirements: [COURSE, OR { ... }, RANGE, AND { ... }, ...] }
 *    → Flatten all choice nodes (OR/AND) to expose all options at same level
 *
 * This ensures all options appear as direct siblings, so minRequirementCount
 * applies uniformly across the entire pool. Handles any number of choice nodes.
 *
 * Exported because CHART derives its plan cells from the same sections this
 * allocates over, and a cell derived from the RAW shape would disagree with the
 * audit about how many things a section demands. Reshaping twice, in two places,
 * is the drift `requirementDemand.js` exists to prevent.
 */
export function normalizePooledSection(section) {
  if (!section || typeof section !== 'object') return { type: 'SECTION', requirements: [] };
  if (section.type !== 'SECTION') return section;

  const reqs = section.requirements ?? [];
  if (!reqs.length) return section;

  // Case 1: Single choice wrapper with no explicit minRequirementCount
  if (reqs.length === 1 && !section.minRequirementCount) {
    const node = reqs[0];
    if ((node.type === 'OR' || node.type === 'AND') && node.courses?.length >= 2) {
      return {
        ...section,
        minRequirementCount: 1,  // "Pick 1 of these"
        requirements: node.courses,  // Flatten to direct children
      };
    }
  }

  // Case 2: Explicit pool structure with minRequirementCount < total
  // Flatten only OR nodes (not AND) to expose all options at same level
  if (section.minRequirementCount && section.minRequirementCount < reqs.length) {
    const hasOrNode = reqs.some(req => req.type === 'OR');
    if (hasOrNode) {
      const flattened = [];
      for (const req of reqs) {
        if (req.type === 'OR' && req.courses?.length) {
          // Expand all options from OR nodes as direct siblings
          flattened.push(...req.courses);
        } else {
          flattened.push(req);
        }
      }
      // Return normalized structure if we actually modified it
      if (flattened.length !== reqs.length) {
        return {
          ...section,
          requirements: flattened,
        };
      }
    }
  }

  // Case 3: N/N all-RANGE (pooled electives) → wrap in XOM
  if (
    section.minRequirementCount === reqs.length &&
    reqs.length >= 2 &&
    reqs.every(r => r.type === 'RANGE' || r.type === 'COURSE') &&
    reqs.some(r => r.type === 'RANGE') &&
    !reqs.some(r => r.type === 'AND' || r.type === 'OR' || r.type === 'SECTION')
  ) {
    // Prefer explicit numCreditsMin if present
    let numCreditsMin = section.numCreditsMin;
    if (numCreditsMin == null) {
      // Sum any child numCreditsMin if present
      const childSum = reqs.reduce((sum, r) => sum + (r.numCreditsMin || 0), 0);
      numCreditsMin = childSum > 0 ? childSum : section.minRequirementCount * 4;
    }
    return {
      ...section,
      minRequirementCount: 1,
      requirements: [
        {
          type: 'XOM',
          numCreditsMin,
          courses: reqs
        }
      ]
    };
  }

  return section;
}

export function allocateSection(section, placedSet, used, originalUsed, courseMap) {
  // Normalize pooled sections (flatten choice nodes in "pick N" structures)
  const normalized = normalizePooledSection(section);

  // Enhanced pool detection: treat SECTIONs with a single XOM or RANGE child (with numCreditsMin or similar) as pools
  let children, satCount, total;
  const reqs = normalized.requirements ?? [];
  let isPool = false;
  if (normalized.minRequirementCount && reqs.length > 1 && normalized.minRequirementCount < reqs.length) {
    isPool = true;
  } else if (
    reqs.length === 1 &&
    (
      (reqs[0].type === 'XOM' && (reqs[0].numCreditsMin || reqs[0].numCreditsMin === 0)) ||
      (reqs[0].type === 'RANGE' && (normalized.numCreditsMin || reqs[0].numCreditsMin))
    )
  ) {
    isPool = true;
  }
  if (isPool) {
    satCount = 0;
    total = 0;
    children = reqs.map(req => {
      const child = allocateNode(req, placedSet, used, originalUsed, courseMap, true);
      if (typeof child.satCount === 'number' && typeof child.total === 'number') {
        satCount += child.satCount;
        total += child.total;
      } else {
        satCount += child.sat ? 1 : 0;
        total += 1;
      }
      return child;
    });
  } else {
    children = reqs.map(req => allocateNode(req, placedSet, used, originalUsed, courseMap, false));
    satCount = children.filter(c => c.sat).length;
    total = children.length;
  }
  const sat = satCount >= normalized.minRequirementCount;
  const allocatedCourses = new Set();
  children.forEach(c => c.allocatedCourses?.forEach(k => allocatedCourses.add(k)));
  return {
    type: 'SECTION',
    title: normalized.title ?? '',
    warnings: normalized.warnings ?? [],
    sat,
    satCount,
    minRequired: normalized.minRequirementCount,
    total,
    children,
    allocatedCourses,
  };
}

function allocateNode(node, placedSet, used, originalUsed, courseMap, poolContext = false) {
  // A hole or a scalar where a requirement node belongs. Unsatisfied and
  // contributing nothing is the honest reading; crashing would take out the whole
  // requirements panel over one bad entry.
  if (!node || typeof node !== 'object') {
    return { type: 'UNKNOWN', sat: false, label: '', allocatedCourses: new Set() };
  }
  switch (node.type) {
    case 'COURSE': {
      const key = courseKey(node.subject, node.classId);
      const course = courseMap[key];
      // Check if any coreq is already used in the original used set (outside this transaction)
      const coreqKeys = getCorequisiteKeys(course, courseMap);
      const anyCoreqUsedInOriginal = coreqKeys.some(k => originalUsed.has(k));
      const sat = placedSet.has(key) && !originalUsed.has(key) && !anyCoreqUsedInOriginal;
      if (sat) {
        used.add(key);
        // Mark all placed coreqs as used in this transaction (they cannot be used elsewhere later)
        coreqKeys.forEach(k => { if (placedSet.has(k)) used.add(k); });
      }
      const allocatedCourses = sat ? new Set([key, ...coreqKeys.filter(k => placedSet.has(k))]) : new Set();
      const desc = node.description ? `: ${node.description}` : '';
      return {
        type: 'COURSE',
        key,
        sat,
        label: `${node.subject} ${node.classId}${desc}`,
        allocatedCourses,
      };
    }

    case 'RANGE': {
      const matched = [];
      const allocatedCourses = new Set();
      for (const key of placedSet) {
        const c = courseMap[key];
        if (!c || c.subject !== node.subject) continue;
        const num = parseInt(c.number, 10);
        if (isNaN(num)) continue;
        if (num < node.idRangeStart || num > node.idRangeEnd) continue;
        const isExc = (node.exceptions ?? []).some(
          ex => courseKey(ex.subject, ex.classId) === key
        );
        if (isExc) continue;
        if (!originalUsed.has(key)) {
          const coreqKeys = getCorequisiteKeys(c, courseMap);
          const anyCoreqUsedInOriginal = coreqKeys.some(k => originalUsed.has(k));
          if (!anyCoreqUsedInOriginal) {
            matched.push(`${c.subject} ${c.number}`);
            allocatedCourses.add(key);
            coreqKeys.forEach(k => { if (placedSet.has(k)) allocatedCourses.add(k); });
            used.add(key);
            coreqKeys.forEach(k => { if (placedSet.has(k)) used.add(k); });
          }
        }
      }
      if (poolContext) {
        // In a pool, count all matches
        const sat = matched.length > 0;
        return {
          type: 'RANGE',
          sat,
          matched,
          subject: node.subject,
          start: node.idRangeStart,
          end: node.idRangeEnd,
          label: `Any ${node.subject} ${node.idRangeStart}–${node.idRangeEnd}`,
          allocatedCourses,
          satCount: matched.length,
          total: matched.length,
        };
      } else {
        // In standard requirements, only one match is needed
        const sat = matched.length > 0;
        return {
          type: 'RANGE',
          sat,
          matched,
          subject: node.subject,
          start: node.idRangeStart,
          end: node.idRangeEnd,
          label: `Any ${node.subject} ${node.idRangeStart}–${node.idRangeEnd}`,
          allocatedCourses,
        };
      }
    }

    case 'XOM': {
      // Split-credit pattern: a single required course whose SH is divided across
      // multiple sections (common in combined-degree programs like IECS).
      // Bypass originalUsed so the course can satisfy XOM requirements in more than
      // one section; still add to used so it is excluded from General Electives.
      if (node.courses?.length === 1 && node.courses[0].type === 'COURSE') {
        const child = node.courses[0];
        const key = courseKey(child.subject, child.classId);
        const sat = placedSet.has(key);
        const course = courseMap[key];
        // Report only the SH allotted to this section (numCreditsMin), not the full course
        // SH — the course's credit is split across the sections it appears in, so summing
        // the full SH per section would over-count. Satisfaction depends solely on whether
        // the course is taken.
        const allotted = node.numCreditsMin ?? (course?.sh ?? 4);
        const satSh = sat ? allotted : 0;
        const allocatedCourses = sat ? new Set([key]) : new Set();
        if (sat) used.add(key);
        const desc = child.description ? `: ${child.description}` : '';
        return {
          type: 'XOM',
          sat,
          satSh, reqSh: allotted,
          children: [{ type: 'COURSE', key, sat, label: `${child.subject} ${child.classId}${desc}`, allocatedCourses }],
          label: `${child.subject} ${child.classId}${desc}`,
          allocatedCourses,
        };
      }

      // Recursively allocate all children
      const children = (node.courses ?? []).map(child =>
        allocateNode(child, placedSet, used, originalUsed, courseMap)
      );


      // Helper: recursively sum credits from all satisfied leaf COURSEs and matched RANGEs
      function sumSatisfiedCredits(node) {
        if (!node) return 0;
        if (node.type === 'COURSE' && node.sat) {
          const c = courseMap[node.key];
          return c?.sh ?? 4;
        }
        if (node.type === 'RANGE' && node.sat && node.matched) {
          // matched contains "MATH 4581" etc
          return node.matched.reduce((sum, key) => {
            const normKey = key.replace(/\s+/g, '');
            const c = courseMap[normKey];
            return sum + (c?.sh ?? 4);
          }, 0);
        }
        if (node.children && node.children.length > 0) {
          return node.children.reduce((sum, child) => sum + sumSatisfiedCredits(child), 0);
        }
        return 0;
      }

      const satSh = children.reduce((sum, child) => sum + sumSatisfiedCredits(child), 0);
      const sat = satSh >= node.numCreditsMin;

      // Collect all allocated course keys from satisfied children.
      // Prefer node.allocatedCourses when present (covers RANGE and OR nodes
      // that already track their own set) before falling back to recursion.
      function collectAllocated(node, outSet) {
        if (!node) return;
        if (node.allocatedCourses?.size) {
          node.allocatedCourses.forEach(k => outSet.add(k));
          return;
        }
        if (node.type === 'COURSE' && node.sat) {
          outSet.add(node.key);
        }
        if (node.children?.length) {
          node.children.forEach(child => collectAllocated(child, outSet));
        }
      }
      const allocatedCourses = new Set();
      children.forEach(child => collectAllocated(child, allocatedCourses));

      // Reconstruct named area groups for display (present when scraper used "choose from areas" merge)
      let allocatedGroups = null;
      if (node.groups?.length) {
        let offset = 0;
        allocatedGroups = node.groups.map(g => {
          const len = g.courses.length;
          const groupChildren = children.slice(offset, offset + len);
          offset += len;
          return { title: g.title, children: groupChildren };
        });
      }

      return {
        type: 'XOM',
        sat,
        satSh,
        reqSh: node.numCreditsMin,
        children,
        ...(allocatedGroups ? { groups: allocatedGroups } : {}),
        label: `${node.numCreditsMin}+ SH from pool`,
        allocatedCourses,
      };
    }

    case 'AND': {
      const usedClone = new Set(used);
      const children = [];
      let allSat = true;
      for (const child of node.courses ?? []) {
        const childResult = allocateNode(child, placedSet, usedClone, originalUsed, courseMap);
        children.push(childResult);
        if (!childResult.sat) allSat = false;
      }

      // Count satisfied children for partial progress display
      const satCount = children.filter(c => c.sat).length;

      if (allSat) {
        usedClone.forEach(k => used.add(k));
        const allocatedCourses = new Set();
        children.forEach(c => c.allocatedCourses?.forEach(k => allocatedCourses.add(k)));
        return {
          type: 'AND',
          sat: true,
          satCount: children.length,
          total: children.length,
          children,
          label: `All of (${children.map(c => c.label).join(', ')})`,
          allocatedCourses,
        };
      } else {
        // Don't commit any allocations — AND failed, so nothing is consumed.
        // Keep per-child sat values from allocateNode so partial progress is visible
        // (e.g. 1/2 for a course+lab pair where only one is placed).
        return {
          type: 'AND',
          sat: false,
          satCount,
          total: children.length,
          children,
          label: `All of (${children.map(c => c.label).join(', ')})`,
          allocatedCourses: new Set(),
        };
      }
    }

    case 'OR': {
      // Always render all children so users can see and interact with all options
      const children = [];
      let satisfiedChild = null;
      let allocatedCourses = new Set();

      for (const child of node.courses ?? []) {
        const usedClone = new Set(used);
        const childResult = allocateNode(child, placedSet, usedClone, originalUsed, courseMap);

        // Keep track of the first satisfied child for allocation
        if (!satisfiedChild && childResult.sat) {
          satisfiedChild = childResult;
          usedClone.forEach(k => used.add(k));
          allocatedCourses = new Set(childResult.allocatedCourses);
        }

        // Always add to children array for display
        children.push(childResult);
      }

      return {
        type: 'OR',
        sat: !!satisfiedChild,
        satCount: satisfiedChild ? 1 : 0,
        total: children.length,
        children,
        label: `One of (${children.map(c => c.label).join(', ')})`,
        allocatedCourses,
      };
    }

    case 'SECTION':
      return allocateSection(node, placedSet, used, originalUsed, courseMap);

    default:
      return {
        type: node.type ?? 'UNKNOWN',
        sat: false,
        label: String(node.type ?? 'Unknown'),
        allocatedCourses: new Set(),
      };
  }
}
/**
 * Calculate "General Electives" — all placed courses not allocated to major requirements.
 * Returns a synthetic SECTION result with unallocated courses listed as children.
 * completedSet: keys of courses in completed semesters (for completedSH/plannedSH split).
 * candidateSet: keys appearing in any requirement node; excluded even if not in allocatedSet
 *               (prevents a course from showing in both a requirement section and GE when
 *               it is a candidate for an unsatisfied AND requirement).
 */
export function calculateGeneralElectives(placedSet, allocatedSet, courseMap, requiredSH = 0, completedSet = null, candidateSet = null, realPlacedSet = null) {
  const unallocated = [];
  let totalSH = 0;
  let completedSH = 0;

  // Iterate realPlacedSet when provided: virtual substitution-target entries in placedSet
  // must not appear as GE courses (they are only there for requirement satisfaction).
  for (const key of (realPlacedSet ?? placedSet)) {
    if (!allocatedSet.has(key) && !candidateSet?.has(key)) {
      const course = courseMap[key];
      if (course) {
        const sh = course.sh ?? 4;
        unallocated.push({
          type: 'COURSE',
          key,
          sat: true,
          label: `${course.subject} ${course.number}`,
          sh,
        });
        totalSH += sh;
        if (completedSet?.has(key)) completedSH += sh;
      }
    }
  }

  return {
    type: 'SECTION',
    title: 'General Electives',
    sat: true,
    satCount: unallocated.length,
    minRequired: 0,
    total: unallocated.length,
    children: unallocated,
    allocatedCourses: new Set(unallocated.map(c => c.key)),
    placedSH: totalSH,
    completedSH,
    plannedSH: totalSH - completedSH,
    requiredSH,
  };
}

/**
 * Allocate all sections + calculate general electives.
 * Returns sections array with general electives appended at end.
 * completedSet: optional set of course keys in completed semesters, for the SH split.
 */
export function allocateMajorWithElectives(major, placedSet, courseMap, completedSet = null, realPlacedSet = null) {
  const globalUsed = new Set();
  // Filter out "Required General Electives" placeholder - we generate our own
  const sectionsToAllocate = mergeDuplicateSections(
    (major.requirementSections ?? []).filter(
      section => section.title !== 'Required General Electives'
    )
  );
  const sections = allocateSections(sectionsToAllocate, placedSet, globalUsed, courseMap);
  const candidateKeys = collectCandidateKeys(sections, realPlacedSet ?? placedSet);
  const generalElectives = calculateGeneralElectives(placedSet, globalUsed, courseMap, major.generalElectiveSH ?? 0, completedSet, candidateKeys, realPlacedSet);
  return { sections, generalElectives, allocatedSet: globalUsed };
}
