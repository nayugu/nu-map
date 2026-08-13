// INVARIANT · no locale may define the same key twice.
//
// A duplicate key in a JS object literal is not an error — the LAST one wins
// and the earlier one is dead text. So a translation can be present, correct,
// reviewed, and never rendered, and nothing anywhere reports it: the
// completeness check passes (the key exists), the app runs (a string comes
// back), and only the wrong words appear on screen.
//
// zh.js carried exactly this. It defined `header.io.export.json` twice, once
// as "导出 JSON" and again, twelve characters later, as "下载" — so the
// reviewed label was silently replaced by the other one. It was found by
// accident while renaming that very key.
//
// Checked by reading source text rather than by importing the module, because
// importing is precisely what destroys the evidence: by the time it is an
// object the duplicate is gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../../src/locales");

// glossary.js is excluded, and not as a convenience: it is a NESTED map
// (English source string → { locale: translation }), so its inner keys are
// locale codes that repeat in every entry by design. A line-anchored scan
// cannot tell those from a genuine duplicate, and the flat string maps are
// what this invariant is about.
const files = readdirSync(DIR).filter(f => f.endsWith(".js") && f !== "glossary.js");

test("locales › the directory was actually found", () => {
  // Guards the whole file against silently checking nothing.
  assert.ok(files.length >= 8, `expected at least 8 locale files, saw ${files.length}`);
});

for (const file of files) {
  test(`locales › ${file} defines every key exactly once`, () => {
    const src = readFileSync(join(DIR, file), "utf8");
    // Keys are quoted and at the start of a line in every locale file; that is
    // the shape the whole directory is written in, and a key indented inside a
    // nested object would still be caught, just attributed to the same map.
    const keys = [...src.matchAll(/^\s*"([^"]+)"\s*:/gm)].map(m => m[1]);
    assert.ok(keys.length > 100, `${file} yielded only ${keys.length} keys — the scan is broken`);

    const seen = new Set();
    const dupes = [];
    for (const k of keys) {
      if (seen.has(k) && !dupes.includes(k)) dupes.push(k);
      seen.add(k);
    }
    assert.deepEqual(
      dupes, [],
      `${file} defines ${dupes.length} key(s) twice: ${dupes.join(", ")}. ` +
      "The later definition silently wins and the earlier translation is never shown."
    );
  });
}
