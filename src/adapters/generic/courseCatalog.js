// ═══════════════════════════════════════════════════════════════════
// ADAPTER: generic/courseCatalog  (implements ICourseCatalog)
//
// Default: expects a `courses.json` at the public root.
// No live API fallback — local file is the only source.
//
// The JSON must contain an array of course objects with at minimum:
//   { subject: string, number: string, title: string, credits: number }
//
// Override fetchAll() and normalize() for your institution's raw format.
// ═══════════════════════════════════════════════════════════════════
import { subjectColor } from "../../core/courseModel.js";

const LOCAL_URL = `${import.meta.env.BASE_URL}courses.json`;

/**
 * Generic normalizer — expects a simple flat course record.
 * @param {object} raw
 * @returns {import('../../ports/ICourseCatalog.js').Course|null}
 */
function normalizeCourse(raw) {
  const subject = (raw.subject || "").toUpperCase().trim();
  const number  = (raw.number  || "").trim();
  if (!subject || !number) return null;

  const sh = typeof raw.credits === "number" ? raw.credits
           : typeof raw.sh      === "number" ? raw.sh
           : 3;

  return {
    id:           `${subject}${number}`,
    subject,
    number,
    code:         `${subject} ${number}`,
    title:        (raw.title || raw.name || "").trim(),
    desc:         raw.description || "",
    sh,
    shMin:        null,
    shMax:        null,
    scheduleType: raw.scheduleType || "",
    prereqs:      raw.prereqs ?? [],
    coreqs:       raw.coreqs  ?? [],
    terms:        raw.terms   ?? [],
    attributes:   raw.attributes ?? [],
    color:        subjectColor(subject),
  };
}

/** @type {import('../../ports/ICourseCatalog.js').ICourseCatalog} */
export default {
  async fetchAll() {
    const res = await fetch(LOCAL_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${LOCAL_URL}`);
    const data = await res.json();
    const raw  = Array.isArray(data) ? data : Object.values(data).flat();
    return raw.map(normalizeCourse).filter(Boolean);
  },

  normalize: normalizeCourse,

  courseUrl() { return null; },
};
