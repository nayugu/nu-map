/**
 * catalog-course-map.js — the shipped catalog, keyed the way core keys it.
 *
 * Three scripts built this same map inline (`bind-plans.js`, `corpus-ask.js`,
 * two corpus tests), and the fourth caller — `program-record.js`, which needs it
 * to size a requirement — is the one where getting the key format wrong would be
 * invisible: `courseMap[key]?.sh` on a miss yields `undefined`, `demandOf` falls
 * back to the modal unit, and the answer is merely wrong rather than absent.
 *
 * The key is `subject + parseInt(number)` — `courseKey()`'s format with the
 * number normalised, because the catalog writes "1101" and a requirement node
 * writes 1101. Cached, because the majors scrape asks per program and the file
 * is 8,000 courses.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

let cached = null;

/**
 * @param {string} [file]  override, for tests
 * @returns {Record<string, {id, subject, number, sh}>} empty if the catalog is
 *   missing — the majors scrape must not die because the courses scrape has not
 *   run, and every caller degrades to the modal-unit reading rather than to a
 *   crash. `program-record.js` checks for emptiness and declines to act.
 */
export function catalogCourseMap(file = null) {
  if (!file && cached) return cached;
  const path = file ?? join(ROOT, 'public/northeastern/catalog-courses.json');
  let raw;
  try { raw = JSON.parse(readFileSync(path, 'utf8')); }
  catch { return (cached = {}); }
  const map = {};
  for (const c of raw) {
    const id = `${c.subject}${parseInt(c.number, 10)}`;
    map[id] = { id, subject: c.subject, number: String(parseInt(c.number, 10)), sh: c.credits ?? 0 };
  }
  if (!file) cached = map;
  return map;
}
