// ═══════════════════════════════════════════════════════════════════
// COURSE RATINGS — first-party workload and difficulty, and the rules
// for what may be shown about them.  (pure, no React, no deps)
//
// Two quantities, deliberately kept apart:
//   hours      how much of a week the course actually consumed
//   difficulty how hard it felt, 1–5
//
// Only `hours` composes.  It is additive across a semester, so it is
// the one that answers a planner's real question ("is this term
// survivable?").  `difficulty` is ordinal and confounded by who taught
// it, so it is a browse signal and never summed.
//
// ── Why hours is TOTAL time, not TRACE's "outside class" ──
// NEU's own TRACE survey asks for hours "outside scheduled class
// meeting times", which is undefined for asynchronous courses — its
// 2025 revision had to bolt on "The course had not scheduled class
// meetings" to patch exactly that.  Total time is well defined for
// every course, needs no mental subtraction from the respondent, and
// is the only version that can be summed over a term.
// Conversion back to TRACE's basis is deterministic and lossless:
// `outside = total − contactHours`, and contact hours are known per
// course from credits and Banner meeting times.  See traceOutsideHours.
//
// ── Why collection is fine-grained but publication is coarse ──
// We store the integer a student actually chose, and publish buckets.
// Collecting buckets would force every mean to rest on a midpoint
// assumption (everyone in "14–18" treated as 16) — the precise defect
// that makes third-party aggregators print figures like "6.21 hours"
// from data that was never finer than a five-way band.  Integers make
// the mean real.  Buckets at publication time are what keep a small
// sample non-disclosive, and they are the reason a course with six
// responses never shows a decimal.
//
// ── Why the top of the scale is open ──
// HOURS_CAP means "this many OR MORE".  A closed scale would censor
// the long right tail, and that tail is the single most useful thing
// this feature can surface: the courses worth warning someone about
// are exactly the ones that break the top of the range.  Any mean
// computed over a sample containing a capped value is therefore a
// LOWER BOUND, and aggregate() marks it as such rather than quietly
// understating it.
// ═══════════════════════════════════════════════════════════════════

/**
 * Difficulty is 1–5 in half-steps, matching the scale students already
 * know from third-party rating sites.  Never averaged into hours.
 *
 * The floor is 1, not 0, for one reason: RateMyProfessors publishes
 * difficulty on 1–5, and cross-checking first-party numbers against it
 * is the only external validation this field will ever have.  Half-steps
 * do not break that (RMP's own published figures are decimal averages),
 * but a 0 would — it adds a category the comparison source cannot
 * express, and "no difficulty at all" is not meaningfully distinct from
 * the 1 that already means "very easy".
 */
export const DIFFICULTY_MIN  = 1;
export const DIFFICULTY_MAX  = 5;
export const DIFFICULTY_STEP = 0.5;

/**
 * Hours per week, as integers.  HOURS_CAP is a bucket, not a value:
 * selecting it means "20 or more".  See the censoring note above.
 *
 * 20 rather than a higher ceiling, from the corpus: only 0.81% of seats
 * sit in courses whose NEU-policy ceiling (contact hours + 3h work per
 * credit) even reaches 20 h/week, and 0.09% reach 25.  The ones that do
 * are 6 SH nursing and architecture studios — real, and still catchable,
 * because the top bucket stays open.  Stopping at 20 buys resolution
 * where the mass actually is: 21 slider stops instead of 26, on the
 * field the whole feature turns on.
 */
/**
 * The floor is 1, not 0 — a consequence of this field meaning TOTAL time.
 *
 * Under TRACE's definition (hours OUTSIDE scheduled meetings) a 0 is a real
 * and common answer: plenty of courses ask nothing of you between classes.
 * Once class time is included, 0 stops being reachable — a course you
 * attended at all consumed more than none of your week, and one you never
 * attended is one you would not be rating. Leaving 0 on the scale bought
 * nothing and cost the thing that matters: it sits at the slider's floor,
 * so a stray tap on the track's left edge enters a real answer of 0 and
 * drags the course's mean down with it.
 *
 * "No answer" therefore has exactly one representation — null — reached by
 * not touching the control or by clearing it. There is deliberately no
 * third "N/A" state: two ways to say nothing is how the two drift apart.
 */
