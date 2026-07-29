// INVARIANT · src/locales/*  — every user-facing string exists in all 8 locales.
//
// Two properties:
//   1. Zero orphan keys — a key in a non-en locale that is NOT in en means a
//      typo or a rename that left a dead translation. Always a bug → hard fail.
//   2. Full coverage vs en — any en key missing from a locale silently falls back
//      to English in the UI. A committed baseline records the currently-known
//      gaps (locale-baseline.json); the test fails only when a NEW gap appears.
//      Shrink the baseline (npm run test:baseline:update) when gaps close.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLocales, readJson } from "../helpers/paths.js";

const baseline = readJson("test/invariant/locale-baseline.json");

test("locales › every locale exports meta + strings", async () => {
  for (const { code, meta, strings } of await loadLocales()) {
    assert.ok(meta && meta.code === code, `${code}: meta.code mismatch`);
    assert.ok(meta.name && meta.nativeName && meta.dir, `${code}: meta missing name/nativeName/dir`);
    assert.ok(strings && typeof strings === "object", `${code}: strings missing`);
  }
});

test("locales › no orphan keys (present in a locale but not in en)", async () => {
  const locales = await loadLocales();
  const en = new Set(Object.keys(locales.find((l) => l.code === "en").strings));
  const orphans = [];
  for (const { code, strings } of locales) {
    if (code === "en") continue;
    for (const k of Object.keys(strings)) if (!en.has(k)) orphans.push(`${code} :: ${k}`);
  }
  assert.deepEqual(orphans, [], `Orphan keys (remove or fix the key name):\n  ${orphans.join("\n  ")}`);
});

test("locales › no NEW untranslated keys beyond the recorded baseline", async () => {
  const locales = await loadLocales();
  const enKeys = Object.keys(locales.find((l) => l.code === "en").strings);
  const regressions = [];
  for (const { code, strings } of locales) {
    if (code === "en") continue;
    const have = new Set(Object.keys(strings));
    const known = new Set(baseline[code] || []);
    for (const k of enKeys) {
      if (!have.has(k) && !known.has(k)) regressions.push(`${code} :: ${k}`);
    }
  }
  assert.deepEqual(
    regressions,
    [],
    `New untranslated key(s) — add hand-written translations, or accept as debt via ` +
      `\`npm run test:baseline:update\`:\n  ${regressions.join("\n  ")}`
  );
});
