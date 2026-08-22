// INVARIANT · /data belongs to two things at once, and they must stay disjoint.
//
// The planner's requirement files live in the repo's `data/` directory, which
// sits at the project ROOT, so in dev Vite serves them as module URLs —
// `/data/northeastern/programs/**/requirements.json?import`, the lazy
// import.meta.glob in src/data/majorLoader.js. The public AI data surface is
// generated into `dist/data/` and served under the SAME prefix by
// aiDataDevPlugin in vite.config.js.
//
// When that plugin claimed the prefix outright, every major in dev failed with
// "Failed to fetch dynamically imported module": the requirement JSON came
// back as the not-found HTML page, because the surface has no such file and
// never will. Rebuilding could not help. Production was fine throughout — the
// JSON is bundled there — which is exactly what makes this the kind of bug
// that comes back: nothing outside a dev session ever notices.
//
// So the rule is asserted rather than remembered. Two halves:
//   · the dev middleware hands a real file back to Vite instead of answering
//     for it, so a new directory under data/ is safe the day it appears;
//   · the generated surface never emits a route that shadows one, so the two
//     namespaces cannot collide in the first place.
//
// Committed data only — no network, no server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../helpers/paths.js";

const DATA_DIR = join(ROOT, "data");
const DIST_DATA = join(ROOT, "dist", "data");

/**
 * Drive the dev plugin's own hook to get at its middleware.
 *
 * Imported from `build/aiDataDevPlugin.js` rather than from `vite.config.js`. Going
 * through the config pulled in `vite` and `@vitejs/plugin-react`, which are
 * devDependencies — so this passed locally and failed on CI with ERR_MODULE_NOT_FOUND,
 * because `.github/workflows/test.yml` deliberately omits `npm ci` from the invariant
 * job to keep this suite dependency-free. The plugin now lives in a module that imports
 * Node builtins only.
 */
async function devMiddleware() {
  const mod = await import(`${ROOT}/build/aiDataDevPlugin.js`);
  const plugin = mod.default(ROOT);
  assert.equal(plugin?.name, "ai-data-dev",
    "aiDataDevPlugin is gone — this invariant needs rewriting, not deleting");
  let fn = null;
  plugin.configureServer({ middlewares: { use: (handler) => { fn = handler; } } });
  assert.ok(fn, "the plugin registered no middleware");
  return fn;
}

/** Run one request through it; resolves "next" or the status it answered with. */
function ask(fn, url) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      setHeader() {},
      end() { resolve(`answered ${this.statusCode}`); },
    };
    Promise.resolve(fn({ url }, res, () => resolve("next"))).catch(reject);
  });
}

test("the planner's own data files are handed back to Vite, not answered for", async () => {
  const fn = await devMiddleware();
  // A real file under data/, addressed both ways the app can address it.
  const real = "/data/northeastern/programs/undergraduate/2026";
  const anyProgram = existsSync(join(ROOT, real.slice(1)))
    ? readdirSync(join(ROOT, real.slice(1)))
        .flatMap(college => {
          const dir = join(ROOT, real.slice(1), college);
          return statSync(dir).isDirectory()
            ? readdirSync(dir).map(p => `${real}/${college}/${p}/requirements.json`)
            : [];
        })
        .find(p => existsSync(join(ROOT, p.slice(1))))
    : null;
  assert.ok(anyProgram, "no undergraduate requirements.json on disk to test with");

  assert.equal(await ask(fn, anyProgram), "next", "the raw file must go back to Vite");
  assert.equal(await ask(fn, `${anyProgram}?import`), "next", "the module URL must go back to Vite");
  // Vite appends these to busted/optimised module URLs; they are never surface pages.
  assert.equal(await ask(fn, `${anyProgram}?t=1699999999999`), "next");
});

test("the generated surface still answers for its own pages", async () => {
  const fn = await devMiddleware();
  // Not a file under data/, so it belongs to the surface — whether it exists
  // there or not, this middleware is the one that must decide.
  assert.match(await ask(fn, "/data/nonexistent-page-xyz"), /^answered/);
});

test("the dev server serves the search box's own build artifacts", async () => {
  // Reported as "I type and nothing comes up" on localhost. The /data pages
  // load a hashed index and widget from /assets/, and in dev nothing serves
  // that directory — Vite has no dist/, and these files are emitted by the
  // build rather than transformed from source. The pages rendered, the script
  // 404'd, and the box was inert. Status was no clue either: the page was 200.
  const fn = await devMiddleware();
  const dist = join(ROOT, "dist", "assets");
  const built = existsSync(dist)
    ? readdirSync(dist).filter((f) => /^data-(index|search)-[a-f0-9]+\.(json|js)$/.test(f))
    : [];
  for (const f of built) {
    assert.equal(await ask(fn, `/assets/${f}`), "answered 200",
      `dev did not serve /assets/${f}`);
  }
  // The prefix is narrow on purpose: no other /assets/ request may be swallowed,
  // or the dev server stops serving the app's own bundles.
  for (const other of ["/assets/index-abc123.js", "/assets/build.json",
                       "/assets/data-other-abc.js", "/assets/data-index-.json"]) {
    assert.equal(await ask(fn, other), "next", `dev swallowed ${other}`);
  }
});

test("no page asks another origin for the search assets", () => {
  // The bug underneath the one above: the markup named
  // https://numap.app/assets/... so a dev browser asked PRODUCTION for a hash
  // that only exists locally. Root-relative is correct on both, and this is
  // the cheap guard against reintroducing an absolute one.
  const hub = join(ROOT, "dist", "data.html");
  if (!existsSync(hub)) return;                 // nothing built here to check
  const html = readFileSync(hub, "utf8");
  assert.ok(!/https:\/\/numap\.app\/assets\//.test(html),
    "a generated page names the assets origin absolutely");
  assert.match(html, /src="\/assets\/data-search-[a-f0-9]+\.js"/);
  assert.match(html, /data-index="\/assets\/data-index-[a-f0-9]+\.json"/);
});

test("no surface route shadows a directory the app serves from data/", () => {
  if (!existsSync(DIST_DATA)) return;   // nothing built here; the check below is the real guard
  const appOwned = readdirSync(DATA_DIR);
  const surface  = new Set(readdirSync(DIST_DATA));
  for (const name of appOwned) {
    assert.ok(!surface.has(name),
      `dist/data/${name} shadows data/${name} — the AI surface and the planner's own files ` +
      `would both claim /data/${name}, and in dev exactly one of them wins`);
  }
});

test("the app's data directory stays where the middleware expects it", () => {
  // If data/ is ever moved or renamed, this collision disappears for good and
  // the guard above becomes dead weight — fail so it gets removed knowingly.
  assert.ok(existsSync(join(DATA_DIR, "northeastern")),
    "data/northeastern is gone: re-read test/invariant/dev-data-namespace.test.js");
});
