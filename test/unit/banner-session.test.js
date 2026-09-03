// UNIT · scripts/lib/banner-session.js › surviving a lost connection
//
// The per-CRN passes are ~7,000 requests per term and ~4 hours for a full
// backfill. Over that window a dropped connection is the NORMAL case, and the
// old behaviour was to give up after four attempts, let the caller count it as
// a section failure, and abandon the whole term after 25 in a row — so a
// ten-minute outage cost a 55-minute term.
//
// The property that matters: a NETWORK error waits, a BANNER error does not.
// Waiting on a 404 would hang the run forever; giving up on a socket error
// throws away work already paid for.

import test        from "node:test";
import assert      from "node:assert/strict";

import { isNetworkError, fetchThroughOutage } from "../../scripts/lib/banner-session.js";

// ── Telling the two apart ───────────────────────────────────────────

test("the connection dropping is recognised, whatever shape Node reports it in", () => {
  // `fetch` wraps the real reason in `cause.code`; older paths put it on the
  // error itself; undici has its own UND_ERR_* family.
  for (const code of ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN",
                      "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "ENETDOWN",
                      "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"]) {
    assert.equal(isNetworkError({ cause: { code } }), true, `cause.code ${code}`);
    assert.equal(isNetworkError({ code }), true, `err.code ${code}`);
  }
  // The message Node actually produces when the network is down.
  assert.equal(isNetworkError(new TypeError("fetch failed")), true);
  assert.equal(isNetworkError({ message: "socket hang up" }), true);
});

test("Banner answering badly is NOT a network error", () => {
  // Waiting cannot fix these, and retrying forever would hang an unattended
  // run rather than fail it — the worse outcome, because nothing reports.
  assert.equal(isNetworkError(new Error("getTerms HTTP 404")), false);
  assert.equal(isNetworkError(new Error("searchResults HTTP 500")), false);
  assert.equal(isNetworkError(new SyntaxError("Unexpected token < in JSON")), false);
  assert.equal(isNetworkError({ cause: { code: "ERR_INVALID_URL" } }), false);
});

test("junk is not mistaken for an outage", () => {
  for (const bad of [null, undefined, {}, "", 0, { cause: null }]) {
    assert.equal(isNetworkError(bad), false, `input ${JSON.stringify(bad)}`);
  }
});

// ── The wait loop ───────────────────────────────────────────────────

test("a network error is retried until it succeeds", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls < 3) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    return { ok: true, marker: "recovered" };
  };
  try {
    // Backoff starts at 1s, so three attempts is ~2s of real waiting. Kept
    // short deliberately: a fake timer would test the mock, not the loop.
    const res = await fetchThroughOutage("http://example.invalid", {}, () => {});
    assert.equal(res.marker, "recovered");
    assert.equal(calls, 3, "it must retry the SAME request, not skip it");
  } finally { globalThis.fetch = original; }
});

test("a Banner error is thrown immediately, not waited on", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new SyntaxError("bad json"); };
  try {
    await assert.rejects(
      () => fetchThroughOutage("http://example.invalid", {}, () => {}),
      /bad json/);
    assert.equal(calls, 1, "a non-network error must not be retried");
  } finally { globalThis.fetch = original; }
});

test("the outage is announced once, not once per attempt", async () => {
  // An hour offline must not produce an hour of log; the caller's progress
  // output would be unreadable and the real failure invisible in it.
  const original = globalThis.fetch;
  let calls = 0;
  const said = [];
  globalThis.fetch = async () => {
    calls += 1;
    if (calls < 4) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    return { ok: true };
  };
  try {
    await fetchThroughOutage("http://example.invalid", {}, (m) => said.push(m));
    assert.equal(said.length, 1, `announced ${said.length} times over 3 failures`);
    assert.match(said[0], /connection lost/);
    assert.match(said[0], /ENOTFOUND/, "the reason must be in the message");
  } finally { globalThis.fetch = original; }
});

test("a successful call never waits or announces", async () => {
  const original = globalThis.fetch;
  const said = [];
  globalThis.fetch = async () => ({ ok: true });
  try {
    const t0 = Date.now();
    await fetchThroughOutage("http://example.invalid", {}, (m) => said.push(m));
    assert.ok(Date.now() - t0 < 500, "the happy path must not sleep");
    assert.deepEqual(said, []);
  } finally { globalThis.fetch = original; }
});
