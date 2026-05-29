// URL-based plan sharing via gzip + base64url (no external deps, uses browser CompressionStream).

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

export async function encodePlan(data) {
  return _compress(JSON.stringify(data));
}

export async function decodePlan(encoded) {
  return JSON.parse(await _decompress(encoded));
}

export function buildShareUrl(encoded) {
  return `${window.location.origin}${window.location.pathname}#plan=${encoded}`;
}

export function getHashPlanParam() {
  const hash = window.location.hash;
  if (!hash.startsWith('#plan=')) return null;
  return hash.slice('#plan='.length);
}
