// ═══════════════════════════════════════════════════════════════════
// Retention has to be hostile-proof in a specific direction.
//
// It runs inside an unattended monthly job that REPLACES the course catalog,
// and its inputs are a live scrape and whatever is on disk. So these tests are
// written against the ways it could do damage rather than the way it works:
//
//   - assert a retirement it has no evidence for (a subject that failed to load),
//   - duplicate an entry the caller already rescued,
//   - keep a stale marker on a course NEU brought back,
//   - re-date a retirement every month so the marker means nothing,
//   - grow without bound,
//   - or throw, and turn a data-quality feature into a refused scrape.
//
// The last one is the reason nearly every case here feeds it junk.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeKey,
  keyOfCourse,
  activeCourseCount,
  referencedCourseKeys,
  retainReferencedCourses,
} from "../../scripts/lib/course-retention.js";

const course = (subject, number, extra = {}) => ({ subject, number, title: `${subject} ${number}`, ...extra });

// ── Keys ───────────────────────────────────────────────────────────

test("key › the two key shapes in the repo reconcile", () => {
  // The whole point: the trees say ACCT1201, the snapshot map says "ACCT 1201".
  assert.equal(normalizeKey("ACCT", "1201"), "ACCT1201");
  assert.equal(normalizeKey(" acct ", " 1201 "), "ACCT1201");
  assert.equal(normalizeKey("acct", 1201), "ACCT1201");
});

test("key › an unusable half yields null, never a partial key", () => {
  // "ACCT" + undefined must not become "ACCTundefined", which would be a key
  // that matches nothing and silently protects nothing.
  for (const [s, n] of [[null, "1201"], ["ACCT", null], [undefined, undefined],
                        ["", "1201"], ["ACCT", ""], ["  ", " "]]) {
    assert.equal(normalizeKey(s, n), null, `${s} / ${n}`);
  }
});

test("key › keyOfCourse survives anything the snapshot could hold", () => {
  for (const bad of [null, undefined, 0, "", "ACCT 1201", [], {}, { subject: "ACCT" }, { number: "1201" }]) {
    assert.equal(keyOfCourse(bad), null, JSON.stringify(bad));
  }
  assert.equal(keyOfCourse(course("ACCT", "1201")), "ACCT1201");
});

// ── The rail's counter ─────────────────────────────────────────────

test("rail › the shrink rail counts only what we actually scraped", () => {
  // THE trap. Retention makes the file bigger; if the rail counts retained
  // courses on the committed side, next month's identical scrape reads as a
  // 700-course shrink and the run refuses forever.
  const committed = [
    course("ACCT", "1201"),
    course("ACCT", "1202"),
    course("DGTR", "5000", { retired: true, retiredSince: "2026-10-01" }),
    course("EAI", "6000", { retired: true, retiredSince: "2026-10-01" }),
  ];
  assert.equal(committed.length, 4);
  assert.equal(activeCourseCount(committed), 2,
    "a retired course is evidence about an OLDER catalog and cannot count toward this one");
});

test("rail › the counter never throws and never over-counts junk", () => {
  assert.equal(activeCourseCount(null), 0);
  assert.equal(activeCourseCount(undefined), 0);
  assert.equal(activeCourseCount("nope"), 0);
  assert.equal(activeCourseCount([null, undefined, 0, "x", {}]), 1, "only the object counts");
  assert.equal(activeCourseCount([{ retired: false }]), 1, "retired:false is active");
});

// ── Reading the trees ──────────────────────────────────────────────

/** A fake tree: { "path": <json string | throw sentinel> }. */
function fakeIo(files, { readdirThrowsAt = null, keysThrowFor = null } = {}) {
  const dirs = new Map();
  for (const path of Object.keys(files)) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join("/");
      const child = parts[i];
      const isDir = i < parts.length - 1;
      if (!dirs.has(parent)) dirs.set(parent, new Map());
      dirs.get(parent).set(child, isDir);
    }
  }
  return {
    exists: p => dirs.has(p) || p in files,
    readdir: p => {
      if (readdirThrowsAt && p === readdirThrowsAt) throw new Error("EACCES");
      return [...(dirs.get(p) ?? new Map())].map(([name, isDirectory]) => ({
        name, isDirectory: () => isDirectory,
      }));
    },
    readFile: p => {
      if (!(p in files)) throw new Error("ENOENT");
      return files[p];
    },
    courseKeysOf: program => {
      if (keysThrowFor && program?.id === keysThrowFor) throw new Error("bad node");
      return program?.keys ?? [];
    },
    warn: () => {},
  };
}

