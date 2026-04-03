// ═══════════════════════════════════════════════════════════════════
// GRAD REQUIREMENTS  (pure validation — no React, no I/O)
//
// Ports the core of graduatenu's major2-validation.ts to plain JS.
// Works against the Major2 JSON schema from the graduatenu fork.
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

/**
 * Recursively check a single Requirement2 node.
 *
 * Returns a result object:
 *   {
 *     type     — mirrors the requirement type (COURSE | AND | OR | XOM | RANGE | SECTION)
 *     sat      — boolean: is this requirement satisfied?
 *     label    — human-readable summary string
 *     children — child result nodes (for compound types)
 *     // type-specific extras:
 *     key               (COURSE)
 *     satCount, total   (AND, SECTION)
 *     satSh, reqSh      (XOM)
 *     matched[]         (RANGE)
 *   }
 */
export function checkReq(req, placedSet, courseMap) {
  switch (req.type) {

    // ── Single required course ────────────────────────────────────
    case 'COURSE': {
      const key = courseKey(req.subject, req.classId);
      const sat = placedSet.has(key);
      const desc = req.description ? ` — ${req.description}` : '';
      return {
        type: 'COURSE', key, sat,
        label: `${req.subject} ${req.classId}${desc}`,
      };
    }

    // ── ALL of the listed courses ─────────────────────────────────
    case 'AND': {
      const children = (req.courses ?? []).map(c => checkReq(c, placedSet, courseMap));
      const satCount = children.filter(c => c.sat).length;
      return {
        type: 'AND', sat: satCount === children.length,
        satCount, total: children.length, children,
        label: `All of (${children.map(c => c.label).join(', ')})`,
      };
    }

    // ── ONE of the listed courses ─────────────────────────────────
    case 'OR': {
      const children = (req.courses ?? []).map(c => checkReq(c, placedSet, courseMap));
      const sat = children.some(c => c.sat);
      return {
        type: 'OR', sat, children,
        label: `One of (${children.map(c => c.label).join(', ')})`,
      };
    }

    // ── X or more credit-hours from the listed pool ───────────────
    case 'XOM': {
      const children = (req.courses ?? []).map(c => checkReq(c, placedSet, courseMap));

      // Sum the SH of every satisfied leaf course in the pool.
      // For RANGE children we sum all matching placed courses' SH.
      let satSh = 0;
      function accumulateSh(r) {
        if (!r.sat) return;
        if (r.type === 'COURSE') {
          const c = courseMap[r.key];
          satSh += c?.sh ?? 4;
        } else if (r.type === 'RANGE') {
          for (const key of r.matched) {
            // matched contains "CS 3500" (with space) — normalise back
            const normKey = key.replace(/\s+/g, '');
            const c = courseMap[normKey];
            satSh += c?.sh ?? 4;
          }
        } else if (r.children?.length) {
          r.children.forEach(accumulateSh);
        }
      }
      children.forEach(accumulateSh);

      return {
        type: 'XOM', sat: satSh >= req.numCreditsMin,
        satSh, reqSh: req.numCreditsMin, children,
        label: `${req.numCreditsMin}+ SH from pool`,
      };
    }

    // ── Any course within a subject/number range ──────────────────
    case 'RANGE': {
      const matched = [];
      for (const key of placedSet) {
        const c = courseMap[key];
        if (!c || c.subject !== req.subject) continue;
        const num = parseInt(c.number, 10);
        if (isNaN(num)) continue;
        if (num < req.idRangeStart || num > req.idRangeEnd) continue;
        // Skip exception courses
        const isExc = (req.exceptions ?? []).some(
          ex => courseKey(ex.subject, ex.classId) === key
        );
        if (!isExc) matched.push(`${c.subject} ${c.number}`);
      }
      return {
        type: 'RANGE', sat: matched.length > 0, matched,
        subject: req.subject,
        start: req.idRangeStart, end: req.idRangeEnd,
        label: `Any ${req.subject} ${req.idRangeStart}–${req.idRangeEnd}`,
      };
    }

    // ── Nested section (same logic as top-level) ──────────────────
    case 'SECTION':
      return checkSection(req, placedSet, courseMap);

    default:
      return { type: req.type ?? 'UNKNOWN', sat: false, label: String(req.type ?? 'Unknown') };
  }
}

/**
 * Check a Section (top-level or nested).
 * A section is satisfied when ≥ minRequirementCount of its children are.
 */
