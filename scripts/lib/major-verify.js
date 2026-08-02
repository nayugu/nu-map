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

/** Walk a requirement tree, yielding every node. */
function* walk(node) {
  if (Array.isArray(node)) { for (const n of node) yield* walk(n); return; }
  if (!node || typeof node !== 'object') return;
  yield node;
  for (const k of ['requirements', 'courses', 'exceptions']) {
    if (node[k]) yield* walk(node[k]);
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
 * @param {Set<string>} [args.courseIndex]  known course keys from all-courses.json
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
        `${unaccounted} of ${onPage} requirement tables on the catalog page were neither parsed nor excluded — this program is missing requirements`);
    }
  } else {
    counters.tablesUnaccounted = 0;
    add('requirement-table-parity', 'info', 'no parse-coverage counters recorded; re-run the scraper');
  }

  // ── 2. Internal markers must never reach the data.
  const leaked = [...walk([...sections, ...concOpts])].filter(n => n.type === '_CHOOSE').length;
  counters.leakedMarkers = leaked;
  if (leaked) add('choose-marker-leak', 'high', `${leaked} internal _CHOOSE marker(s) escaped into the output`);

  // ── 3. Structure sanity.
  if (!sections.length && !concOpts.length) {
    add('empty-program', 'high', 'no requirement sections and no concentrations');
  }
  const dupSections = duplicates(sections.map(s => s.title));
  counters.duplicateSectionTitles = dupSections.length;
  if (dupSections.length) {
    add('duplicate-section-titles', 'medium',
      `${dupSections.length} section title(s) appear more than once; the runtime merges them, which can hide a requirement`, dupSections);
  }
  const dupConc = duplicates(concOpts.map(c => c.title));
  if (dupConc.length) {
    add('duplicate-concentration-titles', 'high',
      'concentration titles must be unique — they are the key the UI and MCP use to select one', dupConc);
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
      'the page states no total credit requirement we recognise');
  } else if (program.totalCreditsSource === 'plan-grid') {
    add('total-from-sample-plan', 'medium',
      `total ${total} came from the Sample Plan of Study, which is one path and may exceed the true minimum`);
  }

  // ── 5. Every referenced course must exist in the catalog.
  if (courseIndex) {
    const unknown = [...courseKeysOf(program)].filter(k => !courseIndex.has(k)).sort();
    counters.unknownCourses = unknown.length;
    if (unknown.length) {
      // Usually our course catalog missing a subject (LAW, MUST) rather than
      // the program being wrong — real, but not evidence of missing
      // requirements, so it must not paint a program red on its own.
      add('unknown-course', unknown.length > 3 ? 'medium' : 'info',
        `${unknown.length} referenced course(s) are absent from the course catalog, so they can never be satisfied`, unknown);
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
    const ratio = 1 - unexplained.length / plan.length;
    if (ratio < (policy.planCoverageHigh ?? 0.80)) {
      add('plan-witness-unaccounted', 'high',
        `${unexplained.length} of ${plan.length} courses in the catalog's own sample plan match nothing in the parsed requirements — sections are likely incomplete`, unexplained);
    } else if (ratio < (policy.planCoverageMedium ?? 0.95)) {
      add('plan-witness-unaccounted', 'medium',
        `${unexplained.length} of ${plan.length} sample-plan courses are unaccounted for`, unexplained);
    }
  } else {
    counters.planUnexplained = 0;
    // Only worth saying when a plan was expected. 98% of undergrad majors
    // publish one; minors and certificates never do.
    if (expectsPlanOfStudy(kind)) {
      add('no-sample-plan', 'medium',
        'this program publishes no sample plan of study, so we could not confirm nothing is missing');
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
