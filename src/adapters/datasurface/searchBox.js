// ═══════════════════════════════════════════════════════════════════
// SEARCH BOX  (driving adapter — plain DOM, ships to numap.app/data)
//
// The omnibox on every /data page. Bundled to /assets/data-search-<hash>.js by
// scripts/build-ai-data.js and loaded with `defer`.
//
// Not in src/ui/: that is the React app, whose rule is "import ports only".
// This is a driving adapter for a different surface — no React, no app bundle —
// so it lives beside the other adapters and imports core only.
//
// It does four things: lazy-fetch the index, refuse a payload that is not one,
// debounce, render. Everything rankable is in core/entitySearch.js; if
// something here starts deciding what a good match is, it is in the wrong file.
//
// The /data pages ship no other JavaScript, and the floor is that they still
// work without this one: the box is a real <form> targeting /data/search, so
// with JS off (or if this file 404s) submitting still lands on a real page.
// ═══════════════════════════════════════════════════════════════════

import { decodeIndex, prepareIndex, searchEntities, urlOf } from "../../core/entitySearch.js";

const MAX_RESULTS = 10;
const DEBOUNCE_MS = 60;

let prepared = null;
let loading = null;

/**
 * Fetch and prepare the index, once.
 *
 * `r.ok` is deliberately not the test. On Cloudflare Pages the SPA fallback
 * (`/* /index.html 200`) answers a MISSING file with the HTML shell at status
 * 200, so a deleted or mis-hashed index looks like a success and parses as
 * markup. decodeIndex is the real gate — the same lesson the recovery screens
 * learned from build.json.
 */
function loadIndex(url) {
  if (prepared) return Promise.resolve(prepared);
  if (loading) return loading;
  loading = fetch(url, { credentials: "omit" })
    .then((r) => r.json())
    .then((payload) => { prepared = prepareIndex(decodeIndex(payload)); return prepared; })
    .catch((err) => {
      loading = null;                       // a later keystroke may retry
      throw err;
    });
  return loading;
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** One result row: the name, the kind it is, and its code when it has one. */
function rowHtml(prep, hit, active) {
  const r = prep.records[hit.index];
  const kind = prep.byId.get(r.kind);
  return `<a class="fx-row${active ? " on" : ""}" href="${escapeHtml(urlOf(prep, hit.index))}" role="option"`
    + ` aria-selected="${active ? "true" : "false"}">`
    + `<span class="fx-name">${escapeHtml(r.name)}</span>`
    + (r.code ? `<span class="fx-code">${escapeHtml(r.code)}</span>` : "")
    + `<span class="fx-kind">${escapeHtml(kind.label)}</span></a>`;
}

export function mountSearchBox(root = document) {
  const form = root.querySelector("[data-search-form]");
  if (!form) return;
  const input = form.querySelector("input[name=q]");
  const panel = form.querySelector("[data-search-results]");
  const indexUrl = form.getAttribute("data-index");
  if (!input || !panel || !indexUrl) return;

  let hits = [];
  let cursor = -1;
  let timer = null;

  const close = () => { panel.innerHTML = ""; panel.hidden = true; hits = []; cursor = -1; };

  const draw = () => {
    if (!hits.length) {
      // "Nothing" is a real answer and has to look like one, or an empty panel
      // reads as a broken box.
      panel.innerHTML = `<p class="fx-none">No match. Try a course code, a name, or a NUpath code.</p>`;
      panel.hidden = false;
      return;
    }
    panel.innerHTML = hits.map((h, i) => rowHtml(prepared, h, i === cursor)).join("");
    panel.hidden = false;
  };

  const run = () => {
    const q = input.value.trim();
    if (!q) return close();
    loadIndex(indexUrl).then((prep) => {
      if (input.value.trim() !== q) return;     // a later keystroke already won
      hits = searchEntities(prep, q, { limit: MAX_RESULTS });
      cursor = hits.length ? 0 : -1;
      draw();
    }).catch(() => {
      // The index is unreachable or not an index. Say so, and leave the form
      // able to submit — /data/search still works server-side-ish.
      panel.innerHTML = `<p class="fx-none">Search is unavailable right now. Press Enter to open the search page.</p>`;
      panel.hidden = false;
    });
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(run, DEBOUNCE_MS);
  });
  // Warm the fetch on focus so the first keystroke has the index already.
  input.addEventListener("focus", () => { loadIndex(indexUrl).catch(() => {}); });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!hits.length) return;
      e.preventDefault();
      cursor = (cursor + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
      draw();
      return;
    }
    if (e.key === "Escape") { close(); input.blur(); return; }
    if (e.key !== "Enter") return;
    // Enter jumps to the highlighted hit — but only when the top hit is a
    // ROUTED answer or the user moved the cursor themselves. On a weak best
    // guess it falls through to the form, which opens /data/search?q=… and
    // shows the whole list. Navigating away on a guess costs the one screen
    // that could have shown the right answer; one extra click cannot be wrong.
    const chosen = hits[cursor];
    if (!chosen) return;
    if (chosen.routed || cursor > 0 || hits.length === 1) {
      e.preventDefault();
      window.location.href = urlOf(prepared, chosen.index);
    }
  });

  form.addEventListener("submit", () => { /* let it navigate to /data/search */ });
  document.addEventListener("click", (e) => { if (!form.contains(e.target)) close(); });

  // /data/search?q=… renders its own results on load, so a search is shareable.
  const preset = new URLSearchParams(window.location.search).get("q");
  if (preset && form.hasAttribute("data-search-page")) {
    input.value = preset;
    run();
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => mountSearchBox());
  else mountSearchBox();
}
