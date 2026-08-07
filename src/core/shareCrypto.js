// ═══════════════════════════════════════════════════════════════════
// SHARE CRYPTO — the share code is the encryption key.
//
// Share-by-code used to hand the relay a readable plan: the server
// generated the code, held the encoded plan under it, and could decode
// it (it did, to validate). "We don't read your plan" was a promise
// backed by open code rather than something the server was incapable of.
// This makes it incapable.
//
// The client now generates the code, derives BOTH a storage id and an
// AES key from it, and uploads only ciphertext under that id. The server
// never sees the code, so it cannot derive the key. The receiver types
// the code, derives the same id to fetch and the same key to decrypt.
//
// ── Why one slow derivation, split ──────────────────────────────────
// The obvious construction — id = SHA-256(code), key = KDF(code) — is
// broken. The server is *given* the id, and a fast hash makes it an
// oracle: 887 million candidate codes can be hashed in seconds, and the
// match reveals the code, hence the key. The slow KDF would buy nothing.
//
// So one PBKDF2 pass produces 48 bytes and we split them: the first 16
// become the id, the last 32 the AES-256 key. Recovering the id's
// preimage now costs a full slow derivation per guess, and that same
// work is what recovering the key costs — there is no cheap shortcut in.
//
// ── The honest limit of a six-character code ────────────────────────
// The alphabet is 31 characters and the code is 6, so the keyspace is
// 31^6 ≈ 887 million. That is deliberately small because the code has to
// be spoken aloud, and it means an attacker who OBTAINS THE CIPHERTEXT
// can brute-force it offline: ~887M × 300k PBKDF2 iterations is hours to
// days of serious GPU time, not centuries.
//
// What this therefore does and does not buy:
//   • It does remove the relay, its operator, and its logs from the set
//     of parties able to read a plan in the course of normal operation.
//     That is the threat this addresses, and it is now structural.
//   • It does NOT withstand a determined attacker who first exfiltrates
//     ciphertext — which exists for at most ten minutes and holds a
//     course plan.
//   • It cannot, even in principle, defend against the server shipping
//     dishonest JavaScript. In-browser end-to-end encryption always
//     trusts the page it came from; the open repository is what makes
//     that checkable, and no cryptography replaces it.
// A longer code is the one lever that changes the first bullet, and it
// was weighed against sayability and lost.
// ═══════════════════════════════════════════════════════════════════

/** No 0/O/1/I/L — the code gets read aloud and mistyped. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

/** Storage ids are hex of the first 16 derived bytes. */
export const ID_LENGTH = 32;
export const ID_PATTERN = /^[0-9a-f]{32}$/;

// 300k iterations: ~0.3-1s per derivation on a phone, paid once when a
// code is created and once when it is claimed. It multiplies the cost of
// the offline attack above linearly, which is the only defence a short
// secret can have.
const PBKDF2_ITERATIONS = 300_000;
const KDF_SALT = "numap-share-v1";
const IV_BYTES = 12;   // AES-GCM standard nonce length

const enc = new TextEncoder();
const dec = new TextDecoder();

const subtle = () => {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("crypto_unavailable");
  return c.subtle;
};

/** Crypto-random code over CODE_ALPHABET, rejection-sampled so every
 *  character is equally likely (modulo bias would shrink the keyspace). */
export function randomCode(len = CODE_LENGTH) {
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let code = "";
  while (code.length < len) {
    const bytes = new Uint8Array(len * 2);
    globalThis.crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limit && code.length < len) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return code;
}

/** "k7m2-qx" → "K7M2QX". Users retype codes with spaces and dashes. */
export function normalizeCode(raw) {
  return String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const toBase64Url = (bytes) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (b64url) => {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * One slow derivation per code, split into the parts that must not be
 * cheaply derivable from one another.
 * @returns {Promise<{id: string, key: CryptoKey}>}
 */
async function derive(code) {
  const normalized = normalizeCode(code);
  if (!normalized) throw new Error("bad_code");
  const base = await subtle().importKey("raw", enc.encode(normalized), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle().deriveBits(
    { name: "PBKDF2", salt: enc.encode(KDF_SALT), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    base,
    384,   // 48 bytes: 16 for the id, 32 for the key
  );
  const bytes = new Uint8Array(bits);
  const key = await subtle().importKey("raw", bytes.slice(16, 48), { name: "AES-GCM" }, false,
    ["encrypt", "decrypt"]);
  return { id: hex(bytes.slice(0, 16)), key };
}

/** The storage id for a code — all the server ever learns. */
export async function deriveShareId(code) {
  return (await derive(code)).id;
}

/**
 * Encrypt a plan payload under a code.
 * @returns {Promise<{id: string, blob: string}>} blob is base64url(iv‖ciphertext)
 */
export async function encryptForCode(code, plaintext) {
  const { id, key } = await derive(code);
  const iv = new Uint8Array(IV_BYTES);
  globalThis.crypto.getRandomValues(iv);
  const ct = new Uint8Array(
    await subtle().encrypt({ name: "AES-GCM", iv }, key, enc.encode(String(plaintext))),
  );
  const joined = new Uint8Array(iv.length + ct.length);
  joined.set(iv, 0);
  joined.set(ct, iv.length);
  return { id, blob: toBase64Url(joined) };
}

/**
 * Decrypt a blob with a code. Throws "bad_payload" when the code is wrong
 * or the bytes were tampered with — AES-GCM authenticates, so a wrong key
 * fails loudly rather than returning garbage.
 */
export async function decryptWithCode(code, blob) {
  const { key } = await derive(code);
  let bytes;
  try { bytes = fromBase64Url(String(blob)); } catch { throw new Error("bad_payload"); }
  if (bytes.length <= IV_BYTES) throw new Error("bad_payload");
  try {
    const pt = await subtle().decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, IV_BYTES) }, key, bytes.slice(IV_BYTES),
    );
    return dec.decode(pt);
  } catch {
    throw new Error("bad_payload");
  }
}
