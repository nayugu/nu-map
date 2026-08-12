// URL-based plan sharing via gzip + base64url (no external deps, uses browser CompressionStream).

import { SHARE_KEYS, SHARE_KEYS_R, SHARE_INNER_KEYS } from './planSchema.js';
import { CODE_ALPHABET, CODE_LENGTH } from './shareCrypto.js';

async function _compress(str) {
  const bytes = new TextEncoder().encode(str);
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const chunks = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLen = chunks.reduce((n, c) => n + c.length, 0);
  const buf = new Uint8Array(totalLen);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  let binary = '';
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function _decompress(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - b64.length % 4) % 4;
  const binary = atob(b64 + '='.repeat(pad));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const chunks = [];
  const reader = ds.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLen = chunks.reduce((n, c) => n + c.length, 0);
  const buf = new Uint8Array(totalLen);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  return new TextDecoder().decode(buf);
}

// v2 compact format: short key names + skip empty/default fields + drop unused `exported`.
//
// The key maps are derived from the canonical plan registry (planSchema.js) so
// the share door cannot drift out of sync with the field list — the omissions
// documented above (conc2 dropped, reservations dropped) are exactly what a
// single source of truth prevents. See planSchema for which fields are shared
// and which (grades, appliedTemplate) deliberately are not.

const _KEYS = SHARE_KEYS;
const _KEYS_R = SHARE_KEYS_R;

// Inner keys for specialTermPl entry objects
const _SP = SHARE_INNER_KEYS.specialTerm;
const _SP_R = Object.fromEntries(Object.entries(_SP).map(([k, v]) => [v, k]));

// Inner keys for substitutions array entries
const _SU = SHARE_INNER_KEYS.substitution;
const _SU_R = Object.fromEntries(Object.entries(_SU).map(([k, v]) => [v, k]));

function _isEmpty(v) {
  if (v == null || v === '' || v === 0) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

function _packPlan(data) {
  const out = { v: 2 };
  for (const [full, short] of Object.entries(_KEYS)) {
    let val = data[full];
    if (val === undefined) continue;

    if (full === 'specialTermPl' && val && typeof val === 'object') {
      const packed = {};
      for (const [id, entry] of Object.entries(val)) {
        const pe = {};
        for (const [k, v] of Object.entries(entry)) pe[_SP[k] ?? k] = v;
        packed[id] = pe;
      }
      val = packed;
    } else if (full === 'substitutions' && Array.isArray(val)) {
      val = val.map(({ from, to, ...rest }) => ({ f: from, t: to, ...rest }));
    }

    if (!_isEmpty(val)) out[short] = val;
  }
  return out;
}

function _unpackPlan(compact) {
  const out = { version: 2 };
  for (const [short, val] of Object.entries(compact)) {
    if (short === 'v') continue;
    const full = _KEYS_R[short] ?? short;

    if (full === 'specialTermPl' && val && typeof val === 'object') {
      const unpacked = {};
      for (const [id, entry] of Object.entries(val)) {
        const ue = {};
        for (const [k, v] of Object.entries(entry)) ue[_SP_R[k] ?? k] = v;
        unpacked[id] = ue;
      }
      out[full] = unpacked;
    } else if (full === 'substitutions' && Array.isArray(val)) {
      out[full] = val.map(({ f, t, ...rest }) => ({ from: f, to: t, ...rest }));
    } else {
      out[full] = val;
    }
  }
  return out;
}

export async function encodePlan(data) {
  return _compress(JSON.stringify(_packPlan(data)));
}

export async function decodePlan(encoded) {
  const raw = JSON.parse(await _decompress(encoded));
  if (raw.v === 2) return _unpackPlan(raw);
  return raw; // version 1: return as-is
}

export function buildShareUrl(encoded) {
  return `${window.location.origin}${window.location.pathname}#plan=${encoded}`;
}

export function getHashPlanParam() {
  const hash = window.location.hash;
  if (!hash.startsWith('#plan=')) return null;
  return hash.slice('#plan='.length);
}

// ── Share-by-code links (#c=) ──────────────────────────────────────
// A snapshot link (#plan=) carries the whole plan and lives forever. A
// code link carries only the six characters, so it inherits everything
// the code already is: single use, ten minutes, cancellable, and opaque
// to the relay (the code IS the decryption key — see shareCrypto.js).
// This is what the QR encodes; nothing else is small enough to want to.

// A QR is scanned by a DIFFERENT device, so the only origin that can ever
// be in it is one that device can reach. Loopback cannot be: "localhost"
// on a phone means the phone, so a localhost QR resolves to nothing at all
// — it does not even fail informatively. That is the one case that has to
// be overridden, and it is overridden with the canonical origin declared
// in index.html (https://numap.app).
//
// Everything else keeps window.location.origin, deliberately. An earlier
// version of this function preferred canonical everywhere, on the reasoning
// that a preview build's pages.dev / github.io origin "would 404" — that
// was simply wrong, those origins serve the whole app. Worse, overriding
// them is actively harmful: a preview deploy is configured against its own
// relay, so rewriting its links to numap.app would send the recipient to an
// app talking to a DIFFERENT relay, which cannot hold the code. The origin
// that minted a code is the origin whose relay has it, so that is the
// origin the QR must name.
//
// The residual honest gap is dev-over-loopback: the code is parked on the
// localhost relay, and the canonical link we fall back to reaches
// production, which has never seen it. The recipient gets "Code not found
// or expired" — the correct message, and a far better failure than a URL
// that cannot load. A developer who wants a genuinely scannable dev QR
// serves over the LAN (vite --host) and points VITE_MCP_SERVER_URL at the
// same host; then origin is a LAN address, this returns it, and the whole
// flow works end to end.
// Exported because the share relay needs exactly the same judgement for
// exactly the same reason (its dev default follows the page's host), and
// two copies of a rule like this drift — the first draft of them already
// disagreed about `127.x` and `0.0.0.0`.
// `127.` rather than `127.0.0.1` because the whole /8 is loopback and the
// shorthands resolve there too (http://127.1 is a real thing).
const _LOOPBACK = new Set(['localhost', '0.0.0.0', '::1', '[::1]', '::', '[::]']);

export function isLoopbackHost(hostname) {
  const h = String(hostname ?? '').toLowerCase().replace(/\.$/, '');
  return _LOOPBACK.has(h) || h.endsWith('.localhost') || /^127\./.test(h);
}

function _shareOrigin() {
  let origin, hostname;
  try {
    origin = window.location.origin;
    hostname = window.location.hostname;
  } catch { /* no window (tests) — canonical is all we have */ }

  if (origin && !isLoopbackHost(hostname)) return origin;

  try {
    const href = document.querySelector('link[rel="canonical"]')?.href;
    if (href) return new URL(href).origin;
  } catch { /* no DOM, or a malformed canonical — fall through */ }

  return origin ?? '';
}

export function buildCodeUrl(code) {
  return `${_shareOrigin()}/#c=${code}`;
}

// Returns the code only if it is one this app could have produced. The
// claim path runs a 300k-iteration PBKDF2 over whatever comes back, so
// junk in the hash is rejected here rather than paid for in key
// derivation. Case is normalised; the alphabet excludes 0/O/1/I/L, so a
// hand-typed "l" is a miss, not a silent near-match.
export function getHashCodeParam() {
  const hash = window.location.hash;
  if (!hash.startsWith('#c=')) return null;
  const code = hash.slice('#c='.length).toUpperCase();
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}
