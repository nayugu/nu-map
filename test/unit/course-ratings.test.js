// Course ratings: the scales, the aggregation, and — mostly — the disclosure
// floors. These tests are hostile by design. A rating system's failure mode is
// not "the average is slightly off", it is "a course with four responses let
// someone work out what one classmate said", so most of what follows tries to
// pull an individual value back out of a published aggregate.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIFFICULTY_MIN, DIFFICULTY_MAX, HOURS_MIN, HOURS_CAP,
  HOURS_BUCKETS, MIN_N_DISPLAY, MIN_N_STATS, RECENCY,
  isValidDifficulty, isValidHours, normalizeRating,
  hoursBucket, traceOutsideHours, hoursTier, difficultyTier,
  aggregate, publicView, termLoad,
  recencyOf, looksStraightLined, independentSubmissions,
  STANDARD_WEEKS, toStandardWeekly, weeklyInTerm, totalHoursOf,
  MIN_PUBLISH_DELTA, ratchetPublication, MIN_ENROLMENT,
} from "../../src/core/courseRatings.js";

const rating = (hours, difficulty = null) => ({ hours, difficulty });
const nOf = (n, h, d) => Array.from({ length: n }, () => rating(h, d));

// ── The disclosure floors ─────────────────────────────────────────────────
// The whole privacy design rests on these. If any of this goes green->red,
// something is leaking.

test("below the display floor, nothing at all is published", () => {
  for (let n = 0; n < MIN_N_DISPLAY; n++) {
    const view = publicView(aggregate(nOf(n, 8, 3)));
    assert.equal(view.hours.level, "none", `n=${n} must publish nothing`);
    assert.equal(view.hours.mean, undefined);
    assert.equal(view.hours.sd, undefined);
    assert.equal(view.hours.hist, undefined);
    assert.equal(view.hours.tier, undefined);
  }
});

test("between the floors, a tier leaks no numbers", () => {
  for (let n = MIN_N_DISPLAY; n < MIN_N_STATS; n++) {
    const view = publicView(aggregate(nOf(n, 8, 3)));
    assert.equal(view.hours.level, "tier");
    assert.ok(view.hours.tier, "a tier must be present");
    // The point of the tier level: no reconstructable quantities.
    assert.equal(view.hours.mean, undefined, `n=${n} leaked a mean`);
    assert.equal(view.hours.sd, undefined, `n=${n} leaked a spread`);
    assert.equal(view.hours.hist, undefined, `n=${n} leaked a histogram`);
  }
});

test("mean and spread together never appear below MIN_N_STATS", () => {
  // At n=2, mean and sd determine both original values exactly; n=3 is often
  // solvable. This is the reconstruction vector the second floor exists for.
  const two = aggregate([rating(4), rating(12)]);
  assert.equal(two.hours.n, 2);
  assert.ok(Number.isFinite(two.hours.mean), "aggregate itself may compute it");
  assert.ok(Number.isFinite(two.hours.sd));
  // ...but it must not escape.
  const view = publicView(two);
  assert.equal(view.hours.level, "none");
  assert.equal(view.hours.mean, undefined);
  assert.equal(view.hours.sd, undefined);
});

test("a histogram never appears while n could identify a single response", () => {
  // A histogram with one non-zero cell at low n is a direct disclosure.
  const view = publicView(aggregate([...nOf(4, 3), rating(HOURS_CAP)]));
  assert.equal(view.hours.n, 5);
  assert.equal(view.hours.level, "tier");
  assert.equal(view.hours.hist, undefined);
});

// ── Unset is not zero ─────────────────────────────────────────────────────

test("an unanswered field is not a value", () => {
  // null is the absence of an answer. Coercing it to anything numeric would
  // drag every course's mean by the size of its non-response.
  const agg = aggregate([rating(HOURS_MIN), rating(null), rating(null)]);
  assert.equal(agg.hours.n, 1, "only the real answer counts");
  assert.equal(agg.hours.mean, HOURS_MIN);
});

test("0 hours is off the scale entirely", () => {
  // Hours is TOTAL time, so 0 is not reachable: a course you attended at all
  // took more than none of your week. Keeping it would put a real answer at
  // the slider's floor, one stray tap away, pulling the mean down.
  assert.equal(HOURS_MIN, 1);
  assert.equal(isValidHours(0), false);
  assert.equal(hoursBucket(0), -1);
  assert.equal(normalizeRating({ courseId: "CS 3000", hours: 0 }), null);
  const agg = aggregate([rating(0), rating(0)]);
  assert.equal(agg.hours.n, 0, "a 0 must not enter the aggregate");
});

test("there is exactly one way to say 'no answer'", () => {
  // A separate N/A state alongside null would be a second representation of
  // the same thing, and the two drift apart the moment one is forgotten.
  const cleared = normalizeRating({ courseId: "CS 3000", hours: null, difficulty: null });
  assert.equal(cleared, null);
  assert.equal(fillStateless({ hours: null }), 0);
  function fillStateless(r) { return aggregate([r]).hours.n; }
});

