// ═══════════════════════════════════════════════════════════════════
// CORE: planSummary — the clipboard export, as text a person or a model reads.
// ═══════════════════════════════════════════════════════════════════
//
// ── What changed, and why ──────────────────────────────────────────
//
// The first version of this export was the plan followed by every placed
// course's catalog description. Over the shipped catalog a description is 418
// characters on average (median 422, p90 760), roughly 105 tokens plus its
// code/title/credits header. Measured end to end on a real 32-course Computer
// Science BSCS plan: the appendix was **17,897 of ~20,400 characters, 88% of
// the paste** (~4,474 of ~5,100 tokens), and the plan it was meant to describe
// was the small part.
//
// Worse, the two things a reader cannot get anywhere else were both absent.
// The export carried no FLAGS (the app knew all of them and only ever drew
// them; see planConflicts.js) and no REQUIREMENT AUDIT (the PDF has had one
// for a year). So the expensive 88% was the part any reader could look up, and
// the cheap part was missing.
//
// Both are now in, and the descriptions are out, replaced by the URL grammar
// of the data surface we already publish. A course page carries strictly more
// than the appendix did: the description, prerequisite logic with minimum
// grades, offering history per term with fill percentages, meeting patterns,
// and who teaches it. The whole paste is now ~3,900 characters against
// ~20,400, and a reader who cannot fetch has a second button that copies the
// descriptions on their own.
//
// ── Rules ──────────────────────────────────────────────────────────
//
//   · ENGLISH, like the rest of the export path. planModel.js is English-only
//     by design and for the same reason: an advisor, a registrar and a model
//     all read the registrar's own vocabulary, and a machine translation of a
//     requirement is a worse artifact than the English one. The BUTTONS are
//     localised; the artifact is not.
//   · DETERMINISTIC. Two copies of one unchanged plan must be byte-identical,
//     or a reader diffing two pastes sees changes that never happened. Nothing
//     here iterates an unordered map without sorting it, and the only clock
//     reading is the data-updated stamp, which is data.
//   · ONE derivation. The sets come from `derivePlanSets` and the audit from
//     `allocateMajorWithElectives` — the same calls the printed report makes,
//     for the same reason it makes them: a second derivation is how an F/W/U
//     course came to print as completed on the one page a student hands over.
// ═══════════════════════════════════════════════════════════════════

import {
  derivePlanSets, filterInTimeline, sectionProgressText, _minorShareNote,
} from "./planModel.js";
import { allocateMajorWithElectives, generalElectivesWorthShowing } from "./gradRequirements.js";
import { generalElectiveSHOf } from "./requirementBinding.js";
import { majorClaimOf, minorShare, outsideCreditKeys } from "./minorOverlap.js";
import { computeGrantedAttrs, resolveTermByDuration, termSpans } from "./specialTermUtils.js";
import { collectConflicts, formatConflicts, formatEnvelope } from "./planConflicts.js";

/** Where a reader goes for anything this summary deliberately leaves out. */
// Two lines. The URL grammar is the point; everything else about the data
// surface is one fetch away at llms.txt, which the second line names.
export const DATA_SURFACE_NOTE = [
  `Any course above, in full: https://numap.app/data/courses/{SUBJECT}/{NUMBER}`,
  `(e.g. .../CS/2500). Programs and everything else: https://numap.app/llms.txt`,
];

/**
 * Resolve a term's STANDALONE heading — "Summer A 2027", not "Summer 1 2027".
 *
 * A SemesterType may carry `altLabel`, a display override for exactly this
 * position: the grid says "Summer 1" in a narrow column where the row above it
 * supplies the context, and every surface that names a term on its own
 * (SemLabel, the MCP adapter, InfoPanel) uses the alt form. This export names
 * terms on their own and had been using the grid form, so it printed the one
 * spelling the project's own convention rules out.
 */
