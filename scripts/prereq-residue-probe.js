#!/usr/bin/env node
/**
 * prereq-residue-probe.js — which prerequisite phrases the parser cannot read.
 *
 * Written because the 2026-2027 catalog roll shipped 493 courses whose prereq
 * tree carries a DOUBLED operator (`[ACCT 1201, "Or", "Or", ACCT 1202]`), and
 * `catalog-prereq-parse.test.js` reported 415 trees truncating as a result. A
 * doubled operator is never in the source text: it is the scar left when an
 * OR-branch between two operators parses to nothing, so the operator on each
 * side survives and the branch itself vanishes.
 *
 * The parser already knows this shape — see the SCORE_GATE comment in
 * scripts/lib/prereq-parse.js, added when "Dissertation Check with a score of
 * REQ" left the same dangling `Or`. This probe exists so the NEXT one is a
 * measurement instead of an argument: it names every phrase that drops, so a
 * fix can be aimed at what the catalog actually says rather than at a guess.
 *
 * It is deliberately a READER. It fetches subject pages (through the shared
 * polite/cached fetcher), re-parses their prereq lines with the live parser,
 * and prints what fell out. It writes nothing.
 *
 *   node scripts/prereq-residue-probe.js                  # subjects with a defect today
 *   node scripts/prereq-residue-probe.js --subjects CS,ACCT
 *   node scripts/prereq-residue-probe.js --all            # every subject in the catalog
 *
 * Set CATALOG_HTML_CACHE to make re-runs free:
 *   CATALOG_HTML_CACHE=.cache/catalog node scripts/prereq-residue-probe.js
 */
import { readFileSync } from "fs";
// fileURLToPath, not URL.pathname — pathname keeps "%20" for a checkout whose
// path contains a space, and every read below then ENOENTs.
import { fileURLToPath } from "node:url";
import { parse as parseHTML } from "node-html-parser";
import { politeFetch, cacheSummary } from "./lib/catalog-cache.js";
import { extractConcurrentCourses, parsePrereqText } from "./lib/prereq-parse.js";

const NBSP = / /g;
const ROOT = fileURLToPath(new URL("../", import.meta.url));

const args = process.argv.slice(2);
const argOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};

/** A tree is malformed when an operator sits beside an operator, or on an end. */
function defectOf(tree) {
  const isOp = (x) => x === "And" || x === "Or";
  for (let i = 1; i < tree.length; i++) {
    if (isOp(tree[i]) && isOp(tree[i - 1])) return "doubled-operator";
  }
  if (tree.length && isOp(tree[0])) return "leading-operator";
  if (tree.length && isOp(tree[tree.length - 1])) return "trailing-operator";
  return null;
}

/**
 * The phrases between operators that produced no node.
 *
 * Re-derived from the raw text rather than read off the tree, because the tree
 * is precisely what lost them. Splitting on the same operator vocabulary the
 * parser uses, a chunk is "residue" when parsing it alone yields nothing.
 */
function residueOf(text) {
  return text
    .split(/(?:^|\s)(?:and|or)(?:\s|$)/i)
    .map((s) => s.replace(/[();]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((chunk) => parsePrereqText(chunk).length === 0);
}

const catalog = (() => {
  const raw = JSON.parse(readFileSync(`${ROOT}public/northeastern/catalog-courses.json`, "utf8"));
  return Array.isArray(raw) ? raw : raw.courses;
})();

/** Subjects whose SHIPPED trees already carry the defect — the default scope. */
function afflictedSubjects() {
  const out = new Set();
  for (const c of catalog) if (defectOf(c.prereqs ?? [])) out.add(c.subject);
  return [...out].sort();
}

const subjects = args.includes("--all")
  ? [...new Set(catalog.map((c) => c.subject))].sort()
  : argOf("--subjects")
    ? argOf("--subjects").split(",").map((s) => s.trim().toUpperCase())
    : afflictedSubjects();

console.log(`probing ${subjects.length} subject(s)\n`);

const byPhrase = new Map();       // residue phrase → { n, egs:Set }
let pages = 0, lines = 0, broken = 0;

for (const subj of subjects) {
  const url = `https://catalog.northeastern.edu/course-descriptions/${subj.toLowerCase()}/`;
  let html;
  try {
    html = await politeFetch(url);
  } catch (e) {
    console.log(`  ${subj}: FETCH FAILED (${e.message}) — not counted either way`);
    continue;
  }
  pages++;
  const root = parseHTML(html);
  for (const block of root.querySelectorAll(".courseblock, [class*='courseblock']")) {
    const title = block.querySelector(".courseblocktitle, .cb_title, h3")?.textContent
      ?.replace(NBSP, " ").trim() ?? "";
    const code = (title.match(/^([A-Z]{2,6})\s+(\d{4}[A-Z]?)\./) ?? []).slice(1, 3).join(" ");
    let prereqText = "";
    for (const el of block.querySelectorAll(".courseblockextra, p")) {
      const s = el.textContent.replace(NBSP, " ").trim();
      if (/prerequisite\(s\)\s*:/i.test(s)) prereqText = s.replace(/.*prerequisite\(s\)\s*:\s*/i, "").trim();
    }
    if (!prereqText) continue;
    lines++;

    const { cleaned } = extractConcurrentCourses(prereqText);
    const tree = parsePrereqText(cleaned);
    const defect = defectOf(tree);
    if (!defect) continue;
    broken++;

    for (const phrase of residueOf(cleaned)) {
      const rec = byPhrase.get(phrase) ?? { n: 0, egs: new Set() };
      rec.n++;
      if (rec.egs.size < 3) rec.egs.add(code || "?");
      byPhrase.set(phrase, rec);
    }
  }
}

console.log(`\npages ${pages} · prereq lines ${lines} · malformed trees ${broken}`);
console.log(cacheSummary());

// ── What actually dropped ────────────────────────────────────────────────
// Grouped by SHAPE, not by exact string: the useful question is "is this one
// pattern or a hundred", because one pattern is a fix and a hundred is a
// different design.
// The grade clause is not part of the shape — it rides every prereq clause in
// the catalog and would otherwise make one pattern look like eighty.
const bare = (p) => p
  .replace(/\s*with a minimum grade of\s+[A-FS][+-]?/i, "")
  .replace(/\s*with a score of\s+\S+/i, "")
  .trim();

const SHAPES = [
  ["legacy course number (3-digit)", (p) => /^[A-Z]{2,6}\s+\d{2,3}[A-Z]?$/.test(bare(p))],
  ["course number with a suffix",    (p) => /^[A-Z]{2,6}\s+\d{4}[A-Z]{2,}$/.test(bare(p))],
  ["bare subject, no number",        (p) => /^[A-Z]{2,6}$/.test(bare(p))],
  ["score gate",                     (p) => /with a score of/i.test(p)],
];
const shapeOf = (p) => SHAPES.find(([, f]) => f(p))?.[0] ?? "OTHER";

const buckets = new Map();
for (const [phrase, rec] of byPhrase) {
  const s = shapeOf(phrase);
  const b = buckets.get(s) ?? { n: 0, distinct: 0, egs: [] };
  b.n += rec.n; b.distinct++;
  if (b.egs.length < 6) b.egs.push(`${phrase} (${[...rec.egs].join(",")})`);
  buckets.set(s, b);
}

console.log(`\ndropped phrases: ${byPhrase.size} distinct\n`);
for (const [shape, b] of [...buckets].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`${String(b.n).padStart(5)}  ${shape}  (${b.distinct} distinct)`);
  for (const e of b.egs) console.log(`         · ${e}`);
}
