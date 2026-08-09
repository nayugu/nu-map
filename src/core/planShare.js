// URL-based plan sharing via gzip + base64url (no external deps, uses browser CompressionStream).

import { SHARE_KEYS, SHARE_KEYS_R, SHARE_INNER_KEYS } from './planSchema.js';

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
