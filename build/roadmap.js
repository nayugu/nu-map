// ═══════════════════════════════════════════════════════════════════
// BUILD · roadmap — roadmap/*.md → /roadmap.json, the data behind
// numap.app/roadmap (public/roadmap.html renders it).
//
// One Markdown file per item, written by hand (often from the GitHub web
// editor), so the format is small and every mistake is a build FAILURE that
// names the file, never an item that silently drops off the page:
//
//   ---
//   status: planned
//   date: 2026-10
//   asks: 1
//   ---
//   # Graduate after Summer A or Summer B
//
//   Paragraphs, separated by blank lines. Links as [text](https://…) or [text](/path).
//
// The FILENAME is the item's id and its permanent link (numap.app/roadmap#id),
// so it is never renamed. roadmap/README.md is the guide for writers.
//
// Node builtins ONLY, and that is load-bearing: test/unit/roadmap.test.js
// imports this, and CI runs the unit suite without `npm ci` (see
// build/aiDataDevPlugin.js for that constraint). Hence a hand parser for the
// header rather than js-yaml — it accepts flat `key: value` and nothing else,
// which is all an item needs and is easier to get right by hand.
// ═══════════════════════════════════════════════════════════════════

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

// Section order on the page, top to bottom. Shipped is LAST because it only
// grows: "Not planned" items answer someone's request and must not sink
// beneath an ever-longer changelog. Each key needs a `--<key>` colour in
// public/roadmap.html (the unit test holds the two together).
export const SECTIONS = [
  { key: "known",    label: "Known issues", blurb: "Confirmed problems. Until they are fixed, the note on each one says what to do instead." },
  { key: "planned",  label: "Planned",      blurb: "Things we intend to build. No dates: we are students, and coursework comes first." },
  { key: "maybe",    label: "Maybe",        blurb: "Possible, but nice to have rather than needed, or we are not yet sure they are worth it." },
  { key: "declined", label: "Not planned",  blurb: "Ideas we have decided against, and why." },
  { key: "shipped",  label: "Shipped",      blurb: "Live on numap.app now." },
];

// ids the page itself uses as element ids; an item named one would hijack the anchor.
export const RESERVED_IDS = ["list", "toolbar", "chips", "q", "status", "updated"];

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Same pattern the page renders; anything else shaped like a link would print raw.
export const LINK = /\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)\s]+)\)/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

const realDay = s => DAY.test(s) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
const isDate = s => MONTH.test(s) || realDay(s);

// field → parser returning [value] or an error string.
const FIELDS = {
  status:  v => SECTIONS.some(s => s.key === v) ? [v] : `status must be one of: ${SECTIONS.map(s => s.key).join(", ")}`,
  date:    v => isDate(v) ? [v] : "date must be YYYY-MM or YYYY-MM-DD",
  shipped: v => realDay(v) ? [v] : "shipped must be a real date, YYYY-MM-DD",
  asks:    v => /^[1-9]\d*$/.test(v) ? [Number(v)] : "asks must be a whole number, 1 or more",
  top:     v => v === "true" ? [true] : v === "false" ? [false] : "top must be true or false",
  // The name a person ASKED to be credited under, exactly as they gave it.
  // Plain text only: no link, no email, nothing the page would render oddly.
  credit:  v => v.length > 0 && v.length <= 60 && !/[[\]()<>@]|https?:/.test(v)
    ? [v] : "credit must be a short name to show (60 characters at most), with no link or email",
};

