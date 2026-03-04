// ═══════════════════════════════════════════════════════════════════
// THEMES  — CSS custom property token sets for each visual theme.
// To add a new theme: add an entry to THEMES and export it.
// All tokens are injected as CSS custom properties on <html> by
// ThemeContext so every component can reference  var(--token-name).
// ═══════════════════════════════════════════════════════════════════

const dark = {
  // ── Surfaces ─────────────────────────────────────────────────────
  '--bg-app':            '#0d1117',
  '--bg-surface':        '#161b22',
  '--bg-surface-2':      '#1a1f26',
  '--bg-bank':           '#0a0d12',

  // ── Borders ──────────────────────────────────────────────────────
  '--border-1':          '#21262d',   // dividers
  '--border-2':          '#30363d',   // controls / inputs
  '--border-card':       '#2d333b',   // card default
  '--border-slot':       '#252b34',   // empty course slot
  '--border-sub':        '#1a1f26',   // bank subject section

  // ── Text hierarchy ───────────────────────────────────────────────
  '--text-1':            '#e6edf3',   // highest contrast
  '--text-2':            '#c9d1d9',   // primary
  '--text-3':            '#8b949e',   // secondary
  '--text-4':            '#6e7681',   // muted
  '--text-5':            '#4e5662',   // very dim
  '--text-6':            '#555d66',   // separator

  // ── Status: success / done ───────────────────────────────────────
  '--success':           '#4ade80',
  '--success-bg':        '#0d2a17',
  '--success-border':    '#1a4a25',
  '--success-deep':      '#2a7a3a',

  // ── Status: active / current ─────────────────────────────────────
  '--active':            '#58a6ff',
  '--active-bg':         '#0d2a50',  '--active-now-border': '#58a6ff',  '--active-row-bg':     '#0f2035',
  '--active-hov-bg':     '#152a40',

  // ── Status: warning ──────────────────────────────────────────────
  '--warn':              '#c17f24',
  '--warn-bright':       '#e09618',
  '--warn-bg':           '#2a1e08',
  '--warn-border':       '#c17f24',

  // ── Status: error ────────────────────────────────────────────────
  '--error':             '#f85149',
  '--error-text':        '#ff6b6b',
  '--error-bg':          '#1f0d0d',
  '--error-bg-2':        '#1a0d0d',
  '--error-border-2':    '#5a1a1a',

  // ── Semester row backgrounds ──────────────────────────────────────
  '--row-fall-bg':       '#0d1a27',
  '--row-fall-border':   '#1e3a5f',
  '--row-spr-bg':        '#0d1a10',
  '--row-spr-border':    '#1a3a1a',
  '--row-sum-bg':        '#1e1508',
  '--row-sum-border':    '#3a2800',
  '--row-spc-bg':        '#110d2a',
  '--row-spc-border':    '#2a1a4a',

  // ── Cards ─────────────────────────────────────────────────────────
  '--card-bg':           '#161b22',
  '--card-bg-hov':       '#1a2535',
  '--card-bg-sel':       '#1c2d3d',
  '--card-bg-viol':      '#1f0d0d',
  '--slot-bg':           '#090d11',

  // ── Badges / chips ───────────────────────────────────────────────
  '--badge-bg':          '#0d1117',
  '--badge-border':      '#21262d',
  '--nupath-text':       '#fbbf24',
  '--nupath-bg':         '#2a200a',
  '--nupath-border':     '#5a3e0a',
  '--nupath-sat-text':   '#7eba96',
  '--nupath-sat-border': '#22c55e',

  // ── Links / modal accents ─────────────────────────────────────────
  '--link-1':            '#58a6ff',
  '--link-2':            '#a78bfa',
  '--link-bg':           '#0d1f2d',
  '--link-border':       '#1f4b6e',

  // ── Cohort picker: selected fall / spring ─────────────────────────
  '--sel-fall-bg':       '#252525',
  '--sel-fall-border':   '#555',
  '--sel-fall-text':     '#c0c0c0',
  '--sel-spr-bg':        '#252525',
  '--sel-spr-border':    '#555',
  '--sel-spr-text':      '#c0c0c0',
  '--blocked-border':    '#2a1a1a',
  '--blocked-text':      '#3d2020',

  // ── Composite shadows ─────────────────────────────────────────────
  '--shadow-modal':      '0 24px 64px rgba(0,0,0,0.65)',
  '--shadow-active-row': '0 0 12px rgba(88,166,255,0.09), inset 3px 0 0 #58a6ff',
  '--shadow-done-row':   'inset 3px 0 0 #1a5c2a',
  '--shadow-card-sel':   '0 0 0 1px #58a6ff40',
  '--shadow-card-conn':  '0 0 0 1px rgba(88,166,255,0.15)',
  '--shadow-card-hov':   '0 0 0 2px rgba(88,166,255,0.31)',

  // ── Scrollbar ─────────────────────────────────────────────────────
  '--scrollbar-track':   '#0d1117',
  '--scrollbar-thumb':   '#30363d',
  '--scrollbar-hov':     '#484f58',
};

