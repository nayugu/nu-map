// ═══════════════════════════════════════════════════════════════════
// COURSE LOADER  (data / network adapter)
// Tries the bundled local JSON first; falls back to the live API.
// ═══════════════════════════════════════════════════════════════════

const LOCAL_URL = `${import.meta.env.BASE_URL}all-courses.json`;
const API_URL   = "https://husker.vercel.app/courses/all";

async function tryFetch(url) {
  const res = await fetch(url, { cache: "default" });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const text = await res.text();
  if (text.trim().startsWith("<")) throw new Error(`Got HTML (not JSON) from ${url}`);
  return JSON.parse(text);
}

/**
 * Load the raw course catalog.  Returns a flat array of raw course objects.
 * Throws on failure (caller should handle and show error UI).
 */
export async function fetchCourses() {
  let json;
  try {
    json = await tryFetch(LOCAL_URL);
  } catch (localErr) {
    console.warn("Local file unavailable, trying API:", localErr.message);
    try {
      json = await tryFetch(API_URL);
    } catch (apiErr) {
      throw new Error(
        `Could not load course catalog.\n` +
        `• Local (/public/all-courses.json): ${localErr.message}\n` +
        `• API (${API_URL}): ${apiErr.message}`
      );
    }
  }
  // ninest/nu-courses exports a flat Course[] array
  return Array.isArray(json) ? json : Object.values(json).flat();
}
