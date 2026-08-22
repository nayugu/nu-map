// CONTRACT · src/core/healthBeacon.js › what may leave the browser
//
// privacy.html says NU Map does not use tracking networks and does not attach
// an identity or a device to anything it collects. The health beacon is the
// only thing in the app that sends anything about a VISIT rather than about a
// user's explicit action, so it is the one place that promise could quietly
// stop being true — and it would stop being true by accident, in a diff that
// looked like an improvement ("include the error message, it'll help debug").
//
// So these tests are adversarial rather than confirming. They do not check that
// a well-formed input produces a well-formed payload; they take the things that
// must never escape — a plan, a course code, a file path, a stack trace, a
// device id, a precise timing — put each one where it would realistically
// appear, and assert that no part of it survives into the payload.
//
// The design being defended, from src/core/healthBeacon.js:
//   · six fixed keys, closed vocabularies, no free text
//   · no identifier of any kind, so two beacons are not linkable
//   · no client clock; timings bucketed
//   · classify() is the redaction boundary: anything in, one of eight words out
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPayload, classify, shouldSend, bucketMs, engineOf,
  OUTCOMES, PHASES, ENGINES, MS_BUCKETS, SAMPLE, BEACON_VERSION,
} from "../../src/core/healthBeacon.js";
import * as receiver from "../../cloudflare/health-beacon/src/index.js";

// ── The exact shape ─────────────────────────────────────────────────

const KEYS = ["v", "o", "p", "ms", "b", "e"];

test("a payload has exactly six keys, whatever it is built from", () => {
  // Includes the hostile cases below, so a leak cannot hide as an extra key.
  const inputs = [
    { outcome: "ok", phase: "mount" },
    { outcome: "render-crash", phase: "mount", ms: 1234, build: "index-abc123.js", ua: "Mozilla/5.0" },
    { outcome: "chunk-dead", phase: "bundle", ms: 0, build: null, ua: "" },
    { outcome: "storage-full", phase: "data", ms: 9e9, build: "x".repeat(64), ua: "??" },
  ];
  for (const i of inputs) {
    const p = buildPayload(i);
    assert.ok(p, `expected a payload for ${i.outcome}`);
    assert.deepEqual(Object.keys(p).sort(), [...KEYS].sort());
    assert.equal(p.v, BEACON_VERSION);
  }
});

test("an unknown outcome produces no payload at all", () => {
  // Fail closed. A beacon that invents an outcome for an input it does not
  // recognise is a beacon whose vocabulary is not actually closed.
  for (const o of ["", "OK", "ok ", "custom", "<script>", null, undefined, 0, {}]) {
    assert.equal(buildPayload({ outcome: o, phase: "mount" }), null, `outcome ${JSON.stringify(o)}`);
  }
});

// ── The redaction boundary ──────────────────────────────────────────

// Things that genuinely appear in this app's errors and must never be sent.
// Each is a real shape: a course code, a program folder, a plan name a student
// typed, an absolute path with a username in it, a share token, a stack frame.
const SECRETS = [
  "CS 3500",
  "EECE4792",
  "public_policy_phdadvancedentry_(boston)",
  "My Plan — Fall 2027 transfer",
  "/Users/matthew/Downloads/05 Personal Projects/NUMAP/nu-map/src/context/PlannerContext.jsx",
  "gu.ma@northeastern.edu",
  "nu-map-mcp-session=3f9c1e2a-77b4-4a1d-9e55-6c0f2ab41d88",
  "at PlannerApp (index-efHGYLEJ.js:41273:19)",
  "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
];

