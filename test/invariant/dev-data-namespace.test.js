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
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../helpers/paths.js";

const DATA_DIR = join(ROOT, "data");
const DIST_DATA = join(ROOT, "dist", "data");

/** Pull the dev middleware out of vite.config.js by driving its plugin hook. */
async function devMiddleware() {
  const config = (await import(`${ROOT}/vite.config.js`)).default;
  const plugin = (config.plugins ?? []).flat().find(p => p?.name === "ai-data-dev");
  assert.ok(plugin, "aiDataDevPlugin is gone — this invariant needs rewriting, not deleting");
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
