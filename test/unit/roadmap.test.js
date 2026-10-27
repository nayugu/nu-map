// UNIT · roadmap/*.md → /roadmap.json (build/roadmap.js), the content of
// numap.app/roadmap.
//
// The items are written by hand, often from the GitHub web editor, by whoever
// is answering feedback that week. Every mistake is REPORTED by file, never an
// item silently vanishing, but it is fatal only in the roadmap check
// (scripts/check-roadmap.js, its own CI job), never in the build or in this
// suite, which the monthly data workflows run. So this file feeds the parser
// broken items and checks it refuses each one, and proves the isolation;
// it never reads the real roadmap/ folder.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseItem, loadRoadmap, newestItemDate, roadmapPlugin, LINK, SECTIONS, RESERVED_IDS } from "../../build/roadmap.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HTML = readFileSync(join(ROOT, "public", "roadmap.html"), "utf8");
const CHECK = join(ROOT, "scripts", "check-roadmap.js");

const ok = (head, body = "# A title\n\nA paragraph.") => `---\n${head}\n---\n${body}\n`;
const PLANNED = "status: planned\ndate: 2026-10";
const errorsOf = (src, id = "an-item") => parseItem(id, src).errors.join(" | ");

test("a well-formed item parses to exactly what the page renders", () => {
  const { item, errors } = parseItem("summer-graduation", ok(
    "status: planned\ndate: 2026-10\ncredit: Lily H.\ntop: true",
    "# Graduate after Summer A\n\nFirst line\nsame paragraph.\n\nSecond, with [a link](/story) and [one](https://x.y/z)."));
  assert.deepEqual(errors, []);
  assert.deepEqual(item, {
    id: "summer-graduation", status: "planned", date: "2026-10", credit: "Lily H.", top: true,
    title: "Graduate after Summer A",
    body: "First line same paragraph.\n\nSecond, with [a link](/story) and [one](https://x.y/z).",
  });
});

test("tolerates what a hand editor produces: CRLF, a BOM, quotes, spacing, header comments", () => {
  const src = "﻿---\r\nstatus:   \"planned\"  \r\n# a note to ourselves\r\ndate: '2026-10'\r\n---\r\n\r\n#   Title   \r\n\r\nBody.\r\n";
  const { item, errors } = parseItem("x", src);
  assert.deepEqual(errors, []);
  assert.equal(item.status, "planned");
  assert.equal(item.date, "2026-10");
  assert.equal(item.title, "Title");
});

test("refuses every mistake that would otherwise drop or garble an item", () => {
  const cases = [
    [ok("status: plannned\ndate: 2026-10"), /status must be one of/],
    [ok("status: planned"), /needs a date/],
    [ok("date: 2026-10"), /needs a status/],
    [ok(PLANNED + "\nshiped: 2026-10-01"), /unknown field "shiped"/],
    [ok(PLANNED + "\nstatus: known"), /appears twice/],
    // `kind` was retired; an old habit must fail loudly, not be ignored.
    [ok(PLANNED + "\nkind: bug"), /unknown field "kind"/],
    // `asks` was retired; an old habit must fail loudly, not be ignored.
    [ok(PLANNED + "\nasks: 2"), /unknown field "asks"/],
    [ok(PLANNED + "\ntop: yes"), /top must be/],
    [ok("status: planned\ndate: 2026-13"), /date must be/],
    [ok("status: planned\ndate: Oct 2026"), /date must be/],
    [ok("status: shipped"), /needs shipped/],
    [ok("status: shipped\nshipped: 2026-02-30"), /shipped must be a real date/],
    [ok("status: shipped\nshipped: 2026-09"), /shipped must be a real date/],
    [ok(PLANNED + "\nshipped: 2026-09-01"), /only a shipped item/],
    [ok(PLANNED + "\njust words"), /not "key: value"/],
    ["# Title\n\nNo header at all.", /must start with a --- header/],
    [ok(PLANNED, "Title without a hash\n\nBody."), /must be the title/],
    [ok(PLANNED, "# Title only"), /at least one paragraph/],
    [ok(PLANNED, "# T\n\n- a list item"), /only paragraphs and links/],
    [ok(PLANNED, "# T\n\n## A subheading"), /only paragraphs and links/],
    [ok(PLANNED, "# T\n\n1. numbered"), /only paragraphs and links/],
    [ok(PLANNED, "# T\n\nWrite to [us](mailto:x)."), /link the page will not render/],
    [ok(PLANNED, "# T\n\nSee [here](www.example.com)."), /link the page will not render/],
    // "//host" looks like a path on this site and is another site.
    [ok(PLANNED, "# T\n\nSee [here](//evil.example/x)."), /link the page will not render/],
    [ok(PLANNED, "# T\n\nThanks to someone@northeastern.edu for this."), /email address/],
    [ok(PLANNED + "\ncredit: dana@northeastern.edu"), /email address/],
    [ok(PLANNED + "\ncredit: [John](https://x.y)"), /credit must be/],
    [ok(PLANNED + "\ncredit: https://dana.dev"), /credit must be/],
    [ok(PLANNED + "\ncredit: " + "x".repeat(61)), /credit must be/],
    [ok(PLANNED + "\ncredit:"), /credit must be/],
  ];
  for (const [src, want] of cases) assert.match(errorsOf(src), want, `should refuse:\n${src}`);
});

