#!/usr/bin/env node
/**
 * build-programs-bundle.js
 *
 * Serializes both program trees (data/northeastern/programs/undergraduate + data/northeastern/programs/graduate)
 * into a single JSON asset the hosted MCP Worker can fetch:
 *
 *   public/northeastern/programs-bundle.json
 *   { generatedAt, programs: [...], programData: { "<id>": <parsed json> } }
 *
 * The browser app keeps using its Vite module maps; this bundle exists
 * because Cloudflare Workers can't read the source tree from fs.
 *
 * Runs as part of `npm run build` so every site deploy ships a fresh
 * bundle alongside the other scraped data files.
 *
 * Usage:
 *   node scripts/build-programs-bundle.js            # write the bundle
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPrograms } from "../src/adapters/northeastern/programRegistry.node.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT  = join(ROOT, "public/northeastern/programs-bundle.json");

const { programs, programData } = loadPrograms();

const payload = { programs, programData: Object.fromEntries(programData) };

// ── Rewrite only when the PROGRAMS changed, not when the clock did ──────────
//
// `generatedAt: new Date()` made this 6.5 MB file differ on every single run,
// so every build that touched it added 6.5 MB to a repository whose history is
// already ~1 GB — for no change in content. `npm run build` runs this, and the
// build now runs inside the monthly data workflows as a gate, so that would
// have been twelve pointless copies a year on the course pipeline alone.
//
// Carrying the previous timestamp forward is also the more honest answer for
// the one thing that reads it: the hosted MCP worker reports it as
// `programsGeneratedAt` (cloudflare/mcp-server/src/loadData.js), and if the
// programs have not moved since August then August is when they were
// generated. Staleness of the bundle against the source tree is a different
// question, and test/invariant/programs-bundle-fresh.test.js already answers
// it — which is what makes this safe: if the bundle ever fails to update when
// the trees DO change, that invariant fails.
const previous = existsSync(OUT) ? readFileSync(OUT, "utf8") : null;
let generatedAt = new Date().toISOString();
if (previous) {
  try {
    const { generatedAt: was, ...rest } = JSON.parse(previous);
    if (was && JSON.stringify(rest) === JSON.stringify(payload)) generatedAt = was;
  } catch { /* unreadable previous bundle — write a fresh one */ }
}

const json = JSON.stringify({ generatedAt, ...payload });
const unchanged = previous === json;
if (!unchanged) writeFileSync(OUT, json);
console.log(
  `programs-bundle.json: ${programs.length} programs ` +
  `(${programs.filter(p => p.level === "grad").length} grad), ` +
  `${(Buffer.byteLength(json) / 1048576).toFixed(1)} MB ` +
  (unchanged ? `— unchanged since ${generatedAt.slice(0, 10)}, not rewritten` : `→ ${OUT}`)
);
