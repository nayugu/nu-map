/**
 * major-verify.js — fidelity checks for scraped program requirements.
 *
 * ## Why this exists
 *
 * The only previous gate on program data, `check-major-integrity.js`, asks one
 * internal question: can every section still be satisfied after allocation?
 * It never compares the data to the catalog, so an entire degree could ship
 * with a fraction of its requirements and nothing would notice. That is not
 * hypothetical — before the 2026-08 parser rewrite, 82 undergraduate programs
 * were missing requirement tables and Journalism BA shipped 3 courses for a
 * 131 SH degree.
 *
 * ## Honest accounting of what "verified" can mean here
 *
 * Unlike NUPath — where the Registrar's Tableau dashboard is a genuinely
 * separate system from the catalog — **there is no second authoritative source
 * for degree requirements.** Degree Works and the CourseLeaf admin are
 * SSO-gated, Banner exposes no program endpoints, and the per-page PDF is the
 * same CourseLeaf render as the HTML. So this is internal-consistency
 * checking, not source triangulation, and must never be described to an
 * advisor as the latter.
 *
 * What we do have:
 *   1. the requirement tables      — the authority, and the thing under test
 *   2. tables present vs consumed  — self-consistency; catches dropped content
 *   3. the stated-total prose      — written separately from the tables
 *   4. the Sample Plan of Study    — see the warning below
 *   5. all-courses.json (Banner)   — a separate system, but only confirms a
 *                                    course code exists
 *
 * ## The Sample Plan of Study is a WITNESS, not a source
 *
 * It is one valid path through the degree, not the rule. That licenses exactly
 * one inference, in one direction: every course in it must be accounted for by
 * the parsed requirements, because the department asserts this set satisfies
 * the degree. It can prove we dropped content; it can NEVER prove we are
 * complete.
 *
 * The converse check — "every parsed requirement appears in the plan" — is
 * invalid and must not be added. The plan picks one branch of every choice, so
 * a requirement offering "one of A/B/C" shows only A, and absence from the
 * plan means nothing. For the same reason its TOTAL legitimately exceeds the
 * minimum, so comparing the two totals is catalog-vs-catalog and is recorded
 * as info only.
 *
 * ## Zero dependencies
 *
 * `.github/workflows/test.yml` runs the invariant job with no `npm install`,
 * so anything `test/invariant/` imports may use only Node builtins. HTML
 * parsing therefore happens once, in the scrapers, and everything here is a
 * pure function over committed JSON.
 */

import { DETAIL_EN, detailText } from '../../src/core/verificationRows.js';
export { DETAIL_EN, detailText };

/** Severity ordering, worst first. */
export const SEVERITY = ['high', 'medium', 'info'];

/** Verdicts, best first. See levelFor(). */
export const LEVELS = ['verified', 'partial', 'review', 'unverified'];


/**
 * What kind of program this is, and therefore which checks are meaningful.
 *
 * Measured across the corpus: 98% of undergraduate majors publish a Sample
 * Plan of Study (351 of 360), while **0%** of minors and 0% of graduate
 * certificates do, and only 11% of graduate programs. So a missing plan means
 * completely different things depending on the program:
 *
 *   - for an undergrad major it is anomalous and worth flagging
 *   - for a minor it is simply how minors are published
 *
 * Grading everything against the same absolute bar left all 172 minors
 * permanently yellow for a structural reason unrelated to their quality —
 * which is not a signal, just noise that makes minors look worse than majors.
 */
export function programKind(id, program) {
  if (/_minor$/.test(id)) return 'minor';
  if (/certificate/i.test(id) || /certificate/i.test(program?.name ?? '')) return 'certificate';
  if (id.startsWith('grad-majors/')) return 'grad';
  return 'major';
}

/** Is a sample plan of study expected to exist for this kind of program? */
export function expectsPlanOfStudy(kind) {
  return kind === 'major';
}

const courseKey = (subject, classId) => `${subject}${classId}`;

/** "CS3500" → "CS 3500". Nobody reads course keys unspaced. */
const pretty = k => String(k).replace(/^([A-Z]+)(\d.*)$/, '$1 $2');


/**
 * Walk a requirement tree, yielding every node.
 *
 * `exceptions` are traversed only when asked for. A RANGE's exceptions are
 * courses the range EXCLUDES — "MATH 3001 to MATH 4999 but not MATH 4000",
 * "DS 2500 or higher, except DS 4900" — so counting them as required inverts
 * their meaning. It also produced nonsense findings: CS+Math was reported as
 * requiring MATH 4000 and DS 4900 and missing both, when the catalog had
 * explicitly ruled them out.
 */
