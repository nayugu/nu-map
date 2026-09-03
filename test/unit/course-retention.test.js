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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  normalizeKey,
  keyOfCourse,
  activeCourseCount,
  referencedCourseKeys,
  retainReferencedCourses,
  applyEditionRetention,
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

// ── The orchestrator ───────────────────────────────────────────────
//
// This is the code that used to be inline in scrape-catalog.js, where the ONLY
// way to reach it was a 29-minute full network scrape (every partial mode skips
// the write branch). A missing `readdirSync` in the import list survived
// `node --check` there. So each of these cases is a branch that previously
// could not be run at all.

const CATALOG = "/catalog.json";

/** io over an in-memory filesystem, with an optional injected fault. */
function orchIo(files, fault = {}) {
  const base = fakeIo(files, fault);
  return {
    ...base,
    exists: p => p === CATALOG ? CATALOG in files : base.exists(p),
    readFile: p => {
      if (fault.readFileThrowsAt === p) throw new Error("EIO");
      return p in files ? files[p] : base.readFile(p);
    },
  };
}

const TREE = {
  "p/2026/arts/theatre_ba/requirements.json": JSON.stringify({ keys: ["THTR1101", "DGTR5000"] }),
};

test("orchestrator › the happy path retains and reports", () => {
  const files = {
    ...TREE,
    [CATALOG]: JSON.stringify([course("THTR", "1101"), course("DGTR", "5000")]),
  };
  const out = applyEditionRetention({
    scraped: [course("THTR", "1101")],
    catalogPath: CATALOG, programRoots: ["p"], failedSubjects: new Set(),
    io: orchIo(files), now: NOW,
  });
  assert.equal(out.ok, true);
  assert.equal(out.courses.length, 2);
  assert.ok(out.lines.some(l => /1 programs reference 2 courses/.test(l)));
  assert.ok(out.lines.some(l => /Kept 1 retired course/.test(l)), out.lines.join("|"));
});

test("orchestrator › no committed catalog is not a failure", () => {
  // A fresh clone. There is nothing to retain FROM.
  const out = applyEditionRetention({
    scraped: [course("THTR", "1101")],
    catalogPath: CATALOG, programRoots: ["p"], failedSubjects: new Set(),
    io: orchIo({ ...TREE }), now: NOW,
  });
  assert.equal(out.ok, true);
  assert.deepEqual(out.courses.map(keyOfCourse), ["THTR1101"]);
  assert.ok(out.lines.some(l => /nothing to retain/.test(l)));
});

test("orchestrator › no program trees is not a failure either", () => {
  // A clone that has never run the majors scrape. Nothing to protect is a
  // different fact from "protection failed", and conflating them would either
  // cry wolf on a fresh clone or hide a real breakage.
  const out = applyEditionRetention({
    scraped: [course("THTR", "1101")],
    catalogPath: CATALOG, programRoots: ["p"], failedSubjects: new Set(),
    io: orchIo({ [CATALOG]: JSON.stringify([course("DGTR", "5000")]) }), now: NOW,
  });
  assert.equal(out.ok, true);
  assert.deepEqual(out.courses.map(keyOfCourse), ["THTR1101"]);
  assert.ok(out.lines.some(l => /No program requirements on disk/.test(l)));
});

test("orchestrator › a corrupt committed catalog degrades, it does not throw", () => {
  // THE branch that mattered and could not be reached. A throw here aborts the
  // scrape after 29 minutes of network work, with nothing written.
  const out = applyEditionRetention({
    scraped: [course("THTR", "1101")],
    catalogPath: CATALOG, programRoots: ["p"],
    failedSubjects: new Set(),
    io: orchIo({ ...TREE, [CATALOG]: "{{{ not json" }), now: NOW,
  });
  assert.equal(out.ok, false);
  assert.deepEqual(out.courses.map(keyOfCourse), ["THTR1101"], "the scrape survives intact");
  assert.ok(out.lines.some(l => /Edition retention skipped/.test(l)));
  assert.ok(out.lines.some(l => /unresolvable course references/.test(l)),
    "the warning must say what was lost, or it reads as routine");
});