test("nothing from an error message reaches the payload", () => {
  for (const secret of SECRETS) {
    // Every realistic carrier: the message, the name, a bare string throw,
    // a nested cause, and an object masquerading as an Error.
    const carriers = [
      new Error(secret),
      Object.assign(new Error("boom"), { name: secret }),
      secret,
      Object.assign(new Error("wrapper"), { cause: new Error(secret) }),
      { message: secret, stack: secret },
    ];
    for (const err of carriers) {
      const outcome = classify(err, { phase: "mount" });
      assert.ok(OUTCOMES.includes(outcome), `classify returned "${outcome}"`);
      const payload = buildPayload({ outcome, phase: "mount", ms: 100, build: null, ua: "" });
      const wire = JSON.stringify(payload);
      assert.ok(
        !wire.includes(secret),
        `secret leaked into the payload: ${secret}\n  via ${wire}`,
      );
      // Substring-of-a-substring too: a truncated path is still a path.
      for (const frag of secret.split(/[\s/@.]+/).filter((f) => f.length >= 6)) {
        assert.ok(!wire.includes(frag), `fragment "${frag}" leaked: ${wire}`);
      }
    }
  }
});

test("classify is total — it never throws and always returns a known outcome", () => {
  const hostile = [
    undefined, null, 0, -1, NaN, Infinity, "", "  ", [], {}, new Map(),
    Symbol("x"), () => {}, new Proxy({}, { get() { throw new Error("trap"); } }),
    { get message() { throw new Error("getter blows up"); } },
    { message: { toString() { throw new Error("toString blows up"); } } },
  ];
  // Described by INDEX, never by value. Stringifying the input is itself a
  // property read, so the obvious `classify(${h})` in an assertion message
  // makes the test throw on exactly the inputs it was written to check — which
  // it did, and which is a neat demonstration of why classify has to guard
  // every read rather than trusting that a throwable behaves like one.
  hostile.forEach((h, i) => {
    let out;
    try {
      out = classify(h, { phase: "mount" });
    } catch (err) {
      assert.fail(`classify threw on hostile input #${i}: ${err.message}`);
    }
    assert.ok(OUTCOMES.includes(out), `hostile input #${i} produced outcome "${out}"`);
  });
});

// ── No identifier, no clock ─────────────────────────────────────────

test("two payloads built from identical inputs are byte-identical", () => {
  // The property that makes beacons unlinkable: nothing per-call, no random
  // id, no counter, no timestamp. If anything unique were added, these would
  // differ — which is precisely how such a field would be caught.
  const args = { outcome: "ok", phase: "mount", ms: 900, build: "index-a.js", ua: "Mozilla/5.0 Chrome/120" };
  const a = JSON.stringify(buildPayload(args));
  const b = JSON.stringify(buildPayload(args));
  assert.equal(a, b);
});

test("a raw millisecond figure never survives — only a bucket", () => {
  // Adjacent-but-distinct timings must collapse together. If they did not, the
  // timing would be a high-entropy field and therefore a fingerprint.
  const distinct = new Set();
  for (let ms = 0; ms <= 20000; ms += 7) distinct.add(bucketMs(ms));
  assert.ok(distinct.size <= MS_BUCKETS.length + 1,
    `bucketMs produced ${distinct.size} distinct values — expected at most ${MS_BUCKETS.length + 1}`);
  for (const v of distinct) assert.ok(MS_BUCKETS.includes(v) || v === "15000+", `stray bucket ${v}`);

  // And two timings a millisecond apart inside a bucket are indistinguishable.
  assert.equal(bucketMs(1500), bucketMs(1501));
  assert.equal(bucketMs(0), bucketMs(499));
});

test("bucketMs refuses anything that is not a usable duration", () => {
  for (const bad of [undefined, null, NaN, Infinity, -Infinity, -1, "900", {}, []]) {
    assert.equal(bucketMs(bad), null, `bucketMs(${String(bad)})`);
  }
});

// ── The user agent is reduced, not forwarded ────────────────────────

