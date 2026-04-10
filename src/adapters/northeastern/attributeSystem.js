// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/attributeSystem  (implements IAttributeSystem)
//
// Covers NUPath — Northeastern University's general education framework.
//
// WF ("1st Yr Writing") is included in `_attributes` and getLabel() for
// historical/PDF-export compat (planModel.js uses getLabel("WF")),
// but is excluded from getGridLayout() / getGridCodes() because GradPanel
// no longer displays it as an active requirement.
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
  // WF: legacy code, no longer awarded as an active requirement.
  // Kept here so getLabel("WF") resolves correctly in PDF export.
  { code: "WF", label: "1st Yr Writing"           },
  { code: "WD", label: "Adv Writing Disc"         },
  { code: "WI", label: "Writing Intensive"        },
  { code: "EX", label: "Integration Experience"   },
  { code: "CE", label: "Capstone Experience"      },
];

/** 3×4 grid layout used by GradPanel — excludes legacy WF. */
const _gridLayout = [
  ["ND", "EI", "IC", "FQ"],
  ["SI", "AD", "DD", "ER"],
  ["WD", "WI", "EX", "CE"],
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
};
