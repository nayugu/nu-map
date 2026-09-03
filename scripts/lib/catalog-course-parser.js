/**
 * catalog-course-parser.js — one course-block reader for every catalog edition.
 *
 * Extracted verbatim from scrape-catalog.js for the same reason
 * catalog-program-parser.js was extracted from the two program scrapers: a
 * second caller appeared. Scraping a frozen archive edition
 * (catalog.northeastern.edu/archive/{start}-{end}/) reads the same markup, and
 * a byte-identical copy of this function in a second script is how a fix lands
 * in one path and not the other.
 *
 * Only two things changed in the move, and a body-level diff against the
 * original confirms there is nothing else:
 *
 *   1. `SUBJECT` was a module-level global in scrape-catalog.js, read once to
 *      honour `--subject FOO`. It is now `opts.subjectFilter`.
 *   2. The three hard-space regexes are hoisted into the NBSP constant.
 *
 * Be careful with (2), and note that it is a small REGRESSION, not a cleanup.
 * The original wrote the six-character escape sequence for U+00A0 properly;
 * the constant below holds the raw character instead, because that escape does
 * not survive being typed through this repo's editing tools. The two are
 * equivalent to the regex engine — the same single character matches either
 * way — but a raw U+00A0 is INVISIBLE in an editor and one whitespace cleanup
 * away from silently becoming an ordinary space, which would quietly stop
 * stripping hard spaces out of every title and description. Naming it once,
 * here, beside this comment, is what keeps that risk maintainable: do not
 * inline it back to the call sites, and if you can write the escape, prefer it.
 *
 * For reference, NBSP matches exactly this one character, shown here between
 * backticks so it is at least visible as a gap: ` `
 *
 * ## Two markup eras
 *
 * The archive is not uniform, and the boundary is at the 2021-2022 edition
 * (measured 2026-09-03 on /course-descriptions/cs/ across seven editions):
 *
 *   2016-2017 … 2020-2021   title + credits + description ONLY.
 *                           Zero `Prerequisite(s):` and zero `Attribute(s):`
 *                           lines exist on the page. Credits print bare:
 *                             "CS 1100.  Computer Science and Its Applications.  4 Hours."
 *
 *   2021-2022 … live        credits parenthesised, plus Prerequisite(s),
 *                           Corequisite(s) and Attribute(s):
 *                             "CS 1100.  Computer Science and Its Applications.  (4 Hours)"
 *
 * That distinction is load-bearing and must never be flattened. An empty
 * `prereqs` array from a 2020 page means "this edition did not publish
 * prerequisites", NOT "this course has none" — the same difference as `false`
 * versus absent in term-history, and the same class of bug: a planner that
 * reads unpublished-as-none will happily schedule a course before the courses
 * it actually requires. Callers get `fidelityOfEdition` so they can tell the
 * two apart, and nothing downstream may infer absence from an empty field on a
 * `descriptive` record.
 *
 * NOTE: the title regex below accepts only the PARENTHESISED credit form, so
 * on a pre-2022 page it matches nothing and the page yields zero courses. That
 * is the current, correct behaviour for a live scrape and is why reading the
 * descriptive era needs an explicit era-aware change rather than being assumed
 * to work.
 */
import { parse as parseHTML } from "node-html-parser";
import { parseRepeatability } from "../../src/adapters/northeastern/repeatability.js";
import { parseNUPath, findAttributeText } from "./nupath.js";
import { extractConcurrentCourses, parsePrereqText, parseCoreqText, hasPrereqSignal } from "./prereq-parse.js";
import { parseDescriptionGpaGate } from "../../src/adapters/northeastern/gpaGate.js";
import { parseDescriptionPrereq } from "../../src/adapters/northeastern/descriptionPrereq.js";
import { mergeDescriptionCoreqs } from "../../src/adapters/northeastern/descriptionCoreq.js";

/** CourseLeaf renders hard spaces in title and body text as U+00A0. */
const NBSP = / /g;

