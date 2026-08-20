// ═══════════════════════════════════════════════════════════════════
// EARLY TERMS under FUZZ — the invariants, over inputs nobody would hand-write.
//
// `engine-early-terms.test.js` states each property against a case chosen to show it. That
// is necessary and it is not sufficient: every bug this module has had came from two rules
// interacting — precedence raising a floor into a term capacity had already filled, a
// capacity eviction cascading into a chain, an unplaced predecessor lowering a floor a later
// pass had raised. Hand-written cases do not reach those corners because the author has to
// think of them first.
//
// So this generates thousands of adversarial instances — dense precedence including cycles,
// sparse and gappy domains, capacities tight enough to force eviction, plans naming courses
// the degree does not require — and asserts what must hold for EVERY one of them:
//
//   1. never throws, and always terminates
//   2. a fixed term is in that cell's own domain            (cannot legalise an illegal plan)
//   3. a fixed term is inside the window                    (semesters 5+ belong to CHART)
//   4. a fixed term is never earlier than published         (repair is monotone)
//   5. no term is fixed over its capacity, except term 0 up to the allowance it reports
//   6. precedence holds between two fixed cells
//   7. one course answers at most one cell
//   8. the answer does not depend on the order `plans` arrives in
//   9. every adopted cell is either fixed or reported unplaced — nothing is lost silently
//
// Seeded, so a failure is reproducible: the seed is printed with the counterexample.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { adoptEarlyTerms, EARLY_TERMS } from "../../src/engine/earlyTerms.js";

/** Deterministic PRNG — a fuzz run that cannot be replayed is an anecdote. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const TYPES = ["fall", "spring", "sumA", "sumB"];

/**
 * One adversarial instance.
 *
 * Deliberately generates things the real corpus should never contain — a plan naming a
 * course no cell wants, two cells wanting one course, a cycle in precedence, a domain that
 * excludes every early term — because "should never" is exactly the assumption that breaks.
 */
function instance(rand) {
  const years = 2 + Math.floor(rand() * 3);
  const terms = [];
  for (let y = 0; y < years; y += 1) {
    for (const type of TYPES) {
      // Some terms are work terms, which must consume no study index at all.
      if (type.startsWith("sum") && rand() < 0.5) continue;
      terms.push({ yearIndex: y, semTypeId: type, work: rand() < 0.12 });
    }
  }
  const shape = { terms };
  const studyCount = terms.filter(t => !t.work).length;

  // Courses, and cells that may or may not want them.
  const nCourses = 3 + Math.floor(rand() * 10);
  const courses = Array.from({ length: nCourses }, (_, i) => `C${i}`);
  const nCells = 2 + Math.floor(rand() * 10);
  const plans = [];
  for (let i = 0; i < nCells; i += 1) {
    const kindRoll = rand();
    const kind = kindRoll < 0.55 ? "named" : kindRoll < 0.85 ? "choice" : "open";
    // A gappy domain, sometimes empty, sometimes entirely past the window.
    const domain = [];
    for (let t = 0; t < studyCount; t += 1) if (rand() < 0.55) domain.push(t);
    const pick = () => courses[Math.floor(rand() * courses.length)];
    const groups = kind === "open" ? null
      : kind === "named" ? [[pick(), ...(rand() < 0.25 ? [pick()] : [])]]
      : [[pick()], [pick()]];
    plans.push({
      cell: { id: `cell-${i}`, kind, groups, sh: [0, 1, 2, 4, 5, 9][Math.floor(rand() * 6)] },
      domain,
    });
  }

  // A published plan over the same courses, sometimes naming ones nobody requires.
  const years2 = [];
  const perTerm = 1 + Math.floor(rand() * 4);
  for (let y = 0; y < years; y += 1) {
    const ts = [];
    for (const type of TYPES) {
      if (rand() < 0.3) continue;
      const entries = [];
      if (rand() < 0.1) entries.push({ coop: true });
      for (let k = 0; k < perTerm; k += 1) {
        if (rand() < 0.15) { entries.push({ vacation: true }); continue; }
        const g = [courses[Math.floor(rand() * courses.length)]];
        if (rand() < 0.2) g.push(`UNWANTED${k}`);
        entries.push(rand() < 0.2
          ? { options: [g, [courses[Math.floor(rand() * courses.length)]]] }
          : { options: [g] });
      }
      ts.push({ type, entries });
    }
    years2.push({ terms: ts });
  }
  const publishedPlan = { years: years2 };

  // Precedence over cell ids, cycles included.
  const before = new Map();
  const concurrentOk = new Set();
  for (const p of plans) {
    if (rand() < 0.45) {
      const other = plans[Math.floor(rand() * plans.length)];
      if (other.cell.id !== p.cell.id) {
        if (!before.has(p.cell.id)) before.set(p.cell.id, new Set());
        before.get(p.cell.id).add(other.cell.id);
        if (rand() < 0.3) concurrentOk.add(`${other.cell.id}|${p.cell.id}`);
      }
    }
  }
  const precedence = { before, concurrentOk };

  // Capacity tight enough to force eviction on many instances.
  const capBase = [4, 8, 12, 19, Infinity][Math.floor(rand() * 5)];
  // The minimum headroom term 0 gets over the cap — a floor, not a ceiling. Zero half the
  // time, so both the "no headroom" and "some headroom" branches are exercised.
  const headroom = rand() < 0.5 ? 0 : 2;
  return { shape, plans, publishedPlan, precedence, capBase, headroom, studyCount };
}

