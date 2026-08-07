// UNIT · shareCrypto — the share code IS the encryption key.
//
// The property that matters: the relay is handed an id and ciphertext, and
// neither reveals the code or the plan. Everything else here guards the
// construction that makes that true — one slow KDF pass split into id and
// key, so an attacker holding the id has no cheap route to the key.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  randomCode, normalizeCode, deriveShareId, encryptForCode, decryptWithCode,
  CODE_ALPHABET, CODE_LENGTH, ID_PATTERN,
} from "../../src/core/shareCrypto.js";

test("shareCrypto › code shape: crypto-random, alphabet-only, fixed length", () => {
  const codes = new Set();
  for (let i = 0; i < 50; i++) {
    const code = randomCode();
    assert.equal(code.length, CODE_LENGTH);
    for (const c of code) assert.ok(CODE_ALPHABET.includes(c), `unexpected char ${c}`);
    codes.add(code);
  }
  assert.ok(codes.size > 45, "codes should be effectively unique");
  // The excluded characters are the ones people mishear or mistype.
  for (const c of "01OIL") assert.ok(!CODE_ALPHABET.includes(c), `${c} must not be in the alphabet`);
});

test("shareCrypto › normalizeCode uppercases and strips separators", () => {
  assert.equal(normalizeCode(" m4p-le7 "), "M4PLE7");
  assert.equal(normalizeCode(null), "");
});

test("shareCrypto › the id is stable, hex, and survives sloppy typing", async () => {
  const code = randomCode();
  const id = await deriveShareId(code);
  assert.ok(ID_PATTERN.test(id), `id must be 32 hex chars, got ${id}`);
  assert.equal(await deriveShareId(code), id, "derivation must be deterministic");
  // What a human retypes off a phone call.
  assert.equal(await deriveShareId(` ${code.toLowerCase()} `), id);
  assert.equal(await deriveShareId(`${code.slice(0, 3)}-${code.slice(3)}`), id);
});

test("shareCrypto › different codes give different ids", async () => {
  const ids = new Set();
  for (let i = 0; i < 8; i++) ids.add(await deriveShareId(randomCode()));
  assert.equal(ids.size, 8);
});

test("shareCrypto › round-trips, and only with the right code", async () => {
  const code = randomCode();
  const plaintext = "H4sIAAAA-pretend-encoded-plan_payload";
  const { id, blob } = await encryptForCode(code, plaintext);

  assert.equal(await decryptWithCode(code, blob), plaintext);
  assert.equal(id, await deriveShareId(code), "encrypt must file under the same id");

  // A wrong code is rejected outright — AES-GCM authenticates, so it fails
  // loudly rather than returning plausible garbage.
  await assert.rejects(() => decryptWithCode(randomCode(), blob), /bad_payload/);
});

test("shareCrypto › neither the id nor the ciphertext leaks the secret", async () => {
  const code = randomCode();
  const plaintext = "placements-CS2500-fall2026";
  const { id, blob } = await encryptForCode(code, plaintext);

  // Everything the server ever holds:
  assert.ok(!id.includes(code), "id must not contain the code");
  assert.ok(!blob.includes(code), "ciphertext must not contain the code");
  assert.ok(!blob.includes("CS2500"), "plaintext must not be legible in the ciphertext");
  assert.ok(!blob.includes(plaintext));
});

test("shareCrypto › tampering is detected, not silently decrypted", async () => {
  const code = randomCode();
  const { blob } = await encryptForCode(code, "some-plan-payload");
  const flip = (s) => s.slice(0, -4) + (s.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
  await assert.rejects(() => decryptWithCode(code, flip(blob)), /bad_payload/);
  await assert.rejects(() => decryptWithCode(code, "short"), /bad_payload/);
  await assert.rejects(() => decryptWithCode(code, ""), /bad_payload/);
});

test("shareCrypto › the same plan encrypts differently every time", async () => {
  // A fresh IV per share: two sends of an identical plan must not produce
  // identical bytes, or the relay could tell they were the same plan.
  const code = randomCode();
  const a = await encryptForCode(code, "identical-plan");
  const b = await encryptForCode(code, "identical-plan");
  assert.notEqual(a.blob, b.blob);
  assert.equal(a.id, b.id, "the id depends only on the code");
  assert.equal(await decryptWithCode(code, a.blob), "identical-plan");
  assert.equal(await decryptWithCode(code, b.blob), "identical-plan");
});

test("shareCrypto › an empty or missing code is refused", async () => {
  await assert.rejects(() => deriveShareId(""), /bad_code/);
  await assert.rejects(() => deriveShareId("!!!"), /bad_code/);
  await assert.rejects(() => encryptForCode(null, "x"), /bad_code/);
});
