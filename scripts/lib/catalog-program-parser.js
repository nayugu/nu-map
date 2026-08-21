/**
 * catalog-program-parser.js — shared requirement-page parser for
 * scrape-majors.js (undergrad) and scrape-grad-majors.js (graduate).
 *
 * The two scrapers used to carry near-identical private copies of this logic.
 * Of the 15 parsing functions they each defined, 13 were byte-identical; only
 * the credit-total extractor and the requirement walk differed, and both of
 * those differences collapse into the PROFILE object below. Keeping one copy
 * is what makes CLAUDE.md's "fix both paths" rule actually hold.
 *
 * ── What changed in the 2026-08 rewrite ──────────────────────────────────────
 *
 * The old walk was `querySelectorAll('h2, table.sc_courselist')` with a cursor
 * that was set to null after every table. Three consequences, all silent:
 *
 *   1. A heading owned only its FIRST table. Every later table under the same
 *      heading was dropped. Measured across the live undergrad catalog:
 *      **331 of 717 requirement tables dropped on 82 programs.**
 *   2. `<h3>` was never walked at all (undergrad), so the concentration tables
 *      that hang off h3 — most of them — were invisible or misattributed.
 *   3. A table following an unrelated heading was attributed to it. On CS BSCS
 *      the AI concentration became a *mandatory* section titled "Program
 *      Requirement"; on Physics BS an optional concentration became required.
 *
 * The replacement walks a block stream and attributes each table to the
 * NEAREST PRECEDING HEADING OF ANY LEVEL, with a heading owning ALL of its
 * tables. Concentrations are resolved through the page's own anchor graph
 * rather than by matching heading text, because the catalog states the
 * relationship structurally: a "gateway" heading is followed by a <ul> whose
 * links point at the concentration headings.
 *
 * Deliberately NOT text-matching: heading wording varies far too much
 * ("Concentration", "Concentrations", "Computer Science Concentrations",
 * "Political Science Concentrations (Optional)", "Concentration or Electives
 * Option", "Program Options", "Performance Concentration", "Philosophy Major
 * with a Concentration in Law and Ethics"…). Link structure is stable; prose
 * is not.
 */

import { parse as parseHTML } from 'node-html-parser';

// ── Profiles ─────────────────────────────────────────────────────────────────
//
// The complete set of behavioural differences between the two scrapers.
// Everything else is shared.

export const UNDERGRAD_PROFILE = {
  level: 'undergrad',
  pathPrefix: '/undergraduate/',
  // Sanity window for a plausible degree total, used to reject stray numbers.
  creditWindow: [60, 250],
};

export const GRAD_PROFILE = {
  level: 'grad',
  pathPrefix: '/graduate/',
  // Floor is 4, and has come down twice for the same reason: each time, a
  // smaller class of real program turned out to exist below it.
  //   20 → 8  graduate certificates are 12–17 semester hours; a 20 floor
  //           silently zeroed 156 of them.
  //    8 → 4  advanced-entry doctoral programs are smaller still, because the
  //           master's already covered the coursework. Chemistry, PhD—Advanced
  //           Entry states "7 total semester hours required" and an 8 floor
  //           threw it away. These only became separate records when program
  //           variants were split out (docs/program-variants.md), so nothing
  //           below 8 had been visible before.
  // Measured before changing: across all 520 graduate programs, moving the
  // floor from 8 to 2 changes exactly ONE total — that Chemistry variant,
  // 0 → 7. The band is genuinely empty otherwise, so this is not a loosening
  // that lets noise in.
  // Safe for the same reason it always was: parseTotalCredits only matches
  // phrasings containing "total" or "required", so a bare "Complete 8 semester
  // hours from the following" cannot reach it.
  creditWindow: [4, 150],
};

function parseHoursCell(tr) {
  const cell = tr.querySelector('.hourscol');
  if (!cell) return 0;
  const n = parseInt(cell.text.trim(), 10);
  return isNaN(n) ? 0 : n;
}

/** Returns { subject, classId } or null. classId is a number. */
function parseCourseLink(a) {
  const text = a.text.trim();
  // "CS 3000" or "MATH 1341"
  const m = text.match(/^([A-Z]{2,6})\s+(\d+[A-Z]?)$/);
  if (!m) return null;
  const num = parseInt(m[2], 10);
  if (isNaN(num)) return null;
  return { subject: m[1], classId: num };
}

function firstCourseLink(container) {
  for (const a of container.querySelectorAll('a')) {
    const c = parseCourseLink(a);
    if (c) return c;
  }
  return null;
}

/**
 * Parse free-text range descriptions into RANGE nodes.
 * Handles: "CS 2500 or higher", "Any ENGW course", "CS 2500-2999",
 *          "CS 2500 and above", "CS 2500 or higher, except CS 5010",
 *          "MATH 3001 to MATH 4999 but not MATH 4000"
 */
function parseRangeText(raw) {
  const text = raw.trim();

  // Extract exceptions first: ", except CS 5010, CS 5020" / "but not MATH 4000"
  const exceptions = [];
  const excMatch = text.match(/,?\s*(?:except|but\s+not)\s+(.*)/i);
  if (excMatch) {
    for (const chunk of excMatch[1].split(/,\s*|\s+(?:and|or)\s+/i)) {
      // EXCLUDE, not COURSE. "MATH 3001 to MATH 4999 but not MATH 4000" says
      // nothing about MATH 4000 existing — it is a number carved out of a
      // range. Emitting it as a COURSE node made that an existence claim the
      // catalog never made, and left it indistinguishable from a requirement
      // to any generic tree walker: the verifier duly reported CS+Math as
      // requiring MATH 4000 and DS 4900 and missing both, the exact inverse of
      // what the page says. Every consumer reads only subject and classId, so
      // the type is free to say what these actually are.
      const em = chunk.trim().match(/([A-Z]{2,6})\s+(\d+)/);
      if (em) exceptions.push({ type: 'EXCLUDE', subject: em[1], classId: parseInt(em[2], 10) });
    }
  }
  const clean = text.replace(/,?\s*(?:except|but\s+not).*/i, '').trim();

  // "SUBJ NNNN or higher" / "SUBJ NNNN and above"
  let m = clean.match(/^([A-Z]{2,6})\s+(\d+)\s+(?:or\s+higher|and\s+above)/i);
  if (m) return { type: 'RANGE', subject: m[1], idRangeStart: parseInt(m[2], 10), idRangeEnd: 9999, exceptions };

  // "SUBJ NNNN-MMMM" / "SUBJ NNNN–MMMM" / "SUBJ NNNN to [SUBJ ]MMMM" / "… through …"
  m = clean.match(/^([A-Z]{2,6})\s+(\d+)\s*(?:[-–]|\bto\b|\bthrough\b)\s*(?:[A-Z]{2,6}\s+)?(\d+)/i);
  if (m) return { type: 'RANGE', subject: m[1], idRangeStart: parseInt(m[2], 10), idRangeEnd: parseInt(m[3], 10), exceptions };

  // "Any SUBJ course"
  m = clean.match(/^[Aa]ny\s+([A-Z]{2,6})\s+course/i);
  if (m) return { type: 'RANGE', subject: m[1], idRangeStart: 1000, idRangeEnd: 9999, exceptions };

  // Bare "SUBJ NNNN" with no range indicator but inside a range context — treat as lower bound
  m = clean.match(/^([A-Z]{2,6})\s+(\d+)$/);
  if (m && exceptions.length) return { type: 'RANGE', subject: m[1], idRangeStart: parseInt(m[2], 10), idRangeEnd: 9999, exceptions };

  return null;
}

/**
 * A row that is nothing but subject codes. Both conjunctions occur —
 * "EMGT, ENGR, ENSY, IE, ME, or MEIE" (ME BSME) and
 * "SUEN, ARCH, LARC, PPUA, LPSC, and SBSY" (Sustainable Urban Environments) —
 * and accepting only "or" silently dropped the second, which is why this is
 * written to accept either rather than the one example in front of me.
 */
const SUBJECT_LIST_ROW =
  /^[A-Z]{2,5}(?:\s*,\s*(?:(?:or|and)\s+)?[A-Z]{2,5})*(?:\s*,?\s+(?:or|and)\s+[A-Z]{2,5})?\s*$/;

/**
 * A pool the catalog defines by SUBJECT rather than by course:
 *
 *   Complete 8 semester hours from the following subject areas:              8
 *   SUEN, ARCH, LARC, PPUA, LPSC, and SBSY
 *
 * The subject list is certain — the registrar named it. What is NOT certain is
 * which of those subjects' courses belong to the pool, and that is decided by
 * the rest of the sentence. So the instruction must reduce ENTIRELY to a
 * credit demand + an optional level window + "the following subject area(s)".
 * The match is anchored, and that anchoring is the whole guard: residue means
 * the page said something we are not modelling, so the pool is not built.
 *
 * Measured over the 24 distinct wordings that name subjects, 15 reduce to this
 * shape and 9 do not. The refusals, and why each would be a claim we cannot
 * support:
 *
 *   "Complete one TECHNICAL ELECTIVE in one of the following subject areas:"
 *       — the subjects are named; which of their courses is a "technical
 *         elective" is not. RANGE ME 1000–9999 would admit ME 2350 Statics,
 *         required elsewhere on the same page, and 1000-level intros. This is
 *         ME BSME, the page that prompted the whole change.
 *   "…to fulfill the minimum program hours (SEE FACULTY ADVISOR for other
 *    acceptable elective courses)"          — the real pool is BROADER.
 *   "…SEE SUGGESTED ELECTIVE COURSE LIST."  — and here NARROWER.
 *   "Complete any business class FOR WHICH THE PRE-REQ IS MET in…"
 *   "THOSE WHO DO NOT CHOOSE A CONCENTRATION should take 27 additional…"
 *       — a condition on the student, not a course set.
 *   "Complete 4 semester hours AT THE GRADUATE LEVEL from…"
 *       — a level with no numbers; 1000–9999 would admit undergraduate
 *         courses to a graduate requirement.
 *   "Courses from the following subject areas MAY NOT COUNT toward any
 *    concentration"                          — the inverse of a requirement.
 *
 * All nine keep their section and their stated credit, and their sentence is
 * printed verbatim instead. Same rule as the notes layer: a sentence is
 * consumed only when the pattern accounts for all of it. Degrade to less
 * information, never to wrong information.
 *
 * @returns {{numCreditsMin:number, courses:object[]}|null}
 */
const SUBJECT_POOL_INSTRUCTION = new RegExp(
  '^(?:complete|choose|select|take)\\s+' +
  // "8 semester hours", "9–11 credit hours", "one", "three", "12"
  '(?:\\d+(?:[–-]\\d+)?\\s+(?:semester|credit)\\s+hours?' +
    '|one|two|three|four|five|six|seven|eight|nine|ten|\\d+)' +
  '(?:\\s+of)?' +
  // The noun may sit on either side of the level phrase — "4 SH of 5000- to
  // 6000-level COURSE WORK" and "8 SH of COURSES at the 5000 level or above"
  // are the same shape with the words swapped.
  '(?:\\s+(?:course\\s*work|courses))?' +
  // optional level window: "5000- to 6000-level", "at the 5000 level or above"
  '(?:\\s+(?:at\\s+the\\s+)?\\d{4}(?:\\s*[–-]?\\s*(?:to|through|[–-])\\s*\\d{4})?' +
    '[\\s-]*level(?:\\s+(?:or|and)\\s+(?:above|higher))?)?' +
  '(?:\\s+(?:course\\s*work|courses))?' +
  '\\s+(?:from|in|within)\\s+(?:one\\s+of\\s+)?the\\s+following\\s+subject\\s+areas?' +
  '(?:\\s+below)?\\s*[:.]?\\s*$',
  'i');

