// UNIT · src/core/planShare.js #c= links + src/core/qrEncode.js
//
// The QR carries a share-code LINK, not a plan. Two things have to hold for
// that to be safe:
//
//   1. Only a code this app could have minted survives getHashCodeParam.
//      Everything that gets past it is handed to a 300k-iteration PBKDF2,
//      so junk has to die here, not there.
//   2. The link stays short enough that the QR lands in the sparse High-EC
//      regime. That is not cosmetic: QrArt only draws dots and the centre
//      logo when ecl === "H", because at lower EC the dropped module area
//      stops scanners reading it. If a link ever grew past that budget the
//      rendering would silently change character.
//
// Runs offline; window/document are stubbed per-test since planShare only
// touches them inside the two functions under test.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildCodeUrl, getHashCodeParam, isLoopbackHost } from "../../src/core/planShare.js";
import { CODE_ALPHABET, CODE_LENGTH } from "../../src/core/shareCrypto.js";
import { generateQr } from "../../src/core/qrEncode.js";

const stub = ({ hash = "", origin = "https://numap.app", hostname = "numap.app", canonical = "https://numap.app/" } = {}) => {
  globalThis.window = { location: { origin, hostname, hash, pathname: "/", search: "" } };
  globalThis.document = {
    querySelector: (sel) => (canonical && sel === 'link[rel="canonical"]' ? { href: canonical } : null),
  };
};

afterEach(() => { delete globalThis.window; delete globalThis.document; });

// ── The loopback rule ───────────────────────────────────────────────
// Shared by buildCodeUrl and the relay's dev default (shareRelay.js), so
// it is tested once, here, rather than twice and differently.

test("isLoopbackHost › catches every form that means 'this device'", () => {
  for (const h of [
    "localhost", "LOCALHOST", "localhost.", "app.localhost", "a.b.localhost",
    "127.0.0.1", "127.1", "127.0.0.53", "127.255.255.255",
    "0.0.0.0", "::1", "[::1]", "::", "[::]",
  ]) {
    assert.equal(isLoopbackHost(h), true, `${h} should be loopback`);
  }
});

test("isLoopbackHost › does not over-reach onto reachable hosts", () => {
  // These all resolve for someone else, so a QR naming them is fine.
  // 127x.dev and localhost.evil.com are the classic near-miss shapes.
  for (const h of [
    "numap.app", "nu-map.pages.dev", "nayugu.github.io",
    "192.168.1.42", "10.0.0.7", "172.16.3.9",
    "127x.dev", "1270.0.0.1", "localhost.evil.com", "notlocalhost",
    "mylocalhost", "example.com",
  ]) {
    assert.equal(isLoopbackHost(h), false, `${h} should NOT be loopback`);
  }
});

test("isLoopbackHost › treats junk as not-loopback rather than throwing", () => {
  for (const h of [undefined, null, "", 42, {}]) {
    assert.doesNotThrow(() => isLoopbackHost(h));
  }
  assert.equal(isLoopbackHost(undefined), false);
});

// ── The origin a scanned QR resolves against ────────────────────────

test("buildCodeUrl › keeps the serving origin, because that origin's relay holds the code", () => {
  // A preview deploy is configured against its own relay. Rewriting its
  // links to numap.app would hand the recipient an app talking to a
  // different relay, which cannot have the code.
  for (const origin of ["https://numap.app", "https://nu-map.pages.dev", "https://nayugu.github.io", "http://192.168.1.42:5173"]) {
    stub({ origin, hostname: new URL(origin).hostname });
    assert.equal(buildCodeUrl("QK7FMP"), `${origin}/#c=QK7FMP`);
  }
});

test("buildCodeUrl › never puts a loopback host in a QR", () => {
  // "localhost" on the scanning phone means the phone. A loopback QR does
  // not fail informatively — it resolves to nothing at all.
  for (const [origin, hostname] of [
    ["http://localhost:5173", "localhost"],
    ["http://127.0.0.1:5173", "127.0.0.1"],
    ["http://127.1.2.3:5173", "127.1.2.3"],
    ["http://0.0.0.0:5173", "0.0.0.0"],
    ["http://[::1]:5173", "[::1]"],
    ["http://app.localhost:5173", "app.localhost"],
    ["http://LOCALHOST:5173", "LOCALHOST"],
  ]) {
    stub({ origin, hostname });
    assert.equal(buildCodeUrl("QK7FMP"), "https://numap.app/#c=QK7FMP", `${hostname} leaked into the QR`);
  }
});