test("a user agent collapses to one of four families, losing every version", () => {
  // Real UA strings carry a build number, an OS patch level, and on some
  // embedded webviews a device model — jointly enough to identify a person in
  // a cohort this size. Only the family may survive.
  const uas = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.127 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0",
    "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile Safari/537.36",
    "SomeCrawler/1.0 (+http://example.com/bot)",
  ];
  for (const ua of uas) {
    const e = engineOf(ua);
    assert.ok(ENGINES.includes(e), `engineOf gave "${e}"`);
    const wire = JSON.stringify(buildPayload({ outcome: "ok", phase: "mount", ua }));
    // No version number and no device model may appear anywhere.
    assert.ok(!/\d+\.\d+/.test(wire), `a version number survived: ${wire}`);
    assert.ok(!wire.includes("SM-S918B"), `a device model survived: ${wire}`);
  }
});

test("engineOf is total over junk", () => {
  for (const junk of [undefined, null, "", 0, {}, [], " ", "x".repeat(10000)]) {
    assert.ok(ENGINES.includes(engineOf(junk)), `engineOf(${String(junk)})`);
  }
});

// ── The build id is the one field read from the DOM ─────────────────

test("a build id that is not a plain asset filename is dropped", () => {
  const bad = [
    "../../etc/passwd",
    "index-a.js?token=secret",
    "index-a.js#/plan/CS3500",
    "<script>alert(1)</script>",
    "a".repeat(65),
    "",
    "has space.js",
    "https://evil.example/x.js",
  ];
  for (const b of bad) {
    const p = buildPayload({ outcome: "ok", phase: "mount", build: b });
    assert.equal(p.b, null, `build "${b}" should have been dropped, got ${p.b}`);
  }
  // The real shape still survives — a check that rejects everything is not a
  // check, it is a broken field.
  assert.equal(buildPayload({ outcome: "ok", phase: "mount", build: "index-efHGYLEJ.js" }).b,
    "index-efHGYLEJ.js");
});

// ── Sampling is a rate, and it is a ceiling ─────────────────────────

test("sampling holds its rate over many draws", () => {
  // Asserted as a proportion rather than by reading the constant, because the
  // failure mode is an off-by-one in the comparison (`<=` vs `<`, or comparing
  // against the wrong class), which reading the constant cannot catch.
  const draw = (outcome, n) => {
    let sent = 0;
    // A deterministic sweep across [0,1) rather than Math.random: it makes the
    // test exact instead of flaky, and it probes the boundary directly.
    for (let i = 0; i < n; i++) if (shouldSend(outcome, () => i / n)) sent++;
    return sent / n;
  };
  const n = 100000;
  assert.ok(Math.abs(draw("ok", n) - SAMPLE.ok) < 0.001, `ok rate was ${draw("ok", n)}`);
  for (const o of OUTCOMES.filter((x) => x !== "ok")) {
    assert.ok(Math.abs(draw(o, n) - SAMPLE.failure) < 0.001, `${o} rate was ${draw(o, n)}`);
  }
});

test("failure sampling stays a ceiling under the stated peak load", () => {
  // The quota argument in the module header, as a test. Free plan is 100,000
  // Worker requests/day; the target peak is 10,000 users in one minute. A
  // total outage means every one of them reports.
  const PEAK_USERS = 10_000;
  const DAILY_QUOTA = 100_000;
  const worstMinute = PEAK_USERS * SAMPLE.failure;
  assert.ok(worstMinute <= DAILY_QUOTA / 10,
    `a one-minute total outage would spend ${worstMinute} of ${DAILY_QUOTA} daily requests — `
    + `more than a tenth of the budget, so sustained failure would blind the receiver`);
  // And the ordinary case must be far cheaper still.
  assert.ok(PEAK_USERS * SAMPLE.ok <= worstMinute / 5);
});

test("the sample rate cannot exceed 1 or drop to 0", () => {
  // 0 would silently disable reporting; 1 would remove the ceiling the quota
  // maths depends on. Both are plausible edits.
  for (const r of Object.values(SAMPLE)) {
    assert.ok(r > 0 && r < 1, `sample rate ${r} is outside (0,1)`);
  }
});

// ── The two copies of the vocabulary must not drift ─────────────────

