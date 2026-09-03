// ═══════════════════════════════════════════════════════════════════
// A folded MENU may pay for at most ONE course, everywhere it ships.
//
// `scripts/lib/referenced-menus.js` folds a referenced course list into the
// pool that points at it, as an OR carrying `atMostOne` — because the page
// allows one course from the list in place of one of the pool's own. The
// contract test pins that on a fixture; this pins it on what we actually ship,
// under a HOSTILE placement (the student took every course the menu names),
// because the constraint only bites when more of the menu is placed than it
// can pay for.
//
// ── What this test deliberately does NOT assert ─────────────────────
//
// The general property — that a pool's `satSh` equals the credit of the
// courses it allocated — is FALSE in this corpus, and finding that out is why
// `atMostOne` is a flag on one node instead of a rule about ORs.
// `allocateNode` commits one branch of an OR into `allocatedCourses` but
// `sumSatisfiedCredits` recursed into every satisfied alternative, so the two
// disagree on **310 of 1,410 pools** (22%), in BOTH directions — History BA §
// Historical Research and Writing counts 5 SH against 1 allocated, and
// Chemical Engineering and Data Science § Supplemental Credit counts 2 against
// 4. Fixing it globally was tried and reverted: it makes four sections
// impossible to complete, because in those the OR is the pool's own course
// list rather than a set of alternatives (History BA's is a 5 SH pool over one
// OR holding exactly 5 SH). `requirement-credit-corpus.test.js` is what caught
// that, and it stays the guard for it. Both readings are live and nothing in
// the node tells them apart, so the 310 are a real open defect that needs its
// own measurement — not something to smuggle into a parser fix.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { allocateSections, courseKey } from "../../src/core/gradRequirements.js";
import { catalogCourseMap } from "../../scripts/lib/catalog-course-map.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const courseMap = catalogCourseMap();

const files = execFileSync("find", [
  join(ROOT, "data/northeastern/programs/undergraduate"),
  join(ROOT, "data/northeastern/programs/graduate"),
  "-name", "requirements.json",
], { encoding: "utf8", maxBuffer: 64 << 20 }).trim().split("\n").filter(Boolean);

/** Every course key a node names, ranges expanded from the shipped catalog. */
function keysUnder(node, out = new Set()) {
  if (!node || typeof node !== "object") return out;
  if (node.type === "COURSE") out.add(courseKey(node.subject, node.classId));
  if (node.type === "RANGE") {
    const excluded = new Set((node.exceptions ?? [])
      .map(e => courseKey(e.subject, e.classId)));
    for (const c of Object.values(courseMap)) {
      if (c.subject !== node.subject) continue;
      const n = parseInt(c.number, 10);
      if (n < node.idRangeStart || n > node.idRangeEnd) continue;
      const k = courseKey(c.subject, n);
      if (!excluded.has(k)) out.add(k);
    }
  }
  for (const c of node.courses ?? []) keysUnder(c, out);
  return out;
}

const hasMenu = (node) => {
  if (!node || typeof node !== "object") return false;
  if (node.type === "OR" && node.atMostOne) return true;
  return (node.courses ?? []).some(hasMenu);
};

/** Every allocated `atMostOne` OR under this node. */
function menusIn(node, out = [], depth = 0) {
  if (!node || typeof node !== "object" || depth > 40) return out;
  if (node.type === "OR" && node.atMostOne) out.push(node);
  for (const c of node.children ?? []) menusIn(c, out, depth + 1);
  for (const g of node.groups ?? []) for (const c of g.children ?? []) menusIn(c, out, depth + 1);
  return out;
}

test("menu › every shipped menu pays for at most one course", () => {
  const bad = [];
  let checked = 0;
  for (const file of files) {
    let j;
    try { j = JSON.parse(readFileSync(file, "utf8")); } catch { continue; }
    const sections = (j.requirementSections ?? [])
      .filter(s => (s.requirements ?? []).some(hasMenu));
    if (!sections.length) continue;

    // Hostile: place everything the section names, so the menu is offered far
    // more than it may take.
    const placed = new Set();
    for (const s of sections) for (const r of s.requirements ?? []) keysUnder(r, placed);
    const alloc = allocateSections(sections, placed, new Set(), courseMap);
    alloc.forEach((a, i) => {
      for (const child of a.children ?? []) {
        for (const menu of menusIn(child)) {
          checked++;
          const where = `${file.slice(ROOT.length + 1)} § ${sections[i].title}`;
          if (menu.allocatedCourses.size > 1) {
            bad.push(`${where}: menu allocated ${menu.allocatedCourses.size} courses`);
          }
          if ((menu.satCount ?? 0) > 1) {
            bad.push(`${where}: menu reports satCount ${menu.satCount}`);
          }
        }
      }
    });
  }
  // A test that silently walked nothing would pass forever after a rename.
  assert.ok(checked >= 2, `expected the two Khoury minors, walked ${checked} menus`);
  assert.deepEqual(bad, [], "a folded menu paid for more than one course");
});

test("menu › a pool holding a menu counts only the credit the menu allocated", () => {
  // The narrow half of the general property, asserted only where `atMostOne`
  // makes it true. This is what stops two menu courses satisfying a pool that
  // may take one — the failure the whole flag exists for.
  const bad = [];
  for (const file of files) {
    let j;
    try { j = JSON.parse(readFileSync(file, "utf8")); } catch { continue; }
    const sections = (j.requirementSections ?? [])
      .filter(s => (s.requirements ?? []).some(hasMenu));
    if (!sections.length) continue;
    const placed = new Set();
    for (const s of sections) for (const r of s.requirements ?? []) keysUnder(r, placed);
    const alloc = allocateSections(sections, placed, new Set(), courseMap);
    alloc.forEach((a, i) => {
      for (const pool of a.children ?? []) {
        if (pool.type !== "XOM" || typeof pool.satSh !== "number") continue;
        if (!menusIn(pool).length) continue;
        const summed = [...pool.allocatedCourses]
          .reduce((n, k) => n + (courseMap[k]?.sh ?? 4), 0);
        if (pool.satSh !== summed) {
          bad.push(`${file.slice(ROOT.length + 1)} § ${sections[i].title}: ` +
                   `satSh ${pool.satSh} vs ${summed} allocated`);
        }
      }
    });
  }
  assert.deepEqual(bad, [], "a pool holding a menu counted credit it did not allocate");
});