export const HOURS_MIN = 1;
export const HOURS_CAP = 20;

// ── Term length: why a stored figure is not the figure reported ────
//
// Hours per week is a PRESENTATION. The quantity that actually stays put
// when a course moves between terms is the TOTAL work it asks for — same
// credits, same outcomes, same credit-hour obligation — and the weekly
// rate is only that total divided by however many weeks the registrar
// gave it.
//
// Measured from our own derive-term-windows output (and cross-checked
// against Banner's pinned dates): fall 14.6 weeks, spring 15.1, and both
// half-summers 7.1. A summer section is therefore ~2.04x the weekly rate
// of the same course in the fall, for identical total work.
//
// So every reported figure is converted on the way in to "hours per week
// as if this were a standard-length term", pooled there, and converted
// back out for whichever term is being asked about. Pooling in a common
// unit is what lets summer and fall ratings share one sample — and with
// only ~14% of courses clearing the disclosure floor at realistic
// participation, splitting the sample by term instead would be fatal.

/** The reference term: fall, the modal semester. */
export const STANDARD_WEEKS = 14.6;

/**
 * A reported weekly rate → the standard-term weekly rate that is stored
 * and pooled. A summer report is scaled DOWN, because those hours were
 * crammed into half the weeks.
 */
export function toStandardWeekly(reportedWeekly, weeks) {
  if (!Number.isFinite(reportedWeekly)) return null;
  if (!Number.isFinite(weeks) || weeks <= 0) return reportedWeekly;
  return reportedWeekly * (weeks / STANDARD_WEEKS);
}

/**
 * A pooled standard-term rate → what it means in a term of `weeks`
 * length. This is the number to show beside a course sitting in a
 * specific semester of someone's plan: the same course reads ~8 h/wk in
 * the fall and ~16 h/wk in Summer A.
 */
export function weeklyInTerm(standardWeekly, weeks) {
  if (!Number.isFinite(standardWeekly)) return null;
  if (!Number.isFinite(weeks) || weeks <= 0) return standardWeekly;
  return standardWeekly * (STANDARD_WEEKS / weeks);
}

/** The invariant itself, for anywhere that wants to state it outright. */
export function totalHoursOf(standardWeekly) {
  return Number.isFinite(standardWeekly)
    ? standardWeekly * STANDARD_WEEKS
    : null;
}

/**
 * Publication buckets for hours.  Roughly log-spaced — finest at the
 * low end, where the mass sits: 4 SH courses are 64.5% of all seats
 * and carry ~3.3 h/wk of scheduled class time, while 1 SH labs and
 * recitations are another 15.2% and land near the floor.  The bands
 * have to stretch from a one-credit lab to a course that eats a
 * working week, so even spacing would waste most of the scale.
 */
export const HOURS_BUCKETS = [
  { lo: 1,  hi: 3,        key: "1-3"   },
  { lo: 4,  hi: 6,        key: "4-6"   },
  { lo: 7,  hi: 9,        key: "7-9"   },
  { lo: 10, hi: 13,       key: "10-13" },
  { lo: 14, hi: 19,       key: "14-19" },
  { lo: 20, hi: Infinity, key: "20+"   },
];

/**
 * Disclosure floors.
 *
 * MIN_N_DISPLAY is 5 because that is Northeastern's OWN anonymity rule:
 * TRACE automatically excludes any section with fewer than five
 * registered students.  Matching the institution's published threshold
 * is worth more than a number we would otherwise have to defend.
 *
 * MIN_N_STATS is higher because a mean and a spread published together
 * are a reconstruction vector: at n=2 they determine both values
 * exactly, and n=3 is often solvable.  Below this floor we publish a
 * coarse tier and nothing numeric.
 */
export const MIN_N_DISPLAY = 5;
export const MIN_N_STATS   = 10;

/**
 * A floor on the POPULATION, not the sample.
 *
 * MIN_N_DISPLAY guards against too few responses. It does nothing about
 * too few students: five answers from a class of six means the raters are
 * very nearly everyone, so a classmate who knows their own answer — and
 * plausibly a friend's — can narrow the rest sharply. The sample looks
 * respectable and the anonymity is gone.
 *
 * Northeastern's own answer is the same shape: TRACE automatically
 * excludes any section with fewer than five registered students. Ten,
 * because we pool across sections and terms rather than reporting one
 * section, so the population that a published figure draws on should be
 * comfortably larger than the section floor.
 */
