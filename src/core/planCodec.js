// Self-contained static plan codec — packs an entire plan into the smallest
// bit-stream we can, base64url'd straight into a `#p=` URL. NOTHING is stored on
// a server: the plan lives entirely inside the link/QR, so sharing is fully
// local and private. Purpose-built (no JSON, no gzip) because a plan's real
// information is tiny — which of ~8k courses, in which of ~16 semesters, plus a
// few programs.
//
// To keep the QR sparse (~45×45 for a typical plan), courses and programs are
// referenced by their index in a FROZEN dictionary (src/core/planDict.json): a
// 13-bit course code beats spelling out "CS2500", a 10-bit program code beats a
// 70-char id string. The dictionary is committed and never reordered, so links
// decode correctly forever; anything not in it (a course added after the
// snapshot, a synthetic id) gracefully falls back to a self-describing form
// rather than being dropped.
import planDict from "./planDict.js";

const COURSE_LIST = planDict.c ? planDict.c.split(" ") : [];
const PROG_LIST = planDict.p ? planDict.p.split(" ") : [];
const COURSE_IDX = new Map(COURSE_LIST.map((id, i) => [id, i]));
const PROG_IDX = new Map(PROG_LIST.map((id, i) => [id, i]));
const COURSE_BITS = Math.max(1, Math.ceil(Math.log2(COURSE_LIST.length || 1)));
const PROG_BITS = Math.max(1, Math.ceil(Math.log2(PROG_LIST.length || 1)));

// ── bit IO ───────────────────────────────────────────────────────────────────

class BitWriter {
  constructor() { this._bytes = []; this._cur = 0; this._n = 0; }
  bit(b) {
    this._cur = (this._cur << 1) | (b & 1);
    if (++this._n === 8) { this._bytes.push(this._cur); this._cur = 0; this._n = 0; }
  }
  bits(value, len) { for (let i = len - 1; i >= 0; i--) this.bit((value >>> i) & 1); }
  finish() {
    if (this._n > 0) { this._bytes.push(this._cur << (8 - this._n)); this._cur = 0; this._n = 0; }
    return Uint8Array.from(this._bytes);
  }
}

class BitReader {
  constructor(u8) { this._u8 = u8; this._pos = 0; }
  bit() {
    const byte = this._u8[this._pos >> 3] ?? 0;
    const b = (byte >> (7 - (this._pos & 7))) & 1;
    this._pos++;
    return b;
  }
  bits(len) { let v = 0; for (let i = 0; i < len; i++) v = (v << 1) | this.bit(); return v >>> 0; }
}

// ── base64url ────────────────────────────────────────────────────────────────

