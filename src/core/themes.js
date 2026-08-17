// ═══════════════════════════════════════════════════════════════════
// THEMES  — CSS custom property token sets for each visual theme.
// To add a new theme: add an entry to THEMES and export it.
// All tokens are injected as CSS custom properties on <html> by
// ThemeContext so every component can reference  var(--token-name).
// ═══════════════════════════════════════════════════════════════════

const dark = {
    '--beta-text':           '#8ecaff',
    '--beta-bg':             '#1a263a',
  // ── Surfaces ─────────────────────────────────────────────────────
  '--bg-app':            '#0d1117',
  '--bg-surface':        '#161b22',
  '--bg-surface-2':      '#1a1f26',
  '--bg-card':           '#1e2329',   // desaturated card tint for major/minor frames (lighter than surface-2)
  '--bg-bank':           '#0a0d12',
  // The RAISED fill for a control sitting on a panel — pickers, segmented
  // halves, neutral buttons. It was referenced by five controls in the sample
  // plan panel and defined by no theme, so `var(--bg-2)` resolved to nothing
  // and every one of them rendered transparent: the source toggle's selected
  // half had no fill to be selected BY, and the panel read as six identical
  // outlines. One step above --bg-surface-2, the same relation --bg-card has.
  '--bg-2':              '#232a33',

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
  // Emerald (the palette's CET/ENVR green), not lime: #4ade80 read neon
  // against #0d1117. Hue 150 — the SAME green as --success-bar, so ticks,
  // counts and bars are one colour (at 158 the ticks read bluer than the
  // bars they sit next to).
  '--success':              '#36d385',
  '--success-bg':           '#0d2a17',
  '--success-border':       '#1a4a25',
  '--success-deep':         '#2a7a3a',
  '--success-mark':         '#36d385',   // GLYPH marks (grad-panel ticks) — always the vivid step
  '--success-bar':          '#36d385',   // progress-bar fill (hue nudged greener than the emerald text — 160°→150°)
  '--planned':              '#58a6ff',   // PLANNED-vs-done accent (BNSC blue) — text/counts
  '--planned-bar':          '#58a6ff',   // planned progress-bar fill (BNSC blue)
  '--success-bar-partial':  '#3f9e6b',   // in-progress section bar (muted green, reads under the sat bar)

  // ── Status: active / current ─────────────────────────────────────
  '--active':            '#58a6ff',
  '--active-bg':         '#0d2a50',  '--active-now-border': '#58a6ff',  '--active-row-bg':     '#0f2035',
  '--active-hov-bg':     '#152a40',

  // ── Status: warning ──────────────────────────────────────────────
  '--warn':              '#c17f24',
  '--warn-bright':       '#fbbf24',
  '--warn-bg':           '#2a1e08',
  '--warn-border':       '#c17f24',
  '--warn-badge-text':   '#fbbf24',

  // ── Status: error ────────────────────────────────────────────────
  '--error':             '#f85149',
  '--error-text':        '#ff6b6b',
  '--error-bg':          '#1f0d0d',
  '--error-bg-2':        '#1a0d0d',
  '--error-border-2':    '#5a1a1a',

  // ── Semester row backgrounds ──────────────────────────────────────
  '--row-fall-bg':       '#180e0e',   // barely-red tint
  '--row-fall-border':   '#2c1919',
  '--row-spr-bg':        '#0e1710',   // barely-green tint
  '--row-spr-border':    '#192b1e',
  '--row-sum-bg':        '#141414',   // neutral — no saturation
  '--row-sum-border':    '#242424',
  '--row-spc-bg':        '#141414',   // neutral — no saturation
  '--row-spc-border':    '#242424',

  // ── Cards ─────────────────────────────────────────────────────────
  '--card-bg':           '#161b22',
  '--card-bg-hov':       '#1a2535',
  '--card-bg-sel':       '#1c2d3d',
  '--card-bg-viol':      '#1f0d0d',
  '--slot-bg':           '#090d11',

  // ── Badges / chips ───────────────────────────────────────────────
  '--badge-bg':          '#0d1117',
  '--badge-border':      '#21262d',
  '--nupath-text':       '#36d385',
  '--nupath-bg':         '#0d1f14',
  '--nupath-border':     '#166534',
  '--nupath-sat-text':   '#7eba96',
  '--nupath-sat-border': '#10b981',

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
  '--shadow-card-hov':   '0 0 0 2px rgba(88,166,255,0.31)',

  // ── Scrollbar ─────────────────────────────────────────────────────
  '--scrollbar-track':   '#0d1117',
  '--scrollbar-thumb':   '#30363d',
  '--scrollbar-hov':     '#484f58',
};

