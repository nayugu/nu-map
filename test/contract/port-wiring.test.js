// ═══════════════════════════════════════════════════════════════════
// CONTRACT: every port the UI asks for is actually wired
//
// ── The bug this exists for ─────────────────────────────────────────
//
// CHART's `planGenerator` port was wired into `src/adapters/northeastern/index.js`, which
// is not the file the app uses. The live one is `src/config.js`, which calls `wire()` with
// an explicit list. So `usePort(IPlanGenerator)` returned `undefined`, `canGenerate` was
// false, and the Generate button sat correctly disabled with nothing anywhere saying why.
// It was found by driving a browser, which is an expensive way to learn that a name is
// missing from a list.
//
// It is a STATIC property — "the UI asks for a key that nothing provides" needs no DOM, no
// React and no render. Which matters, because this repo has no jsdom, react-dom or
// testing-library, and adding them to catch one class of bug is a bigger decision than the
// bug warrants. What a render test would ALSO catch and this does not is stated at the
// bottom, so the gap is recorded rather than implied.
//
// ── Why it reads the files as text ──────────────────────────────────
//
// `src/config.js` cannot be imported here: it reads `import.meta.env.DEV`, which Vite
// substitutes at build time and Node leaves undefined, so importing it throws. Reading it
// as source is the honest way to ask "is this name in that list", and it is exactly the
// question the bug was an answer to.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;

/** Every .js/.jsx file under a directory, recursively. */
function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { out.push(...sourceFiles(p)); continue; }
    if (/\.(js|jsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** Port key by exported constant name: `export const ICalendar = "calendar"`. */
function portKeys() {
  const byName = new Map();
  for (const f of sourceFiles(join(ROOT, "src/ports"))) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/export\s+const\s+(I[A-Za-z0-9_]+)\s*=\s*["']([^"']+)["']/g)) {
      byName.set(m[1], m[2]);
    }
  }
  return byName;
}

const KEYS = portKeys();
const CONFIG = readFileSync(join(ROOT, "src/config.js"), "utf8");

test("wiring › the port registry is readable at all", () => {
  // If this fails the rest is vacuous — a regex that matches nothing would let every
  // assertion below pass while checking nothing, which is the failure mode that made the
  // original bug invisible.
  assert.ok(KEYS.size >= 8, `only found ${KEYS.size} port keys in src/ports`);
  assert.equal(KEYS.get("ICalendar"), "calendar");
});

test("wiring › every port the UI calls usePort for is wired in config.js", () => {
  const missing = [];
  for (const f of sourceFiles(join(ROOT, "src/ui"))) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/usePort\(\s*(I[A-Za-z0-9_]+)\s*\)/g)) {
      const name = m[1];
      const key = KEYS.get(name);
      if (!key) { missing.push(`${f.replace(ROOT, "")}: ${name} is not a known port`); continue; }
      // The adapter appears in the wire() call either as a shorthand property or as
      // `key: something`. Either satisfies the question being asked.
      const wired = new RegExp(`(^|[\\s,{])${key}\\s*[,:}\\n]`, "m").test(CONFIG);
      if (!wired) {
        missing.push(`${f.replace(ROOT, "")}: usePort(${name}) → "${key}" is not wired in src/config.js`);
      }
    }
  }
  assert.deepEqual(missing, [],
    `a port the UI depends on is missing from the LIVE wiring file:\n  ${missing.join("\n  ")}`);
});

test("wiring › config.js wires nothing that is not a known port", () => {
  // The other direction, which catches a typo in the wiring rather than a gap. `wire()`
  // already throws on an unknown key in dev, but only once the app boots — and a key that
  // is merely misspelled is invisible until the feature is used.
  const call = /wire\(\{([\s\S]*?)\n\}\)/.exec(CONFIG);
  assert.ok(call, "could not find the wire({...}) call in src/config.js");
  const known = new Set(KEYS.values());
  const unknown = [];
  for (const line of call[1].split("\n")) {
    const m = /^\s*([a-zA-Z][A-Za-z0-9_]*)\s*[,:]/.exec(line);
    if (!m) continue;                                  // a comment, a spread, or blank
    if (!known.has(m[1])) unknown.push(m[1]);
  }
  assert.deepEqual(unknown, [],
    `src/config.js wires a key no port declares: ${unknown.join(", ")}`);
});

// ── What this does NOT catch, and would need a DOM ──────────────────
//
// Two of the three bugs found by driving a browser are still uncovered here, and both are
// runtime-ordering faults inside a component:
//
//   the TDZ    `const canGenerate` declared BELOW the memo that read it, so every render
//              with a program selected threw "Cannot access before initialization".
//              An ESLint `no-use-before-define` rule would catch this class without a DOM.
//   the effect `gen`/`genBusy` in a dependency array AND set by the effect: the cleanup
//              cleared `live`, so the panel showed "Working out an order…" for ever with no
//              error. Only rendering finds this one.
//
// Recorded rather than quietly skipped: the gap is a render smoke test, and it costs a
// jsdom dependency.