function toB64url(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function fromB64url(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

// ── string codec: 6-bit charset when it fits (program ids, ascii ids), raw
//    UTF-8 otherwise (arbitrary plan names). Length in 12 bits (≤ 4095). ───────

// EXACTLY 64 chars so every index fits in 6 bits — a 65th char would encode as
// index 64, overflow, and corrupt on decode. Anything outside this set (e.g.
// uppercase T–Z, most company-name punctuation) round-trips via raw 8-bit mode.
const CHARSET = "abcdefghijklmnopqrstuvwxyz0123456789 _-/().,:ABCDEFGHIJKLMNOPQRS";
if (CHARSET.length !== 64) throw new Error(`planCodec CHARSET must be 64 chars, is ${CHARSET.length}`);
const CHARMAP = Object.fromEntries([...CHARSET].map((c, i) => [c, i]));

function writeString(w, s) {
  s = s ?? "";
  const fits = [...s].every(c => c in CHARMAP);
  if (fits && s.length <= 4095) {
    w.bit(0);
    w.bits(s.length, 12);
    for (const c of s) w.bits(CHARMAP[c], 6);
  } else {
    const bytes = new TextEncoder().encode(s);
    w.bit(1);
    w.bits(Math.min(bytes.length, 4095), 12);
    for (let i = 0; i < bytes.length && i < 4095; i++) w.bits(bytes[i], 8);
  }
}
function readString(r) {
  const raw = r.bit();
  const len = r.bits(12);
  if (raw === 0) {
    let s = "";
    for (let i = 0; i < len; i++) s += CHARSET[r.bits(6)];
    return s;
  }
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = r.bits(8);
  return new TextDecoder().decode(bytes);
}

// optional string: 1 present-bit + string
function writeOptString(w, s) { if (s) { w.bit(1); writeString(w, s); } else w.bit(0); }
function readOptString(r) { return r.bit() ? readString(r) : ""; }

// ── domain codecs ────────────────────────────────────────────────────────────

// Semester TYPE ids (entSem/gradSem) vs semId PREFIXES (in placement semIds).
const SEM_TYPES = ["fall", "spring", "sumA", "sumB"];
const SEM_PREFIX = ["fall", "spr", "sumA", "sumB"]; // spring's semId prefix is "spr"
const PREFIX_IDX = { fall: 0, spr: 1, sumA: 2, sumB: 3 };
const SEM_RE = /^(fall|spr|sumA|sumB)(\d{4})$/;
const YEAR_BIAS = 4; // allow a few semesters before the entry year

const semTypeIndex = (id) => Math.max(0, SEM_TYPES.indexOf(id));

// A semId as 9 bits when it's a normal cohort term, else a fallback string
// (covers the "incoming" sentinel and anything unexpected).
function writeSem(w, semId, entYear) {
  const m = SEM_RE.exec(semId || "");
  const off = m ? Number(m[2]) - entYear + YEAR_BIAS : -1;
  if (m && off >= 0 && off < 64) {
    w.bit(0);
    w.bits(PREFIX_IDX[m[1]], 2);
    w.bits(off, 6);
  } else {
    w.bit(1);
    writeString(w, semId ?? "");
  }
}
function readSem(r, entYear) {
  if (r.bit() === 0) {
    const type = r.bits(2);
    const year = entYear + r.bits(6) - YEAR_BIAS;
    return `${SEM_PREFIX[type]}${year}`;
  }
  return readString(r);
}

// Subject code (2-4 uppercase letters): 2-bit length + 5 bits/letter.
function writeSubject(w, sub) {
  w.bits(sub.length - 2, 2);
  for (const ch of sub) w.bits(ch.charCodeAt(0) - 65, 5);
}
function readSubject(r) {
  const len = r.bits(2) + 2;
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(65 + r.bits(5));
  return s;
}

// A course reference: 1 bit "in dictionary" + 13-bit index (the common, compact
// case). Otherwise self-describing: subject+number when it matches the catalog
// shape, else a raw string. Guarantees any courseId round-trips.
const COURSE_RE = /^([A-Z]{2,4})(\d{4})$/;
// When `allIndexed` is set (plan-level guarantee), the per-course "in
// dictionary?" bit is omitted and the id is written as a bare index.
function writeCourseRef(w, cid, allIndexed) {
  const idx = COURSE_IDX.get(cid);
  if (allIndexed) { w.bits(idx, COURSE_BITS); return; }
  if (idx !== undefined) { w.bit(1); w.bits(idx, COURSE_BITS); return; }
  w.bit(0);
  const m = COURSE_RE.exec(cid || "");
  if (m) { w.bit(0); writeSubject(w, m[1]); w.bits(Number(m[2]), 14); }
  else { w.bit(1); writeString(w, cid ?? ""); }
}
function readCourseRef(r, allIndexed) {
  if (allIndexed || r.bit() === 1) return COURSE_LIST[r.bits(COURSE_BITS)] ?? "";
  if (r.bit() === 0) return readSubject(r) + String(r.bits(14)).padStart(4, "0");
  return readString(r);
}

// A program reference: present-bit, then 1 bit "in dictionary" + 10-bit index,
// else the raw id string. (conc ids aren't in the program list — they fall back
// to the string path automatically.)
function writeProgram(w, id) {
  if (!id) { w.bit(0); return; }
  w.bit(1);
  const idx = PROG_IDX.get(id);
  if (idx !== undefined) { w.bit(1); w.bits(idx, PROG_BITS); }
  else { w.bit(0); writeString(w, id); }
}
function readProgram(r) {
  if (r.bit() === 0) return "";
  if (r.bit() === 1) return PROG_LIST[r.bits(PROG_BITS)] ?? "";
  return readString(r);
}

// studentType is almost always "undergrad" or "grad" — 2 bits, string fallback.
const STUDENT_TYPES = ["undergrad", "grad"];
function writeStudentType(w, st) {
  const i = STUDENT_TYPES.indexOf(st);
  if (i >= 0) { w.bit(1); w.bit(i); } else { w.bit(0); writeString(w, st || "undergrad"); }
}
function readStudentType(r) {
  if (r.bit()) return STUDENT_TYPES[r.bit()];
  return readString(r) || "undergrad";
}

// locale is one of the 8 shipped locales — 3 bits, string fallback. Order is
// frozen (indices are part of the wire format); new locales append.
const LOCALES = ["en", "es", "fr", "ar", "hi", "ja", "ko", "zh"];
function writeLocale(w, lc) {
  if (!lc) { w.bit(0); return; }
  w.bit(1);
  const i = LOCALES.indexOf(lc);
  if (i >= 0) { w.bit(1); w.bits(i, 3); } else { w.bit(0); writeString(w, lc); }
}
function readLocale(r) {
  if (!r.bit()) return "";
  if (r.bit()) return LOCALES[r.bits(3)] ?? "";
  return readString(r);
}

// ── plan encode / decode ─────────────────────────────────────────────────────

const RARE_MAPS = ["semOrders", "shOverrides", "offeredOverrides", "collapsedSubs"];
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n | 0));

