#!/usr/bin/env node
/**
 * bind-plans.js — write into every plan.json which requirement each unnamed
 * cell stands for.
 *
 * A separate pipeline step rather than part of the scrape, for the same reason
 * merge-nupath.js is separate from scrape-catalog.js: it needs the course
 * catalog, which the program scrapers do not load and should not have to. It is
 * also re-runnable against already-scraped data, so the binding can be improved
 * without re-fetching 658 pages.
 *
 * Order matters — run it AFTER both program scrapes, because it reads the
 * `requirements.json` they write.
 *
 *   node scripts/bind-plans.js              # report only
 *   node scripts/bind-plans.js --write      # write bindings into plan.json
 *
 * Nothing is written unless --write is passed, and a run that would bind
 * dramatically less than the last one refuses to write at all — the same
 * principle as fetch-nupath's 5% rule, because these files are committed to
 * main by an unattended workflow.
 */

import { readFileSync, writeFileSync, existsSync, globSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  obligationsOf, bindCells, specAdmitsSubject, specAdmitsRange, assertShallowPools,
} from "./lib/plan-binding.js";
import { createPlanHints } from "./lib/plan-hints.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WRITE = process.argv.includes("--write");

/**
 * A cell the plan left unanswered. Headings label other rows, co-ops and
 * vacations are not coursework, and anything with options was already named.
 */
const isUnnamed = (e) =>
  !e.options?.length && !e.heading && !e.coop && !e.vacation && !e.either;

/** Every entry in a plan, headings included, depth first in plan order. */
function* walk(plan) {
  for (const year of plan.years ?? []) {
    for (const term of year.terms ?? []) {
      yield* descend(term.entries ?? []);
    }
  }
}
function* descend(entries) {
  for (const e of entries) { yield e; yield* descend(e.children ?? []); }
}

function loadCourseMap() {
  const raw = JSON.parse(readFileSync(join(ROOT, "public/northeastern/catalog-courses.json"), "utf8"));
  const map = {};
  for (const c of raw) {
    const id = `${c.subject}${parseInt(c.number, 10)}`;
    map[id] = { id, subject: c.subject, number: String(parseInt(c.number, 10)), sh: c.credits ?? 0 };
  }
  return map;
}

function main() {
  const courseMap = loadCourseMap();
  const subjects = Object.keys(JSON.parse(
    readFileSync(join(ROOT, "public/northeastern/subjects.json"), "utf8")));
  const hints = createPlanHints(subjects, { specAdmitsSubject, specAdmitsRange });

  const files = [
    ...globSync(join(ROOT, "data/northeastern/programs/undergraduate/*/*/*/plan.json")),
    ...globSync(join(ROOT, "data/northeastern/programs/graduate/*/*/*/plan.json")),
  ].sort();

  let programs = 0, cells = 0, forced = 0, ambiguous = 0, unbound = 0, legacy = 0;
  const deepPools = [];
  const writes = [];

  for (const file of files) {
    const reqFile = join(dirname(file), "requirements.json");
    if (!existsSync(reqFile)) continue;
    const program = JSON.parse(readFileSync(reqFile, "utf8"));
    const grid = JSON.parse(readFileSync(file, "utf8"));

    const deep = assertShallowPools(program);
    if (deep.length) deepPools.push({ file, sections: deep });

    let touched = false;
    for (const plan of grid.plans ?? []) {
      const entries = [...walk(plan)];
      // plan.json written before the entry model landed still carries `kind`
      // and `codes`. Skipped rather than guessed at: a wrong reading here would
      // be written to disk and committed.
      if (entries.some(e => !Array.isArray(e.options))) { legacy += 1; break; }

      const placed = new Set();
      for (const e of entries) {
        if (e.options?.length === 1) for (const c of e.options[0]) placed.add(c);
      }
      const open = entries.filter(isUnnamed);
      if (!open.length) continue;

      const obligations = obligationsOf(program, { placedSet: placed, courseMap });
      const result = bindCells(open, obligations, hints);

      open.forEach((entry, i) => {
        const { targets, forced: isForced } = result[i];
        cells += 1;
        if (!targets.length) { unbound += 1; delete entry.binding; return; }
        if (isForced) forced += 1; else ambiguous += 1;
        // The target is a SECTION INDEX into the same program's
        // requirementSections, or a sentinel. It cannot dangle: this file and
        // requirements.json are produced together and ship together.
        entry.binding = { targets, ...(isForced ? { forced: true } : {}) };
        touched = true;
      });
    }
    if (touched) { programs += 1; writes.push([file, grid]); }
  }

  const rate = cells ? (forced / cells) : 0;
  console.log(`plans read            ${files.length}`);
  console.log(`programs bound        ${programs}`);
  console.log(`legacy-format plans   ${legacy}  (skipped — re-scrape to bind)`);
  console.log(`unnamed cells         ${cells}`);
  console.log(`  forced              ${forced}  (${(rate * 100).toFixed(1)}%)`);
  console.log(`  ambiguous           ${ambiguous}`);
  console.log(`  unbound             ${unbound}`);
  if (deepPools.length) {
    console.log(`\n⚠ credit pools nested deeper than a section's immediate child: ${deepPools.length}`);
    console.log("  shortfallOf() cannot see these — see docs/sample-plan-design.md §4");
    for (const d of deepPools.slice(0, 5)) console.log(`  ${d.file}: ${d.sections.join(", ")}`);
  }

  if (!WRITE) {
    console.log("\n(dry run — pass --write to update plan.json)");
    return;
  }
  // A collapse in binding means the requirement data or the entry model
  // changed under us. These files are committed to main unattended, so refuse
  // rather than overwrite good bindings with empty ones.
  if (cells && rate < 0.25) {
    console.error(`\nREFUSING TO WRITE: only ${(rate * 100).toFixed(1)}% of cells resolved.`);
    process.exitCode = 1;
    return;
  }
  for (const [file, grid] of writes) writeFileSync(file, JSON.stringify(grid, null, 2) + "\n");
  console.log(`\nwrote ${writes.length} plan.json files`);
}

main();
