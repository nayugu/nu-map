// ═══════════════════════════════════════════════════════════════════
// The UNIT and INVARIANT suites must import nothing but `src/`, `scripts/` and Node builtins.
//
// `.github/workflows/test.yml` runs both jobs with **no `npm ci`**, and says why:
//
//   "The three 'pure' jobs need no npm install — the unit and invariant import only src/ +
//    Node builtins (committed data, no runtime deps), and keeping it that way is enforced
//    here by omitting the install step. ... Do not add an install step to unit or invariant —
//    the dependency-free constraint is what lets major-verify.js be a pure function the
//    invariant suite can import."
//
// ── Why the enforcement needed to move here ─────────────────────────
//
// "Enforced by omitting the install step" enforces it in CI and nowhere else. Locally
// `node_modules` exists, so a test that reaches an external dependency passes on every
// developer machine and fails only after a push — and it fails in the least legible way
// available, because the import throws before any assertion runs and `node --test` reports the
// whole file as one failure at line 1:1 with the message `'test failed'`. Nothing in that output
// names the missing module.
//
// That is exactly what happened to `pathway-extract.test.js`: it sat in `test/unit/` importing
// `scripts/lib/pathway-extract.js`, which imports `node-html-parser`. It was added in
// `80618e37c7`, reached main, and was red there for as long as it lived in that directory —
// invisible to everyone running `npm test`.
//
// So the constraint is asserted where it can fail on a laptop. A violation is a two-second fix
// (move the file to `test/contract/`, the one job that installs) and a long CI hunt otherwise.
//
// ── TRANSITIVE, because the import that breaks it is never in the test file ──
//
// The test file imports `src/` or `scripts/`, which is fine on its face; the external dependency
// is one or two hops down. A check that read only the test's own import list would have passed
// the exact file that motivated this.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";

// fileURLToPath, not .pathname: the latter is percent-encoded and breaks on a checkout whose
// path contains a space.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

// A builtin is legal whether or not it carries the `node:` prefix. Both spellings are in use
// across the suites, and treating the bare form as external would report `fs` as a dependency in
// eight invariant files — which is how the first version of this scan read, and it buried the one
// real finding under noise.
const BUILTIN = new Set(builtinModules);

// Static imports, re-exports and dynamic `import(...)` with a literal specifier. A computed
// specifier cannot be resolved without running the file, and there are none in these suites; if
// one ever appears this check silently stops seeing it, which is the known limit of the approach.
const SPEC = /(?:^|\n)\s*(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g;

/** Every external package `file` reaches, following relative imports only. */
function externalsOf(file, seen, stack = new Set()) {
  if (seen.has(file)) return seen.get(file);
  // A cycle contributes nothing rather than looping — the same call `buildDepthIndex` makes.
  if (stack.has(file)) return new Set();
  stack.add(file);
  const out = new Set();
  let src = "";
  try { src = readFileSync(file, "utf8"); } catch { stack.delete(file); return out; }
  for (const m of src.matchAll(SPEC)) {
    const spec = m[1] ?? m[2];
    if (!spec || spec.startsWith("node:") || BUILTIN.has(spec)) continue;
    if (!spec.startsWith(".") && !spec.startsWith("/")) { out.add(spec); continue; }
    let p = resolve(dirname(file), spec);
    // Extensionless and directory-index forms, which the suites do use.
    if (!existsSync(p)) {
      if (existsSync(`${p}.js`)) p = `${p}.js`;
      else if (existsSync(join(p, "index.js"))) p = join(p, "index.js");
    }
    for (const e of externalsOf(p, seen, stack)) out.add(e);
  }
  stack.delete(file);
  seen.set(file, out);
  return out;
}

const scan = (dir) => {
  const seen = new Map();
  const offenders = [];
  const base = join(ROOT, dir);
  for (const f of readdirSync(base)) {
    if (!f.endsWith(".test.js")) continue;
    const ext = externalsOf(join(base, f), seen);
    if (ext.size) offenders.push(`${dir}/${f} reaches ${[...ext].sort().join(", ")}`);
  }
  return offenders;
};

for (const dir of ["test/unit", "test/invariant"]) {
  test(`${dir} imports no external package (the CI job has no npm install)`, () => {
    const offenders = scan(dir);
    assert.deepEqual(offenders, [],
      `${offenders.length} file(s) in ${dir} reach a package that is not installed in CI:\n  `
      + `${offenders.join("\n  ")}\n\n`
      + `The unit and invariant jobs in .github/workflows/test.yml run WITHOUT \`npm ci\`, so `
      + `these fail in CI while passing locally — as one unnamed failure at line 1:1. Move the `
      + `file to test/contract/, which is the one job that installs. Do NOT add an install step `
      + `to unit or invariant; the dependency-free constraint is load-bearing.`);
  });
}

test("the dependency scan actually resolves imports (it must be able to fail)", () => {
  // A scan that silently resolved nothing would report every suite clean, which is the most
  // reassuring output this file can produce and the least true. So: prove it sees a real
  // external package through a chain of relative imports, using the very module that motivated
  // the check. `scripts/lib/pathway-extract.js` imports `node-html-parser` directly, and
  // `scripts/lib/pathway-intake.js` reaches it transitively.
  const direct = externalsOf(join(ROOT, "scripts/lib/pathway-extract.js"), new Map());
  assert.ok(direct.has("node-html-parser"),
    "the scan cannot see a DIRECT external import; it would pass everything");
  // And that it follows relative hops rather than reading one file. If this module ever stops
  // importing the extractor the assertion is wrong rather than the scan, so it names why.
  const viaHop = externalsOf(join(ROOT, "test/contract/pathway-extract.test.js"), new Map());
  assert.ok(viaHop.has("node-html-parser"),
    "the scan does not follow relative imports, so a dependency one hop down is invisible — "
    + "which is precisely the case it exists to catch");
});
