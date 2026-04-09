// ═══════════════════════════════════════════════════════════════════
// ADAPTER: generic/courseCatalog  (implements ICourseCatalog)
//
// Default: expects a `courses.json` at the public root.
// No live API fallback — local file is the only source.
//
// Override with your institution's actual course data URL(s).
// For a live API fallback, set API_URL to your endpoint.
// ═══════════════════════════════════════════════════════════════════

export const LOCAL_URL = `${import.meta.env.BASE_URL}courses.json`;

// No live API by default. Set to a URL string to enable fallback fetching.
export const API_URL = null;

/** @type {import('../../ports/ICourseCatalog.js').ICourseCatalog} */
export default { LOCAL_URL, API_URL };