function parseSubjectPool(rows, profile) {
  for (let i = 0; i < rows.length; i++) {
    const instruction = rows[i].querySelector('td[colspan="2"] span.courselistcomment');
    if (!instruction) continue;
    const text = instruction.text.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    if (!/following\s+subject\s+areas?\b/i.test(text)) continue;
    // The anchored grammar IS the guard — no negation test, no keyword
    // blacklist, no level test. Anything the pattern does not account for in
    // full is residue, and residue refuses.
    if (!SUBJECT_POOL_INSTRUCTION.test(text)) return null;

    // The subject row is the next row that is only subject codes. It normally
    // follows immediately, but "(Note: see faculty advisor …)" sits between
    // them on the Personal Health Informatics PhD page.
    let subjects = null;
    let subjectRow = null;
    for (let j = i + 1; j < rows.length; j++) {
      const cell = rows[j].querySelector('td[colspan="2"] span.courselistcomment');
      const t = cell?.text?.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      if (SUBJECT_LIST_ROW.test(t)) {
        // Tokens are MATCHED, not split. Splitting on /,|\s+or\s+/ over
        // "ME, or MEIE" leaves "or MEIE" as a subject, because the comma
        // consumes the space the `or` branch needed — a RANGE over subject
        // "or MEIE" matches nothing and looks like a real requirement.
        // Conjunctions are uppercase nowhere in this row shape, but they are
        // excluded explicitly rather than by luck.
        subjects = [...new Set((t.match(/\b[A-Z]{2,5}\b/g) ?? []))]
          .filter(s => s !== 'OR' && s !== 'AND');
        subjectRow = rows[j];
        break;
      }
    }
    if (!subjects?.length) continue;

    // Credit: the hourscol is the registrar's own number and outranks the
    // prose, which counts courses ("one technical elective") as often as hours.
    // A range ("9–11 semester hours") takes its minimum — parseHoursCell does.
    const credits = parseHoursCell(rows[i]) || parseCreditInstruction(text);
    if (!credits) continue;

    // Level window, when stated: "5000 level or above", "5000- to 6000-level".
    let start = 1000, end = 9999;
    // "5000- to 6000-level" (Experience Design) as well as "5000-6000 level"
    // and "5000 to 6000 level": the dash and the word both appear, sometimes
    // together, so the dash is optional AHEAD of the connective as well as
    // being a connective itself.
    const span = text.match(/(\d{4})\s*(?:[-–]\s*)?(?:to|through|[-–])\s*(\d{4})[\s-]*level/i);
    const floor = text.match(/(\d{4})[\s-]*level\s+(?:or|and)\s+(?:above|higher)/i);
    if (span)       { start = parseInt(span[1], 10); end = parseInt(span[2], 10) + 999; }
    else if (floor) { start = parseInt(floor[1], 10); }
    // No unparseable-level branch is needed: a level phrase the grammar above
    // cannot read ("at the graduate level") fails the anchored match and has
    // already refused.
    //
    // A GRADUATE page with no level stated is refused outright, because neither
    // available window is knowable from the page and both are wrong:
    //   · 1000–9999 lets a 1000-level undergraduate course satisfy a master's
    //     elective — "Nursing, MS § Elective → NRSG" would admit NRSG 1000s;
    //   · a 5000 floor looks like a corpus fact (99.7% of the 12,870 courses
    //     named in graduate requirements are 5000+) and still is not one: the
    //     44 exceptions include ARCH 2340, ARCH 2240 and ARCH 3450, named in
    //     graduate requirements of the very architecture programs these pools
    //     belong to. So the floor would exclude courses NEU itself requires.
    // Measured: this refuses 15 of the 19 pools. All four survivors are
    // undergraduate, where an intro course in the named subject genuinely can
    // answer an elective. The 15 keep their section, their credit and their
    // sentence, which is the same trade every other refusal here makes.
    else if (profile?.level === 'grad') return null;

    return {
      numCreditsMin: credits,
      courses: subjects.map(subject => ({
        type: 'RANGE', subject, idRangeStart: start, idRangeEnd: end, exceptions: [],
      })),
      // The two rows this pool is BUILT from. A successful pool says everything
      // both sentences said, so they are consumed; on any refusal above they
      // stay residue and print verbatim.
      rows: [rows[i], subjectRow],
    };
  }
  return null;
}

/**
 * Parse "choose N" count from a comment string.
 * "Complete one of the following" → 1
 * "Select two of the following"   → 2
 * Returns null if not a choose-N instruction.
 */
function parseChooseInstruction(text) {
  const WORD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
  const m = text.match(/(?:complete|choose|select|take)\s+(\w+)\s+of/i);
  if (!m) return null;
  const w = m[1].toLowerCase();
  return WORD[w] ?? (parseInt(w, 10) || null);
}

/**
 * Parse "N credit hours" from a comment string.
 * "Select 12 credit hours from the following" → 12
 */
function parseCreditInstruction(text) {
  const m = text.match(/(\d+)\s+(?:credit|semester)\s+hours?/i);
  return m ? parseInt(m[1], 10) : null;
}

function flattenCourseNodes(reqs) {
  const out = [];
  for (const r of reqs) {
    if (r.type === 'COURSE' || r.type === 'RANGE') out.push(r);
    else if (r.courses) out.push(...flattenCourseNodes(r.courses));
  }
  return out;
}

/**
 * Convert a flat list of <tr> elements into a requirements array.
 * Handles: COURSE, AND (lab pairs), OR (orclass rows), RANGE (commentindent),
 *          XOM/OR groups introduced by "choose N" comment rows.
 *
 * `consumed` (optional Set) collects the <tr>s whose prose this parse actually
 * EXPRESSED as structure. Every comment row left out of it is residue, and
 * parseTable prints it verbatim as a section note — so the marking is the
 * mechanism behind change 2 and has to be exact in one direction: a row marked
 * consumed that was not really expressed makes a real requirement disappear
 * silently, which is the failure mode this whole area was built to end.
 *
 * Hence marking happens at the point the OUTPUT is pushed, never at the point
 * the row is READ. The distinction is not academic: ME BSME's "Complete one
 * technical elective in one of the following subject areas:" is read here, and
 * it does open a choose block (its 4 lands in the hourscol) — but no course row
 * follows, so the block commits nothing and the sentence stays a note. Marking
 * on read would have swallowed the only statement of that requirement.
 */
/**
 * A CourseLeaf sub-run header: `<span class="courselistcomment areasubheader">`.
 *
 * Matched by class token, never by the `tr`'s class string — `"even
 * areasubheader undefined subheader".includes("areaheader")` is false, which is
 * exactly why parseTable's boundary test never saw one of these.
 */
function isSubheaderRow(tr) {
  if (!tr) return false;          // called on rows[i + 1] at the end of a group
  return !!tr.querySelector('td[colspan="2"] span.areasubheader, td[colspan="2"] span.courselistcomment.areasubheader');
}