const light = {
  // ── Surfaces — barely-warm off-white ─────────────────────────────
  '--bg-app':            '#fefefe',   // indistinguishable from white, but not pure
  '--bg-surface':        '#ffffff',
  '--bg-surface-2':      '#faf9f8',   // barely-there tint for controls/bank
  '--bg-bank':           '#faf9f8',

  // ── Borders ────────────────────────────────────────────────
  '--border-1':          '#eeeeee',   // nearly-neutral light divider
  '--border-2':          '#d9d9d9',   // standard control border
  '--border-card':       '#eeeeee',
  '--border-slot':       '#d9d9d9',
  '--border-sub':        '#f4f4f4',

  // ── Text hierarchy ────────────────────────────────────────────────
  '--text-1':            '#1a1a1a',   // near-black
  '--text-2':            '#262626',
  '--text-3':            '#595959',
  '--text-4':            '#7a7a7a',
  '--text-5':            '#a3a3a3',
  '--text-6':            '#a3a3a3',

  // ── Status: success / done ────────────────────────────────────────
  '--success':           '#16a34a',   // medium green — lighter & readable on white
  '--success-bg':        '#bbf7d0',   // bright lime tint
  '--success-border':    '#4ade80',   // vivid lime accent
  '--success-deep':      '#14532d',   // deepest for left-bar / done row

  // ── Status: active / current ──────────────────────────────────────
  '--active':            '#2563eb',   // vivid blue
  '--active-bg':         '#dbeafe',
  '--active-now-border': '#93c5fd',   // light sky blue — now-semester outline
  '--active-row-bg':     '#dbeafe',
  '--active-hov-bg':     '#bfdbfe',

  // ── Status: warning ───────────────────────────────────────────────
  '--warn':              '#9a6200',
  '--warn-bright':       '#ffd600',   // pure saturated yellow — alarming coreq border
  '--warn-bg':           '#fef3c7',
  '--warn-border':       '#e8a500',

  // ── Status: error ─────────────────────────────────────────────────
  '--error':             '#dc2626',   // vivid red
  '--error-text':        '#dc2626',
  '--error-bg':          '#fee2e2',
  '--error-bg-2':        '#fee2e2',
  '--error-border-2':    '#fca5a5',   // light red — used for "missing prereq" border

  // ── Semester row backgrounds ───────────────────────────────────────
  '--row-fall-bg':       '#fef5f5',   // barely-red — cards stand out
  '--row-fall-border':   '#e8b8b8',
  '--row-spr-bg':        '#f3faf6',   // barely-green
  '--row-spr-border':    '#aad4b8',
  '--row-sum-bg':        '#f8f8f7',   // nearly neutral 
  '--row-sum-border':    '#d9d9d9',
  '--row-spc-bg':        '#ffffff',   // white for incoming/special
  '--row-spc-border':    '#d9d9d9',

  // ── Cards ──────────────────────────────────────────────────────────
  '--card-bg':           '#ffffff',
  '--card-bg-hov':       '#dbeafe',
  '--card-bg-sel':       '#bfdbfe',
  '--card-bg-viol':      '#fee2e2',
  '--slot-bg':           '#faf9f8',

  // ── Badges / chips ────────────────────────────────────────────────
  '--badge-bg':          '#faf9f8',
  '--badge-border':      '#eeeeee',
  '--nupath-text':       '#9a6200',
  '--nupath-bg':         '#fef3c7',
  '--nupath-border':     '#e8a500',
  '--nupath-sat-text':   '#4a8f63',
  '--nupath-sat-border': '#86efac',

  // ── Links / modal accents ──────────────────────────────────────────
  '--link-1':            '#2563eb',
  '--link-2':            '#7c3aed',
  '--link-bg':           '#dbeafe',
  '--link-border':       '#7aaff8',

  // ── Cohort picker: selected fall / spring ──────────────────────────
  '--sel-fall-bg':       '#e8e8e8',
  '--sel-fall-border':   '#888',
  '--sel-fall-text':     '#333',
  '--sel-spr-bg':        '#e8e8e8',
  '--sel-spr-border':    '#888',
  '--sel-spr-text':      '#333',
  '--blocked-border':    '#fecaca',
  '--blocked-text':      '#dc2626',

  // ── Composite shadows ──────────────────────────────────────────────
  '--shadow-modal':      '0 8px 32px rgba(0,0,0,0.12)',
  '--shadow-active-row': 'inset 2px 0 0 rgba(37,99,235,0.18)',
  '--shadow-done-row':   'inset 2px 0 0 #86efac',
  '--shadow-card-sel':   '0 0 0 1px #2563eb40',
  '--shadow-card-conn':  '0 0 0 1px rgba(37,99,235,0.18)',
  '--shadow-card-hov':   '0 1px 3px rgba(0,0,0,0.10)',

  // ── Scrollbar ──────────────────────────────────────────────────────
  '--scrollbar-track':   '#faf9f8',
  '--scrollbar-thumb':   '#d9d9d9',
  '--scrollbar-hov':     '#7a7a7a',
};

/** All available themes — add entries here to extend the theme system. */
export const THEMES = { dark, light };

/** Default theme shown on first load. */
export const DEFAULT_THEME = 'light';

/** Human-readable labels for the theme picker UI. */
export const THEME_LABELS = {
  light: '☀ Light',
  dark:  '🌙 Dark',
};
