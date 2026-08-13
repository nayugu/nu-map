// The hand-rolled ZIP reader/writer.
//
// A format implemented by hand is only worth anything if something OTHER than
// its own reader agrees with it, so the load-bearing test here shells out to
// the system `unzip`. A writer and reader that are wrong in the same way would
// round-trip perfectly and produce an archive nobody else can open.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeZip, readZip, crc32 } from "../../src/core/zipFile.js";

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);

test("crc32 › matches the known check value for \"123456789\"", () => {
  // The standard CRC-32 check constant. Getting this wrong makes every archive
  // we write appear corrupt to other tools while our own reader shrugs.
  assert.equal(crc32(enc("123456789")), 0xcbf43926);
});

test("zip › round-trips names, contents and order", async () => {
  const entries = [
    { path: "a.json", data: enc('{"n":1}') },
    { path: "Advisees/Fall 2026/Jane.json", data: enc('{"n":2}') },
    { path: "Templates/Blank.json", data: enc("{}") },
  ];
  const out = await readZip(writeZip(entries));
  assert.deepEqual(out.map(e => e.path), entries.map(e => e.path));
  assert.deepEqual(out.map(e => dec(e.data)), entries.map(e => dec(e.data)));
});

test("zip › non-ASCII paths survive (the UTF-8 flag is not decoration)", async () => {
  const entries = [
    { path: "Advisees/José Ramírez.json", data: enc('{"a":1}') },
    { path: "アドバイジー/学生.json", data: enc('{"b":2}') },
    { path: "المستشارون/طالب.json", data: enc('{"c":3}') },
  ];
  const out = await readZip(writeZip(entries));
  assert.deepEqual(out.map(e => e.path), entries.map(e => e.path));
});

test("zip › an empty entry and an empty archive are both legal", async () => {
  const one = await readZip(writeZip([{ path: "empty.json", data: new Uint8Array(0) }]));
  assert.equal(one.length, 1);
  assert.equal(one[0].data.length, 0);
  assert.deepEqual(await readZip(writeZip([])), []);
});

test("zip › a large realistic archive round-trips intact", async () => {
  // 200 plans is the caseload the format was sized against.
  const entries = Array.from({ length: 200 }, (_, i) => ({
    path: `Advisees/Student ${i}/plan.json`,
    data: enc(JSON.stringify({ version: 1, placements: { ["CS" + i]: "fall2026" }, i })),
  }));
  const out = await readZip(writeZip(entries));
  assert.equal(out.length, 200);
  assert.equal(JSON.parse(dec(out[199].data)).i, 199);
});

// ── Agreement with an independent implementation ──────────────────────

test("zip › the system `unzip` accepts and extracts what we write", { skip: (() => {
  try { execFileSync("unzip", ["-v"], { stdio: "ignore" }); return false; } catch { return "unzip not available"; }
})() }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "numap-zip-"));
  try {
    const archive = join(dir, "lib.zip");
    writeFileSync(archive, writeZip([
      { path: "Advisees/Fall 2026/Jane.json", data: enc('{"plan":"jane"}') },
      { path: "Templates/Blank.json", data: enc('{"plan":"blank"}') },
    ]));
    // -t tests integrity (this is where a bad CRC or size shows up).
    const tested = execFileSync("unzip", ["-t", archive], { encoding: "utf8" });
    assert.match(tested, /No errors detected/);
    execFileSync("unzip", ["-q", archive, "-d", join(dir, "out")]);
    assert.equal(
      readFileSync(join(dir, "out", "Advisees", "Fall 2026", "Jane.json"), "utf8"),
      '{"plan":"jane"}');
    assert.deepEqual(readdirSync(join(dir, "out")).sort(), ["Advisees", "Templates"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("zip › we can read a DEFLATED archive written by the system `zip`", { skip: (() => {
  try { execFileSync("zip", ["-v"], { stdio: "ignore" }); return false; } catch { return "zip not available"; }
})() }, async () => {
  // The realistic path: a user unzips an export, re-zips it in Finder, and
  // hands back a COMPRESSED archive. Our writer never emits deflate, so this
  // case is only exercised by an archive we did not write.
  const dir = mkdtempSync(join(tmpdir(), "numap-zip2-"));
  try {
    const body = JSON.stringify({ version: 1, note: "x".repeat(2000) });
    writeFileSync(join(dir, "plan.json"), body);
    execFileSync("zip", ["-q", "-9", "lib.zip", "plan.json"], { cwd: dir });
    const bytes = new Uint8Array(readFileSync(join(dir, "lib.zip")));
    const out = await readZip(bytes);
    assert.equal(out.length, 1);
    assert.equal(dec(out[0].data), body, "deflated entry must inflate to the original");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── Hostile input ─────────────────────────────────────────────────────

test("zip › junk, truncation and an empty buffer are rejected, not misread", async () => {
  await assert.rejects(() => readZip(new Uint8Array(0)), /not-a-zip/);
  await assert.rejects(() => readZip(enc("this is not a zip file at all")), /not-a-zip/);
  const good = writeZip([{ path: "a.json", data: enc("{}") }]);
  await assert.rejects(() => readZip(good.subarray(0, good.length - 10)), /not-a-zip/);
});

test("zip › a path escaping the archive is refused rather than normalised", async () => {
  for (const bad of ["../escape.json", "a/../../escape.json", "/etc/passwd"]) {
    const z = writeZip([{ path: bad, data: enc("{}") }]);
    await assert.rejects(() => readZip(z), /unsafe-path/, bad);
  }
});

test("zip › explicit directory records are skipped, not read as files", async () => {
  const out = await readZip(writeZip([
    { path: "Advisees/", data: new Uint8Array(0) },
    { path: "Advisees/Jane.json", data: enc("{}") },
  ]));
  assert.deepEqual(out.map(e => e.path), ["Advisees/Jane.json"]);
});

test("zip › a corrupt central directory is reported, not silently truncated", async () => {
  const z = writeZip([{ path: "a.json", data: enc("{}") }, { path: "b.json", data: enc("{}") }]);
  // Corrupt the first central-directory signature.
  const view = new DataView(z.buffer);
  const eocdAt = z.length - 22;
  const cdAt = view.getUint32(eocdAt + 16, true);
  z[cdAt] = 0x00;
  await assert.rejects(() => readZip(z), /corrupt/);
});
