#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// BUILD LOGOS  — process public/logos/ and regenerate its index
//
// Pinning a company logo is dropping a file in `public/logos/`, named after
// what it should match:
//
//   public/logos/imageworks.com.svg              matched by domain
//   public/logos/sony-pictures-imageworks.png    matched by company name
//
// Then `npm run logos`, which is this script. It:
//
//   1. PROCESSES every raster in place — trim the padding, square it, scale
//      it down to 256px, re-encode as PNG/WebP and keep whichever is smaller;
//   2. WRITES index.json, the list of files, which exists only because a
//      browser cannot list a directory.
//
// It is idempotent: an already-processed file has nothing left to trim or
// shrink, so re-running keeps the bytes it already has. SVGs are left alone —
// vector art is already ideal, and rewriting it could only lose something.
//
//   npm run logos                      process the folder, rebuild the index
//   npm run logos:check                verify without writing (CI, tests)
//   node scripts/build-logos.js --add <path|url> --as imageworks.com
//                                      fetch/copy a logo in under the right
//                                      name, then process and index it
//
// The image work runs in the Chromium that Playwright already ships for this
// repo's tests: a canvas decodes anything a browser can render, which is
// exactly the set of formats we need, and it adds no new dependency.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { extname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { logoKeyForFile, normalizeCompanyName } from "../src/core/companyLogoRegistry.js";

const ROOT      = resolve(fileURLToPath(new URL("..", import.meta.url)));
const LOGO_DIR  = join(ROOT, "public", "logos");
const INDEX     = join(LOGO_DIR, "index.json");
const MAX_SIZE  = 256;

const RASTER = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".ico"]);
const KEEP   = new Set([".svg", ...RASTER]);
const MIME   = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif",
  ".bmp": "image/bmp", ".ico": "image/x-icon",
};

const logoFiles = () =>
  readdirSync(LOGO_DIR)
    .filter(f => !f.startsWith(".") && KEEP.has(extname(f).toLowerCase()))
    .sort();

// ── Validation ────────────────────────────────────────────────────

function problemsWith(files) {
  const problems = [];
  const claimed = new Map();
  for (const f of files) {
    const hit = logoKeyForFile(f);
    if (!hit) { problems.push(`${f}: names no company — rename it to a domain or a company name`); continue; }
    const key = `${hit.kind}:${hit.key}`;
    if (claimed.has(key)) problems.push(`${f} and ${claimed.get(key)} both claim ${hit.kind} "${hit.key}"`);
    claimed.set(key, f);
    if (extname(f).toLowerCase() === ".svg") {
      const text = readFileSync(join(LOGO_DIR, f), "utf8");
      if (!/<svg[\s>]/i.test(text))                    problems.push(`${f}: not an SVG`);
      if (/<script|javascript:|onload=/i.test(text))   problems.push(`${f}: contains active content`);
    }
  }
  return problems;
}

// ── Image processing ──────────────────────────────────────────────

/**
 * Trim → square → scale → re-encode, in a headless Chromium canvas.
 * Returns the chosen bytes and what happened, or null if nothing improved.
 */
async function processRaster(page, buf, ext) {
  const dataUrl = `data:${MIME[ext] ?? "image/png"};base64,${buf.toString("base64")}`;
  const out = await page.evaluate(async ({ dataUrl, maxSize, CONTENT_RATIO }) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const W = img.naturalWidth, H = img.naturalHeight;
    if (!W || !H) return { error: "did not decode as an image" };

    const src = document.createElement("canvas");
    src.width = W; src.height = H;
    const sctx = src.getContext("2d", { willReadFrequently: true });
    sctx.drawImage(img, 0, 0);
    const { data } = sctx.getImageData(0, 0, W, H);
    const at = (x, y) => (y * W + x) * 4;

    // The corner pixel decides what "background" means: transparent → trim on
    // alpha, otherwise trim pixels matching the corner within a tolerance (a
    // JPEG's white field is not exactly #ffffff).
    const c  = at(0, 0);
    const bg = { r: data[c], g: data[c + 1], b: data[c + 2], a: data[c + 3] };
    const TOL = 12;
    const isBg = (x, y) => {
      const i = at(x, y);
      if (bg.a < 8) return data[i + 3] < 8;
      return data[i + 3] > 8
        && Math.abs(data[i]     - bg.r) <= TOL
        && Math.abs(data[i + 1] - bg.g) <= TOL
        && Math.abs(data[i + 2] - bg.b) <= TOL;
    };
    let x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1;
    const rowBg = y => { for (let x = 0; x < W; x++) if (!isBg(x, y)) return false; return true; };
    const colBg = x => { for (let y = 0; y < H; y++) if (!isBg(x, y)) return false; return true; };
    while (y0 < y1 && rowBg(y0)) y0++;
    while (y1 > y0 && rowBg(y1)) y1--;
    while (x0 < x1 && colBg(x0)) x0++;
    while (x1 > x0 && colBg(x1)) x1--;
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    if (cw < 2 || ch < 2) return { error: "trimmed away to nothing — is it blank?" };

    // MINIMAL crop: take the largest square the image can give (`min(W, H)`)
    // and slide it over the logo. The padding a designer put around a mark is
    // part of the mark's presentation — cropping to the content's own
    // bounding box jams a tall glyph against the top and bottom edges and
    // makes it read as zoomed-in beside every other logo. The content box is
    // used only to decide WHERE the square sits, not how big it is.
    let side = Math.min(W, H);
    // The one exception, and it fires on nothing normal: a mark marooned in a
    // canvas of mostly background would otherwise scale down to a speck.
    const content = Math.max(cw, ch);
    if (content < side * 0.5) side = Math.max(content, Math.round(content / 0.7));
    const clamp = (v, hi) => Math.max(0, Math.min(Math.round(v), hi));
    const sx = clamp((x0 + x1 + 1) / 2 - side / 2, W - side);
    const sy = clamp((y0 + y1 + 1) / 2 - side / 2, H - side);

    const out = Math.min(maxSize, side);                 // never upscale
    const dst = document.createElement("canvas");
    dst.width = out; dst.height = out;
    const dctx = dst.getContext("2d");
    dctx.imageSmoothingQuality = "high";
    dctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
    return {
      png:  dst.toDataURL("image/png").split(",")[1],
      // A canvas re-encodes a colour-mapped PNG as RGBA, which can triple its
      // size; WebP usually wins that back, and every browser here reads it.
      webp: dst.toDataURL("image/webp", 0.92).split(",")[1],
      source: { w: W, h: H }, content: { w: cw, h: ch }, side, out,
      // Did processing actually do anything? If not, the file already on disk
      // is as good, and is usually smaller than a re-encode of it. An image
      // that is already square and already small enough is that fixed point —
      // re-running must not re-encode it, because WebP is lossy and the loss
      // would compound on every run.
      changed: side !== W || side !== H || out !== side,
    };
  }, { dataUrl, maxSize: MAX_SIZE });

  if (out.error) throw new Error(out.error);

  // Nothing to crop and nothing to scale: leave the file exactly as it is.
  // Re-encoding it would only lose quality, and would do so again next run.
  if (!out.changed) return null;

  const candidates = [
    { ext: ".png",  buf: Buffer.from(out.png,  "base64") },
    { ext: ".webp", buf: Buffer.from(out.webp, "base64") },
  ].sort((a, b) => a.buf.length - b.buf.length);

  const win = candidates[0];
  return { ...win, report:
    `${out.source.w}×${out.source.h} → square ${out.side}×${out.side} → ${out.out}×${out.out}, `
    + `${buf.length} B → ${win.buf.length} B as ${win.ext.slice(1)}` };
}

