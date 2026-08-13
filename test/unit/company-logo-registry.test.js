// UNIT · src/core/companyLogoRegistry.js › curated logos
//
// A pinned logo is a person's decision, and the whole mechanism is a filename:
// drop `imageworks.com.svg` in public/logos/ and that company has a logo. So
// the failure modes are about identity, not pixels. The logo must be found
// for the company it was named after — however that company was typed on the
// work term — and must never be found for a different one. A rule that reads
// a filename is easy to write and easy to get subtly wrong, so these tests
// push junk filenames, near-miss names, lookalike domains and a missing index
// at it.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeCompanyName, normalizeLogoDomain, logoKeyForFile,
  curatedLogoFor, registerCompanyLogos, _resetLogoRegistry, LOGO_DIR,
} from "../../src/core/companyLogoRegistry.js";

// fileURLToPath, not .pathname: the latter is percent-encoded and breaks on a
// checkout whose path contains a space.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Serve an index.json listing these filenames. */
const serveFolder = (...files) => {
  globalThis.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ files }) });
};

beforeEach(() => {
  _resetLogoRegistry();
  globalThis.fetch = () => Promise.resolve({ ok: false, status: 404 });
});

// ── Name folding ──────────────────────────────────────────────────

test("a company name folds to the same identity however it is written", () => {
  const same = [
    "Sony Pictures Imageworks",
    "sony pictures imageworks",
    "  Sony   Pictures Imageworks  ",
    "Sony Pictures Imageworks, Inc.",
    "SONY PICTURES IMAGEWORKS LLC",
    "sony-pictures-imageworks",          // ← the filename form
  ];
  assert.deepEqual([...new Set(same.map(normalizeCompanyName))], ["sony pictures imageworks"]);
});

test("accents, ampersands and punctuation are noise", () => {
  assert.equal(normalizeCompanyName("Nestlé"), "nestle");
  assert.equal(normalizeCompanyName("Procter & Gamble"), normalizeCompanyName("Procter and Gamble"));
  assert.equal(normalizeCompanyName("Booz | Allen"), "booz allen");
});

test("a legal suffix is only stripped when it is a suffix", () => {
  assert.equal(normalizeCompanyName("Toast, Inc."), "toast");
  // These are the whole name, not decoration.
  assert.equal(normalizeCompanyName("Inc"), "inc");
  assert.equal(normalizeCompanyName("Corp"), "corp");
  assert.equal(normalizeCompanyName("Group Nine"), "group nine");
});

test("distinct companies do not collide", () => {
  const names = ["Apple", "Apple Bank", "Applied Materials", "Sony", "Sony Pictures",
                 "Sony Pictures Imageworks", "GE", "GE Healthcare"];
  assert.equal(new Set(names.map(normalizeCompanyName)).size, names.length);
});

test("empty and junk names fold to nothing", () => {
  for (const junk of ["", "   ", null, undefined, ",,,", "!!!"])
    assert.equal(normalizeCompanyName(junk), "", JSON.stringify(junk));
});

// ── Filename → match key ──────────────────────────────────────────

test("a dotted filename is a domain, a plain one is a company name", () => {
  assert.deepEqual(logoKeyForFile("apple.com.svg"),   { kind: "domain", key: "apple.com" });
  assert.deepEqual(logoKeyForFile("www.apple.com.png"), { kind: "domain", key: "apple.com" });
  assert.deepEqual(logoKeyForFile("acme.co.uk.webp"), { kind: "domain", key: "acme.co.uk" });
  assert.deepEqual(logoKeyForFile("sony-pictures-imageworks.png"),
    { kind: "name", key: "sony pictures imageworks" });
});

test("a filename that names nobody is rejected, not guessed at", () => {
  for (const junk of [".png", "", "   ", ".DS_Store", null, undefined])
    assert.equal(logoKeyForFile(junk), null, JSON.stringify(junk));
});

test("a filename that is neither a domain nor kebab-case is refused", () => {
  // The screenshot case, which is the one that actually happens: dots and
  // spaces everywhere, and nothing that names a company. Reading it as the
  // domain "screenshot 2026-08-11 at 11.23.51 am" is worse than refusing it,
  // because it would silently ship as a logo nothing can ever match.
  for (const f of [
    "Screenshot 2026-08-11 at 11.23.51 AM.png",
    "acme inc..png",
    "Acme Corp.png",
    "acme_logo_FINAL_v2.png",
    "IMG_4821.jpeg",
  ]) assert.equal(logoKeyForFile(f), null, f);
});

test("kebab-case is the convention; case is forgiven, sloppiness is not", () => {
  // Capitals are folded away — a file off a Mac is often "Apple.png" and that
  // is not worth an error. Anything that is not word-hyphen-word is.
  assert.deepEqual(logoKeyForFile("Sony-Pictures-Imageworks.png"), logoKeyForFile("sony-pictures-imageworks.png"));
  assert.equal(logoKeyForFile("sony pictures imageworks.png"), null, "spaces are not the convention");
  assert.equal(logoKeyForFile("sony_pictures.png"), null, "underscores are not the convention");
  assert.equal(logoKeyForFile("-leading.png"), null);
  assert.equal(logoKeyForFile("double--hyphen.png"), null);
});