function parseRowGroup(rows, consumed = null) {
  const requirements = [];
  const consume = (tr) => { if (consumed && tr) consumed.add(tr); };

  // Pending state
  let pending       = null;   // last node awaiting possible OR alternatives
  let inChoose      = false;  // inside a "choose N" or "X credit hours" block
  let chooseItems   = [];     // options accumulated in choose block
  let chooseCreds   = 0;      // credit threshold (XOM)
  let chooseCount   = 0;      // pick-N count (OR / minRequirementCount)
  let chooseExplicit = false; // true when a "Complete N"/credit comment opened the group
  let splitPendingCredit = null; // split/supplemental credit (SH) awaiting its single course
  let chooseRow     = null;   // the comment <tr> that opened the current choose block
  let splitPendingRow = null; // the comment <tr> holding that split-credit annotation
  let subheaderSeen = false;  // an areasubheader has opened a sub-run in this group
  let flushOptions  = false;  // the open block's options are UNINDENTED (see below)
  let runOptions    = false;  // each SUBHEADERED RUN is one option of the block
  let optionNodes   = [];     // courses of the run currently open

  function commitPending() {
    if (!pending) return;
    (inChoose ? chooseItems : requirements).push(pending);
    pending = null;
  }

  /**
   * Close the subheadered run currently open, as ONE option of the block.
   *
   * A run of several courses is an AND: taking that branch means taking all of
   * them. This is the whole point of `runOptions` — see the indented codecol
   * branch below for what it fixes.
   */
  function closeOption() {
    if (!optionNodes.length) return;
    chooseItems.push(optionNodes.length === 1
      ? optionNodes[0]
      : { type: 'AND', courses: optionNodes });
    optionNodes = [];
  }

  function endRunOptions() {
    closeOption();
    runOptions = false;
    commitChooseGroup();
  }

  function commitChooseGroup() {
    if (!inChoose) return;
    inChoose = false;
    // Nothing accumulated → the instruction expressed nothing, so its row is
    // deliberately NOT consumed and survives as a verbatim note.
    if (!chooseItems.length) { chooseItems = []; chooseCreds = 0; chooseCount = 0; chooseExplicit = false; chooseRow = null; flushOptions = false; return; }
    consume(chooseRow);
    chooseRow = null;

    if (chooseCreds > 0) {
      // A credit-hour annotation followed by exactly one course is normally just a
      // required course whose credit is given elsewhere (e.g. "3 semester hours ...
      // count toward the X requirement"), so it's emitted as a bare COURSE — EXCEPT when
      // the credit is implausible for a single course instance (Studio Art BFA's "68
      // [SMFA 3000]": a comment row's own hourscol, read as a last-resort credit source
      // just above). That signals a repeatable, variable-credit course whose SH
      // accumulates across many term placements, not a fixed per-course value — a
      // genuinely different shape needing a distinct `accumulate` XOM, since the
      // ordinary "taken once" COURSE node (or the split-credit XOM below) would silently
      // over-credit it after just one term. See accumulate:true handling in
      // src/core/gradRequirements.js, which sums the real per-instance total instead.
      if (chooseItems.length === 1 && chooseItems[0].type === 'COURSE') {
        if (chooseCreds > 16) {
          requirements.push({ type: 'XOM', accumulate: true, numCreditsMin: chooseCreds, courses: chooseItems });
        } else {
          requirements.push(chooseItems[0]);
        }
      } else {
        requirements.push({ type: 'XOM', numCreditsMin: chooseCreds, courses: chooseItems });
      }
    } else if (chooseCount === 1 || chooseItems.length <= 2) {
      requirements.push({ type: 'OR', courses: chooseItems });
    } else if (!chooseExplicit) {
      // Group formed only by blockindent, with no "Complete N"/credit instruction —
      // e.g. a bare referenced electives pool whose required count is stated in another
      // section. Default to "pick one" rather than fabricating "take all N courses".
      requirements.push({ type: 'OR', courses: chooseItems });
    } else {
      // Pick N of M: emit as a SECTION node inline so the outer section can wrap it
      // For now emit the items directly; the section's minRequirementCount will be set
      // by the caller when it knows the choose count.  Tag the group for the caller.
      requirements.push({
        type: '_CHOOSE',        // internal marker; caller converts
        minCount: chooseCount || chooseItems.length,
        courses: chooseItems,
      });
    }

    chooseItems = []; chooseCreds = 0; chooseCount = 0; chooseExplicit = false; flushOptions = false;
  }

  // Indexed, because arming `runOptions` needs to know whether the row AFTER an
  // instruction is a subheader — that adjacency is what says the instruction's
  // options are the runs rather than the rows.
  for (let i = 0; i < rows.length; i++) {
    const tr = rows[i];
    const cls = tr.getAttribute('class') ?? '';

    // ── An areasubheader marks a sub-run, and ends a FLUSH block ──────────────
    //
    // CourseLeaf marks a sub-run inside one areaheader group with
    // `<span class="courselistcomment areasubheader">` — 1,663 groups on 466
    // pages. Neither of parseTable's boundary tests matches it (`areasubheader`
    // is a distinct class token, and `"even areasubheader undefined
    // subheader".includes("areaheader")` is false), so it arrives here as an
    // ordinary comment row and used to do nothing whatever.
    //
    // It closes a flush block only. Measured: 862 groups put a subheader BETWEEN
    // two indented option rows, where it is a category label inside ONE pool
    // ("choose 12 SH from: [Category A] … [Category B] …") — closing there would
    // split a single pool in two, so an indented pool runs straight through, and
    // `flushOptions` is set nowhere but the branch below. Zero effect on any
    // block that parsed before this change.
    //
    // Never consumed: "For students pursuing emergency elementary teaching
    // licenses" is a condition on the option beneath it that no node expresses,
    // so it survives as a verbatim note.
    if (isSubheaderRow(tr)) {
      subheaderSeen = true;
      if (runOptions) closeOption();
      else if (flushOptions) { commitPending(); commitChooseGroup(); }
      // Deliberately NOT a `continue`. A subheader can carry credit in its own
      // hourscol — Environmental and Sustainability Sciences says "Complete one
      // course from each category:" over "Skills 4", "Earth, Oceans, and
      // Environmental Change 4", "Conservation, Restoration, and Management 4" —
      // and the comment branch below reads that as a per-category pool. Swallowing
      // the row collapsed four separate 4 SH requirements into one OR: pick one
      // pair instead of all four, 12 SH of the degree gone. So the boundary work
      // happens here and the row still goes on to be read as an instruction.
    }

    // ── OR-alternative row (class="orclass …") ────────────────────────────────
    if (cls.includes('orclass')) {
      const codecol = tr.querySelector('td.codecol');
      if (!codecol) continue;
      const c = firstCourseLink(codecol);
      if (!c) continue;
      const node = { type: 'COURSE', ...c };

      if (pending?.type === 'COURSE' || pending?.type === 'AND') {
        pending = { type: 'OR', courses: [pending, node] };
      } else if (pending?.type === 'OR') {
        pending.courses.push(node);
      } else if (runOptions && optionNodes.length) {
        // An alternative to the last course of the run currently open.
        const last = optionNodes[optionNodes.length - 1];
        optionNodes[optionNodes.length - 1] = last.type === 'OR'
          ? { ...last, courses: [...last.courses, node] }
          : { type: 'OR', courses: [last, node] };
      } else {
        // No pending — append to last item in the current accumulator
        const arr = inChoose ? chooseItems : requirements;
        const last = arr[arr.length - 1];
        if (last?.type === 'COURSE' || last?.type === 'AND') {
          arr[arr.length - 1] = { type: 'OR', courses: [last, node] };
        } else if (last?.type === 'OR') {
          last.courses.push(node);
        }
      }
      continue;
    }

    const codecol = tr.querySelector('td.codecol');

    // ── Regular codecol row ───────────────────────────────────────────────────
    if (codecol) {
      // Indented option? (blockindent DIV wrapping the link)
      const isIndented = !!codecol.querySelector('div.blockindent');
      const container  = isIndented ? codecol.querySelector('div.blockindent') : codecol;
      const primary    = firstCourseLink(container);
      if (!primary) continue;

      // AND sub-courses: <span class="blockindent">and CS 3101</span>
      const andCourses = [];
      for (const span of codecol.querySelectorAll('span.blockindent')) {
        const c = firstCourseLink(span);
        if (c) andCourses.push(c);
      }

      const node = andCourses.length
        ? { type: 'AND', courses: [{ type: 'COURSE', ...primary }, ...andCourses.map(c => ({ type: 'COURSE', ...c }))] }
        : { type: 'COURSE', ...primary };

      // A split/supplemental-credit annotation is awaiting this course → emit as a
      // single-course XOM carrying the section's allotted SH, so the course can satisfy
      // this section while also counting toward the others it appears in.
      if (splitPendingCredit !== null && node.type === 'COURSE') {
        requirements.push({ type: 'XOM', numCreditsMin: splitPendingCredit, courses: [node] });
        consume(splitPendingRow);
        splitPendingCredit = null;
        splitPendingRow = null;
        continue;
      }
      splitPendingCredit = null;
      splitPendingRow = null;

      if (runOptions && isIndented) {
        // ── One option is a RUN, not a course ─────────────────────────────
        //
        // "Complete one of the following:" over subheadered runs of indented
        // courses is the commonest shape in this family: `ISiiiSiii` alone is 71
        // groups, `ISiiSii` 51, and the family runs to 583 groups on 232 pages.
        // The subheader used to do nothing, so the block absorbed every indented
        // row across every run and the section read "pick 1 of 6" where the page
        // offers a choice between two THREE-course tracks.
        //
        // That is under-requiring, and under-requiring is the failure a student
        // does not recover from: they satisfy the section with one course, the
        // audit agrees, and they are two courses short at graduation. Grouping
        // each run into an AND states what the page states — take one branch,
        // and a branch is all of its courses.
        //
        // Bounded entirely by markup, with nothing inferred: the subheader ends
        // an option and the first UNINDENTED row ends the block, because an
        // unindented row was never an option in the first place.
        optionNodes.push(node);
        continue;
      }

      if (isIndented) {
        // Options inside a "choose N" block
        commitPending();
        if (!inChoose) inChoose = true;
        pending = node;
      } else {
        if (runOptions) endRunOptions();
        commitPending();
        // ── An UNINDENTED option, inside a subheadered run ────────────────
        //
        // Indentation is the only signal that a course is an option rather than
        // an obligation, and CourseLeaf drops it once a subheader intervenes.
        // Elementary Education MAT prints "Complete one of the following:", a
        // subheader, a flush course, another subheader, another flush course —
        // so the first flush course closed a choose block holding nothing, the
        // instruction was discarded, and BOTH alternatives shipped as required.
        // The student was told to take two courses where the page says one.
        // Measured: 511 groups on 184 pages put the instruction inside a
        // subheadered run like this, and 94 sections in 81 programs currently
        // demand every child while a note quotes "one of the following".
        //
        // So a flush course joins the open block instead of closing it — but
        // ONLY when a subheader has already opened a sub-run, because that is
        // what bounds the block. Without that bound the block would run to the
        // end of the group and swallow genuinely required courses, which is
        // under-requiring: a student who follows it does not graduate. Over is
        // recoverable, under is not, so the unbounded case is deliberately left
        // as it is and its instruction stays a verbatim note.
        if (inChoose && !flushOptions) commitChooseGroup();
        pending = node;
      }
      continue;
    }

    // ── colspan=2 row (comment, range, or choose instruction) ─────────────────
    const wide = tr.querySelector('td[colspan="2"]');
    if (!wide) continue;

    // RANGE: <span class="courselistcomment commentindent"> inside blockindent div
    const rangeSpan = wide.querySelector('span.commentindent');
    if (rangeSpan) {
      const node = parseRangeText(rangeSpan.text.trim());
      if (node) {
        commitPending();
        (inChoose ? chooseItems : requirements).push(node);
        consume(tr);
      }
      // A range sentence parseRangeText cannot read is left unconsumed on
      // purpose — it prints verbatim instead of vanishing.
      continue;
    }

    // Comment (not an areaheader): "Complete one of the following", "Select 12 credit hours…"
    const commentSpan = wide.querySelector('span.courselistcomment');
    if (commentSpan && !commentSpan.getAttribute('class')?.includes('areaheader')) {
      const text = commentSpan.text.trim();

      // Split/supplemental credit: a per-course annotation cross-counting one course into
      // this section, e.g. "3 semester hours from the following count toward the
      // mathematics/science requirement:" or "…already required above and also fulfills the
      // integrative requirement:". The credit shown (if any) is only the portion allotted to
      // THIS section — the course's full SH is split across the sections it appears in
      // (common in combined-degree programs like IECS). Attach it to the next single course
      // as an XOM so gradRequirements' split-credit path lets it satisfy every section it
      // appears in without inflating total credits.
      if (/(?:counts? toward|fulfills) the .+? requirement/i.test(text)) {
        commitPending();
        splitPendingCredit = parseCreditInstruction(text) ?? 0;
        splitPendingRow = tr;
        continue;
      }

      const credits = parseCreditInstruction(text);
      const count   = credits !== null ? null : parseChooseInstruction(text);
      // Last resort: credit is only in the hourscol, not in the comment text.
      // Only used when both text-based parsers come up empty (e.g. "Complete three
      // courses from two of the following breadth areas: [12 in hourscol]").
      const hoursCredit = (credits === null && count === null)
        ? (parseHoursCell(tr) || null) : null;
      const effectiveCredits = credits ?? hoursCredit;

      if (effectiveCredits !== null || count !== null) {
        commitPending();
        commitChooseGroup();
        inChoose     = true;
        chooseCreds  = effectiveCredits ?? 0;
        chooseCount  = count  ?? 0;
        chooseExplicit = true;
        chooseRow    = tr;   // consumed only if the block it opens commits something
        // Options may be flush rather than indented, but only inside a sub-run
        // that bounds them — see the codecol branch above.
        flushOptions = subheaderSeen;
        // ── Each subheadered run below is one option ──────────────────────
        //
        // Armed only for "complete ONE of the following" immediately above the
        // first subheader. Two exclusions, both measured rather than reasoned:
        //
        //   a credit instruction  "Complete 12 credit hours from the following:"
        //     over three subheadered areas is one 12 SH pool. Turning its areas
        //     into alternatives would demand a whole area's worth of credit.
        //   a count above one     the subheaders are thematic CATEGORIES, not
        //     branches. Public Health BA says "Complete three of the following
        //     (two must be at the 3000 level or above and from the same area)"
        //     over "Society and Behavior", "Globalization and Global Health",
        //     "Law, Policy, and Human Rights" …; Project Management BS says
        //     "Complete four of the following" over industry areas. Reading a
        //     run as a conjunction there demanded all ~25 courses of a theme.
        //     `check-major-integrity` caught all four such sections as newly
        //     over-consuming pools, which is exactly what that guard is for.
        //
        // The line is not arbitrary: you do not complete FOUR of two tracks. A
        // count above one is a count of courses, so its options are the rows and
        // the subheaders are labels; a count of one over several runs is the
        // either/or that this reading exists to express.
        runOptions = !subheaderSeen && count === 1 && isSubheaderRow(rows[i + 1] ?? null);
      }
      continue;
    }
  }

  if (runOptions) endRunOptions();
  commitPending();
  commitChooseGroup();

  // Post-process: expand _CHOOSE markers into proper OR/XOM nodes
  return requirements.map(r => {
    if (r.type !== '_CHOOSE') return r;
    if (r.courses.length <= 2 || r.minCount === 1) return { type: 'OR', courses: r.courses };
    return { type: 'XOM', numCreditsMin: r.minCount * 4, courses: r.courses };
  });
}

/**
 * The prose rows of a group that this parse did NOT express as structure.
 *
 * The catalog states real conditions in sentences with no course code in them —
 * "Research courses may not be used to satisfy this requirement", "one
 * technical elective in one of the following subject areas", "must be taken at
 * the Boston campus". Every one of those used to be read, found unparseable,
 * and dropped, so the requirement shipped without the condition attached to it:
 * silence that reads exactly like "there is no condition".
 *
 * So the fallback is to print the sentence. It interprets nothing and blocks
 * nothing — a note cannot refuse a plan — and it is complete by construction:
 * whatever the grammars above fail to express, the reader still gets, in the
 * registrar's own words and in document order.
 *
 * Two exclusions, both because the sentence IS already said elsewhere:
 *   · rows consumed by parseRowGroup / parseSubjectPool, and
 *   · GPA prose, which parseRequirements turns into a gpaConstraint carrying
 *     the same text verbatim.
 */
