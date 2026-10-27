// UNIT · roadmap/*.md → /roadmap.json (build/roadmap.js), the content of
// numap.app/roadmap.
//
// The items are written by hand, often from the GitHub web editor, by whoever
// is answering feedback that week. The design promise is that every mistake
// FAILS THE BUILD and names the file, rather than an item silently vanishing
// or a link we already emailed someone going dead. So most of this file feeds
// the parser broken items and checks it refuses each one; the corpus tests at
// the bottom hold the real folder to the same rules.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseItem, loadRoadmap, SECTIONS, RESERVED_IDS } from "../../build/roadmap.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HTML = readFileSync(join(ROOT, "public", "roadmap.html"), "utf8");

const ok = (head, body = "# A title\n\nA paragraph.") => `---\n${head}\n---\n${body}\n`;
const PLANNED = "status: planned\ndate: 2026-10";
const errorsOf = (src, id = "an-item") => parseItem(id, src).errors.join(" | ");

test("a well-formed item parses to exactly what the page renders", () => {
  const { item, errors } = parseItem("summer-graduation", ok(
    "status: planned\nkind: feature\ndate: 2026-10\nasks: 2\ntop: true",
    "# Graduate after Summer A\n\nFirst line\nsame paragraph.\n\nSecond, with [a link](/story) and [one](https://x.y/z)."));
  assert.deepEqual(errors, []);
  assert.deepEqual(item, {
    id: "summer-graduation", status: "planned", kind: "feature", date: "2026-10", asks: 2, top: true,
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
    [ok(PLANNED + "\nkind: Bug"), /kind must be one of/],
    [ok(PLANNED + "\nasks: 0"), /asks must be/],
    [ok(PLANNED + "\nasks: two"), /asks must be/],
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
    [ok(PLANNED, "# T\n\nThanks to someone@northeastern.edu for this."), /email address/],
  ];
  for (const [src, want] of cases) assert.match(errorsOf(src), want, `should refuse:\n${src}`);
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

test("one bad file fails the WHOLE load, and every problem in every file is named at once", () => {
  withDir({
    "fine.md": ok(PLANNED),
    "bad-one.md": ok("status: nope\ndate: 2026-10"),
    "Bad Name.md": ok(PLANNED),
  }, dir => {
    assert.throws(() => loadRoadmap(dir, { updated: "2026-10-27" }), e =>
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

// ── The real folder ──────────────────────────────────────────────────

const real = loadRoadmap(join(ROOT, "roadmap"), { updated: "2026-10-27" });

test("the committed roadmap loads, and every section has a colour on the page", () => {
  assert.ok(real.items.length > 0);
  for (const { key } of SECTIONS) assert.match(HTML, new RegExp(`--${key}:\\s*#`), `section ${key} has no colour in roadmap.html`);
});

test("links we have already sent people keep working", () => {
  // Each of these has been (or is about to be) emailed in a feedback reply.
  // Renaming the file breaks the link; add to this list, never remove.
  const sent = ["pols-ba-capstone-or-coop", "degree-audit-import", "summer-graduation", "term-off"];
  const ids = new Set(real.items.map(i => i.id));
  for (const id of sent) assert.ok(ids.has(id), `roadmap/${id}.md is gone or renamed, and its link is in someone's inbox`);
});

test("the page reads the fields the build writes, and nothing the build no longer writes", () => {
  // The page and the build are two files; this is what holds them together.
  for (const gone of ["statuses", "heard"]) assert.ok(!HTML.includes(gone), `roadmap.html still reads "${gone}"`);
  for (const used of ["data.sections", "item.date", "item.shipped", "item.asks", "item.kind", "item.body", "item.title"]) {
    assert.ok(HTML.includes(used), `roadmap.html no longer reads ${used}; update this test with it`);
  }
});
