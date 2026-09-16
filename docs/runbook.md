# Runbook — when an unattended pipeline fails

You are probably here from an automatically opened issue titled "🔴 … pipeline is
failing". That issue names the failed step, tails every log, and says how long
it has been since the data actually changed. This file says what that step
failing usually *means* and what the fix normally looks like.

Written for someone who did not build this. If a section tells you something you
already know, skip it.

## Three things that are true of almost every failure here

**The data is safe.** Every scraper buffers its whole run and refuses to write
when the result looks like upstream broke rather than changed. A failed run
almost always means nothing was committed, so the site is serving last month's
data. That is the designed outcome, not a second problem.

**Nothing self-heals.** There is no retry on a schedule. The site will look
perfectly healthy while going quietly out of date, which is why the issue exists
at all. The alert closes itself when a later run succeeds.

**Never fix data by editing data.** Anything you hand-edit into
`public/northeastern/*.json` or `data/` is overwritten by the next scheduled
run. Fix the scraper, or revert the bad data commit and let the pipeline
re-run.

If you do nothing else, re-run the workflow once by hand (Actions tab →
the workflow → Run workflow). Some failures are upstream timeouts and clear on
their own.

---

## Course data (`update-courses.yml`, monthly)

### Assert the shell fails a broken pipe

The step that proves the shell is configured to fail when a piped command fails.
Every scrape step is written `node scripts/x.js | tee /tmp/x-log.txt`, and
without this setting the step's success is `tee`'s success, not the scraper's.
Nineteen separate safety checks in this pipeline were unable to fail a job until
this was found. If this step fails, something removed `defaults: run: shell:
bash` from the workflow. Put it back. Do not skip the step.

### Scrape catalog

**Usual cause:** Northeastern changed the catalog's page markup.

The scraper refuses to write if more than 2% of pages fail to fetch, or if the
course count shrinks by more than 2% against what is committed. Both mean "the
pages changed shape", not "courses disappeared".

Check by re-running one subject against the live site and reading what comes
back:

```sh
node scripts/scrape-catalog.js --subjects CS
```

Then open the same page in a browser and compare. The historical failures have
all been of one kind: a field moved, or lost the class name we were selecting
on. The `Attribute(s):` line, for instance, is found by its label text and not
by a CSS class, because a class-based selector once matched zero blocks and
silently contributed no NUPath data at all.

### Scrape term availability

**Usual cause:** Banner. Three known behaviours, in order of likelihood.

Banner intermittently answers a bulk search with "success, 0 results" for a term
that really has thousands of sections. This has its own retry, because an empty
answer is indistinguishable from a true one. If you see a term reporting zero,
that is what happened; re-run.

Rate limiting. This pass makes thousands of requests and takes hours. It is
paced deliberately, and being throttled is treated as a wait rather than an
error. Resuming is the default, and it re-derives from a cached copy of the raw
responses rather than skipping what it already has.

Term codes. Northeastern retired the separate summer-session codes, so one code
now carries both sessions and is split back apart by the scraper. A new term
shape can surface here first.

### Derive offering summary

Folds per-section data into per-course summaries. It refuses to write if more
than 5% of existing class-standing restrictions would disappear, because a
markup change upstream would otherwise silently restore old, wrong behaviour.
If this fires, the previous step's data is suspect, not this one.

### Derive retired union

Computes which courses have been retired by comparing frozen snapshots of past
catalog years against the current one. It raises the alarm when live courses
appear in no snapshot, which means a catalog year was never captured.

```sh
node scripts/edition-probe.js --coverage
```

names the missing year. Note that an edition can only be captured while it is
live: Northeastern's archive lags and has skipped a year outright, so our 2026
snapshot is the only machine-readable copy that exists anywhere. Never delete
anything under `data/northeastern/catalog/editions/`.

### Re-derive term windows · Refresh RateMyHusky links · Refresh NUpath from Tableau

**These three cannot fail the job.** They log a warning and carry on with the
previous run's data. If the issue body shows a warning from one of them,
nothing is broken right now, but the data behind it is frozen until it is fixed.

For NUPath specifically there is an escalation path: `update-nupath.yml` is
kept as a manual-only workflow because it installs a full browser, so it can
reach the Tableau dashboard when the direct routes fail. Run it by hand. Do not
put it on a schedule; it would double-write the same data.

