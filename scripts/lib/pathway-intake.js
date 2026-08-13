/**
 * pathway-intake.js — pure logic for the accelerated-pathway intake.
 *
 * Sitemap parsing, candidate matching, page CLASSIFICATION and inventory
 * diffing. No I/O, no network: everything here takes strings and returns data,
 * so it can be stress-tested against hostile fixtures without touching the
 * network. `pathway-fetch.js` does the talking.
 *
 * ── Why classification is a stage and not a regex ─────────────────
 *
 * The first sweep matched `plus-?one|accelerated|…` against URL paths and
 * returned 123 candidates, of which ~48 were news posts, event pages, tag
 * archives and one article about Russia's timeline in Ukraine "accelerating".
 * A tighter regex is not the answer, because the noise and the signal genuinely
 * share vocabulary — a page titled "PlusOne info session" is not a pathway and a
 * page at `/academic-programs/plusone-arti/` is.
 *
 * So classification looks at the FETCHED PAGE, not the URL, and asks what the
 * page structurally is. The output is a kind plus the signals behind it, so a
 * misclassification is debuggable rather than mysterious.
 */

/** Paths that are never a pathway page, whatever their slug says. */
const NOISE_SEGMENTS = /\/(news|events?|tag|category|author|resources?|blog|stories|spotlight|page)\//i;

/** URL-level candidate match. Deliberately WIDE — classification narrows it. */
const CANDIDATE = /plus-?one|accelerated|4\+1|bs-?ms|dual-degree/i;

/** A Northeastern course code, both spellings. */
const COURSE_CODE = /\b[A-Z]{2,6} ?\d{4}\b/g;

export const PAGE_KIND = Object.freeze({
  PATHWAY: "pathway",   // a specific BS→MS pairing with course detail
  INDEX: "index",       // a list of links to pathway pages
  POLICY: "policy",     // rules that apply across pathways (FAQ, deadlines)
  NOISE: "noise",       // news, events, marketing
});

/**
 * Expand a sitemap or sitemap index into `<loc>` values.
 *
 * Returns `{ urls, isIndex }` rather than just an array so a caller can tell an
 * index it must recurse into from a leaf sitemap it must not — conflating them
 * silently loses every URL on a site whose index nests two deep.
 */
export function parseSitemap(xml) {
  const text = String(xml ?? "");
  const urls = [...text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => decodeXml(m[1]));
  return { urls, isIndex: /<sitemapindex/i.test(text) };
}

function decodeXml(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'");
}

/**
 * Is this URL worth fetching at all?
 *
 * Two gates: the slug looks accelerated-ish, and the path is not obviously a news
 * or event route. Robots handling lives in pathway-fetch.js and is applied by the
 * caller — keeping it out of here means this function stays pure and testable.
 */
export function isCandidateUrl(url) {
  let path;
  try { path = new URL(url).pathname; } catch { return false; }
  if (NOISE_SEGMENTS.test(path)) return false;
  return CANDIDATE.test(path);
}

/**
 * Visible text, roughly — enough for keyword and table signals.
 *
 * Entities are decoded, which matters for more than tidiness: these pages are
 * full of `&amp;` and `&#038;`, and leaving them encoded breaks phrase matching
 * ("Co-op &amp; Experiential" never matches /co-op & /) and makes the cached
 * text harder to read than the page it came from.
 */
function stripHtml(html) {
  return decodeEntities(
    String(html ?? "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ");
}

/** The handful of entities that actually appear, plus numeric escapes. */
function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&(?:apos|#0?39);/gi, "'")
    .replace(/&(?:rsquo|lsquo);/gi, "'")
    .replace(/&(?:rdquo|ldquo);/gi, '"')
    .replace(/&(?:ndash|mdash);/gi, "–")
    .replace(/&hellip;/gi, "…");
}

function safeChar(code) {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff
    ? String.fromCodePoint(code) : " ";
}

/**
 * What we cache for a page: its visible text, one sentence-ish chunk per line.
 *
 * NOT the raw HTML, deliberately. The cache exists so a `source.url` claim stays
 * checkable and so drift is REVIEWABLE — and a raw-HTML diff is neither. These
 * are WordPress pages: every fetch churns nonces, inlined CSS, cache-busting
 * query strings and script bundles, so a rules change would arrive buried in
 * thousands of lines of noise, which is the same as arriving invisibly.
 *
 * Measured on the first full sweep: 74 pages of raw HTML came to 7.4 MB. The
 * visible text is roughly a tenth of that and is what `contentHash` already
 * hashes, so the cache, the hash and the diff all describe the same thing.
 *
 * Line-wrapping at sentence boundaries is what makes `git diff` useful: without
 * it a page is one enormous line and any change rewrites the whole file.
 */
export function cacheableText(html) {
  return stripHtml(html)
    .replace(/(?<=[.:;!?])\s+/g, "\n")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean)
    .join("\n") + "\n";
}

/**
 * Classify a fetched page.
 *
 * The signals are deliberately cheap and structural. `signals` is returned so a
 * wrong verdict can be argued with — a classifier whose reasoning is invisible
 * gets "fixed" by tweaking thresholds until the sample passes.
 *
 * @param {string} url
 * @param {string} html
 * @returns {{kind: string, signals: object}}
 */