function residualNotes(rows, consumedRows) {
  const seen = new Set();
  const out = [];
  for (const tr of rows) {
    if (consumedRows.has(tr)) continue;
    const sp = tr.querySelector('td[colspan="2"] span.courselistcomment');
    if (!sp || (sp.getAttribute('class') ?? '').includes('areaheader')) continue;
    const text = sp.text.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    if (!text || seen.has(text)) continue;
    if (parseGpaRule(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

/**
 * Parse a sc_courselist <table> into an array of SECTION nodes.
 *
 * If the table contains areaheader rows they act as sub-section boundaries.
 * Each sub-section becomes its own SECTION node.  If there are no areaheaders
 * the whole table becomes one SECTION using h2Title.
 */
function parseTable(table, h2Title, profile) {
  const rows = table.querySelectorAll('tr');

  // Split rows on areaheader boundaries
  const groups = [];   // [{ title, creditHint, rows[] }]
  let cur = null;

  for (const tr of rows) {
    // Skip hidden noscript thead rows
    const cls = tr.getAttribute('class') ?? '';
    if (cls.includes('hidden') && cls.includes('noscript')) continue;

    const isAreaHeader =
      cls.includes('areaheader') ||
      !!tr.querySelector('span.areaheader, span.courselistcomment.areaheader');

    if (isAreaHeader) {
      if (cur) groups.push(cur);
      const span    = tr.querySelector('span.areaheader, span.courselistcomment.areaheader');
      const title   = span?.text?.trim() ?? tr.text.trim().replace(/\s+/g, ' ');
      const credits = parseHoursCell(tr);
      cur = { title, creditHint: credits, rows: [] };
    } else {
      if (!cur) cur = { title: h2Title, creditHint: 0, rows: [] };
      cur.rows.push(tr);
    }
  }
  if (cur?.rows.length) groups.push(cur);

  if (!groups.length) return [];

  // "Choose from N areas" pattern (e.g. MSCS Breadth, AI MS Specialization):
  // An initial comment row specifies a credit minimum for a pool that spans multiple
  // areaheader sub-sections, but uses plain wording ("Complete three courses from two
  // of the following…") so parseCreditInstruction misses it — the credit lives only
  // in the row's hourscol. When detected, merge all areaheader groups into one XOM
  // rather than emitting each area as an independent all-required section.
  if (groups.length >= 3) {
    const initial = groups[0];
    if (initial.title === h2Title && initial.creditHint === 0) {
      const areaGroups = groups.slice(1);
      if (areaGroups.every(g => g.creditHint === 0)) {
        let poolCredit = 0;
        for (const tr of initial.rows) {
          const span = tr.querySelector('span.courselistcomment');
          if (span && !span.getAttribute('class')?.includes('areaheader')) {
            const h = parseHoursCell(tr);
            if (h > 0 && parseCreditInstruction(span.text.trim()) === null) {
              poolCredit = h;
              break;
            }
          }
        }
        if (poolCredit > 0 && parseRowGroup(initial.rows).length === 0) {
          const poolConsumed = new Set();
          const groups2 = areaGroups.map(g => ({
            title: g.title,
            courses: flattenCourseNodes(parseRowGroup(g.rows, poolConsumed)),
          })).filter(g => g.courses.length > 0);
          const allCourses = groups2.flatMap(g => g.courses);
          if (allCourses.length > 0) {
            // The instruction row is residue here even though its NUMBER was
            // read: merging the areas into one pool drops "from two of the
            // following breadth areas", so the sentence still carries a
            // condition the tree does not. It prints.
            const notes = residualNotes(
              [...initial.rows, ...areaGroups.flatMap(g => g.rows)], poolConsumed);
            return [{
              type: 'SECTION',
              title: h2Title,
              requirements: [{ type: 'XOM', numCreditsMin: poolCredit, courses: allCourses, groups: groups2 }],
              minRequirementCount: 1,
              ...(notes.length ? { notes } : {}),
            }];
          }
        }
      }
    }
  }

  return groups.map(g => {
    const consumedRows = new Set();
    const requirements = parseRowGroup(g.rows, consumedRows);

    // Comment texts survive on the section (transient — parseRequirements
    // strips them) so a GPA-titled group can be re-read as a constraint:
    // its threshold lives in a comment row ("… must average to a minimum
    // of C (2.000):") that parseRowGroup otherwise drops.
    const comments = g.rows
      .map(tr => tr.querySelector('td[colspan="2"] span.courselistcomment'))
      .filter(sp => sp && !(sp.getAttribute('class') ?? '').includes('areaheader'))
      .map(sp => sp.text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim());

    if (!requirements.length) {
      // A comment-only group is normally noise \u2014 EXCEPT when a comment
      // states a GPA rule ("Khoury College GPA Requirement" over one prose
      // row; grad "Program Requirement" blocks with "Minimum 3.000 GPA
      // required"). Emit a shell so parseRequirements converts it into a
      // constraint; shells never survive into requirementSections.
      if (comments.some(c => parseGpaRule(c))) {
        return { type: 'SECTION', title: g.title, requirements: [],
                 minRequirementCount: 0, _comments: comments };
      }

      // A group can state a credit demand and still name no course. ME's
      // "Mechanical and Industrial Engineering Technical Elective" is two
      // comment rows — "Complete one technical elective in one of the
      // following subject areas:" (4 SH) and "EMGT, ENGR, ENSY, IE, ME, or
      // MEIE" — so parseRowGroup finds nothing and the whole requirement used
      // to vanish: 4 SH missing from a 140 SH degree and no sign on the page
      // that a technical elective is required at all. 360 groups on 187
      // program pages are shaped this way.
      //
      // Emitting it keeps the requirement VISIBLE without claiming to know
      // which courses satisfy it:
      //   · requirements: []          — no pool, so nothing is enumerated wrongly
      //   · minRequirementCount: 1    — the student must do something here.
      //     0 would report sat:true and draw a CHECKED box in the panel, i.e.
      //     credit for work nobody has done — worse than the old silence.
      //     With no children the section renders "0/0" and adds nothing to
      //     program progress either way, so 1 costs nothing and asserts
      //     nothing false.
      //   · creditsRequired           — the registrar's own hours, so the
      //     section can be reconciled against the program total.
      // It generates no demand and no plan can be refused by it (checkSection
      // is the only reader of minRequirementCount, and nothing gates a plan on
      // all sections being satisfied).
      // First: can the pool be READ? Only when the instruction reduces
      // entirely to hours-from-these-subjects, which is a narrower test than
      // "the subjects are named" — see parseSubjectPool. ME BSME names its six
      // subjects and still refuses, because "one TECHNICAL ELECTIVE in one of"
      // them is a membership rule the page never spells out.
      const pool = parseSubjectPool(g.rows, profile);
      if (pool) {
        const { rows: poolRows, ...xom } = pool;
        poolRows.forEach(tr => consumedRows.add(tr));
        const notes = residualNotes(g.rows, consumedRows);
        return {
          type: 'SECTION',
          title: g.title,
          requirements: [{ type: 'XOM', ...xom }],
          minRequirementCount: 1,
          creditsRequired: pool.numCreditsMin,
          ...(notes.length ? { notes } : {}),
          ...(comments.length ? { _comments: comments } : {}),
        };
      }

      const stated = g.creditHint > 0
        ? g.creditHint
        : g.rows.reduce((sum, tr) => sum + parseHoursCell(tr), 0);
      if (stated > 0) {
        // The section that names no course is where notes matter most: with no
        // children, the prose is the ONLY description of the requirement the
        // reader gets. ME BSME's two sentences both land here.
        const notes = residualNotes(g.rows, consumedRows);
        return {
          type: 'SECTION',
          title: g.title,
          requirements: [],
          minRequirementCount: 1,
          creditsRequired: stated,
          ...(notes.length ? { notes } : {}),
          ...(comments.length ? { _comments: comments } : {}),
        };
      }
      return null;
    }

    const notes = residualNotes(g.rows, consumedRows);

    if (g.creditHint > 0) {
      // The section header specifies a credit total → wrap in XOM
      return {
        type: 'SECTION',
        title: g.title,
        requirements: [{ type: 'XOM', numCreditsMin: g.creditHint, courses: requirements }],
        minRequirementCount: 1,
        ...(notes.length ? { notes } : {}),
        ...(comments.length ? { _comments: comments } : {}),
      };
    }

    return {
      type: 'SECTION',
      title: g.title,
      requirements,
      minRequirementCount: requirements.length,
      ...(notes.length ? { notes } : {}),
      ...(comments.length ? { _comments: comments } : {}),
    };
  }).filter(Boolean);
}

export function findLeakedMarkers(obj, path = '') {
  if (!obj || typeof obj !== 'object') return [];
  const leaks = [];
  if (obj.type === '_CHOOSE') leaks.push(path);
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      v.forEach((item, i) => leaks.push(...findLeakedMarkers(item, `${path}.${k}[${i}]`)));
    } else if (v && typeof v === 'object') {
      leaks.push(...findLeakedMarkers(v, `${path}.${k}`));
    }
  }
  return leaks;
}

// ── Requirements region ───────────────────────────────────────────────────────
//
// CourseLeaf renders each tab as a `<div id="…textcontainer">`. Requirement
// tables can live in MORE THAN ONE of them: PhD pages, for example, split
// their requirements across #curriculumtextcontainer and
// #advancedentryphdprogramrequirementstextcontainer. Returning only the first
// match silently halved those programs.
//
// So: take every tab pane that actually contains requirement tables, except
// the Sample Plan of Study (which is an example, not the rule, and whose
// courses must never be read as requirements). Falling back to the whole page
// keeps standalone concentration pages and any future layout working.
function requirementsRoots(pageRoot) {
  return partitionPanes(pageRoot).included;
}

/**
 * The requirement panes on a page, in document order, with their ids.
 *
 * Exposed because a page can be more than one PROGRAM: the scrapers adjudicate
 * these ids against scripts/lib/program-variants.js and parse each group
 * separately, instead of flattening an alternate curriculum into the primary
 * one. Same selection as partitionPanes, so what is adjudicated is exactly what
 * would otherwise be merged.
 *
 * @returns {{id: string, el: object, tables: number}[]}
 */
export function listRequirementPanes(pageRoot) {
  return partitionPanes(pageRoot).included.map(el => ({
    id: el.getAttribute?.('id') ?? '',
    el,
    tables: el.querySelectorAll('table.sc_courselist').length,
  }));
}

/**
 * Split the page's tab panes into the ones we parse and the ones we skip, with
 * a reason for every skip.
 *
 * Requirement tables live under 27 different container ids across the catalog,
 * including outright typos in NEU's own markup (`programrequiementstextcontainer`,
 * `cirriculumtextcontainer`, `progratextcontainer`). Matching on the id suffix
 * plus "does it actually contain requirement tables" covers all of them;
 * hard-coding `programrequirementstextcontainer` would silently lose 544
 * tables.
 *
 * The Sample Plan of Study pane is the one deliberate exclusion: it is an
 * example schedule, not the requirements, and 4 pages put a courselist table
 * in it. The old parser walked the whole page and so read those as
 * requirements.
 */
function partitionPanes(pageRoot) {
  const included = [], excluded = [];
  for (const d of pageRoot.querySelectorAll('div[id]')) {
    const id = d.getAttribute('id') ?? '';
    if (!/textcontainer$/.test(id)) continue;
    const n = d.querySelectorAll('table.sc_courselist').length;
    if (!n) continue;
    if (/^planofstudy/.test(id)) excluded.push({ id, tables: n, reason: 'sample plan of study' });
    else included.push(d);
  }
  if (included.length) return { included, excluded };

  const named = pageRoot.querySelectorAll('div[id]')
    .filter(d => /requirementstextcontainer$/.test(d.getAttribute('id') ?? ''));
  return { included: named.length ? named : [pageRoot], excluded };
}

/** Single-root convenience for callers that just need the text. */
function requirementsRoot(pageRoot) {
  return requirementsRoots(pageRoot)[0] ?? pageRoot;
}
// ── Credit total ─────────────────────────────────────────────────────────────

/**
 * The program's stated total semester hours.
 *
 * Previously this read `tr.plangridtotal` FIRST — the Sample Plan of Study's
 * total. That is one path's credit load, which legitimately exceeds the
 * minimum (Biology's page says so outright), so the stored number was wrong
 * for most programs. Worse, `tr.listsum, tr.total` could match a courselist
 * subtotal: Chemistry BS stored 138 where both real sources said 134.
 *
 * Priority is now: what the page SAYS is required > what a sample plan adds up
 * to. Returns { value, source } so the verifier can tell a stated total from
 * an inferred one.
 *
 * Never matches "N semester hours in the major" — that is a major-only subtotal
 * (Philosophy says 89, POLS 52) and is not the degree total.
 *
 * @param {object} [opts]
 * @param {object[]} [opts.panes]  Read the total from THESE panes only.
 *        A page carrying two curricula states two totals, and taking the first
 *        hands the variant the wrong one: Electrical Engineering PhD is 48 SH
 *        by standard entry and 16 SH by advanced entry, and both used to ship
 *        as 48. Measured over the 2026 catalog, 42 of the 46 multi-pane pages
 *        state a different total in each pane.
 * @param {boolean} [opts.allowPageFallback=false when panes is set]
 *        Whether a pane that states no total may fall back to page-wide
 *        evidence (the sample-plan grid, a legacy "Total Hours" row). Scoping
 *        the regex search but not the fallbacks is a half-measure — the
 *        fallback simply reintroduces the primary's number. Callers parsing a
 *        whole page keep the fallbacks; callers parsing one program of several
 *        do not.
 */
export function parseTotalCredits(pageRoot, profile, opts = {}) {
  const [lo, hi] = profile.creditWindow;
  const inWindow = n => Number.isFinite(n) && n > lo && n < hi;
  // Default the fallbacks OFF exactly when a scope was requested, so a caller
  // cannot ask for one program and silently receive the page's answer.
  opts = { allowPageFallback: !Array.isArray(opts.panes), ...opts };

  // Read across every requirement pane — PhD pages split them.
  const text = (opts.panes ?? requirementsRoots(pageRoot)).map(r => r.text).join(' ')
    .replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');

  // Ordered by how explicitly the phrasing claims to be the DEGREE total.
  //
  // The catalog states this six different ways and each variant, when
  // unhandled, silently zeroed a whole class of programs:
  //   "134 total semester hours required"      the common undergrad form
  //   "36–44 total semester hours required"    grad ranges
  //   "12 total credits required"              law and several certificates
  //   "A total of 42 semester hours are required"   inverted word order
  //   "39 minimum semester hours required"
  //   "129 overall semester hours required"    when a major subtotal also appears
  //   "A minimum of 28 semester hours of coursework beyond the graduate degree
  //    is required"                            the doctoral form
  //
  // That last one matters more than its rarity suggests. It is how the two
  // curricula on a PhD page state their DIFFERENT totals — Interdisciplinary
  // Design and Media reads "a minimum of 48 … beyond the undergraduate degree"
  // in one pane and "a minimum of 28 … beyond the graduate degree" in the
  // other. Unmatched, the advanced-entry program fell through to the page-wide
  // fallback below and shipped 48: a confident wrong number for a 28 SH degree.
  // The words between the unit and "required" are why `N UNIT required` misses
  // it.
  //
  // It is anchored on "beyond the … degree" and NOT written as a general
  // "a minimum of N semester hours", because the looser form is how the major
  // SUBTOTAL is phrased: Computer Science and Theatre says "A minimum of 89
  // semester hours is required in the major" while the degree needs 133. A
  // first attempt at this pattern matched that sentence and overwrote 133 with
  // 89 — the same class of error it was added to fix, pointing the other way.
  //
  // UNIT is deliberately "semester hours" or "credits" only — never "quarter
  // hours", which CPS states alongside and which is not the same unit.
  const N = String.raw`(\d+)(?:\s*[-–]\s*\d+)?`;
  const UNIT = String.raw`(?:semester\s+hours?|credits?)`;
  const patterns = [
    [new RegExp(`${N}\\s+total\\s+${UNIT}\\s+required`, 'i'),   'stated-total'],
    [new RegExp(`a\\s+total\\s+of\\s+${N}\\s+${UNIT}`, 'i'),     'stated-total'],
    [new RegExp(`${N}\\s+overall\\s+${UNIT}\\s+required`, 'i'),  'stated-overall'],
    [new RegExp(`${N}\\s+total\\s+${UNIT}`, 'i'),                'stated-total'],
    [new RegExp(`${N}\\s+minimum\\s+${UNIT}\\s+required`, 'i'),  'stated-minimum'],
    [new RegExp(`a\\s+minimum\\s+of\\s+${N}\\s+${UNIT}[^.]*?beyond\\s+the\\s+(?:under)?graduate\\s+degree`, 'i'),
                                                                 'stated-minimum'],
    [new RegExp(`${N}\\s+${UNIT}\\s+required`, 'i'),             'stated-required'],
  ];
  for (const [re, source] of patterns) {
    const m = text.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (inWindow(n)) return { value: n, source };
    }
  }

  // The catalog sometimes states, in the same breath and the same slot, that
  // there IS no fixed number: Biology, PhD—Advanced Entry reads "Variable total
  // semester hours required". That is a different fact from a page that simply
  // never mentions a total, and flattening the two loses information the
  // catalog took the trouble to publish — so it is reported as its own source
  // rather than as silence.
  //
  // Anchored on the same "total … required" shape as the numeric patterns
  // above, because "Variable" is otherwise a common word in this corpus:
  // matching it loosely would catch course titles like "Complex Variable
  // Theory and Differential Equations". Exactly one page in the 2026 catalog
  // uses this phrasing, and this is it.
  if (new RegExp(`variable\\s+(?:total\\s+)?${UNIT}\\s+required`, 'i').test(text)) {
    return { value: 0, source: 'variable' };
  }

  // Both remaining fallbacks read the WHOLE page, which is right for a page
  // that holds one program and dangerous for one that holds two: the sample
  // plan describes the primary curriculum, so letting a variant reach it hands
  // that variant the other program's number. Interdisciplinary Design and
  // Media, PhD—Advanced Entry did exactly that and shipped 48 SH instead of
  // 28 — the precise failure the pane scoping exists to prevent, arriving
  // through the back door.
  //
  // So a caller that asked for one program's panes gets no page-wide guess.
  // Returning 0 is not a great answer, but "no total stated" is honest and an
  // unknown is cheap; a confident wrong total is what costs a student a term.
  if (!opts.allowPageFallback) {
    return { value: 0, source: null };
  }

  // Fall back to the sample plan only when the page states nothing. Scan the
  // whole page here — the plan grid lives in a different tab pane.
  for (const tr of pageRoot.querySelectorAll('tr.plangridtotal')) {
    const m = tr.text.trim().match(/(\d+)\s*$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (inWindow(n)) return { value: n, source: 'plan-grid' };
    }
  }

  const legacy = pageRoot.text.match(/[Tt]otal\s+[Hh]ours?[\s:]+(\d+)/);
  if (legacy) {
    const n = parseInt(legacy[1], 10);
    if (inWindow(n)) return { value: n, source: 'total-hours-row' };
  }

  return { value: 0, source: null };
}


/**
 * Course codes named in the Sample Plan of Study.
 *
 * Read from the anchors, never the cell text. The catalog renders compound
 * cells as "ME 2355and ME 2356" and "ME 3475 or  3480" — where the alternative
 * drops the subject prefix — so a text regex recovers about a third of them,
 * while every course is its own <a class="code" title="ME 2355">. Cells with
 * no anchor are placeholders ("Elective", "Co-op", "Vacation") and are
 * deliberately skipped.
 *
 * This feeds a WITNESS check, not a source of truth: the plan is one valid
 * path, so it can show that we dropped requirements but never that we have
 * them all. See scripts/lib/major-verify.js.
 */
export function extractPlanOfStudyCourses(pageRoot) {
  const keys = new Set();
  for (const pane of pageRoot.querySelectorAll('div[id]')) {
    if (!/^planofstudy/.test(pane.getAttribute('id') ?? '')) continue;
    for (const a of pane.querySelectorAll('a.code, a.bubblelink')) {
      const raw = (a.getAttribute('title') || a.text || '').replace(/\u00a0/g, ' ').trim();
      const m = /^([A-Z]{2,6})\s+(\d{3,4}[A-Z]?)$/.exec(raw);
      if (m) keys.add(`${m[1]}${parseInt(m[2], 10)}`);
    }
  }
  return [...keys].sort();
}

// ── Block stream ─────────────────────────────────────────────────────────────

const HEADING = /^H([2-4])$/;

/**
 * Flatten the requirements region into an ordered stream of the things that
 * matter: headings, requirement tables, and link lists.
 *
 * Walking the DOM in document order (rather than two querySelectorAll passes)
 * is what lets a table find its true owner regardless of heading level.
 */
function blockStream(container) {
  const blocks = [];

  const anchorIds = el =>
    el.querySelectorAll('a[id], a[name]')
      .map(a => a.getAttribute('id') || a.getAttribute('name'))
      .filter(Boolean);

  const visit = node => {
    for (const el of node.childNodes ?? []) {
      const tag = el.tagName;
      if (!tag) continue;

      const hm = HEADING.exec(tag);
      if (hm) {
        const text = el.text.replace(/\u00a0/g, ' ').trim().replace(/\s+/g, ' ');
        const ids  = anchorIds(el);
        // An EMPTY heading is a bookmark, not a section — POLS BA carries two
        // concentration anchors exactly this way. Emitting it as a heading
        // would let it swallow the anchor (leaving the real heading looking
        // like an ordinary requirement) and let it own tables under a blank
        // title. Emit a pure anchor so it stays transparent to both.
        blocks.push(text
          ? { kind: 'heading', level: +hm[1], el, text, ids }
          : { kind: 'anchor', ids });
        continue;
      }

      if (tag === 'TABLE' && (el.getAttribute('class') ?? '').includes('sc_courselist')) {
        blocks.push({ kind: 'table', el });
        continue;
      }
      if (tag === 'UL') {
        // Record it as a possible gateway menu, then KEEP DESCENDING: the
        // catalog nests requirement tables inside <ul class="tightlist"> on
        // some pages (Economics MS hides two there), and treating a list as a
        // leaf made those tables invisible.
        blocks.push({ kind: 'list', el });
        visit(el);
        continue;
      }

      // Anchors also sit in a bare <p> immediately before the heading they name.
      if (tag === 'P') {
        const ids = anchorIds(el);
        if (ids.length) { blocks.push({ kind: 'anchor', ids }); continue; }
        // Prose paragraphs join the stream for the GPA-rule scan. Additive:
        // every existing consumer switches on `kind` and ignores these.
        const text = el.text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        if (text) { blocks.push({ kind: 'para', el, text }); continue; }
      }

      visit(el);
    }
  };

  visit(container);
  return blocks;
}

/**
 * Map every in-page anchor id to the heading it introduces.
 *
 * The catalog places these three ways, all seen in the wild:
 *   <h3><a id="ARIN"></a>Concentration in AI</h3>     (inside the heading)
 *   <h2><a name="visualconc"></a>Concentration in …</h2>
 *   <p><a id="AMPIconc"></a></p><h3>Concentration in …</h3>  (just before it)
 * An anchor inside a heading binds to that heading; otherwise it binds to the
 * next heading in the stream.
 */
function anchorMap(_roots, blocks) {
  const map = new Map();

  // Walk in document order. An anchor binds to the heading it sits inside, or
  // — when it sits in an empty heading or a bare <p> — to the next heading
  // that actually has text.
  const bindNext = from => {
    for (let k = from; k < blocks.length; k++) {
      if (blocks[k].kind === 'heading') return k;
    }
    return undefined;
  };

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind === 'heading' && b.ids?.length) {
      for (const id of b.ids) map.set(id, i);
    } else if (b.kind === 'anchor') {
      const target = bindNext(i + 1);
      if (target !== undefined) for (const id of b.ids) map.set(id, target);
    }
  }
  return map;
}

