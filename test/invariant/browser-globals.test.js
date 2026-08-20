// ═══════════════════════════════════════════════════════════════════
// A NODE GLOBAL read in browser-reachable source is a crash, and the BUILD HIDES IT.
//
// On 2026-08-20 `standingRepair.js` read `process.env.CHART_STANDING_DEBUG` inline:
//
//     if (process.env.CHART_STANDING_DEBUG) {          // ReferenceError in a browser
//
// `process` does not exist in a browser, so this threw and took the whole plan
// generation down with it. It threw from inside the one branch that runs when a class
// standing gate cannot be reached — precisely the case the report beneath it had just
// been written to explain. The feature crashed exactly where it was meant to speak.
//
// ── Why nothing caught it, and why this check is static ─────────────
//
// The two environments disagree, in the direction that hides the bug:
//
//   `vite build`  substitutes `process.env` → `{}`.  PRODUCTION WAS ALWAYS FINE.
//   `vite dev`    performs no such substitution.     ONLY `npm run dev` THREW.
//
// So every gate we own was blind. The Node suites run in Node, where `process` exists;
// so does `verify-chart`. `test:boot` mounts the BUILT app — the one environment where
// the define has already neutered it — so the guard added after the last browser outage
// was structurally incapable of catching this one. And the app degraded quietly rather
// than crashing: `SamplePlanOffer` caught the rejected promise and rendered the sentence
// a considered refusal uses, so on screen it read as "this degree cannot be planned".
//
// A static read of the SOURCE is the only kind of check that can see this, because the
// source is what the dev server runs and no other test in this repo covers it.
//
// ── No parser, because this suite may not have one ──────────────────
//
// The first version used `@babel/parser`, and `test-suite-deps` correctly failed it:
// `.github/workflows/test.yml` runs the invariant job with no `npm ci`, so a test that
// imports an external package is red in CI and green on every laptop. That constraint is
// load-bearing, so the scan is hand-rolled against Node builtins only.
//
// Hand-rolling a source scan is exactly where this repo has been burned before — a
// persistence invariant stripped `//` comments AFTER splitting on commas, so a comma
// inside a comment invented a field. So the two halves are separated and each is tested:
//
//   1. `stripNonCode` blanks comments, strings, template TEXT and regex literals,
//      preserving offsets so line numbers stay true. `${...}` inside a template is code
//      and stays code.
//   2. the identifier scan runs only on what survives.
//
// ── The rule, and why it is statement-scoped ────────────────────────
//
// A reference to a Node-only global is allowed only when `typeof <that same name>`
// appears EARLIER IN THE SAME STATEMENT. Earlier matters: JavaScript evaluates left to
// right, so `process.env.X && typeof process !== "undefined"` crashes exactly like an
// unguarded read and merely reads like a guard. Both correct sites in the repo satisfy it:
//
//     const CLOCK_FALLTHROUGH =                                     // search.js
//       typeof process !== "undefined" && !!process.env?.CHART_CLOCK_FALLTHROUGH;
//     const STDERR = typeof process !== "undefined" ? process.stderr : null;
//
// while an early-return guard does NOT, deliberately:
//
//     if (typeof process === "undefined") return;
//     return process.env.Y;                                         // still flagged
//
// That is not a limitation being tolerated, it is the rule. The broken line was in fact
// unreachable in production and reachable in dev, and nothing at the point of use said
// so. "Guarded somewhere upstream" is unreadable at the site and unenforceable here;
// capture the global into a module constant beside its own guard and every later
// reference is to an ordinary variable. Same reasoning as this repo's rule that a memo
// must be declared above its consumer.
//
// A LOCAL BINDING of one of these names is also flagged, on purpose. Scope analysis is
// what a parser buys and we do not have one — and `function f(process)` in browser code
// is worth a failing test on its own merits. The names checked are the five that are
// never plausible as ordinary identifiers; `module`, `exports` and `global` are left out
// precisely because they are.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SRC = join(ROOT, "src");

/**
 * Globals that exist in Node and not in a browser, restricted to names that could not
 * plausibly be somebody's variable. `module`/`exports`/`global` are deliberately absent:
 * without scope analysis they would flag ordinary identifiers, and an ESM codebase that
 * reached for them would fail the build for its own reasons.
 */
