#!/usr/bin/env node
/**
 * build-programs-bundle.js
 *
 * Serializes both program trees (data/northeastern/programs/majors + data/northeastern/programs/grad-majors)
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
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPrograms } from "../src/adapters/northeastern/programRegistry.node.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT  = join(ROOT, "public/northeastern/programs-bundle.json");

const { programs, programData } = loadPrograms();

const bundle = {
  generatedAt: new Date().toISOString(),
  programs,
  programData: Object.fromEntries(programData),
};

const json = JSON.stringify(bundle);
writeFileSync(OUT, json);
console.log(
  `programs-bundle.json: ${programs.length} programs ` +
  `(${programs.filter(p => p.level === "grad").length} grad), ` +
  `${(Buffer.byteLength(json) / 1048576).toFixed(1)} MB → ${OUT}`
);