const CONCENTRATION_HREF = /\/(?:under)?graduate\/[^/]+\/concentrations\//;

/**
 * Fallback classifier for a concentration heading that NO gateway links to.
 *
 * Physics BS is the case: "Astrophysics Concentration (Optional)" carries its
 * table inline with no menu above it, so the structural rule finds nothing and
 * the concentration would ship as a mandatory requirement.
 *
 * This is deliberately the fallback, never the primary test — heading wording
 * across the catalog is far too varied to lead with. Kept narrow, and never
 * applied to a heading that is itself a gateway (a menu like "Computer Science
 * Concentrations" describes options, it isn't one).
 */
const CONCENTRATION_TITLE = [
  /^concentration\s+in\b/i,                       // Concentration in Art History…
  /\bwith\s+a\s+concentration\s+in\b/i,          // Philosophy Major with a Concentration in…
  /\(\s*no\s+concentration\s*\)/i,                // Philosophy Major (No Concentration)
  /\bconcentration\s*(?:\(\s*optional\s*\))?\s*$/i, // Astrophysics Concentration (Optional)
  /\bconcentration\b[^—–]*[—–]/,                  // X Concentration—College of Y
  /^electives?\s+option\b/i,                      // Electives Option (the mutually-exclusive twin)
];

function looksLikeConcentration(text) {
  // "Concentrations" (plural) is an overview heading, not an option.
  if (/\bconcentrations\b/i.test(text) && !/\bconcentration\s+in\b/i.test(text)) return false;
  return CONCENTRATION_TITLE.some(re => re.test(text));
}

