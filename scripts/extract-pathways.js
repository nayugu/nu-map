#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// EXTRACT PATHWAYS — stage 4 of the intake, as far as a machine should take it.
//
// Reads a published PlusOne page and writes a DRAFT pathway file: eligibility
// (including per-major prerequisites), the course tables it found, and a `todo`
// list of everything it deliberately refused to decide.
//
// It transcribes; a human judges. That split is not caution for its own sake —
// it is the bug list. `CS 5500 → CS 4500 / CS 4530` is an ALTERNATION that a
// row-by-row reader turns into two independent substitutions (that shipped, and
// let one 4 SH course satisfy two requirements). Khoury's "choose two" does not
// say whether it counts the mandatory courses. Bouvé's own PDF contradicts
// itself. A parser confident about those produces fluent, wrong data about
// somebody's degree.
//
// So the machine does the part where the typos are, and the person does the part
// where the ambiguity is. Then scripts/verify-pathways.js gates the result.
//
// Usage:
//   npm run data:pathways:extract -- --url <page>            # print a draft
//   npm run data:pathways:extract -- --host mie              # every pathway page on a host
//   npm run data:pathways:extract -- --host mie --write      # write drafts to disk
//   … --out data/northeastern/pathways/_drafts               # default
//
// Drafts land under `_drafts/` — an underscore, so they are intake artefacts and
// neither the app, the verifier nor the test suite mistakes an unfinished draft
// for a shipped pathway.
// ═══════════════════════════════════════════════════════════════════

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchText, newStats, checkTlsSetup, BROKEN_CHAIN_HOSTS } from "./lib/pathway-fetch.js";
import { buildDraft } from "./lib/pathway-extract.js";
import { PAGE_KIND } from "./lib/pathway-intake.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PATHWAYS = join(ROOT, "data/northeastern/pathways");
const INVENTORY = join(PATHWAYS, "_inventory.json");

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const WRITE = argv.includes("--write");
const url = flag("--url");
const host = flag("--host");
const OUT = flag("--out") ?? join(PATHWAYS, "_drafts");

if (!url && !host) {
  console.error("usage: --url <page>  |  --host <host> [--write]");
  process.exit(2);
}

const tls = checkTlsSetup();
if (!tls.ok && (BROKEN_CHAIN_HOSTS.includes(host) || BROKEN_CHAIN_HOSTS.some(h => url?.includes(h + ".")))) {
  console.warn(`\n⚠ ${tls.hint}\n`);
}

// Which pages to work on: one URL, or every page the inventory classified as a
// PATHWAY on that host. Working from the inventory is the point of having one —
// it means "extract everything MIE publishes" is a command rather than a hunt.
let targets = [];
if (url) {
  targets = [{ url, host: hostOf(url) }];
} else {
  if (!existsSync(INVENTORY)) {
    console.error(`no inventory at ${INVENTORY} — run: npm run data:pathways:discover:write`);
    process.exit(2);
  }
  const inv = JSON.parse(readFileSync(INVENTORY, "utf8"));
  targets = inv.entries.filter(e => e.host === host && e.kind === PAGE_KIND.PATHWAY);
  if (!targets.length) {
    console.error(`no pages classified as "${PAGE_KIND.PATHWAY}" for host "${host}"`);
    process.exit(2);
  }
}

const stats = newStats();
const today = new Date().toISOString().slice(0, 10);
let wrote = 0, failed = 0;

console.log(`\nextracting ${targets.length} page(s)…\n`);

for (const t of targets) {
  const html = await fetchText(t.url, { stats, host: t.host });
  if (!html) {
    failed += 1;
    console.log(`  ✗ ${t.url}\n      unfetchable`);
    continue;
  }
  const { draft, stats: s, courses } = buildDraft({
    url: t.url, html, college: collegeFor(t.host), today,
  });

  console.log(`  ${draft.id}`);
  console.log(`      ${s.eligibilityEntries} eligible majors from ${s.eligibilityTables} table(s)` +
              (s.concentrationGroups > 1 ? ` across ${s.concentrationGroups} concentrations` : "") +
              `, ${s.distinctCourses} distinct courses in ${s.courseRows} rows`);
  for (const e of draft.eligibility.slice(0, 3)) {
    console.log(`        · ${e.nameIncludes}` +
                (e.combined ? " (+combined)" : "") +
                (e.prereqs ? `  prereqs: ${e.prereqs.join(", ")}` : ""));
  }
  if (draft.eligibility.length > 3) console.log(`        · …${draft.eligibility.length - 3} more`);
  for (const td of draft.todo) console.log(`      TODO ${td}`);

  if (WRITE) {
    mkdirSync(OUT, { recursive: true });
    const file = join(OUT, `${t.host}-${draft.id}.json`);
    // The courses the page listed ride along as a comment-ish field so the author
    // can turn them into `shares` without re-reading the page. Not `shares`
    // itself: that mapping is the judgement this refuses to make.
    writeFileSync(file, JSON.stringify({
      ...draft,
      _coursesFound: courses.map(c => ({ heading: c.heading, codes: c.codes, sh: c.sh })),
    }, null, 2) + "\n");
    wrote += 1;
  }
  console.log("");
}

console.log(`${targets.length} page(s), ${failed} unfetchable` +
            (WRITE ? `, ${wrote} draft(s) written to ${OUT.replace(ROOT + "/", "")}` : ""));
if (!WRITE) console.log("\n(dry run — pass --write to emit drafts)");
console.log(
  "\nDrafts are UNFINISHED by construction: `shares` and most `rules` are left for\n" +
  "a human, and `msPrograms` must be filled in. Run `npm run data:pathways:verify`\n" +
  "after moving a finished pathway out of _drafts/.\n");

if (failed && failed === targets.length) process.exit(1);

function hostOf(u) {
  try { return new URL(u).hostname.split(".")[0].replace(/^www$/, ""); } catch { return "unknown"; }
}

/** Map a host to the college slug used by programs-bundle ids. */
function collegeFor(h) {
  return {
    khoury: "computer-information-science",
    coe: "engineering", ece: "engineering", mie: "engineering",
    cee: "engineering", che: "engineering", bioe: "engineering",
    cos: "science", cssh: "social-sciences-humanities",
    bouve: "health-sciences", "damore-mckim": "business",
    camd: "arts-media-design", cps: "professional-studies",
  }[h] ?? null;
}
