// ═══════════════════════════════════════════════════════════════════
// SEARCH RANK  (pure — order program search results by closeness)
//
// A plain substring filter returns matches in catalog order, so searching
// "computer science" buries "Computer Science, BSCS" under every combined
// "Computer Science AND …" program. This scores each option so the closest
// name surfaces first: exact > whole-string prefix > word-start > substring >
// folder/group. Shorter labels win ties (a tighter match), and location
// breaks remaining ties deterministically (Boston before Oakland).
//
// Light typo tolerance: when strict matching is sparse, in-order subsequence
// matches ("compter science" → "computer science") are added, ranked below
// every strict match. Cheap — a few string ops over ~1.5k short labels.
// ═══════════════════════════════════════════════════════════════════

// Are all chars of q present in s in order (allows dropped/extra letters)?
function isSubsequence(q, s) {
  let i = 0;
  for (let j = 0; j < s.length && i < q.length; j++) if (s[j] === q[i]) i++;
  return i === q.length;
}

// Among otherwise-equal matches, prefer BS (Bachelor of Science) over BA
// (Bachelor of Arts); neutral for every other degree type. Matches a "bs"/"ba"
// degree token at a word/underscore boundary in the label or folder slug.
function degreePref(o) {
  const s = `${o.label ?? ""} ${o.folder ?? ""}`.toLowerCase();
  if (/(^|[\s_])bs/.test(s)) return 1;
  if (/(^|[\s_])ba/.test(s)) return -1;
  return 0;
}

function scoreOption(o, q) {
  const label = (o.label ?? "").toLowerCase();
  if (!label) return -Infinity;
  const loc = (o.location ?? "").toLowerCase();
  const hay = loc ? `${label} ${loc}` : label;
  if (label === q)                                                return 1000 - label.length;
  if (hay.startsWith(q))                                          return 800  - label.length;
  if (label.split(/[^a-z0-9]+/).some(w => w && w.startsWith(q)))  return 650  - label.length;
  if (hay.includes(q))                                            return 500  - label.length;
  const folder = (o.folder ?? "").toLowerCase();
  if (folder && (folder.includes(q) || folder.includes(q.replace(/\s+/g, "_")))) return 350 - label.length;
  if ((o.grp ?? "").toLowerCase().includes(q))                    return 150  - label.length;
  return -Infinity;
}

/**
 * Rank search options against a query, best first.
 * @param {Array<{path,label,location?,folder?,grp?}>} options
 * @param {string} query
 * @param {number} [limit=60]
 * @returns {Array} the matching options, ordered by closeness (capped at limit)
 */
export function rankOptions(options, query, limit = 60) {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return [];

  const scored = [];
  for (const o of options) {
    const s = scoreOption(o, q);
    if (s > -Infinity) scored.push({ o, s });
  }

  // Typo fallback only when strict matches are sparse, so normal searches stay clean.
  if (scored.length < 5 && q.length >= 3) {
    const seen = new Set(scored.map(x => x.o.path));
    for (const o of options) {
      if (seen.has(o.path)) continue;
      if (isSubsequence(q, (o.label ?? "").toLowerCase())) scored.push({ o, s: -1000 - (o.label ?? "").length });
    }
  }

  scored.sort((a, b) =>
    b.s - a.s
    || (a.o.location || "").localeCompare(b.o.location || "")  // keep a campus together
    || degreePref(b.o) - degreePref(a.o)                       // then BS before BA
    || (a.o.label || "").localeCompare(b.o.label || ""));
  return scored.slice(0, limit).map(x => x.o);
}
