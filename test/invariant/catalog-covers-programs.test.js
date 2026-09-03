// ═══════════════════════════════════════════════════════════════════
// The shipped catalog must resolve every course the shipped programs require.
//
// ── Why this is the ratchet and not the fix ─────────────────────────
//
// `scripts/lib/course-retention.js` is the fix: it keeps a retired course
// while some shipped program edition still names it. This test is the thing
// that stops the fix from silently rotting, and it exists because the defect
// it guards has a period of ONE YEAR. A catalog edition rolls once, quietly,
// in September; the breakage lands on whichever monthly run first writes the
// new catalog; and nothing a student can see says "this requirement is
// unresolvable" — the row simply never ticks.
//
// A bug with a one-year period cannot be held by anyone remembering it. So the
// build refuses to ship a program tree the course list cannot satisfy, in the
// same spirit as `/data` search refusing to ship an unsearchable page.
//
// ── Why an allowlist and not a count ───────────────────────────────
//
// The floor is not zero, and never was. Three graduate education courses are
// named by a program page and appear nowhere in the course catalog — NEU's own
// inconsistency, not a hole in our reading and not something we can fix by
// scraping harder. (EDU 6333 is the shape: it exists only inside another
// course's `Prerequisite(s):` line.)
//
// A COUNT of three would pass while three completely different courses
// dangled, which is exactly the failure this is meant to catch. Naming them is
// strictly stronger, and the list is small enough to read. It is expected to
// change at an edition roll — that is a re-adjudication, and the assertion
// message has to say so, because a hard stop with no documented recovery gets
// recovered by whatever is fastest.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { courseKeysOf } from "../../scripts/lib/major-verify.js";
import { referencedCourseKeys, keyOfCourse, activeCourseCount } from "../../scripts/lib/course-retention.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Courses a shipped program requires that the catalog has never listed.
 *
 * Not a budget — a named list. Adding to it is a claim that NEU's own pages
 * disagree with NEU's own course catalog, which is checkable by opening the
 * page, and which nothing we do can repair.
 */
const KNOWN_UNRESOLVABLE = new Set([
  "EDU6182",
  "EDU6333",
  "EDU6340",
]);

const io = {
  exists: existsSync,
  readdir: p => readdirSync(p, { withFileTypes: true }),
  readFile: p => readFileSync(p, "utf8"),
  courseKeysOf,
};

const PROGRAM_ROOTS = [
  join(ROOT, "data/northeastern/programs/undergraduate"),
  join(ROOT, "data/northeastern/programs/graduate"),
];

const CATALOG = join(ROOT, "public/northeastern/catalog-courses.json");

test("every course a shipped program requires is in the shipped catalog", () => {
  const { keys, programs, unreadable } = referencedCourseKeys(PROGRAM_ROOTS, io);

  // Guard the guard. If the walk silently found nothing — a moved directory, a
  // renamed accessor — every assertion below passes vacuously, and this test
  // becomes the most dangerous kind: one that reports success for having
  // checked nothing.
  assert.equal(unreadable, 0, `${unreadable} program file(s) unreadable — fix those before trusting this`);
  assert.ok(programs > 500, `only ${programs} programs found — has the tree moved?`);
  assert.ok(keys.size > 4000, `only ${keys.size} courses referenced — has courseKeysOf changed shape?`);

  const catalog = JSON.parse(readFileSync(CATALOG, "utf8"));
  assert.ok(catalog.length > 5000, `catalog has only ${catalog.length} entries`);
  const have = new Set(catalog.map(keyOfCourse).filter(Boolean));

  const dangling = [...keys].filter(k => !have.has(k)).sort();
  const unexpected = dangling.filter(k => !KNOWN_UNRESOLVABLE.has(k));

  assert.deepEqual(unexpected, [],
    `${unexpected.length} course(s) a shipped program requires are absent from the shipped catalog, `
    + `so those requirement rows can never be ticked off in the planner.\n\n`
    + `  ${unexpected.slice(0, 40).join("\n  ")}${unexpected.length > 40 ? `\n  …and ${unexpected.length - 40} more` : ""}\n\n`
    + `The usual cause is a catalog EDITION ROLL: the course catalog is a single current\n`
    + `snapshot while program requirements are edition-partitioned, so a roll retires\n`
    + `courses that a frozen older tree still requires. That is what\n`
    + `scripts/lib/course-retention.js exists to prevent, so first check whether it ran:\n`
    + `the scrape log prints "Edition retention: N programs reference M courses".\n\n`
    + `  · it did not run          → the catalog was written by something that skips it\n`
    + `                              (a --subject/--merge/--rotate path, or a hand edit)\n`
    + `  · it ran and kept nothing → the program trees were unreadable, or these courses\n`
    + `                              were absent from the PREVIOUS snapshot too, which\n`
    + `                              means they were lost in an earlier run\n`
    + `  · NEU genuinely never listed them → add them to KNOWN_UNRESOLVABLE in this file,\n`
    + `                              but open the catalog page first and say so in the\n`
    + `                              commit. Three is the number as of the 2026 edition.\n\n`
    + `Do NOT widen KNOWN_UNRESOLVABLE to make a build pass — it is the record of NEU's\n`
    + `own inconsistencies, and every entry is a requirement no student can satisfy.`);
});

test("KNOWN_UNRESOLVABLE stays a record, not a budget", () => {
  // Every entry must still be earning its place. A stale exemption is how a
  // named list decays into the count it was chosen over: once an entry stops
  // corresponding to anything, the list stops describing the corpus and the
  // next reader trusts it anyway.
  const { keys } = referencedCourseKeys(PROGRAM_ROOTS, io);
  const catalog = JSON.parse(readFileSync(CATALOG, "utf8"));
  const have = new Set(catalog.map(keyOfCourse).filter(Boolean));

  const stale = [...KNOWN_UNRESOLVABLE].filter(k => have.has(k) || !keys.has(k)).sort();
  assert.deepEqual(stale, [],
    `these exemptions no longer describe anything — either the course is in the catalog now, `
    + `or no shipped program requires it. Delete them:\n  ${stale.join("\n  ")}`);

  assert.ok(KNOWN_UNRESOLVABLE.size <= 12,
    `${KNOWN_UNRESOLVABLE.size} exemptions is too many to be a list of individually-checked `
    + `catalog inconsistencies. Something systematic is being exempted one course at a time.`);
});

test("a retained course is marked, and marked courses are a minority", () => {
  // Two things at once. `retired` is what tells every other reader — the rail,
  // the planner, a future UI badge — that a course is evidence about an older
  // catalog rather than an offer. And if retained courses ever became a large
  // share of the file, retention would have stopped being "keep what an audit
  // needs" and become an archive, which is a different feature with different
  // costs.
  const catalog = JSON.parse(readFileSync(CATALOG, "utf8"));
  const retired = catalog.filter(c => c?.retired);
  const active = activeCourseCount(catalog);

  assert.equal(active + retired.length, catalog.length,
    "every entry is either active or retired — a third state would be invisible to the shrink rail");

  for (const c of retired) {
    assert.match(String(c.retiredSince ?? ""), /^\d{4}-\d{2}-\d{2}$/,
      `${keyOfCourse(c)} is marked retired with no usable retiredSince`);
  }

  assert.ok(retired.length <= catalog.length * 0.25,
    `${retired.length} of ${catalog.length} courses are retired. Retention is meant to keep what a `
    + `shipped edition still requires; at this share it is acting as an archive. Check whether an `
    + `old program edition should have been dropped, which would prune its courses automatically.`);
});