test("credit carries the name exactly as the person gave it", () => {
  for (const name of ["John S.", "Lily H. and John S.", "Jean-Luc O'Brien", "李华", "a CS student"]) {
    const { item, errors } = parseItem("x", ok(PLANNED + `\ncredit: "${name}"`));
    assert.deepEqual(errors, [], name);
    assert.equal(item.credit, name);
  }
});

test("a title keeps a # that is part of it; only Markdown's spaced closing #s go", () => {
  assert.equal(parseItem("x", ok(PLANNED, "# C# support\n\nx")).item.title, "C# support");
  assert.equal(parseItem("x", ok(PLANNED, "# Learn C#\n\nx")).item.title, "Learn C#");
  assert.equal(parseItem("x", ok(PLANNED, "# Closed title ##\n\nx")).item.title, "Closed title");
});

test("the page and the build use the SAME link pattern", () => {
  // Two copies by necessity (the page is a static file); they must not drift,
  // or the build accepts a link the page then prints as raw brackets.
  const page = HTML.match(/var LINK = (\/.*\/g);/);
  assert.ok(page, "roadmap.html no longer declares LINK; update this test with it");
  assert.equal(page[1], LINK.toString());
});

test("one mistake is reported once, not also as a missing field", () => {
  assert.deepEqual(parseItem("x", ok("status: plannned\ndate: 2026-10")).errors.length, 1);
  assert.deepEqual(parseItem("x", ok("status: planned\ndate: 2026-13")).errors.length, 1);
  assert.deepEqual(parseItem("x", ok("status: shipped\nshipped: 2026-02-30")).errors.length, 1);
});

test("the filename is the link, so it must be a usable, unclaimed anchor", () => {
  assert.match(errorsOf(ok(PLANNED), "Summer Graduation"), /lowercase-with-dashes/);
  assert.match(errorsOf(ok(PLANNED), "summer_graduation"), /lowercase-with-dashes/);
  assert.match(errorsOf(ok(PLANNED), "-leading"), /lowercase-with-dashes/);
  for (const id of RESERVED_IDS) assert.match(errorsOf(ok(PLANNED), id), /used by the page/);
  assert.equal(errorsOf(ok(PLANNED), "degree-audit-2"), "");
});