function* walk(node, { exceptions = false } = {}) {
  if (Array.isArray(node)) { for (const n of node) yield* walk(n, { exceptions }); return; }
  if (!node || typeof node !== 'object') return;
  yield node;
  const keys = exceptions ? ['requirements', 'courses', 'exceptions'] : ['requirements', 'courses'];
  for (const k of keys) {
    if (node[k]) yield* walk(node[k], { exceptions });
  }
}

/** Every named COURSE key in a program, including inside concentrations. */
export function courseKeysOf(program) {
  const keys = new Set();
  const roots = [
    ...(program.requirementSections ?? []),
    ...(program.concentrations?.concentrationOptions ?? []),
  ];
  for (const node of walk(roots)) {
    if (node.type === 'COURSE' && node.subject) keys.add(courseKey(node.subject, node.classId));
  }
  return keys;
}

/**
 * The subjects a program's own requirements draw on.
 *
 * Used to tell a dropped requirement from a suggestion. A department filling a
 * free-elective slot in its sample plan reaches for whatever it likes; a
 * requirement we failed to read is overwhelmingly in the program's own
 * discipline. RANGE nodes count too — a MATH range makes MATH in-discipline.
 */
export function requirementSubjects(program) {
  const subs = new Set();
  const roots = [
    ...(program.requirementSections ?? []),
    ...(program.concentrations?.concentrationOptions ?? []),
  ];
  for (const node of walk(roots)) {
    if ((node.type === 'COURSE' || node.type === 'RANGE') && node.subject) subs.add(node.subject);
  }
  return subs;
}


/** RANGE nodes, so plan-of-study courses matched by a pool count as explained. */
export function rangesOf(program) {
  const ranges = [];
  const roots = [
    ...(program.requirementSections ?? []),
    ...(program.concentrations?.concentrationOptions ?? []),
  ];
  for (const node of walk(roots)) {
    if (node.type === 'RANGE' && node.subject) {
      ranges.push({
        subject: node.subject,
        lo: node.idRangeStart ?? 0,
        hi: node.idRangeEnd ?? 9999,
        except: new Set((node.exceptions ?? []).map(e => courseKey(e.subject, e.classId))),
      });
    }
  }
  return ranges;
}

function matchedByRange(key, ranges) {
  const m = /^([A-Z]+)(\d+)$/.exec(key);
  if (!m) return false;
  const [, subject, num] = m;
  const n = parseInt(num, 10);
  return ranges.some(r => r.subject === subject && n >= r.lo && n <= r.hi && !r.except.has(key));
}

/**
 * Run every applicable check against one program.
 *
 * @param {object}  args
 * @param {object}  args.program     parsed.initial.json contents
 * @param {string}  args.id          stable program id, e.g. "majors/2026/…/slug"
 * @param {Set<string>} [args.courseIndex]  known course keys from catalog-courses.json —
 *   the file the planner actually loads, so an "unknown course" finding means the
 *   requirement genuinely cannot be ticked off in the app (see verify-majors.js)
 * @param {object}  [args.policy]    tolerances + allowlists
 * @returns {{level, score, counters, discrepancies, sourcesAvailable}}
 */