const NODE_ONLY = ["process", "Buffer", "__dirname", "__filename", "require"];

/**
 * Blank out everything that is not executable code, preserving length and newlines so
 * every surviving offset still maps to its original line.
 *
 * Handles line and block comments, both quote styles, template literals (text blanked,
 * `${...}` kept as code, nesting tracked), and regex literals. Regex detection uses the
 * standard heuristic — a `/` starts a literal only where a value cannot already have
 * ended — which is why `stripNonCode` has its own tests below rather than being trusted.
 */
export function stripNonCode(src) {
  const out = new Array(src.length);
  const keep = (i) => { out[i] = src[i]; };
  const blank = (i) => { out[i] = src[i] === "\n" ? "\n" : " "; };

  // `tmpl` is a stack: each entry is a template literal we are inside. A `${` pushes back
  // into code, and the matching `}` returns to template text.
  const tmpl = [];
  let i = 0;
  let prevMeaningful = "";      // last non-space code character, for the regex heuristic

  while (i < src.length) {
    const c = src[i], d = src[i + 1];

    if (c === "/" && d === "/") { while (i < src.length && src[i] !== "\n") blank(i++); continue; }
    if (c === "/" && d === "*") {
      blank(i++); blank(i++);
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) blank(i++);
      if (i < src.length) { blank(i++); blank(i++); }
      continue;
    }

    if (c === '"' || c === "'") {
      keep(i++);                                   // the quote itself is harmless syntax
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") { blank(i++); if (i < src.length) blank(i++); continue; }
        if (src[i] === "\n") break;                // unterminated; do not eat the file
        blank(i++);
      }
      if (i < src.length && src[i] === c) keep(i++);
      prevMeaningful = c;
      continue;
    }

    // NOT already in template text — otherwise this would fire on the CLOSING backtick and
    // push a second frame instead of popping, leaving the scanner inside a template for the
    // rest of the file. That was the first version, and it blanked 70 lines of real code in
    // `standingRepair.js` while every synthetic case still passed: they asserted that
    // `process` was gone, and it was gone because everything was gone. Hence the resync
    // sentinel in the test below.
    const inTemplateText = tmpl.length && tmpl[tmpl.length - 1] === true;
    if (c === "`" && !inTemplateText) { keep(i++); tmpl.push(true); prevMeaningful = "`"; continue; }

    // Inside template TEXT: blank until `${`, a closing backtick, or an escape.
    if (inTemplateText) {
      if (c === "\\") { blank(i++); if (i < src.length) blank(i++); continue; }
      if (c === "`") { keep(i++); tmpl.pop(); prevMeaningful = "`"; continue; }
      if (c === "$" && d === "{") {
        keep(i++); keep(i++);
        tmpl[tmpl.length - 1] = 0;                 // depth counter for nested braces
        prevMeaningful = "{";
        continue;
      }
      blank(i++);
      continue;
    }

    // Inside `${...}`: ordinary code, but track braces so the right `}` pops us back.
    if (tmpl.length && typeof tmpl[tmpl.length - 1] === "number") {
      if (c === "{") tmpl[tmpl.length - 1]++;
      else if (c === "}") {
        if (tmpl[tmpl.length - 1] === 0) { keep(i++); tmpl[tmpl.length - 1] = true; prevMeaningful = "}"; continue; }
        tmpl[tmpl.length - 1]--;
      }
      // fall through to the generic code handling below
    }

    if (c === "/" && !/[A-Za-z0-9_$)\].]/.test(prevMeaningful)) {
      // A regex literal. Blank its body and flags; a `/` inside a class `[...]` is literal.
      blank(i++);
      let inClass = false;
      while (i < src.length && src[i] !== "\n") {
        if (src[i] === "\\") { blank(i++); if (i < src.length) blank(i++); continue; }
        if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        else if (src[i] === "/" && !inClass) { blank(i++); break; }
        blank(i++);
      }
      while (i < src.length && /[a-z]/.test(src[i])) blank(i++);   // flags
      prevMeaningful = ")";                        // a regex is a value, like `)`
      continue;
    }

    if (!/\s/.test(c)) prevMeaningful = c;
    keep(i++);
  }

  return out.join("");
}

