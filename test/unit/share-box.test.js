// Share-by-code relay — shareBox.js (used by the Node dev server and,
// via the same helpers, the worker's ShareBoxDO).
//
// The properties pinned here are the security model:
//   • a share is one use — the first claim burns it
//   • unclaimed shares expire at SHARE_TTL_MS
//   • per-IP budgets make scanning the id space hopeless
//   • the relay is handed an id and CIPHERTEXT, never a code, so it
//     cannot read a plan (see src/core/shareCrypto.js)
//
// What is deliberately NO LONGER pinned: server-side content validation.
// Encrypted payloads are opaque, so the relay can no longer confirm a v2
// plan nor reject a hostile client smuggling grades. That invariant lives
// entirely in the client allowlist now and is pinned by
// test/unit/plan-share-privacy.test.js; what bounds abuse here is size,
// TTL, and the budgets, all still tested below.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMemoryShareBox, validateSharePayload, validateShareId,
  SHARE_TTL_MS, MAX_PAYLOAD_CHARS,
} from "../../mcp-server/src/shareBox.js";
import {
  randomCode, normalizeCode, deriveShareId, encryptForCode, decryptWithCode,
  CODE_ALPHABET, CODE_LENGTH,
} from "../../src/core/shareCrypto.js";
import { encodePlan } from "../../src/core/planShare.js";

/**
 * A syntactically valid id and payload WITHOUT paying for a key
 * derivation. The tests below exercise the relay's budgets, caps, and
 * burn semantics — the crypto is covered by share-crypto.test.js and by
 * the sealed() cases above, and 100+ real derivations would make this
 * suite take half a minute.
 */
let idSeq = 0;
const fakeId = () => (++idSeq).toString(16).padStart(32, "0");
const fakeBlob = () => "ciphertext-" + idSeq;

/** What a sender actually uploads: an id and ciphertext, from one code. */
const sealed = async (obj = plan) => {
  const code = randomCode();
  const { id, blob } = await encryptForCode(code, await encodePlan(obj));
  return { code, id, blob };
};

const plan = {
  entSem: "fall", entYear: 2026, gradSem: "spring", gradYear: 2030,
  placements: { CS2500: "fall2026", CS2510: "spr2027" },
  major: "2026/khoury/computer_science_bscs_(boston)",
  planName: "share-box test",
};

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

test("shareBox › validate accepts the ciphertext a client produces", async () => {
  const { blob } = await sealed();
  assert.deepEqual(validateSharePayload(blob), { ok: true });
});

test("shareBox › validate is shape-only, and says so by accepting opaque bytes", () => {
  assert.equal(validateSharePayload(undefined).ok, false);
  assert.equal(validateSharePayload("").ok, false);
  assert.equal(validateSharePayload("A".repeat(MAX_PAYLOAD_CHARS + 1)).reason, "too_large");
  assert.equal(validateSharePayload("not/base64url+chars=").ok, false);
  // The honest consequence of encryption: arbitrary base64url within the
  // size cap IS accepted, because it is indistinguishable from a sealed
  // plan. Size, TTL, and the per-IP budgets are what bound the abuse.
  assert.deepEqual(validateSharePayload("free-storage-attempt"), { ok: true });
});

test("shareBox › ids must be exactly the KDF's hex output", async () => {
  assert.equal(validateShareId(await deriveShareId(randomCode())), true);
  assert.equal(validateShareId("XXXX"), false);
  assert.equal(validateShareId("g".repeat(32)), false);      // not hex
  assert.equal(validateShareId("a".repeat(31)), false);      // too short
  assert.equal(validateShareId("a".repeat(33)), false);      // too long
  assert.equal(validateShareId(undefined), false);
});

test("shareBox › the relay never receives the code, and cannot derive it", async () => {
  const { code, id, blob } = await sealed();
  // Everything the server is handed:
  assert.ok(!id.includes(code), "the id must not contain the code");
  assert.ok(!blob.includes(code), "the ciphertext must not contain the code");
  // And the plan is not readable from what it holds.
  assert.ok(!blob.includes("CS2500"), "placements must not be legible in the payload");
  // Only the code opens it.
  assert.equal(await decryptWithCode(code, blob), await encodePlan(plan));
  await assert.rejects(() => decryptWithCode(randomCode(), blob), /bad_payload/);
});

