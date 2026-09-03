// ═══════════════════════════════════════════════════════════════════
// CONTRACT: the thing that tells us the pipeline broke must not break
//
// ── The bug this exists for ─────────────────────────────────────────
//
// On 2026-09-01 all three data pipelines failed. One opened an alert issue.
// The other two died inside the alert action itself:
//
//     RequestError [HttpError]: Validation Failed:
//       {"resource":"Label","code":"already_exists","field":"name"}
//     Error: Unhandled error: HttpError: Validation Failed
//
// Two independent defects in one line, `safe(getLabel, await safe(createLabel,
// null))`:
//
//   1. arguments are evaluated before the call, so the "fallback" ran on EVERY
//      invocation — every alert tried to create a label that already existed;
//   2. `safe` was written `try { return fn() } catch`, synchronously, while
//      every fn passed to it is `async`. A rejected promise is not thrown
//      inside that try. So the 422 escaped to the caller's `await`, where
//      nothing was guarding, and took the whole alert down.
//
// The failures were real, the data was a month stale, and the channel built to
// say so said nothing. That is the worst possible failure mode for an alert:
// it is only ever exercised on the day something else is already wrong.
//
// ── Why it executes the action's script ─────────────────────────────
//
// The script is JavaScript embedded in YAML, run by actions/github-script, and
// nothing in this repo has ever executed a line of it. Both bugs above are
// invisible to review (the first reads as an idiom, the second as a helper)
// and neither shows up until an API call fails — which is precisely the
// circumstance the action exists for. So this pulls the real script out of the
// real action.yml and runs it against a stub `github` whose calls can be made
// to fail on demand, and asserts on what reached the API.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ACTION = join(ROOT, ".github/actions/pipeline-alert/action.yml");

process.env.ALERT_RETRY_MS = "0";   // the jobs-API retry, without the wait

/** An HttpError shaped the way Octokit shapes one. */
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/**
 * The action's script, with the `${{ toJSON(inputs.x) }}` holes filled the way
 * the runner fills them, wrapped the way actions/github-script wraps it.
 */
function loadScript(inputs) {
  const doc = yaml.load(readFileSync(ACTION, "utf8"));
  const step = doc.runs.steps.find(s => s.uses?.startsWith("actions/github-script"));
  assert.ok(step, "pipeline-alert no longer runs actions/github-script");
  let src = step.with.script;
  for (const [key, value] of Object.entries(inputs)) {
    // `${{ toJSON(inputs.pipeline) }}` and `${{ toJSON(inputs['data-paths']) }}`
    const pattern = new RegExp(`\\$\\{\\{\\s*toJSON\\(inputs(?:\\.${key}|\\['${key}'\\])\\)\\s*\\}\\}`, "g");
    src = src.replace(pattern, JSON.stringify(value));
  }
  const leftover = src.match(/\$\{\{[^}]*\}\}/);
  assert.equal(leftover, null, `unfilled workflow expression in the script: ${leftover?.[0]}`);
  // `core` is a global in actions/github-script and the script uses it, so the
  // harness must supply it — otherwise a branch that only logs would throw
  // ReferenceError here while working in production, and the test would be
  // lying in the more dangerous direction.
  // eslint-disable-next-line no-new-func
  return new Function("github", "context", "require", "core",
    `return (async () => {\n${src}\n})();`);
}

/** A github stub that records every call and can be told to fail. */
function stubGithub(overrides = {}) {
  const calls = [];
  const record = (name, result) => async (args) => {
    calls.push({ name, args });
    if (overrides[name]) return overrides[name](args, calls);
    return result;
  };
  const github = {
    rest: {
      actions: {
        listJobsForWorkflowRun: record("listJobsForWorkflowRun", {
          data: { jobs: [{ name: "job", steps: [{ name: "Commit and push", conclusion: "failure" }] }] },
        }),
      },
      repos: {
        listCommits: record("listCommits", {
          data: [{ commit: { committer: { date: "2026-08-03T00:00:00Z" } } }],
        }),
      },
      issues: {
        listForRepo: record("listForRepo", { data: [] }),
        getLabel:    record("getLabel", { data: { name: "pipeline-failure" } }),
        createLabel: record("createLabel", { data: {} }),
        create:      record("create", { data: { number: 9 } }),
        update:      record("update", { data: {} }),
        createComment: record("createComment", { data: {} }),
      },
    },
  };
  return { github, calls, named: (n) => calls.filter(c => c.name === n) };
}