test("an untouched row produces no rating at all", () => {
  assert.equal(normalizeRating({ courseId: "CS 3000" }), null);
  assert.equal(normalizeRating({ courseId: "CS 3000", hours: null, difficulty: null }), null);
  // ...but a single answered field is a legitimate rating.
  assert.deepEqual(
    normalizeRating({ courseId: "CS 3000", hours: 8 }),
    { courseId: "CS 3000", instructor: null, difficulty: null, hours: 8 },
  );
});

test("the two fields carry independent response counts", () => {
  // Someone who answers hours but skips difficulty must not inflate the
  // difficulty n — otherwise a course crosses the disclosure floor on the
  // strength of responses that said nothing about difficulty.
  const agg = aggregate([
    ...nOf(10, 8, null),   // hours only
    ...nOf(2, null, 5),    // difficulty only
  ]);
  assert.equal(agg.hours.n, 10);
  assert.equal(agg.difficulty.n, 2);
  const view = publicView(agg);
  assert.equal(view.hours.level, "full");
  assert.equal(view.difficulty.level, "none", "2 difficulty responses must stay hidden");
});

// ── Censoring at the top of the scale ─────────────────────────────────────

test("a capped response makes the mean an explicit lower bound", () => {
  const agg = aggregate(nOf(10, HOURS_CAP));
  assert.equal(agg.hours.censored, 10);
  assert.equal(agg.hours.meanIsLowerBound, true);
  assert.equal(publicView(agg).hours.meanIsLowerBound, true);
});

test("an uncensored sample is not flagged", () => {
  const agg = aggregate(nOf(10, HOURS_CAP - 1));
  assert.equal(agg.hours.censored, 0);
  assert.equal(agg.hours.meanIsLowerBound, false);
  assert.equal(publicView(agg).hours.meanIsLowerBound, undefined);
});

// ── Buckets ───────────────────────────────────────────────────────────────

test("every valid hours value lands in exactly one bucket", () => {
  for (let h = HOURS_MIN; h <= HOURS_CAP; h++) {
    const hits = HOURS_BUCKETS.filter(b => h >= b.lo && h <= b.hi);
    assert.equal(hits.length, 1, `h=${h} matched ${hits.length} buckets`);
    assert.equal(hoursBucket(h), HOURS_BUCKETS.indexOf(hits[0]));
  }
});

test("buckets are contiguous with no gap between them", () => {
  for (let i = 1; i < HOURS_BUCKETS.length; i++) {
    assert.equal(HOURS_BUCKETS[i].lo, HOURS_BUCKETS[i - 1].hi + 1,
      `gap or overlap between bucket ${i - 1} and ${i}`);
  }
  assert.equal(HOURS_BUCKETS[0].lo, HOURS_MIN);
  assert.equal(HOURS_BUCKETS.at(-1).hi, Infinity, "the top bucket must stay open");
  assert.equal(HOURS_BUCKETS.at(-1).lo, HOURS_CAP);
});

test("bucketing accepts fractions; entry validation does not", () => {
  // Two different jobs: isValidHours guards what a PERSON may enter,
  // hoursBucket bins POOLED figures, which are term-normalized and so are
  // fractional. Conflating them dropped every normalized value silently.
  assert.equal(isValidHours(7.5), false, "7.5 is not enterable");
  assert.equal(hoursBucket(7.5), 2, "but it still bins, into 7-9");
  // Bands are [lo, next lo), so a value in the gap between integer bounds
  // takes the band below rather than falling through to the top one.
  assert.equal(hoursBucket(3.89), 0);
  assert.equal(hoursBucket(13.5), 3);
  assert.equal(hoursBucket(19.9), 4);
  for (const bad of [null, undefined, 0, -1, NaN, Infinity, "8", {}]) {
    assert.equal(hoursBucket(bad), -1, `${String(bad)} should not bucket`);
  }
});

test("no fractional value falls through to the top band", () => {
  // The bug this pins: with `lo <= h <= hi` and integer bounds, 3.89 matched
  // nothing and the fallback reported it as 20+ — a three-hour course shown
  // as the heaviest on the scale.
  const top = HOURS_BUCKETS.length - 1;
  for (let h = HOURS_MIN; h < HOURS_CAP; h += 0.13) {
    const b = hoursBucket(h);
    assert.ok(b >= 0, `h=${h.toFixed(2)} bucketed to ${b}`);
    assert.equal(b < top, true,
      `h=${h.toFixed(2)} must not land in the open top band`);
    assert.ok(h >= HOURS_BUCKETS[b].lo, `h=${h.toFixed(2)} below its band`);
  }
  assert.equal(hoursBucket(HOURS_CAP), top);
  assert.equal(hoursBucket(HOURS_CAP + 99), top);
});

// ── Validation is strict about type, not just range ───────────────────────