export function verifyProgram({ program, id, courseIndex = null, policy = {} }) {
  const d = [];
  const add = (check, severity, message, detail = []) =>
    d.push({ check, severity, message, ...(detail.length ? { detail: detail.slice(0, 12), overflow: Math.max(0, detail.length - 12) } : {}) });

  const meta      = program.metadata ?? {};
  const kind      = programKind(id, program);
  const isMinor   = kind === 'minor';
  const sections  = program.requirementSections ?? [];
  const concOpts  = program.concentrations?.concentrationOptions ?? [];
  const counters  = {};

  // ── 1. Parse coverage. Every table on the page must have been parsed or
  //       explicitly excluded. This is the check that catches dropped content,
  //       and it is an integer comparison with no false positives.
  const onPage   = meta.tablesOnPage;
  const consumed = meta.tablesConsumed;
  const excluded = meta.tablesExcluded ?? 0;
  if (Number.isFinite(onPage) && Number.isFinite(consumed)) {
    const unaccounted = onPage - consumed - excluded;
    counters.tablesUnaccounted = unaccounted;
    if (unaccounted > 0) {
      add('requirement-table-parity', 'high',
        `${unaccounted} of ${onPage} requirement tables on the catalog page were not read, so requirements are missing from this list`,
        (meta.unconsumedHeadings ?? []).map(h => ({ key: 'unreadSection', params: { section: h } })));
    }
  } else {
    counters.tablesUnaccounted = 0;
    add('requirement-table-parity', 'info', 'no parse-coverage counters recorded; re-run the scraper');
  }

  // ── 2. Internal markers must never reach the data.
  const leaked = [...walk([...sections, ...concOpts])].filter(n => n.type === '_CHOOSE').length;
  counters.leakedMarkers = leaked;
  if (leaked) add('choose-marker-leak', 'high',
    `${leaked} requirement(s) could not be interpreted and may display incorrectly`,
    [{ key: 'markerLeak' }]);

  // ── 3. Structure sanity.
  if (!sections.length && !concOpts.length) {
    add('empty-program', 'high',
      'no requirements could be read from this program at all',
      [{ key: 'emptyProgram' }]);
  }
  const dupSections = duplicates(sections.map(s => s.title));
  counters.duplicateSectionTitles = dupSections.length;
  if (dupSections.length) {
    add('duplicate-section-titles', 'medium',
      `${dupSections.length} section name(s) appear twice, and the two get merged — which can hide a requirement`,
      dupSections.map(t => ({ key: 'duplicateSection', params: { title: t } })));
  }
  const dupConc = duplicates(concOpts.map(c => c.title));
  if (dupConc.length) {
    add('duplicate-concentration-titles', 'high',
      'two concentrations share a name, so one of them cannot be selected',
      dupConc.map(t => ({ key: 'duplicateConc', params: { title: t } })));
  }

  // ── 4. Credit total.
  const total = program.totalCreditsRequired ?? 0;
  counters.zeroTotal = total > 0 ? 0 : 1;
  if (!total) {
    // Minors legitimately state no degree total.
    // Minors and certificates routinely state no degree total; for a full
    // program its absence is worth surfacing.
    add('missing-total-credits',
      (kind === 'minor' || kind === 'certificate') ? 'info' : 'medium',
      'the catalog page states no total credit requirement',
      [{ key: 'noTotal' }]);
  } else if (program.totalCreditsSource === 'plan-grid') {
    add('total-from-sample-plan', 'medium',
      'the credit total was taken from the sample four-year plan, not from a stated requirement',
      [{ key: 'totalFromPlan', params: { n: total } }]);
  }

  // ── 5. Every referenced course must exist in the catalog.
  if (courseIndex) {
    const unknown = [...courseKeysOf(program)].filter(k => !courseIndex.has(k)).sort();
    counters.unknownCourses = unknown.length;
    if (unknown.length) {
      // This is a gap in OUR course list, not a defect in the program, and it
      // is reported as such: the consequence a user can act on is that the
      // requirement will never tick off in the planner. Never red on its own.
      add('unknown-course', unknown.length > 3 ? 'medium' : 'info',
        `${unknown.length} course(s) this program requires are absent from our course list, so those requirements can never be ticked off in the planner`,
        unknown.map(k => ({ key: 'unknownCourse', params: { course: pretty(k) } })));
    }
  }

  // ── 6. Sample-plan witness. ONE DIRECTION ONLY — see the module docblock.
  const plan = meta.planOfStudyCourses;
  if (Array.isArray(plan) && plan.length) {
    const known  = courseKeysOf(program);
    const ranges = rangesOf(program);
    const allow  = new Set(policy.universitywide ?? []);
    // Pattern forms too: the first-year seminar is <SUBJ>1000 under every
    // college's own subject code, so enumerating it literally is hopeless.
    const allowRe = (policy.universitywidePatterns ?? []).map(p => new RegExp(p));
    const excused = k => allow.has(k) || allowRe.some(re => re.test(k));
    const unexplained = plan
      .filter(k => !known.has(k) && !excused(k) && !matchedByRange(k, ranges))
      .sort();
    counters.planUnexplained = unexplained.length;
    // ── Grade by attributability, not by ratio ────────────────────────────
    //
    // A sample plan is an EXAMPLE. A course in it that nothing requires has two
    // very different explanations, and a raw ratio cannot tell them apart:
    //
    //   (a) we failed to read a requirement           — our defect
    //   (b) the department suggested a course that     — perfectly correct
    //       isn't required: a free elective, one pick
    //       from an open pool, a recommended extra
    //
    // Measured across the corpus, 41 of 75 flagged programs had EVERY unmatched
    // course outside the program's own discipline — POLS BA's were ENVR, the
    // physics degrees' were CHEM, and MATH 1215 (a common NUpath quantitative
    // pick) recurred across unrelated majors. Calling those red asserted a
    // fault we cannot demonstrate.
    //
    // Ratio was also a poor discriminator on its own: history_ba was red at
    // 3/10 with only 2 in-discipline, while physics_and_music sat at medium
    // with all 6 unmatched courses in-discipline.
    //
    // So only in-discipline courses count against a program. This is safe
    // because requirement-table-parity independently catches an actually
    // dropped table — including one full of out-of-subject supporting courses
    // — and that check IS attributable to us and IS graded high.
    const subs = requirementSubjects(program);
    const subjOf = k => /^([A-Z]+)/.exec(k)?.[1];
    const inSubject  = unexplained.filter(k => subs.has(subjOf(k)));
    const outSubject = unexplained.filter(k => !subs.has(subjOf(k)));
    counters.planUnexplainedInSubject = inSubject.length;

    const why = [
      ...inSubject.map(k  => ({ key: 'planMissingCourse',  params: { course: pretty(k) } })),
      ...outSubject.map(k => ({ key: 'planLikelyElective', params: { course: pretty(k) } })),
    ];

    const heavy = inSubject.length >= (policy.planInSubjectHigh ?? 5)
               || inSubject.length / plan.length >= (policy.planInSubjectHighRatio ?? 0.25);

    if (inSubject.length && heavy) {
      add('plan-witness-unaccounted', 'high',
        `${inSubject.length} courses in this program's own subject are in the catalog's four-year plan but required by nothing here`, why);
    } else if (inSubject.length) {
      add('plan-witness-unaccounted', 'medium',
        `${inSubject.length} of ${plan.length} courses in the catalog's four-year plan aren't required by anything here — they may be electives, or a requirement we missed`, why);
    } else if (outSubject.length) {
      add('plan-witness-unaccounted', 'info',
        `${outSubject.length} course(s) in the four-year plan aren't required here; all sit outside this program's subjects, so they read as electives`, why);
    }
  } else {
    counters.planUnexplained = 0;
    // Only worth saying when a plan was expected. 98% of undergrad majors
    // publish one; minors and certificates never do.
    if (expectsPlanOfStudy(kind)) {
      add('no-sample-plan', 'medium',
        'this program publishes no sample four-year plan, so our strongest check could not run',
        [{ key: 'noPlanUnusual' }]);
    }
  }

  const sourcesAvailable = [
    'requirement-tables',
    ...(total ? ['stated-total'] : []),
    ...(Array.isArray(plan) && plan.length ? ['plan-of-study'] : []),
    ...(courseIndex ? ['course-catalog'] : []),
  ];

  return {
    kind,
    level: levelFor(d),
    score: scoreFor(d, counters),
    counters,
    sourcesAvailable,
    discrepancies: d.sort((a, b) => SEVERITY.indexOf(a.severity) - SEVERITY.indexOf(b.severity)),
  };
}

