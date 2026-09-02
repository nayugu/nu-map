// ═══════════════════════════════════════════════════════════════════
// CONTRACT: the data pipelines can actually commit what they scraped
//
// ── The bug this exists for ─────────────────────────────────────────
//
// On 2026-09-01 all three data workflows scraped cleanly and all three failed,
// in the same place, with the same four lines:
//
//     [main eae4b4c] data: update major requirements (650 programs) [2026-09]
//      550 files changed, 1601 insertions(+), 1846 deletions(-)
//     error: cannot pull with rebase: You have unstaged changes.
//     Error: Process completed with exit code 128.
//
// Each `Commit and push` step staged a hand-kept list of filenames, and each
// job wrote a tracked file the list had never been told about — update-courses
// began rewriting `all-courses.json` when the Tableau step landed on
// 2026-08-02 (the filename had been dropped from the list in May), and each
// majors job rewrites the OTHER tree's verification metadata, because
// verify-majors checks every program against the shared course catalog. Git
// then refuses to rebase at all while anything is dirty, so a 90-minute scrape
// died at the last step and the month's data never landed. Nobody noticed for
// a month, because the alert action crashed too.
//
// ── Why it drives the real YAML instead of asserting about it ───────
//
// The failure was in shell, in a string, inside a YAML file that nothing in
// this repo ever executed before a scheduled run did it unattended at 06:00
// UTC. A test that greps the workflow for "--autostash" would have passed
// against every broken version of this step. So this extracts the actual
// `run:` script out of the actual workflow file, and runs it — under the same
// `bash -eo pipefail` GitHub selects for `shell: bash` — against a throwaway
// git repository with a throwaway origin, once per scenario that has bitten us
// or is about to:
//
//   · the file the list forgot            (2026-08-03 and 2026-09-01)
//   · the other program tree              (2026-09-01)
//   · a brand-new catalog edition, which is nothing but UNTRACKED files —
//     the catalog rolled to 2027 on 2026-09-01, so this is the next run
//   · a program folder the catalog dropped
//   · someone else pushing mid-run
//   · a push rejected once
//
// A scenario that ends "and nothing was pushed" is checked against the origin,
// not against the working copy, because "did the data actually land" is the
// only question this step exists to answer.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const WORKFLOWS = ["update-courses.yml", "update-majors.yml", "update-grad-majors.yml"];

// A tracked file no workflow stages. Scenario 5/6 use it as "the script wrote
// somewhere nobody declared", which is the shape of every failure above.
const OUTSIDE = "docs/UNRELATED-BY-ANY-PIPELINE.md";

// Neutralise the developer's own git config: a global `commit.gpgsign = true`
// or a global hooksPath would otherwise fail these commits for reasons that
// have nothing to do with the workflow under test.
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.com",
  // The workflow reads this so the retry loop can be exercised without adding
  // 15 seconds to every CI run.
  PUSH_RETRY_DELAY: "0",
};

const git = (cwd, args) =>
  execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** The `Commit and push` script exactly as the runner would see it. */
function commitScript(workflow) {
  const doc = yaml.load(readFileSync(join(ROOT, ".github/workflows", workflow), "utf8"));
  const steps = Object.values(doc.jobs).flatMap(j => j.steps ?? []);
  const step = steps.find(s => s.name === "Commit and push");
  assert.ok(step, `${workflow} has no "Commit and push" step`);
  // `${{ github.run_id }}` and friends are substituted by the runner before
  // bash ever sees them. Anything left would be a bare `${{` in a double-quoted
  // string, which bash reads as a parameter expansion and dies on.
  return step.run.replace(/\$\{\{[^}]*\}\}/g, "TESTRUN");
}

/**
 * The paths the step stages, read out of its own `git add -A -- …` line.
 * Deliberately parsed rather than duplicated: a test carrying its own copy of
 * the list would keep passing after the list drifted, which is the bug.
 */
function stagedPaths(script) {
  const m = script.match(/git add -A --((?:\s*\\\s*\n\s*\S+)+)/);
  assert.ok(m, "no `git add -A -- …` continuation block found");
  return m[1].split("\\").map(s => s.trim()).filter(Boolean);
}

/** A repo with a bare origin, seeded so every staged path exists. */
function scratch(paths, extra = []) {
  const dir = mkdtempSync(join(tmpdir(), "numap-commit-step-"));
  git(dir, ["-c", "init.defaultBranch=main", "init", "--bare", "-q", "origin.git"]);
  git(dir, ["clone", "-q", "origin.git", "work"]);
  const work = join(dir, "work");

  // A file for every staged path (a trailing slash means it is a directory),
  // plus one tracked file outside all of them.
  const seeded = [];
  for (const p of paths) seeded.push(p.endsWith("/") ? `${p}seed.json` : p);
  for (const rel of [...seeded, ...extra, OUTSIDE]) {
    const abs = join(work, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, rel.endsWith(".json") ? '{"seed":1}\n' : "seed\n");
  }
  git(work, ["add", "-A"]);
  git(work, ["commit", "-qm", "seed"]);
  git(work, ["push", "-q", "origin", "main"]);
  return { dir, work, origin: join(dir, "origin.git"), seeded };
}

