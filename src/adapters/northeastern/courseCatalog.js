// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/courseCatalog  (implements ICourseCatalog)
//
// Data source: ninest/nu-courses via husker.vercel.app
// Term codes: NEU Banner format — YYYY10=Fall, YYYY30=Spring,
//             YYYY40=Summer A, YYYY60=Summer B
// ═══════════════════════════════════════════════════════════════════

export const LOCAL_URL = `${import.meta.env.BASE_URL}northeastern/all-courses.json`;
export const API_URL   = "https://husker.vercel.app/courses/all";

/** @type {import('../../ports/ICourseCatalog.js').ICourseCatalog} */
export default { LOCAL_URL, API_URL };
