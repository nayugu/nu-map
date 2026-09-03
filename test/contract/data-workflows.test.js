// ═══════════════════════════════════════════════════════════════════
// CONTRACT: the unattended data workflows are wired the way they claim
//
// ── The bugs this exists for ────────────────────────────────────────
//
// Three pipelines push straight to main with nobody watching, and every defect
// found in them on 2026-09-01 was a WIRING defect that YAML-parses perfectly:
//
//   · `defaults: run: shell: bash` absent, so `node x.js | tee log` reported
//     tee's success and nineteen rails could not fail a job;
//   · the alert listed six of the ten logs the job writes, and the four it
//     omitted included the CHART gate — the alert for a failed run shipped
//     every log except the failing step's;
//   · the run summary printed three;
//   · a staged path list that had drifted away from what the scripts write.
//
// None of that is visible to a YAML parser and none of it is visible in review
// — you have to hold two lists side by side and notice one is shorter. That is
// exactly what a test is for.
//
// The rules below are deliberately written as "X must agree with Y", not as
// "X must equal this literal", so they keep working as the pipelines change:
// add a scrape step tomorrow and the log-coverage rule fails until its output
// reaches the alert and the summary.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const wfPath = (f) => join(ROOT, ".github/workflows", f);
const load = (f) => yaml.load(readFileSync(wfPath(f), "utf8"));
const raw = (f) => readFileSync(wfPath(f), "utf8");

// `on:` is the YAML 1.1 boolean `true`, so it parses as the key `true`.
const triggers = (doc) => doc.on ?? doc[true] ?? {};
const steps = (doc) => Object.values(doc.jobs).flatMap(j => j.steps ?? []);
const runs = (doc) => steps(doc).map(s => s.run).filter(Boolean);

/** Workflows that scrape, write data and push to main unattended. */
const ALERTING = ["update-courses.yml", "update-majors.yml", "update-grad-majors.yml"];
/** Those, plus the legacy manual one that also writes data and pushes. */
const PIPEFAIL = [...ALERTING, "update-nupath.yml"];

// ── The shell, which is what makes every rail below it real ─────────
for (const f of PIPEFAIL) {
  test(`${f}: names the shell, because the default one has no pipefail`, () => {
    const doc = load(f);
    assert.equal(doc.defaults?.run?.shell, "bash",
      `${f} writes 'node … | tee log'; without 'shell: bash' the step's status is tee's `
      + `and every process.exit(1) in those scripts is discarded`);
  });
}

for (const f of ALERTING) {
  test(`${f}: proves pipefail at runtime instead of trusting the YAML`, () => {
    const first = steps(load(f))[0];
    assert.match(first.name ?? "", /pipefail|broken pipe/i,
      "the first step should be the pipefail check, before anything can depend on it");
    assert.match(first.run, /\(exit 3\)\s*\|\s*tee/,
      "the check must be a pipeline whose LEFT side fails — that is the property at stake");
    assert.match(first.run, /::error::/, "a failure here must say what it means");
  });
}

