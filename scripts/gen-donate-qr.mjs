// ═══════════════════════════════════════════════════════════════════
// GEN DONATE QR — bakes the donate target into public/donate-qr.svg
//
// Build-time, not runtime, on purpose: the URL changes about once a year,
// and bundling a QR encoder would add ~50 kB gzipped to an index chunk that
// already trips Vite's 500 kB warning. `qrcode` stays a devDependency.
//
// Run after editing DONATE in src/core/donate.js:  npm run gen:donate-qr
//
// Error correction level Q (~25% recoverable) so the code still scans even
// when partly obscured or photographed off-angle.
//
// Modules stay hard black on a transparent background, and the modal always
// draws them on a white plaque — in both light and dark themes. Theming the
// modules to a muted text token would look tidier and scan worse, and a QR
// that needs two attempts defeats the entire point of having one.
// ═══════════════════════════════════════════════════════════════════
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import QRCode from "qrcode";
import { DONATE_URL } from "../src/core/donate.js";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "donate-qr.svg");

if (!DONATE_URL) {
  console.error("✗ DONATE_URL is empty in src/core/donate.js — nothing to encode.");
  process.exit(1);
}

// Transparent light colour so the modal's white plaque shows through and the
// SVG carries no background of its own to fight the rounded corners.
const svg = await QRCode.toString(DONATE_URL, {
  type: "svg",
  errorCorrectionLevel: "Q",
  margin: 1,          // 1 module quiet zone; the modal supplies visual padding
  color: { dark: "#000000ff", light: "#00000000" },
});

writeFileSync(OUT, svg);
console.log(`✓ public/donate-qr.svg → ${DONATE_URL}`);
