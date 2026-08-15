// UNIT · the course a work term registers must survive every way a plan leaves
// the browser.
//
// `courseId` is now the ONLY thing that makes a co-op or internship satisfy a
// requirement — nothing is inferred. That raises the cost of losing it from
// "a cosmetic flag is missing" to "the recipient's degree audit is wrong", and
// the failure mode is silent in exactly the places nobody looks: a key absent
// from SHARE_INNER_KEYS survives a reload (specialTermPl is serialised whole)
// and is dropped from every share link. That is the `conc2` incident, and
// `abroad` nearly repeated it.
//
// The surfaces, and where each is covered:
//   Snapshot link / Share / Load  → planShare codec            · here
//   Save JSON / Load JSON / slots → captureCurrentPlan, whole  · here (shape)
//   MCP add / update / read       → planner action+query adapters · here
//   Export PDF                    → deferred, deliberately
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodePlan, decodePlan } from "../../src/core/planShare.js";
import { SHARE_INNER_KEYS, PLAN_FIELDS } from "../../src/core/planSchema.js";
import { applyChangeset } from "../../src/adapters/mcp/plannerActionAdapter.js";

const roundTrip = async (plan) => decodePlan(await encodePlan(plan));

// ── share links ─────────────────────────────────────────────────────

test("courseId survives the share codec, alongside every other inner key", async () => {
  const entry = {
    typeId: "coop", semId: "fall2025", duration: 6,
    company: "Globex", companyDomain: "globex.com", subline: "SWE",
    abroad: true, courseId: "COOP3948",
  };
  const decoded = await roundTrip({ specialTermPl: { x: entry } });
  assert.deepEqual(decoded.specialTermPl.x, entry);
});

test("two work terms carry two different registrations through a link", async () => {
  // The multiplicity case. If the packer collapsed or reordered these, IB's two
  // non-shared experiential sections would come apart for the recipient.
  const plan = { specialTermPl: {
    a: { typeId: "coop",   semId: "spr2027", duration: 6, courseId: "COOP3948" },
    b: { typeId: "coop",   semId: "spr2028", duration: 6, courseId: "COOP3945" },
    c: { typeId: "intern", semId: "sumA2029", duration: 2, courseId: "COOP3949" },
  } };
  const decoded = await roundTrip(plan);
  assert.deepEqual(decoded.specialTermPl, plan.specialTermPl);
});

test("a work term with no course chosen stays chosen-less", async () => {
  // Absent must not round-trip into present-and-empty: `""` would read as a
  // course id everywhere downstream, and the resolver's `if (d.courseId)`
  // guard is the only thing standing between that and a lookup miss.
  const decoded = await roundTrip({ specialTermPl: { a: { typeId: "coop", semId: "spr2027", duration: 4 } } });
  assert.ok(!("courseId" in decoded.specialTermPl.a));
});

test("the field is registered in the schema, not just handled by luck", () => {
  // The guard for the whole class of bug: SHARE_INNER_KEYS is the allowlist,
  // so a field added to state and not here is silently dropped from sharing.
  assert.equal(SHARE_INNER_KEYS.specialTerm.courseId, "ci");
  // …and its compact key must be unique, or it would overwrite a sibling.
  const keys = Object.values(SHARE_INNER_KEYS.specialTerm);
  assert.equal(new Set(keys).size, keys.length, "two specialTerm fields share a compact key");
  // specialTermPl itself must still be a shared, inner-packed field.
  const f = PLAN_FIELDS.find(x => x.name === "specialTermPl");
  assert.equal(f?.nested, "specialTerm");
  assert.ok(f?.share, "specialTermPl is no longer shared at all");
});

// ── MCP: write, edit, clear ─────────────────────────────────────────

const CATALOG = {
  COOP3945: { id: "COOP3945", subject: "COOP", number: "3945", sh: 0, coop: { abroad: false, halfTime: false, kind: "coop" } },
  COOP3948: { id: "COOP3948", subject: "COOP", number: "3948", sh: 0, coop: { abroad: true,  halfTime: false, kind: "coop" } },
  COOP3949: { id: "COOP3949", subject: "COOP", number: "3949", sh: 0, coop: { abroad: false, halfTime: false, kind: "intern" } },
  MATH2331: { id: "MATH2331", subject: "MATH", number: "2331", sh: 4 },
};
const EMPTY = { placements: {}, placedOut: [], palette: [], workExperience: {}, substitutions: [] };
const run = (actions, plan = EMPTY) =>
  applyChangeset(structuredClone(plan), actions, CATALOG);

const onlyTerm = (res) => Object.values(res.plan.workExperience)[0];

test("ADD_WORK_TERM records the course it is given", () => {
  const res = run([{ type: "ADD_WORK_TERM", typeId: "coop", semId: "spr2027", duration: 6, courseId: "COOP3948" }]);
  assert.deepEqual(res.invalid ?? [], []);
  assert.equal(onlyTerm(res).courseId, "COOP3948");
});

