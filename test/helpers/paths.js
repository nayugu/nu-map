// Shared test helpers: repo-root resolution + loaders for committed data.
// Kept dependency-free so every layer (unit/contract/invariant/live) can use it.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Read + parse a JSON file relative to the repo root. */
export function readJson(relPath) {
  return JSON.parse(readFileSync(resolve(ROOT, relPath), "utf8"));
}

/** The runtime catalog the browser app, Node MCP server, and worker all load. */
export function loadCatalog() {
  return readJson("public/northeastern/catalog-courses.json");
}

/** All 8 locales as { code, strings }, English first (the authoritative set). */
export async function loadLocales() {
  const codes = ["en", "es", "fr", "ar", "hi", "ja", "ko", "zh"];
  const out = [];
  for (const code of codes) {
    const mod = await import(`../../src/locales/${code}.js`);
    out.push({ code, meta: mod.meta, strings: mod.strings });
  }
  return out;
}
