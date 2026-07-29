#!/usr/bin/env node
// Regenerate the invariant baselines from current committed data.
// Run after an intended data change (e.g. a locale gap you accept as debt, or a
// prereq that references a genuinely discontinued course): `npm run test:baseline:update`.
// Review the diff before committing — a surprising change is the signal, not the fix.
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocales, loadCatalog } from "../helpers/paths.js";

const here = dirname(fileURLToPath(import.meta.url));

// ── locale-baseline.json: en keys missing from each non-en locale ──
const locales = await loadLocales();
const enKeys = Object.keys(locales.find((l) => l.code === "en").strings);
const localeMissing = {};
for (const { code, strings } of locales) {
  if (code === "en") continue;
  const have = new Set(Object.keys(strings));
  localeMissing[code] = enKeys.filter((k) => !have.has(k)).sort();
}
writeFileSync(resolve(here, "locale-baseline.json"), JSON.stringify(localeMissing, null, 2) + "\n");

// ── prereq-resolution-baseline.json: unresolved prereq/coreq refs ──
const courses = loadCatalog();
const ids = new Set(courses.map((c) => `${c.subject.toUpperCase()}${c.number}`));
const unresolved = new Set();
const walk = (t) => {
  if (!Array.isArray(t)) return;
  for (const x of t) {
    if (Array.isArray(x)) walk(x);
    else if (x && typeof x === "object" && x.subject && x.number) {
      const id = `${String(x.subject).toUpperCase()}${x.number}`;
      if (!ids.has(id)) unresolved.add(id);
    }
  }
};
for (const c of courses) { walk(c.prereqs); walk(c.coreqs); }
writeFileSync(resolve(here, "prereq-resolution-baseline.json"), JSON.stringify([...unresolved].sort(), null, 2) + "\n");

console.log(
  `Baselines regenerated:\n` +
    `  locale-baseline.json         ${Object.entries(localeMissing).map(([k, v]) => `${k}:${v.length}`).join("  ")}\n` +
    `  prereq-resolution-baseline.json  ${unresolved.size} unresolved refs`
);
