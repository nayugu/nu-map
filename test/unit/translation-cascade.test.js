// UNIT · src/adapters/translation › CascadeEngine + MyMemory chunking
// Long texts are the hard case: MyMemory hard-rejects >500-char queries,
// so descriptions must be chunked, and one hard item (a 2000-char
// description) must never sink the title it was batched with — the
// cascade falls back per ITEM and resolves unfixable items as "", which
// TranslationContext maps back to the source text without caching.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CascadeEngine } from "../../src/adapters/translation/CascadeEngine.js";
import { chunkForMyMemory, MYMEMORY_MAX_CHARS } from "../../src/adapters/translation/MyMemoryEngine.js";

// Minimal ITranslationEngine fake: `fn` translates one string or throws.
const fake = (name, fn) => ({
  name,
  tier: "api",
  translate: (texts) => Promise.all(texts.map(fn)),
  destroy() {},
});

// ── CascadeEngine ──────────────────────────────────────────────────

test("cascade › falls through per item, not per batch", async () => {
  const primary  = fake("p1", t => {
    if (t.length > 20) throw new Error("too long for primary");
    return `P:${t}`;
  });
  const fallback = fake("f1", t => `F:${t}`);
  const engine = new CascadeEngine([primary, fallback]);

  const long = "x".repeat(30);
  const out = await engine.translate(["title", long], "zh", "en");
  assert.deepEqual(out, ["P:title", `F:${long}`]);
});

test("cascade › item failing every engine resolves as \"\" while others succeed", async () => {
  const a = fake("a1", t => { if (t === "bad") throw new Error("nope"); return `A:${t}`; });
  const b = fake("b1", t => { if (t === "bad") throw new Error("nope"); return `B:${t}`; });
  const engine = new CascadeEngine([a, b]);

  const out = await engine.translate(["ok", "bad", "fine"], "zh", "en");
  assert.deepEqual(out, ["A:ok", "", "A:fine"]);
});

test("cascade › empty engine output counts as failure and falls through", async () => {
  const silent = fake("s1", () => "   ");
  const real   = fake("r1", t => `R:${t}`);
  const engine = new CascadeEngine([silent, real]);

  assert.deepEqual(await engine.translate(["hello"], "zh", "en"), ["R:hello"]);
});

test("cascade › AbortError is rethrown, never swallowed into \"\"", async () => {
  const aborting = fake("ab1", () => {
    const err = new Error("cancelled");
    err.name = "AbortError";
    throw err;
  });
  const never = fake("nv1", () => { throw new Error("must not be reached"); });
  const engine = new CascadeEngine([aborting, never]);

  await assert.rejects(engine.translate(["hello"], "zh", "en"), { name: "AbortError" });
});

test("cascade › onToken streams only successes, empty source passes through", async () => {
  const a = fake("t1", t => { if (t === "bad") throw new Error("nope"); return `A:${t}`; });
  const engine = new CascadeEngine([a]);

  const snapshots = [];
  const out = await engine.translate(["ok", "bad", ""], "zh", "en", s => snapshots.push(s));
  assert.deepEqual(out, ["A:ok", "", ""]);
  // Every streamed snapshot leaves failed/pending slots undefined.
  assert.ok(snapshots.length > 0);
  for (const s of snapshots) assert.notEqual(s[1], "");
  assert.deepEqual(snapshots.at(-1)[0], "A:ok");
});

test("cascade › \"google\" is benched after 3 consecutive failures, and a success resets the count", async () => {
  let googleCalls = 0;
  let googleMode  = "fail";
  const google = fake("google", t => {
    googleCalls++;
    if (googleMode === "fail") throw new Error("down");
    return `G:${t}`;
  });
  const backup = fake("bk1", t => `M:${t}`);
  const engine = new CascadeEngine([google, backup]);

  // Two failures + one success: counter must reset, google stays live.
  await engine.translate(["a"], "zh", "en");
  await engine.translate(["b"], "zh", "en");
  googleMode = "ok";
  assert.deepEqual(await engine.translate(["c"], "zh", "en"), ["G:c"]);

  // Now three consecutive failures bench it for the session…
  googleMode = "fail";
  for (const t of ["d", "e", "f"]) await engine.translate([t], "zh", "en");
  const before = googleCalls;
  // …so this call must not touch google at all.
  assert.deepEqual(await engine.translate(["g"], "zh", "en"), ["M:g"]);
  assert.equal(googleCalls, before);
});

// ── chunkForMyMemory ───────────────────────────────────────────────

test("chunk › short text passes through untouched", () => {
  assert.deepEqual(chunkForMyMemory("Hello world."), ["Hello world."]);
});

test("chunk › every chunk respects the 500-char cap and no words are lost", () => {
  const sentence = "Introduces the fundamental concepts of algorithms and data structures. ";
  const text = sentence.repeat(40).trim(); // ~2880 chars
  const chunks = chunkForMyMemory(text);

  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    assert.ok(c.length <= MYMEMORY_MAX_CHARS, `chunk too long: ${c.length}`);
    assert.ok(c.length > 0);
  }
  assert.deepEqual(chunks.join(" ").split(/\s+/), text.split(/\s+/));
});

test("chunk › prefers a sentence boundary in the back half of the window", () => {
  // ~330-char first sentence (past the 250-char midpoint of the window),
  // then enough terminator-free filler to force a split.
  const first  = `This opening sentence ${"waffles on and on ".repeat(17).trim()} and finally ends.`;
  const filler = " word".repeat(120).trim();
  const chunks = chunkForMyMemory(`${first} ${filler}`);
  assert.equal(chunks[0], first);
});

test("chunk › unbroken text (no spaces) falls back to hard cuts", () => {
  const text = "x".repeat(1234);
  const chunks = chunkForMyMemory(text);
  for (const c of chunks) assert.ok(c.length <= MYMEMORY_MAX_CHARS);
  assert.equal(chunks.join(""), text);
});
