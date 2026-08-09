// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/programRegistry.node  (Node.js, fs-based)
//
// The Node counterpart of majorLoader/minorLoader: scans BOTH program
// trees (data/northeastern/programs/majors = undergrad,
// data/northeastern/programs/grad-majors = graduate)
// and exposes the same option shape the app builds, plus the parsed
// requirement JSON. Stale saved paths resolve through the same tiered
// logic (programPaths.resolveInMap) the browser uses.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fmtLabel, fmtLocation } from "./programNaming.js";
import { parseMajorPathParts, resolveInMap } from "../../data/programPaths.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const TREES = [
  { dir: join(ROOT, "data/northeastern/programs/majors"),      level: "undergrad" },
  { dir: join(ROOT, "data/northeastern/programs/grad-majors"), level: "grad" },
];

function scanTree(dir, level, programs, programData) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }

  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }

    if (stat.isDirectory()) {
      scanTree(full, level, programs, programData);
    } else if (entry === "parsed.initial.json") {
      const parts = parseMajorPathParts(full);
      if (!parts || !parts.college || !parts.folder) continue;
      const { year, college, folder } = parts;

      let json;
      try { json = JSON.parse(readFileSync(full, "utf8")); } catch { continue; }

      // Graduate ids carry a "grad/" prefix. Without it the two PharmD
      // programs — the 0-6 direct-entry one (10 sections, 152 SH) and the
      // graduate-entry one (1 section, 36 SH) — produce the same
      // `2026/health-sciences/pharmacy_pharmd_(boston)` and one silently
      // overwrote the other in programData, leaving it unreachable in both the
      // app and the MCP.
      //
      // Ids appear in saved plans, share links and MCP programId, so this
      // would be breaking on its own — but resolveInMap's tiered fallbacks
      // (same college+folder, then same folder in any college) still resolve
      // an old unprefixed grad id to the prefixed one.
      const id = level === "grad" ? `grad/${year}/${college}/${folder}`
                                  : `${year}/${college}/${folder}`;
      programs.push({
        id,
        label:    json.name ?? fmtLabel(folder),
        location: fmtLocation(folder),
        type:     folder.includes("_minor") ? "minor" : "major",
        level,
        college,
        year,
        verified:             json.metadata?.verified === true,
        // Compact fidelity summary for list_programs. The full discrepancy
        // detail stays in programData (and in audit_requirements); this is
        // just enough for a caller to rank or filter without loading trees.
        verification:         json.metadata?.verification
          ? { level: json.metadata.verification.level,
              issues: (json.metadata.verification.discrepancies ?? [])
                        .filter(d => d.severity !== 'info').length }
          : null,
        sourceUrl:            json.metadata?.sourceUrl ?? null,
        totalCreditsRequired: json.totalCreditsRequired ?? null,
        concentrationCount:   json.concentrations?.concentrationOptions?.length ?? 0,
        concentrationRequired: (json.concentrations?.minOptions ?? 0) > 0,
      });
      programData.set(id, json);
    }
  }
}

/**
 * Scan both program trees.
 * @returns {{
 *   programs: object[],                       // sorted option records (see scanTree)
 *   programData: Map<string, object>,         // id → parsed requirement JSON
 *   resolveProgramId: (id: string) => string|null,  // stale-path tolerant
 * }}
 */
export function loadPrograms() {
  const programs    = [];
  const programData = new Map();
  for (const { dir, level } of TREES) scanTree(dir, level, programs, programData);

  programs.sort((a, b) =>
    b.year - a.year ||
    a.college.localeCompare(b.college) ||
    a.label.localeCompare(b.label)
  );

  // programData keeps EVERY catalog year (getProgram resolves by id, and an
  // id carries its year, so a student's frozen edition stays reachable).
  // The browsable LIST is deduped to one row per program, newest edition —
  // otherwise list_programs would grow by ~1,000 rows per year retained and
  // bury the model in near-identical entries.
  //
  // The old `newerVersionYear` flag is deliberately gone: once editions are
  // retained on purpose it is true for every student not in the current
  // year, so it would read as "your program is out of date" when in fact
  // they are on exactly the edition they must follow. Moving to a newer
  // catalog is a petition, not a suggestion an audit tool should make.
  const newestOf = new Map();
  for (const p of programs) {
    const key = p.id.replace(/(^|\/)\d{4}\//, "$1"); // id minus its year
    newestOf.set(key, Math.max(newestOf.get(key) ?? 0, p.year));
  }
  const listed = programs.filter(p => p.year === newestOf.get(p.id.replace(/(^|\/)\d{4}\//, "$1")));

  // Registry keyed by compact id for stale-path resolution. Incoming ids may
  // be full Vite module paths ("./majors/2026/khoury/…/parsed.initial.json")
  // or compact "2026/college/folder" — parseMajorPathParts handles both.
  const registry = Object.fromEntries([...programData.keys()].map(k => [k, true]));

  function resolveProgramId(id) {
    if (!id) return null;
    const parts = parseMajorPathParts(id);
    const compact = parts && parts.college && parts.folder
      ? `${parts.year}/${parts.college}/${parts.folder}`
      : id;
    if (programData.has(compact)) return compact;
    return resolveInMap(registry, compact, parseMajorPathParts);
  }

  return { programs: listed, programData, resolveProgramId };
}