test("a file's own name matches the company it was named for", () => {
  // The round trip that makes rename-and-drop work at all.
  for (const [file, typed] of [
    ["sony-pictures-imageworks.png", "Sony Pictures Imageworks, Inc."],
    ["toast.svg",                    "Toast, Inc."],
    ["procter-and-gamble.png",       "Procter & Gamble"],
    ["nestle.webp",                  "Nestlé"],
  ]) {
    const hit = logoKeyForFile(file);
    assert.equal(hit.key, normalizeCompanyName(typed), `${file} vs "${typed}"`);
  }
});

// ── Lookup ────────────────────────────────────────────────────────

test("a curated logo is found by domain and by name", async () => {
  serveFolder("apple.com.svg", "sony-pictures-imageworks.png");
  assert.equal(await curatedLogoFor("apple.com", null), `${LOGO_DIR}apple.com.svg`);
  assert.equal(await curatedLogoFor("https://www.apple.com/jobs", null), `${LOGO_DIR}apple.com.svg`);
  assert.equal(await curatedLogoFor(null, "Sony Pictures Imageworks, Inc."),
    `${LOGO_DIR}sony-pictures-imageworks.png`);
});

test("the domain wins over the name when both are pinned", async () => {
  // Two companies can share a name far more easily than a domain, and the
  // plan stores the domain — so it is the stronger identity.
  serveFolder("apple.com.svg", "apple.png");
  assert.equal(await curatedLogoFor("apple.com", "Apple"), `${LOGO_DIR}apple.com.svg`);
});

test("a lookalike domain gets nothing", async () => {
  serveFolder("apple.com.svg");
  for (const d of ["notapple.com", "apple.com.evil.example", "jobs.apple.com", "apple.co"])
    assert.equal(await curatedLogoFor(d, null), null, d);
});

test("a near-miss name gets nothing", async () => {
  serveFolder("sony-pictures-imageworks.png");
  for (const n of ["Sony", "Sony Pictures", "Imageworks", "Sony Pictures Animation"])
    assert.equal(await curatedLogoFor(null, n), null, n);
});

test("an empty company matches nothing at all", async () => {
  serveFolder("apple.com.svg");
  assert.equal(await curatedLogoFor(null, null), null);
  assert.equal(await curatedLogoFor("", ""), null);
});

test("a missing or broken index means no curated logos, not an error", async () => {
  for (const fetchImpl of [
    () => Promise.reject(new Error("offline")),
    () => Promise.resolve({ ok: false, status: 404 }),
    () => Promise.resolve({ ok: true, json: () => Promise.resolve(null) }),
    () => Promise.resolve({ ok: true, json: () => Promise.resolve({ files: "not an array" }) }),
    () => Promise.resolve({ ok: true, json: () => Promise.reject(new Error("bad json")) }),
    () => Promise.resolve({ ok: true, json: () => Promise.resolve({ files: [null, 7, ".png"] }) }),
  ]) {
    _resetLogoRegistry();
    globalThis.fetch = fetchImpl;
    assert.equal(await curatedLogoFor("apple.com", "Apple"), null);
  }
});

test("the index is fetched once, however many companies ask", async () => {
  let calls = 0;
  globalThis.fetch = () => { calls++; return Promise.resolve({ ok: true, json: () => Promise.resolve({ files: [] }) }); };
  await Promise.all(["a.com", "b.com", "c.com"].map(d => curatedLogoFor(d, null)));
  await curatedLogoFor("d.com", null);
  assert.equal(calls, 1);
});

test("runtime registrations win over the folder — the submission seam", async () => {
  serveFolder("apple.com.svg");
  registerCompanyLogos([{ name: "Apple", domains: ["apple.com"], url: "https://cdn.example/fresh.svg" }]);
  assert.equal(await curatedLogoFor("apple.com", null), "https://cdn.example/fresh.svg");
  assert.equal(await curatedLogoFor(null, "Apple"), "https://cdn.example/fresh.svg");
});

// ── The folder actually in the repo ───────────────────────────────

test("every shipped file names exactly one company, and the index lists it", () => {
  const dir = join(ROOT, "public/logos");
  if (!existsSync(dir)) return;                      // an empty folder is valid
  const files = readdirSync(dir).filter(f => /\.(svg|png|jpe?g|webp|avif|gif|ico|bmp)$/i.test(f));
  const claimed = new Map();
  for (const f of files) {
    const hit = logoKeyForFile(f);
    assert.ok(hit, `${f} names no company — rename it to a domain or a company name`);
    const key = `${hit.kind}:${hit.key}`;
    assert.ok(!claimed.has(key), `${f} and ${claimed.get(key)} both claim ${key}`);
    claimed.set(key, f);
  }
  const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
  assert.deepEqual([...index.files].sort(), [...files].sort(),
    "index.json is stale — run `npm run logos`");
});

test("no shipped SVG carries active content", () => {
  const dir = join(ROOT, "public/logos");
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir).filter(f => extname(f) === ".svg")) {
    const text = readFileSync(join(dir, f), "utf8");
    assert.match(text, /<svg[\s>]/i, `${f} is not an SVG`);
    assert.ok(!/<script|javascript:|onload=/i.test(text), `${f} contains active content`);
  }
});
