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

import { wire }                from './adapters/wire.js';
import northeasternOverrides   from './adapters/northeastern/index.js';

export const institutionAdapter = wire(northeasternOverrides);