### Merge NUpath into catalog-courses · Apply patches · Build course equivalences

These are fatal, and they operate on data the earlier steps produced. A failure
here is nearly always a symptom of an earlier step having produced something
strange rather than a problem in these scripts.

### Verify CHART can still plan this catalog

The plan engine is run against every program to prove the new data can still
produce a legal degree plan. A failure means today's scrape broke planning for
at least one program.

Note the step is pinned to the 2026 edition on purpose, and the workflow
comments explain why: on 2027 the run was still going after an hour and had to
be killed. The gap is real and known. Do not "fix" it by dropping the flag.

### Build the site the way Cloudflare will · Suites that assert on data shape

`npm run build` is the exact command Cloudflare Pages runs, and it is the only
thing that exercises the data-driven parts of the site. The most common failure
is the invariant that refuses to ship a program requiring courses the catalog no
longer contains. That check names the missing courses in its output.

These run *before* the commit deliberately. A push made by the pipeline's own
token triggers no other workflow, so this is the only CI the monthly data ever
sees.

---

## Program requirements (`update-majors.yml`, `update-grad-majors.yml`, every two months)

### Scrape major requirements

**Usual cause at an edition roll:** a hand-maintained adjudication table has
gone stale. Three of them exist, and each stops the run rather than guessing,
which is the design:

- **Shared sections** — a manifest of requirement sections that legitimately
  appear on two programs. Northeastern renames these; four were renamed in one
  roll. A missing entry stops the run.
- **Requirement pane variants** — when one page carries a second requirements
  table (advanced entry, part-time, a different campus), a person decides
  whether it is a variant or a separate program. An unadjudicated pane is a hard
  failure.
- **Cross-referenced menus** — when a requirement points at a course list
  published elsewhere on the page. Unclaimed means a hard failure.

To see what the parser currently makes of one page without writing anything:

```sh
node scripts/scrape-majors.js --url <program page url> --json /tmp/out.json
```

That is how you tell "renamed" from "retired" from "we stopped scraping it",
which need three different repairs. If a page now redirects to a department
page, the program is gone and the entry should be deleted. If it redirects to
another program, re-key the entry. If it still returns a page, our discovery
missed it, and deleting the entry would hide a program we have stopped scraping
entirely.

**Other rails on this step:** the run refuses if too many pages vanish at once,
or if the share of pages that no longer look like programs crosses 20%. Both
are aimed at the same failure: Northeastern reorganising its site, which reads
as mass deletion.

### Verify requirements against the catalog · Verification ratchet

The ratchet fails when any program's verification verdict got *worse* than the
committed baseline. At an edition roll this is expected to be noisy, because the
input changed too, and telling "Northeastern restructured this degree" from "we
parsed it worse" is a judgement a person has to make once, at that moment.

Read the report, and when the change is real and intended, record it:

```sh
node scripts/verify-majors.js --report --write
```

then re-run the ratchet step with its update flag to accept the new baseline.
Do not accept a baseline you have not read.

---

## "It has stopped running" (`data-staleness.yml`, weekly)

A different issue title, and a different problem: nothing failed, because
nothing ran. Every other alert is raised from inside the job it is about, which
cannot cover a run that never happened.

Three causes, in order:

1. **GitHub disabled the schedule.** It does this automatically after 60 days
   without activity in the repository. Re-enabling is a button in the Actions
   tab.
2. **The run was cancelled while pending.** All the data workflows share one
   concurrency group, GitHub keeps at most one pending run, and a run cancelled
   before it starts executes no steps, so it cannot report anything.
3. **GitHub dropped or delayed the cron.** Delays of several hours are routine.
   One missed cycle is normal; two is not.

Re-run by hand to close it out.

---

## When the right answer is to do nothing

A rail that fires is the system working. The temptation, especially under time
pressure, is to lower the threshold until the run passes. Don't. Every one of
those numbers exists because a broken upstream once produced a plausible-looking
dataset, and the whole point is to make a person look at it.

If you cannot fix it this week, that is fine, and it is what the design is for:
the site keeps serving the last good data, the issue stays open, and the
staleness watchdog keeps counting. Stale data that is correct beats fresh data
that is wrong.
