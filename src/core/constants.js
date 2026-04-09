// ═══════════════════════════════════════════════════════════════════
// CORE CONSTANTS
// Universal domain values — no React, no I/O, no institution specifics.
// Institution-specific values live in src/adapters/<institution>/.
// ═══════════════════════════════════════════════════════════════════

export const NUM_YEARS = 5;

// 25 distinct dark-theme subject colours
export const SUBJECT_PALETTE = [
  "#e94560","#ff8c42","#e8a500","#4ecca3","#58a6ff",
  "#a78bfa","#ff69b4","#43aa8b","#ff9365","#67e8f9",
  "#34d399","#c48b00","#60a5fa","#f472b6","#2dd4bf",
  "#fb923c","#c084fc","#86efac","#f87171","#e8a838",
  "#6bcb77","#4cb8c4","#c77dba","#95a5a6","#7b68ee",
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
  corequisite:             { color: "#58a6ff", dash: "5 4",   label: "Coreq",                arrow: false },
  "corequisite-viol":      { color: "#ffd600", dash: "5 4",   label: "Misplaced",             arrow: false },
  "substitution-prereq":         { color: "#3dd8a0", dash: "4 3", label: "Substituted prereq",              arrow: true },
  "substitution-prereq-order":   { color: "#f85149", dash: "4 3", label: "Substituted prereq (wrong order)", arrow: true },
};


