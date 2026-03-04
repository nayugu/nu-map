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
 * Build a Set of canonical course keys for every placed course.
 * Only courses that exist in courseMap are included.
 */
export function buildPlacedKeySet(placements, courseMap) {
  const keys = new Set();
  for (const id of Object.keys(placements)) {
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
