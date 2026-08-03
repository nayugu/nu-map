// ═══════════════════════════════════════════════════════════════════
// CORE CONSTANTS
// Universal domain values — no React, no I/O, no institution specifics.
// Institution-specific values live in src/adapters/<institution>/.
// ═══════════════════════════════════════════════════════════════════

export const NUM_YEARS = 5;

// 25 distinct subject colours — all vibrant; no greys, mustards, or
// yellow-greens. The register is "vivid pastel" (reference: #f87171):
// saturation stays high but lightness sits around 60–75%, with a few
// slightly deeper anchors (~45–55%) so families can still spread by
// lightness. When retuning a slot, stay in the same hue family and
// adjust lightness/saturation only (subjectColor() hashes into this by
// index, so keep the length at 25 and edit slots in place to avoid
// reshuffling).
export const SUBJECT_PALETTE = [
  "#ef5e78","#ff9b59","#ffc14d","#66efc2","#58a6ff",
  "#a78bfa","#ff69b4","#3ee8dc","#ff9365","#67e8f9",
  "#34d399","#f5d040","#85c0ff","#ff8dc7","#2dd4bf",
  "#ffb27d","#c084fc","#86efac","#fb7185","#ffd47e",
  "#6bcb77","#22d3ee","#e879f9","#ff6b6b","#7b68ee",
];

// Row background tokens live in src/core/themes.js (var(--row-*)).
// TYPE_BG is kept as a mapping to those CSS-variable strings so
// SemRow / SummerRow can look up the right token by semester type.
export const TYPE_BG = {
  fall:    { bg: 'var(--row-fall-bg)', border: 'var(--row-fall-border)' },
  spring:  { bg: 'var(--row-spr-bg)',  border: 'var(--row-spr-border)'  },
  summer:  { bg: 'var(--row-sum-bg)',  border: 'var(--row-sum-border)'  },
  special: { bg: 'var(--row-spc-bg)',  border: 'var(--row-spc-border)'  },
};

// Prereq connection colour is poppy mint-green (#3dd8a0) — visually distinct
// from the NOW indicator blue (#58a6ff) used everywhere else.
export const REL_STYLE = {
  prerequisite:            { color: "#3dd8a0", dash: "",      label: "Prereq",               arrow: true  },
  "prerequisite-order":    { color: "#f85149", dash: "",      label: "Prereq (wrong order)",  arrow: true  },
  // Same red as wrong-order, dotted: the prereq is placed EARLY ENOUGH but
  // its entered grade fails the gate — resolved by clearing the grade or
  // placing a retake. Legend shows it only once a grade has been entered.
  "prerequisite-grade":    { color: "#f85149", dash: "2 3",   label: "Prereq (grade)",        arrow: true  },
  corequisite:             { color: "#58a6ff", dash: "5 4",   label: "Coreq",                arrow: false },
  "corequisite-viol":      { color: "#ffd600", dash: "5 4",   label: "Misplaced",             arrow: false },
  "substitution-prereq":         { color: "#3dd8a0", dash: "4 3", label: "Substituted prereq",              arrow: true },
  "substitution-prereq-order":   { color: "#f85149", dash: "4 3", label: "Substituted prereq (wrong order)", arrow: true },
};


