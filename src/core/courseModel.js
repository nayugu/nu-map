// ═══════════════════════════════════════════════════════════════════
// COURSE MODEL  (pure domain logic — no React, no I/O)
// ═══════════════════════════════════════════════════════════════════
import { SUBJECT_PALETTE } from "./constants.js";

// ── Subject colour ───────────────────────────────────────────────

/** Deterministic colour for a course subject string. */
export function subjectColor(subject) {
  let h = 0;
  for (let i = 0; i < subject.length; i++)
    h = (h * 31 + subject.charCodeAt(i)) & 0x7fffffff;
  return SUBJECT_PALETTE[h % SUBJECT_PALETTE.length];
}

// ── Edge extraction ──────────────────────────────────────────────

/**
 * Extract prerequisite and corequisite edges from a course's
 * prereqs/coreqs data. Handles ninest's flat token array format
 * as well as nested sub-arrays.
 */
export function extractEdges(courseId, prereqs, coreqs) {
  const edges = [];

  function walk(node) {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === "string") return; // "Or", "And", "(", ")"
    if (typeof node === "object" && node.subject && node.number)
      edges.push({
        from: `${node.subject.toUpperCase()}${node.number}`,
        to:   courseId,
        type: "prerequisite",
      });
  }

  walk(prereqs);

  (Array.isArray(coreqs) ? coreqs : []).forEach(r => {
    if (r && typeof r === "object" && r.subject && r.number)
      edges.push({
        from: `${r.subject.toUpperCase()}${r.number}`,
        to:   courseId,
        type: "corequisite",
      });
  });

  return edges;
}

// ── Offering helpers ─────────────────────────────────────────────

/**
 * Map raw catalog term codes to the set of offered semester type IDs.
 *
 * @param {Array}    terms            - Raw term entries from course data (strings or objects with .code)
 * @param {Function} [decodeTermCode] - Institution-specific decoder: term code → semester type ID string.
 *                                     From ICalendar.decodeTermCode.  When omitted, falls back to the
 *                                     NU Banner convention (YYYY10=fall, YYYY30=spring, etc.) so
 *                                     existing call sites that don't pass the parameter continue to work.
 * @returns {string[]|null} Array of semester type IDs, or null when no recognisable codes are found.
 */
export function getOfferedFromTerms(terms, decodeTermCode = null) {
  const set = new Set();
  (terms || []).forEach(t => {
    const code = typeof t === "string" ? t : (t?.code ?? "");
    let type;
    if (decodeTermCode) {
      type = decodeTermCode(code);
    } else {
      // Backward-compat fallback: NU Banner convention
      const ss = code.slice(-2);
      if      (ss === "10") type = "fall";
      else if (ss === "30") type = "spring";
      else if (ss === "40") type = "sumA";
      else if (ss === "60") type = "sumB";
    }
    if (type) set.add(type);
  });
  return set.size > 0 ? [...set] : null;
}