test("trees › walks nested editions and collects every named course", () => {
  const io = fakeIo({
    "p/undergraduate/2026/arts/theatre_ba/requirements.json": JSON.stringify({ keys: ["THTR1101", "THTR2345"] }),
    "p/undergraduate/2027/arts/theatre_ba/requirements.json": JSON.stringify({ keys: ["THTR1101"] }),
    "p/graduate/2026/business/acct_msa/requirements.json": JSON.stringify({ keys: ["ACCT5230"] }),
  });
  const out = referencedCourseKeys(["p"], io);
  assert.equal(out.programs, 3);
  assert.equal(out.unreadable, 0);
  assert.deepEqual([...out.keys].sort(), ["ACCT5230", "THTR1101", "THTR2345"]);
});

test("trees › a missing root contributes nothing and does not throw", () => {
  const out = referencedCourseKeys(["nope"], fakeIo({}));
  assert.deepEqual([...out.keys], []);
  assert.equal(out.programs, 0);
});

test("trees › no roots at all is answerable", () => {
  for (const dirs of [null, undefined, []]) {
    const out = referencedCourseKeys(dirs, fakeIo({}));
    assert.deepEqual([...out.keys], []);
  }
});

test("trees › unreadable JSON is COUNTED, not fatal", () => {
  // Degrade to retaining less; never to writing nothing. A throw here would
  // turn one corrupt file into a refused monthly scrape.
  const io = fakeIo({
    "p/a/requirements.json": "{ this is not json",
    "p/b/requirements.json": JSON.stringify({ keys: ["CS2500"] }),
  });
  const out = referencedCourseKeys(["p"], io);
  assert.deepEqual([...out.keys], ["CS2500"]);
  assert.equal(out.unreadable, 1);
  assert.equal(out.programs, 2, "both were attempted");
});

test("trees › an unlistable directory is counted, not fatal", () => {
  const io = fakeIo({ "p/locked/requirements.json": JSON.stringify({ keys: ["CS2500"] }) },
                    { readdirThrowsAt: "p/locked" });
  const out = referencedCourseKeys(["p"], io);
  assert.deepEqual([...out.keys], []);
  assert.equal(out.unreadable, 1);
});

test("trees › an accessor that throws on one program does not lose the others", () => {
  const io = fakeIo({
    "p/a/requirements.json": JSON.stringify({ id: "boom", keys: ["X1000"] }),
    "p/b/requirements.json": JSON.stringify({ keys: ["CS2500"] }),
  }, { keysThrowFor: "boom" });
  const out = referencedCourseKeys(["p"], io);
  assert.deepEqual([...out.keys], ["CS2500"]);
  assert.equal(out.unreadable, 1);
});

test("trees › a malformed key protects NOTHING rather than something fictional", () => {
  // `courseKey(undefined, undefined)` is the string "undefinedundefined". A
  // template literal over two untrusted fields is how a key like that appears,
  // and admitting it would put a course that does not exist into the protected
  // set — where it is inert, but it also makes the count a lie.
  const io = fakeIo({
    "p/a/requirements.json": JSON.stringify({
      keys: ["undefinedundefined", "", null, undefined, "1234", "CS", "  ", "CS 2500", "cs2500"],
    }),
  });
  const out = referencedCourseKeys(["p"], io);
  assert.deepEqual([...out.keys].sort(), ["CS2500"], "only the two real spellings of one real course");
});

test("trees › files that are not requirements.json are ignored", () => {
  const io = fakeIo({
    "p/a/plan.json": JSON.stringify({ keys: ["NOPE1000"] }),
    "p/a/requirements.json": JSON.stringify({ keys: ["CS2500"] }),
  });
  assert.deepEqual([...referencedCourseKeys(["p"], io).keys], ["CS2500"]);
});

// ── The union ──────────────────────────────────────────────────────

const NOW = "2026-10-01";

