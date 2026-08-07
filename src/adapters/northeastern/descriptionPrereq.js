// ═══════════════════════════════════════════════════════════════════
// Description prerequisite parser — "Requires prior completion of …".
//
// A small number of courses state their prerequisite in the course
// DESCRIPTION and carry no `Prerequisite(s):` line at all, so the
// scraper — which reads the labelled field — correctly finds nothing
// and the planner shows no prerequisite. 36 of 7,966 courses corpus-
// wide (2026-08), and the set is not obscure: MATH 1342 (Calculus 2)
// states only "Requires prior completion of MATH 1341 or permission of
// head mathematics advisor" in its description, so a prereq-checking
// planner silently failed to know Calculus 2 follows Calculus 1.
//
// Verified against the live catalog page: MATH 1342's courseblock has
// exactly one courseblockextra row, an Attribute(s) line. There is no
// prerequisite field that was missed.
//
// Lives in src/, mirroring repeatability.js and gpaGate.js, and is
// shared by scripts/scrape-catalog.js (writes `prereqs` at scrape time —
// the canonical path per CLAUDE.md) and by courseNorm.js (derives the
// same tokens from the description of already-shipped data, so the fix
// reaches users before the next monthly scrape).
//
// ── Why this is self-contained ──────────────────────────────────────
// scripts/lib/prereq-parse.js is the shared parser for the labelled
// field and is load-bearing for every course that has a real one; it
// must not be altered for this, and src/ must not depend on scripts/.
// It also mis-handles these prose phrasings: branches like "or
// equivalent military experience" carry no recognized condition keyword,
// so they are dropped and leave a dangling operator behind. Prose is a
// narrower grammar than the labelled field, so it gets its own narrow
// reader: split on the sentence's top-level and/or joints, turn segments
// naming courses into refs and segments naming none into { note } leaves
// — the informational-condition shape the app already renders in italic.
//
// The bias throughout is that a requirement must never come out looking
// STRICTER than the catalog states it. The planner warns on unmet
// prerequisites, so inventing one costs a student a false warning on a
// course they may legitimately take — worse than showing nothing.
// ═══════════════════════════════════════════════════════════════════

/**
 * Sentences that state a REQUIREMENT. The verb must be requiring, not
 * advising: MATH 2321's "Prior completion of Calculus 2 is strongly
 * recommended" is a recommendation and must never become a prerequisite.
 * A short lead-in is allowed ("Students must have completed …").
 */
const REQUIREMENT =
  /(?:^|\.\s+)([^.]{0,40}?\b(?:requires?|must\s+have)\b[^.]*?\b(?:prior\s+(?:completion|study)|completion|completed|taken)\b[^.]*\.)/i;

/** Advisory phrasings that disqualify a sentence outright. */
const ADVISORY = /\b(recommend|suggest|encourag|helpful|useful|assumed|expected\s+to\s+have|preferred)/i;

/**
 * Sentences about work done INSIDE the course, which read identically to a
 * prerequisite ("Requires the completion of …") but describe a deliverable.
 * Two observed shapes, both real: EXRE 6500 "Requires the completion of a
 * project and presentation of the work" and PPUA 6410 "Requires students to
 * submit a three-project portfolio developed from projects completed within
 * courses taken …" — the latter matching only because "completed" and
 * "taken" appear far downstream. Note that a plain "completion of all
 * transition courses" (CS 5600) is a genuine gate and must still pass.
 */
const COURSEWORK =
  /\brequires?\s+students?\s+to\b|\b(?:completion|complete|submit)\s+(?:of\s+)?(?:a|an|the|their)?\s*(?:\w+[\s-]){0,2}(?:project|portfolio|presentation|paper|assignment|report|exhibit|recital|performance)\b/i;