test("orchestrator › an unreadable catalog file degrades", () => {
  const out = applyEditionRetention({
    scraped: [course("THTR", "1101")],
    catalogPath: CATALOG, programRoots: ["p"], failedSubjects: new Set(),
    io: orchIo({ ...TREE, [CATALOG]: "[]" }, { readFileThrowsAt: CATALOG }), now: NOW,
  });
  assert.equal(out.ok, false);
  assert.deepEqual(out.courses.map(keyOfCourse), ["THTR1101"]);
});

test("orchestrator › a partly-unreadable tree retains what it can AND says so", () => {
  const files = {
    "p/a/requirements.json": "{ broken",
    "p/b/requirements.json": JSON.stringify({ keys: ["DGTR5000"] }),
    [CATALOG]: JSON.stringify([course("DGTR", "5000")]),
  };
  const out = applyEditionRetention({
    scraped: [], catalogPath: CATALOG, programRoots: ["p"], failedSubjects: new Set(),
    io: orchIo(files), now: NOW,
  });
  assert.equal(out.ok, true);
  assert.equal(out.courses.length, 1, "the readable half still protected its course");
  assert.ok(out.lines.some(l => /unreadable/.test(l) && /not protected/.test(l)),
    "silently retaining less is the dangerous outcome — it must be reported");
});

test("orchestrator › a broken io object degrades rather than throwing", () => {
  // Defence against a caller mistake, which is precisely how this broke before:
  // `readdirSync` was not imported, so `io.readdir` threw at minute 29.
  for (const io of [null, undefined, {}, { exists: () => { throw new Error("boom"); } },
                    { exists: () => true, readdir: () => { throw new Error("boom"); } }]) {
    const out = applyEditionRetention({
      scraped: [course("THTR", "1101")],
      catalogPath: CATALOG, programRoots: ["p"], failedSubjects: new Set(), io, now: NOW,
    });
    assert.deepEqual(out.courses.map(keyOfCourse), ["THTR1101"], JSON.stringify(io));
  }
});

test("orchestrator › junk arguments return the scrape, never undefined", () => {
  for (const args of [{}, { scraped: null }, { scraped: "nope" }]) {
    const out = applyEditionRetention(args);
    assert.ok(Array.isArray(out.courses), JSON.stringify(args));
    assert.ok(Array.isArray(out.lines));
  }
});

test("orchestrator › a failed subject is passed through to the judgement", () => {
  // The caller's failedSubjects set has to actually reach retainReferencedCourses;
  // dropping it on the floor here would re-open the slander bug at the only
  // layer that knows which subjects failed.
  const files = {
    ...TREE,
    [CATALOG]: JSON.stringify([course("THTR", "1101"), course("DGTR", "5000")]),
  };
  const out = applyEditionRetention({
    scraped: [course("THTR", "1101")],
    catalogPath: CATALOG, programRoots: ["p"],
    failedSubjects: new Set(["DGTR"]),
    io: orchIo(files), now: NOW,
  });
  assert.equal(out.courses.length, 1, "DGTR is the caller's to rescue, unmarked");
  assert.ok(!out.lines.some(l => /Kept 1 retired/.test(l)));
});

// ── How the caller wires it up ─────────────────────────────────────
//
// Two properties of scrape-catalog.js that the pure functions above cannot
// hold on their own, and that have no seam to drive them through: the module
// is called from the middle of a 700-line top-level script whose inputs are a
// live network scrape. What is worth protecting is the DECISION, and both
// decisions are visible in the source.

const SCRAPER = readFileSync(
  fileURLToPath(new URL("../../scripts/scrape-catalog.js", import.meta.url)), "utf8");