// Re-exported, not defined here. They live in catalog-fidelity.js because this
// module imports node-html-parser and the unit/invariant CI jobs run with no
// `npm ci` — anything reaching fidelity through this file drags an uninstalled
// package into a dependency-free job. Existing callers are unaffected.
export { FIRST_FULL_FIDELITY_EDITION, fidelityOfEdition } from "./catalog-fidelity.js";

/**
 * Parse one subject page into course records.
 *
 * @param {string} html
 * @param {string} subjectCode        the subject the page was fetched for (informational;
 *                                    the authoritative subject comes off each title line)
 * @param {object} [opts]
 * @param {string|null} [opts.subjectFilter]  --subject FOO: keep only this subject.
 *                                            Was the module-global SUBJECT in scrape-catalog.js.
 * @returns {Array<object>} course records
 */
export function parseSubjectPage(html, subjectCode, opts = {}) {
  const SUBJECT = opts.subjectFilter ?? null;

  const root   = parseHTML(html);
  const blocks = root.querySelectorAll(".courseblock, [class*='courseblock']");
  if (!blocks.length) return [];

  const courses = [];

  for (const block of blocks) {
    // ── Title line: e.g. "CS 1800. Discrete Structures. (4 Hours)"  ──
    const titleEl = block.querySelector(
      ".courseblocktitle, .cb_title, .course-title, h3"
    );
    if (!titleEl) continue;
    const rawTitle = titleEl.textContent.replace(NBSP, " ").trim();

    // Parse "SUBJ 1234. Title. (N Hours)"  or  "SUBJ 1234 Title N SH"
    // Credit hours come in four shapes, and only two were accepted:
    //   (4 Hours)      fixed
    //   (1-4 Hours)    a range
    //   (2.5 Hours)    fractional — pharmacy labs and similar
    //   (1,2 Hours)    a discrete choice between values
    // The last two were rejected outright, silently dropping 106 courses from
    // the catalog — including CS 4991, which several programs require. Found
    // because verify-majors flagged those programs as requiring a course we
    // had no record of.
    const titleMatch = rawTitle.match(
      /^([A-Z]{2,6})\s+(\d{4}[A-Z]?)\.\s+(.+?)\.\s*\((\d+(?:\.\d+)?(?:\s*[-–,]\s*\d+(?:\.\d+)?)*)\s+[Hh]ours?\)/
    ) || rawTitle.match(
      /^([A-Z]{2,6})\s+(\d{4}[A-Z]?)\s+(.+?)\s+(\d+(?:\.\d+)?)\s+SH/i
    );

    if (!titleMatch) continue;

    const [, subject, number, title, credStr] = titleMatch;
    if (SUBJECT && subject !== SUBJECT) continue;

    // Parse credits — preserve ranges: store min in `credits` (matching SearchNEU convention)
    // and `creditsMax` only when different (variable-credit course, e.g. "1-4 Hours").
    // Take the low and high of whatever the page listed: "1-4" and "1,2" and
    // "2.5" all reduce to a min and a max. parseFloat, not parseInt — half-
    // credit labs are real and truncating them to 0 would be worse than
    // dropping the course.
    const parts = credStr.split(/[-–,]/).map(n => parseFloat(n.trim())).filter(n => !isNaN(n));
    const cMin = parts.length ? Math.min(...parts) : 0;
    const cMax = parts.length ? Math.max(...parts) : 0;
    const credits    = cMin;
    const creditsMax = cMax !== cMin ? cMax : undefined;

    // ── Description ──
    // NOTE: do NOT fall back to bare 'p' — the first <p> in the block is the
    // courseblocktitle, not the description. Stick to specific class selectors.
    const descEl = block.querySelector(
      ".courseblockdesc, .cb_desc, .course-description, .courseblock-desc"
    );
    const description = descEl
      ? descEl.textContent.replace(NBSP, " ").replace(/\s+/g, " ").trim()
      : "";

    // ── NUPath ──
    // Fallback source only: the catalog prints 11 of the 13 codes as
    // Attribute(s) lines and never WF or WD. Tableau is authoritative, and the
    // merge below keeps a previous non-empty nuPath rather than letting an
    // empty catalog read overwrite it.
    //
    // The line is a plain .courseblockextra with no distinguishing class, so
    // it has to be found by its label text — see findAttributeText().
    const nuPath = parseNUPath(findAttributeText(
      block.querySelectorAll(".courseblockextra, p").map(el => el.textContent)
    ));

    // ── Prereqs / coreqs (text extraction) ──
    const extraEls = block.querySelectorAll('.courseblockextra, p');
    let prereqText = '';
    let coreqText = '';

    for (const el of extraEls) {
      const text = el.textContent.replace(NBSP, ' ').trim();
      if (/prerequisite\(s\)\s*:/i.test(text)) {
        prereqText = text.replace(/.*prerequisite\(s\)\s*:\s*/i, '').trim();
      }
      if (/corequisite\(s\)\s*:/i.test(text)) {
        coreqText = text.replace(/.*corequisite\(s\)\s*:\s*/i, '').trim();
      }
    }

    // ── Extract concurrent courses from prereq text before parsing ──
    const { cleaned: cleanedPrereq, concurrent } = extractConcurrentCourses(prereqText);

    // ── Schedule type: explicit element → number suffix → title heuristic ──
    const scheduleType = (() => {
      const schedEl = block.querySelector('[class*="schedule"]');
      if (schedEl?.textContent.trim()) return schedEl.textContent.trim();
      if (/L$/i.test(number)) return "Lab";
      const t = rawTitle.toLowerCase();
      if (t.includes("lab")) return "Lab";
      if (t.includes("seminar")) return "Seminar";
      if (t.includes("studio")) return "Studio";
      if (t.includes("independent") || t.includes("directed study")) return "Individual Instruction";
      return "Lecture";
    })();

    // ── Repeatability: "May be repeated …" lives inside cb_desc (verified
    // against live pages — never a separate courseblockextra), so the
    // description text is its canonical source.
    const repeat = parseRepeatability(description);

    courses.push({
      subject,
      number,
      title,
      scheduleType,
      credits,
      ...(creditsMax !== undefined ? { creditsMax } : {}),
      ...(repeat ? {
        repeatable: true,
        ...(repeat.max   != null ? { repeatMax:   repeat.max }   : {}),
        ...(repeat.maxSH != null ? { repeatMaxSH: repeat.maxSH } : {}),
      } : {}),
      nuPath,
      sections: [],      // catalog has no section/term data
      description,
      // A GPA gate stated in the description (3 courses corpus-wide) —
      // evaluated only against grades the user entered, like minGrade.
      ...(parseDescriptionGpaGate(description) != null
        ? { minGPA: parseDescriptionGpaGate(description) } : {}),
      // The labelled line UNION the description's "Requires concurrent
      // registration in …" sentence. The catalog is uneven about which one it
      // uses: PHYS 1152 has no Corequisite(s) line at all and only the
      // sentence, so the lab sat outside its own lecture/lab/seminar triple.
      // See src/adapters/northeastern/descriptionCoreq.js — the reader refuses
      // anything that is not a plain conjunction of course codes.
      coreqs:  mergeDescriptionCoreqs(
        [...(coreqText ? parseCoreqText(coreqText) : []), ...concurrent],
        description, `${subject}${number}`),
      // Parse when the prereq names a course OR carries a recognized non-course
      // phrase (e.g. a grad course whose only prereq is "Graduate program
      // admission") — otherwise a phrase-only prereq is dropped before it can
      // become a { note } leaf.
      //
      // When there is no Prerequisite(s) line at all, fall back to the
      // description: 33 courses state their requirement only in prose, MATH
      // 1342 (Calculus 2 → Calculus 1) among them. The labelled field always
      // wins; this never overrides it.
      prereqs: hasPrereqSignal(cleanedPrereq)
        ? parsePrereqText(cleanedPrereq)
        : (parseDescriptionPrereq(description) ?? []),
    });
  }

  return courses;
}