/** Every /tmp log a workflow's steps actually write. */
function teedLogs(doc) {
  // Read from the parsed `run` bodies, not the raw file: a `| tee /tmp/x-log.txt`
  // inside a YAML comment is not a log anybody writes, and scanning the text
  // reported one. Lines that are shell comments are dropped for the same reason.
  const teed = runs(doc)
    .flatMap(r => r.split("\n"))
    .filter(l => !/^\s*#/.test(l))
    // `[\w./-]+` rather than `\S+`: `tee /dev/null; then` would otherwise
    // capture the semicolon and slip past the /dev/null filter below.
    .flatMap(l => [...l.matchAll(/\|\s*tee\s+(\/[\w./-]+)/g)].map(m => m[1]));
  return [...new Set(teed)].filter(p => p !== "/dev/null");
}

// Every log a job writes must at least reach its run summary, alert or not.
for (const f of PIPEFAIL) {
  test(`${f}: every 'tee' target is printed in the run summary`, () => {
    const doc = load(f);
    const summary = steps(doc).find(s => s.name === "Summary");
    assert.ok(summary, `${f} has no Summary step`);
    for (const log of teedLogs(doc)) {
      assert.ok(summary.run.includes(log),
        `${f} writes ${log} but its Summary does not print it — the step that failed is then `
        + `the one step whose output nobody can see`);
    }
  });
}

// ── Every log the job writes must reach the people reading the failure ──
for (const f of ALERTING) {
  test(`${f}: every 'tee' target reaches both the alert and the summary`, () => {
    const doc = load(f);
    const unique = teedLogs(doc);
    assert.ok(unique.length >= 3, `only ${unique.length} logs found — did the regex stop matching?`);

    const alert = steps(doc).find(s => s.uses === "./.github/actions/pipeline-alert"
      && s.with?.state === "failed");
    assert.ok(alert, `${f} has no failure alert`);
    const listed = (alert.with.logs ?? "").split("\n").map(s => s.trim()).filter(Boolean);

    const summary = steps(doc).find(s => s.name === "Summary");
    assert.ok(summary, `${f} has no Summary step`);

    for (const log of unique) {
      assert.ok(listed.includes(log),
        `${f} writes ${log} but its alert does not attach it — that is how the CHART gate's `
        + `output went missing from the one report anybody reads`);
      assert.ok(summary.run.includes(log), `${f} writes ${log} but its Summary does not print it`);
    }
    // …and nothing listed that is never written, which is the other direction
    // of the same drift and shows up as a silently empty section.
    for (const log of listed) {
      assert.ok(unique.includes(log), `${f} attaches ${log} to its alert but never writes it`);
    }
  });

  test(`${f}: can actually open the issue it promises`, () => {
    const doc = load(f);
    assert.equal(doc.permissions?.issues, "write",
      "the alert opens and closes an issue; without this permission it 403s at the moment it matters");
    for (const s of steps(doc)) {
      if (typeof s.uses === "string" && s.uses.startsWith("./")) {
        assert.ok(existsSync(join(ROOT, s.uses)), `${f} uses ${s.uses}, which does not exist`);
      }
    }
  });

  test(`${f}: a hung job cannot hold the concurrency group open indefinitely`, () => {
    const doc = load(f);
    for (const [name, job] of Object.entries(doc.jobs)) {
      assert.ok(Number.isFinite(job["timeout-minutes"]),
        `${f} job '${name}' has no timeout-minutes, so GitHub's six-hour default applies — and `
        + `these share a concurrency group, so a wedged job blocks the others for all six`);
      assert.ok(job["timeout-minutes"] <= 240,
        `${f} job '${name}' may run ${job["timeout-minutes"]} minutes; the longest measured run `
        + `is 88, and this number's job is to bound how long it can block the others`);
    }
    assert.equal(doc.concurrency?.group, "nu-map-data");
    assert.equal(doc.concurrency?.["cancel-in-progress"], false,
      "cancelling a data job mid-push is how a half-written commit happens");
  });
}

// ── The watchdog must be talking about the same pipelines ───────────
test("data-staleness: every leg names a real workflow and shares its alert identity", () => {
  const doc = load("data-staleness.yml");
  const matrix = Object.values(doc.jobs)[0].strategy.matrix.include;
  assert.equal(matrix.length, ALERTING.length,
    "every unattended pipeline needs a watchdog leg, or its silence goes unnoticed");

  for (const leg of matrix) {
    assert.ok(existsSync(wfPath(leg.workflow)),
      `the watchdog polls ${leg.workflow}, which does not exist — it would report the pipeline `
      + `as permanently stale, or silently never check it`);

    // The staleness issue and the failure issue must be the SAME issue: they
    // are found by `<!-- pipeline-alert:${key} -->`, and a later success closes
    // whatever it finds. A key that disagrees means the watchdog opens a second
    // issue that nothing ever closes.
    const target = load(leg.workflow);
    const alert = steps(target).find(s => s.uses === "./.github/actions/pipeline-alert");
    assert.ok(alert, `${leg.workflow} has no pipeline-alert step to share an identity with`);
    assert.equal(leg.key, alert.with.key,
      `the watchdog uses key '${leg.key}' but ${leg.workflow} uses '${alert.with.key}' — the `
      + `staleness issue would never be closed by a later success`);
    assert.equal(leg.pipeline, alert.with.pipeline, "the two issues would disagree about the name");

    assert.ok(leg.maxAgeDays > 31, `${leg.key}: a tolerance of ${leg.maxAgeDays} days fires on a `
      + `merely delayed run — GitHub delivered these five hours late on 2026-09-01`);
    assert.ok(leg.maxAgeDays < 100, `${leg.key}: ${leg.maxAgeDays} days lets a bimonthly pipeline `
      + `miss two whole cycles before anyone is told`);
  }
});

test("data-staleness: reports on every leg even when an earlier one is stale", () => {
  const doc = load("data-staleness.yml");
  const job = Object.values(doc.jobs)[0];
  assert.equal(job.strategy["fail-fast"], false,
    "fail-fast would let the first stale pipeline hide the other two");
  assert.equal(doc.permissions?.issues, "write");
});

// ── Deprecation ratchet ─────────────────────────────────────────────
test("no workflow reaches for an action GitHub is forcing onto a newer Node", () => {
  const offenders = [];
  for (const f of [...PIPEFAIL, "data-staleness.yml", "test.yml", "deploy-pages.yml",
                   "data-changes.yml", "maintenance.yml", "catalog-rotate.yml"]) {
    for (const m of raw(f).matchAll(/uses:\s*(actions\/[\w-]+)@(v\d+)/g)) {
      const [, action, version] = m;
      const floor = { "actions/checkout": 5, "actions/setup-node": 5, "actions/github-script": 8 }[action];
      if (floor && Number(version.slice(1)) < floor) offenders.push(`${f}: ${action}@${version}`);
    }
  }
  assert.deepEqual(offenders, [],
    "these target Node 20, which GitHub currently FORCES onto Node 24 with a warning and will "
    + "eventually fail outright — on a scheduled unattended run, not on someone's PR");
});

// ── Anything that pushes to main must push the way we learned to ────
//
// Four separate workflows commit scraped data straight to main. The 2026-09-01
// failure was in the shape of that step, not in any one file, so the shape is
// what gets pinned — otherwise the next one written copies the old pattern and
// rediscovers exit 128 at 06:00 on the first of some month.
for (const f of PIPEFAIL) {
  test(`${f}: commits the way the 2026-09-01 failure taught`, () => {
    const doc = load(f);
    const step = steps(doc).find(s => s.name === "Commit and push");
    assert.ok(step, `${f} has no "Commit and push" step`);
    const src = step.run;

    assert.match(src, /git add -A --/,
      "stage by AREA, not by filename — a hand-kept list drifts from what the scripts write, "
      + "which is what dropped all-courses.json for a month");
    assert.match(src, /git status --porcelain/,
      "a tracked file left unstaged must stop the run and name itself, not surface as a "
      + "rebase error 40 lines later");
    assert.match(src, /::error::/, "and it must say so as an annotation");
    assert.match(src, /--autostash/,
      "so a stray unstaged file can never again turn a good scrape into exit 128");
    assert.match(src, /for attempt in/,
      "a human pushing between our pull and our push must not cost a cycle of data");
    assert.match(src, /git diff --cached --quiet/,
      "'did this run produce anything' is decided AFTER staging: `git diff` alone cannot see "
      + "the untracked directory a new catalog edition arrives as");

    // The old gate, by name. It parsed fine and threw away untracked work.
    assert.ok(!steps(doc).some(s => s.name === "Check for changes"),
      `${f} still has the pre-staging 'Check for changes' gate, which is blind to untracked files`);
  });
}

// ── The watchdog's LOGIC, not just its wiring ───────────────────────
//
// It decides, from the Actions API, whether a pipeline has stopped running —
// and it is the only alarm for a run that never happened, so a defect in it is
// silent by construction. Same treatment as the alert action: pull the real
// script out of the real workflow and run it against a stub.
function stalenessScript() {
  const doc = load("data-staleness.yml");
  const step = steps(doc).find(s => s.id === "age");
  assert.ok(step, "data-staleness has no 'age' step");
  // eslint-disable-next-line no-new-func
  return new Function("github", "context", "core", "process",
    `return (async () => {\n${step.with.script}\n})();`);
}

/** Run it with a stubbed API and env, returning the outputs it set. */
async function checkAge({ runs, error, workflow = "update-courses.yml", maxAge = 40 }) {
  const outputs = {};
  const core = {
    setOutput: (k, v) => { outputs[k] = v; },
    warning: () => {}, info: () => {},
  };
  const github = {
    rest: { actions: { listWorkflowRuns: async () => {
      if (error) throw error;
      return { data: { workflow_runs: runs } };
    } } },
  };
  const ctx = { repo: { owner: "nayugu", repo: "nu-map" } };
  const env = { WORKFLOW: workflow, MAX_AGE_DAYS: String(maxAge) };
  await stalenessScript()(github, ctx, core, { env });
  return outputs;
}

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const run = (iso) => ({ created_at: iso, html_url: "https://example.invalid/run" });

test("watchdog: the script is actually given the matrix values it reads", () => {
  // The logic tests below inject `process.env` directly, so they would keep
  // passing if the step stopped declaring it — and the script would then poll
  // `workflow_id: undefined` against a NaN tolerance and quietly never alarm.
  const step = steps(load("data-staleness.yml")).find(s => s.id === "age");
  const src = step.with.script;
  for (const name of [...src.matchAll(/process\.env\.(\w+)/g)].map(m => m[1])) {
    assert.ok(step.env && name in step.env,
      `the script reads process.env.${name}, which the step does not declare`);
    assert.match(String(step.env[name]), /\$\{\{\s*matrix\./,
      `${name} should come from the matrix, or every leg checks the same pipeline`);
  }
});

test("watchdog: a pipeline that ran recently is not stale", async () => {
  const out = await checkAge({ runs: [run(daysAgo(3))] });
  assert.equal(out.stale, "false");
  assert.match(out.detail, /Last successful run/);
});

test("watchdog: a pipeline past its tolerance is stale", async () => {
  const out = await checkAge({ runs: [run(daysAgo(41))], maxAge: 40 });
  assert.equal(out.stale, "true");
  assert.match(out.detail, /41 days ago/);
});

test("watchdog: the tolerance boundary is not an alarm", async () => {
  // `days > maxAge`, so exactly at the limit is still fine. Worth pinning: an
  // off-by-one here fires every cycle and trains people to ignore the issue.
  assert.equal((await checkAge({ runs: [run(daysAgo(40))], maxAge: 40 })).stale, "false");
});

test("watchdog: a workflow that no longer exists is the loudest case, not a skip", async () => {
  const err = Object.assign(new Error("Not Found"), { status: 404 });
  const out = await checkAge({ error: err });
  assert.equal(out.stale, "true");
  assert.match(out.detail, /does not exist/);
});

test("watchdog: a pipeline that has never succeeded is stale", async () => {
  const out = await checkAge({ runs: [] });
  assert.equal(out.stale, "true");
  assert.match(out.detail, /never completed successfully/);
});

test("watchdog: an API failure fails the job rather than reporting health", async () => {
  // The one thing this must never do is answer "not stale" because it could not
  // ask. A 500 has to surface as a red run.
  const err = Object.assign(new Error("Server Error"), { status: 500 });
  await assert.rejects(() => checkAge({ error: err }), /Server Error/);
});

// ── The scheduled order these files describe ────────────────────────
test("the data pipelines are staggered wide enough to be worth staggering", () => {
  const cronOf = (f) => triggers(load(f)).schedule?.[0]?.cron;
  const hourOf = (c) => Number(c.split(" ")[1]);
  const courses = hourOf(cronOf("update-courses.yml"));
  const majors  = hourOf(cronOf("update-majors.yml"));
  const grad    = hourOf(cronOf("update-grad-majors.yml"));

  assert.ok(majors - courses >= 4,
    `courses at ${courses}:00 and majors at ${majors}:00 leaves under four hours; the longest `
    + `course run measured is 88 minutes and GitHub's delivery drifts by hours`);
  assert.ok(grad - majors >= 2, `majors at ${majors}:00 and graduate at ${grad}:00 is too close`);

  // The watchdog must not be scheduled inside the window it is watching, or it
  // reads a pipeline as stale while that pipeline is mid-run.
  const watchdog = triggers(load("data-staleness.yml")).schedule?.[0]?.cron;
  assert.match(watchdog, /\* \* [1-7]$/, "the watchdog should run weekly, not on the 1st");
});