test("shareBox › park, claim once, and the share burns", async () => {
  const box = createMemoryShareBox();
  const { code, id, blob } = await sealed();

  const created = await box.create(id, blob, "1.2.3.4");
  assert.equal(created.ok, true);
  assert.equal(created.code, undefined, "the server must not mint or echo a code");
  assert.equal(created.expiresInSeconds, SHARE_TTL_MS / 1000);

  // The receiver types the code; sloppy entry derives the same id.
  const claimed = await box.claim(await deriveShareId(` ${code.toLowerCase()} `), "5.6.7.8");
  assert.equal(claimed.ok, true);
  assert.equal(await decryptWithCode(code, claimed.payload), await encodePlan(plan));

  // one use: the second claim finds nothing
  assert.deepEqual(await box.claim(id, "9.9.9.9"), { ok: false, reason: "not_found" });
});

test("shareBox › unknown or malformed id is not_found", async () => {
  const box = createMemoryShareBox();
  assert.deepEqual(await box.claim(await deriveShareId("XXXXXX"), "1.1.1.1"),
    { ok: false, reason: "not_found" });
  assert.deepEqual(await box.claim("nonsense", "1.1.1.1"), { ok: false, reason: "not_found" });
});

test("shareBox › a duplicate id is refused, never overwritten", async () => {
  const box = createMemoryShareBox();
  const { id, blob } = await sealed();
  assert.equal((await box.create(id, blob, "1.2.3.4")).ok, true);
  const second = await box.create(id, "different-ciphertext", "9.9.9.9");
  assert.deepEqual(second, { ok: false, reason: "collision" });
  // the incumbent survives intact
  assert.equal((await box.claim(id, "1.2.3.4")).payload, blob);
});

test("shareBox › unclaimed shares expire at the TTL", async () => {
  let t = 1_000_000;
  const box = createMemoryShareBox({ now: () => t });
  const a = await sealed();
  await box.create(a.id, a.blob, "1.2.3.4");

  t += SHARE_TTL_MS - 1_000; // still inside the window
  assert.equal((await box.claim(a.id, "5.6.7.8")).ok, true);

  const b = await sealed();
  await box.create(b.id, b.blob, "1.2.3.4");
  t += SHARE_TTL_MS + 1_000; // past the window
  assert.deepEqual(await box.claim(b.id, "5.6.7.8"), { ok: false, reason: "not_found" });
});

test("shareBox › concurrency cap: an IP holds at most 25 live shares, slots free on claim", async () => {
  let t = 1_000_000;
  const box = createMemoryShareBox({ now: () => t });
  const ids = [];
  for (let i = 0; i < 25; i++) {
    const id = fakeId();
    assert.equal((await box.create(id, fakeBlob(), "6.6.6.6")).ok, true, `create #${i + 1}`);
    ids.push(id);
  }
  const capped = await box.create(fakeId(), fakeBlob(), "6.6.6.6");
  assert.equal(capped.reason, "too_many_live");
  // the countdown points at the oldest share's expiry
  assert.ok(capped.retryAfterSeconds > 0 && capped.retryAfterSeconds <= SHARE_TTL_MS / 1000);

  // a claim frees the slot immediately — sequential sharing is unlimited
  await box.claim(ids[0], "9.9.9.9");
  assert.equal((await box.create(fakeId(), fakeBlob(), "6.6.6.6")).ok, true);
});