function withDir(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), "roadmap-"));
  try {
    for (const [name, src] of Object.entries(files)) writeFileSync(join(dir, name), src);
    return fn(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("a bad file is left out and reported; the good ones still load", () => {
  withDir({
    "fine.md": ok(PLANNED),
    "bad-one.md": ok("status: nope\ndate: 2026-10"),
    "Bad Name.md": ok(PLANNED),
  }, dir => {
    const r = loadRoadmap(dir, { updated: "2026-10-27" });
    assert.deepEqual(r.items.map(i => i.id), ["fine"]);
    assert.deepEqual(r.problems.map(p => p.file).sort(), ["Bad Name.md", "bad-one.md"]);
  });
});

test("strict mode names every problem in every file at once", () => {
  withDir({ "fine.md": ok(PLANNED), "bad-one.md": ok("status: nope\ndate: 2026-10"), "Bad Name.md": ok(PLANNED) }, dir => {
    assert.throws(() => loadRoadmap(dir, { updated: "2026-10-27", strict: true }), e =>
      /2 file\(s\)/.test(e.message) && e.message.includes("roadmap/bad-one.md") && e.message.includes("roadmap/Bad Name.md"));
  });
});

test("README.md and non-Markdown files are not items", () => {
  withDir({ "README.md": "# Guide, no header", "notes.txt": "x", "a.md": ok(PLANNED) }, dir => {
    assert.deepEqual(loadRoadmap(dir, { updated: "2026-10-27" }).items.map(i => i.id), ["a"]);
  });
});

test("ordering: section order, then top, then newest date, then title; shipped newest first", () => {
  withDir({
    "old.md": ok("status: planned\ndate: 2026-01"),
    "new.md": ok("status: planned\ndate: 2026-10"),
    "pinned-old.md": ok("status: planned\ndate: 2025-01\ntop: true"),
    "tie-b.md": ok("status: planned\ndate: 2026-05", "# B\n\nx"),
    "tie-a.md": ok("status: planned\ndate: 2026-05", "# A\n\nx"),
    "s-old.md": ok("status: shipped\nshipped: 2026-07-01"),
    "s-new.md": ok("status: shipped\nshipped: 2026-09-01"),
    "bug.md": ok("status: known\ndate: 2020-01"),
    "no.md": ok("status: declined\ndate: 2026-10"),
  }, dir => {
    const ids = loadRoadmap(dir, { updated: "2026-10-27" }).items.map(i => i.id);
    assert.deepEqual(ids, ["bug", "pinned-old", "new", "tie-a", "tie-b", "old", "no", "s-new", "s-old"]);
  });
});

test("the fallback date keeps the precision it was written in", () => {
  const at = (...ds) => newestItemDate(ds.map(d => d.length === 10 && d.startsWith("s") ? { shipped: d.slice(1) } : { date: d }));
  assert.equal(at("2026-09", "2026-10"), "2026-10");
  assert.equal(at("2026-10", "2026-10-05"), "2026-10");      // the month may be later than the 5th
  assert.equal(at("2026-09-30", "2026-10-02"), "2026-10-02");
  assert.equal(at("2026-09", "2026-10-02"), "2026-10-02");
  assert.equal(newestItemDate([{ shipped: "2026-11-01", date: "2026-10" }]), "2026-11-01");
  assert.equal(newestItemDate([]), null);
});

// "Updated" comes from the folder's last commit, but a shallow clone (a CI
// or Pages checkout may be one) reports its oldest commit as having added
// every file, so the date would silently become the latest DEPLOY. Built for
// real: two commits, the roadmap touched only by the older one.
test("updated is the folder's last commit, and a shallow clone falls back instead of lying", () => {
  const sh = (cwd, args, env = {}) => execFileSync("git", args, { cwd, env: { ...process.env, ...env }, stdio: "pipe" }).toString().trim();
  const base = mkdtempSync(join(tmpdir(), "roadmap-git-"));
  try {
    const repo = join(base, "repo");
    mkdirSync(join(repo, "roadmap"), { recursive: true });
    sh(repo, ["init", "-q"]);
    writeFileSync(join(repo, "roadmap", "a.md"), ok("status: planned\ndate: 2019-06"));
    const at = d => ({ GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" });
    sh(repo, ["add", "-A"]); sh(repo, ["commit", "-qm", "roadmap"], at("2020-01-01T12:00:00Z"));
    writeFileSync(join(repo, "other.txt"), "x");
    sh(repo, ["add", "-A"]); sh(repo, ["commit", "-qm", "unrelated"], at("2021-01-01T12:00:00Z"));

    assert.equal(loadRoadmap(join(repo, "roadmap")).updated, "2020-01-01");
    // A RELATIVE path must give the same answer (git runs inside the folder).
    const here = process.cwd();
    try { process.chdir(repo); assert.equal(loadRoadmap("roadmap").updated, "2020-01-01"); }
    finally { process.chdir(here); }

    const shallow = join(base, "shallow");
    sh(base, ["clone", "-q", "--depth", "1", "file://" + repo, shallow]);
    assert.equal(sh(shallow, ["rev-parse", "--is-shallow-repository"]), "true");
    // Without the guard this reads 2021-01-01, the unrelated commit.
    assert.equal(loadRoadmap(join(shallow, "roadmap")).updated, "2019-06");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

// ── Isolation: roadmap CONTENT never fails the build or this suite ────
//
// The monthly data workflows run `npm run build` and `npm test`, so nothing
// here may depend on what is written in roadmap/. Content is checked by
// scripts/check-roadmap.js, its own CI job. These tests prove the split.

test("every section has a colour on the page", () => {
  for (const { key } of SECTIONS) assert.match(HTML, new RegExp(`--${key}:\\s*#`), `section ${key} has no colour in roadmap.html`);
});

function runPluginBuild(files) {
  const root = mkdtempSync(join(tmpdir(), "roadmap-build-"));
  try {
    mkdirSync(join(root, "roadmap"));
    for (const [name, src] of Object.entries(files)) writeFileSync(join(root, "roadmap", name), src);
    const logs = [];
    const plugin = roadmapPlugin(root);
    const log = level => msg => logs.push(level + ": " + msg);
    plugin.configResolved({ root, command: "build", build: { outDir: "dist" }, logger: { warn: log("warn"), error: log("error") } });
    plugin.closeBundle(); // must not throw, whatever is in roadmap/
    let json = null;
    try { json = JSON.parse(readFileSync(join(root, "dist", "roadmap.json"), "utf8")); } catch { /* not written */ }
    return { json, logs };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("the build survives a broken file: the item is left off, the rest ship, and it says so", () => {
  const { json, logs } = runPluginBuild({ "good.md": ok(PLANNED), "bad.md": ok("status: nope\ndate: 2026-10") });
  assert.deepEqual(json.items.map(i => i.id), ["good"]);
  assert.equal(json.problems, undefined, "problems are for the dev banner, never published");
  assert.ok(logs.some(l => l.startsWith("warn") && l.includes("roadmap/bad.md")), logs.join("\n"));
});

test("the build survives even a crash in the roadmap code (no folder at all)", () => {
  const root = mkdtempSync(join(tmpdir(), "roadmap-build-"));
  try {
    const logs = [];
    const plugin = roadmapPlugin(root);
    plugin.configResolved({ root, command: "build", build: { outDir: "dist" }, logger: { warn: m => logs.push(m), error: m => logs.push(m) } });
    assert.doesNotThrow(() => plugin.closeBundle());
    assert.ok(logs.some(l => l.includes("could not build /roadmap.json")), logs.join("\n"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the roadmap check is the strict one: it exits 1 and names the file, or 0 when clean", () => {
  const run = dir => {
    try { return { code: 0, out: execFileSync(process.execPath, [CHECK, dir], { stdio: "pipe" }).toString() }; }
    catch (e) { return { code: e.status, out: e.stderr.toString() }; }
  };
  withDir({ "good.md": ok(PLANNED) }, dir => assert.equal(run(dir).code, 0));
  withDir({ "good.md": ok(PLANNED), "bad.md": ok("status: nope\ndate: 2026-10") }, dir => {
    const r = run(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /roadmap\/bad\.md/);
  });
});

test("nothing in this suite reads the real roadmap/ folder", () => {
  // The guarantee above is only as good as this: one content-dependent test
  // here would let a typo in an item block the monthly data update again.
  const src = readFileSync(fileURLToPath(import.meta.url), "utf8");
  assert.doesNotMatch(src, new RegExp(`join\\(ROOT, ["']roadmap["']\\)`));
});

test("the page reads the fields the build writes, and nothing the build no longer writes", () => {
  // The page and the build are two files; this is what holds them together.
  for (const gone of ["statuses", "heard", "item.kind", "item.asks"]) assert.ok(!HTML.includes(gone), `roadmap.html still reads "${gone}"`);
  for (const used of ["data.sections", "item.date", "item.shipped", "item.credit", "item.body", "item.title"]) {
    assert.ok(HTML.includes(used), `roadmap.html no longer reads ${used}; update this test with it`);
  }
});