test("buildCodeUrl › a loopback origin with no canonical tag degrades, never throws", () => {
  stub({ origin: "http://localhost:5173", hostname: "localhost", canonical: null });
  assert.equal(buildCodeUrl("QK7FMP"), "http://localhost:5173/#c=QK7FMP");
});

test("buildCodeUrl › survives a malformed canonical href instead of throwing", () => {
  globalThis.window = { location: { origin: "http://localhost:5173", hostname: "localhost", hash: "", pathname: "/", search: "" } };
  globalThis.document = { querySelector: () => ({ href: "not a url" }) };
  assert.equal(buildCodeUrl("QK7FMP"), "http://localhost:5173/#c=QK7FMP");
});

// ── Round trip ──────────────────────────────────────────────────────

test("getHashCodeParam › round-trips every code the alphabet can mint", () => {
  for (const ch of CODE_ALPHABET) {
    const code = ch.repeat(CODE_LENGTH);
    stub();
    const url = buildCodeUrl(code);
    stub({ hash: new URL(url).hash });
    assert.equal(getHashCodeParam(), code, `round trip failed for ${code}`);
  }
});

test("getHashCodeParam › normalises case, so a hand-typed link still opens", () => {
  stub({ hash: "#c=qk7fmp" });
  assert.equal(getHashCodeParam(), "QK7FMP");
});

// ── What must NOT get through ───────────────────────────────────────

test("getHashCodeParam › rejects wrong lengths", () => {
  for (const hash of ["#c=", "#c=QK7FM", "#c=QK7FMPQ", "#c=QK7FMPQK7FMP"]) {
    stub({ hash });
    assert.equal(getHashCodeParam(), null, `${hash} should not parse`);
  }
});

test("getHashCodeParam › rejects the characters the alphabet deliberately omits", () => {
  // 0/O and 1/I/L are excluded because the code gets read aloud. A code
  // containing one is a mistype, and must miss rather than half-match.
  for (const ch of ["0", "O", "1", "I", "L"]) {
    assert.equal(CODE_ALPHABET.includes(ch), false, `${ch} should not be in the alphabet`);
    stub({ hash: `#c=${ch}K7FMP` });
    assert.equal(getHashCodeParam(), null, `${ch} should not parse`);
  }
});

test("getHashCodeParam › rejects punctuation, whitespace and a query smuggled in", () => {
  for (const hash of ["#c=QK7F-P", "#c=QK7F P", "#c=QK7FM%50", "#c=../../x", "#c=QK7FMP&x=1"]) {
    stub({ hash });
    assert.equal(getHashCodeParam(), null, `${hash} should not parse`);
  }
});

test("getHashCodeParam › ignores other hashes entirely", () => {
  for (const hash of ["", "#", "#plan=eNqrVkrLz1eyUlAqSy0qzszPU9JRykjNyclXsqpWKkotLs0pUbKKrQUA", "#code=QK7FMP", "#C=QK7FMP"]) {
    stub({ hash });
    assert.equal(getHashCodeParam(), null, `${hash} should not parse as a code`);
  }
});

// ── The QR budget ───────────────────────────────────────────────────

test("qrEncode › a code link always lands on a sparse, high-EC code", () => {
  stub();
  for (const ch of CODE_ALPHABET) {
    const qr = generateQr(buildCodeUrl(ch.repeat(CODE_LENGTH)));
    assert.ok(qr, "a code link must always encode");
    assert.equal(qr.ecl, "H", "dots + centre logo require the High-EC budget");
    // Measured: a 27-char link is version 4, size 33. Anything bigger means
    // the link grew and the 136px preview is losing module resolution.
    assert.ok(qr.size <= 33, `QR grew to size ${qr.size}`);
  }
});

test("qrEncode › the matrix is square, boolean, and has all three finders", () => {
  stub();
  const { size, modules } = generateQr(buildCodeUrl("QK7FMP"));
  assert.equal(modules.length, size);
  for (const row of modules) {
    assert.equal(row.length, size);
    for (const cell of row) assert.equal(typeof cell, "boolean");
  }
  // Finder patterns: dark centre pip at each of the three corners.
  assert.equal(modules[3][3], true);
  assert.equal(modules[3][size - 4], true);
  assert.equal(modules[size - 4][3], true);
});