test("shareBox › token bucket: burst then trickle, with a retry countdown", async () => {
  let t = 1_000_000;
  const box = createMemoryShareBox({ now: () => t });
  // Drain the 30-token burst (claim each share so the concurrency cap
  // never interferes — this test is about rate only).
  for (let i = 0; i < 30; i++) {
    const id = fakeId();
    assert.equal((await box.create(id, fakeBlob(), "6.6.6.6")).ok, true, `create #${i + 1}`);
    await box.claim(id, "9.9.9.9");
  }
  const limited = await box.create(fakeId(), fakeBlob(), "6.6.6.6");
  assert.equal(limited.reason, "rate_limited");
  assert.ok(limited.retryAfterSeconds >= 1 && limited.retryAfterSeconds <= 10);

  // an unrelated IP is unaffected
  assert.equal((await box.create(fakeId(), fakeBlob(), "7.7.7.7")).ok, true);

  // ten seconds later one token has trickled back
  t += 11_000;
  assert.equal((await box.create(fakeId(), fakeBlob(), "6.6.6.6")).ok, true);
});

test("shareBox › canceling your own share refunds the budget", async () => {
  let t = 1_000_000;
  const box = createMemoryShareBox({ now: () => t });

  // 40 mint-then-cancel cycles from one IP — far past both budgets.
  // Self-cancel is a no-op on the world, so it never rate-limits.
  for (let i = 0; i < 40; i++) {
    const id = fakeId();
    assert.equal((await box.create(id, fakeBlob(), "6.6.6.6")).ok, true, `create in cycle ${i + 1}`);
    assert.equal((await box.claim(id, "6.6.6.6")).ok, true, `cancel in cycle ${i + 1}`);
  }
});

test("shareBox › status answers the creator honestly and everyone else with silence", async () => {
  const box = createMemoryShareBox();
  const id = fakeId();
  await box.create(id, fakeBlob(), "6.6.6.6");

  assert.deepEqual(await box.status(id, "6.6.6.6"), { ok: true, live: true });
  // A stranger gets the same answer whether or not the share exists —
  // status can never confirm a guessed id.
  assert.deepEqual(await box.status(id, "9.9.9.9"), { ok: true, live: false });
  assert.deepEqual(await box.status(fakeId(), "9.9.9.9"), { ok: true, live: false });

  await box.claim(id, "9.9.9.9");
  assert.deepEqual(await box.status(id, "6.6.6.6"), { ok: true, live: false });
});

test("shareBox › the burn interrupts a watching sender socket", async () => {
  const box = createMemoryShareBox();
  const id = fakeId();
  await box.create(id, fakeBlob(), "6.6.6.6");

  const fakeWs = {
    sent: [], closed: false, handlers: {},
    send(m) { this.sent.push(String(m)); },
    close() { this.closed = true; },
    on(ev, fn) { this.handlers[ev] = fn; },
  };
  box.watch(id, "6.6.6.6", fakeWs);

  // keepalive round-trips through the watcher
  fakeWs.handlers.message("ping");
  assert.deepEqual(fakeWs.sent, ["pong"]);

  await box.claim(id, "9.9.9.9");
  assert.deepEqual(fakeWs.sent, ["pong", "claimed"]);
  assert.equal(fakeWs.closed, true);

  // a stranger's watch attempt is hung up on without learning anything
  const spyWs = { sent: [], closed: false, handlers: {},
    send(m) { this.sent.push(String(m)); }, close() { this.closed = true; }, on() {} };
  const id2 = fakeId();
  await box.create(id2, fakeBlob(), "6.6.6.6");
  box.watch(id2, "9.9.9.9", spyWs);
  assert.equal(spyWs.closed, true);
  assert.deepEqual(spyWs.sent, []);
});

test("shareBox › claim budget cuts off scanners and recovers by trickle", async () => {
  let t = 1_000_000;
  const box = createMemoryShareBox({ now: () => t });

  const guess = "a".repeat(32);
  for (let i = 0; i < 100; i++) {
    assert.equal((await box.claim(guess, "6.6.6.6")).reason, "not_found", `claim #${i + 1}`);
  }
  const limited = await box.claim(guess, "6.6.6.6");
  assert.equal(limited.reason, "rate_limited");
  assert.ok(limited.retryAfterSeconds >= 1 && limited.retryAfterSeconds <= 5);

  t += 6_000; // one claim token trickles back
  assert.equal((await box.claim(guess, "6.6.6.6")).reason, "not_found");
});
