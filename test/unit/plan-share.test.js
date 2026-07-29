// UNIT · src/core/planShare.js — the share-link codec (gzip + base64url).
//
// This is the "don't corrupt a saved plan" guarantee: a plan encoded into a URL
// must decode back to the same plan. The real contract is NOT literal ===: the
// v2 packer intentionally *drops* empty/default fields to keep URLs short, so we
// assert "every non-default field round-trips exactly" plus the URL-safety and
// legacy-format guarantees. Runs offline — CompressionStream is a Node global.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { encodePlan, decodePlan } from "../../src/core/planShare.js";

const roundTrip = async (plan) => decodePlan(await encodePlan(plan));

test("planShare › a fully-populated plan round-trips field-for-field", async () => {
  const plan = {
    entSem: "fall", entYear: 2024, gradSem: "spring", gradYear: 2028,
    placements: { CS2000: "fall2024", CS3000: "spr2025" },
    semOrders: { fall2024: ["CS2000"] },
    major: "khoury/bscs", minor1: "cos/math",
    placedOut: ["ENGW1111"],
    substitutions: [{ from: "CS2000", to: "CS2001" }],
    specialTermPl: { w1: { typeId: "coop", semId: "fall2025", duration: 4, company: "Acme" } },
    studentType: "undergraduate",
    locale: "en",
    planName: "My Plan",
  };
  const decoded = await roundTrip(plan);
  assert.deepEqual(decoded, { version: 2, ...plan });
});

test("planShare › substitution {from,to} survives the compact key packing", async () => {
  const decoded = await roundTrip({ substitutions: [{ from: "A", to: "B" }, { from: "C", to: "D" }] });
  assert.deepEqual(decoded.substitutions, [{ from: "A", to: "B" }, { from: "C", to: "D" }]);
});

test("planShare › specialTermPl inner keys (typeId/semId/duration/company) survive", async () => {
  const entry = { typeId: "coop", semId: "fall2025", duration: 6, company: "Globex", companyDomain: "globex.com", subline: "SWE" };
  const decoded = await roundTrip({ specialTermPl: { x: entry } });
  assert.deepEqual(decoded.specialTermPl.x, entry);
});

test("planShare › empty/default fields are dropped (short URLs), non-empty kept", async () => {
  const decoded = await roundTrip({
    entSem: "fall", entYear: 2024,
    bonusSH: 0,          // default → dropped
    semOrders: {},       // empty object → dropped
    placedOut: [],       // empty array → dropped
    substitutions: [],   // empty array → dropped
  });
  assert.equal(decoded.entSem, "fall");
  assert.equal(decoded.entYear, 2024);
  assert.ok(!("bonusSH" in decoded));
  assert.ok(!("semOrders" in decoded));
  assert.ok(!("placedOut" in decoded));
  assert.ok(!("substitutions" in decoded));
});

test("planShare › encoded output is URL-safe base64url (no +, /, or = padding)", async () => {
  const encoded = await encodePlan({ placements: { CS2000: "fall2024" }, planName: "π ∑ 日本語" });
  assert.match(encoded, /^[A-Za-z0-9_-]+$/, "must be base64url with no +, /, or =");
});

test("planShare › non-ASCII plan names survive the round-trip", async () => {
  const decoded = await roundTrip({ planName: "計画 — plán 🎓" });
  assert.equal(decoded.planName, "計画 — plán 🎓");
});

test("planShare › legacy v1 blob is returned as-is (no v2 unpacking)", async () => {
  // v1 payloads used full key names and no packing; decodePlan must pass them through.
  const v1 = { v: 1, entSem: "fall", placements: { CS1000: "fall2024" } };
  const b64url = gzipSync(Buffer.from(JSON.stringify(v1)))
    .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  assert.deepEqual(await decodePlan(b64url), v1);
});
