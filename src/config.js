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
});