const CONTEXT = {
  repo: { owner: "nayugu", repo: "nu-map" },
  runId: 123456,
  serverUrl: "https://github.com",
};

const INPUTS = {
  pipeline: "Course data",
  key: "courses",
  state: "failed",
  logs: "",
  "data-paths": "public/northeastern/catalog-courses.json",
  "check-first": "- check the catalog markup",
};

const run = async (inputs, overrides) => {
  const s = stubGithub(overrides);
  s.warnings = [];
  const core = {
    warning: (m) => s.warnings.push(String(m)),
    info: () => {}, notice: () => {}, error: () => {}, setOutput: () => {},
  };
  await loadScript({ ...INPUTS, ...inputs })(s.github, CONTEXT, require, core);
  return s;
};

// Node's ESM has no `require`; the script uses it for node:fs.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

test("an existing label does not stop the alert (the 2026-09-01 failure)", async () => {
  const s = await run({}, {
    // getLabel succeeds — the label is already there, as it is on every run
    // after the first — and createLabel would 422 if anything called it.
    createLabel: () => { throw httpError(422, 'Validation Failed: {"resource":"Label","code":"already_exists"}'); },
  });
  assert.equal(s.named("createLabel").length, 0, "createLabel must not be called when the label exists");
  assert.equal(s.named("create").length, 1, "the issue must still be opened");
});

test("a missing label is created, once", async () => {
  const s = await run({}, {
    getLabel: () => { throw httpError(404, "Not Found"); },
  });
  assert.equal(s.named("createLabel").length, 1);
  assert.equal(s.named("create").length, 1);
});

test("a label endpoint that 500s still lets the alert through", async () => {
  const s = await run({}, {
    getLabel:    () => { throw httpError(500, "Server Error"); },
    createLabel: () => { throw httpError(500, "Server Error"); },
  });
  assert.equal(s.named("create").length, 1, "a broken label API must not silence the alert");
});

// Every one of these used to be able to take the whole action down, because
// `safe` could not catch a rejected promise.
for (const endpoint of ["listJobsForWorkflowRun", "listCommits", "listForRepo"]) {
  test(`a failing ${endpoint} degrades the body but still opens the issue`, async () => {
    const s = await run({}, { [endpoint]: () => { throw httpError(403, "Forbidden"); } });
    assert.equal(s.named("create").length, 1, `${endpoint} failing must not silence the alert`);
  });
}

test("the failed step is named, even when the jobs API lags a call behind", async () => {
  let seen = 0;
  const s = await run({}, {
    listJobsForWorkflowRun: () => {
      seen++;
      // First call: the API has not yet recorded the step that just failed —
      // exactly what produced an alert with no "Failed step" line on
      // 2026-09-01.
      if (seen === 1) return { data: { jobs: [{ name: "job", steps: [{ name: "Commit and push", conclusion: null }] }] } };
      return { data: { jobs: [{ name: "job", steps: [{ name: "Commit and push", conclusion: "failure" }] }] } };
    },
  });
  assert.ok(seen >= 2, "the jobs API should have been retried");
  assert.match(s.named("create")[0].args.body, /Failed step:.*Commit and push/);
});

test("a chatty log cannot push the body past GitHub's 65,536-character limit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "numap-alert-"));
  const log = join(dir, "huge.txt");
  // One 400 kB line: the shape a stack trace or a dumped JSON row takes, and
  // the shape 40-line tailing does not protect against.
  writeFileSync(log, `${"x".repeat(400_000)}\n`);
  const s = await run({ logs: `${log}\n${log}\n${log}` });
  const body = s.named("create")[0].args.body;
  assert.ok(body.length < 65_536, `body was ${body.length} characters`);
  assert.match(body, /more characters/);
});

