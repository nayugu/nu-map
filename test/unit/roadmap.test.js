// UNIT · public/roadmap.json, the content of numap.app/roadmap.
//
// The page is a renderer and the JSON is edited by hand, by whoever is
// answering feedback that week. Every check here is one way a hand edit makes
// an item silently vanish or a link we already emailed someone stop working:
//   - a status the page does not render (the item appears nowhere),
//   - a misspelt field ("shiped") that the page just ignores,
//   - a duplicate id (two items, one anchor; the second is unreachable),
//   - a link the renderer will not turn into a link (printed as raw brackets).
// And one that is about the repo rather than the page: it is public, so the
// email of whoever sent the feedback must never land in it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RAW = readFileSync(join(ROOT, "public", "roadmap.json"), "utf8");
const HTML = readFileSync(join(ROOT, "public", "roadmap.html"), "utf8");
const data = JSON.parse(RAW);

const FIELDS = new Set(["id", "title", "status", "kind", "body", "asks", "heard", "shipped"]);
const KINDS = new Set(["bug", "feature", "data"]);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
// Same pattern the page uses; anything else shaped like a link is printed raw.
const LINK = /\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)\s]+)\)/g;

const realDay = s => DAY.test(s) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;

test("every status the JSON defines is one the page renders, in both directions", () => {
  const order = HTML.match(/var ORDER = \[([^\]]*)\]/);
  assert.ok(order, "roadmap.html no longer declares ORDER; update this test with it");
  const rendered = JSON.parse(`[${order[1]}]`);
  assert.deepEqual([...rendered].sort(), Object.keys(data.statuses).sort());
  for (const [key, s] of Object.entries(data.statuses)) {
    assert.ok(s.label && s.blurb, `status ${key} needs a label and a blurb`);
    assert.match(HTML, new RegExp(`--${key}:\\s*#`), `status ${key} has no colour in roadmap.html`);
  }
});

test("every item is well-formed", () => {
  for (const item of data.items) {
    const where = `roadmap item ${item.id ?? JSON.stringify(item).slice(0, 60)}`;
    for (const k of Object.keys(item)) assert.ok(FIELDS.has(k), `${where}: unknown field "${k}" (typo?)`);
    assert.match(item.id ?? "", /^[a-z0-9]+(-[a-z0-9]+)*$/, `${where}: id must be lowercase-with-dashes`);
    assert.ok(typeof item.title === "string" && item.title.trim(), `${where}: needs a title`);
    assert.ok(typeof item.body === "string" && item.body.trim(), `${where}: needs a body`);
    assert.ok(item.status in data.statuses, `${where}: unknown status "${item.status}"`);
    if (item.kind !== undefined) assert.ok(KINDS.has(item.kind), `${where}: kind must be one of ${[...KINDS]}`);
    if (item.asks !== undefined) assert.ok(Number.isInteger(item.asks) && item.asks > 0, `${where}: asks must be a positive integer`);
    if (item.heard !== undefined) assert.match(item.heard, MONTH, `${where}: heard is YYYY-MM`);
    if (item.status === "shipped") {
      assert.ok(realDay(item.shipped ?? ""), `${where}: a shipped item needs shipped: YYYY-MM-DD`);
      assert.ok(item.shipped <= data.updated, `${where}: shipped after the page's own updated date`);
    } else {
      assert.equal(item.shipped, undefined, `${where}: only a shipped item carries a shipped date`);
    }
  }
});

test("ids are unique, because each one is a link we have sent someone", () => {
  const seen = new Set();
  for (const { id } of data.items) {
    assert.ok(!seen.has(id), `duplicate roadmap id ${id}`);
    seen.add(id);
  }
  // An id that collides with an element the page itself owns would scroll there instead.
  for (const id of ["list", "toolbar", "chips", "q", "status", "updated"]) assert.ok(!seen.has(id), `id ${id} is reserved by the page`);
});

test("every link in a body is one the page will render as a link", () => {
  for (const { id, body } of data.items) {
    const stripped = body.replace(LINK, "");
    assert.doesNotMatch(stripped, /\]\(/, `roadmap item ${id}: a [text](url) the page will not link (only https:// or /path)`);
  }
});

test("updated is a real date", () => {
  assert.ok(realDay(data.updated), "updated must be YYYY-MM-DD");
});

test("no email address anywhere in the roadmap (the repo is public)", () => {
  assert.doesNotMatch(RAW, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
});

test("the validator is not vacuous", () => {
  // Each guard above has to be able to fail. Feed the shapes they exist for.
  assert.ok(!realDay("2026-02-30"));
  assert.ok(!MONTH.test("2026-13"));
  assert.match("see [x](mailto:a)".replace(LINK, ""), /\]\(/);
  assert.doesNotMatch("see [x](/data) and [y](https://a.b)".replace(LINK, ""), /\]\(/);
  assert.ok(!FIELDS.has("shiped"));
  assert.ok(data.items.length > 0 && Object.keys(data.statuses).length > 0);
});