/**
 * A heading is a GATEWAY when the list following it is a menu of
 * concentrations — every link either jumps to another heading on this page or
 * points at a /concentrations/ page.
 *
 * Structural, not lexical: this is what catches "Program Options" and
 * "Concentration or Electives Option" without a word list, and what correctly
 * refuses to treat an ordinary bulleted prose list as a menu.
 */
function findGateways(blocks, anchors) {
  const gateways = [];
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].kind !== 'heading') continue;
    const level = blocks[i].level;

    for (let j = i + 1; j < blocks.length; j++) {
      const b = blocks[j];
      if (b.kind === 'heading' && b.level <= level) break;   // left this heading's scope
      if (b.kind !== 'list') continue;

      const links = b.el.querySelectorAll('a[href]')
        .map(a => ({ href: (a.getAttribute('href') ?? '').trim(), label: a.text.trim() }))
        .filter(l => l.href);
      if (!links.length) continue;

      const resolved = links.filter(l =>
        (l.href.startsWith('#') && anchors.has(l.href.slice(1))) || CONCENTRATION_HREF.test(l.href));

      if (resolved.length === links.length) {
        gateways.push({ headingIdx: i, links: resolved });
        break;
      }
    }
  }
  return gateways;
}

/**
 * Canonical form for a concentration link.
 *
 * The catalog emits three shapes for the same target — bare, trailing slash,
 * and /index.html — and at least one href carries whitespace *inside* the
 * attribute. Normalising here keeps the pre-fetch map and the resolver in
 * agreement.
 */
export function normalizeConcentrationHref(href, base = 'https://catalog.northeastern.edu') {
  let h = String(href || '').trim();
  if (!h) return null;
  h = h.replace(/\/index\.html$/i, '');
  if (h.startsWith('http')) return h.replace(/\/?$/, '/');
  if (!h.startsWith('/')) h = '/' + h;
  return base + h.replace(/\/?$/, '/');
}

/**
 * Deterministic de-duplication — titles are user-visible keys, so order matters.
 *
 * Every collision is also RECORDED, because the rename is not free. A title is
 * the identity of a concentration across saved plans, share links and MCP
 * SET_CONCENTRATION, and major-verify has a high-severity
 * `duplicate-concentration-titles` check for exactly that. That check used to
 * compare finished titles — by which point this function had already renamed
 * the collision to something legal, so it never fired. Public Policy PhD
 * shipped `{"level":"verified","issues":0}` while carrying two concentrations
 * of the same name whose credit requirements differed by 8 SH.
 *
 * The renamer must therefore hand the verifier the evidence rather than
 * laundering it away.
 */
function uniquify(title, used, collisions) {
  if (!used.has(title)) { used.add(title); return title; }
  collisions?.push(title);
  for (let n = 2; ; n++) {
    const candidate = `${title} (${n})`;
    if (!used.has(candidate)) { used.add(candidate); return candidate; }
  }
}

// ── Requirement walk ─────────────────────────────────────────────────────────

/**
 * Parse a program page into requirement sections + concentration options.
 *
 * @param {object} pageRoot  parsed page root
 * @param {object} profile   UNDERGRAD_PROFILE | GRAD_PROFILE
 * @param {object} [ctx]
 * @param {(href: string) => (object|null)} [ctx.resolveExternal]
 *        Loads a /concentrations/ page and returns its parsed root, or null.
 *        Injected so contract tests can run without network.
 * @returns {{requirementSections, concentrations, generalElectiveSH,
 *            tablesPresent, tablesConsumed, warnings}}
 */
/**
 * The catalog edition a page belongs to, as its ENDING year — every page
 * carries "2025-2026 Edition", which we store as 2026.
 *
 * This must come from the page, never from `new Date().getFullYear()`.
 * The catalog edition runs fall→summer while the clock rolls over in
 * January, so the clock is wrong in both directions:
 *   · a January run would invent a phantom next-year directory holding a
 *     duplicate of the current edition;
 *   · a run after NEU publishes the next edition (they roll in ~summer)
 *     would write the NEW requirements into the OLD year's directory,
 *     silently destroying the frozen snapshot older cohorts depend on.
 * Since a student follows the catalog they entered under, that second
 * failure is the one that quietly corrupts history.
 *
 * @returns {number|null} the edition's ending year, or null if absent
 */
export function parseCatalogEdition(pageRoot) {
  const text = pageRoot?.text ?? '';
  const m = /\b(\d{4})-(\d{4})\s+Edition\b/.exec(text);
  if (!m) return null;
  const start = parseInt(m[1], 10), end = parseInt(m[2], 10);
  // Sanity: consecutive years inside a plausible window.
  if (end !== start + 1 || start < 2000 || start > 2100) return null;
  return end;
}

// ── GPA rules ─────────────────────────────────────────────────────────
// Grammar from a census of all 1,372 cached catalog pages (docs/
// grades-design.md): 74 unscoped grad restatements, ~35 subject-scoped
// (four phrasing variants for Khoury alone), 12 program-scoped minor/major
// rules, 21 course-set averages, ~7 fuzzy scopes. These are CONSTRAINTS
// over grades, not requirements a course can satisfy — the old parser
// coerced the tabled ones into "pick 1 of N" OR sections, which both
// misstated the rule and added a phantom requirement to progress counts.

const GPA_HEADING = /GPA|grade[\s-]?point/i;

/**
 * Parse one prose sentence into { threshold, scope } or null.
 * scope: {kind:'cumulative'} | {kind:'subjects', subjects:[...]} |
 *        {kind:'program'} | {kind:'described', text}
 * Fuzzy scopes ("all business courses") stay 'described' — display only,
 * never guessed into a subject list.
 */
export function parseGpaRule(text) {
  const t = text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

  // "Grades in the following … must average to a minimum of C (2.000)"
  let m = /must average to a minimum of [A-DF][+-]? \(([0-9.]+)\)/.exec(t);
  if (m) return { threshold: parseFloat(m[1]), scope: { kind: 'courses' } };

  // "[Minimum] [cumulative] 2.000 GPA [is] required [in <scope>]".
  // "Minimum" is OPTIONAL: the dominant minor phrasing (146 pages) is the
  // bare "2.000 GPA required in the minor". A "for <x>" tail ("required for
  // the core requirement") is NOT a degree-wide floor — it stays described.
  m = /(?:[Mm]inimum )?(?:[Cc]umulative )?([0-9]\.[0-9]{1,3}) GPA(?: is)? required(?: (in|for) ([^.;]+?))?[.;]?$/.exec(t)
   || /[Mm]inimum [Cc]umulative ([0-9]\.[0-9]{1,3}) GPA(?: is)?(?: required)?(?: (in|for) ([^.;]+?))?[.;]?$/.exec(t)
   // Inverted order: "2.000 minimum GPA required in CHME coursework"
   // (a handful of engineering pages). NOT "minimum GPA of N" — that
   // family is co-op/application prerequisites ("required in order to
   // apply"), which are not degree rules.
   || /([0-9]\.[0-9]{1,3}) [Mm]inimum GPA(?: is)? required(?: (in|for) ([^.;]+?))?[.;]?$/.exec(t)
   // Spelled-out "grade-point average" instead of the "GPA" abbreviation, with the
   // threshold before the phrase and an optional "or higher" tail (e.g. "A cumulative
   // grade-point average of 2.500 or higher is required for the art history
   // requirements" — Studio Art BFA). Same prep/scope handling as the abbreviated forms.
   || /grade-point average of ([0-9]\.[0-9]{1,3})(?: or (?:higher|more))? is required(?: (in|for) ([^.;]+?))?[.;]?$/i.exec(t);
  if (!m) return null;
  const threshold = parseFloat(m[1]);
  const prep      = m[2] ?? null;
  const scopeText = (m[3] ?? '').trim();

  if (prep === 'for')
    return { threshold, scope: { kind: 'described', text: scopeText } };
  if (!scopeText || /^all courses completed/.test(scopeText))
    return { threshold, scope: { kind: 'cumulative' } };
  if (/^(?:the (?:minor|major)|all (?:minor|major) courses)$/i.test(scopeText))
    return { threshold, scope: { kind: 'program' } };
  // Subject lists, per the scope-phrasing census (docs/grades-design.md):
  //   "all CS, CY, DS, and IS courses"   commas Oxford or not, "all" optional
  //   "CHME coursework"                  engineering says "coursework"
  //   "ME/MEIE/EECE/ENCP coursework"     slash-separated
  //   "all CS, CY, DS, IS"               no suffix at all
  //   "IE, ME,and MEIE courses"          missing space after the comma
  // "and" is normalized to a comma BEFORE splitting — splitting on an
  // alternation left "and IS" fused into one token. Every token must be a
  // 2–6 letter uppercase subject code or the whole thing stays described
  // ("business courses", "anthropology and philosophy courses").
  const sm = /^(?:all )?([A-Z][A-Za-z\/,\s]*?)(?:\s+course(?:s|work))?$/.exec(scopeText);
  if (sm) {
    const subjects = sm[1].replace(/\band\b/g, ',').split(/\s*[,\/]\s*/)
      .map(s => s.trim()).filter(Boolean);
    if (subjects.length && subjects.every(s => /^[A-Z]{2,6}$/.test(s)))
      return { threshold, scope: { kind: 'subjects', subjects } };
  }
  return { threshold, scope: { kind: 'described', text: scopeText } };
}