function duplicates(list) {
  const seen = new Set(), dup = new Set();
  for (const t of list) (seen.has(t) ? dup : seen).add(t);
  return [...dup];
}

/**
 * The verdict shown to advisors.
 *
 * The sample plan can only ever FAIL a program, never certify one, so
 * "verified" is defined by checks passing plus the strongest check having been
 * runnable — not by counting the plan as a corroborating source.
 */
export function levelFor(discrepancies) {
  // Severity carries the meaning, so each colour says something distinct:
  //   red    something is likely wrong or missing
  //   yellow nothing looks wrong, but a check was inconclusive
  //   green  every check that applies to this kind of program passed
  //
  // Crucially this is graded against what is CHECKABLE for the program's kind,
  // not an absolute bar. A minor that passes everything applicable is green;
  // it is not marked down for lacking a sample plan that minors never have.
  if (discrepancies.some(x => x.severity === 'high'))   return 'review';
  if (discrepancies.some(x => x.severity === 'medium')) return 'partial';
  return 'verified';
}

/** 0–1, for RANKING THE TRIAGE REPORT only. Never shown to students. */
function scoreFor(discrepancies, counters) {
  let s = 1;
  for (const x of discrepancies) {
    s -= x.severity === 'high' ? 0.4 : x.severity === 'medium' ? 0.15 : 0.02;
  }
  if (counters.tablesUnaccounted > 0) s -= 0.2;
  return Math.max(0, Math.round(s * 100) / 100);
}
