// ═══════════════════════════════════════════════════════════════════
// MINOR LOADER  (data adapter — bridges graduatenu minor JSON files)
//
// Same architecture as majorLoader.js, pointing instead to the
// minor/minors/** tree in the graduatenu fork.
// ═══════════════════════════════════════════════════════════════════

const _moduleMap = import.meta.glob(
  '../../graduatenu/packages/api/src/minor/minors/**/parsed.initial.json',
  { eager: false }
);

// ── Helpers ─────────────────────────────────────────────────────

function fmtLabel(raw) {
  return raw
    .replace(/[-_]+/g, ' ')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(w => w.length <= 3 && w === w.toLowerCase() ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function fmtLocation(folder) {
  const m = folder.match(/\(([^)]+)\)/);
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : '';
}

// ── Public API ───────────────────────────────────────────────────

let _cachedOptions = null;

export function getMinorOptions() {
  if (_cachedOptions) return _cachedOptions;

  _cachedOptions = Object.keys(_moduleMap)
    .map(path => {
      const parts = path.split('/');
      let yearIdx = -1;
      for (let i = 0; i < parts.length; i++) {
        if (/^\d{4}$/.test(parts[i])) { yearIdx = i; break; }
      }
      if (yearIdx < 0) return null;

      const year         = parseInt(parts[yearIdx], 10);
      const college      = parts[yearIdx + 1] ?? '';
      const folder       = parts[yearIdx + 2] ?? '';
      const label        = fmtLabel(folder);
      const location     = fmtLocation(folder);
      const collegeLabel = fmtLabel(college);

      return { path, year, college, collegeLabel, folder, label, location };
    })
    .filter(Boolean)
    .sort((a, b) =>
      b.year - a.year ||
      a.college.localeCompare(b.college) ||
      a.label.localeCompare(b.label)
    );

  return _cachedOptions;
}

export function getMinorOptionGroups() {
  const map = new Map();
  for (const opt of getMinorOptions()) {
    const key = `${opt.year} — ${opt.collegeLabel}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(opt);
  }
  return map;
}

export async function loadMinor(path) {
  const fn = _moduleMap[path];
  if (!fn) throw new Error(`Minor not found in registry: ${path}`);
  const mod = await fn();
  return mod.default ?? mod;
}