test("the receiver's vocabularies match the browser's exactly", () => {
  // cloudflare/health-beacon deliberately re-declares these rather than
  // importing them, because it must not trust the client to have run our code.
  // The cost of that decision is drift, and this is the test that pays it: add
  // an outcome in one place and forget the other, and every beacon carrying it
  // is silently dropped at the door.
  assert.deepEqual([...receiver.OUTCOMES].sort(), [...OUTCOMES].sort());
  assert.deepEqual([...receiver.PHASES].sort(), [...PHASES].sort());
  assert.deepEqual([...receiver.ENGINES].sort(), [...ENGINES].sort());
  assert.deepEqual(
    [...receiver.MS_BUCKETS].map(String).sort(),
    [...MS_BUCKETS, "15000+", null].map(String).sort(),
  );
});

test("every payload the browser can build is accepted by the receiver", () => {
  // The round trip. Generated exhaustively rather than sampled: the whole
  // space is 8 x 4 x 4 x 9 = 1,152 combinations, small enough to just check.
  let checked = 0;
  for (const o of OUTCOMES) {
    for (const p of PHASES) {
      for (const ua of ["Chrome/1", "Firefox/1", "Safari/1", "bot"]) {
        for (const ms of [...MS_BUCKETS, null]) {
          const built = buildPayload({ outcome: o, phase: p, ms, build: "index-a1.js", ua });
          assert.ok(receiver.validate(built), `receiver rejected ${JSON.stringify(built)}`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 1000, `only checked ${checked} combinations`);
});

test("the receiver rejects everything that is not one of our payloads", () => {
  const junk = [
    null, undefined, 0, "", "{}", [], [1, 2, 3],
    { v: 2, o: "ok", p: "mount", e: "chromium", ms: null, b: null },        // wrong version
    { v: 1, o: "ok", p: "mount", e: "chromium", ms: 1234, b: null },        // raw ms, not a bucket
    { v: 1, o: "custom", p: "mount", e: "chromium", ms: null, b: null },    // outcome off-vocabulary
    { v: 1, o: "ok", p: "everywhere", e: "chromium", ms: null, b: null },   // phase off-vocabulary
    { v: 1, o: "ok", p: "mount", e: "Mozilla/5.0 (iPhone)", ms: null, b: null }, // a whole UA
  ];
  for (const j of junk) {
    assert.equal(receiver.validate(j), null, `receiver accepted ${JSON.stringify(j)}`);
  }
});

test("an over-long build id is neutralised, not used to reject the beacon", () => {
  // This test originally asserted rejection and the code disagreed. The code
  // was right. The danger of an unbounded `b` is that it becomes part of a
  // storage KEY, so a hostile client could grow a shard's counter map without
  // limit; nulling the field removes that danger completely. Rejecting the
  // whole beacon would additionally throw away a real outcome, which is the
  // one thing this system exists to count — and it would hand an attacker a
  // way to suppress reporting rather than merely to be ignored.
  const out = receiver.validate({
    v: 1, o: "render-crash", p: "mount", e: "chromium", ms: null, b: "x".repeat(200),
  });
  assert.ok(out, "the outcome should still be counted");
  assert.equal(out.b, null, "the unbounded value must never reach a storage key");
  assert.equal(out.o, "render-crash");
});

test("the receiver drops unknown fields rather than rejecting the beacon", () => {
  // A newer client must not be silently blinded by an older receiver: the
  // outcome is what matters and it should still be counted. But the extra
  // field must not be stored either, or the vocabulary stops being closed.
  const out = receiver.validate({
    v: 1, o: "ok", p: "mount", e: "chromium", ms: 500, b: "index-a.js",
    plan: "CS 3500, EECE 4792", sessionId: "abc-123", t: Date.now(),
  });
  assert.ok(out, "a beacon with extra fields should still count");
  assert.deepEqual(Object.keys(out).sort(), [...KEYS].sort());
  const wire = JSON.stringify(out);
  assert.ok(!wire.includes("CS 3500") && !wire.includes("abc-123"));
});
