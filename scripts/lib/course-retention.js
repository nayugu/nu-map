// ═══════════════════════════════════════════════════════════════════
// course-retention.js — keep a retired course while a shipped program
// edition still requires it.
//
// ── The defect this exists for ──────────────────────────────────────
//
// Program requirements are edition-partitioned and the course catalog is not.
//
// A student's degree is locked to the catalog year they entered under, so
// `data/northeastern/programs/<tree>/<year>/…` carries one requirements.json
// per program per edition, and the program id a saved plan stores carries the
// year inside it (`grad/2026/additional-programs/applied_aiconnect_mps_(boston)`).
// Both editions ship. That is deliberate and correct.
//
// `public/northeastern/catalog-courses.json` is a single CURRENT snapshot, and
// it is REPLACED, not merged. So the first full scrape after an edition roll
// deletes every course the new catalog retired — and the frozen older tree goes
// on requiring them. Measured on the live 2027 roll (2026-09-02): the 2026 tree
// referenced 5,229 distinct courses with 3 missing; after the roll it would
// have been **3,660 references across 579 of 651 programs**, each one a
// requirement row a student can never tick off.
//
// Note what this is NOT: it is not a browsing archive, and it is not "keep
// everything". It keeps exactly the courses an audit we still ship cannot be
// performed without.
//
// ── Why it is safe to keep them ─────────────────────────────────────
//
// A retained course carries no sections and may carry no term-history, so the
// obvious worry is that it becomes a course the planner cannot schedule and
// refuses over. Measured before building this: **3,250 of 7,966 courses (41%)
// already have no term-history**, and every one of them is already resolvable,
// searchable and schedulable. A retained course is not a new shape.
//
// ── Why it cannot grow without bound ────────────────────────────────
//
// Retention is recomputed from scratch every run against the trees on disk, so
// it is self-pruning by construction rather than by a cleanup step: a course is
// kept only while some shipped edition names it. Drop the 2026 tree and the
// next full scrape drops its retained courses with it. There is no accumulating
// set and nothing to garbage-collect.
//
// ── The rule that keeps the marker honest ───────────────────────────
//
// `retired: true` means "the subject page was read successfully and this course
// was not on it". It must NEVER mean "we did not manage to read it". That
// distinction is the same one `knownTermCodes` enforces in term-history.js,
// where collapsing it wrote `false` for a whole semester of real history on an
// unattended run. Here the equivalent mistake would mark an entire subject
// retired because its page timed out.
//
// scrape-catalog.js already rescues a failed subject's courses from the
// previous snapshot, unmarked. This module therefore **excludes failed
// subjects entirely** — not because they need no rescue, but because they
// already have one, and retaining them here would both duplicate the entry and
// slander a course that is probably still offered.
//
// ── The trap in the write guard ─────────────────────────────────────
//
// Retention makes the snapshot BIGGER, and the 2% shrink rail measures the
// snapshot. Left alone, that rail compares next month's 7,762 freshly-scraped
// courses against a committed 8,462 that includes ~700 retained ones, and
// refuses the run — every month, forever, for a catalog that never changed.
//
// So the rail must compare like with like: this module exports
// `activeCourseCount` for it, and the rail counts only NON-retired courses on
// both sides. Retention is applied strictly AFTER the rail for the same
// reason in the other direction — apply it before, and the union inflates the
// count past the floor, silently disabling the one guard whose entire purpose
// is to make an operator look at an edition roll.
// ═══════════════════════════════════════════════════════════════════

/**
 * The key shape shared by the program trees and the catalog snapshot.
 *
 * The two disagree on purpose and had to be reconciled: `courseKey` in
 * major-verify.js is `` `${subject}${classId}` `` (ACCT1201) while the snapshot's
 * own previous-run map keys on `` `${subject} ${number}` `` (ACCT 1201). Matching
 * without normalising silently retains nothing, which looks exactly like
 * "nothing needed retaining".
 *
 * @param {unknown} subject
 * @param {unknown} number
 * @returns {string|null} normalised key, or null if either half is unusable
 */
export function normalizeKey(subject, number) {
  const s = String(subject ?? "").replace(/\s+/g, "").toUpperCase();
  const n = String(number ?? "").replace(/\s+/g, "").toUpperCase();
  return s && n ? `${s}${n}` : null;
}

/** The key of a catalog snapshot entry, or null if it is not a usable course. */
export function keyOfCourse(course) {
  if (!course || typeof course !== "object") return null;
  return normalizeKey(course.subject, course.number);
}

/**
 * Courses that count toward the shrink rail: everything we actually scraped.
 *
 * A retained course is evidence about an OLDER catalog, so counting it as part
 * of the current one is what makes the rail unsatisfiable after a roll.
 *
 * @param {unknown} courses
 * @returns {number}
 */
