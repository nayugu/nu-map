// ═══════════════════════════════════════════════════════════════════
// PORT: ICourseCatalog
//
// Defines the normalized Course shape the core works with, and the
// operations needed to populate and link it.
//
// The adapter is responsible for:
//   - Fetching raw catalog data (local file, API, database, etc.)
//   - Normalizing raw records into the Course shape below
//   - Optionally providing a URL to the official course detail page
//
// Fetch strategy, API keys, retry logic, and caching are implementation
// details of the adapter — they do not belong in this port.
// ═══════════════════════════════════════════════════════════════════

/** Port key — use with wire() and usePort() */
export const ICourseCatalog = "courseCatalog";

/**
 * Normalized internal course record.  All code that reads course data
 * works against this shape; raw catalog formats are an adapter concern.
 *
 * @typedef {Object} Course
 *
 * Identity
 * @property {string}       id           - Stable unique key: subject + number, e.g. "CS3500".
 *                                         Used as the primary key in placements, courseMap, etc.
 * @property {string}       subject      - Department / subject code, e.g. "CS", "MATH"
 * @property {string}       number       - Course number within the subject, e.g. "3500", "1341"
 * @property {string}       code         - Human-readable combined code, e.g. "CS 3500"
 *
 * Display
 * @property {string}       title        - Full course title
 * @property {string}       desc         - Course description.  Empty string if unavailable.
 * @property {string}       scheduleType - Delivery mode, e.g. "Lecture", "Lab", "Seminar", "Online"
 * @property {string}       color        - Deterministic hex color derived from subject code.
 *                                         Assigned by the adapter's normalize(); consistent for
 *                                         a given subject regardless of which courses are loaded.
 *
 * Credits
 * @property {number}       sh           - Credit hours for this course (minimum for variable-credit).
 *                                         Named "sh" for historical reasons; the actual unit is
 *                                         defined by ICreditSystem.getUnitName().
 * @property {number|null}  shMin        - Minimum credits for a variable-credit course.
 *                                         null for fixed-credit courses.
 * @property {number|null}  shMax        - Maximum credits for a variable-credit course.
 *                                         null for fixed-credit courses.
 *
 * Scheduling
 * @property {string[]}     terms        - Semester type IDs when this course is offered,
 *                                         e.g. ["fall", "spring"].  Already decoded from raw
 *                                         registrar codes by the adapter during normalization.
 *                                         Empty array means offering data is unavailable; the UI
 *                                         will fall back to a default offering assumption.
 *
 * Curriculum attributes
 * @property {string[]}     attributes   - Attribute/pathway codes assigned to this course,
 *                                         e.g. ["ND", "FQ"].  Codes are defined by IAttributeSystem.
 *                                         Empty array if the institution has no attribute system
 *                                         or if this course carries none.
 *
 * Prerequisites and corequisites
 * @property {PrereqNode[]} prereqs      - Prerequisite tree.  Each node is one of:
 *                                           - A course reference: { subject: string, number: string }
 *                                           - An operator token: "And" | "Or" | "(" | ")"
 *                                           - A sub-array (nested group)
 *                                         The evaluator in prereqEval.js traverses this tree.
 *                                         Empty array means no prerequisites.
 * @property {CourseRef[]}  coreqs       - Corequisite list: flat array of course references
 *                                         { subject: string, number: string }.
 *                                         Empty array means no corequisites.
 */

/**
 * @typedef {Object|string|Array} PrereqNode  — one node in a prerequisite tree (see Course.prereqs)
 * @typedef {{ subject: string, number: string }} CourseRef
 */

/**
 * @typedef {Object} ICourseCatalog
 *
 * @property {() => Promise<Course[]>} fetchAll
 *   Fetch the full course catalog and return all courses normalized to the Course shape.
 *   The adapter chooses how: a bundled JSON file, a remote API with local fallback, a
 *   database query, or any other source.  PlannerContext calls this once on mount.
 *   Course records returned here have terms already decoded to semester type IDs.
 *
 * @property {(raw: object) => Course|null} normalize
 *   Normalize one raw catalog record into the Course shape.
 *   Returns null if the record lacks the required identity fields (subject + number).
 *   Exposed separately from fetchAll so incremental updates (e.g. a single refreshed
 *   course record from an API) can be normalized without re-fetching the full catalog.
 *
 * @property {(course: Course) => string|null} [courseUrl]
 *   Return the URL for the official course detail page in the registrar or course catalog.
 *   Returns null (or may be omitted) if per-course URLs are not available.
 *   Used in InfoPanel to render the external link icon next to the course title.
 *   Example (NU): course => `https://catalog.northeastern.edu/course-descriptions/${course.subject.toLowerCase()}/`
 */
