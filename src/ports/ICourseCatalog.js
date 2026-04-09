// ═══════════════════════════════════════════════════════════════════
// PORT: ICourseCatalog
// Course data source — URLs, normalization, and term code decoding.
// ═══════════════════════════════════════════════════════════════════

/** Port key — use with wire() and usePort() */
export const ICourseCatalog = "courseCatalog";

/**
 * @typedef {Object} ICourseCatalog
 * @property {string} LOCAL_URL - Path to the bundled local course JSON
 * @property {string} API_URL   - Fallback live API endpoint
 *
 * Future fields (Stage 2):
 *   normalize(raw: object): Course  — maps raw catalog fields to internal Course shape
 *   decodeTermCodes(terms: string[]): TermOffering[]  — institution-specific term code mapping
 *   resolveCrosslisting(courseId: string): string[]
 */