export const MIN_ENROLMENT = 10;

/** Coarse tiers, used between MIN_N_DISPLAY and MIN_N_STATS. Keys are
    locale keys, never user-facing text — this module stays pure. */
export const HOURS_TIERS      = ["light", "moderate", "heavy"];
export const DIFFICULTY_TIERS = ["easy", "moderate", "hard"];

// ── Validation ─────────────────────────────────────────────────────
// Every field is independently optional.  A rating carrying only hours
// is valid and counts toward the hours aggregate alone; this is why
// aggregate() derives a separate n per field rather than one per row.
// `null` means "not answered" and must never be coerced to 0 — for
// hours, 0 is a real answer ("I never worked on this outside class").

/** @returns {boolean} whether a difficulty value is storable.
    `d * 2` being an integer is the half-step check — it admits 3 and 3.5
    and rejects 3.25, without any float tolerance to tune. */
export function isValidDifficulty(d) {
  return typeof d === "number" && Number.isFinite(d)
    && d >= DIFFICULTY_MIN && d <= DIFFICULTY_MAX
    && Number.isInteger(d * 2);
}

/** @returns {boolean} whether an hours value is storable. */
export function isValidHours(h) {
  return h === null || h === undefined
    ? false
    : Number.isInteger(h) && h >= HOURS_MIN && h <= HOURS_CAP;
}

/**
 * Normalize one submitted rating, dropping anything unanswered or
 * malformed rather than guessing.  Returns null when the row carries
 * no usable signal at all, so an untouched course row never becomes a
 * phantom response.
 *
 * @param {{courseId:string, instructor?:string|null,
 *          difficulty?:number|null, hours?:number|null}} raw
 * @returns {{courseId:string, instructor:string|null,
 *            difficulty:number|null, hours:number|null}|null}
 */
export function normalizeRating(raw) {
  if (!raw || typeof raw.courseId !== "string" || !raw.courseId) return null;
  const difficulty = isValidDifficulty(raw.difficulty) ? raw.difficulty : null;
  const hours      = isValidHours(raw.hours)           ? raw.hours      : null;
  if (difficulty === null && hours === null) return null;
  const instructor = typeof raw.instructor === "string" && raw.instructor
    ? raw.instructor
    : null;
  return { courseId: raw.courseId, instructor, difficulty, hours };
}

// ── Buckets and tiers ──────────────────────────────────────────────

/**
 * Bucket index for an hours value, or -1 if it is not on the scale.
 *
 * Deliberately looser than isValidHours: that guards what a PERSON may
 * enter (a whole number, 1–20), while bucketing is a display job applied
 * to POOLED figures, which are term-normalized and therefore fractional.
 * Two different questions, so two different checks — conflating them was
 * what made normalized values silently fall out of every histogram.
 */
export function hoursBucket(h) {
  if (!Number.isFinite(h) || h < HOURS_MIN) return -1;
  // Scan DOWN for the first band whose floor it clears, so each band is
  // [lo, next lo) and the scale is total over the reals. Testing
  // `lo <= h <= hi` with integer bounds leaves gaps — 3.89 belongs to no
  // band at all — and any "fell through" fallback then has to invent an
  // answer. The obvious one, the last band, silently reported a
  // three-hour course as 20+.
  for (let i = HOURS_BUCKETS.length - 1; i >= 0; i--) {
    if (h >= HOURS_BUCKETS[i].lo) return i;
  }
  return -1;
}

/**
 * Collapse total hours onto TRACE's basis so first-party numbers can be
 * validated against a TRACE sample.  TRACE asks only about time spent
 * OUTSIDE scheduled meetings, so the course's contact hours come off.
 * Clamped at 0: a student may legitimately report less total time than
 * the course nominally meets (they skipped class), and a negative
 * "outside" figure would be meaningless.
 *
 * @param {number} totalHours   what the student reported
 * @param {number} contactHours scheduled class time per week
 * @returns {number|null}
 */
export function traceOutsideHours(totalHours, contactHours) {
  if (!isValidHours(totalHours)) return null;
  const c = Number.isFinite(contactHours) ? contactHours : 0;
  return Math.max(0, totalHours - c);
}

