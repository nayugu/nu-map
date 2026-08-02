// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/attributeSystem  (implements IAttributeSystem)
//
// Covers NUPath — Northeastern University's general education framework.
//
// 11 competencies, 13 codes: competency 9 ("Writing Across Audiences and
// Genres") is awarded as three separate codes — WF, WD and WI. Order below
// follows the Registrar's nomenclature key.
// ═══════════════════════════════════════════════════════════════════

/** @type {import('../../ports/IAttributeSystem.js').Attribute[]} */
const _attributes = [
  { code: "ND", label: "Natural/Designed World"   },
  { code: "EI", label: "Creative Express/Innov"   },
  { code: "IC", label: "Interpreting Culture"      },
  { code: "FQ", label: "Formal/Quant Reasoning"   },
  { code: "SI", label: "Societies/Institutions"   },
  { code: "AD", label: "Analyzing/Using Data"     },
  { code: "DD", label: "Difference/Diversity"     },
  { code: "ER", label: "Ethical Reasoning"        },
  { code: "WF", label: "1st Yr Writing"           },
  { code: "WD", label: "Adv Writing Disc"         },
  { code: "WI", label: "Writing Intensive"        },
  { code: "EX", label: "Integration Experience"   },
  { code: "CE", label: "Capstone Experience"      },
];

/**
 * Grid layout used by GradPanel. Rows group the codes by competency: the eight
 * subject competencies, then the three writing codes with the experiential
 * pair. Consumers render from getGridCodes() (the flattened order) and reflow
 * to their own column count, so the ragged last row is grouping, not geometry.
 */
const _gridLayout = [
  ["ND", "EI", "IC", "FQ"],
  ["SI", "AD", "DD", "ER"],
  ["WF", "WD", "WI"],
  ["EX", "CE"],
];

const _gridCodes = _gridLayout.flat();
const _labels    = Object.fromEntries(_attributes.map(a => [a.code, a.label]));

/** @type {import('../../ports/IAttributeSystem.js').IAttributeSystem} */
export default {
  getSystemName()         { return "NUPath"; },
  getAttributes()         { return _attributes; },
  getGridLayout()         { return _gridLayout; },
  getGridCodes()          { return _gridCodes; },
  getLabel(code)          { return _labels[code] ?? code; },
  canDoubleDip()          { return true; },
  getMaxPerAttribute()    { return null; },

  /**
   * Returns the Set of attribute codes covered by the current plan.
   *
   * @param {Object}      placements             - { [courseId]: semId }
   * @param {Object}      courseMap              - { [courseId]: Course }
   * @param {Set<string>} [grantedAttrs=new Set] - Attribute codes granted by placed special terms
   * @returns {Set<string>}
   */
  getCoverage(placements, courseMap, grantedAttrs = new Set()) {
    const covered = new Set();
    for (const id of Object.keys(placements)) {
      const c = courseMap[id];
      if (c?.attributes) c.attributes.forEach(np => covered.add(np));
    }
    for (const attr of grantedAttrs) covered.add(attr);
    return covered;
  },

  getSources() { return []; },
};
