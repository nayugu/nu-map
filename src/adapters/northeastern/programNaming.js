// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/programNaming  (pure helpers, no I/O)
//
// Folder-slug → display-label formatting shared by the browser adapter
// (majorRequirements.js) and the Node program registry
// (programRegistry.node.js), so program labels match everywhere.
//
// The folder slug is a lossy flattening of the catalog's program name:
// "Computer Science, MSCS—Align (Arlington)" becomes
// "computer_science_mscsalign_(arlington)". parseProgram() undoes as much of
// that as can be done without loading the program JSON — which the picker
// deliberately avoids, since its options come from the Vite module registry
// alone. What it recovers (name / degree / campus, separately) is both what
// renders as a label and what the search ranker scores against.
// ═══════════════════════════════════════════════════════════════════

// ── Degree codes ─────────────────────────────────────────────────
//
// Whitelisted rather than pattern-matched: a "trailing token that looks like a
// degree" also matches real name words — "design" (d…), "media" (med…),
// "management" and "mathematics" (ma…) all end program slugs. A stray match
// there would eat a word out of the program's name. Unknown trailing tokens
// are simply left in the name, which is what the label used to show anyway.

/**
 * Slug token → how the catalog itself prints that degree. Uppercasing the slug
 * is not enough: NU writes BSChE, BSCmpE, MSCivE, MSEneS, PharmD, EdD, PhD.
 * Every value here was read back out of the scraped `name` fields, so this is
 * the catalog's own casing rather than a guess.
 */
const DEGREES = {
  // Undergraduate
  bs: 'BS', ba: 'BA', bfa: 'BFA', bmus: 'BMus', bsn: 'BSN', bla: 'BLA',
  bacs: 'BACS', bscs: 'BSCS', bsba: 'BSBA', bsib: 'BSIB', bsce: 'BSCE',
  bsche: 'BSChE', bscmpe: 'BSCmpE', bsee: 'BSEE', bsie: 'BSIE', bsme: 'BSME',
  bsbioe: 'BSBioE', bsenve: 'BSEnvE',
  // Graduate
  ms: 'MS', ma: 'MA', mat: 'MAT', mba: 'MBA', med: 'MEd', mfa: 'MFA',
  mls: 'MLS', mpa: 'MPA', mph: 'MPH', mpp: 'MPP', mps: 'MPS', msa: 'MSA',
  msamba: 'MSAMBA', msbioe: 'MSBioE', msche: 'MSChE', mscive: 'MSCivE',
  mscp: 'MSCP', mscs: 'MSCS', msece: 'MSECE', msecel: 'MSECEL', msem: 'MSEM',
  msenes: 'MSEneS', msenve: 'MSEnvE', msf: 'MSF', msie: 'MSIE', msis: 'MSIS',
  msld: 'MSLD', msme: 'MSME', msor: 'MSOR', mssbs: 'MSSBS',
  // Doctoral / professional
  cags: 'CAGS', dlp: 'DLP', dmsc: 'DMSc', dnp: 'DNP', dps: 'DPS', edd: 'EdD',
  jd: 'JD', llm: 'LLM', pharmd: 'PharmD', phd: 'PhD',
  // Non-degree credentials
  graduate_certificate: 'Graduate Certificate', certificate: 'Certificate',
  minor: 'Minor',
};

/** Delivery variants the catalog appends with an em dash ("MSCS—Align"). */
const MODALITIES = {
  align:          'Align',
  online:         'Online',
  connect:        'Connect',
  bridge:         'Bridge',
  bridgeonline:   'Bridge—Online',
  accelerated:    'Accelerated',
  'full-time':    'Full-Time',
  'part-time':    'Part-Time',
  'post-masters': "Post-Master's",
};

// The `(modality)?$` anchor makes the alternation backtrack into longer stems,
// so "mscsalign" resolves to mscs+align rather than failing on ms+"csalign".
const DEGREE_RE = new RegExp(
  `^(${Object.keys(DEGREES).join('|')})(${Object.keys(MODALITIES).join('|')})?$`
);

// ── Name casing ──────────────────────────────────────────────────

/** Lowercase inside a title — "Computer Science and Biology", not "AND". */
const CONNECTORS = new Set(['and', 'of', 'in', 'with', 'for', 'the', 'to', 'a', 'an', 'on', 'at']);

/** Short words that really are acronyms, so title-casing must not touch them. */
const ALWAYS_UPPER = new Set(['ai', 'asl', 'ip', 'us', 'it', 'mba', 'phd', 'stem']);

