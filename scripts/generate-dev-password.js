#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// generate-dev-password.js
//
// Generates a PBKDF2-SHA256 hash for the dev portal password.
// Run this script, then paste the output hash into public/northeastern/dev.html → PW_HASH.
//
// Usage:
//   node scripts/generate-dev-password.js
//
// Or with password as argument (avoids interactive prompt):
//   node scripts/generate-dev-password.js "myPassword123!"
// ─────────────────────────────────────────────────────────────────────────────

import { createInterface } from "readline";
import { subtle }          from "crypto";

const PW_SALT = "numap-dev-portal-2026"; // must match PW_SALT in dev.html
const PW_ITER = 300_000;                 // must match PW_ITER in dev.html

async function hash(password) {
  const enc  = new TextEncoder();
  const key  = await subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(PW_SALT), iterations: PW_ITER, hash: "SHA-256" },
    key, 256
  );
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function main() {
  const arg = process.argv[2];

  if (arg) {
    const h = await hash(arg);
    console.log("\n✅ Hash generated. Paste this into public/northeastern/dev.html → PW_HASH:\n");
    console.log(`  const PW_HASH = "${h}";\n`);
    return;
  }

  // Interactive mode
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const question = (q) => new Promise(res => rl.question(q, res));

  console.error("\n🔐 NU Map Dev Portal — password hash generator");
  console.error(`   PBKDF2-SHA256 · ${PW_ITER.toLocaleString()} iterations · this takes ~1-2 seconds\n`);

  const pw1 = await question("Enter new password: ");
  const pw2 = await question("Confirm password:   ");
  rl.close();

  if (pw1 !== pw2) {
    console.error("\n❌ Passwords do not match.\n");
    process.exit(1);
  }

  if (pw1.length < 12) {
    console.error("\n⚠️  Password is short (<12 chars). The hash will be public — use a strong password.");
  }

  console.error("\nComputing hash…");
  const h = await hash(pw1);

  console.log("\n✅ Hash generated. Paste this into public/dev.html → PW_HASH:\n");
  console.log(`  const PW_HASH = "${h}";\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