/** Tier for a mean hours figure — the coarse band shown at low n. */
export function hoursTier(mean) {
  if (!Number.isFinite(mean)) return null;
  if (mean < 7)  return "light";
  if (mean < 14) return "moderate";
  return "heavy";
}

/** Tier for a mean difficulty figure. */
export function difficultyTier(mean) {
  if (!Number.isFinite(mean)) return null;
  if (mean < 2.5) return "easy";
  if (mean < 3.5) return "moderate";
  return "hard";
}

// ── Aggregation ────────────────────────────────────────────────────

/** Sample mean and standard deviation, or nulls when undefined.
    Uses the n−1 denominator: these are samples of a course's students,
    not the population. sd is null at n=1 where it is undefined. */
function momentsOf(values) {
  const n = values.length;
  if (n === 0) return { n: 0, mean: null, sd: null };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { n, mean, sd: null };
  const varc = values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1);
  return { n, mean, sd: Math.sqrt(varc) };
}

/**
 * Aggregate raw ratings for one subject (a course, or a course+instructor
 * pair — the shape is identical either way).
 *
 * Returns the FULL picture including values below the disclosure floors.
 * Deciding what may be shown is publicView()'s job, deliberately kept
 * separate so the thresholds live in exactly one place and an aggregate
 * can be inspected in tests without being publishable.
 *
 * `hours` on each rating is the weekly rate as REPORTED; `weeks` is the
 * length of the term it was reported for. Everything pooled and returned
 * is in standard-term units — convert with weeklyInTerm() to show it
 * against a particular semester.
 *
 * @param {Array<{difficulty:number|null, hours:number|null, weeks?:number}>} ratings
 */
export function aggregate(ratings) {
  const list = Array.isArray(ratings) ? ratings : [];
  const diffVals  = [];
  const hourVals  = [];
  const hourHist  = new Array(HOURS_BUCKETS.length).fill(0);
  const diffHist  = new Array(DIFFICULTY_MAX - DIFFICULTY_MIN + 1).fill(0);
  let censored = 0;

  for (const r of list) {
    // Hours are pooled in standard-term units. A rating carrying `weeks`
    // is a raw report from a term of that length and gets converted; one
    // without is already standard (or comes from a caller that has no
    // term to offer, in which case treating it as standard is the only
    // honest option — it is not evidence about summer either way).
    const rawHours = r?.hours;
    const stdHours = Number.isFinite(r?.weeks)
      ? toStandardWeekly(rawHours, r.weeks)
      : rawHours;

    if (isValidDifficulty(r?.difficulty)) {
      diffVals.push(r.difficulty);
      // The MEAN keeps the half-step precision; the published HISTOGRAM is
      // binned to whole points. Nine bins over a sample of ten is mostly
      // empty cells, and an empty-but-for-one cell is a disclosure — same
      // collect-fine / publish-coarse rule the hours buckets follow.
      diffHist[Math.round(r.difficulty) - DIFFICULTY_MIN]++;
    }
    // Validity is judged on what was REPORTED — the scale a person could
    // actually enter — while everything pooled is the normalized figure.
    // Checking the normalized value instead would reject a legitimate
    // summer report simply because halving it lands off the entry scale.
    if (isValidHours(rawHours) && Number.isFinite(stdHours)) {
      hourVals.push(stdHours);
      const b = hoursBucket(stdHours);
      if (b >= 0) hourHist[b]++;
      // Censoring is a fact about the ANSWER, not about the arithmetic: a
      // capped report means "20 or more" whatever term it came from, and
      // normalizing it down must not quietly make it look precise.
      if (rawHours >= HOURS_CAP) censored++;
    }
  }

  const hours      = momentsOf(hourVals);
  const difficulty = momentsOf(diffVals);

  return {
    hours: {
      ...hours,
      hist: hourHist,
      // A capped response means "HOURS_CAP or more", so any mean drawn from a
      // sample containing one understates the truth. Say so rather than
      // publishing a number that reads as exact.
      censored,
      meanIsLowerBound: censored > 0,
    },
    difficulty: { ...difficulty, hist: diffHist },
  };
}