/** Run the step's script the way the runner would, capturing everything. */
function runStep(work, script) {
  const file = join(work, "..", "step.sh");
  writeFileSync(file, script);
  try {
    const out = execFileSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", file], {
      cwd: work, env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/** What origin/main actually contains — the only thing that matters. */
const originLog = (s) => git(s.origin, ["log", "--format=%s"]).trim().split("\n");
const originFiles = (s) => git(s.origin, ["ls-tree", "-r", "--name-only", "main"]).trim().split("\n");

const write = (s, rel, body) => {
  const abs = join(s.work, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
};

for (const workflow of WORKFLOWS) {
  const script = commitScript(workflow);
  const paths = stagedPaths(script);

  // ── Static: the step cannot stage a path that is not there ──────────
  // `git add -A -- nope/` is a fatal error, not a no-op, so a data directory
  // renamed without updating the workflow takes the whole commit step down —
  // after the scrape has already run.
  test(`${workflow}: every staged path exists in the repo`, () => {
    for (const p of paths) {
      assert.ok(existsSync(join(ROOT, p)), `${workflow} stages ${p}, which does not exist`);
    }
  });

  test(`${workflow}: a run that changed nothing exits clean and pushes nothing`, () => {
    const s = scratch(paths);
    const r = runStep(s.work, script);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /nothing to commit/);
    assert.deepEqual(originLog(s), ["seed"]);
    rmSync(s.dir, { recursive: true, force: true });
  });

  test(`${workflow}: a modified file inside a staged path lands on origin`, () => {
    const s = scratch(paths);
    write(s, s.seeded[0], '{"seed":2}\n');
    const r = runStep(s.work, script);
    assert.equal(r.code, 0, r.out);
    assert.equal(originLog(s).length, 2, `expected a new commit on origin:\n${r.out}`);
    assert.match(git(s.origin, ["show", "--stat", "HEAD"]), new RegExp(s.seeded[0].split("/").pop()));
    rmSync(s.dir, { recursive: true, force: true });
  });

  // The 2027 edition roll: a whole new `<year>/` directory, untracked. The
  // `git diff --quiet` gate this step replaced could not see it at all and
  // would have reported "already up-to-date".
  const dirPath = paths.find(p => p.endsWith("/"));
  if (dirPath) {
    test(`${workflow}: a new untracked directory under ${dirPath} is committed`, () => {
      const s = scratch(paths);
      write(s, `${dirPath}2027/college/program/requirements.json`, '{"new":"edition"}\n');
      const r = runStep(s.work, script);
      assert.equal(r.code, 0, r.out);
      assert.ok(originFiles(s).includes(`${dirPath}2027/college/program/requirements.json`),
        `the new edition did not reach origin:\n${r.out}`);
      rmSync(s.dir, { recursive: true, force: true });
    });
  }

  test(`${workflow}: a file the catalog dropped is committed as a deletion`, () => {
    const s = scratch(paths);
    rmSync(join(s.work, s.seeded[0]));
    const r = runStep(s.work, script);
    assert.equal(r.code, 0, r.out);
    assert.ok(!originFiles(s).includes(s.seeded[0]), `deletion did not reach origin:\n${r.out}`);
    rmSync(s.dir, { recursive: true, force: true });
  });

  // The 2026-09-01 failure, generalised: a tracked file nothing stages. It must
  // stop the run BEFORE the commit and name itself, rather than reaching
  // `git pull --rebase` and dying there with a message about rebasing.
  test(`${workflow}: a tracked file outside every staged path stops the run, naming it`, () => {
    const s = scratch(paths);
    write(s, s.seeded[0], '{"seed":3}\n');          // a real change, so there IS something to commit
    write(s, OUTSIDE, "a script wrote here\n");     // …and something dropped
    const r = runStep(s.work, script);
    assert.notEqual(r.code, 0, `expected a refusal, got:\n${r.out}`);
    assert.match(r.out, /::error::/);
    assert.match(r.out, new RegExp(OUTSIDE));
    assert.deepEqual(originLog(s), ["seed"], "nothing may be pushed when a file is being dropped");
    rmSync(s.dir, { recursive: true, force: true });
  });

  test(`${workflow}: an untracked stray warns but does not block or land`, () => {
    const s = scratch(paths);
    write(s, s.seeded[0], '{"seed":4}\n');
    write(s, "scratch-notes.txt", "not ours\n");
    const r = runStep(s.work, script);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /::warning::.*[Uu]ntracked/);
    assert.equal(originLog(s).length, 2);
    assert.ok(!originFiles(s).includes("scratch-notes.txt"));
    rmSync(s.dir, { recursive: true, force: true });
  });

  test(`${workflow}: a commit that landed on origin mid-run is rebased onto, not clobbered`, () => {
    const s = scratch(paths);
    // Someone else pushes while the scrape is running.
    const other = join(s.dir, "other");
    git(s.dir, ["clone", "-q", "origin.git", "other"]);
    writeFileSync(join(other, "THEIRS.md"), "theirs\n");
    git(other, ["add", "-A"]);
    git(other, ["commit", "-qm", "someone else"]);
    git(other, ["push", "-q", "origin", "main"]);

    write(s, s.seeded[0], '{"seed":5}\n');
    const r = runStep(s.work, script);
    assert.equal(r.code, 0, r.out);
    const files = originFiles(s);
    assert.ok(files.includes("THEIRS.md"), "their commit was clobbered");
    assert.equal(originLog(s).length, 3, `both commits should be on origin:\n${r.out}`);
    rmSync(s.dir, { recursive: true, force: true });
  });

  test(`${workflow}: a push rejected once is retried and still lands`, () => {
    const s = scratch(paths);
    // A pre-receive hook that rejects exactly the first push it sees. The
    // retry loop is the difference between "a human pushed at the wrong
    // second" and "this month's data does not exist".
    const hook = join(s.origin, "hooks", "pre-receive");
    mkdirSync(dirname(hook), { recursive: true });
    writeFileSync(hook,
      "#!/bin/sh\n" +
      `if [ ! -f "${join(s.dir, "rejected-once")}" ]; then\n` +
      `  touch "${join(s.dir, "rejected-once")}"\n` +
      '  echo "rejecting the first push on purpose" >&2\n' +
      "  exit 1\n" +
      "fi\n" +
      "exit 0\n");
    execFileSync("chmod", ["+x", hook]);

    write(s, s.seeded[0], '{"seed":6}\n');
    const r = runStep(s.work, script);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /push attempt 1 failed/);
    assert.match(r.out, /Pushed on attempt 2/);
    assert.equal(originLog(s).length, 2, `the retry did not land the data:\n${r.out}`);
    rmSync(s.dir, { recursive: true, force: true });
  });
}