export function activeCourseCount(courses) {
  if (!Array.isArray(courses)) return 0;
  return courses.filter(c => c && typeof c === "object" && !c.retired).length;
}

/**
 * Every course key named by any program requirements file under `roots`.
 *
 * Deliberately COURSE nodes only, via major-verify's own accessor:
 *
 *   - a RANGE ("MATH 3001 to MATH 4999") names no course and is satisfied by
 *     whatever exists, so retaining a dead course to fill one would offer a
 *     student a course NEU no longer teaches;
 *   - an `exceptions` entry is a course a range EXCLUDES, so counting it as
 *     required inverts its meaning (the same reasoning as courseKeysOf's own
 *     docstring).
 *
 * @param {string[]} dirs           roots to walk, e.g. [".../programs"]
 * @param {object}   io             injected fs + parser, so this is testable
 * @param {(p:string)=>boolean} io.exists
 * @param {(p:string)=>{name:string,isDirectory:()=>boolean}[]} io.readdir
 * @param {(p:string)=>string} io.readFile
 * @param {(program:object)=>Iterable<string>} io.courseKeysOf
 * @param {(msg:string)=>void} [io.warn]
 * @returns {{keys: Set<string>, programs: number, unreadable: number}}
 */
export function referencedCourseKeys(dirs, io) {
  const keys = new Set();
  let programs = 0;
  let unreadable = 0;

  const walk = dir => {
    let entries;
    try {
      entries = io.readdir(dir);
    } catch {
      // A directory we cannot list contributes nothing. It must not throw:
      // failing here would turn a permissions problem into a refused scrape,
      // and the honest degradation is "retain less", never "write nothing".
      unreadable++;
      return;
    }
    for (const entry of entries) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(path); continue; }
      if (entry.name !== "requirements.json") continue;
      programs++;
      let program;
      try {
        program = JSON.parse(io.readFile(path));
      } catch {
        unreadable++;
        io.warn?.(`could not read ${path} — its courses are not protected this run`);
        continue;
      }
      try {
        for (const raw of io.courseKeysOf(program) ?? []) {
          // The tree's keys are already `SUBJ1234`, but they arrive from a
          // template literal over two untrusted fields: `courseKey(undefined,
          // undefined)` is the string "undefinedundefined". Re-splitting is
          // how a malformed node fails to protect a course instead of
          // protecting a course that does not exist.
          const m = /^([A-Za-z]+)\s*([0-9][0-9A-Za-z]*)$/.exec(String(raw ?? "").trim());
          const key = m ? normalizeKey(m[1], m[2]) : null;
          if (key) keys.add(key);
        }
      } catch {
        unreadable++;
      }
    }
  };

  for (const dir of dirs ?? []) {
    if (io.exists(dir)) walk(dir);
  }
  return { keys, programs, unreadable };
}

/**
 * Union the fresh scrape with the retired courses a shipped edition still needs.
 *
 * Pure, and total: every input may be junk and the answer is then "the scrape,
 * unchanged" — the pre-retention behaviour. This function must never be the
 * reason a scrape writes nothing.
 *
 * @param {object} args
 * @param {unknown} args.scraped         this run's courses (post nuPath reconcile)
 * @param {unknown} args.previous        the committed snapshot
 * @param {Set<string>} args.referenced  from referencedCourseKeys
 * @param {Set<string>} [args.failedSubjects]  already rescued by the caller
 * @param {string} args.now             ISO date for a newly-observed retirement
 * @returns {{courses: object[], retained: object[], revived: string[], dropped: string[]}}
 */
export function retainReferencedCourses({ scraped, previous, referenced, failedSubjects, now }) {
  const fresh = Array.isArray(scraped) ? scraped : [];
  const prev = Array.isArray(previous) ? previous : [];
  const need = referenced instanceof Set ? referenced : new Set();
  const failed = failedSubjects instanceof Set ? failedSubjects : new Set();
  const stamp = typeof now === "string" && now ? now : new Date().toISOString().slice(0, 10);

  // A freshly-scraped course is by definition in the current catalog, so it
  // must not carry a retirement marker. Stripping rather than trusting the
  // input keeps this correct if the caller's own carry-forward logic ever
  // starts spreading the previous entry (it currently carries only nuPath).
  const present = new Set();
  const courses = fresh.map(c => {
    const key = keyOfCourse(c);
    if (key) present.add(key);
    if (c && typeof c === "object" && (c.retired || c.retiredSince)) {
      const { retired, retiredSince, ...live } = c;
      return live;
    }
    return c;
  });

  const revived = [];
  const retained = [];
  const dropped = [];
  const seen = new Set(present);

  for (const c of prev) {
    const key = keyOfCourse(c);
    if (!key) continue;

    if (present.has(key)) {
      // Back in the catalog. NEU does un-retire courses, and a stale marker
      // would badge a live course as gone.
      if (c.retired) revived.push(key);
      continue;
    }
    // Duplicate keys inside the previous snapshot must not become duplicate
    // entries in the union.
    if (seen.has(key)) continue;
    // Its subject failed to load, so the caller has already carried it forward
    // unmarked. Retaining it here would duplicate the entry AND assert a
    // retirement we have no evidence for.
    if (failed.has(String(c.subject ?? "").replace(/\s+/g, "").toUpperCase())) continue;

    if (!need.has(key)) { dropped.push(key); continue; }

    seen.add(key);
    retained.push({
      ...c,
      retired: true,
      // First run that read the subject and did not find it. Carried forward,
      // so the date stays the date it happened rather than the date of the
      // most recent run to notice.
      retiredSince: typeof c.retiredSince === "string" && c.retiredSince ? c.retiredSince : stamp,
    });
  }

  return { courses: [...courses, ...retained], retained, revived, dropped };
}

