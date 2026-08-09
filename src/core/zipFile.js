/**
 * zipFile.js — a minimal ZIP reader and writer. Pure; no dependencies.
 *
 * ## Why hand-rolled rather than a library
 *
 * The app needs exactly two things from ZIP: write a flat set of small text
 * entries, and read one back. That is a few hundred bytes of header format,
 * against ~100 KB of JSZip in a bundle the build already flags as oversized.
 * Everything the format offers beyond this — spanning, encryption, zip64,
 * symlinks — is inapplicable to a folder of JSON files.
 *
 * ## STORE on write, STORE or DEFLATE on read
 *
 * Entries are written uncompressed. The archive exists so a human can browse
 * it and open one plan with the ordinary Load, and at ~3.6 KB per plan the
 * saving would be invisible against the reason the file exists; the lossless
 * single-document export is the option to reach for when size matters.
 * Writing STORE also keeps this module synchronous and testable without web
 * streams.
 *
 * Reading must still handle DEFLATE, because the moment a user unzips an
 * export and re-zips it — which Finder and Explorer both do compressed — the
 * file coming back in is no longer the file we wrote. That path uses the
 * platform's own DecompressionStream, so it still costs no dependency.
 *
 * ## What is deliberately rejected
 *
 * Entry names are attacker-controlled in the sense that matters here: they
 * come from a file the user was handed. An absolute path, or one containing
 * `..`, is refused rather than normalised — this app only ever wants a
 * relative name, so there is no legitimate reading of either.
 */

const LOCAL_SIG   = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG    = 0x06054b50;
/** General-purpose bit 11: the name is UTF-8, not CP437. */
const UTF8_FLAG   = 0x0800;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS packed date/time. Fixed fields, so an export is byte-reproducible. */
function dosDateTime(d) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

/**
 * Build a ZIP archive.
 * @param {Array<{path: string, data: Uint8Array}>} entries
 * @param {Date} [now]
 * @returns {Uint8Array}
 */
export function writeZip(entries, now = new Date()) {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(now);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const e of entries) {
    const name = enc.encode(e.path);
    const data = e.data;
    const sum = crc32(data);

    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_SIG, true);
    lv.setUint16(4, 20, true);            // version needed
    lv.setUint16(6, UTF8_FLAG, true);
    lv.setUint16(8, 0, true);             // method: STORE
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, sum, true);
    lv.setUint32(18, data.length, true);  // compressed size
    lv.setUint32(22, data.length, true);  // uncompressed size
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);            // extra length
    local.set(name, 30);
    local.set(data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, CENTRAL_SIG, true);
    cv.setUint16(4, 20, true);            // version made by
    cv.setUint16(6, 20, true);            // version needed
    cv.setUint16(8, UTF8_FLAG, true);
    cv.setUint16(10, 0, true);            // method
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, sum, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);            // extra
    cv.setUint16(32, 0, true);            // comment
    cv.setUint16(34, 0, true);            // disk number
    cv.setUint16(36, 0, true);            // internal attrs
    cv.setUint32(38, 0, true);            // external attrs
    cv.setUint32(42, offset, true);       // local header offset
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }

  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, EOCD_SIG, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const total = offset + cdSize + eocd.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const l of locals)   { out.set(l, at); at += l.length; }
  for (const c of centrals) { out.set(c, at); at += c.length; }
  out.set(eocd, at);
  return out;
}

/** Find the End Of Central Directory, scanning back past any trailing comment. */
function findEocd(view, len) {
  const min = Math.max(0, len - 22 - 0xffff);
  for (let i = len - 22; i >= min; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

async function inflateRaw(bytes) {
  // Platform-native; present in every browser this app supports and in Node 18+.
  if (typeof DecompressionStream !== "function") throw new Error("deflate-unsupported");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Read a ZIP archive.
 *
 * Reads the CENTRAL DIRECTORY rather than walking local headers: the central
 * directory is the authoritative index, and a local header may legitimately
 * carry zeroed sizes with the real values in a trailing data descriptor —
 * which is exactly what streaming zip writers emit.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<Array<{path: string, data: Uint8Array}>>}
 */
export async function readZip(bytes) {
  if (!bytes || bytes.length < 22) throw new Error("not-a-zip");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdAt = findEocd(view, bytes.length);
  if (eocdAt < 0) throw new Error("not-a-zip");

  const count  = view.getUint16(eocdAt + 10, true);
  let at       = view.getUint32(eocdAt + 16, true);
  const dec    = new TextDecoder();
  const out    = [];

  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL_SIG) throw new Error("corrupt");
    const method   = view.getUint16(at + 10, true);
    const compSize = view.getUint32(at + 20, true);
    const nameLen  = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const cmtLen   = view.getUint16(at + 32, true);
    const localAt  = view.getUint32(at + 42, true);
    const path     = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + cmtLen;

    // Directory entries carry no payload; the tree is rebuilt from the paths
    // of the FILES, so an explicit directory record adds nothing.
    if (path.endsWith("/")) continue;
    // No legitimate entry in this app escapes its own archive.
    if (path.startsWith("/") || path.includes("..")) throw new Error("unsafe-path");

    if (view.getUint32(localAt, true) !== LOCAL_SIG) throw new Error("corrupt");
    const lNameLen  = view.getUint16(localAt + 26, true);
    const lExtraLen = view.getUint16(localAt + 28, true);
    const start = localAt + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(start, start + compSize);

    if (method === 0)      out.push({ path, data: raw });
    else if (method === 8) out.push({ path, data: await inflateRaw(raw) });
    else throw new Error("unsupported-method");
  }
  return out;
}