test("non-integers and out-of-range values are rejected outright", () => {
  const badHours = [-1, HOURS_CAP + 1, 3.5, NaN, Infinity, -Infinity,
                    "8", null, undefined, {}, [], true];
  for (const b of badHours) assert.equal(isValidHours(b), false, `hours ${String(b)}`);
  for (let h = HOURS_MIN; h <= HOURS_CAP; h++) assert.equal(isValidHours(h), true);

  // Difficulty is 1–5 in HALF steps: 3.5 is a real answer, 3.25 is not, and
  // 0 is below the floor (the scale starts at "very easy" so it stays
  // comparable with RateMyProfessors' 1–5).
  const badDiff = [0, 0.5, 6, 5.5, 2.25, 1.1, NaN, Infinity,
                   "3", null, undefined, {}, [], true];
  for (const b of badDiff) assert.equal(isValidDifficulty(b), false, `difficulty ${String(b)}`);
  for (let x = DIFFICULTY_MIN * 2; x <= DIFFICULTY_MAX * 2; x++) {
    assert.equal(isValidDifficulty(x / 2), true, `difficulty ${x / 2} should be valid`);
  }
});

test("difficulty half-steps survive storage and averaging exactly", () => {
  const agg = aggregate([{ difficulty: 3.5 }, { difficulty: 4.5 }]);
  assert.equal(agg.difficulty.n, 2);
  assert.equal(agg.difficulty.mean, 4, "half-steps must not be rounded on the way in");
  assert.equal(normalizeRating({ courseId: "CS 3000", difficulty: 3.5 }).difficulty, 3.5);
  assert.equal(normalizeRating({ courseId: "CS 3000", difficulty: 3.25 }), null);
});

test("the published difficulty histogram is binned to whole points", () => {
  // Nine bins over a sample of ten is mostly empty cells, and a cell holding
  // exactly one response is a disclosure. Halves round to the nearer point,
  // .5 upward.
  const agg = aggregate([1, 1.5, 2, 3.5, 4.5, 5, 5].map(d => ({ difficulty: d })));
  assert.equal(agg.difficulty.hist.length, DIFFICULTY_MAX - DIFFICULTY_MIN + 1);
  assert.deepEqual(agg.difficulty.hist, [1, 2, 0, 1, 3]);
  assert.equal(agg.difficulty.hist.reduce((a, b) => a + b, 0), 7);
  // The mean keeps the precision the histogram gives up.
  assert.ok(Math.abs(agg.difficulty.mean - 22.5 / 7) < 1e-9);
});

test("malformed rows are dropped rather than coerced", () => {
  assert.equal(normalizeRating(null), null);
  assert.equal(normalizeRating({}), null);
  assert.equal(normalizeRating({ courseId: "" , hours: 8 }), null);
  assert.equal(normalizeRating({ courseId: 42, hours: 8 }), null);
  // A bad value in one field must not discard the good one.
  assert.deepEqual(
    normalizeRating({ courseId: "CS 3000", hours: 99, difficulty: 3 }),
    { courseId: "CS 3000", instructor: null, difficulty: 3, hours: null },
  );
  // An empty instructor string is absence, not a person named "".
  assert.equal(normalizeRating({ courseId: "CS 3000", hours: 8, instructor: "" }).instructor, null);
});

test("aggregate survives junk input without throwing", () => {
  for (const junk of [null, undefined, "nope", 42, {}]) {
    const agg = aggregate(junk);
    assert.equal(agg.hours.n, 0);
    assert.equal(agg.difficulty.n, 0);
  }
  const agg = aggregate([null, undefined, {}, { hours: "8" }, { difficulty: [] }]);
  assert.equal(agg.hours.n, 0);
  assert.equal(agg.difficulty.n, 0);
});

// ── TRACE conversion ──────────────────────────────────────────────────────

test("TRACE conversion subtracts contact hours and never goes negative", () => {
  assert.equal(traceOutsideHours(10, 3.3), 6.7);
  // A student who skipped most classes can report less total time than the
  // course nominally meets. Negative "outside" hours would be meaningless.
  assert.equal(traceOutsideHours(1, 3.3), 0);
  // 0 is off the hours scale, so it converts to nothing rather than to 0.
  assert.equal(traceOutsideHours(0, 3.3), null);
  // A missing contact figure must not silently become NaN.
  assert.equal(traceOutsideHours(10, undefined), 10);
  assert.equal(traceOutsideHours(10, NaN), 10);
  assert.equal(traceOutsideHours(null, 3.3), null);
});

// ── Tier boundaries ───────────────────────────────────────────────────────

test("tiers are total over the scale and monotonic", () => {
  let last = -1;
  const order = { light: 0, moderate: 1, heavy: 2 };
  for (let h = HOURS_MIN; h <= HOURS_CAP; h++) {
    const t = hoursTier(h);
    assert.ok(t, `h=${h} has no tier`);
    assert.ok(order[t] >= last, `tier went backwards at h=${h}`);
    last = order[t];
  }
  const dOrder = { easy: 0, moderate: 1, hard: 2 };
  let dLast = -1;
  for (let x = DIFFICULTY_MIN * 2; x <= DIFFICULTY_MAX * 2; x++) {
    const d = x / 2;
    const t = difficultyTier(d);
    assert.ok(t, `d=${d} has no tier`);
    assert.ok(dOrder[t] >= dLast, `tier went backwards at d=${d}`);
    dLast = dOrder[t];
  }
  assert.equal(hoursTier(NaN), null);
  assert.equal(difficultyTier(null), null);
});