/**
 * What may actually be shown, given the disclosure floors.
 *
 * Three levels per field, decided independently because the two fields
 * carry independent response counts:
 *   n < MIN_N_DISPLAY  → nothing at all
 *   n < MIN_N_STATS    → a coarse tier, no numbers
 *   otherwise          → histogram, mean, spread
 *
 * @param {ReturnType<typeof aggregate>} agg
 * @param {{enrolment?: number}} [opts] typical enrolment for the course, when
 *   known. Omitted means "not known" and is NOT treated as passing the
 *   population floor's intent — callers that have the figure must pass it;
 *   see the note on MIN_ENROLMENT.
 */
export function publicView(agg, opts = {}) {
  // A course too small to hide anyone in publishes nothing, however many
  // of its students answered.
  const enrolment = opts?.enrolment;
  const tooSmall = Number.isFinite(enrolment) && enrolment < MIN_ENROLMENT;

  const field = (a, tierOf) => {
    if (tooSmall) return { level: "none", n: a?.n ?? 0, withheld: "enrolment" };
    if (!a || a.n < MIN_N_DISPLAY) return { level: "none", n: a?.n ?? 0 };
    if (a.n < MIN_N_STATS) {
      return { level: "tier", n: a.n, tier: tierOf(a.mean) };
    }
    return {
      level: "full",
      n: a.n,
      tier: tierOf(a.mean),
      mean: a.mean,
      sd: a.sd,
      hist: a.hist,
      ...(a.meanIsLowerBound ? { meanIsLowerBound: true } : {}),
    };
  };
  return {
    hours:      field(agg?.hours,      hoursTier),
    difficulty: field(agg?.difficulty, difficultyTier),
  };
}

// ── Retrospective entry ────────────────────────────────────────────
// Letting someone rate courses they took years ago is the only real
// answer to cold start — a graduating senior can seed thirty courses in
// one sitting, where waiting for fresh post-term reports covers a degree
// in four years. It also imports two problems that fresh entry does not
// have, and both are handled here rather than assumed away.

/**
 * How stale a report is, in coarse bands.
 *
 * Recorded so recall decay can be MEASURED instead of guessed at. Memory
 * of workload is known to drift toward peak intensity rather than the
 * average, but nobody knows the size of that effect here — with this
 * field, retrospective ratings can be compared against fresh ones and
 * either down-weighted on evidence or kept.
 *
 * Bands, not an exact count, because the term a rating is ABOUT plus an
 * exact age reconstructs the term it was SUBMITTED in — and the whole
 * point of storing no timestamp is that submission time stays unknown.
 * Three bands leak almost nothing and still answer the question.
 */
export const RECENCY = ["current", "recent", "distant"];

/** @param {number} termsElapsed terms between the rated term and now. */
export function recencyOf(termsElapsed) {
  if (!Number.isFinite(termsElapsed) || termsElapsed < 0) return null;
  if (termsElapsed <= 1) return "current";
  if (termsElapsed <= 3) return "recent";
  return "distant";
}

/**
 * Flag a batch that looks satisficed — the same answer straight down a
 * column, which is what a long form gets when someone stops reading it.
 *
 * This is a SIGNAL, never a verdict, and it must not be used to reject a
 * submission: five courses genuinely all at difficulty 3 is an ordinary
 * semester, and throwing it away would bias the corpus against people
 * whose terms really were uniform.
 *
 * ⚠ The result must stay on the device and must NEVER be attached to a
 * submitted rating. Every rating is dispatched independently precisely so
 * one person's rows cannot be joined (see independentSubmissions) — and a
 * shared, unusual flag riding on thirty of them is exactly the correlating
 * handle that design removes. So this is used one way only: to ask the
 * person filling the form whether they meant it, before anything is sent.
 *
 * @param {Array<{difficulty:number|null, hours:number|null}>} drafts
 * @param {number} minRows below which uniformity means nothing
 */
export function looksStraightLined(drafts, minRows = 5) {
  const uniform = (vals) =>
    vals.length >= minRows && vals.every(v => v === vals[0]);
  const list = Array.isArray(drafts) ? drafts : [];
  return {
    difficulty: uniform(list.map(d => d?.difficulty).filter(v => v != null)),
    hours:      uniform(list.map(d => d?.hours).filter(v => v != null)),
  };
}

