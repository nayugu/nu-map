// ═══════════════════════════════════════════════════════════════════
// A heading that is a MENU, and the rail that stops one being guessed at.
//
// The failure this exists for is silent in both directions. Unfolded, the
// "Khoury Meaningful Minors" heading's eight college groups each became a
// requirement section at `minRequirementCount: 1` — "take one course from each
// of eight colleges", a thing NEU does not require — and inflated the CS
// minor's derived demand to 52 SH against a page that says 20, which is also
// the denominator `minorOverlap` derives the 50% double-count ceiling from.
// Folded wrongly, a real requirement section vanishes and the student is never
// shown something they owe.
//
// So the tests below are about the two ways to be wrong, not about the happy
// path: an unadjudicated cross-reference must STOP, and a folded menu must
// contribute AT MOST ONE course however many of its courses were taken.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADJUDICATED_EDITION, CROSS_REFERENCE, _MENUS,
  menuForReference, menuForHeading, foldOf, assertReferencesAdjudicated,
} from "../../scripts/lib/referenced-menus.js";
import { allocateSections } from "../../src/core/gradRequirements.js";

// The two sentences, verbatim from the pages. Kept as literals: the manifest is
// a hand reading of these exact strings, so a test that derived them from the
// manifest would agree with itself no matter what it said.
//
// `AI_ROW` is the 2026-2027 wording. NEU retired the Data Science minor and
// republished it as the Artificial Intelligence minor, which reworded the row
// only in its capitals ("Meaningful minor list" → "Meaningful Minor list") —
// and the 2025-2026 form is kept beside it deliberately, because the pattern
// matching BOTH is the property that carried this file across the roll and is
// worth pinning rather than quietly relying on.
const CS_ROW = "One course from Khoury meaningful minors list (see below).";
const AI_ROW = "Meaningful Minor list (see below)";
const DS_ROW = "Meaningful minor list (see below)";

test("menus › both live cross-references are claimed", () => {
  for (const row of [CS_ROW, AI_ROW, DS_ROW]) {
    assert.ok(CROSS_REFERENCE.test(row), `detector missed: ${row}`);
    assert.ok(menuForReference(row), `unadjudicated: ${row}`);
  }
  // All point at the SAME heading — the pages word the pointer differently and
  // name the menu identically, which is exactly why the reference is matched on
  // the row and the menu on the heading.
  assert.equal(menuForReference(CS_ROW).id, menuForReference(AI_ROW).id);
  assert.equal(menuForReference(DS_ROW).id, menuForReference(AI_ROW).id);
  assert.ok(menuForHeading("Khoury Meaningful Minors"));
});

test("menus › an UNADJUDICATED cross-reference stops the run", () => {
  // The whole design. A page that grows a new pointer must not be parsed on a
  // guess — it must land in front of a person.
  assert.throws(
    () => assertReferencesAdjudicated(["Choose one course from the list (see below)."],
                                      { url: "https://example/x/" }),
    e => /unadjudicated cross-reference/.test(e.message)
      && /https:\/\/example\/x\//.test(e.message)      // names the page
      && e.message.includes(ADJUDICATED_EDITION)        // names the edition
      && /Choose one course from the list/.test(e.message), // names the SENTENCE
  );
});

test("menus › an adjudicated page passes, and an empty page passes", () => {
  assert.doesNotThrow(() => assertReferencesAdjudicated([CS_ROW, DS_ROW, "Complete two courses."]));
  assert.doesNotThrow(() => assertReferencesAdjudicated([]));
  assert.doesNotThrow(() => assertReferencesAdjudicated(undefined));
});

test("menus › the rail is not fooled by whitespace or case", () => {
  // The catalog emits &nbsp; and line-wrapped prose, so the row arrives with
  // arbitrary internal whitespace. A rail defeated by a newline is not a rail.
  assert.doesNotThrow(() =>
    assertReferencesAdjudicated(["  One  course from KHOURY\n\tMeaningful   Minors LIST (See Below).  "]));
  assert.ok(menuForHeading("  khoury   meaningful minors  "));
});

test("menus › a near-miss heading is NOT a menu", () => {
  // `heading` is anchored on purpose: "Khoury Meaningful Minors Electives"
  // would be a different heading, and swallowing it deletes requirements.
  for (const t of ["Khoury Meaningful Minors Electives", "Meaningful Minors",
                   "Khoury Requirements", "", null]) {
    assert.equal(menuForHeading(t), null, `wrongly treated as a menu: ${t}`);
  }
});

const area = (title, ...ids) => ({
  title,
  courses: [{ type: "OR", courses: ids.map(n => ({ type: "COURSE", subject: "X", classId: n })) }],
});

test("menus › the fold keeps every area name and every course", () => {
  const node = foldOf(_MENUS[0], [area("Engineering", 1, 2), area("Science", 3, 4, 5)]);
  assert.equal(node.type, "OR");
  assert.deepEqual(node.courses.map(b => b.label), ["Engineering", "Science"]);
  // Flattened, not double-wrapped: an area already arrives as one unlabelled
  // OR, and re-wrapping it adds a level of nesting that expresses no choice.
  assert.deepEqual(node.courses.map(b => b.courses.length), [2, 3]);
  assert.ok(node.courses.every(b => b.courses.every(c => c.type === "COURSE")));
});

test("menus › an empty menu folds to null, never to an empty OR", () => {
  // An empty OR is satisfied by nothing and would sit in the pool forever
  // looking like an option. Absent and empty are different facts.
  assert.equal(foldOf(_MENUS[0], []), null);
  assert.equal(foldOf(_MENUS[0], [{ title: "Empty", courses: [] }]), null);
  assert.equal(foldOf(_MENUS[0], undefined), null);
});