// ── Term load ─────────────────────────────────────────────────────────────

test("a term total says how much of the term it actually covers", () => {
  const full = publicView(aggregate(nOf(10, 8)));
  const hidden = publicView(aggregate(nOf(2, 20)));
  const load = termLoad([full, full, hidden, hidden]);
  assert.equal(load.covered, 2);
  assert.equal(load.total, 4);
  assert.equal(load.partial, true, "a partial sum must announce itself");
  assert.equal(load.hours, 16);
});

test("a term with nothing disclosable reports null, not zero", () => {
  // Zero would read as "this semester is free", which is the opposite of
  // "we don't know yet" — degrade to less information, never to wrong.
  const hidden = publicView(aggregate(nOf(1, 20)));
  const load = termLoad([hidden, hidden]);
  assert.equal(load.hours, null);
  assert.equal(load.covered, 0);
  assert.equal(load.partial, true);
});

test("a censored course propagates its lower bound to the term", () => {
  const capped = publicView(aggregate(nOf(10, HOURS_CAP)));
  assert.equal(termLoad([capped]).lowerBound, true);
  const normal = publicView(aggregate(nOf(10, 8)));
  assert.equal(termLoad([normal]).lowerBound, false);
});

test("termLoad survives junk and empty input", () => {
  for (const junk of [null, undefined, "x", 7, {}]) {
    const load = termLoad(junk);
    assert.equal(load.hours, null);
    assert.equal(load.covered, 0);
  }
  assert.equal(termLoad([null, undefined, {}]).hours, null);
});

// ── Arithmetic ────────────────────────────────────────────────────────────

test("the mean is real, not a bucket midpoint", () => {
  // The reason collection is fine-grained: a mean over integers is exact,
  // where a mean over buckets would rest on assuming everyone in 4-6 meant 5.
  const agg = aggregate([rating(4), rating(5), rating(6)]);
  assert.equal(agg.hours.mean, 5);
  const skewed = aggregate([rating(4), rating(4), rating(6)]);
  assert.ok(Math.abs(skewed.hours.mean - 14 / 3) < 1e-9);
});

test("spread uses the sample denominator and is undefined at n=1", () => {
  assert.equal(aggregate([rating(8)]).hours.sd, null);
  const agg = aggregate([rating(6), rating(10)]);
  assert.ok(Math.abs(agg.hours.sd - Math.sqrt(8)) < 1e-9, "n-1 denominator");
});

test("histograms count every response exactly once", () => {
  // Both edges of every bucket, so a boundary shift shows up here first.
  const vals = [1, 3, 4, 6, 7, 9, 10, 13, 14, 19, 20];
  const agg = aggregate(vals.map(v => rating(v)));
  assert.equal(agg.hours.hist.reduce((a, b) => a + b, 0), vals.length);
  assert.deepEqual(agg.hours.hist, [2, 2, 2, 2, 2, 1]);
  assert.equal(agg.hours.hist.length, HOURS_BUCKETS.length);
  const d = aggregate([1, 1, 3, 5, 5, 5].map(v => rating(null, v)));
  assert.deepEqual(d.difficulty.hist, [2, 0, 1, 0, 3]);
  assert.equal(d.difficulty.hist.reduce((a, b) => a + b, 0), 6);
});

// ── Retrospective entry ───────────────────────────────────────────────────

test("recency is coarse, total, and monotonic", () => {
  assert.equal(recencyOf(0), "current");
  assert.equal(recencyOf(1), "current");
  assert.equal(recencyOf(2), "recent");
  assert.equal(recencyOf(3), "recent");
  assert.equal(recencyOf(4), "distant");
  assert.equal(recencyOf(40), "distant");
  const order = { current: 0, recent: 1, distant: 2 };
  let last = -1;
  for (let n = 0; n < 60; n++) {
    const r = recencyOf(n);
    assert.ok(RECENCY.includes(r), `n=${n} produced ${r}`);
    assert.ok(order[r] >= last, `recency went backwards at n=${n}`);
    last = order[r];
  }
  for (const bad of [-1, NaN, Infinity, null, undefined, "2", {}]) {
    assert.equal(recencyOf(bad), null, `${String(bad)} should not bucket`);
  }
});

test("recency never resolves finer than its band", () => {
  // Term-rated + exact age would reconstruct the submission term, which is
  // the one thing we deliberately never store. Each band must cover a range.
  const bands = {};
  for (let n = 0; n < 12; n++) (bands[recencyOf(n)] ??= []).push(n);
  for (const [band, ns] of Object.entries(bands)) {
    assert.ok(ns.length >= 2, `band ${band} covers only ${ns.length} value(s)`);
  }
});

