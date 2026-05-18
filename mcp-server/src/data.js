// Loads course catalog + major/minor data from the project's public and src directories.
// This module runs in Node.js — no Vite, no import.meta.env.
// Calendar and normalization logic is inlined from the Northeastern adapters.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

// ── Term code helpers (from northeastern/calendar.js) ─────────────

function decodeTermCode(term) {
  const s = String(term).slice(-2);
  if (s === "10") return "fall";
  if (s === "30") return "spring";
  if (s === "40") return "sumA";
  if (s === "60") return "sumB";
  if (s === "32") return "spring";
  if (s === "52") return "sumA";
  return null;
}

function getTermCodeYear(term) {
  const year = parseInt(String(term).slice(0, 4), 10);
  if (isNaN(year)) return null;
  return String(term).slice(-2) === "10" ? year - 1 : year;
}

function isTermPast(code) {
  const semTypeId = decodeTermCode(code);
  const yr = getTermCodeYear(code);
  if (!semTypeId || yr == null) return false;
  const firstMonth = { fall: 9, spring: 1, sumA: 5, sumB: 7 }[semTypeId];
  return firstMonth != null && new Date(yr, firstMonth - 1, 1) <= new Date();
}

// ── Course normalization (from northeastern/courseCatalog.js) ─────

function deriveTerms(termHistory) {
  const entries = Object.entries(termHistory);
  if (!entries.length) return [];
  const hasNegative = entries.some(([, v]) => v === false);
  if (!hasNegative) {
    return [...new Set(entries.map(([code]) => decodeTermCode(code)).filter(Boolean))];
  }
  const semTypeIds = [...new Set(entries.map(([code]) => decodeTermCode(code)).filter(Boolean))];
  return semTypeIds.filter(id => {
    const ofType = entries.filter(([code]) => decodeTermCode(code) === id);
    return ofType.filter(([, v]) => v).length / ofType.length >= 0.5;
  });
}

const RESTRICTION_ONLY =
  /^(not open to|open only to|restricted to|required only for|graduate students only|undergraduate students only|for [a-z, ]+(students|majors|minors))/i;

function sanitizeDesc(raw) {
  const s = (raw || "").trim();
  if (!s) return "";
  if (s.length <= 150 && RESTRICTION_ONLY.test(s)) return "";
  return s;
}

function normalizeCourse(raw) {
  const subject = (raw.subject || raw.subjectCode || "").toUpperCase().trim();
  const number  = (raw.number  || raw.courseNumber || raw.num || "").trim();
  if (!subject || !number) return null;

  const id    = `${subject}${number}`;
  const sh    = typeof raw.credits      === "number" ? raw.credits
               : typeof raw.credit      === "number" ? raw.credit
               : typeof raw.creditHours === "number" ? raw.creditHours
               : 4;

  const rawCodes = raw.terms?.length
    ? raw.terms
    : (raw.sections || []).map(s => (typeof s === "string" ? s : s?.term ?? "")).filter(Boolean);
  const uniqueCodes = [...new Set(rawCodes)];

  const termHistory = {};
  for (const code of uniqueCodes) {
    if (decodeTermCode(code)) termHistory[code] = true;
  }

  const shMax = typeof raw.creditsMax === "number" && raw.creditsMax !== sh ? raw.creditsMax : null;

  return {
    id, subject, number,
    code:         `${subject} ${number}`,
    title:        (raw.title || raw.name || "").trim(),
    desc:         sanitizeDesc(raw.description),
    sh:           sh ?? 4,
    shMin:        shMax !== null ? (sh ?? 4) : null,
    shMax,
    scheduleType: raw.scheduleType || "",
    prereqs:      raw.prereqs      ?? raw.prerequisites ?? [],
    coreqs:       raw.coreqs       ?? raw.corequisites  ?? [],
    termHistory,
    terms:        deriveTerms(termHistory),
    attributes:   raw.nuPath ?? raw.attributes ?? [],
  };
}

// ── Major directory scanning ──────────────────────────────────────

function fmtLabel(raw) {
  return raw
    .replace(/[-_]+/g, " ")
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map(w => w.length <= 3 && w === w.toLowerCase()
      ? w.toUpperCase()
      : w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function fmtLocation(folder) {
  const m = folder.match(/\(([^)]+)\)/);
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : "";
}

function scanMajors(majorsDir) {
  const programs  = [];
  const majorData = new Map(); // programId → parsed JSON

  function scan(dir, pathParts) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }

    for (const entry of entries) {
      const full = join(dir, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }

      if (stat.isDirectory()) {
        scan(full, [...pathParts, entry]);
      } else if (entry === "parsed.initial.json") {
        // pathParts should be [year, college, folder, ...]
        const yearIdx = pathParts.findIndex(p => /^\d{4}$/.test(p));
        if (yearIdx < 0) continue;
        const year    = parseInt(pathParts[yearIdx], 10);
        const college = pathParts[yearIdx + 1] ?? "";
        const folder  = pathParts[yearIdx + 2] ?? "";
        if (!college || !folder) continue;

        const programId = `${year}/${college}/${folder}`;
        const type      = folder.includes("_minor") ? "minor" : "major";

        let json;
        try { json = JSON.parse(readFileSync(full, "utf8")); }
        catch { continue; }

        programs.push({
          id:       programId,
          label:    json.name ?? fmtLabel(folder),
          location: fmtLocation(folder),
          type,
          college,
          year,
        });
        majorData.set(programId, json);
      }
    }
  }

  scan(majorsDir, []);
  programs.sort((a, b) =>
    b.year - a.year ||
    a.college.localeCompare(b.college) ||
    a.label.localeCompare(b.label)
  );
  return { programs, majorData };
}

