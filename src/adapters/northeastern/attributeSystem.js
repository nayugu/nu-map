// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/attributeSystem  (implements IAttributeSystem)
//
// Covers NUPath — Northeastern University's general education framework.
//
// WF ("1st Yr Writing") is included in `attributes` and `labels` for
// historical/PDF-export compat (planModel.js uses NP_LABELS["WF"]),
// but is excluded from `gridLayout` / `gridCodes` because GradPanel
// no longer displays it as an active requirement.
// ═══════════════════════════════════════════════════════════════════

/** @type {import('../../ports/IAttributeSystem.js').Attribute[]} */
export const attributes = [
  { code: "ND", label: "Natural/Designed World"   },
  { code: "EI", label: "Creative Express/Innov"   },
  { code: "IC", label: "Interpreting Culture"      },
  { code: "FQ", label: "Formal/Quant Reasoning"   },
  { code: "SI", label: "Societies/Institutions"   },
  { code: "AD", label: "Analyzing/Using Data"     },
  { code: "DD", label: "Difference/Diversity"     },
  { code: "ER", label: "Ethical Reasoning"        },
  // WF: legacy code, no longer awarded as an active requirement.
  // Kept here so labels["WF"] resolves correctly in PDF export.
  { code: "WF", label: "1st Yr Writing"           },
  { code: "WD", label: "Adv Writing Disc"         },
  { code: "WI", label: "Writing Intensive"        },
  { code: "EX", label: "Integration Experience"   },
  { code: "CE", label: "Capstone Experience"      },
];

/** 3×4 grid layout used by GradPanel — excludes legacy WF. */
export const gridLayout = [
  ["ND", "EI", "IC", "FQ"],
  ["SI", "AD", "DD", "ER"],
  ["WD", "WI", "EX", "CE"],
];

/** Flat ordered list for iteration — 12 codes, no WF. */
export const gridCodes = gridLayout.flat();

/** Display name for this attribute system, shown as the grad panel section title. */
export const systemName = "NUPath";

/** Full label map including legacy WF (used by planModel PDF export). */
export const labels = Object.fromEntries(attributes.map(a => [a.code, a.label]));

/**
 * Returns the Set of attribute codes covered by the current plan.
 *
 * @param {Object}      placements             - { [courseId]: semId }
 * @param {Object}      courseMap              - { [courseId]: Course }
 * @param {Set<string>} [grantedAttrs=new Set] - Attribute codes granted by placed special terms
 *                                               (computed via computeGrantedAttrs in specialTermUtils)
 * @returns {Set<string>}
 */
export function getCoverage(placements, courseMap, grantedAttrs = new Set()) {
  const covered = new Set();
  for (const id of Object.keys(placements)) {
    const c = courseMap[id];
    if (c?.attributes) c.attributes.forEach(np => covered.add(np));
  }
  for (const attr of grantedAttrs) covered.add(attr);
  return covered;
}

/** @type {import('../../ports/IAttributeSystem.js').IAttributeSystem} */
export default { systemName, attributes, gridLayout, gridCodes, labels, getCoverage };