test("straight-lining is detected per field, not per submission", () => {
  const flat = Array.from({ length: 6 }, () => ({ difficulty: 3, hours: 8 }));
  assert.deepEqual(looksStraightLined(flat), { difficulty: true, hours: true });
  // One field can satisfice while the other is genuine.
  const mixed = [8, 3, 12, 5, 20, 7].map(h => ({ difficulty: 3, hours: h }));
  assert.deepEqual(looksStraightLined(mixed), { difficulty: true, hours: false });
});

test("a short uniform term is not straight-lining", () => {
  // Four courses all at difficulty 3 is an ordinary semester, not satisficing.
  // Flagging it would bias the corpus against people whose terms were uniform.
  const few = Array.from({ length: 4 }, () => ({ difficulty: 3, hours: 8 }));
  assert.deepEqual(looksStraightLined(few), { difficulty: false, hours: false });
});

test("straight-lining ignores unanswered fields when judging uniformity", () => {
  const sparse = [
    { difficulty: 3, hours: null }, { difficulty: 3, hours: null },
    { difficulty: 3, hours: null }, { difficulty: 3, hours: null },
    { difficulty: 3, hours: null }, { difficulty: null, hours: 9 },
  ];
  const flags = looksStraightLined(sparse);
  assert.equal(flags.difficulty, true, "5 identical answers still count");
  assert.equal(flags.hours, false, "a single hours answer is not a pattern");
  for (const junk of [null, undefined, "x", 7, {}]) {
    assert.deepEqual(looksStraightLined(junk), { difficulty: false, hours: false });
  }
});

test("submissions are independent: no batch id, no shared ordering", () => {
  const drafts = Array.from({ length: 30 }, (_, i) => ({
    courseId: `CS ${1000 + i}`, difficulty: 3, hours: 8,
  }));
  const subs = independentSubmissions(drafts);
  assert.equal(subs.length, 30);
  // Nothing may correlate the rows back into one person's transcript.
  for (const s of subs) {
    for (const key of ["batch", "batchId", "seq", "index", "submittedAt", "ts"]) {
      assert.equal(key in s, false, `submission leaked "${key}"`);
    }
    assert.deepEqual(Object.keys(s).sort(), ["courseId", "difficulty", "hours"]);
  }
  // Every draft survives exactly once — shuffling must not drop or duplicate.
  assert.deepEqual(
    subs.map(s => s.courseId).sort(),
    drafts.map(d => d.courseId).sort(),
  );
});

test("submissions are copies, so mutating one cannot reach the draft", () => {
  const drafts = [{ courseId: "CS 3000", difficulty: 3, hours: 8 }];
  const subs = independentSubmissions(drafts);
  subs[0].difficulty = 5;
  assert.equal(drafts[0].difficulty, 3);
});

test("the shuffle actually reorders, given a deterministic source", () => {
  const drafts = Array.from({ length: 20 }, (_, i) => ({ courseId: `C${i}` }));
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const subs = independentSubmissions(drafts, rand);
  const samePos = subs.filter((s, i) => s.courseId === drafts[i].courseId).length;
  assert.ok(samePos < drafts.length, "arrival order must not mirror fill order");
  assert.deepEqual(subs.map(s => s.courseId).sort(), drafts.map(d => d.courseId).sort());
  assert.deepEqual(independentSubmissions([]), []);
  assert.deepEqual(independentSubmissions(null), []);
  assert.deepEqual(independentSubmissions([null, undefined]), []);
});

// ── Fuzz: the disclosure floors must hold for ANY input ───────────────────

test("fuzz: publicView never leaks a number below its floor", () => {
  let seed = 42;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
  for (let trial = 0; trial < 3000; trial++) {
    const n = rnd(25);
    const ratings = Array.from({ length: n }, () => ({
      // Half-steps included, so the fuzz exercises the real scale.
      difficulty: rnd(3) === 0 ? null : DIFFICULTY_MIN + rnd(9) / 2,
      hours:      rnd(3) === 0 ? null : rnd(HOURS_CAP + 1),
    }));
    const agg  = aggregate(ratings);
    const view = publicView(agg);
    for (const key of ["hours", "difficulty"]) {
      const f = view[key], a = agg[key];
      assert.equal(f.n, a.n, "published n must match the real count");
      if (a.n < MIN_N_DISPLAY) {
        assert.equal(f.level, "none");
        assert.equal(f.mean, undefined, `leaked mean at n=${a.n}`);
        assert.equal(f.sd, undefined, `leaked sd at n=${a.n}`);
        assert.equal(f.hist, undefined, `leaked hist at n=${a.n}`);
        assert.equal(f.tier, undefined, `leaked tier at n=${a.n}`);
      } else if (a.n < MIN_N_STATS) {
        assert.equal(f.level, "tier");
        assert.ok(f.tier, "a tier must be present");
        assert.equal(f.mean, undefined, `leaked mean at n=${a.n}`);
        assert.equal(f.sd, undefined, `leaked sd at n=${a.n}`);
        assert.equal(f.hist, undefined, `leaked hist at n=${a.n}`);
      } else {
        assert.equal(f.level, "full");
        assert.ok(Number.isFinite(f.mean));
        assert.ok(Array.isArray(f.hist));
        assert.equal(f.hist.reduce((x, y) => x + y, 0), a.n,
          "histogram must account for every response");
      }
    }
  }
});

