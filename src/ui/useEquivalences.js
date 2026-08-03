// ═══════════════════════════════════════════════════════════════════
// useEquivalences — load the course-equivalence index.
//
// Fetched on first use rather than at boot: it is ~293 KB and only the
// substitutions section reads it, so no other user pays for it.
//
// ## Why this retries, and why it is loud
//
// The first version latched permanently on any failure. `load()` returned
// null, `setIndex(null)` left the state unchanged, React saw no state
// change so it never re-rendered, the effect never re-ran, and the hook
// was dead for the life of the page — with `catch {}` swallowing the
// reason. The panel then reported "No known alternatives" for every
// course, which is indistinguishable from a course genuinely having none.
//
// One transient failure — a dev server started before the file existed, a
// blocked request, a partial response — therefore disabled the feature
// silently and permanently. So: a bounded retry, and the reason is always
// logged rather than swallowed.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { buildEquivalenceIndex } from "../core/equivalenceIndex.js";

const URL = `${import.meta.env.BASE_URL}northeastern/course-equivalences.json`;
const MAX_ATTEMPTS = 3;
const RETRY_MS = 1200;

let cache = null;        // built index, shared across mounts
let inflight = null;     // de-dupe concurrent mounts

async function load() {
  if (cache) return cache;
  if (inflight) return inflight;                  // share, don't restart
  inflight = (async () => {
    try {
      const res = await fetch(URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const built = buildEquivalenceIndex(await res.json());
      if (!built) throw new Error("index did not parse");
      cache = built;
      return cache;
    } catch (err) {
      // Never silent: this is the difference between "no alternatives exist"
      // and "we could not find out", and only one of those is the user's fault.
      console.warn(`[NU Map] course equivalences unavailable (${URL}):`, err.message);
      return null;
    } finally {
      inflight = null;                            // allow a later retry
    }
  })();
  return inflight;
}

/**
 * @param {boolean} enabled — pass false while the section is collapsed so the
 *   fetch is deferred until the student actually opens it.
 * @returns the built index, or null while loading / after giving up.
 */
export function useEquivalences(enabled = true) {
  const [index, setIndex] = useState(cache);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || index || attempt >= MAX_ATTEMPTS) return;
    let live = true;
    let timer = null;
    load().then(ix => {
      if (!live) return;
      if (ix) setIndex(ix);
      // Bump `attempt` so the effect re-runs; without a state change React
      // would never call it again and the hook would latch on null forever.
      else timer = setTimeout(() => { if (live) setAttempt(a => a + 1); }, RETRY_MS);
    });
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [enabled, index, attempt]);

  return index;
}