// ── Both majors jobs must stage BOTH trees ──────────────────────────
// This is the 2026-09-01 failure stated as the property that was missing.
// verify-majors --write stamps `metadata.verification.checkedAt` into every
// program it verifies, in both trees, on every run — so a majors job that
// stages only its own tree always leaves the other one dirty, and git refuses
// to rebase. Staging one tree is not a smaller version of the right answer; it
// is the bug.
const UG = "data/northeastern/programs/undergraduate/2026/engineering/x_bs/requirements.json";
const GR = "data/northeastern/programs/graduate/2026/engineering/y_ms/requirements.json";

for (const workflow of ["update-majors.yml", "update-grad-majors.yml"]) {
  test(`${workflow}: stages both program trees, because verify-majors writes both`, () => {
    const paths = stagedPaths(commitScript(workflow));
    const covers = (tree) => paths.some(p => `data/northeastern/programs/${tree}/`.startsWith(p));
    assert.ok(covers("undergraduate"), `${workflow} does not stage the undergraduate tree`);
    assert.ok(covers("graduate"), `${workflow} does not stage the graduate tree`);
  });

  // The same property, driven rather than asserted — this is 2026-09-01 to the
  // letter. `verify-majors --write` re-stamps every program in BOTH trees on
  // every run, so both are dirty when the commit step starts. A step that
  // stages one of them either drops half the verdicts it just computed or
  // (with the guard above) refuses outright; either way the month's data does
  // not land, which is what the run must not be allowed to do quietly.
  test(`${workflow}: verification stamps written into BOTH trees reach origin`, () => {
    const script = commitScript(workflow);
    const s = scratch(stagedPaths(script), [UG, GR]);
    write(s, UG, '{"metadata":{"verification":{"checkedAt":"2026-11-01"}}}\n');
    write(s, GR, '{"metadata":{"verification":{"checkedAt":"2026-11-01"}}}\n');
    const r = runStep(s.work, script);
    assert.equal(r.code, 0, r.out);
    const shown = git(s.origin, ["show", "--stat", "HEAD"]);
    assert.match(shown, /undergraduate/, `the undergraduate verdicts did not land:\n${r.out}`);
    assert.match(shown, /graduate/, `the graduate verdicts did not land:\n${r.out}`);
    rmSync(s.dir, { recursive: true, force: true });
  });
}