test("fuzz: aggregate never throws and never invents responses", () => {
  const junk = [null, undefined, NaN, Infinity, -1, 99, 2.5, "3", "", {}, [],
                true, false, { difficulty: "3" }, { hours: [] }];
  let seed = 99;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
  for (let trial = 0; trial < 2000; trial++) {
    const rows = Array.from({ length: rnd(12) }, () => {
      const pick = () => junk[rnd(junk.length)];
      return rnd(2) ? { difficulty: pick(), hours: pick() } : pick();
    });
    const agg = aggregate(rows);
    // Only genuinely valid values may be counted.
    const realD = rows.filter(r => isValidDifficulty(r?.difficulty)).length;
    const realH = rows.filter(r => isValidHours(r?.hours)).length;
    assert.equal(agg.difficulty.n, realD);
    assert.equal(agg.hours.n, realH);
    assert.ok(agg.hours.n <= rows.length, "more responses than rows");
    if (agg.hours.mean !== null) {
      assert.ok(agg.hours.mean >= HOURS_MIN && agg.hours.mean <= HOURS_CAP,
        `mean ${agg.hours.mean} outside the scale`);
    }
    if (agg.difficulty.mean !== null) {
      assert.ok(agg.difficulty.mean >= DIFFICULTY_MIN &&
                agg.difficulty.mean <= DIFFICULTY_MAX);
    }
  }
});

test("fuzz: a term total never exceeds the sum of its parts", () => {
  let seed = 5;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
  for (let trial = 0; trial < 1000; trial++) {
    const views = Array.from({ length: rnd(8) }, () =>
      publicView(aggregate(Array.from({ length: rnd(20) }, () => ({
        hours: rnd(HOURS_CAP + 1), difficulty: null,
      })))));
    const load = termLoad(views);
    assert.equal(load.total, views.length);
    assert.ok(load.covered <= load.total);
    assert.equal(load.partial, load.covered < load.total);
    if (load.covered === 0) {
      assert.equal(load.hours, null, "no coverage must read as unknown, not 0");
    } else {
      assert.ok(load.hours >= 0);
      assert.ok(load.hours <= load.covered * HOURS_CAP);
    }
  }
});

// ── Term-length normalization ─────────────────────────────────────────────
// The invariant is TOTAL work; hours/week is a presentation of it against a
// term length. Measured lengths: fall 14.6 weeks, spring 15.1, both half
// summers 7.1 — so a summer section runs ~2.04x the weekly rate of the same
// course in the fall for identical total work.

const FALL = 14.6, SPRING = 15.1, SUMMER = 7.1;

test("a summer report and a fall report of the same course agree once normalized", () => {
  // Someone reporting 16 h/wk over 7.1 summer weeks did the same total work
  // as someone reporting ~8 h/wk over 14.6 fall weeks. Pooled, they must not
  // pull against each other.
  const summer = toStandardWeekly(16, SUMMER);
  assert.ok(Math.abs(summer - 7.78) < 0.01, `got ${summer}`);
  const agg = aggregate([
    { hours: 16, weeks: SUMMER },
    { hours: 8,  weeks: FALL },
  ]);
  assert.equal(agg.hours.n, 2);
  assert.ok(Math.abs(agg.hours.mean - 7.89) < 0.02,
    `two consistent reports should barely disagree, got ${agg.hours.mean}`);
  assert.ok(agg.hours.sd < 0.2, `spread should be small, got ${agg.hours.sd}`);
});

test("without normalization those same two reports would look inconsistent", () => {
  // The control: this is what pooling raw weekly rates would have produced.
  const naive = aggregate([{ hours: 16 }, { hours: 8 }]);
  assert.equal(naive.hours.mean, 12);
  assert.ok(naive.hours.sd > 5, "raw pooling invents a disagreement");
});

test("round-tripping through a term is lossless", () => {
  for (const weeks of [FALL, SPRING, SUMMER, 5, 20]) {
    for (const reported of [1, 4, 9, 13, 20]) {
      const std  = toStandardWeekly(reported, weeks);
      const back = weeklyInTerm(std, weeks);
      assert.ok(Math.abs(back - reported) < 1e-9,
        `${reported}h over ${weeks}w round-tripped to ${back}`);
    }
  }
});

test("the same course reads twice as heavy in a half-summer", () => {
  const std = toStandardWeekly(8, FALL);           // a normal fall course
  const inSummer = weeklyInTerm(std, SUMMER);
  assert.ok(Math.abs(inSummer / 8 - FALL / SUMMER) < 1e-9);
  assert.ok(inSummer > 16 && inSummer < 17, `got ${inSummer}`);
  // Spring is within 4% of fall, so it must NOT be dramatised.
  const inSpring = weeklyInTerm(std, SPRING);
  assert.ok(Math.abs(inSpring - 8) < 0.3, `spring should be ~8, got ${inSpring}`);
});