export function checkSection(section, placedSet, courseMap) {
  const children = (section.requirements ?? []).map(r => checkReq(r, placedSet, courseMap));
  const satCount = children.filter(r => r.sat).length;
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
 * Validate all sections of a major against the current placed course set.
 * Returns an array of section result objects (same order as major.requirementSections).
 */
export function validateMajor(major, placedSet, courseMap) {
  return (major.requirementSections ?? []).map(s => checkSection(s, placedSet, courseMap));
}

// ── NUPath ───────────────────────────────────────────────────────

/** Return a Set of NUPath keys (e.g. "FQ", "ND") covered by placed courses. */
export function getNuPathCoverage(placements, courseMap) {
  const covered = new Set();
  for (const id of Object.keys(placements)) {
    const c = courseMap[id];
    if (c?.nuPath) c.nuPath.forEach(np => covered.add(np));
  }
  return covered;
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
    sat: true, // Always "satisfied" since it's flexible
    satCount: generalElectiveKeys.length,
    minRequired: 0, // No minimum (can go over required limit)
    total: generalElectiveKeys.length,
    children,
    allocatedCourses: new Set(generalElectiveKeys),
    // Add SH info for display
    totalSH: generalElectiveSH,
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
 * Allocate courses to an array of sections, sharing the same used set.
 */
export function allocateSections(sections, placedSet, globalUsed, courseMap) {
  const results = [];
  for (const section of sections) {
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
 */
function normalizePooledSection(section) {
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
  // Flatten all nested choice nodes (OR/AND) to expose all options at same level
  if (section.minRequirementCount && section.minRequirementCount < reqs.length) {
    const hasChoiceNode = reqs.some(req => req.type === 'OR' || req.type === 'AND');
    if (hasChoiceNode) {
      const flattened = [];
      for (const req of reqs) {
        if ((req.type === 'OR' || req.type === 'AND') && req.courses?.length) {
          // Expand all options from choice nodes as direct siblings
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

  return section;
}

export function allocateSection(section, placedSet, used, originalUsed, courseMap) {
  // Normalize pooled sections (flatten choice nodes in "pick N" structures)
  const normalized = normalizePooledSection(section);

  const children = (normalized.requirements ?? []).map(req => allocateNode(req, placedSet, used, originalUsed, courseMap));
  const satCount = children.filter(c => c.sat).length;
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
    total: children.length,
    children,
    allocatedCourses,
  };
}

function allocateNode(node, placedSet, used, originalUsed, courseMap) {
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
      const desc = node.description ? ` — ${node.description}` : '';
      return {
        type: 'COURSE',
        key,
        sat,
        label: `${node.subject} ${node.classId}${desc}`,
        allocatedCourses,
      };
    }

    case 'RANGE': {
      const candidates = [];
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
          if (!anyCoreqUsedInOriginal) candidates.push(key);
        }
      }
      const chosen = candidates.length > 0 ? candidates[0] : null;
      let coreqKeys = [];
      if (chosen) {
        used.add(chosen);
        const c = courseMap[chosen];
        coreqKeys = getCorequisiteKeys(c, courseMap);
        coreqKeys.forEach(k => { if (placedSet.has(k)) used.add(k); });
      }
      const sat = !!chosen;
      const allocatedCourses = sat ? new Set([chosen, ...coreqKeys.filter(k => placedSet.has(k))]) : new Set();
      return {
        type: 'RANGE',
        sat,
        matched: sat ? [`${courseMap[chosen].subject} ${courseMap[chosen].number}`] : [],
        subject: node.subject,
        start: node.idRangeStart,
        end: node.idRangeEnd,
        label: `Any ${node.subject} ${node.idRangeStart}–${node.idRangeEnd}`,
        allocatedCourses,
      };
    }

    case 'XOM': {
      const possibleCourses = new Map(); // key -> SH

      function collect(node) {
        if (node.type === 'COURSE') {
          const key = courseKey(node.subject, node.classId);
          const c = courseMap[key];
          if (!c) return;
          if (placedSet.has(key) && !used.has(key) && !possibleCourses.has(key)) {
            const coreqKeys = getCorequisiteKeys(c, courseMap);
            const anyCoreqUsedInOriginal = coreqKeys.some(k => originalUsed.has(k));
            if (!anyCoreqUsedInOriginal) {
              possibleCourses.set(key, c.sh);
            }
          }
        } else if (node.type === 'RANGE') {
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
            if (!used.has(key) && !possibleCourses.has(key)) {
              const coreqKeys = getCorequisiteKeys(c, courseMap);
              const anyCoreqUsedInOriginal = coreqKeys.some(k => originalUsed.has(k));
              if (!anyCoreqUsedInOriginal) {
                possibleCourses.set(key, c.sh);
              }
            }
          }
        }
        // For AND/OR, we could recursively collect, but we'll assume not present.
      }

      for (const child of node.courses ?? []) {
        collect(child);
      }

      const sorted = Array.from(possibleCourses.entries()).sort((a, b) => b[1] - a[1]);
      const allocated = [];
      let sum = 0;
      for (const [key, sh] of sorted) {
        if (sum >= node.numCreditsMin) break;
        const c = courseMap[key];
        const coreqKeys = getCorequisiteKeys(c, courseMap);
        // Check if any coreq is already used (either in originalUsed or from previous picks in this XOM)
        const anyCoreqUsed = coreqKeys.some(k => used.has(k));
        if (anyCoreqUsed) continue;
        allocated.push(key);
        sum += sh;
        used.add(key);
        coreqKeys.forEach(k => { if (placedSet.has(k)) used.add(k); });
      }
      const sat = sum >= node.numCreditsMin;
      const satSh = sum;

      const children = (node.courses ?? []).map(child => {
        if (child.type === 'COURSE') {
          const key = courseKey(child.subject, child.classId);
          const childSat = allocated.includes(key);
          const desc = child.description ? ` — ${child.description}` : '';
          return {
            type: 'COURSE',
            key,
            sat: childSat,
            label: `${child.subject} ${child.classId}${desc}`,
            allocatedCourses: childSat ? new Set([key]) : new Set(),
          };
        } else if (child.type === 'RANGE') {
          const matched = allocated.filter(key => {
            const c = courseMap[key];
            if (!c || c.subject !== child.subject) return false;
            const num = parseInt(c.number, 10);
            if (isNaN(num)) return false;
            if (num < child.idRangeStart || num > child.idRangeEnd) return false;
            const isExc = (child.exceptions ?? []).some(
              ex => courseKey(ex.subject, ex.classId) === key
            );
            return !isExc;
          });
          const childSat = matched.length > 0;
          return {
            type: 'RANGE',
            sat: childSat,
            matched: matched.map(key => `${courseMap[key].subject} ${courseMap[key].number}`),
            subject: child.subject,
            start: child.idRangeStart,
            end: child.idRangeEnd,
            label: `Any ${child.subject} ${child.idRangeStart}–${child.idRangeEnd}`,
            allocatedCourses: childSat ? new Set(matched) : new Set(),
          };
        } else {
          return {
            type: child.type,
            sat: false,
            label: 'Unsupported',
            allocatedCourses: new Set(),
          };
        }
      });

      const allocatedCourses = new Set(allocated);
      return {
        type: 'XOM',
        sat,
        satSh,
        reqSh: node.numCreditsMin,
        children,
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
        const failedChildren = (node.courses ?? []).map(child => {
          const base = checkReq(child, placedSet, courseMap);
          return {
            ...base,
            sat: false,
            allocatedCourses: new Set(),
          };
        });
        return {
          type: 'AND',
          sat: false,
          satCount,
          total: children.length,
          children: failedChildren,
          label: `All of (${(node.courses ?? []).map(c => c.label).join(', ')})`,
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
 */
export function calculateGeneralElectives(placedSet, allocatedSet, courseMap) {
  const unallocated = [];
  let totalSH = 0;

  for (const key of placedSet) {
    if (!allocatedSet.has(key)) {
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
    generalElectivesSH: totalSH,
  };
}

/**
 * Allocate all sections + calculate general electives.
 * Returns sections array with general electives appended at end.
 */
export function allocateMajorWithElectives(major, placedSet, courseMap) {
  const globalUsed = new Set();
  // Filter out "Required General Electives" placeholder - we generate our own
  const sectionsToAllocate = mergeDuplicateSections(
    (major.requirementSections ?? []).filter(
      section => section.title !== 'Required General Electives'
    )
  );
  const sections = allocateSections(sectionsToAllocate, placedSet, globalUsed, courseMap);
  const generalElectives = calculateGeneralElectives(placedSet, globalUsed, courseMap);
  return { sections, generalElectives, allocatedSet: globalUsed };
}
