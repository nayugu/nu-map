// ═══════════════════════════════════════════════════════════════════
// ADAPTER: generic/localization  (implements ILocalization)
//
// Default: institution-neutral English disclaimers.
// Override to add institution-specific language (portal names,
// degree audit tool names, school-specific policies).
// ═══════════════════════════════════════════════════════════════════

const _disclaimers = [
  "This is an unofficial academic planning tool and is not affiliated with or endorsed by your institution.",
  "This does NOT replace your official degree audit. Always verify your plan with your academic advisor.",
  "Course availability, prerequisites, and credit values may change. Confirm with your official course catalog.",
  "Your saved plan is stored in your browser only. Clearing browser data will erase it.",
  "Use at your own risk.",
];

/** @type {import('../../ports/ILocalization.js').ILocalization} */
export default {
  getDisclaimers() { return _disclaimers; },
  getSources()     { return []; },
};