/**
 * The whole retention step, as one call.
 *
 * ── Why the orchestration lives here and not in the scraper ─────────
 *
 * Inline in scrape-catalog.js, this code was reachable ONLY by a full network
 * scrape: `--dry-run` and `--subject` set PARTIAL and skip the write branch
 * entirely, and `--rotate`/`--subjects` exit before it. So the one way to find
 * out whether it ran was to spend 29 minutes and see. A missing `readdirSync`
 * in the import list survived `node --check` for exactly that reason, and the
 * next such slip would surface as a throw at minute 29 of an unattended job.
 *
 * Here it is one function with injected io, so every branch — including the
 * failure branches, which are the ones that matter — is exercised in
 * milliseconds. The caller does the printing.
 *
 * Total by construction: on ANY failure it returns the scrape unchanged with a
 * warning line. Retention is a data-quality improvement and must never become
 * a new reason for the monthly job to write nothing.
 *
 * @param {object} args
 * @param {object[]} args.scraped        this run's courses
 * @param {string} args.catalogPath      the committed snapshot
 * @param {string[]} args.programRoots
 * @param {Set<string>} args.failedSubjects
 * @param {object} args.io               { exists, readdir, readFile, courseKeysOf }
 * @param {string} [args.now]
 * @returns {{courses: object[], lines: string[], ok: boolean}}
 */
export function applyEditionRetention({ scraped, catalogPath, programRoots, failedSubjects, io, now }) {
  const lines = [];
  // Normalised once, up front: every early return below hands this back, and
  // `{ courses: undefined }` from one of them is a silent way to write an empty
  // catalog. (Found by feeding this function `{}`.)
  const fresh = Array.isArray(scraped) ? scraped : [];
  const bail = msg => {
    lines.push(`⚠  Edition retention skipped (${msg}) — writing the scrape as-is. `
      + `Older program editions may be left with unresolvable course references.`);
    return { courses: fresh, lines, ok: false };
  };

  try {
    if (!io?.exists?.(catalogPath)) {
      // No committed snapshot means there is nothing to retain FROM. Not a
      // failure: it is the first run in a fresh clone.
      lines.push("No committed catalog yet — nothing to retain.");
      return { courses: fresh, lines, ok: true };
    }

    const { keys, programs, unreadable } = referencedCourseKeys(programRoots, io);
    if (unreadable) {
      lines.push(`⚠  ${unreadable} program file(s)/directory(ies) unreadable — `
        + `their courses are not protected this run.`);
    }
    if (!programs) {
      // A legitimate state: a clone that has never run the majors scrape. It
      // means there is nothing to protect, NOT that protection failed.
      lines.push("No program requirements on disk — nothing to retain.");
      return { courses: fresh, lines, ok: true };
    }

    const previous = JSON.parse(io.readFile(catalogPath));
    const { courses, retained, revived, dropped } = retainReferencedCourses({
      scraped: fresh, previous, referenced: keys, failedSubjects, now,
    });

    lines.push(`Edition retention: ${programs} programs reference ${keys.size} courses.`);
    if (retained.length) {
      const bySubject = new Map();
      for (const c of retained) bySubject.set(c.subject, (bySubject.get(c.subject) ?? 0) + 1);
      const top = [...bySubject].sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([s, n]) => `${s}×${n}`).join(", ");
      lines.push(`  Kept ${retained.length} retired course(s) still required by a shipped `
        + `edition: ${top}${bySubject.size > 8 ? ", …" : ""}`);
    }
    if (revived.length) {
      lines.push(`  ${revived.length} previously-retired course(s) are back in the catalog: `
        + `${revived.slice(0, 8).join(", ")}${revived.length > 8 ? ", …" : ""}`);
    }
    if (dropped.length) {
      // The growth bound, made visible: absent from the catalog AND named by
      // no edition we ship.
      lines.push(`  Dropped ${dropped.length} course(s) no shipped edition requires.`);
    }
    return { courses, lines, ok: true };
  } catch (err) {
    return bail(err?.message ?? String(err));
  }
}
