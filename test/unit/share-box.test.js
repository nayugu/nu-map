// Share-by-code relay — shareBox.js (used by the Node dev server and,
// via the same helpers, the worker's ShareBoxDO).
//
// The properties pinned here are the security model:
//   • a code is one use — the first claim burns it
//   • unclaimed shares expire at SHARE_TTL_MS
//   • the relay only ferries genuine planShare v2 payloads (no pastebin,
//     no grades — even from a hostile client the browser code never is)
//   • per-IP budgets make scanning the code space hopeless
import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import {
  createMemoryShareBox, randomCode, normalizeCode, validateSharePayload,
  CODE_ALPHABET, CODE_LENGTH, SHARE_TTL_MS, MAX_PAYLOAD_CHARS,
} from "../../mcp-server/src/shareBox.js";
import { encodePlan } from "../../src/core/planShare.js";

const plan = {
  entSem: "fall", entYear: 2026, gradSem: "spring", gradYear: 2030,
  placements: { CS2500: "fall2026", CS2510: "spr2027" },
  major: "2026/khoury/computer_science_bscs_(boston)",
  planName: "share-box test",
};

// Hand-rolled compact payload — what a hostile client could send,
// bypassing encodePlan's allowlist entirely.
const rawPayload = (obj) => gzipSync(JSON.stringify(obj)).toString("base64url");

test("shareBox › code shape: crypto-random, alphabet-only, fixed length", () => {
  const codes = new Set();
  for (let i = 0; i < 50; i++) {
    const code = randomCode();
    assert.equal(code.length, CODE_LENGTH);
    for (const c of code) assert.ok(CODE_ALPHABET.includes(c), `unexpected char ${c}`);
    codes.add(code);
  }
  assert.ok(codes.size > 45, "codes should be effectively unique");
});

test("shareBox › normalizeCode uppercases and strips separators", () => {
  assert.equal(normalizeCode(" m4p-le7 "), "M4PLE7");
  assert.equal(normalizeCode(null), "");
});

test("shareBox › validate accepts exactly what the client produces", async () => {
  const ok = await validateSharePayload(await encodePlan(plan));
  assert.deepEqual(ok, { ok: true });
});

test("shareBox › validate refuses everything else", async () => {
  // not a string / empty / oversized / not base64url
  assert.equal((await validateSharePayload(undefined)).ok, false);
  assert.equal((await validateSharePayload("")).ok, false);
  assert.equal((await validateSharePayload("A".repeat(MAX_PAYLOAD_CHARS + 1))).reason, "too_large");
  assert.equal((await validateSharePayload("not/base64url+chars=")).ok, false);
  // gzip of arbitrary JSON (a would-be pastebin) — no v2 marker
  assert.equal((await validateSharePayload(rawPayload({ note: "free storage!" }))).ok, false);
  // v1-shaped payload: decodePlan passes it through untouched, so the
  // relay refuses it — only the v2 compact format rides
  assert.equal((await validateSharePayload(rawPayload({ version: 1, placements: {} }))).ok, false);
  // crafted v2 smuggling a grades key past the client allowlist
  const smuggled = rawPayload({ v: 2, p: { CS2500: "fall2026" }, grades: { CS2500: "F" } });
  assert.equal((await validateSharePayload(smuggled)).ok, false);
});

test("shareBox › park, claim once, and the code burns", async () => {
  const box = createMemoryShareBox();
  const payload = await encodePlan(plan);

  const created = await box.create(payload, "1.2.3.4");
  assert.equal(created.ok, true);
  assert.equal(created.code.length, CODE_LENGTH);
  assert.equal(created.expiresInSeconds, SHARE_TTL_MS / 1000);

  // sloppy human entry still redeems
  const claimed = await box.claim(` ${created.code.toLowerCase()} `, "5.6.7.8");
  assert.equal(claimed.ok, true);
  assert.equal(claimed.payload, payload);

  // one use: the second claim finds nothing
  const again = await box.claim(created.code, "9.9.9.9");
  assert.deepEqual(again, { ok: false, reason: "not_found" });
});

test("shareBox › unknown code is not_found", async () => {
  const box = createMemoryShareBox();
  assert.deepEqual(await box.claim("XXXXXX", "1.1.1.1"), { ok: false, reason: "not_found" });
});

test("shareBox › unclaimed shares expire at the TTL", async () => {
  let t = 1_000_000;
  const box = createMemoryShareBox({ now: () => t });
  const { code } = await box.create(await encodePlan(plan), "1.2.3.4");

  t += SHARE_TTL_MS - 1_000; // still inside the window
  assert.equal((await box.claim(code, "5.6.7.8")).ok, true);

  const { code: code2 } = await box.create(await encodePlan(plan), "1.2.3.4");
  t += SHARE_TTL_MS + 1_000; // past the window
  assert.deepEqual(await box.claim(code2, "5.6.7.8"), { ok: false, reason: "not_found" });
});

test("shareBox › per-IP budgets cut off scanners, not other users", async () => {
  const box = createMemoryShareBox();
  const payload = await encodePlan(plan);

  for (let i = 0; i < 10; i++) {
    assert.equal((await box.create(payload, "6.6.6.6")).ok, true, `create #${i + 1}`);
  }
  assert.deepEqual(await box.create(payload, "6.6.6.6"), { ok: false, reason: "rate_limited" });
  // an unrelated IP is unaffected
  assert.equal((await box.create(payload, "7.7.7.7")).ok, true);

  for (let i = 0; i < 30; i++) await box.claim("AAAAAA", "6.6.6.6");
  assert.deepEqual(await box.claim("AAAAAA", "6.6.6.6"), { ok: false, reason: "rate_limited" });
});