test("a second failure updates the open issue instead of opening another", async () => {
  const s = await run({}, {
    listForRepo: () => ({ data: [{ number: 2, body: "<!-- pipeline-alert:courses -->\nold" }] }),
  });
  assert.equal(s.named("create").length, 0, "a duplicate issue must not be opened");
  assert.equal(s.named("update").length, 1);
  assert.equal(s.named("createComment").length, 1);
});

test("recovery closes the open issue, and does nothing when there is none", async () => {
  const closed = await run({ state: "recovered" }, {
    listForRepo: () => ({ data: [{ number: 2, body: "<!-- pipeline-alert:courses -->\nold" }] }),
  });
  assert.equal(closed.named("update")[0].args.state, "closed");

  const quiet = await run({ state: "recovered" });
  assert.equal(quiet.named("update").length, 0);
  assert.equal(quiet.named("create").length, 0);
});

// ── The `stale` state: the run that never happened ──────────────────
// Raised from outside by data-staleness.yml, because a run cancelled while
// pending executes no steps and so cannot report anything about itself.
test("stale opens an issue that says it did not run, not that it failed", async () => {
  const s = await run({ state: "stale", "check-first": "- last success 96 days ago" });
  assert.equal(s.named("create").length, 1);
  const { title, body, labels } = s.named("create")[0].args;
  assert.match(title, /has stopped running/);
  assert.doesNotMatch(title, /failing/, "it did not fail — it did not run");
  assert.match(body, /<!-- pipeline-alert:courses -->/, "must carry the marker so a later success closes it");
  assert.match(body, /last success 96 days ago/, "the watchdog's finding must reach the reader");
  assert.deepEqual(labels, ["pipeline-failure"]);
});

test("stale stays quiet when it cannot tell whether one is already open", async () => {
  // A weekly watchdog that duplicates itself on a transient 403 becomes noise,
  // and staleness is measured in weeks — nothing is lost by looking again.
  const s = await run({ state: "stale" }, {
    listForRepo: () => { throw httpError(403, "Forbidden"); },
  });
  assert.equal(s.named("create").length, 0);
  assert.ok(s.warnings.some(w => /cannot tell|already reported/i.test(w)),
    "it must say why it did nothing");
});

test("a FAILURE still speaks up when it cannot tell — being heard beats being tidy", async () => {
  const s = await run({ state: "failed" }, {
    listForRepo: () => { throw httpError(403, "Forbidden"); },
  });
  assert.equal(s.named("create").length, 1,
    "a duplicate failure issue is a far smaller cost than a silent broken pipeline");
});

test("a log path that cannot be read does not take the alert down", async () => {
  // `logs:` pointing at a directory (or a dangling symlink) throws from
  // readFileSync, and the body is built outside `safe`.
  const dir = mkdtempSync(join(tmpdir(), "numap-alert-dir-"));
  const s = await run({ logs: dir });
  assert.equal(s.named("create").length, 1);
  assert.match(s.named("create")[0].args.body, /could not be read/);
  rmSync(dir, { recursive: true, force: true });
});

test("stale never overwrites an open failure report", async () => {
  const s = await run({ state: "stale" }, {
    listForRepo: () => ({ data: [{ number: 3, body: "<!-- pipeline-alert:courses -->\nwith logs" }] }),
  });
  assert.equal(s.named("create").length, 0);
  assert.equal(s.named("update").length, 0, "a failure report carries logs; staleness carries less");
  assert.equal(s.named("createComment").length, 0);
});

test("the issue is found by its marker, so two pipelines never share one", async () => {
  const s = await run({ key: "majors", pipeline: "Program requirements" }, {
    listForRepo: () => ({ data: [{ number: 2, body: "<!-- pipeline-alert:courses -->\nsomeone else's" }] }),
  });
  assert.equal(s.named("update").length, 0, "the courses issue must not be hijacked");
  assert.equal(s.named("create").length, 1);
  assert.match(s.named("create")[0].args.body, /<!-- pipeline-alert:majors -->/);
});