test("ADD_WORK_TERM without a course records none — the honest default", () => {
  const res = run([{ type: "ADD_WORK_TERM", typeId: "coop", semId: "spr2027", duration: 6 }]);
  assert.deepEqual(res.invalid ?? [], []);
  assert.ok(!("courseId" in onlyTerm(res)));
});

test("a work term cannot register an ordinary course", () => {
  // The UI cannot express this — the picker lists only stamped courses — so
  // MCP would otherwise be the one route into a state the app refuses to make.
  const res = run([{ type: "ADD_WORK_TERM", typeId: "coop", semId: "spr2027", duration: 6, courseId: "MATH2331" }]);
  assert.equal(res.invalid.length, 1);
  assert.match(res.invalid[0].reason, /not a work-experience registration/);
  assert.match(res.invalid[0].reason, /ADD_COURSE/, "the error does not say what to do instead");
});

test("a work term cannot register an unknown course", () => {
  const res = run([{ type: "ADD_WORK_TERM", typeId: "coop", semId: "spr2027", duration: 6, courseId: "COOP9999" }]);
  assert.equal(res.invalid.length, 1);
  assert.match(res.invalid[0].reason, /Unknown course/);
});

test("a co-op cannot register an internship course, and vice versa", () => {
  const a = run([{ type: "ADD_WORK_TERM", typeId: "coop", semId: "spr2027", duration: 6, courseId: "COOP3949" }]);
  assert.equal(a.invalid.length, 1);
  assert.match(a.invalid[0].reason, /internship registration/);

  const b = run([{ type: "ADD_WORK_TERM", typeId: "intern", semId: "sumA2027", duration: 2, courseId: "COOP3945" }]);
  assert.equal(b.invalid.length, 1);
  assert.match(b.invalid[0].reason, /co-op registration/);
});

test("UPDATE_WORK_TERM sets, changes and clears the registration", () => {
  const added = run([{ type: "ADD_WORK_TERM", typeId: "coop", semId: "spr2027", duration: 6 }]);
  const id = Object.keys(added.plan.workExperience)[0];

  const set = run([{ type: "UPDATE_WORK_TERM", instanceId: id, courseId: "COOP3945" }], added.plan);
  assert.equal(onlyTerm(set).courseId, "COOP3945");

  const moved = run([{ type: "UPDATE_WORK_TERM", instanceId: id, courseId: "COOP3948" }], set.plan);
  assert.equal(onlyTerm(moved).courseId, "COOP3948");

  // "" clears, and DELETES rather than storing empty — so the share link
  // carries no redundant key and `if (d.courseId)` still reads false.
  const cleared = run([{ type: "UPDATE_WORK_TERM", instanceId: id, courseId: "" }], moved.plan);
  assert.ok(!("courseId" in onlyTerm(cleared)));
});

test("UPDATE_WORK_TERM validates against the term's OWN type", () => {
  // Not against anything in the action — this action cannot change the type,
  // so an internship course must not be reachable by editing a co-op.
  const added = run([{ type: "ADD_WORK_TERM", typeId: "coop", semId: "spr2027", duration: 6 }]);
  const id = Object.keys(added.plan.workExperience)[0];
  const res = run([{ type: "UPDATE_WORK_TERM", instanceId: id, courseId: "COOP3949" }], added.plan);
  assert.equal(res.invalid.length, 1);
  assert.match(res.invalid[0].reason, /internship registration/);
});

test("ADD_COURSE on a work-experience course redirects with the courseId spelled out", () => {
  const res = run([{ type: "ADD_COURSE", courseId: "COOP3948", semId: "spr2027" }]);
  assert.equal(res.invalid.length, 1);
  assert.match(res.invalid[0].reason, /ADD_WORK_TERM/);
  assert.match(res.invalid[0].reason, /courseId:'COOP3948'/,
    "the redirect omits the field that makes the work term count");
});

test("the internship redirect names the internship block, not co-op", () => {
  const res = run([{ type: "ADD_COURSE", courseId: "COOP3949", semId: "sumA2027" }]);
  assert.match(res.invalid[0].reason, /typeId:'intern'/);
});

// ── MCP: the docs an assistant actually reads ───────────────────────

test("ACTION_DOCS no longer promise automatic satisfaction", async () => {
  // The docs are the assistant's whole model of these actions. While they said
  // a co-op "automatically satisfies whichever work-experience course the
  // student's program names", every plan Claude built was wrong in the one way
  // this feature exists to prevent — and no test would have caught it.
  const { ACTION_DOCS } = await import("../../src/adapters/mcp/plannerActionAdapter.js");
  const add = ACTION_DOCS.ADD_WORK_TERM;
  assert.ok(!/automatically satisfies/i.test(add.use), "the stale promise is back in the docs");
  assert.match(add.args, /courseId/);
  assert.match(add.use,  /courseId/);
  assert.match(ACTION_DOCS.UPDATE_WORK_TERM.args, /courseId/);
});