export function standaloneSemLabel(sem, semTypes = []) {
  if (!sem) return "";
  const st = semTypes.find(t => t.id === sem.semTypeId);
  const alt = st?.altLabel;
  if (!alt || !st?.label) return sem.label;
  // Swap the type's own name for its alt form, leaving the year in place.
  return sem.label.startsWith(st.label)
    ? `${alt}${sem.label.slice(st.label.length)}` : sem.label;
}

/**
 * The concise plan, in the order a reader wants it: identity and a one-line
 * flag count, the term-by-term schedule, the flags, what is still outstanding,
 * and last the method and where to look the rest up.
 *
 * Async because the programs have to be loaded to audit against them — the
 * same shape `exportReport` has. Adapter in, text out.
 *
 * @returns {Promise<string>}
 */
export async function buildPlanSummary({
  planName, placements, courseMap, semesters, semIndex, currentSemId,
  semesterCardIds, specialTermPl = {}, specialTermStartMap = {}, specialTermContMap = {},
  grades = {}, placedOut = new Set(), substitutions = [],
  studentType = "undergraduate", entry, graduation,
  majorPath = "", major2Path = "", concLabel = "", minor1Path = "", minor2Path = "",
  totalSHPlaced = 0, totalSHDone = 0,
  conflictInputs = {}, adapter = {}, dataUpdated = null,
}) {
  const { attributeSystem, specialTerms, creditSystem, institution = {}, majorRequirements } = adapter;
  const unitName  = creditSystem?.getUnitName() ?? "SH";
  const termTypes = specialTerms?.getTypes() ?? [];
  const semTypes  = adapter.calendar?.getSemesterTypes() ?? [];
  const appName   = institution.appName ?? "NU Map";
  const isGrad    = studentType === "graduate";
  const curIdx    = semIndex[currentSemId] ?? 0;

  const semById = new Map(semesters.map(s => [s.id, s]));
  const labelOf = id => standaloneSemLabel(semById.get(id), semTypes);

  // ── Programs ────────────────────────────────────────────────────
  const loadMajorFn = isGrad
    ? (p) => majorRequirements?.loadGradMajor(p)
    : (p) => majorRequirements?.loadMajor(p);
  const [major, major2, minor1, minor2] = await Promise.all([
    majorPath  ? loadMajorFn(majorPath).catch(() => null)  : null,
    major2Path ? loadMajorFn(major2Path).catch(() => null) : null,
    (!isGrad && minor1Path) ? majorRequirements?.loadMinor(minor1Path).catch(() => null) : null,
    (!isGrad && minor2Path) ? majorRequirements?.loadMinor(minor2Path).catch(() => null) : null,
  ]);

  const { projected, placedSet, realPlacedSet, doneKeys } = derivePlanSets({
    placements, grades, substitutions, placedOut, courseMap, dynSemIdx: semIndex,
    curIdx, specialTermPl, specialTermTypes: termTypes,
  });

  // ── What the majors claim, and each minor's share against it ─────
  //
  // ONE `majorClaim`, built once and passed to every caller that needs it.
  // `minorShare` needs it as a FUNCTION, not a set: the cap is a marginal
  // question ("can the major do without this course"), so it re-runs the
  // major's allocation over hypothetical placed sets. Excludes General
  // Electives by construction — a minor course landing in the degree's free
  // electives is not shared credit, it is the room a minor is meant to occupy.
  const majorClaim = isGrad ? null : majorClaimOf(
    [major, major2].map(data => ({ data, concentration: null })), courseMap);
  const majorClaimedKeys = majorClaim ? majorClaim(placedSet).claimed : new Set();
  const shareOf = (prog) => prog ? minorShare({
    minor: prog, placedSet, majorKeys: majorClaimedKeys, courseMap, majorClaim,
    substitutions, realPlacedSet,
    outsideKeys: outsideCreditKeys({ placements, grades, placedOut, courseMap }),
  }) : null;

  const lines = [];
  const label = p => {
    if (!p) return "";
    const parts = String(p).split("/");
    const folder = parts[parts.length - 2] || "";
    return folder ? (majorRequirements?.fmtProgramLabel(folder) ?? folder) : "";
  };

  // ── Header ──────────────────────────────────────────────────────
  lines.push(`${appName} plan: ${planName || "Untitled"}`);
  if (isGrad) {
    if (label(majorPath)) lines.push(`Program: ${label(majorPath)}`);
  } else {
    if (label(majorPath))  lines.push(`Major: ${label(majorPath)}`);
    if (label(major2Path)) lines.push(`Second major: ${label(major2Path)}`);
    if (concLabel)         lines.push(`Concentration: ${concLabel}`);
    if (label(minor1Path)) lines.push(`Minor: ${label(minor1Path)}`);
    if (label(minor2Path)) lines.push(`Second minor: ${label(minor2Path)}`);
  }
  lines.push(`Entry: ${entry}   Graduation: ${graduation}   Current term: ${labelOf(currentSemId)}`);
  const required = major?.totalCreditsRequired ?? 0;
  lines.push(`Credits: ${totalSHPlaced} ${unitName} placed`
    + (required ? ` of ${required} required` : "")
    + ` (${totalSHDone} completed, ${totalSHPlaced - totalSHDone} planned)`);
  if (dataUpdated) lines.push(`Catalog data scraped: ${dataUpdated}`);
  lines.push(`Independent student project, not affiliated with Northeastern University.`);

  // ── The validation envelope, then the conflicts ─────────────────
  //
  // Computed here, PRINTED after the schedule. The plan is what the reader
  // opened the paste for, and three screens of methodology before the first
  // course is a document nobody reads to the end. What survives at the top is
  // one line of verdict, so the count is never something you have to scroll to
  // find; the envelope goes last, where an appendix belongs.
  const placedCount = Object.keys(filterInTimeline(projected, semIndex)).length;
  // No `minorShares` here: the 50% double-count cap is reported in the minor's
  // own audit block, in the registrar's numbers, and a second copy in a
  // supplementary list is bloat rather than information.
  const { items, ran } = collectConflicts({
    placements, courseMap, semesters, semIndex, currentSemId,
    substitutions, placedOut, unitName, semLabelOf: labelOf,
    ...conflictInputs,
  });

  // One line, and only when there is something to point at. It exists so a
  // reader knows the checks happened without going looking, and it names them
  // as flags rather than as problems: most are rates, projections or things a
  // department waives. The clean case says so too, because "we checked and
  // found nothing" is the sentence that stops the re-derivation.
  lines.push(items.length
    ? `${items.length} flag${items.length === 1 ? "" : "s"} after the schedule (signals, not errors).`
    : `No flags from any check; what was checked is listed at the end.`);
  lines.push(``);

  // ── The schedule, FIRST ─────────────────────────────────────────
  lines.push(...scheduleLines({
    semesters, semIndex, currentSemId, semesterCardIds, courseMap, unitName,
    specialTermPl, specialTermStartMap, specialTermContMap, termTypes,
    semTypes, semById,
  }));

  // ── Placed out, substitutions ───────────────────────────────────
  // Part of the plan, not of the analysis, so they stay with the schedule.
  if (placedOut.size) {
    lines.push(``, `--- Placed out (satisfies prerequisites, earns no credit) ---`);
    for (const id of [...placedOut].sort()) {
      const c = courseMap[id];
      if (c) lines.push(`  ${c.code}: ${c.title}`);
    }
  }
  if (substitutions.length) {
    lines.push(``, `--- Substitutions (A placed, satisfies B; credit counts once) ---`);
    for (const { from, to } of substitutions) {
      const f = courseMap[from], tc = courseMap[to];
      // "(not yet placed)" is a FACT about the row, stated where the row is.
      // It used to be a flag, which told a student off for recording a
      // substitution before dragging the course in, i.e. for doing the two
      // steps in the order a person does them.
      if (f && tc) lines.push(`  ${f.code} → ${tc.code}`
        + (placements[from] === undefined ? ` (${f.code} not yet placed)` : ""));
    }
  }
  lines.push(``);

  // ── Flags ───────────────────────────────────────────────────
  lines.push(...formatConflicts(items, placedCount, ran));
  lines.push(``);

  // ── Requirements outstanding ────────────────────────────────────
  //
  // What a reader is usually being asked to help with, and the one thing in
  // this file they cannot look up: it depends on this student's placements.
  // Sections already satisfied are NOT listed — a satisfied section is a line
  // of text saying nothing needs doing, and there are up to twenty of them.
  const auditBlock = (prog, heading, name, showGeneralElectives = true, isMinor = false) => {
    if (!prog) return;
    const { sections, generalElectives } = allocateMajorWithElectives(
      prog, placedSet, courseMap,
      { completedSet: doneKeys, realPlacedSet, geAllowance: generalElectiveSHOf(prog, courseMap) });
    // The same worth-showing rule the printed report uses. It matters here even
    // though the row itself never prints — General Electives carries `sat: true`
    // unconditionally, so an empty one with no stated allowance was silently
    // padding the "N of M sections complete" line with a section that is neither.
    const all = showGeneralElectives && generalElectivesWorthShowing(generalElectives)
      ? [...sections, generalElectives]
      : sections;
    const outstanding = all.filter(s => !s.sat);
    lines.push(`${heading}${name}`);
    lines.push(`  ${all.length - outstanding.length} of ${all.length} sections complete.`);
    for (const s of outstanding) {
      lines.push(`  ○ ${s.title}: ${sectionProgressText(s, unitName)}`);
      for (const w of (s.warnings ?? [])) lines.push(`      ⚠ ${w}`);
    }
    // The catalog's 50%-double-counting sentence, in the same words the
    // printed report uses. It is INFORMATION, not a conflict: going over turns
    // a row amber and never un-allocates a course, because choosing which
    // course to drop is an advising decision. Only the over case also reaches
    // Conflicts, which is where a reader looks for what needs acting on.
    if (isMinor) {
      const note = _minorShareNote(shareOf(prog), unitName);
      if (note) lines.push(`  ${note}`);
    }
    lines.push(``);
  };

  // The heading carries what the two-line preamble used to say. "Satisfied
  // sections omitted" is the only part a reader needs before reading the list;
  // the note about prose being the catalog's own words belongs beside the prose
  // it describes, and `⚠` warning rows already say where they came from.
  lines.push(`--- Requirements still outstanding (satisfied sections omitted) ---`);
  auditBlock(major,  major2 ? "Major 1: " : (isGrad ? "Program: " : "Major: "), major?.name ?? "");
  if (major2) auditBlock(major2, "Major 2: ", major2.name ?? "");
  auditBlock(minor1, "Minor 1: ", minor1?.name ?? "", false, true);
  auditBlock(minor2, "Minor 2: ", minor2?.name ?? "", false, true);

  // NUPath / attribute coverage, from the PROJECTION view — a failed course
  // earns no attributes either, until a retake restores the base course.
  if (!isGrad && attributeSystem) {
    const codes   = attributeSystem.getGridCodes?.() ?? [];
    const covered = attributeSystem.getCoverage(
      filterInTimeline(projected, semIndex), courseMap,
      computeGrantedAttrs(specialTermPl, termTypes, semIndex)) ?? new Set();
    const missing = codes.filter(c => !covered.has(c));
    const sysName = attributeSystem.getSystemName?.() ?? "Attributes";
    lines.push(missing.length
      ? `${sysName}: ${codes.length - missing.length} of ${codes.length} covered, missing ${missing.join(", ")}`
      : `${sysName}: all ${codes.length} covered`);
    lines.push(``);
  }

  // ── The envelope, LAST ──────────────────────────────────────────
  //
  // Genuinely an appendix: it is the same text on every plan, it is about
  // method rather than about this student, and it is what a reader consults
  // when they want to challenge something above rather than while reading it.
  // The one part that cannot wait, a check that did NOT run, is printed inside
  // the Conflicts block itself, so a partial audit is never something you have
  // to reach the end of the document to discover.
  lines.push(...formatEnvelope(ran));

  lines.push(``, ...DATA_SURFACE_NOTE);
  return lines.join("\n");
}