test("union › the whole point: a retired course a shipped edition still needs is kept", () => {
  const out = retainReferencedCourses({
    scraped: [course("ACCT", "1201")],
    previous: [course("ACCT", "1201"), course("DGTR", "5000")],
    referenced: new Set(["ACCT1201", "DGTR5000"]),
    now: NOW,
  });
  assert.equal(out.courses.length, 2);
  assert.equal(out.retained.length, 1);
  assert.deepEqual(out.retained[0].retired, true);
  assert.equal(out.retained[0].retiredSince, NOW);
  assert.equal(out.retained[0].title, "DGTR 5000", "the course's own data comes with it");
});

test("union › a retired course NOTHING requires is dropped — this is the growth bound", () => {
  const out = retainReferencedCourses({
    scraped: [course("ACCT", "1201")],
    previous: [course("ACCT", "1201"), course("DGTR", "5000")],
    referenced: new Set(["ACCT1201"]),
    now: NOW,
  });
  assert.equal(out.courses.length, 1);
  assert.deepEqual(out.dropped, ["DGTR5000"]);
});

test("union › dropping an old edition drops its retained courses on the NEXT run", () => {
  // Self-pruning by construction, not by a cleanup step. Retention is
  // recomputed against the trees every run, so the set can only shrink when
  // the trees do.
  const committed = [course("ACCT", "1201"),
                     course("DGTR", "5000", { retired: true, retiredSince: "2026-10-01" })];
  const out = retainReferencedCourses({
    scraped: [course("ACCT", "1201")],
    previous: committed,
    referenced: new Set(["ACCT1201"]),      // the 2026 tree is gone
    now: "2026-12-01",
  });
  assert.deepEqual(out.courses.map(keyOfCourse), ["ACCT1201"]);
  assert.deepEqual(out.dropped, ["DGTR5000"]);
});

test("union › a FAILED subject is never retired — it is already rescued, unmarked", () => {
  // The term-history lesson: absent because we could not read it is not the
  // same fact as absent because it is gone. Marking it would slander a live
  // course, and adding it would duplicate the caller's own rescue.
  const out = retainReferencedCourses({
    scraped: [course("ACCT", "1201")],
    previous: [course("ACCT", "1201"), course("SOC", "1101")],
    referenced: new Set(["ACCT1201", "SOC1101"]),
    failedSubjects: new Set(["SOC"]),
    now: NOW,
  });
  assert.deepEqual(out.retained, [], "the caller carries SOC forward itself");
  assert.deepEqual(out.dropped, [], "and it is not reported as dropped either — it was not judged");
  assert.equal(out.courses.length, 1);
});

test("union › a failed subject is matched case- and space-insensitively", () => {
  const out = retainReferencedCourses({
    scraped: [],
    previous: [course(" soc ", "1101")],
    referenced: new Set(["SOC1101"]),
    failedSubjects: new Set(["SOC"]),
    now: NOW,
  });
  assert.deepEqual(out.retained, []);
});

test("union › a course NEU brings back loses its marker", () => {
  const out = retainReferencedCourses({
    scraped: [course("DGTR", "5000")],
    previous: [course("DGTR", "5000", { retired: true, retiredSince: "2026-10-01" })],
    referenced: new Set(["DGTR5000"]),
    now: "2027-01-01",
  });
  assert.deepEqual(out.revived, ["DGTR5000"]);
  assert.equal(out.courses.length, 1);
  assert.ok(!("retired" in out.courses[0]), "a live course must not be badged as gone");
  assert.ok(!("retiredSince" in out.courses[0]));
});

test("union › a freshly-scraped course carrying a marker is scrubbed", () => {
  // Defence in depth: the caller currently carries only nuPath forward from the
  // previous entry, but if that ever spreads the whole record, a live course
  // would arrive pre-marked and this is the only thing standing in the way.
  const out = retainReferencedCourses({
    scraped: [course("CS", "2500", { retired: true, retiredSince: "2020-01-01" })],
    previous: [],
    referenced: new Set(),
    now: NOW,
  });
  assert.ok(!("retired" in out.courses[0]));
  assert.ok(!("retiredSince" in out.courses[0]));
  assert.equal(out.courses[0].title, "CS 2500", "scrubbing the marker keeps the course");
});

test("union › retiredSince is the date it HAPPENED, not the date last noticed", () => {
  // A marker re-dated every month is a marker that means nothing.
  const out = retainReferencedCourses({
    scraped: [],
    previous: [course("DGTR", "5000", { retired: true, retiredSince: "2026-10-01" })],
    referenced: new Set(["DGTR5000"]),
    now: "2027-06-01",
  });
  assert.equal(out.retained[0].retiredSince, "2026-10-01");
});

