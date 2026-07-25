// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/localization  (implements ILocalization)
// ═══════════════════════════════════════════════════════════════════

const _disclaimers = [
  "No login required. Your plan is stored in your browser and is only sent to a server if you choose to connect Claude — see the privacy policy below. No accounts, no tracking. The code is open source on GitHub.",
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