/**
 * Split a set of drafts into INDEPENDENT submissions.
 *
 * This is the one piece retrospective entry genuinely needs, and it is a
 * privacy control rather than a transport detail. Every rating carries a
 * per-course token specifically so one person's rows cannot be joined —
 * but posting thirty of them in a single request makes the request
 * itself the join, and a full course history is closer to a fingerprint
 * than a name is. So: one submission per rating, no batch identifier, no
 * shared sequence number, and a shuffle so arrival order carries no
 * information about the order they were filled in.
 *
 * Callers are expected to dispatch these separately and, where it costs
 * nothing, spread them over time.
 *
 * @param {Array<object>} drafts
 * @param {() => number} [rand] injectable for deterministic tests
 */
export function independentSubmissions(drafts, rand = Math.random) {
  const list = (Array.isArray(drafts) ? drafts : []).filter(Boolean);
  const out = list.map(d => ({ ...d }));
  for (let i = out.length - 1; i > 0; i--) {       // Fisher–Yates
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── The publication ratchet ────────────────────────────────────────
//
// The disclosure floors protect a SINGLE publication. They do nothing
// about two, and the attack on two is exact arithmetic:
//
//     publication 1:  n=10  mean=7.6000
//     publication 2:  n=11  mean=8.6364
//     11*8.6364 - 10*7.6000  =  19.0   <- the new person's exact answer
//
// Recomputing on a schedule does NOT fix this; it only decides how often
// the equation can be set up. The histogram leaks the same way (the delta
// is a single cell), and rounding the mean barely blunts it — at one
// decimal place the recovered value is still 18.6 against a true 19.
//
// So a published figure is held FIXED until enough new responses have
// arrived that differencing spans a group rather than a person. With a
// delta of 5, the best an observer can extract is the mean of the five
// newest raters — exactly the protection MIN_N_DISPLAY already grants the
// first publication, extended to every one after it.

/** New responses required before a published figure may move. */
export const MIN_PUBLISH_DELTA = 5;

/**
 * What to publish this cycle, given what was published last cycle.
 *
 * @param {ReturnType<typeof publicView>|null} prev  last published view
 * @param {ReturnType<typeof publicView>} next       freshly computed view
 * @returns {{view: object, changed: {hours: boolean, difficulty: boolean}}}
 */
export function ratchetPublication(prev, next) {
  const field = (p, n) => {
    if (!n) return { value: p ?? { level: "none", n: 0 }, changed: false };
    // Nothing published yet: the floors already govern this case, and a
    // first publication has no predecessor to be differenced against.
    if (!p || p.level === "none") {
      return { value: n, changed: n.level !== "none" };
    }
    // A DROP matters as much as a rise — withdrawals difference just as
    // cleanly — so the gate is on magnitude, not direction.
    const delta = Math.abs((n.n ?? 0) - (p.n ?? 0));
    if (delta >= MIN_PUBLISH_DELTA) return { value: n, changed: true };
    // Otherwise republish the previous figure byte-for-byte. Holding a
    // slightly stale number is the price of the guarantee; an observer
    // watching every cycle learns nothing from an unchanged value.
    return { value: p, changed: false };
  };
  const h = field(prev?.hours, next?.hours);
  const d = field(prev?.difficulty, next?.difficulty);
  return {
    view: { hours: h.value, difficulty: d.value },
    changed: { hours: h.changed, difficulty: d.changed },
  };
}

/**
 * Sum a term's reported workload into one hours-per-week figure.
 *
 * Only courses with a disclosable hours figure contribute, so the total
 * is explicitly a floor: `covered` / `total` says how much of the term
 * it actually accounts for. Presenting a partial sum as if it were the
 * whole term would understate exactly the semester a student most needs
 * warning about.
 *
 * @param {Array<{hours:{level:string, mean?:number}}|null>} views
 */
export function termLoad(views) {
  const list = Array.isArray(views) ? views : [];
  let sum = 0, covered = 0, lowerBound = false;
  for (const v of list) {
    const h = v?.hours;
    if (h?.level === "full" && Number.isFinite(h.mean)) {
      sum += h.mean;
      covered++;
      if (h.meanIsLowerBound) lowerBound = true;
    }
  }
  return {
    hours: covered ? sum : null,
    covered,
    total: list.length,
    partial: covered < list.length,
    lowerBound,
  };
}
