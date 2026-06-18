// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/localization  (implements ILocalization)
// ═══════════════════════════════════════════════════════════════════

const _disclaimers = [
  "No login required. Your plan is stored entirely in your browser and is never sent to any server. No data about you is collected. The code is open source on GitHub.",
  "This is a student-built tool, not affiliated with or endorsed by Northeastern University.",
  "This does NOT replace your official degree audit. Always verify your plan with your academic advisor and DegreeWorks.",
  "Course availability, prerequisites, credit hours, and NUpath designations may be outdated or incorrect. Always confirm with the official course catalog.",
  "Use at your own risk.",
];

/** @type {import('../../ports/ILocalization.js').ILocalization} */
export default {
  getDisclaimers() { return _disclaimers; },
  getSources()     { return []; },
};