const light = {
    '--beta-text':           '#0057b8',
    '--beta-bg':             '#e6f0ff',
  // ── Surfaces — barely-warm off-white ─────────────────────────────
  '--bg-app':            '#fefefe',   // indistinguishable from white, but not pure
  '--bg-surface':        '#ffffff',
  '--bg-surface-2':      '#faf9f8',   // barely-there tint for controls/bank
  '--bg-card':           '#ffffff',   // reserved (cards now use outline border)
  '--bg-bank':           '#faf9f8',
  // See the dark set for why this exists. White on the #faf9f8 panel is the
  // light-mode direction of "raised": a control reads as sitting ON the panel
  // rather than being drawn on it.
  '--bg-2':              '#ffffff',

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
  // Same green FAMILY and HUE (150) as dark and as --success-bar, stepped
  // darker for white: the vivid step scores 1.9:1 on white — unreadable.
  // 3.8:1 here, better than the #16a34a it replaces. The vivid step still
  // shows on BAR FILLS (--success-bar).
  '--success':              '#05964e',
  '--success-bg':           '#bbf7d0',   // bright lime tint
  '--success-border':       '#4ade80',   // vivid lime accent
  '--success-deep':         '#14532d',   // deepest for left-bar / done row
  // Bar fills: saturation PINNED, lightness raised (the design language's
  // lighten rule) — candy-bright tints of the status hues, green nudged
  // 160°→150° so the bar doesn't read blue-ish.
  // Marks are graphical, not text: the tick keeps the VIVID step in light
  // mode too (its grey rim carries the shape, and the row's text/count
  // states the same thing), while --success stays readable for text.
  '--success-mark':         '#36d385',
  '--success-bar':          '#71e0a8',   // green tint, full chroma
  '--planned':              '#1f74d6',   // PLANNED accent — BNSC-blue hue (212°), AA on white
  '--planned-bar':          '#85bcff',   // BNSC-blue tint, full chroma
  '--success-bar-partial':  '#98e1bd',   // in-progress section bar (lighter green tint, reads under the sat bar)

  // ── Status: active / current ──────────────────────────────────────
  '--active':            '#2563eb',   // vivid blue
  '--active-bg':         '#dbeafe',
  '--active-now-border': '#93c5fd',   // light sky blue — now-semester outline
  '--active-row-bg':     '#dbeafe',
  '--active-hov-bg':     '#bfdbfe',

  // ── Status: warning ───────────────────────────────────────────────
  '--warn':              '#9a6200',
  '--warn-bright':       '#ffd600',   // pure saturated yellow — alarming coreq/offered border
  '--warn-bg':           '#fef3c7',
  '--warn-border':       '#e8a500',
  '--warn-badge-text':   '#e8a500',

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
  // Same hue, stepped darker still — this is 9px badge text on a pale
  // green fill, so it needs full AA (~4.9:1 on --nupath-bg).
  '--nupath-text':       '#047f45',
  '--nupath-bg':         '#f0fdf4',
  '--nupath-border':     '#86efac',
  '--nupath-sat-text':   '#4a8f63',
  '--nupath-sat-border': '#10b981',

  // ── Links / modal accents ──────────────────────────────────────────
  // Links/modals are NOT planning — planning has its own --planned token.
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
