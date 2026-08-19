// INVARIANT · the rules page states every rule, and counts them correctly.
//
// Two failures this page has already had, both of the same kind — the page and the thing it
// describes drifting apart, with the page still reading as authoritative:
//
// 1. It listed FIVE hard rules and the engine enforced eight. Co-requisites sharing a term, no
//    course used twice, and co-op length were all missing. The note in `ChartExplainer` puts it
//    exactly right: a list of rules that leaves rules out is worse than no list.
//
// 2. Rule 5 said "No term over the credit cap" after the generator was taught to keep a first
//    semester its department publishes over it — a guarantee contradicted by the same document.
//
// The preference list is now COLLAPSED behind a summary that states how many there are, which
// adds a third way to drift: add a tenth preference and the summary keeps saying nine while
// listing ten. The count is computed from a literal in the JSX, so that literal is what needs
// pinning to the locale file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { strings as en } from "../../src/locales/en.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const src = readFileSync(join(ROOT, "src/ui/ChartExplainer.jsx"), "utf8");

/** The numbered keys of a contract list, as the locale file actually defines them. */
const numbered = (prefix) => Object.keys(en)
  .map(k => k.startsWith(prefix) ? k.slice(prefix.length) : null)
  .filter(s => s && /^\d+$/.test(s))
  .map(Number)
  .sort((a, b) => a - b);

test("rules › every hard rule the locale defines is rendered", () => {
  const defined = numbered("chart.contract.hard.");
  assert.ok(defined.length >= 8, `only ${defined.length} hard rules defined; eight is the floor`);
  // Rendered either in a `.map([...])` list or as its own `<li>` — both forms count, since the
  // conditional ones (the credit cap, the coverage claim, the four-course bar) cannot be mapped.
  for (const n of defined) {
    assert.ok(new RegExp(`chart\\.contract\\.hard\\.${n}\\b`).test(src)
              || new RegExp(`["']${n}["']`).test(src),
      `hard rule ${n} is defined in en.js but never rendered by ChartExplainer. `
      + `A list of rules that leaves rules out is worse than no list.`);
  }
});

test("rules › the collapsed preference count matches the list it hides", () => {
  const defined = numbered("chart.contract.soft.");
  // The split line is conditional on the degree having free electives — 178 undergraduate
  // degrees have no general-elective pool — so it is added at render time, not counted here.
  const m = src.match(/n:\s*(\d+)\s*\+\s*\(report\.generalElectives\?\.total\s*>\s*0\s*\?\s*1\s*:\s*0\)/);
  assert.ok(m, "the preference summary no longer computes its count the way this test reads it — "
    + "if the shape changed, re-pin it here rather than deleting the check");
  assert.equal(Number(m[1]), defined.length,
    `the summary says ${m[1]} preferences (+1 for the split) but en.js defines `
    + `${defined.length} numbered ones (${defined.join(", ")}). A reader opening the list would `
    + `count a different number than the line that hid it.`);
});

test("rules › every numbered preference is rendered", () => {
  const defined = numbered("chart.contract.soft.");
  // Emitted in two halves with the split line between them, deliberately: a key is an identifier
  // and the render order is the reading order.
  const rendered = new Set(
    [...src.matchAll(/\[((?:\s*["']\d+["']\s*,?)+)\]\.map/g)]
      .flatMap(mm => [...mm[1].matchAll(/["'](\d+)["']/g)].map(x => Number(x[1]))));
  const missing = defined.filter(n => !rendered.has(n));
  assert.deepEqual(missing, [],
    `preference(s) ${missing.join(", ")} are defined in en.js and rendered by nothing. `
    + `They are also being COUNTED by the summary line, so the count would exceed the list.`);
});

test("rules › the credit-cap rule carries its exception when one applies", () => {
  // The contradiction case. Both strings must exist and the render must choose between them on
  // the report, not print the unqualified one unconditionally.
  assert.ok("chart.contract.hard.5" in en && "chart.contract.hard.5.overload" in en);
  assert.match(src, /earlyTerms\?\.overload[\s\S]{0,120}chart\.contract\.hard\.5\.overload/,
    "rule 5 no longer selects its overload variant from the report — the page would promise "
    + "'no term over the credit cap' on plans where it knowingly kept one");
});

test("rules › the re-checking detail is shown only where a plan was actually followed", () => {
  // Under `own` or `relaxed` the tool arranged every semester, so there is no published
  // arrangement to have re-checked and the section would describe work that never happened.
  assert.ok("chart.early.checks.h" in en && "chart.early.checks.p" in en);
  assert.match(src, /early\.source === "department" \|\| early\.source === "similar-programs"/,
    "the 'what gets re-checked' disclosure is no longer gated on the early-terms source");
});
