// ═══════════════════════════════════════════════════════════════════
// COURSE LOADER  (data / network adapter)
// Tries the bundled local JSON first; falls back to the live API.
// Receives a courseCatalog port (ICourseCatalog) as a parameter so
// this module has zero hard-coded institution references.
// ═══════════════════════════════════════════════════════════════════

async function tryFetch(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const text = await res.text();
  if (text.trim().startsWith("<")) throw new Error(`Got HTML (not JSON) from ${url}`);
  return JSON.parse(text);
}

/**
 * Load the raw course catalog.  Returns a flat array of raw course objects.
 * Throws on failure (caller should handle and show error UI).
 *
 * @param {import('../ports/ICourseCatalog.js').ICourseCatalog} courseCatalog
 */
export async function fetchCourses(courseCatalog) {
  const { LOCAL_URL, API_URL } = courseCatalog;
  let json;
  try {
    json = await tryFetch(LOCAL_URL);
  } catch (localErr) {
    if (!API_URL) throw localErr; // no remote fallback configured
    console.warn("Local file unavailable, trying API:", localErr.message);
    try {
      json = await tryFetch(API_URL);
    } catch (apiErr) {
      throw new Error(
        `Could not load course catalog.\n` +
        `• Local (${LOCAL_URL}): ${localErr.message}\n` +
        `• API (${API_URL}): ${apiErr.message}`
      );
    }
  }
  // ninest/nu-courses exports a flat Course[] array
  return Array.isArray(json) ? json : Object.values(json).flat();
}