/** Parse one item file. Returns { item, errors }. */
export function parseItem(id, src) {
  const errors = [];
  const text = src.replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  if (!ID.test(id)) errors.push(`the filename must be lowercase-with-dashes (it becomes the link #${id})`);
  if (RESERVED_IDS.includes(id)) errors.push(`"${id}" is used by the page itself; pick another filename`);
  if (EMAIL.test(text)) errors.push("contains an email address; the repo is public (to credit someone who asked to be, use credit: with the name they gave)");

  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { item: null, errors: [...errors, "must start with a --- header block (copy roadmap/README.md's example)"] };

  const item = { id };
  const seen = new Set(); // keys written, valid or not — so a bad value is reported once, not also as "missing"
  for (const raw of m[1].split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const kv = line.match(/^([A-Za-z]+)\s*:\s*(.*?)\s*$/);
    if (!kv) { errors.push(`header line "${line}" is not "key: value"`); continue; }
    const [, key, val] = kv;
    const value = val.replace(/^(["'])(.*)\1$/, "$2");
    if (!(key in FIELDS)) { errors.push(`unknown field "${key}" (known: ${Object.keys(FIELDS).join(", ")})`); continue; }
    if (seen.has(key)) { errors.push(`field "${key}" appears twice`); continue; }
    seen.add(key);
    const r = FIELDS[key](value);
    if (typeof r === "string") errors.push(`${r} (got "${value}")`); else item[key] = r[0];
  }
  if (!seen.has("status")) errors.push("needs a status");
  if (item.status === "shipped" && !seen.has("shipped")) errors.push("a shipped item needs shipped: YYYY-MM-DD");
  if (item.status && item.status !== "shipped" && seen.has("shipped")) errors.push("only a shipped item carries a shipped date (change status, or remove it)");
  if (item.status && item.status !== "shipped" && !seen.has("date")) errors.push("needs a date: YYYY-MM (when it was reported, or when we wrote it down); it orders the section");

  // Body: "# Title", then paragraphs. Single newlines inside a paragraph are
  // spaces, as in any Markdown; nothing else Markdown offers is rendered, so
  // anything else is refused rather than shown as stray symbols.
  const lines = m[2].split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  const head = (lines.shift() || "").match(/^#\s+(.+?)\s*#*\s*$/);
  if (!head) errors.push('the first line after the header must be the title, as "# Title"');
  else item.title = head[1];
  const paras = lines.join("\n").split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
    .map(p => p.split("\n").map(l => l.trim()).join(" "));
  if (!paras.length) errors.push("needs at least one paragraph under the title");
  for (const p of paras) {
    if (/^(#|[-*+] |> |\d+\. )/.test(p)) errors.push(`only paragraphs and links are supported, not headings, lists or quotes: "${p.slice(0, 40)}…"`);
    if (/\]\(/.test(p.replace(LINK, ""))) errors.push(`a link the page will not render (only https:// or /path): "${p.slice(0, 60)}…"`);
  }
  item.body = paras.join("\n\n");
  return { item, errors };
}

const sortKey = {
  // Newest first; ties by title so the order never depends on the filesystem.
  shipped: (a, b) => b.shipped.localeCompare(a.shipped) || a.title.localeCompare(b.title),
  rest: (a, b) => (b.top === true) - (a.top === true) || b.date.localeCompare(a.date) || a.title.localeCompare(b.title),
};

// The folder's last commit date — but ONLY from a full history. In a shallow
// clone (which a CI or Pages checkout may be) the oldest commit present has
// no parent, so git reports it as having ADDED every file, and "last touched
// the roadmap" silently becomes "the latest deploy". That answer is shaped
// exactly like the right one, so refuse it and let the caller fall back.
function lastCommitDay(dir) {
  const git = args => execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  try {
    if (git(["rev-parse", "--is-shallow-repository"]) !== "false") return null;
    const out = git(["log", "-1", "--format=%cs", "--", dir]);
    return DAY.test(out) ? out : null;
  } catch { return null; }
}

// Fallback for "updated": the newest date any item states. It moves exactly
// when an item is added or ships. Kept at the precision it was written in — a
// month-only date stays "2026-10" (shown "Oct 2026"), never padded into a day
// nobody stated.
export function newestItemDate(items) {
  let best = null;
  for (const d of items.flatMap(i => [i.date, i.shipped]).filter(Boolean)) {
    // Compare a month as its last possible day: "2026-10" may be later than
    // "2026-10-05", so it wins, and the answer claims only the month.
    const key = d.length === 7 ? d + "-32" : d;
    if (!best || key > best.key || (key === best.key && d.length > best.d.length)) best = { key, d };
  }
  return best?.d ?? null;
}

/**
 * Read a roadmap directory. Throws ONE error listing every problem in every
 * file, so a writer fixes them all in one go rather than one per build.
 */
export function loadRoadmap(dir, { updated } = {}) {
  const problems = [];
  const items = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === "README.md" || !name.endsWith(".md")) continue;
    const { item, errors } = parseItem(name.slice(0, -3), readFileSync(join(dir, name), "utf8"));
    if (errors.length) problems.push(`roadmap/${name}:\n  - ${errors.join("\n  - ")}`);
    else items.push(item);
  }
  if (problems.length) throw new Error(`The roadmap has ${problems.length} file(s) to fix:\n${problems.join("\n")}`);

  const ordered = SECTIONS.flatMap(s =>
    items.filter(i => i.status === s.key).sort(s.key === "shipped" ? sortKey.shipped : sortKey.rest));
  return {
    updated: updated ?? lastCommitDay(dir) ?? newestItemDate(items),
    sections: SECTIONS,
    items: ordered,
  };
}

/** Vite plugin: serve /roadmap.json live in dev, write it into the build. */
export function roadmapPlugin(root) {
  const dir = resolve(root, "roadmap");
  let outDir, command;
  return {
    name: "roadmap",
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); command = c.command; },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== "/roadmap.json") return next();
        try {
          const body = JSON.stringify(loadRoadmap(dir));
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache");
          res.end(body);
        } catch (e) {
          // Shown on the page as "could not load"; the reason is in the terminal.
          server.config.logger.error(e.message);
          res.statusCode = 500; res.end(e.message);
        }
      });
    },
    // A bad file fails the build, loudly and by name — never a missing item.
    closeBundle() {
      if (command !== "build") return;
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, "roadmap.json"), JSON.stringify(loadRoadmap(dir)));
    },
  };
}