test("menus › a fold that is not `atMostOne` REFUSES rather than guessing", () => {
  assert.throws(() => foldOf({ id: "made-up" }, [area("A", 1)]),
                /no implemented fold/);
});

test("menus › EVERY manifest entry is anchored and self-consistent", () => {
  // Hostile to the manifest itself: an unanchored `heading` would match a
  // heading that merely contains the words, and a `reference` the detector
  // does not see could never be reached by the rail.
  for (const m of _MENUS) {
    assert.ok(m.id && m.atMostOne === true, `${m.id}: incomplete entry`);
    assert.ok(m.heading.source.startsWith("^") && m.heading.source.endsWith("$"),
              `${m.id}: heading pattern is not anchored`);
    assert.ok(m.heading.test(m.heading.source.replace(/[\^$]|\\s\+/g, m2 => m2 === "\\s+" ? " " : "")),
              `${m.id}: heading pattern does not match its own source`);
  }
});

test("menus › a folded menu contributes AT MOST ONE course", () => {
  // The property the whole change rests on, asserted through the real
  // allocator rather than by reading the tree. The page allows one course
  // from the list in place of one Khoury elective; a student who took THREE
  // menu courses must still be credited for exactly one of them.
  // Keyed and shaped the way `catalogCourseMap` builds it — a RANGE resolves
  // through `subject`/`number`, so a map carrying only `sh` silently matches
  // nothing and the test would pass for the wrong reason.
  const courseMap = Object.fromEntries(
    [["X", 1], ["X", 2], ["X", 3], ["CS", 3000]].map(([subject, n]) =>
      [`${subject}${n}`, { id: `${subject}${n}`, subject, number: String(n), sh: 4 }]));
  const menu = foldOf(_MENUS[0], [area("Engineering", 1, 2), area("Science", 3)]);
  const section = {
    title: "Electives", minRequirementCount: 1,
    requirements: [{
      type: "XOM", numCreditsMin: 8,
      courses: [{ type: "RANGE", subject: "CS", idRangeStart: 2500, idRangeEnd: 7999 }, menu],
    }],
  };
  const poolOf = (placed) => {
    const [r] = allocateSections([section], new Set(placed), new Set(), courseMap);
    return r.requirements?.[0] ?? r.children?.[0];
  };

  // Three menu courses are still worth one: 4 SH of an 8 SH pool, unsatisfied.
  const many = poolOf(["X1", "X2", "X3"]);
  assert.equal(many.satSh, 4);
  assert.equal(many.sat, false);
  assert.equal(many.allocatedCourses.size, 1);

  // One menu course beside one real elective is the arrangement the page
  // describes, and it satisfies the pool.
  const ok = poolOf(["X1", "CS3000"]);
  assert.equal(ok.satSh, 8);
  assert.equal(ok.sat, true);

  // `satSh` and `allocatedCourses` must agree — they disagreed before this
  // change (satSh 8, one course allocated), which is what let two menu
  // courses satisfy a pool that may only take one.
  for (const placed of [["X1", "X2", "X3"], ["X1", "CS3000"], ["X1"], []]) {
    const p = poolOf(placed);
    const summed = [...p.allocatedCourses].reduce((n, k) => n + (courseMap[k]?.sh ?? 4), 0);
    assert.equal(p.satSh, summed, `satSh disagrees with allocation for [${placed}]`);
  }
});

// ── The adjudication must answer to the corpus ──────────────────────
//
// This constant sat at '2025-2026' while both program trees rolled to 2027,
// and nothing could have said so: unlike `shared-sections.js`, it was
// interpolated into an error message and compared to nothing. What carried the
// file across that roll was NEU reusing its own wording on the replacement
// page, which is luck, and luck expires.
//
// The check is deliberately weak — it cannot know whether anyone opened the
// pages, only that the claim is not older than the data. That is the same thing
// `shared-sections.test.js` asserts, and it is what turns "stale forever and
// silent" into "stale once and loud".
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** The newest edition either program tree has committed. */
function committedEdition() {
  const years = [];
  for (const tree of ["undergraduate", "graduate"]) {
    const base = join(ROOT, `data/northeastern/programs/${tree}`);
    if (!existsSync(base)) continue;
    for (const y of readdirSync(base)) if (/^\d{4}$/.test(y)) years.push(Number(y));
  }
  return years.length ? Math.max(...years) : null;
}

test("menus › the adjudication is not older than the corpus", () => {
  assert.match(ADJUDICATED_EDITION, /^\d{4}-\d{4}$/,
    "the edition is a catalog LABEL (`2026-2027`), not a year — the rail's message prints it");
  const [from, to] = ADJUDICATED_EDITION.split("-").map(Number);
  assert.equal(to, from + 1, `${ADJUDICATED_EDITION} is not a single catalog year`);

  const committed = committedEdition();
  if (committed == null) return;   // no corpus checked out; nothing to compare against
  assert.ok(to >= committed,
    `referenced-menus is adjudicated against ${ADJUDICATED_EDITION} but the committed corpus `
    + `is edition ${committed}. The two cross-reference rows were read off the older catalog, `
    + `so they may name pages NEU has since renamed or retired — which is exactly what the DS `
    + `to AI roll did.\n\n`
    + `Open the two minor pages, confirm the "(see below)" rows still say what MENUS claims, `
    + `then bump ADJUDICATED_EDITION. Do not bump it without looking: the constant is a claim `
    + `that someone did.`);
});
