// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/localization  (implements ILocalization)
// ═══════════════════════════════════════════════════════════════════

const _disclaimers = [
  "This is NOT an official Northeastern University tool and is not affiliated with or endorsed by Northeastern.",
  "This does NOT replace your official degree audit. Always verify your plan with your academic advisor and through MyNEU / DegreeWorks.",
  "Course availability, prerequisites, credit hours, and NUpath designations may be outdated or incorrect. Always confirm with the official course catalog.",
  "Your saved plan lives in your browser's localStorage only. Clearing browser data will erase it.",
  "Use at your own risk.",
];

/** @type {import('../../ports/ILocalization.js').ILocalization} */
export default {
  getDisclaimers() { return _disclaimers; },
};