/** Every `.js`/`.jsx` under `src/`, minus the Node-only adapters. */
function browserFiles(dir = SRC, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { browserFiles(p, out); continue; }
    if (!/\.jsx?$/.test(e.name)) continue;
    if (/\.node\.jsx?$/.test(e.name)) continue;
    out.push(p);
  }
  return out;
}

/**
 * The statement `at` sits in: the span between the nearest enclosing `;`, `{` or `}`.
 *
 * Crude by design and sufficient for the rule — a `typeof` guard and the use it guards
 * are the same expression in every correct site, and anything separated by a statement
 * boundary is what this check means to reject.
 */
function statementStart(code, at) {
  let s = at;
  while (s > 0 && !";{}".includes(code[s - 1])) s--;
  return s;
}

/** Bare references to Node-only globals in `code` (already stripped), as line numbers. */
export function bareNodeGlobals(code) {
  const hits = [];
  for (const name of NODE_ONLY) {
    const re = new RegExp(`(^|[^A-Za-z0-9_$.])${name}\\b`, "g");
    let m;
    while ((m = re.exec(code))) {
      const at = m.index + m[1].length;
      const before = code.slice(0, at);
      // The operand of `typeof` IS the guard — the one reference to a possibly-undeclared
      // name that is legal by definition. Exempt first: without this the check flags every
      // CORRECT guard in the codebase and nothing else, which is exactly backwards.
      if (/\btypeof\s+$/.test(before)) continue;
      // An object-literal KEY, not a reference: `{ process: 1 }` / `, Buffer: 2`.
      const after = code.slice(at + name.length).match(/^\s*:/);
      if (after && /[{,]\s*$/.test(before)) continue;
      // The guard must PRECEDE the use, in the same statement. JavaScript evaluates
      // left to right, so `process.env.X && typeof process !== "undefined"` is the same
      // crash as no guard at all — it just reads like a guard. Requiring the `typeof`
      // to come first is what distinguishes the two without an AST.
      const prefix = code.slice(statementStart(code, at), at);
      if (new RegExp(`typeof\\s+${name}\\b`).test(prefix)) continue;
      hits.push({ name, line: before.split("\n").length });
    }
  }
  return hits;
}

// ── The scanner is tested before it is trusted ─────────────────────
test("stripNonCode blanks non-code and keeps code, without moving line numbers", () => {
  const cases = [
    ["// process.env.X\n", false, "line comment"],
    ["/* process.env.X */\n", false, "block comment"],
    ['const a = "process.env.X";\n', false, "double-quoted string"],
    ["const a = 'process.env.X';\n", false, "single-quoted string"],
    ["const a = `process.env.X`;\n", false, "template TEXT"],
    ["const a = /process/.test(b);\n", false, "regex literal"],
    ["const a = `v=${process.env.X}`;\n", true, "interpolation is CODE"],
    ["const a = `${ {k:`${process.env.X}`} }`;\n", true, "nested interpolation is CODE"],
    ["if (process.env.X) {}\n", true, "plain code"],
    ["const a = b / c; const d = process.env.X;\n", true, "division is not a regex"],
  ];
  // ── The sentinel is the whole point ────────────────────────────
  //
  // "expected `process` to be blanked" passes just as happily when the scanner has
  // desynchronized and blanked the ENTIRE FILE, which is precisely what the first version
  // did on a line holding two template literals. So every case is followed by a line of
  // ordinary code that MUST survive: it asserts the scanner came back, not merely that it
  // left. This one assertion is the difference between a check and a decoration.
  const SENTINEL = "\nconst zzz = __dirname;\n";

  for (const [src, shouldSurvive, label] of cases) {
    const full = src + SENTINEL;
    const stripped = stripNonCode(full);
    assert.equal(stripped.length, full.length, `${label}: length changed`);
    assert.equal(stripped.split("\n").length, full.split("\n").length, `${label}: newlines moved`);
    assert.equal(/\bprocess\b/.test(stripped), shouldSurvive,
      `${label}: expected process ${shouldSurvive ? "to survive" : "to be blanked"}\n  ${JSON.stringify(stripped)}`);
    assert.ok(/\b__dirname\b/.test(stripped),
      `${label}: the scanner did NOT resynchronize — code after this construct was blanked, `
      + `so any check downstream of it silently sees nothing\n  ${JSON.stringify(stripped)}`);
  }
});

test("the scanner resynchronizes on the shapes real source actually contains", () => {
  // Every one of these is copied from `src/engine/` and each broke an earlier version.
  const shapes = [
    "const f = (a,b) => x?.has(`${a}|${b}`) || y?.has(`${b}|${a}`);",   // two templates, one line
    'const s = `t${c}[std=${ok?"y":"n"} fit=${f?"y":"n"}]`;',            // strings inside ${}
    "const s = `d=[${(g.p.domain ?? []).join(\",\")}] → ${w.join(\" \") || \"NONE\"}\\n`;",
    "const r = /[A-Za-z0-9_$)\\].]/.test(p) ? 1 : 2;",                   // regex holding a slash-ish class
    "const q = a / b / c;",                                              // division, twice
    "const t = `a` + `b` + `c`;",                                        // three templates
    "const u = `outer ${ `inner ${x}` } end`;",                          // nested template
  ];
  for (const s of shapes) {
    const stripped = stripNonCode(s + "\nconst zzz = __dirname;\n");
    assert.ok(/\b__dirname\b/.test(stripped),
      `desynchronized on: ${s}\n  → ${JSON.stringify(stripped)}`);
  }
});

test("the guard rule accepts every correct shape and rejects every broken one", () => {
  const flagged = (src) => bareNodeGlobals(stripNonCode(src)).length > 0;

  // MUST FLAG
  assert.ok(flagged(`if (process.env.CHART_STANDING_DEBUG) return 1;`), "the real bug");
  assert.ok(flagged(`const a = process.cwd();`), "bare call");
  assert.ok(flagged(`const a = Buffer.from("x");`), "Buffer");
  assert.ok(flagged(`const a = __dirname;`), "__dirname");
  assert.ok(flagged(`const a = require("node:fs");`), "require");
  assert.ok(flagged(`process.stderr.write("x");`), "bare stderr write");
  assert.ok(flagged(`const a = process.env.X && typeof process !== "undefined";`),
    "guarded on the WRONG side is the same crash with a reassuring shape");
  assert.ok(flagged(`if (typeof process === "undefined") return null;\nreturn process.env.Y;`),
    "an early-return guard is deliberately not accepted");

  // MUST NOT FLAG
  assert.ok(!flagged(`const A =\n  typeof process !== "undefined" && !!process.env?.X;`),
    "the search.js shape, across two lines");
  assert.ok(!flagged(`const S = typeof process !== "undefined" ? process.stderr : null;`),
    "the ternary shape");
  assert.ok(!flagged(`const B = typeof Buffer !== "undefined" ? Buffer.alloc(1) : null;`), "Buffer guarded");
  assert.ok(!flagged(`function f(o) { return o.process; }`), "member NAME");
  assert.ok(!flagged(`const O = { process: 1, Buffer: 2 };`), "object keys");
  assert.ok(!flagged(`const s = "process.env.X";`), "inside a string");
  assert.ok(!flagged(`// process.env.X is the bug\n`), "inside a comment");
});

// ── The invariants themselves ──────────────────────────────────────
test("the *.node.js convention still describes every Node-only module in src/", () => {
  const mislabelled = [];
  for (const f of browserFiles()) {
    const code = stripNonCode(readFileSync(f, "utf8"));
    if (/from\s*["']node:|require\(\s*["']node:/.test(code)) mislabelled.push(relative(ROOT, f));
  }
  assert.deepEqual(mislabelled, [],
    "these import a node: builtin but are not named *.node.js, so the check below is "
    + "excluding the wrong set of files:\n  " + mislabelled.join("\n  "));
});

test("no browser-reachable source reads a Node-only global outside a typeof guard", () => {
  const violations = [];
  for (const file of browserFiles()) {
    const code = stripNonCode(readFileSync(file, "utf8"));
    for (const h of bareNodeGlobals(code)) {
      violations.push(`${relative(ROOT, file)}:${h.line} — bare \`${h.name}\``);
    }
  }
  assert.deepEqual(violations, [],
    "Node-only globals read without a `typeof` guard in browser-reachable source.\n"
    + "These throw a ReferenceError under `npm run dev` and are SILENTLY REWRITTEN by\n"
    + "`vite build`, so production hides them and no other test here can see them.\n"
    + "Capture the value into a module constant beside its own typeof guard.\n  "
    + violations.join("\n  "));
});
