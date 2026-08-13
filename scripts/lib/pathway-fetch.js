/**
 * pathway-fetch.js — HTTP for the accelerated-pathway intake, with the two
 * rails that the first sweep taught us it needs.
 *
 * ── RAIL 1: a host we cannot reach must never look like a host with nothing ──
 *
 * The first discovery sweep swallowed fetch errors and printed
 *
 *     coe   0 urls   0 candidates
 *
 * which reads as "the College of Engineering publishes no PlusOne pages". It
 * publishes twelve. Six colleges — including the largest — were silently absent
 * because of a TLS failure (see certs/README.md), and nothing in the output
 * distinguished that from an honest empty result.
 *
 * On CI that would be the permanent state, and the failure mode is the worst
 * available: the inventory looks complete and is missing a third of the
 * university. So every fetch failure is recorded per host, and
 * `assertHostsReachable` turns "zero from a host that has failures" into a
 * non-zero exit. Same principle as fetch-nupath's 5% rule and
 * scrape-rails.js — one page failing is drift, a host failing is breakage.
 *
 * ── RAIL 2: trust the university's certificates, not everyone's ──
 *
 * Six hosts serve a broken chain. The fix is to supply the missing (public)
 * intermediate, NOT to disable verification. `NODE_TLS_REJECT_UNAUTHORIZED=0`
 * is one line and would make this scraper accept any server's answer about a
 * student's degree.
 *
 * No dependencies. Node's global fetch only.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The intermediate six northeastern.edu hosts fail to send. */
export const EXTRA_CA_PATH = join(HERE, "certs/incommon-rsa-ov-ssl-ca-3.pem");

/**
 * Identify ourselves honestly. A university has a legitimate interest in knowing
 * who is reading its pages, and a contactable UA is what keeps a polite scraper
 * from looking like an anonymous one.
 */
export const USER_AGENT =
  "NUMapPathwayIntake/1.0 (+https://numap.app; academic planning tool; contact via repo issues)";

/**
 * Hosts that need the extra CA. Kept explicit rather than inferred so that a
 * host quietly starting to fail is a visible change to this list.
 */
export const BROKEN_CHAIN_HOSTS = Object.freeze([
  "coe", "ece", "mie", "cee", "che", "bioe",
]);

/**
 * Node reads NODE_EXTRA_CA_CERTS once, at startup, so it cannot be set from
 * inside the process. This tells a caller whether it is set correctly and, if
 * not, exactly what to run — rather than letting six hosts fail mysteriously.
 *
 * @returns {{ok: boolean, hint: string|null}}
 */
export function checkTlsSetup(env = process.env) {
  const want = EXTRA_CA_PATH;
  const got = env.NODE_EXTRA_CA_CERTS;
  if (got && got.includes("incommon")) return { ok: true, hint: null };
  return {
    ok: false,
    hint:
      `NODE_EXTRA_CA_CERTS is not set to the InCommon intermediate, so these hosts ` +
      `will fail TLS verification: ${BROKEN_CHAIN_HOSTS.join(", ")}.\n` +
      `  Re-run as:  NODE_EXTRA_CA_CERTS=${want} node <script>\n` +
      `  Why: scripts/lib/certs/README.md`,
  };
}

/** Per-host tallies, so a reachability rail has something to check. */
export function newStats() {
  return { fetched: 0, failed: 0, errors: new Map() };
}

function noteError(stats, host, err) {
  const code = err?.cause?.code ?? err?.name ?? "Error";
  const msg = err?.cause?.message ?? err?.message ?? String(err);
  stats.failed += 1;
  if (!stats.errors.has(host)) stats.errors.set(host, []);
  const list = stats.errors.get(host);
  if (list.length < 5) list.push(`${code}: ${msg}`);
}

/**
 * Fetch text. Returns null on failure and RECORDS why — never swallows.
 *
 * @param {string} url
 * @param {object} opts
 * @param {ReturnType<newStats>} opts.stats
 * @param {string} opts.host           short host key, e.g. "coe"
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.retries]      transient-failure retries (not TLS: a
 *                                     broken chain fails identically every time,
 *                                     so retrying it only wastes the run)
 */
export async function fetchText(url, { stats, host, timeoutMs = 25_000, retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, "Accept-Encoding": "gzip" },
        signal: ac.signal,
        redirect: "follow",
      });
      if (!res.ok) {
        // 404 is information (a page went away), not a transient failure.
        if (res.status === 404) {
          if (stats) { stats.failed += 1; noteHttp(stats, host, 404); }
          return null;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const text = (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString("utf8");
      if (stats) stats.fetched += 1;
      return text;
    } catch (err) {
      const fatal = String(err?.cause?.code ?? "").includes("UNABLE_TO_VERIFY")
                 || String(err?.cause?.code ?? "").includes("CERT");
      if (fatal || attempt >= retries) {
        if (stats) noteError(stats, host, err);
        return null;
      }
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    } finally {
      clearTimeout(t);
    }
  }
}

function noteHttp(stats, host, status) {
  if (!stats.errors.has(host)) stats.errors.set(host, []);
  const list = stats.errors.get(host);
  if (list.length < 5) list.push(`HTTP ${status}`);
}

/**
 * RAIL 1. A host that produced no URLs *and* recorded a failure is unreachable,
 * and the run must not pretend otherwise.
 *
 * A host with genuinely zero pages and zero failures is fine — that is a real
 * answer. The pairing is what separates the two, and it is why `fetchText`
 * bothers to record errors at all.
 *
 * @param {Map<string, number>|object} urlCounts  host → URLs discovered
 * @param {ReturnType<newStats>} stats
 * @returns {{ok: boolean, failures: string[]}}
 */
export function assertHostsReachable(urlCounts, stats) {
  const counts = urlCounts instanceof Map ? urlCounts : new Map(Object.entries(urlCounts));
  const failures = [];
  for (const [host, n] of counts) {
    const errs = stats?.errors?.get(host) ?? [];
    if (n === 0 && errs.length) {
      failures.push(
        `${host}: 0 URLs discovered and ${errs.length} fetch failure(s) — ` +
        `unreachable, not empty (${errs[0]})`
      );
    }
  }
  return { ok: failures.length === 0, failures };
}

/** robots.txt Disallow rules for `User-agent: *`. We honour them. */
export function parseRobots(txt) {
  const out = [];
  let applies = false;
  for (const raw of String(txt ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const val = line.slice(i + 1).trim();
    if (key === "user-agent") applies = val === "*";
    else if (key === "disallow" && applies && val) out.push(val);
  }
  return out;
}

/** Is `path` blocked by any rule? Prefix match, as the standard specifies. */
export function isDisallowed(path, rules = []) {
  return rules.some(r => path.startsWith(r));
}