// True when every referenced courseId is in the frozen dictionary — the usual
// case, which lets us drop the per-course "in dictionary?" bit entirely.
function allCoursesIndexed(plan) {
  for (const cid of Object.keys(plan.placements || {})) if (!COURSE_IDX.has(cid)) return false;
  for (const cid of (Array.isArray(plan.placedOut) ? plan.placedOut : [])) if (!COURSE_IDX.has(cid)) return false;
  for (const s of (Array.isArray(plan.substitutions) ? plan.substitutions : [])) {
    if (!COURSE_IDX.has(s.from) || !COURSE_IDX.has(s.to)) return false;
  }
  return true;
}

export function encodePlanStatic(plan) {
  const w = new BitWriter();
  const entYear = plan.entYear || 2000;

  w.bits(2, 6); // format version
  writeStudentType(w, plan.studentType || "undergrad");
  w.bits(clamp(entYear - 2000, 0, 255), 8);
  w.bits(semTypeIndex(plan.entSem), 2);
  w.bits(clamp((plan.gradYear || entYear) - entYear, 0, 31), 5);
  w.bits(semTypeIndex(plan.gradSem), 2);

  if (plan.currentSemId) { w.bit(1); writeSem(w, plan.currentSemId, entYear); } else w.bit(0);
  writeLocale(w, plan.locale);
  writeOptString(w, plan.planName);
  for (const k of ["major", "major2", "conc", "minor1", "minor2"]) writeProgram(w, plan[k]);

  const ai = allCoursesIndexed(plan);
  w.bit(ai ? 1 : 0);

  // placements grouped by semester (semester written once per group)
  const bySem = new Map();
  for (const [cid, sem] of Object.entries(plan.placements || {})) {
    if (!bySem.has(sem)) bySem.set(sem, []);
    bySem.get(sem).push(cid);
  }
  w.bits(Math.min(bySem.size, 63), 6);
  for (const [sem, cids] of bySem) {
    writeSem(w, sem, entYear);
    w.bits(Math.min(cids.length, 255), 8);
    for (const cid of cids) writeCourseRef(w, cid, ai);
  }

  const po = Array.isArray(plan.placedOut) ? plan.placedOut : [];
  w.bits(po.length, 8);
  for (const cid of po) writeCourseRef(w, cid, ai);

  const su = Array.isArray(plan.substitutions) ? plan.substitutions : [];
  w.bits(su.length, 6);
  for (const s of su) { writeCourseRef(w, s.from, ai); writeCourseRef(w, s.to, ai); }

  const st = Object.entries(plan.specialTermPl || {});
  w.bits(st.length, 6);
  for (const [id, e] of st) {
    writeString(w, id);
    writeString(w, e.typeId || "");
    writeSem(w, e.semId, entYear);
    w.bits(clamp(e.duration || 0, 0, 63), 6);
    writeOptString(w, e.company);
    writeOptString(w, e.companyDomain);
    writeOptString(w, e.subline);
  }

  if (plan.bonusSH) { w.bit(1); w.bits(clamp(plan.bonusSH, 0, 65535), 16); } else w.bit(0);

  for (const k of RARE_MAPS) {
    const v = plan[k];
    if (v && Object.keys(v).length) { w.bit(1); writeString(w, JSON.stringify(v)); } else w.bit(0);
  }

  return toB64url(w.finish());
}