function titleCaseWord(w, first) {
  if (ALWAYS_UPPER.has(w))         return w.toUpperCase();
  if (!first && CONNECTORS.has(w)) return w;
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** Title-case a slug token, casing each side of a hyphen ("Speech-Language"). */
function titleCaseToken(tok, first) {
  return tok.split('-').map((seg, i) => titleCaseWord(seg, first && i === 0)).join('-');
}

// ── Acronyms ─────────────────────────────────────────────────────
//
// There is no authoritative acronym list. Two partial sources are combined by
// parseProgram, and neither is treated as an identity — searchRank puts every
// acronym match in one tier and lets the degree code break the tie, because
// derived initials collide heavily in this catalog ("cs" is equally Cinema
// Studies, Communication Studies and Computer Science; "ee" is Electrical,
// Entrepreneurial and Environmental Engineering).
//
//   1. The degree code's field suffix — BSCS → cs, BSCHE → che, MSECE → ece.
//      Authoritative (NU publishes these) but only ~16 programs carry one.
//   2. Initials of the name words. Universal, ambiguous.
//
// ALIASES covers what students actually type where neither source resolves it
// — chiefly minors, which have no degree code at all. Hand-maintained; drop an
// entry and that query falls back to derived initials.

/** query → the program name it should be treated as an acronym for. */
const ALIASES = {
  cs:      'computer science',
  ds:      'data science',
  ee:      'electrical engineering',
  me:      'mechanical engineering',
  che:     'chemical engineering',
  ece:     'electrical and computer engineering',
  econ:    'economics',
  psych:   'psychology',
  bio:     'biology',
  polisci: 'political science',
};

/** The degree-code prefixes that sit in front of a field suffix (BS-CS, MS-ECE). */
const DEGREE_FIELD_RE = /^(?:bs|ba|ms|ma)([a-z]{2,})$/;

/**
 * Split a program folder slug into its parts.
 *
 * @param {string} raw - e.g. "computer_science_mscsalign_(arlington)"
 * @returns {{name: string, degree: string, location: string,
 *            acronym: string, acronyms: string[]}}
 *          e.g. { name: "Computer Science", degree: "MSCS—Align",
 *                 location: "Arlington", acronym: "cs", acronyms: ["cs"] }
 *          `acronym` is the trustworthy one (degree code, else alias) and
 *          `acronyms` is everything that should match, initials included.
 */
export function parseProgram(raw) {
  const location = fmtLocation(raw);
  // The closing paren is optional: at least one scraped folder is truncated
  // ("…_ba_(boston"), and without this the campus tag lands in the name.
  const slug  = String(raw).replace(/\s*\([^)]*\)?\s*$/, '').replace(/[_\s]+$/, '');
  const parts = slug.split(/[_\s]+/).filter(Boolean);

  // "graduate_certificate" is the only two-token code, so try a two-token
  // tail first; anything else would strip a name word.
  let cut = parts.length, stem = '', modality = '', tail = [];
  for (const n of [2, 1]) {
    if (parts.length <= n) continue;
    const m = parts.slice(-n).join('_').match(DEGREE_RE);
    if (m) { cut = parts.length - n; stem = m[1]; modality = m[2] ?? ''; break; }
  }

  // Some programs qualify the degree instead of ending on it — "Marine
  // Biology, BS with Three Seas". Take the first whole token that is a degree
  // code, keeping the rest as a trailing phrase. The phrase must open with a
  // connector, which is what makes this safe: without that guard,
  // "additional_requirements_for_ba_students" reads "ba" as a degree.
  if (!stem) {
    for (let i = 1; i < parts.length - 1; i++) {
      const m = parts[i].match(DEGREE_RE);
      if (!m || !CONNECTORS.has(parts[i + 1])) continue;
      cut = i; stem = m[1]; modality = m[2] ?? ''; tail = parts.slice(i + 1);
      break;
    }
  }

  const nameParts = parts.slice(0, cut);
  const name   = nameParts.map((w, i) => titleCaseToken(w, i === 0)).join(' ');
  const degree = stem
    ? DEGREES[stem]
      + (modality ? `—${MODALITIES[modality]}` : '')
      + (tail.length ? ` ${tail.map(w => titleCaseToken(w, false)).join(' ')}` : '')
    : '';

  const lowerName = nameParts.join(' ');
  const code  = stem.match(DEGREE_FIELD_RE)?.[1] ?? '';
  const alias = Object.keys(ALIASES).find(a => ALIASES[a] === lowerName) ?? '';

  const acronyms = new Set();
  const words = nameParts.filter(w => !CONNECTORS.has(w));
  if (words.length > 1) acronyms.add(words.map(w => w[0]).join(''));
  if (code)  acronyms.add(code);
  if (alias) acronyms.add(alias);

  return { name, degree, location, acronym: code || alias, acronyms: [...acronyms] };
}

/**
 * The full display label for a program, matching the catalog's own rendering:
 * "Computer Science, BSCS". The campus stays separate — the picker appends it
 * as "(Boston)" and the ranker scores it as its own field.
 *
 * @param {string} folder - e.g. "computer_science_bscs_(boston)"
 * @returns {string}        e.g. "Computer Science, BSCS"
 */
export function fmtProgramLabel(folder) {
  const { name, degree } = parseProgram(folder);
  return degree ? `${name}, ${degree}` : name;
}

/**
 * Parse a snake_case / hyphenated folder name into a readable label.
 * Strips location tags like "(boston)" or "(oakland)".
 *
 * Still used for college names and anywhere a slug is not a program; program
 * labels go through fmtProgramLabel, which also handles the degree code.
 *
 * @param {string} raw  - folder name, e.g. "computer_science_(boston)"
 * @returns {string}     e.g. "Computer Science"
 */
export function fmtLabel(raw) {
  return raw
    .replace(/[-_]+/g, ' ')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(w => w.length <= 3 && w === w.toLowerCase()
      ? w.toUpperCase()
      : w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Extract a location tag from a folder name.
 *
 * @param {string} folder  - e.g. "computer_science_(silicon_valley)"
 * @returns {string}        e.g. "Silicon Valley" (empty string if no tag)
 */
export function fmtLocation(folder) {
  const m = String(folder).match(/\(([^)]+)\)/) ?? String(folder).match(/\(([^)]+)$/);
  if (!m) return '';
  return m[1]
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