/** The leading verb phrase, stripped before reading the operand list. */
const LEAD =
  /^[^.]{0,40}?\b(?:requires?|must\s+have)\s+(?:the\s+)?(?:prior\s+)?(?:completion|study|completed|taken)\s*(?:of\s+)?/i;

const COURSE_CODE = /\b[A-Z]{2,6}\s+\d{4}/;

/** Course references inside one segment, with an explicit grade if stated. */
function refsIn(segment) {
  const out = [];
  const re = /\b([A-Z]{2,6})\s+(\d{4}[A-Z]?)\b(?:\s+with\s+a\s+minimum\s+grade\s+of\s+([A-D][+-]?))?/g;
  let m;
  while ((m = re.exec(segment)) !== null) {
    out.push({ subject: m[1], number: m[2], ...(m[3] ? { minGrade: m[3] } : {}) });
  }
  return out;
}

/** Split on top-level " and " / " or ", recording the joint AFTER each part. */
function segments(text) {
  const parts = text.split(/\s+(and|or)\s+/i);
  const out = [];
  for (let i = 0; i < parts.length; i += 2) {
    const body = (parts[i] ?? "").trim();
    if (body) out.push({ body, op: parts[i + 1] ?? null });
  }
  return out;
}

/**
 * Tidy a fragment into note prose. Segment splitting can cut through a
 * parenthetical — ME 5665's "(Northeastern's BIOE 2350 or equivalent)"
 * splits at the "or", leaving "equivalent)" — so drop brackets the
 * fragment cannot balance.
 */
function noteText(s) {
  let out = s.replace(/[.;,]+$/, "").replace(/\s+/g, " ").trim();
  while (/^[)\]]/.test(out)) out = out.slice(1).trim();
  while (/[([]$/.test(out)) out = out.slice(0, -1).trim();
  const opens = (out.match(/\(/g) || []).length;
  const closes = (out.match(/\)/g) || []).length;
  if (closes > opens) out = out.replace(/\)(?=[^()]*$)/, "").trim();
  if (opens > closes) out = out.replace(/\((?=[^()]*$)/, "").trim();
  return out;
}

/**
 * Extract prerequisite tokens from a course description.
 *
 * Returns the same flat token shape the labelled field produces — course
 * refs `{subject, number, minGrade?}`, `{note}` leaves, and "And"/"Or"
 * strings — or null when the description states no requirement.
 *
 * @param {string} description  the course's cb_desc text
 * @returns {Array|null}
 */
export function parseDescriptionPrereq(description) {
  const text = String(description || "");
  if (!text) return null;

  const m = REQUIREMENT.exec(text);
  if (!m) return null;
  const sentence = m[1].trim();
  if (ADVISORY.test(sentence) || COURSEWORK.test(sentence)) return null;

  const body = sentence.replace(LEAD, "").replace(/\s*\.$/, "").trim();
  if (!body) return null;

  // No course named anywhere ("an undergraduate course in the theory of
  // computation"): keep the requirement as one note so the student still
  // sees it, rather than inventing a course dependency.
  if (!COURSE_CODE.test(body)) {
    const note = noteText(sentence);
    return note ? [{ note }] : null;
  }

  const tokens = [];
  let pendingOp = null;
  for (const { body: seg, op } of segments(body)) {
    const refs = refsIn(seg);
    let piece = [];
    if (refs.length) {
      refs.forEach((r, i) => { if (i) piece.push("And"); piece.push(r); });
    } else {
      const note = noteText(seg);
      if (note.length > 2) piece = [{ note }];
    }
    if (piece.length) {
      if (tokens.length) tokens.push(/^or$/i.test(pendingOp ?? "and") ? "Or" : "And");
      tokens.push(...piece);
    }
    pendingOp = op;
  }

  // Never emit a dangling or leading operator.
  while (tokens.length && typeof tokens[tokens.length - 1] === "string") tokens.pop();
  while (tokens.length && typeof tokens[0] === "string") tokens.shift();
  return tokens.length ? tokens : null;
}