/**
 * Requirement-table footnotes, and the substitutions stated in them.
 *
 * CourseLeaf hangs footnotes off a requirement table as a definition list:
 * `<dl><dt><sup>2</sup></dt><dd><p>Students can substitute …</p></dd></dl>`.
 * These were discarded entirely, which is why the single most-repeated explicit
 * substitution in the catalog was invisible to us — Cornerstone of Engineering:
 *
 *   "Students can substitute Engineering Design (GE 1110) and Engineering
 *    Problem Solving and Computation (GE 1111) for Cornerstone of Engineering 1
 *    (GE 1501) and Cornerstone of Engineering 2 (GE 1502)."
 *
 * ~32 footnotes across 14 engineering programs, stated in plain language with
 * clean `a.code[title]` anchors. Nothing else reaches it: no program lists the
 * pair as an `OR` choice, and prereq co-occurrence only links GE 1111/GE 1502
 * at a title overlap below the choice-pool gate.
 *
 * Codes come from anchors, with an `?P=` href fallback — measured, 18 of the 32
 * Cornerstone instances render without the class/title attributes, so
 * anchor-only extraction silently misses more than half.
 *
 * The **direction** matters and is legible in the grammar: "substitute X for Y"
 * means X replaces Y. Counts on each side are kept as parsed rather than zipped
 * pairwise here, because a 2-for-2 rule is a set-to-set claim — the catalog
 * grants it for the whole set, not pair by pair.
 */
const FOOTNOTE_CODE = /\b([A-Z]{2,5})\s?(\d{4})\b/g;

function footnoteCodes(dd) {
  const out = [];
  for (const a of dd.querySelectorAll('a')) {
    const title = a.getAttribute('title');
    const href = a.getAttribute('href') || '';
    let code = null;
    if (title && /^[A-Z]{2,5}\s?\d{4}$/.test(title.replace(/\u00a0/g, ' ').trim())) code = title;
    else if (/[?&]P=/.test(href)) {
      try { code = decodeURIComponent(href.split('P=')[1].split('&')[0]); } catch { code = null; }
    }
    if (code) out.push(code.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase());
  }
  if (out.length) return [...new Set(out)];
  const text = dd.text.replace(/\u00a0/g, ' ');
  FOOTNOTE_CODE.lastIndex = 0;
  const found = [];
  let m;
  while ((m = FOOTNOTE_CODE.exec(text))) found.push(`${m[1]} ${m[2]}`);
  return [...new Set(found)];
}

/**
 * "substitute A (and B) for X (and Y)" → `{ from: [A,B], to: [X,Y] }`.
 *
 * ## The split cannot be the first " for "
 *
 * Course titles are full of it — *Physics **for** Engineering 1*, *General
 * Chemistry **for** Engineers*, *Calculus 1 **for** Science and Engineering* —
 * so splitting on the first occurrence lands inside a title and drops every code
 * off the left side. The Cornerstone footnote passes only by luck: neither
 * "Engineering Design" nor "Engineering Problem Solving and Computation"
 * contains "for". A rule naming any *for*-titled course silently returned null.
 *
 * So every " for " is tried, and a split is kept only when both sides name a
 * course. The leftmost valid split wins — the most conservative reading, giving
 * the smallest source set. Where several are valid they agree in practice,
 * because the extra candidates only move title text across the boundary, not
 * codes.
 *
 * ## Deliberately not handled
 *
 * - **"substitute X with Y"** reverses the direction ("for" means X replaces Y;
 *   "with" means Y replaces X). No footnote in the corpus states it with codes
 *   on both sides, so supporting it would be unvalidated guesswork — and a
 *   backwards substitution is far worse than a missed one. Returns null.
 * - **"For X, students may substitute Y"** — clause-reversed, zero instances.
 * - **Discretionary language** — "with approval of", "may petition" — is
 *   advisory, not a rule we can offer, and is rejected outright.
 */
export function parseFootnoteSubstitution(text, codes) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!/\bsubstitut/i.test(t)) return null;
  if (/\b(?:approval|permission|petition|consult|discretion)\b/i.test(t)) return null;

  const head = /substitutes?\s+(?:with\s+)?/i.exec(t);
  if (!head) return null;
  const body = t.slice(head.index + head[0].length);

  const codesIn = part => {
    const out = [];
    const re = /\b([A-Z]{2,5})\s?(\d{4})\b/g;
    let m;
    while ((m = re.exec(part))) out.push(`${m[1]} ${m[2]}`);
    return [...new Set(out)];
  };

  const known = new Set(codes);
  const SPLIT = /\s+for\s+/gi;
  SPLIT.lastIndex = 0;
  let m;
  while ((m = SPLIT.exec(body))) {
    const from = codesIn(body.slice(0, m.index));
    const to   = codesIn(body.slice(m.index + m[0].length));
    if (!from.length || !to.length) continue;
    // Every code named must be one the footnote's own anchors agree exists.
    if (![...from, ...to].every(c => known.has(c))) continue;
    // A course cannot substitute for itself.
    if (from.some(c => to.includes(c))) continue;
    return { from, to };
  }
  return null;
}


/**
 * Extract footnotes from a page, with any substitution each one states.
 * Returns `[{ marker, text, codes, substitution }]`.
 */
export function parseFootnotes(pageRoot) {
  const out = [];
  const seen = new Set();
  for (const dl of pageRoot.querySelectorAll('dl')) {
    const dts = dl.querySelectorAll('dt');
    const dds = dl.querySelectorAll('dd');
    if (!dts.length || dts.length !== dds.length) continue;
    for (let i = 0; i < dts.length; i++) {
      const text = dds[i].text.replace(/\s+/g, ' ').trim();
      if (text.length < 8) continue;
      const key = text.slice(0, 160);
      if (seen.has(key)) continue;            // the same note repeats per pane
      seen.add(key);
      const codes = footnoteCodes(dds[i]);
      out.push({
        marker: dts[i].text.replace(/\s+/g, ''),
        text,
        codes,
        substitution: parseFootnoteSubstitution(text, codes),
      });
    }
  }
  return out;
}

/**
 * @param {object} pageRoot
 * @param {object} profile
 * @param {object} [ctx]
 * @param {(href: string) => (object|null)} [ctx.resolveExternal]
 * @param {object[]} [ctx.panes]
 *        Parse only THESE panes rather than every pane on the page. A catalog
 *        page can hold more than one program — an alternate entry path, a
 *        part-time route — and merging those into one record is what produced
 *        duplicate concentrations and phantom requirement sections. The
 *        scrapers group panes with scripts/lib/program-variants.js and call
 *        this once per program.
 *
 *        Table reconciliation follows the scope: with `panes` the numbers
 *        describe that subset, and it is the CALLER's job to check that the
 *        subsets together cover the page exactly once. The scrapers do
 *        (`assertPaneCoverage`), which is a strictly stronger invariant than
 *        the page-wide one — it catches double-counting, which counting
 *        consumption alone never could.
 */
