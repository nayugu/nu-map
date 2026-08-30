// ═══════════════════════════════════════════════════════════════════
// Description corequisite parser — "Requires concurrent registration in …".
//
// Some courses state a corequisite ONLY in the description, and the
// registrar's own `Corequisite(s):` line is absent or partial. Verified
// against the live catalog page (2026-08-30), PHYS 1151/1152/1153:
//
//   PHYS 1151  Corequisite(s): PHYS 1153            ← the labelled field
//   PHYS 1152  (no Corequisite(s) line at all)
//              "…Requires concurrent registration in PHYS 1151 and PHYS 1153."
//   PHYS 1153  (no Corequisite(s) line at all)
//              "…Requires concurrent registration in PHYS 1151 and PHYS 1152."
//
// So the scrape was faithful and the catalog is the one that is uneven: the
// lecture names the seminar, nobody names the lab, and the sentence names
// them all. The planner therefore linked 1151–1153 and left 1152 loose,
// which is what a student sees as "the coreqs aren't working" — the lab is
// the one part of the triple you cannot afford to forget to register for.
//
// Four triples in the corpus have this shape, all PHYS: 1151/1152/1153,
// 1155/1156/1157, 1171/1172/1173, 1175/1176/1177.
//
// ── The bar this reader has to clear ────────────────────────────────
//
// A corequisite is a HARD, symmetric, same-term constraint: it drags cards
// between terms, it can refuse a plan, and `coreqPartnersOf` walks the whole
// connected component, so one wrong edge welds two groups together. That is
// the expensive direction, so the sentence is read only when it is a pure
// conjunction of course codes and NOTHING else:
//
//   • Measured over the 7,966-course catalog, exactly 9 descriptions contain
//     "concurrent registration". 8 are the shape above. The 9th is BIOC 4900,
//     "Requires concurrent registration in BIOC 4991, BIOC 4994, BIOL 4991,
//     CHEM 4991, or other 4-SH research course approved by the Biochemistry
//     Director" — a CHOICE, and `coreqs` is a flat all-of list with nowhere to
//     put an "or". Refused, and the refusal is the point: read as a
//     conjunction it would demand four research courses in one term.
//   • "Accompanies PHYS 1151" (152 courses) is NOT read. It reads like a
//     coreq and mostly is not one: 141 of the 152 already carry a real link,
//     and of the other 11, the 4 PHYS labs are fixed by the sentence above
//     while BIOL 1112/1114/2302, ENVR 1201 and CHEM 5622 state
//     "BIOL 1111 (may be taken concurrently)" as a PREREQUISITE — the weaker,
//     correct relation, which the app already models and which permits the
//     lab in a LATER term. Promoting those to corequisites would forbid a
//     legal plan. ARMY 2212 and EXSC 4501 state nothing anywhere.
//
// Like descriptionPrereq.js beside it, this lives in src/ and is shared by
// scripts/scrape-catalog.js (the canonical path, writes `coreqs` at scrape
// time) and courseNorm.js (derives the same refs from already-shipped data,
// so the fix reaches students before the next monthly scrape).
//
// Unlike the prereq reader, this is ADDITIVE rather than a fallback: PHYS
// 1157 has a labelled `Corequisite(s): PHYS 1155` AND a sentence naming
// 1155 and 1156, and the union is what the registrar states. This mirrors
// the NUPath rule in scripts/lib/nupath.js — a non-authoritative source may
// add, never remove.
// ═══════════════════════════════════════════════════════════════════

/** The one sentence shape this reads, anchored at a sentence start. */
const CONCURRENT =
  /(?:^|\.\s+)(requires?\s+concurrent\s+registration\s+in\s+[^.]*)\./i;

/** The lead-in, stripped before the operand list is read. */
const LEAD = /^requires?\s+concurrent\s+registration\s+in\s+/i;

/** One operand, and the WHOLE of it — a bare course code, nothing else. */
const CODE_ONLY = /^([A-Z]{2,6})\s+(\d{4}[A-Z]?)$/;

/**
 * Corequisite refs stated in a course description.
 *
 * Returns `[{subject, number}]` — the same shape the labelled
 * `Corequisite(s):` line produces — or `[]` when the description states
 * nothing this reader will vouch for. Refusal is silent and total: a
 * sentence that does not parse cleanly contributes NOTHING rather than the
 * codes it happened to contain, because a partial read of a conjunction is
 * indistinguishable from a complete one downstream.
 *
 * @param {string} description  the course's cb_desc text
 * @param {string} [selfId]     the course's own id, dropped if it names itself
 * @returns {Array<{subject: string, number: string}>}
 */
export function parseDescriptionCoreqs(description, selfId = "") {
  const text = String(description || "");
  if (!text) return [];

  const m = CONCURRENT.exec(text);
  if (!m) return [];

  const body = m[1].replace(LEAD, "").trim();
  if (!body) return [];

  // An "or" anywhere in the list makes it a choice, which this shape cannot
  // express — BIOC 4900. Refuse the whole sentence rather than pick a branch.
  //
  // Belt and braces, deliberately: mutation-probe proved this line currently
  // changes nothing, because "or" is not a separator below, so it stays inside
  // a segment and that segment then fails the bare-code test. It is kept
  // because it is the ONLY thing that would refuse a disjunction if "or" ever
  // joined the separators, and the probe carries the note.
  if (/\bor\b/i.test(body)) return [];

  const out = [];
  const seen = new Set();
  for (const raw of body.split(/\s*,\s*|\s+and\s+/i)) {
    const seg = raw.trim();
    if (!seg) continue;
    const c = CODE_ONLY.exec(seg);
    if (!c) return [];                       // residue: refuse the sentence
    const id = `${c[1].toUpperCase()}${c[2]}`;
    if (id === String(selfId).toUpperCase()) continue;   // never its own coreq
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ subject: c[1].toUpperCase(), number: c[2] });
  }
  return out;
}

/**
 * The corequisites of a raw catalog record: the labelled field plus anything
 * its description states, deduplicated, labelled entries first.
 *
 * Shared by the scraper and the runtime normalizer so the two cannot drift —
 * the reason `program-record.js` exists for programs.
 *
 * @param {Array} labelled  refs parsed from the `Corequisite(s):` line
 * @param {string} description
 * @param {string} [selfId]
 */
export function mergeDescriptionCoreqs(labelled, description, selfId = "") {
  const out = [];
  const seen = new Set();
  for (const r of [...(Array.isArray(labelled) ? labelled : []),
                   ...parseDescriptionCoreqs(description, selfId)]) {
    if (!r?.subject || !r?.number) continue;
    const id = `${String(r.subject).toUpperCase()}${r.number}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}