/** Term-by-term, with work terms and the course each one registers. */
function scheduleLines({
  semesters, semIndex, currentSemId, semesterCardIds, courseMap, unitName,
  specialTermPl, specialTermStartMap, specialTermContMap, termTypes, semTypes, semById,
}) {
  const out = [`--- Schedule ---`];
  const curIdx = semIndex[currentSemId] ?? 0;
  const labelOf = id => standaloneSemLabel(semById.get(id), semTypes);

  for (const sem of semesters) {
    const ids = semesterCardIds(sem.id);
    const hasStart = !!specialTermStartMap[sem.id];
    const hasCont  = !!specialTermContMap[sem.id];
    if (!ids.length && !hasStart && !hasCont) continue;

    const isDone = (semIndex[sem.id] ?? 99) < curIdx;
    const status = isDone ? " (completed)" : (sem.id === currentSemId ? " (in progress)" : "");
    out.push(``, `${labelOf(sem.id)}${status}`);

    if (hasCont && !hasStart) {
      const d = specialTermPl[specialTermContMap[sem.id]];
      const type = d ? termTypes.find(t => t.id === d.typeId) : null;
      if (type && resolveTermByDuration(type.durations, d.duration)) {
        out.push(`  ⤷ ${type.label}${d.company ? ` @ ${d.company}` : ""} (continues)`);
      }
    }
    if (hasStart) {
      const d = specialTermPl[specialTermStartMap[sem.id]];
      const type = d ? termTypes.find(t => t.id === d.typeId) : null;
      const dur  = type ? resolveTermByDuration(type.durations, d.duration) : null;
      if (dur) {
        const nextId  = semesters[semesters.findIndex(s => s.id === sem.id) + 1]?.id;
        const spans   = termSpans(dur.weight, sem.weight ?? 1) && !!nextId;
        // The course a work term REGISTERS is the only reason it satisfies a
        // requirement, and it never appears in the course lines below because
        // it is not placed. A summary that omits it describes a plan the
        // reader cannot check.
        const reg = d.courseId ? ` · registers ${courseMap[d.courseId]?.code ?? d.courseId}` : "";
        out.push(`  ⤷ ${type.label}${d.company ? ` @ ${d.company}` : ""}`
          + `${d.subline ? ` · ${d.subline}` : ""}${reg}`
          + `${spans ? ` (spans into ${labelOf(nextId)})` : ""}`);
      }
    }
    for (const id of ids) {
      const c = courseMap[id];
      // `[retired]` is a PROPERTY OF THE COURSE, so it is printed on the
      // course. It used to be a flag, which accused a student of following
      // their own catalog year: a retired course is in the runtime catalog
      // precisely because a shipped program edition still requires it.
      if (c) out.push(`  ${c.code}: ${c.title} (${c.sh} ${unitName})`
        + (c.retired ? ` [retired]` : ""));
    }
  }
  return out;
}

/**
 * The descriptions, on their own — the old appendix, as its own artifact.
 *
 * Kept as a SECOND copy action rather than a mode flag, so the two pastes
 * compose: the plan goes first, and this follows only if the reader cannot
 * fetch a URL and says so. Timeline only — a parked course is not part of the
 * plan being exported.
 */
export function buildCourseDescriptions({ placements, courseMap, semIndex, unitName = "SH" }) {
  const ids = Object.keys(filterInTimeline(placements, semIndex))
    .filter(id => courseMap[id])
    .sort((a, b) => String(courseMap[a].code).localeCompare(String(courseMap[b].code)));

  const out = [`--- Course descriptions (${ids.length} courses, from the Northeastern catalog) ---`,
               `Copied verbatim. Fuller data per course, including prerequisite logic and`,
               `offering history: https://numap.app/data/courses/{SUBJECT}/{NUMBER}`];
  for (const id of ids) {
    const c = courseMap[id];
    out.push(``, `${c.code}: ${c.title} (${c.sh} ${unitName})`);
    out.push(`  ${(c.desc ?? c.description ?? "").trim() || "No description published."}`);
  }
  return out.join("\n");
}