/**
 * Normalize any program path format to `year/college/folder`.
 * Handles both the compact form already used by the MCP server and
 * the full Vite module paths the browser stores in plan state
 * (e.g. "./majors/2026/khoury/computer_science_bs_(boston)/parsed.initial.json").
 */
export function normalizeProgramId(id) {
  if (!id) return id;
  const parts = id.split("/");
  const yi = parts.findIndex(p => /^\d{4}$/.test(p));
  if (yi < 0 || yi + 2 >= parts.length) return id;
  return `${parts[yi]}/${parts[yi + 1]}/${parts[yi + 2]}`;
}

// ── Main loader ───────────────────────────────────────────────────

export async function loadData() {
  // Course catalog
  const catalogPath = join(ROOT, "public/northeastern/catalog-courses.json");
  const historyPath = join(ROOT, "public/northeastern/term-history.json");

  const rawCatalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  const courseArray = Array.isArray(rawCatalog) ? rawCatalog : Object.values(rawCatalog).flat();
  const baseCourses = courseArray.map(normalizeCourse).filter(Boolean);

  // Merge Banner availability history (enriches termHistory, recomputes terms)
  let history = {};
  try { history = JSON.parse(readFileSync(historyPath, "utf8")); } catch { /* ok if absent */ }

  const courseMap = {};
  for (const course of baseCourses) {
    const hist = history[course.id];
    if (hist && typeof hist === "object") {
      const pastHist = Object.fromEntries(
        Object.entries(hist).filter(([code]) => isTermPast(code))
      );
      const termHistory = { ...course.termHistory, ...pastHist };
      courseMap[course.id] = { ...course, termHistory, terms: deriveTerms(termHistory) };
    } else {
      courseMap[course.id] = course;
    }
  }

  // Majors + minors
  const { programs, majorData } = scanMajors(join(ROOT, "src/data/majors"));

  // ── Search helper ─────────────────────────────────────────────
  function searchCourses({ query, subject, attributes, minSH, maxSH, term, limit = 20 } = {}) {
    let results = Object.values(courseMap);

    if (subject)
      results = results.filter(c => c.subject.toUpperCase() === subject.toUpperCase());
    if (attributes?.length)
      results = results.filter(c => attributes.every(a => c.attributes.includes(a)));
    if (minSH != null)
      results = results.filter(c => c.sh >= minSH);
    if (maxSH != null)
      results = results.filter(c => c.sh <= maxSH);
    if (term)
      results = results.filter(c => c.terms.includes(term));

    if (query) {
      const q = query.toLowerCase();
      results = results
        .map(c => {
          const idL    = c.id.toLowerCase();
          const codeL  = c.code.toLowerCase();
          const titleL = c.title.toLowerCase();
          let score = 0;
          if (idL === q || codeL === q)                                              score = 4;
          else if (idL.startsWith(q) || codeL.startsWith(q))                        score = 3;
          else if (titleL.startsWith(q))                                             score = 2;
          else if (
            idL.includes(q) || codeL.includes(q) ||
            titleL.includes(q) || c.desc.toLowerCase().includes(q)
          )                                                                           score = 1;
          return score > 0 ? { c, score } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .map(x => x.c);
    }

    return results.slice(0, limit);
  }

  // ── Offered-In helper ─────────────────────────────────────────
  function getOfferedIn(courseId) {
    const course = courseMap[courseId];
    if (!course) return [];
    const labelOf = {
      fall:   yr => `Fall ${yr}`,
      spring: yr => `Spring ${yr}`,
      sumA:   yr => `Summer 1 ${yr}`,
      sumB:   yr => `Summer 2 ${yr}`,
    };
    return Object.entries(course.termHistory)
      .map(([termCode, offered]) => {
        const semTypeId = decodeTermCode(termCode);
        const year      = getTermCodeYear(termCode);
        if (!semTypeId || year == null) return null;
        return {
          termCode,
          label: (labelOf[semTypeId] ?? (yr => termCode))(year),
          semTypeId,
          year,
          offered,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.termCode.localeCompare(a.termCode)); // newest-first
  }

  return { courseMap, programs, majorData, searchCourses, getOfferedIn };
}