test("wiring › retention is applied strictly AFTER the shrink rail", () => {
  // Load-bearing in both directions, and silent if reversed.
  //
  //   before the rail → the union inflates the count past the 98% floor, so an
  //                     edition roll sails through the one guard whose entire
  //                     purpose is to make an operator look at it;
  //   after the rail  → correct, and the rail additionally has to count only
  //                     non-retired courses on the COMMITTED side or it goes
  //                     on refusing every month forever.
  const rail = SCRAPER.indexOf("Refusing to write:");
  const retention = SCRAPER.indexOf("applyEditionRetention({");
  // Anchored to the write that FOLLOWS retention: --rotate and --subjects
  // write the same file earlier in this script, so a bare indexOf finds one of
  // those and the assertion becomes a coin toss.
  const write = SCRAPER.indexOf("writeFileSync(CATALOG_OUT,", retention);
  assert.ok(rail > 0 && retention > 0 && write > 0, "anchors moved — re-read this test");
  assert.ok(rail < retention,
    "retention now runs BEFORE the shrink rail, which disarms the rail on exactly the "
    + "edition roll it exists to catch");
  assert.ok(retention < write, "retention must happen before the snapshot is written");
});

test("wiring › the shrink rail counts only non-retired courses on BOTH sides", () => {
  assert.match(SCRAPER, /const prevCount = activeCourseCount\(/,
    "the committed side counts retained courses again — next month's identical scrape "
    + "then reads as a ~700-course shrink and the run refuses, every month, forever");
  assert.match(SCRAPER, /const liveCount = activeCourseCount\(out\)/,
    "the scraped side must use the same counter, so the comparison stays like-for-like "
    + "if retention is ever moved");
  assert.doesNotMatch(SCRAPER, /prevCount > 0 && out\.length < floor/,
    "the rail compares raw lengths again");
});

test("wiring › both partial-merge paths clear a stale retirement marker", () => {
  // `merged = { ...prev, … }` spreads the previous entry wholesale, so a
  // revived course keeps `retired: true` — and that is not cosmetic:
  // activeCourseCount excludes retired courses, so a live course badged as
  // gone under-counts the shrink rail too.
  //
  // There are TWO near-identical merges (runRotate and runSubjects) and there
  // have been since before this change, so a fix that lands in one is a fix
  // that is half-applied. That is the hazard CLAUDE.md names for the two
  // scrapeProgram copies, and this is what makes it checkable.
  const merges = SCRAPER.split(/const merged = \{/).slice(1);
  assert.equal(merges.length, 2,
    `expected 2 partial-merge blocks, found ${merges.length} — if a third was added it needs `
    + `the same marker reset; if they were unified, simplify this test`);
  for (const [i, body] of merges.entries()) {
    const block = body.slice(0, body.indexOf("};"));
    assert.match(block, /retired: undefined, retiredSince: undefined/,
      `partial-merge block ${i + 1} spreads ...prev without clearing the retirement marker, `
      + `so a course NEU brought back stays badged as gone`);
  }
});

test("wiring › the partial paths still cannot judge a retirement", () => {
  // --rotate and --subjects scrape ONE subject, so they have no evidence about
  // any other, and --dry-run/--subject write nothing. They must never reach
  // retention: doing so would retire the entire rest of the catalog. Both
  // short-circuit with process.exit(0) before the write guard, and the third
  // is excluded by PARTIAL.
  const rotate = SCRAPER.indexOf("await runRotate();");
  const subjects = SCRAPER.indexOf("await runSubjects(SUBJECTS);");
  const retention = SCRAPER.indexOf("applyEditionRetention({");
  assert.ok(rotate > 0 && subjects > 0);
  assert.match(SCRAPER.slice(rotate, rotate + 120), /process\.exit\(0\)/,
    "--rotate no longer short-circuits, so it would reach retention with one subject of evidence");
  assert.match(SCRAPER.slice(subjects, subjects + 120), /process\.exit\(0\)/,
    "--subjects no longer short-circuits, so it would reach retention with a subset of evidence");
  assert.ok(rotate < retention && subjects < retention);
  assert.match(SCRAPER, /const PARTIAL = DRY_RUN \|\| SUBJECT \|\| SUBJECTS;/,
    "PARTIAL no longer covers the write-nothing modes");
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
