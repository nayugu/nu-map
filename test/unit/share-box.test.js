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

test("shareBox › concurrency cap: an IP holds at most 5 live codes, slots free on claim", async () => {
  let t = 1_000_000;
  const box = createMemoryShareBox({ now: () => t });
  const payload = await encodePlan(plan);

  const codes = [];
  for (let i = 0; i < 5; i++) {
    const r = await box.create(payload, "6.6.6.6");
    assert.equal(r.ok, true, `create #${i + 1}`);
    codes.push(r.code);
  }
  const capped = await box.create(payload, "6.6.6.6");
  assert.equal(capped.reason, "too_many_live");
  // the countdown points at the oldest code's expiry
  assert.ok(capped.retryAfterSeconds > 0 && capped.retryAfterSeconds <= SHARE_TTL_MS / 1000);

  // a claim frees the slot immediately — sequential sharing is unlimited
  await box.claim(codes[0], "9.9.9.9");
  assert.equal((await box.create(payload, "6.6.6.6")).ok, true);
});

test("shareBox › token bucket: burst then trickle, with a retry countdown", async () => {
  let t = 1_000_000;
  const box = createMemoryShareBox({ now: () => t });
  const payload = await encodePlan(plan);

  // Drain the 10-token burst (claim each code so the concurrency cap
  // never interferes — this test is about rate only).
  for (let i = 0; i < 10; i++) {
    const r = await box.create(payload, "6.6.6.6");
    assert.equal(r.ok, true, `create #${i + 1}`);
    await box.claim(r.code, "9.9.9.9");
  }
  const limited = await box.create(payload, "6.6.6.6");
  assert.equal(limited.reason, "rate_limited");
  assert.ok(limited.retryAfterSeconds >= 1 && limited.retryAfterSeconds <= 60);

  // an unrelated IP is unaffected
  assert.equal((await box.create(payload, "7.7.7.7")).ok, true);

  // a minute later one token has trickled back
  t += 61_000;
  assert.equal((await box.create(payload, "6.6.6.6")).ok, true);
});

test("shareBox › canceling your own code refunds the budget", async () => {
  let t = 1_000_000;
  const box = createMemoryShareBox({ now: () => t });
  const payload = await encodePlan(plan);

  // 40 mint-then-cancel cycles from one IP — far past both budgets.
  // Self-cancel is a no-op on the world, so it never rate-limits.
  for (let i = 0; i < 40; i++) {
    const r = await box.create(payload, "6.6.6.6");
    assert.equal(r.ok, true, `create in cycle ${i + 1}`);
    const c = await box.claim(r.code, "6.6.6.6");
    assert.equal(c.ok, true, `cancel in cycle ${i + 1}`);
  }
});

test("shareBox › claim budget cuts off scanners and recovers by trickle", async () => {
  let t = 1_000_000;
  const box = createMemoryShareBox({ now: () => t });

  for (let i = 0; i < 30; i++) {
    assert.equal((await box.claim("AAAAAA", "6.6.6.6")).reason, "not_found", `claim #${i + 1}`);
  }
  const limited = await box.claim("AAAAAA", "6.6.6.6");
  assert.equal(limited.reason, "rate_limited");
  assert.ok(limited.retryAfterSeconds >= 1 && limited.retryAfterSeconds <= 20);

  t += 21_000; // one claim token trickles back
  assert.equal((await box.claim("AAAAAA", "6.6.6.6")).reason, "not_found");
});