test("total hours is the quantity that stays put", () => {
  const std = toStandardWeekly(16, SUMMER);
  const total = totalHoursOf(std);
  // 16 h/wk x 7.1 weeks = 113.6 hours, however it is later presented.
  assert.ok(Math.abs(total - 16 * SUMMER) < 1e-9, `got ${total}`);
  assert.ok(Math.abs(totalHoursOf(toStandardWeekly(8, FALL)) - 8 * FALL) < 1e-9);
});

test("validity is judged on the report, not on the normalized value", () => {
  // A summer 20 normalizes to 9.7, which is fine; a summer 0 normalizes to 0,
  // which is off the entry scale and must still be rejected.
  const agg = aggregate([
    { hours: 20, weeks: SUMMER },   // legitimate capped report
    { hours: 0,  weeks: SUMMER },   // off the entry scale
    { hours: 25, weeks: FALL },     // above the entry scale
  ]);
  assert.equal(agg.hours.n, 1, "only the enterable report counts");
  assert.equal(agg.hours.censored, 1, "and it is still marked censored");
  assert.equal(agg.hours.meanIsLowerBound, true);
});

test("a missing or nonsense term length leaves the figure untouched", () => {
  // No term is not evidence about summer either way — treat as standard
  // rather than guessing, and never produce NaN.
  for (const w of [undefined, null, NaN, 0, -3, "14"]) {
    assert.equal(toStandardWeekly(8, w), 8, `weeks=${String(w)}`);
    assert.equal(weeklyInTerm(8, w), 8, `weeks=${String(w)}`);
  }
  assert.equal(toStandardWeekly(null, FALL), null);
  assert.equal(weeklyInTerm(undefined, FALL), null);
  assert.equal(totalHoursOf("x"), null);
  const agg = aggregate([{ hours: 8 }, { hours: 8, weeks: NaN }]);
  assert.equal(agg.hours.n, 2);
  assert.equal(agg.hours.mean, 8);
});

test("normalized values still bucket and still respect the floors", () => {
  // Ten summer reports of 16 h/wk pool to ~7.8 standard, i.e. the 7-9 band —
  // not the 14-19 band their raw figures would have landed in.
  const agg = aggregate(Array.from({ length: 10 },
    () => ({ hours: 16, weeks: SUMMER })));
  const view = publicView(agg);
  assert.equal(view.hours.level, "full");
  assert.equal(view.hours.hist[2], 10, "all ten in the 7-9 bucket");
  assert.equal(view.hours.hist.reduce((a, b) => a + b, 0), 10);
  assert.equal(view.hours.tier, "moderate");
});

// ── Confidentiality under REPEATED publication ────────────────────────────
// The disclosure floors guard one snapshot. These guard the sequence, which
// is where the exact-extraction attack lives.

test("ATTACK: one new rating between publications is exactly recoverable", () => {
  // This is the vulnerability, demonstrated against the raw views. It is the
  // reason ratchetPublication exists; if this test ever stops recovering the
  // value, the arithmetic has changed and the ratchet may be resting on a
  // false premise.
  const before = [6, 8, 7, 9, 8, 7, 6, 10, 8, 7].map(h => ({ hours: h }));
  const after  = [...before, { hours: 19 }];
  const v1 = publicView(aggregate(before));
  const v2 = publicView(aggregate(after));
  const recovered = v2.hours.n * v2.hours.mean - v1.hours.n * v1.hours.mean;
  assert.ok(Math.abs(recovered - 19) < 1e-9,
    `unratcheted views leak the exact value (got ${recovered})`);
});

test("the ratchet holds the figure until enough new responses arrive", () => {
  const base = [6, 8, 7, 9, 8, 7, 6, 10, 8, 7].map(h => ({ hours: h }));
  let published = ratchetPublication(null, publicView(aggregate(base))).view;
  const first = published.hours.mean;

  // Four more raters arrive one at a time. Nothing may move.
  const grown = [...base];
  for (const h of [19, 18, 17, 20]) {
    grown.push({ hours: h });
    const step = ratchetPublication(published, publicView(aggregate(grown)));
    assert.equal(step.changed.hours, false,
      `moved at n=${grown.length}, delta=${grown.length - base.length}`);
    assert.equal(step.view.hours.mean, first, "the held figure must be identical");
    published = step.view;
  }
  // The fifth crosses the threshold and the figure is allowed to move.
  grown.push({ hours: 16 });
  const step = ratchetPublication(published, publicView(aggregate(grown)));
  assert.equal(step.changed.hours, true);
  assert.notEqual(step.view.hours.mean, first);
});

test("differencing consecutive PUBLISHED figures spans at least 5 people", () => {
  // The guarantee restated as arithmetic: whatever an observer recovers from
  // two published figures is a sum over MIN_PUBLISH_DELTA or more raters,
  // never one.
  const base = Array.from({ length: 12 }, (_, i) => ({ hours: 6 + (i % 4) }));
  let published = ratchetPublication(null, publicView(aggregate(base))).view;
  const grown = [...base];
  let lastPublished = published;
  for (let i = 0; i < 40; i++) {
    grown.push({ hours: 1 + (i * 7) % 20 });
    const step = ratchetPublication(published, publicView(aggregate(grown)));
    if (step.changed.hours) {
      const spanned = step.view.hours.n - lastPublished.hours.n;
      assert.ok(spanned >= MIN_PUBLISH_DELTA,
        `a published change spanned only ${spanned} raters`);
      lastPublished = step.view;
    }
    published = step.view;
  }
});

