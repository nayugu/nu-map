// ═══════════════════════════════════════════════════════════════════
// useEquivalences — lazily load the course-equivalence index.
//
// Fetched on first use rather than at boot: it is ~293 KB and only the
// substitutions section reads it, so no other user pays for it.
//
// Every failure path returns a null index, and every consumer in
// equivalenceIndex.js treats null as "no suggestions". A missing or broken
// file therefore degrades to exactly today's manual-only behaviour instead
// of breaking the panel.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { buildEquivalenceIndex } from "../core/equivalenceIndex.js";

const URL = `${import.meta.env.BASE_URL}northeastern/course-equivalences.json`;

let cache = null;        // built index, shared across mounts
let inflight = null;     // de-dupe concurrent mounts

async function load() {
  if (cache) return cache;
  if (!inflight) {
    inflight = (async () => {
      try {
        const res = await fetch(URL);
        if (!res.ok) return null;
        cache = buildEquivalenceIndex(await res.json());
        return cache;
      } catch {
        return null;                       // offline, blocked, malformed — all fine
      } finally {
        inflight = null;
      }
    })();
  }
  return inflight;
}

/**
 * @param {boolean} enabled — pass false while the section is collapsed so the
 *   fetch is deferred until the student actually opens it.
 */
export function useEquivalences(enabled = true) {
  const [index, setIndex] = useState(cache);

  useEffect(() => {
    if (!enabled || index) return;
    let live = true;
    load().then(ix => { if (live) setIndex(ix); });
    return () => { live = false; };
  }, [enabled, index]);

  return index;
}
