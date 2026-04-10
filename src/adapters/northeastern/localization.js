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

/** @type {import('../../ports/ILocalization.js').AttributionBlock[]} */
const _attributionBlocks = [
  {
    title: "DATA SOURCE",
    body:  "Course catalog data is sourced from ninest/nu-courses — built and maintained by @ninest. Data is scraped from Northeastern's Banner registration system.",
    links: [
      { href: "https://github.com/ninest/nu-courses", label: "github.com/ninest/nu-courses", primary: true },
      { href: "https://husker.vercel.app",            label: "husker.vercel.app" },
    ],
  },
  {
    title: "GRADUATION REQUIREMENTS",
    body:  "Graduation requirement data and validation logic is derived from sandboxnu/graduatenu — built by @denniwang and Sandbox.",
    links: [
      { href: "https://github.com/sandboxnu/graduatenu", label: "github.com/sandboxnu/graduatenu", primary: true },
      { href: "https://github.com/denniwang",            label: "@denniwang" },
      { href: "https://github.com/sandboxnu",            label: "Sandbox" },
    ],
  },
];

/** @type {import('../../ports/ILocalization.js').ILocalization} */
export default {
  getDisclaimers()       { return _disclaimers; },
  getAttributionBlocks() { return _attributionBlocks; },
};
