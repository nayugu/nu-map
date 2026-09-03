// ═══════════════════════════════════════════════════════════════════
// CONTRACT · every catalog loader applies every co-op stamp
//
// There are THREE catalog loaders — the browser adapter, the Node one behind
// the dev MCP server, and the Cloudflare worker's — and `stampCoopVariants`
// carries a comment saying all three must apply it, with the exact failure
// spelled out: a loader that skips the stamp "reports a graduate student's
// co-op requirement unmet while the app beside it reports it met".
//
// Nothing checked it. The comment has been the only guard since the stamp was
// written, and adding a SECOND stamp with the same requirement is the moment
// that stops being good enough — the next one will be added by someone reading
// one loader, and two of the three will silently disagree.
//
// This is a source scan rather than a behavioural test on purpose: the three
// loaders cannot be executed in one process (one fetches over HTTP, one reads
// the filesystem, one needs a Workers runtime), so the thing that is actually
// checkable is that each file calls each stamp.
// ═══════════════════════════════════════════════════════════════════

import test        from "node:test";
import assert      from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath }    from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Every loader that turns the raw catalog into normalized Course records.
const LOADERS = [
  "src/adapters/northeastern/courseCatalog.js",        // browser
  "src/adapters/northeastern/courseCatalog.node.js",   // Node / dev MCP
  "cloudflare/mcp-server/src/loadData.js",             // Cloudflare worker
];

// Every stamp that must reach all of them. Add a row here when adding a stamp;
// that is the whole point of the file.
const STAMPS = ["stampCoopVariants", "stampCoopPrep"];

const src = (p) => readFileSync(resolve(ROOT, p), "utf8");

for (const loader of LOADERS) {
  test(`${loader} applies every co-op stamp`, () => {
    const text = src(loader);
    for (const stamp of STAMPS) {
      assert.ok(
        text.includes(`${stamp}(`),
        `${loader} never calls ${stamp}(). A loader that skips a stamp makes the ` +
        `panel and an MCP audit disagree about the same course, silently.`
      );
      assert.ok(
        new RegExp(`import[\\s\\S]*?\\b${stamp}\\b[\\s\\S]*?from`).test(text),
        `${loader} calls ${stamp}() without importing it`
      );
    }
  });
}

test("every stamp under test is really exported by courseNorm", () => {
  // Guards the reverse mistake: a renamed stamp would leave every assertion
  // above passing against a name nothing exports.
  const norm = src("src/adapters/northeastern/courseNorm.js");
  for (const stamp of STAMPS) {
    assert.ok(
      new RegExp(`export function ${stamp}\\b`).test(norm),
      `courseNorm.js does not export ${stamp}`
    );
  }
});

test("the loader list has not silently shrunk", () => {
  // If a fourth loader appears, this file is the place that has to notice.
  assert.equal(LOADERS.length, 3, "loader count changed — add it to LOADERS above");
  for (const l of LOADERS) assert.doesNotThrow(() => src(l), `${l} is missing`);
});