// ── Commands ──────────────────────────────────────────────────────

async function build({ check }) {
  mkdirSync(LOGO_DIR, { recursive: true });
  let files = logoFiles();

  const problems = problemsWith(files);
  if (problems.length) {
    console.error(`✗ ${problems.length} problem(s) in public/logos/:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }

  if (!check) {
    const rasters = files.filter(f => RASTER.has(extname(f).toLowerCase()));
    if (rasters.length) {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        for (const f of rasters) {
          const ext = extname(f).toLowerCase();
          const buf = readFileSync(join(LOGO_DIR, f));
          let out;
          try { out = await processRaster(page, buf, ext); }
          catch (e) { console.error(`✗ ${f}: ${e.message}`); process.exit(1); }
          if (!out) { console.log(`· ${f} — already processed`); continue; }
          const renamed = join(LOGO_DIR, basename(f, ext) + out.ext);
          writeFileSync(renamed, out.buf);
          if (out.ext !== ext) unlinkSync(join(LOGO_DIR, f));
          console.log(`✓ ${f} — ${out.report}`);
        }
      } finally { await browser.close(); }
      files = logoFiles();
    }
  }

  const index = JSON.stringify({ files }, null, 2) + "\n";
  const current = existsSync(INDEX) ? readFileSync(INDEX, "utf8") : "";
  if (check) {
    if (current !== index) {
      console.error("✗ public/logos/index.json is stale — run `npm run logos`");
      process.exit(1);
    }
    console.log(`✓ ${files.length} curated logo(s), index up to date`);
    return;
  }
  writeFileSync(INDEX, index);
  console.log(`✓ index.json — ${files.length} curated logo(s): ${files.join(", ") || "(none)"}`);
}

/** Convenience: pull a file or URL into the folder under the right name. */
async function addLogo(source, as) {
  if (!as) throw new Error("--as is required: the domain or company name this logo is for");
  let buf, ext;
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source, { redirect: "follow" });
    if (!res.ok) throw new Error(`fetch ${source} → HTTP ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    buf = Buffer.from(await res.arrayBuffer());
    ext = type.includes("svg") ? ".svg" : (extname(new URL(source).pathname) || ".png").toLowerCase();
  } else {
    const p = resolve(source);
    if (!existsSync(p)) throw new Error(`no such file: ${p}`);
    buf = readFileSync(p);
    ext = (extname(p) || ".png").toLowerCase();
  }
  if (!KEEP.has(ext)) throw new Error(`${ext} is not an image format this ships`);

  // `--as "Sony Pictures Imageworks"` and `--as imageworks.com` both work:
  // the name is folded to the filename convention the folder matches on.
  const stem = as.includes(".") ? as.trim().toLowerCase().replace(/^www\./, "")
                                : normalizeCompanyName(as).replace(/ /g, "-");
  if (!stem) throw new Error(`"${as}" names no company`);
  mkdirSync(LOGO_DIR, { recursive: true });
  for (const f of logoFiles()) if (basename(f, extname(f)) === stem) unlinkSync(join(LOGO_DIR, f));
  writeFileSync(join(LOGO_DIR, stem + ext), buf);
  console.log(`✓ ${stem}${ext} (${buf.length} B)`);
}

// ── CLI ───────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const opts = { check: argv.includes("--check") };
const at   = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

try {
  const source = at("--add");
  if (source) await addLogo(source, at("--as"));
  await build(opts);
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