export function classifyPage(url, html) {
  const path = safePath(url);
  const text = stripHtml(html);
  const codes = new Set((text.match(COURSE_CODE) ?? []).map(c => c.replace(/\s+/g, "")));
  const links = [...String(html ?? "").matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  const candidateLinks = new Set(links.filter(h => CANDIDATE.test(h) && !NOISE_SEGMENTS.test(h)));

  const signals = {
    courseCodes: codes.size,
    candidateLinks: candidateLinks.size,
    hasEligibility: /eligible|eligibility|open to|available to/i.test(text),
    hasSharing: /double-?count|share[ds]? (?:credit|toward)|counts? toward both/i.test(text),
    hasPolicyWords: /(deadline|scholarship|petition|frequently asked|faq|tuition)/i.test(text),
    isNoisePath: NOISE_SEGMENTS.test(path),
    words: text.split(" ").length,
  };

  if (signals.isNoisePath) return { kind: PAGE_KIND.NOISE, signals };

  // A pathway page names courses AND says who may take them. Either alone is
  // not enough: a policy page cites course codes in examples, and an index page
  // lists eligible majors without any course detail.
  if (signals.courseCodes >= 3 && (signals.hasEligibility || signals.hasSharing)) {
    return { kind: PAGE_KIND.PATHWAY, signals };
  }

  // An index is mostly links to other candidates, with little course detail of
  // its own. Checked BEFORE policy because CSSH's index mentions deadlines too.
  if (signals.candidateLinks >= 4 && signals.courseCodes < 3) {
    return { kind: PAGE_KIND.INDEX, signals };
  }

  if (signals.hasPolicyWords && (signals.hasSharing || /plus-?one/i.test(text))) {
    return { kind: PAGE_KIND.POLICY, signals };
  }

  // Course codes but no eligibility or sharing language: probably a curriculum
  // page reached by a loose slug. Worth a human glance, so not noise.
  if (signals.courseCodes >= 3) return { kind: PAGE_KIND.POLICY, signals };

  return { kind: PAGE_KIND.NOISE, signals };
}

function safePath(url) {
  try { return new URL(url).pathname; } catch { return String(url ?? ""); }
}

/** Course codes on a page, normalised to planner ids, for the scaffold step. */
export function courseCodesOn(html) {
  const text = stripHtml(html);
  return [...new Set((text.match(COURSE_CODE) ?? []).map(c => c.replace(/\s+/g, "").toUpperCase()))]
    .sort();
}

/**
 * Diff a fresh sweep against the committed inventory.
 *
 * `added` is work to do, `gone` is a source that has disappeared — which matters
 * more than it sounds, because a pathway file whose source 404s is a claim we can
 * no longer support. `changed` drives the drift check: the page is still there
 * but its content hash moved, so the rules may have moved with it.
 *
 * @param {{url: string, hash?: string}[]} previous
 * @param {{url: string, hash?: string}[]} current
 */
export function diffInventory(previous = [], current = []) {
  const prev = new Map(previous.map(e => [e.url, e]));
  const cur = new Map(current.map(e => [e.url, e]));
  const added = [], gone = [], changed = [], same = [];
  for (const [url, e] of cur) {
    const p = prev.get(url);
    if (!p) { added.push(url); continue; }
    if (p.hash && e.hash && p.hash !== e.hash) changed.push(url);
    else same.push(url);
  }
  for (const url of prev.keys()) if (!cur.has(url)) gone.push(url);
  return {
    added: added.sort(), gone: gone.sort(), changed: changed.sort(), same: same.sort(),
  };
}

/** Stable content hash of a page's visible text, so markup churn is not drift. */
export async function contentHash(html) {
  const text = stripHtml(html).trim();
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export const DEFAULT_LIMITS = Object.freeze({
  /** Share of previously-known candidate URLs the sweep must still find. */
  minRediscoveryRatio: 0.80,
  /** Hosts allowed to return nothing at all (see assertHostsReachable). */
  maxSilentHosts: 0,
});

/**
 * Shape rails for a sweep. Like scrape-rails.js, these ask "did this run
 * collapse?", not "is the data right" — verify-pathways.js owns correctness.
 *
 * @param {object} args
 * @param {number} args.hosts             hosts swept
 * @param {number} args.totalUrls         URLs seen across all sitemaps
 * @param {string[]} args.candidates      candidate URLs this run
 * @param {string[]} args.previousCandidates
 * @param {string[]} args.unreachable     from assertHostsReachable
 * @param {object} [args.limits]
 */
export function checkIntakeRails({
  hosts, totalUrls, candidates = [], previousCandidates = [], unreachable = [], limits = {},
}) {
  const L = { ...DEFAULT_LIMITS, ...limits };
  const failures = [];

  if (unreachable.length > L.maxSilentHosts) failures.push(...unreachable);

  // A sitemap sweep that finds no URLs at all is broken, not thorough.
  if (hosts > 0 && totalUrls === 0) {
    failures.push(`swept ${hosts} hosts and found 0 URLs — sitemap format changed?`);
  }

  if (previousCandidates.length) {
    const cur = new Set(candidates);
    const kept = previousCandidates.filter(u => cur.has(u)).length;
    const ratio = kept / previousCandidates.length;
    if (ratio < L.minRediscoveryRatio) {
      failures.push(
        `rediscovered only ${kept}/${previousCandidates.length} known candidates ` +
        `(${(ratio * 100).toFixed(1)}% < ${(L.minRediscoveryRatio * 100).toFixed(0)}%) — ` +
        `discovery regressed`
      );
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    stats: { hosts, totalUrls, candidates: candidates.length, unreachable: unreachable.length },
  };
}
