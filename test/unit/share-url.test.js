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
import { buildCodeUrl, getHashCodeParam } from "../../src/core/planShare.js";
import { CODE_ALPHABET, CODE_LENGTH } from "../../src/core/shareCrypto.js";
import { generateQr } from "../../src/core/qrEncode.js";

const stub = ({ hash = "", origin = "http://localhost:5173", canonical = "https://numap.app/" } = {}) => {
  globalThis.window = { location: { origin, hash, pathname: "/", search: "" } };
  globalThis.document = {
    querySelector: (sel) => (canonical && sel === 'link[rel="canonical"]' ? { href: canonical } : null),
  };
};

afterEach(() => { delete globalThis.window; delete globalThis.document; });

// ── The origin a scanned QR resolves against ────────────────────────

test("buildCodeUrl › anchors to the canonical origin, not the serving one", () => {
  // The whole point: a preview build served from a pages.dev mirror must
  // still emit a link that resolves on a stranger's phone.
  stub({ origin: "https://nu-map.pages.dev" });
  assert.equal(buildCodeUrl("QK7FMP"), "https://numap.app/#c=QK7FMP");
});

test("buildCodeUrl › falls back to the live origin when no canonical tag exists", () => {
  stub({ origin: "https://example.test", canonical: null });
  assert.equal(buildCodeUrl("QK7FMP"), "https://example.test/#c=QK7FMP");
});

test("buildCodeUrl › survives a malformed canonical href instead of throwing", () => {
  globalThis.window = { location: { origin: "https://example.test", hash: "", pathname: "/", search: "" } };
  globalThis.document = { querySelector: () => ({ href: "not a url" }) };
  assert.equal(buildCodeUrl("QK7FMP"), "https://example.test/#c=QK7FMP");
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