test("a withdrawal is gated too — dropping n differences just as cleanly", () => {
  const base = Array.from({ length: 20 }, () => ({ hours: 8 }));
  const published = ratchetPublication(null, publicView(aggregate(base))).view;
  // One person clears their rating. That single-row delta must not surface.
  const minusOne = base.slice(0, 19);
  const step = ratchetPublication(published, publicView(aggregate(minusOne)));
  assert.equal(step.changed.hours, false, "a single withdrawal leaked");
  assert.equal(step.view.hours.n, 20, "the held figure keeps the old n");
  // Five withdrawals may move it.
  const minusFive = base.slice(0, 15);
  assert.equal(
    ratchetPublication(published, publicView(aggregate(minusFive))).changed.hours,
    true);
});

test("the ratchet never publishes something the floors withheld", () => {
  // Holding a previous value must not resurrect a figure that has since
  // dropped below the disclosure floor, nor invent one that never cleared it.
  const tiny = publicView(aggregate([{ hours: 8 }, { hours: 9 }]));
  const step = ratchetPublication(null, tiny);
  assert.equal(step.view.hours.level, "none");
  assert.equal(step.view.hours.mean, undefined);
  assert.equal(step.changed.hours, false, "nothing publishable, nothing changed");
  // And from nothing, a first real publication is allowed through.
  const ok = publicView(aggregate(Array.from({ length: 10 }, () => ({ hours: 8 }))));
  assert.equal(ratchetPublication(step.view, ok).changed.hours, true);
});

test("the two fields ratchet independently", () => {
  // Hours crossing its threshold must not drag an under-threshold difficulty
  // figure into publication alongside it.
  const prev = publicView(aggregate(
    Array.from({ length: 10 }, () => ({ hours: 8, difficulty: 3 }))));
  const next = publicView(aggregate([
    ...Array.from({ length: 16 }, () => ({ hours: 8, difficulty: null })),
    ...Array.from({ length: 11 }, () => ({ hours: null, difficulty: 4 })),
  ]));
  const step = ratchetPublication(prev, next);
  assert.equal(step.changed.hours, true, "hours grew by 6");
  assert.equal(step.changed.difficulty, false, "difficulty grew by only 1");
  assert.equal(step.view.difficulty.mean, prev.difficulty.mean);
});

test("ratchet survives junk on either side", () => {
  for (const junk of [null, undefined, {}, "x", 7]) {
    const out = ratchetPublication(junk, junk);
    assert.ok(out.view.hours, "must always return a shape");
    assert.equal(out.changed.hours, false);
  }
});

// ── The population floor ──────────────────────────────────────────────────

test("a course too small to hide anyone in publishes nothing", () => {
  // Five answers out of six students is a respectable-looking sample and no
  // anonymity at all: a classmate subtracts themselves and is left with four.
  const agg = aggregate(Array.from({ length: 12 }, () => ({ hours: 8, difficulty: 3 })));
  const open = publicView(agg);
  assert.equal(open.hours.level, "full", "control: publishes when nothing is passed");

  const small = publicView(agg, { enrolment: MIN_ENROLMENT - 1 });
  assert.equal(small.hours.level, "none");
  assert.equal(small.difficulty.level, "none");
  assert.equal(small.hours.mean, undefined);
  assert.equal(small.hours.tier, undefined);
  assert.equal(small.hours.withheld, "enrolment", "the reason is recorded");
});

test("the population floor applies however large the sample is", () => {
  // A big sample cannot buy its way past a small class.
  const huge = aggregate(Array.from({ length: 400 }, () => ({ hours: 8 })));
  assert.equal(publicView(huge, { enrolment: 4 }).hours.level, "none");
  assert.equal(publicView(huge, { enrolment: MIN_ENROLMENT }).hours.level, "full");
});

test("an unknown enrolment does not silently fail open or closed", () => {
  const agg = aggregate(Array.from({ length: 12 }, () => ({ hours: 8 })));
  for (const e of [undefined, null, NaN, "20", {}]) {
    const v = publicView(agg, { enrolment: e });
    assert.equal(v.hours.level, "full", `enrolment=${String(e)} must not withhold`);
    assert.equal(v.hours.withheld, undefined);
  }
  // ...and the caller passing nothing at all behaves the same.
  assert.equal(publicView(agg).hours.level, "full");
  assert.equal(publicView(agg, undefined).hours.level, "full");
});

test("the population floor is at least the response floor", () => {
  // If MIN_ENROLMENT ever dropped below MIN_N_DISPLAY the floor would be
  // unreachable and the guard silently dead.
  assert.ok(MIN_ENROLMENT >= MIN_N_DISPLAY,
    "a population floor below the sample floor can never bind");
});