export function decodePlanStatic(b64) {
  const r = new BitReader(fromB64url(b64));
  r.bits(6); // version (reserved)

  const studentType = readStudentType(r);
  const entYear = 2000 + r.bits(8);
  const entSem = SEM_TYPES[r.bits(2)];
  const gradYear = entYear + r.bits(5);
  const gradSem = SEM_TYPES[r.bits(2)];

  const currentSemId = r.bit() ? readSem(r, entYear) : "";
  const locale = readLocale(r);
  const planName = readOptString(r);
  const [major, major2, conc, minor1, minor2] = ["major", "major2", "conc", "minor1", "minor2"].map(() => readProgram(r));

  const ai = r.bit() === 1;

  const placements = {};
  const nSem = r.bits(6);
  for (let s = 0; s < nSem; s++) {
    const sem = readSem(r, entYear);
    const n = r.bits(8);
    for (let i = 0; i < n; i++) placements[readCourseRef(r, ai)] = sem;
  }

  const placedOut = [];
  const poN = r.bits(8);
  for (let i = 0; i < poN; i++) placedOut.push(readCourseRef(r, ai));

  const substitutions = [];
  const suN = r.bits(6);
  for (let i = 0; i < suN; i++) substitutions.push({ from: readCourseRef(r, ai), to: readCourseRef(r, ai) });

  const specialTermPl = {};
  const stN = r.bits(6);
  for (let i = 0; i < stN; i++) {
    const id = readString(r);
    const typeId = readString(r);
    const semId = readSem(r, entYear);
    const duration = r.bits(6);
    const company = readOptString(r);
    const companyDomain = readOptString(r);
    const subline = readOptString(r);
    const e = { typeId, semId, duration };
    if (company) e.company = company;
    if (companyDomain) e.companyDomain = companyDomain;
    if (subline) e.subline = subline;
    specialTermPl[id] = e;
  }

  const bonusSH = r.bit() ? r.bits(16) : 0;

  const plan = {
    version: 1, entSem, entYear, gradSem, gradYear,
    placements, specialTermPl, bonusSH, currentSemId,
    semOrders: {}, shOverrides: {}, offeredOverrides: {}, collapsedSubs: {},
    major, major2, conc, minor1, minor2,
    studentType: studentType || "undergrad", placedOut,
    substitutions, planName, locale,
  };
  for (const k of RARE_MAPS) if (r.bit()) plan[k] = JSON.parse(readString(r));
  return plan;
}

// Read a `#p=<data>` param from the URL hash, or null.
export function getStaticHashParam() {
  const hash = window.location.hash;
  return hash.startsWith("#p=") ? hash.slice("#p=".length) : null;
}