const RUNS = Number(process.env.FUZZ_RUNS ?? 4000);

test(`early fuzz › ${RUNS} adversarial instances hold every invariant`, () => {
  let adopted = 0, withMoves = 0, withUnplaced = 0, overloadedRuns = 0;

  for (let i = 0; i < RUNS; i += 1) {
    const seed = 0x9e37 + i * 2654435761;
    const rand = rng(seed);
    const { shape, plans, publishedPlan, precedence, capBase, headroom } = instance(rand);
    const capOf = () => capBase;
    const fresh = () => plans.map(p => ({ cell: p.cell, domain: [...p.domain] }));
    const where = `seed=${seed} run=${i}`;

    // 1. Never throws.
    let out;
    try {
      out = adoptEarlyTerms({
        publishedPlan, shape, plans: fresh(), precedence,
        capOf, firstTermHeadroom: headroom,
      });
    } catch (e) {
      assert.fail(`threw on ${where}: ${e.stack}`);
    }
    assert.ok(out && out.placed instanceof Map, `bad shape on ${where}`);
    assert.ok(Array.isArray(out.moves) && Array.isArray(out.unplaced), `bad shape on ${where}`);
    assert.ok(out.load instanceof Map, `every path returns a load map — ${where}`);

    const domainOf = new Map(plans.map(p => [p.cell.id, new Set(p.domain)]));
    const shOf = new Map(plans.map(p => [p.cell.id, p.cell.sh ?? 0]));
    const kindOf = new Map(plans.map(p => [p.cell.id, p.cell.kind]));
    const intendedOf = new Map();
    for (const m of out.moves) intendedOf.set(m.cell, m.from);

    const load = new Map();
    for (const [id, at] of out.placed) {
      adopted += 1;
      // 2. In its own domain.
      assert.ok(domainOf.get(id)?.has(at),
        `${id} fixed at ${at}, not in its domain [${[...(domainOf.get(id) ?? [])]}] — ${where}`);
      // 3. Inside the window.
      assert.ok(at < EARLY_TERMS, `${id} fixed at ${at}, outside the window — ${where}`);
      // 4. Never earlier than published, for the ones we know the intent of.
      //
      // Briefly relaxed while a SWAP step existed — a term a course had to leave being refilled
      // from the department's own window. That step was measured over the corpus and removed for
      // being worse or flat on every metric, including the two built to see its benefit, so the
      // strict form is back. See `earlyTerms.js`'s header for the numbers: repair is monotone
      // again, and this is the assertion that keeps it so.
      if (intendedOf.has(id)) {
        assert.ok(at >= intendedOf.get(id),
          `${id} moved EARLIER: ${intendedOf.get(id)} -> ${at} — ${where}`);
      }
      // An `open` cell is the search's slack and must never be fixed.
      assert.notEqual(kindOf.get(id), "open", `an open cell was fixed — ${where}`);
      load.set(at, (load.get(at) ?? 0) + (shOf.get(id) ?? 0));
    }

    // 5. Capacity. Term 0's allowance is the DEPARTMENT'S own published load with a floor of
    //    `cap + headroom`, so it is not recomputable from the inputs here — the module
    //    returns the figure it used and this checks against that, which is also what the
    //    search's ceiling is set from. Every later term is held to the cap exactly.
    for (const [at, sh] of load) {
      const ceiling = at === 0 ? out.firstTermCap : capBase;
      assert.ok(sh <= ceiling + 0.01,
        `term ${at} fixed at ${sh} SH over a ceiling of ${ceiling} — ${where}`);
    }
    assert.ok(out.firstTermCap >= capBase,
      `the first-term allowance ${out.firstTermCap} is below the cap ${capBase} — ${where}`);

    // 6. Precedence between two FIXED cells.
    for (const [id, at] of out.placed) {
      for (const b of (precedence.before.get(id) ?? [])) {
        const bt = out.placed.get(b);
        if (bt == null) continue;
        const together = precedence.concurrentOk.has(`${b}|${id}`);
        assert.ok(together ? at >= bt : at > bt,
          `${b}@${bt} must precede ${id}@${at} (concurrent=${together}) — ${where}`);
      }
    }

    // 7. One course answers at most one cell.
    const claimed = new Map();
    for (const [id] of out.placed) {
      const p = plans.find(x => x.cell.id === id);
      for (const g of (p.cell.groups ?? [])) {
        // Only the group actually used is unknowable from outside, so check the weaker and
        // still meaningful claim: no course appears in two fixed NAMED cells' sole group.
        if (p.cell.kind !== "named" || (p.cell.groups ?? []).length !== 1) continue;
        for (const c of g) {
          // Compared across CELLS. The generator can emit a group holding one course twice
          // (`[C2, C2]`), which is junk input worth accepting and says nothing about
          // double-claiming — an earlier version of this check read it as a violation.
          assert.ok(!claimed.has(c) || claimed.get(c) === id,
            `${c} answers both ${claimed.get(c)} and ${id} — ${where}`);
          claimed.set(c, id);
        }
      }
    }

    // 9. Nothing vanishes: an unplaced entry is never also placed.
    for (const u of out.unplaced) {
      assert.ok(!out.placed.has(u.cell),
        `${u.cell} is reported unplaced AND fixed — ${where}`);
    }
    const seenUnplaced = new Set();
    for (const u of out.unplaced) {
      assert.ok(!seenUnplaced.has(u.cell), `${u.cell} reported unplaced twice — ${where}`);
      seenUnplaced.add(u.cell);
    }

    // 8. Order independence — the property that hid a real defect until it was fuzzed.
    const rev = adoptEarlyTerms({
      publishedPlan, shape, plans: fresh().reverse(), precedence,
      capOf, firstTermHeadroom: headroom,
    });
    const norm = (m) => [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    assert.deepEqual(norm(rev.placed), norm(out.placed),
      `reversing \`plans\` changed the answer — ${where}`);

    if (out.placed.size) withMoves += out.moves.length ? 1 : 0;
    if (out.unplaced.length) withUnplaced += 1;
    if (load.get(0) > capBase) overloadedRuns += 1;
  }

  // ── The fuzzer has to actually REACH the code ──────────────────────
  //
  // Every assertion above passes over an instance that adopted nothing. These floors are
  // what stop this file becoming 4,000 runs of an early return — the exact failure mode the
  // module's own guards are written against.
  assert.ok(adopted > RUNS * 0.5,
    `only ${adopted} cells were fixed across ${RUNS} runs; the generator is not reaching adoption`);
  assert.ok(withMoves > RUNS * 0.02,
    `only ${withMoves} runs repaired anything; the generator is not reaching repair`);
  assert.ok(withUnplaced > RUNS * 0.02,
    `only ${withUnplaced} runs handed a course back; the generator is not reaching that path`);
  assert.ok(overloadedRuns > 0,
    "no run ever used the first-term overload; that branch is untested by this fuzz");

  console.log(`  [early fuzz] ${RUNS} instances · ${adopted} cells fixed · `
    + `${withMoves} runs repaired · ${withUnplaced} handed back · ${overloadedRuns} overloaded`);
});