export function parseRequirements(pageRoot, profile, ctx = {}) {
  const scoped = Array.isArray(ctx.panes);
  const { included: roots, excluded: excludedPanes } = scoped
    ? { included: ctx.panes, excluded: [] }
    : partitionPanes(pageRoot);
  const blocks = roots.flatMap(r => blockStream(r));
  const anchors  = anchorMap(roots, blocks);
  const gateways = findGateways(blocks, anchors);
  const warnings = [];

  const tablesPresent = blocks.filter(b => b.kind === 'table').length;
  // Reconcile against the whole document, not just the panes we selected.
  // Counting "present" only inside our own selection is self-confirming: when
  // pane selection was wrong, PhD pages reported a tidy 3/3 while half the
  // page went unread. Every table on the page must end up consumed or
  // explicitly excluded.
  const tablesOnPage = scoped
    ? roots.reduce((n, r) => n + r.querySelectorAll('table.sc_courselist').length, 0)
    : pageRoot.querySelectorAll('table.sc_courselist').length;
  const tablesExcluded = excludedPanes.reduce((n, p) => n + p.tables, 0);
  const consumed = new Set();

  // Every table belongs to the nearest preceding heading, whatever its level,
  // and a heading keeps ALL of its tables. This single change is what recovers
  // the 331 dropped tables.
  const owners = new Map();          // heading index → table blocks
  const orphanTables = [];           // tables that precede every heading
  let currentHeading = null;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind === 'heading') { currentHeading = i; continue; }
    if (b.kind !== 'table') continue;
    // A pane can open with a table and no heading (several minors do). Parsing
    // it under a fallback title is strictly better than discarding it — the
    // table's own areaheader rows usually supply real titles anyway.
    if (currentHeading === null) { orphanTables.push(b); continue; }
    if (!owners.has(currentHeading)) owners.set(currentHeading, []);
    owners.get(currentHeading).push(b);
  }

  // Headings reachable from a gateway are concentration content, not
  // requirements — this is what stops "Electives Option" and "Astrophysics
  // Concentration (Optional)" being rendered as mandatory.
  const concHeadings = new Map();    // heading index → link label
  const externalLinks = [];
  // One TARGET is one concentration, however many menus point at it. A page can
  // repeat the same menu — International Business, BSIB lists all 15 business
  // concentrations under its own requirements and again under the exchange-
  // student curriculum — and this list used to take both copies, so the page
  // produced 30 options where 15 exist. De-duplicating on the normalized href
  // rather than on the finished title matters twice over: it is the only form
  // in which the three spellings the catalog emits (bare, trailing slash,
  // /index.html) are comparable, and it happens BEFORE the scrapers' fetch cap
  // (MAX_EXTERNAL_CONCENTRATIONS), which was being spent on duplicates.
  const seenExternal = new Set();
  const gatewayIdx = new Set(gateways.map(g => g.headingIdx));
  for (const gw of gateways) {
    for (const link of gw.links) {
      if (link.href.startsWith('#')) {
        const idx = anchors.get(link.href.slice(1));
        if (idx !== undefined) concHeadings.set(idx, link.label);
      } else {
        const key = normalizeConcentrationHref(link.href);
        if (key && seenExternal.has(key)) continue;
        if (key) seenExternal.add(key);
        externalLinks.push(link);
      }
    }
  }
  // Concentrations no menu points at (Physics BS's inline "Astrophysics
  // Concentration (Optional)"). Only headings that actually own a table —
  // otherwise a stray mention would create an empty option.
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind !== 'heading' || gatewayIdx.has(i) || concHeadings.has(i)) continue;
    if (owners.has(i) && looksLikeConcentration(b.text)) concHeadings.set(i, undefined);
  }

  const requirementSections  = [];
  const concentrationOptions = [];
  const usedSectionTitles    = new Set();
  const usedConcTitles       = new Set();
  // Titles that collided and had to be renamed. Reported, not hidden — see
  // uniquify. Sections legitimately share generic names ("Required Courses",
  // "Electives") within one pane, so a section collision is informational;
  // a CONCENTRATION collision is not, and major-verify treats it as high.
  const sectionCollisions    = [];
  const concCollisions       = [];
  let generalElectiveSH = 0;

  // GPA rules are CONSTRAINTS over grades, not requirements a course can
  // satisfy. The old parser coerced tabled ones into "pick 1 of N" OR
  // sections — misstating the rule AND adding a phantom requirement to
  // progress counts on 24 programs. Conversion rules:
  //   · a GPA-titled section, or one whose comment says "must average to a
  //     minimum of X (n.nnn)", becomes a course-set constraint and leaves
  //     requirementSections entirely;
  //   · an ordinary section whose comments state a cumulative/subject/
  //     program-scoped rule KEEPS its courses and additionally yields the
  //     constraint (grad "Program Requirement" blocks mix "80 total semester
  //     hours" with "Minimum 3.000 GPA required");
  //   · unparseable GPA prose falls through unchanged — never silently drop.
  const gpaConstraints = [];
  const seenGpa = new Set();
  const pushGpa = (c) => {
    const key = JSON.stringify([c.threshold, c.scope, c.courses ?? null]);
    if (seenGpa.has(key)) return;
    seenGpa.add(key);
    gpaConstraints.push(c);
  };
  /** Prose paragraphs between a heading and the next heading — the CS+Econ
      layout states the threshold in a <p> under the <h3>, with the course
      table following, so the section path needs those paras to see it. */
  const adjacentParas = (headingIdx) => {
    const out = [];
    for (let i = headingIdx + 1; i < blocks.length; i++) {
      if (blocks[i].kind === 'heading') break;
      if (blocks[i].kind === 'para') out.push(blocks[i].text);
    }
    return out;
  };

  /** Returns true when the whole section was consumed as a constraint. */
  const extractGpa = (s, extraParas = []) => {
    const comments = [...(s._comments ?? []), ...extraParas];
    delete s._comments;                       // never let scratch text reach the JSON
    const rules = comments.map(parseGpaRule).filter(Boolean);
    const gpaTitled = GPA_HEADING.test(s.title ?? '');
    if (!rules.length && !gpaTitled) return false;

    const courses = flattenCourseNodes(s.requirements ?? [])
      .filter(r => r.type === 'COURSE')
      .map(r => ({ subject: r.subject, classId: r.classId }));
    const courseRule = rules.find(r => r.scope.kind === 'courses') ?? null;

    if ((gpaTitled || courseRule) && (courses.length || rules.length)) {
      // The section IS the rule. Scope preference: an explicit course-set
      // average binds to this section's courses; otherwise whatever the
      // prose said (Khoury's subject scope); a bare GPA title over courses
      // means those courses.
      const rule = courseRule ?? rules[0] ?? null;
      const scope = courseRule ? { kind: 'courses' }
                  : rule       ? rule.scope
                  :              { kind: 'courses' };
      if (scope.kind !== 'courses' || courses.length) {
        pushGpa({
          title: s.title,
          threshold: rule?.threshold ?? null,
          scope,
          ...(scope.kind === 'courses' ? { courses } : {}),
          ...(comments.length ? { text: comments.find(c => parseGpaRule(c)) ?? comments[0] } : {}),
        });
        return true;                          // drop the phantom section
      }
    }
    // Ordinary section with GPA prose riding along: keep the section,
    // surface each rule.
    for (const r of rules) {
      pushGpa({ title: s.title, threshold: r.threshold, scope: r.scope,
                text: comments.find(c => parseGpaRule(c)) });
    }
    return (s.requirements ?? []).length === 0; // shells with nothing left vanish
  };

  for (const tb of orphanTables) {
    for (const sec of parseTable(tb.el, 'Requirements', profile)) {
      if (extractGpa(sec)) continue;
      sec.title = uniquify(sec.title, usedSectionTitles, sectionCollisions);
      requirementSections.push(sec);
    }
    consumed.add(tb);
  }

  for (const [headingIdx, tableBlocks] of owners) {
    const title = blocks[headingIdx].text;

    // "Required General Electives" contributes only its SH — the section is
    // rebuilt at runtime by gradRequirements.calculateGeneralElectives.
    if (/^Required General Electives/i.test(title)) {
      for (const tb of tableBlocks) {
        for (const tr of tb.el.querySelectorAll('tr')) {
          const sh = parseHoursCell(tr);
          if (sh > 0) { generalElectiveSH = sh; break; }
        }
        consumed.add(tb);
      }
      continue;
    }

    if (concHeadings.has(headingIdx)) {
      // A concentration flattens its tables' sections into one requirement
      // list, so a note attached to a discarded section wrapper would be lost
      // with it. Hoisted to the concentration, which is itself a SECTION.
      const concNotes = [];
      const reqs = tableBlocks.flatMap(tb => {
        consumed.add(tb);
        return parseTable(tb.el, title, profile).flatMap(s => {
          for (const n of s.notes ?? []) if (!concNotes.includes(n)) concNotes.push(n);
          return s.requirements ?? [];
        });
      });
      if (reqs.length) {
        concentrationOptions.push({
          type: 'SECTION',
          // Strip a trailing "—College of …" tag; em/en-dash only, so hyphenated
          // names like "Agent-Based" survive.
          title: uniquify(title.split(/\s*[—–]\s*/)[0].trim(), usedConcTitles, concCollisions),
          label: concHeadings.get(headingIdx) || undefined,
          requirements: reqs,
          minRequirementCount: reqs.length,
          ...(concNotes.length ? { notes: concNotes } : {}),
        });
      }
      continue;
    }

    for (const tb of tableBlocks) {
      const sections = parseTable(tb.el, title, profile);
      consumed.add(tb);
      for (const s of sections) {
        if (extractGpa(s, GPA_HEADING.test(title) ? adjacentParas(headingIdx) : [])) continue;
        s.title = uniquify(s.title, usedSectionTitles, sectionCollisions);
        requirementSections.push(s);
      }
    }
  }

  // GPA rules stated as plain prose paragraphs — the standard CourseLeaf
  // pattern is <h2>Program Credit/GPA Requirements</h2> followed by bare
  // <p>s ("12 total semester hours required" / "Minimum 3.000 GPA
  // required"). Two heading classes are skipped: admission-flavoured ones
  // (a PlusOne "Minimum 3.500 GPA required" is an entry bar, not a degree
  // constraint — misfiling it would be worse than missing it), and
  // GPA-titled headings that own tables, whose paras were already folded
  // into the section constraint above.
  let paraHeading = null, paraHeadingIdx = -1;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind === 'heading') { paraHeading = b.text; paraHeadingIdx = i; continue; }
    if (b.kind !== 'para') continue;
    if (paraHeading && /admission|entrance|eligib/i.test(paraHeading)) continue;
    if (paraHeading && GPA_HEADING.test(paraHeading) && owners.has(paraHeadingIdx)) continue;
    const r = parseGpaRule(b.text);
    if (r) pushGpa({ title: paraHeading, threshold: r.threshold, scope: r.scope, text: b.text });
  }

  // Concentrations that live on their own page (the business school pattern).
  if (ctx.resolveExternal) {
    for (const link of externalLinks) {
      const extRoot = ctx.resolveExternal(normalizeConcentrationHref(link.href));
      if (!extRoot) continue;
      const extContainer = requirementsRoot(extRoot);
      const heading = extContainer.querySelector('h2, h1');
      const title = (heading?.text ?? link.label).replace(/\s+/g, ' ').trim();
      const extNotes = [];
      const reqs = extContainer.querySelectorAll('table.sc_courselist')
        .flatMap(t => parseTable(t, title, profile).flatMap(s => {
          for (const n of s.notes ?? []) if (!extNotes.includes(n)) extNotes.push(n);
          return s.requirements ?? [];
        }));
      if (!reqs.length) continue;
      concentrationOptions.push({
        type: 'SECTION',
        title: uniquify(title, usedConcTitles, concCollisions),
        label: link.label || undefined,
        requirements: reqs,
        minRequirementCount: reqs.length,
        ...(extNotes.length ? { notes: extNotes } : {}),
      });
    }
  }

  const tablesConsumed = consumed.size;
  const unaccounted = tablesOnPage - tablesConsumed - tablesExcluded;

  // Name the sections we failed to read, not just how many. "3 tables were
  // dropped" is unactionable; "Political Science Electives was not read" tells
  // a reader exactly what is missing from their requirement list.
  const unconsumedHeadings = [];
  for (const [headingIdx, tableBlocks] of owners) {
    if (tableBlocks.some(tb => !consumed.has(tb))) unconsumedHeadings.push(blocks[headingIdx].text);
  }
  if (unaccounted > 0) {
    warnings.push(`${unaccounted} of ${tablesOnPage} tables on the page were neither parsed nor excluded`);
  }

  const concentrations = concentrationOptions.length
    ? { minOptions: concentrationMinOptions(blocks, gateways, concHeadings), concentrationOptions }
    : null;

  return { requirementSections, concentrations, generalElectiveSH,
           gpaConstraints,
           // Footnotes state substitutions no other source carries — see
           // parseFootnotes. Kept whole so a later reader can audit the prose,
           // not just the extracted pair.
           footnotes: parseFootnotes(pageRoot),
           tablesPresent, tablesConsumed, tablesOnPage, tablesExcluded,
           excludedPanes, unconsumedHeadings, warnings,
           // Titles that had to be renamed to stay unique, BEFORE the rename.
           // major-verify reads these; comparing finished titles cannot see a
           // collision that uniquify has already resolved.
           titleCollisions: { sections: sectionCollisions, concentrations: concCollisions },
           // Which panes this parse actually covered, so the caller can prove
           // the per-variant parses partition the page rather than overlap it.
           panesParsed: roots.map(r => r.getAttribute?.('id') ?? ''),
           // Concentrations hosted on their own pages. Parsing is synchronous
           // and fetching is not, so the caller pre-fetches these and calls
           // again with ctx.resolveExternal. Empty once resolved.
           pendingExternal: ctx.resolveExternal ? [] : externalLinks };
}

/**
 * How many concentrations the program actually requires.
 *
 * Was hardcoded to 1, which marked genuinely optional concentrations
 * ("Political Science Concentrations (Optional)", "Astrophysics Concentration
 * (Optional)") as required. Read from the gateway heading and its intro prose.
 */
function concentrationMinOptions(blocks, gateways, concHeadings = new Map()) {
  let best = null;

  // A lexically-detected option states its own optionality in its heading —
  // "Astrophysics Concentration (Optional)" has no gateway to read it from.
  for (const idx of concHeadings.keys()) {
    if (gateways.some(g => g.headingIdx === idx)) continue;
    if (/\(\s*optional\s*\)/i.test(blocks[idx]?.text ?? '')) best = 0;
  }
  for (const gw of gateways) {
    const heading = blocks[gw.headingIdx];
    const parts = [heading.text];
    // The rule is usually stated in the paragraph between heading and list.
    let sib = heading.el.nextElementSibling;
    for (let n = 0; sib && n < 4; n++, sib = sib.nextElementSibling) {
      if (sib.tagName === 'P') parts.push(sib.text);
      if (sib.tagName === 'UL') break;
    }
    const text = parts.join(' ').replace(/\s+/g, ' ');

    // Order matters. BSBA reads "One concentration is required. A second
    // concentration is optional." — testing for "is optional" first matched
    // the SECOND sentence and marked the whole thing optional, so a required
    // choice silently became a suggestion. Require-clauses are checked before
    // optional ones, and the optional test refuses to match when it is
    // qualified by "second"/"additional".
    const OPTIONAL_UNQUALIFIED =
      /\b(?<!second\s)(?<!additional\s)concentrations?\s+(?:is|are)\s+optional\b/i;

    let v = null;
    if (/\(\s*optional\s*\)/i.test(heading.text)) v = 0;
    else if (/\btwo\s+concentrations?\s+(?:are\s+)?required\b/i.test(text)) v = 2;
    else if (/\bone\s+concentration\s+is\s+required\b/i.test(text)) v = 1;
    else if (/\brequired\s+concentration\b/i.test(text))              v = 1;
    else if (OPTIONAL_UNQUALIFIED.test(text))                          v = 0;
    else if (/\bconcentration\s+is\s+not\s+required\b/i.test(text))  v = 0;
    else if (/\b(?:pick|select|choose|complete)\s+one\b/i.test(text))  v = 1;
    else if (/\brequired\b/i.test(heading.text))  v = 1;

    if (v !== null) best = best === null ? v : Math.max(best, v);
  }
  // No explicit statement → keep the historical default rather than regress.
  return best === null ? 1 : best;
}
