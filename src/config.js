// ═══════════════════════════════════════════════════════════════════
// APP CONFIGURATION
// ═══════════════════════════════════════════════════════════════════
//
// This is the one file to change when deploying for a different
// institution.  Swap the import below to point at a different
// adapter folder, and the entire app reconfigures automatically.
//
// To add a new institution:
//   1. Copy src/adapters/northeastern/ to src/adapters/myuniversity/
//   2. Edit the files inside to match your institution's data.
//   3. Change the import below to point at your new folder.
//
// ── THIS is the wiring. There is no other. ─────────────────────────
//
// `src/adapters/northeastern/index.js` used to export a second `overrides` map that looked
// exactly like the `wire()` call below, and nothing imported it — the only mentions were a
// doc comment. It was a trap rather than a duplicate: CHART's `planGenerator` was added
// there and not here, so `usePort` returned undefined, the Generate button sat correctly
// disabled, and nothing anywhere said why. Finding that took driving a browser.
//
// It had also drifted — no `shareRelay`, no `courseOffering` — which is what a second list
// always does. Deleted, and `test/contract/port-wiring.test.js` now asserts that every port
// the UI asks for is wired HERE, so the same mistake fails a test instead of a student.
// ═══════════════════════════════════════════════════════════════════

import { wire }              from './adapters/wire.js';
import institution       from './adapters/northeastern/institution.js';
import calendar          from './adapters/northeastern/calendar.js';
import creditSystem      from './adapters/northeastern/creditSystem.js';
import attributeSystem   from './adapters/northeastern/attributeSystem.js';
import specialTerms      from './adapters/northeastern/specialTerms.js';
import majorRequirements from './adapters/northeastern/majorRequirements.js';
import courseCatalog     from './adapters/northeastern/courseCatalog.js';
import localization      from './adapters/northeastern/localization.js';
import aiAssistant       from './adapters/northeastern/aiAssistant.js'; // MCP integration (defaults to localhost:27182; set VITE_MCP_SERVER_URL when hosted)
import shareRelay        from './adapters/northeastern/shareRelay.js';  // share-by-code relay on the same server
import planGenerator     from './adapters/northeastern/planGenerator.js';   // CHART — generates a plan of study
import courseOffering    from './adapters/northeastern/courseOffering.js';  // when a course runs — ONE rule, shared by the UI and CHART
import acceleratedPathway from './adapters/northeastern/acceleratedPathway.js'; // PlusOne — BS/MS credit-sharing pathways

// Comment out any line to fall back to the generic default for that port.
export const institutionAdapter = wire({
  institution,
  calendar,
  creditSystem,
  attributeSystem,
  specialTerms,
  majorRequirements,
  courseCatalog,
  localization,
  planGenerator,
  courseOffering,
  acceleratedPathway,
  // Claude integration + share-by-code: active in dev (localhost MCP
  // server) or when a hosted server URL is baked into the build. Excluded
  // otherwise so production never shows a Connect flow (or a share-code
  // UI) pointing at localhost.
  ...(import.meta.env.DEV || import.meta.env.VITE_MCP_SERVER_URL ? { aiAssistant, shareRelay } : {}),
});

/**
 * Whether NU Map may offer to CONTRIBUTE course ratings.
 *
 * Recording your own hours and difficulty works regardless — that half is
 * local, complete, and useful on its own. This flag governs only the
 * pooling: the settings toggle and the consent sheet.
 *
 * It is false in production until the collector exists, on the same
 * principle as the Claude integration above: a feature may be built and
 * documented before its front door opens, but an app must never offer a
 * switch that promises something it cannot do. Someone flipping
 * "Contribute course ratings" and reading a sheet about pooling their
 * answers has been told a thing that is not true, even though nothing is
 * actually sent.
 *
 * Flip by setting VITE_RATINGS_SERVER_URL at build time, once there is a
 * server to point it at.
 */
export const ratingSharingAvailable = Boolean(
  import.meta.env.DEV || import.meta.env.VITE_RATINGS_SERVER_URL,
);