test("union › a junk retiredSince is replaced rather than carried", () => {
  for (const bad of [null, "", 0, {}, []]) {
    const out = retainReferencedCourses({
      scraped: [],
      previous: [course("DGTR", "5000", { retired: true, retiredSince: bad })],
      referenced: new Set(["DGTR5000"]),
      now: NOW,
    });
    assert.equal(out.retained[0].retiredSince, NOW, JSON.stringify(bad));
  }
});

test("union › duplicates in the previous snapshot do not become duplicate entries", () => {
  const out = retainReferencedCourses({
    scraped: [],
    previous: [course("DGTR", "5000"), course("DGTR", "5000"), course("dgtr", " 5000 ")],
    referenced: new Set(["DGTR5000"]),
    now: NOW,
  });
  assert.equal(out.retained.length, 1);
  assert.equal(out.courses.length, 1);
});

test("union › a course in BOTH sets appears once, from the fresh scrape", () => {
  const out = retainReferencedCourses({
    scraped: [course("ACCT", "1201", { credits: 4 })],
    previous: [course("ACCT", "1201", { credits: 3 })],
    referenced: new Set(["ACCT1201"]),
    now: NOW,
  });
  assert.equal(out.courses.length, 1);
  assert.equal(out.courses[0].credits, 4, "the current catalog wins for a course that still exists");
});

test("union › no program trees means retain nothing — exactly the old behaviour", () => {
  // The safe degradation. If the trees cannot be read, retention must not
  // invent protection, and must not refuse either.
  const out = retainReferencedCourses({
    scraped: [course("ACCT", "1201")],
    previous: [course("DGTR", "5000")],
    referenced: new Set(),
    now: NOW,
  });
  assert.equal(out.courses.length, 1);
  assert.deepEqual(out.retained, []);
});

test("union › junk in every argument still returns the scrape unchanged", () => {
  // This function must never be the reason a scrape writes nothing.
  const scraped = [course("ACCT", "1201")];
  for (const args of [
    {},
    { scraped },
    { scraped, previous: null, referenced: null, now: null },
    { scraped, previous: "nope", referenced: "nope", failedSubjects: "nope", now: 7 },
    { scraped, previous: [null, undefined, 0, "x", {}, { subject: "X" }], referenced: new Set(["X1"]) },
    { scraped: null, previous: null },
  ]) {
    const out = retainReferencedCourses(args);
    assert.ok(Array.isArray(out.courses), JSON.stringify(args));
    assert.ok(Array.isArray(out.retained));
    assert.ok(out.courses.every(c => c && typeof c === "object"));
  }
  assert.deepEqual(retainReferencedCourses({}).courses, []);
});

test("union › a missing `now` still produces a usable date", () => {
  const out = retainReferencedCourses({
    scraped: [],
    previous: [course("DGTR", "5000")],
    referenced: new Set(["DGTR5000"]),
  });
  assert.match(out.retained[0].retiredSince, /^\d{4}-\d{2}-\d{2}$/);
});

test("union › the input arrays are not mutated", () => {
  // The caller writes `previous` nowhere, but it does read it again for the
  // rail. A marker written into the caller's own array would corrupt that.
  const previous = [course("DGTR", "5000")];
  const snapshot = JSON.stringify(previous);
  retainReferencedCourses({
    scraped: [], previous, referenced: new Set(["DGTR5000"]), now: NOW,
  });
  assert.equal(JSON.stringify(previous), snapshot);
});

test("union › retention is idempotent across runs", () => {
  // Run it twice against its own output with an unchanged catalog: the second
  // run must be a no-op. If it is not, the file churns every month.
  const referenced = new Set(["ACCT1201", "DGTR5000"]);
  const first = retainReferencedCourses({
    scraped: [course("ACCT", "1201")],
    previous: [course("ACCT", "1201"), course("DGTR", "5000")],
    referenced, now: NOW,
  });
  const second = retainReferencedCourses({
    scraped: [course("ACCT", "1201")],
    previous: first.courses,
    referenced, now: "2026-11-01",
  });
  assert.deepEqual(second.courses, first.courses);
  assert.deepEqual(second.revived, []);
  assert.deepEqual(second.dropped, []);
});
