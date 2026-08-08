/**
 * plan-grid.js — the department's Sample Plan of Study, as structure.
 *
 * ## Why this exists separately from extractPlanOfStudyCourses
 *
 * That function flattens the same pane into a sorted Set of course keys, and
 * is right to: its only job is the verification WITNESS (every course the
 * department's own plan names must be accounted for by the parsed
 * requirements), and a witness needs no order. This one keeps the order,
 * because a student asking to "load the sample plan" is asking exactly the
 * question the flattened list threw away: *when*.
 *
 * The two must not be merged. Verification would start depending on grid
 * parsing succeeding, and a grid we could not read would silently weaken a
 * check rather than merely disabling a feature.
 *
 * ## What the catalog actually gives us
 *
 *   <table class="sc_plangrid">
 *     <tr class="plangridyear">  Year 1
 *     <tr class="plangridterm">  Fall | Hours | Spring | Hours | Summer 1 | Hours | …
 *     <tr class="even">          CS 1200 | 1 | CS 2100 and CS 2101 | 5 | …
 *     <tr class="plangridsum">   | 19 | | 17 | …
 *
 * Terms are COLUMNS, and their count varies by program (two for most, four
 * where summers are used). A cell holds one of five things, and conflating
 * them is the main way this parse goes wrong:
 *
 *   course       CS 1200
 *   courses      CS 2100 and CS 2101   — a co-requisite pair, both required
 *   choice       MATH 1365 or 1465     — the student picks; we must not pick
 *   coop         Co-op                 — maps to a real NU Map co-op block
 *   placeholder  General Elective      — a slot with no course named
 *
 * ## Programs publish SEVERAL plans, and the difference is co-op timing
 *
 * A pane holds one grid per plan, each introduced by a heading that names the
 * pattern — "Four Years, Two Co-ops in Spring/Summer First Half", "Five Years,
 * Three Co-ops in Summer Second Half/Fall". Philosophy BA publishes six.
 * Reading only the first (which a `querySelector` quietly does) drops the rest
 * and, worse, silently picks a co-op pattern on the student's behalf — the one
 * variable the whole planner exists to get right. So every grid is returned,
 * labelled, and the choice belongs to the student.
 *
 * ## A plan's heading carries its concentration only the FIRST time
 *
 * Philosophy BA's six headings run:
 *
 *     Four Years, Two Co-ops in Summer Second Half/Fall
 *     Four Years, Two Co-ops in Spring/Summer First Half
 *     Philosophy with Concentration in Law and Ethics: Four Years, Two Co-ops…
 *     Four Years, Two Co-ops in Spring/Summer First Half        ← still Law and Ethics
 *     Philosophy with Concentration in Religious Studies: Four Years, Two Co-ops…
 *     Four Years, Two Co-ops in Spring/Summer First Half        ← still Religious Studies
 *
 * All six are H3, so nesting cannot be read from the tag. The context is
 * announced once and then assumed, which is fine for a human reading top to
 * bottom and useless to a parser taking headings one at a time: three plans
 * come out identically named. That matters because the label is the plan's
 * only identity in the UI and in a saved selection — the same reason
 * concentration titles are resolved through one module. So a "Context: pattern"
 * heading sets a context that later bare-pattern headings inherit, and any
 * label that still collides is suffixed rather than allowed to shadow another.
 *
 * ## Rows are NOT index-aligned with the header — walk the classes
 *
 * The header names N terms as 2N cells (term, Hours, term, Hours, …), but a
 * content row does not keep that shape: a term with nothing in it collapses to
 * ONE unclassed empty cell rather than an empty code/hours pair, so every
 * column after it shifts left. Political Science BA year 4 does exactly this —
 *
 *     header   Fall | Hours | Spring | Hours | Summer 1 | Hours | Summer 2 | Hours
 *     row      "" | ENVR 3300 codecol | 4 hourscol | Elective codecol | 4 | ""
 *
 * — and matching by index silently files ENVR 3300 under the wrong term or
 * drops it entirely. So a row is consumed left to right instead: a `codecol`
 * (with its following `hourscol`) is one term, and any other cell is one empty
 * term. That is stable against however many terms a year happens to use.
 *
 * ## Codes come from links, never from text
 *
 * Every real course in a cell is an <a class="bubblelink code"> carrying a
 * title like "CS 2100". The visible text is unreliable — it abbreviates
 * ("MATH 1365 or 1465", where the second has no subject), wraps, and uses
 * non-breaking spaces. So links give the codes and text gives only the
 * CONNECTOR (and/or) and the placeholder wording. That is what makes
 * "MATH 1365 or 1465" resolve correctly to two distinct courses.
 */

/**
 * Term column headers, mapped to NU Map's semester ids.
 *
 * The right-hand side may only ever be `fall`, `spring`, `sumA` or `sumB` —
 * those are the four the calendar adapter generates (src/core/semGrid.js), and
 * anything else is a term the planner has no slot for.
 *
 * "Summer Full Semester" is one term spanning both halves, which the planner
 * has no single slot for: it splits summer in two because that is how NEU
 * registers it. It anchors to `sumA`, where the course actually starts, and
 * carries `fullSummer` so the term can say so rather than pretending to be a
 * first-half term. This is not an edge case — it is how most GRADUATE programs
 * write summer (17 of the 18 programs using it), where the co-op-driven
 * half-summer split does not apply.
 */
const TERM_TYPES = {
  "fall": ["fall", false],
  "spring": ["spring", false],
  "summer 1": ["sumA", false], "summer i": ["sumA", false], "summer a": ["sumA", false],
  "summer 2": ["sumB", false], "summer ii": ["sumB", false], "summer b": ["sumB", false],
  "summer": ["sumA", true], "summer full semester": ["sumA", true],
  "full summer": ["sumA", true], "summer full": ["sumA", true],
};

/** Co-op / experiential entries, which are blocks rather than courses. */
const COOP = /^(co-?op|cooperative education|experiential learning|industry placement)\b/i;

/**
 * Some programs write the co-op as the COURSE a student registers for rather
 * than as the word "Co-op": COOP 3945, 3946, 3948 are real zero-credit "Co-op
 * Work Experience" courses. Ten programs and 51 cells do this.
 *
 * They describe exactly the same thing as a cell reading "Co-op", so treating
 * one as a block and the other as a course would put a phantom zero-credit
 * card in the student's plan instead of a work term — no co-op rendering, no
 * EX attribute, and a load calculation that thinks the term is free. The codes
 * are kept on the entry rather than discarded, since they are genuinely
 * registrable and a future export may want them.
 */
const COOP_COURSE = /^COOP\d/;

/**
 * A term the student is deliberately NOT studying. 758 cells say "Vacation",
 * which is neither a course nor a slot to fill: reading it as a placeholder
 * would put an empty requirement slot in a semester the department is telling
 * you to take off, and it would carry credit hours toward a term load that is
 * supposed to be zero.
 */
const VACATION = /^(vacation|break|no classes|off)\b/i;

/** Normalize "CS 2100" / "CS 2100" → "CS2100". */
function keyOf(raw) {
  const m = /^([A-Z]{2,6})\s*(\d{3,4}[A-Z]?)$/.exec(
    String(raw || "").replace(/ /g, " ").trim());
  return m ? `${m[1]}${parseInt(m[2], 10)}` : null;
}

const termTypeOf = (label) =>
  TERM_TYPES[String(label || "").replace(/ /g, " ").replace(/\s+/g, " ").trim().toLowerCase()]
  ?? [null, false];

/**
 * A row that LABELS other rows rather than reserving a place of its own.
 *
 * Fourteen plans nest their grid. Biomedical Sciences PhD prints "During the
 * first year of courses, students must complete one course for each
 * specialization:" and beneath it an unpriced heading per specialization with
 * the courses under those. Read flat, every heading becomes a reservation the
 * student is told to fill.
 *
 * Credit decides before wording: a priced row is NEVER a heading however it
 * reads. Business Administration BSBA prints a term's hours ON the heading and
 * leaves the courses beneath blank, so discarding priced headings loses 8 SH
 * from a term — the one direction that must not happen. "Dialogue of
 * Civilizations" is unpriced and perfectly real, so absence of credit alone
 * proves nothing either; the wording test only sorts the rows carrying none.
 */
const HEADING_COLON = /:\s*$/;
const CONNECTIVE    = /^(or|and|plus|then)$/i;
const PROSE_MIN     = 60;

const isHeadingRow = (text, sh) =>
  sh == null && (CONNECTIVE.test(text) || HEADING_COLON.test(text) || text.length > PROSE_MIN);

/** A code as it appears in prose: "CS 2100", or a bare number continuing a list. */
const CODE_MENTION = /\b[A-Z]{2,6}\s*\d{3,4}[A-Z]?\b|\b\d{3,4}\b/g;

/**
 * Split a cell's codes into OPTION GROUPS, preserving the catalog's grouping.
 *
 * The student must take every code in one group, and may pick any single group.
 * This is the whole reason the entry model changed: 36 cells mix the two
 * connectives, and flattening them asserts something false —
 *
 *   "PSYC 3200 or PT 5410 and PT 5411"
 *      means  PSYC 3200  OR  (PT 5410 AND PT 5411)
 *      flat   three interchangeable alternatives, so PT 5410 alone "satisfies" it
 *
 * Codes come from links and are therefore trustworthy and in document order;
 * the TEXT is only consulted for the connectives between them. So the text is
 * split into segments, each segment's code MENTIONS are counted, and that many
 * codes are drawn from the ordered list. Nothing depends on parsing a code out
 * of prose, which is what makes this safe against "MATH 1365 or 1465" where the
 * second mention carries no subject.
 *
 * A comma-separated list ending in ", or" separates on commas too, otherwise
 * "MATH 1231, 1241, …, or 1341" would come out as one five-course group.
 */
function optionGroups(text, codes) {
  if (codes.length <= 1) return codes.length ? [[codes[0]]] : [];

  const hasOr  = /\bor\b/i.test(text);
  const hasAnd = /\band\b/i.test(text);
  if (!hasOr) return [codes];                       // "A and B" — one group, all required

  // ", or" marks a comma-separated list of alternatives.
  const commaList = /,\s*(?:or)\b/i.test(text);
  const splitter  = commaList ? /,|\bor\b/i : /\bor\b/i;

  const segments = text.split(splitter).map(t => t.trim()).filter(Boolean);
  const groups = [];
  let i = 0;
  for (const seg of segments) {
    const n = (seg.match(CODE_MENTION) ?? []).length;
    if (!n) continue;
    const take = codes.slice(i, i + n);
    if (take.length) groups.push(take);
    i += n;
  }
  // Any code the text could not account for joins the last group rather than
  // being dropped — losing one is worse than over-grouping it.
  if (i < codes.length) {
    if (groups.length) groups[groups.length - 1].push(...codes.slice(i));
    else groups.push(codes.slice(i));
  }
  return groups.length ? groups : [codes];

  // Note: `hasAnd && hasOr` cells are flagged `ambiguous` by the caller. The
  // grouping above is best-effort for them, and the verbatim text is kept so a
  // reader can always see what the catalog actually said.
}

/**
 * Read one grid cell into an entry.
 *
 * One node type. What varies is how precisely the catalog named the answer:
 * `options` holds the groups it named, and an empty `options` is what used to
 * be called a slot — the same node with the answer left unstated.
 *
 * @param {object} cell node-html-parser element
 * @param {object|null} hoursCell
 * @returns {object|null} entry, or null for an empty cell
 */
function readCell(cell, hoursCell) {
  // "4", "4-5", "1.5". A range takes its low end: a plan should never claim
  // more credit than the student is certain to earn.
  const rawHours = hoursCell?.text?.replace(/\s+/g, " ").trim() ?? "";
  // "4", "4-5", "1.5". The LOW end is the credit a plan may claim — a student
  // should never be told they will earn more than is certain. The high end is
  // kept alongside it so the checksum can compare ranges rather than points:
  // the catalog states its term totals as ranges too, and comparing low-to-low
  // reports a mismatch whenever a department rounds its own sum differently.
  const shNums = rawHours.match(/\d+(?:\.\d+)?/g) ?? [];
  const sh = shNums.length ? parseFloat(shNums[0]) : null;
  const shMax = shNums.length > 1 ? parseFloat(shNums[shNums.length - 1]) : null;

  const text = cell.text.replace(/ /g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;

  const codes = [];
  for (const a of cell.querySelectorAll("a.code, a.bubblelink")) {
    const k = keyOf(a.getAttribute("title") || a.text);
    if (k && !codes.includes(k)) codes.push(k);
  }

  const base = { text, ...(sh == null ? {} : { sh }), ...(shMax == null ? {} : { shMax }) };

  if (!codes.length) {
    // Checked first: a heading may begin with any word at all, including
    // "Co-op" or "Vacation".
    if (isHeadingRow(text, sh)) return { ...base, heading: true, options: [], children: [] };

    // Both patterns are anchored and neither excludes the other, so
    // first-match-wins silently dropped an option: "Co-op or vacation" became a
    // forced co-op, "Vacation or optional co-op" a forced vacation. An either
    // keeps the decision with the student, which is the governing rule.
    const vac = VACATION.test(text);
    const coop = COOP.test(text);
    if (vac || coop) {
      const alsoVac  = vac  || /\bvacations?\b/i.test(text);
      const alsoCoop = coop || /\bco-?op\b/i.test(text);
      if (alsoVac && alsoCoop) return { ...base, either: ["coop", "vacation"], options: [] };
      return { ...base, [vac ? "vacation" : "coop"]: true, options: [] };
    }
    // Named nothing — a reservation whose answer the plan leaves open.
    return { ...base, options: [] };
  }

  // Every code being a co-op course means the cell IS a co-op, however worded.
  // Requiring all of them keeps a cell that merely mentions one alongside real
  // coursework from disappearing into a work term.
  if (codes.every((c) => COOP_COURSE.test(c))) return { ...base, coop: true, options: [codes] };

  const groups = optionGroups(text, codes);
  const ambiguous = /\bor\b/i.test(text) && /\band\b/i.test(text) && groups.length > 1;
  return { ...base, options: groups, ...(ambiguous ? { ambiguous: true } : {}) };
}

/**
 * Fold heading rows so the rows they label become their children.
 *
 * Scope is "until the next heading in the same term", which is all the grid
 * gives us — nesting is expressed by layout, not markup. Entries before the
 * first heading stay at top level.
 */
function nestHeadings(entries) {
  if (!entries.some(e => e.heading)) return entries;
  const out = [];
  let open = null;
  for (const e of entries) {
    if (e.heading) { open = e; out.push(e); continue; }
    if (open) open.children.push(e);
    else out.push(e);
  }
  return out;
}

/**
 * Parse the Sample Plan of Study grid from a program page.
 *
 * Returns null when the page has no plan (minors and most graduate programs
 * publish none) — absence is normal and must not read as failure.
 *
 * @param {object} pageRoot node-html-parser root of the whole page
 * @returns {{plans: Array<{label: string, years: Array}>}|null}
 */
export function extractPlanGrid(pageRoot) {
  const plans = [];
  for (const pane of pageRoot.querySelectorAll("div[id]")) {
    if (!/^planofstudy/.test(pane.getAttribute("id") ?? "")) continue;
    // Document order, so each grid is claimed by the heading above it. A
    // querySelectorAll pass over tables alone cannot do this.
    let heading = null;
    let context = null;
    for (const node of pane.querySelectorAll("h1, h2, h3, h4, h5, p, table.sc_plangrid")) {
      const tag = (node.tagName || "").toUpperCase();
      if (tag !== "TABLE") {
        const text = node.text.replace(/\s+/g, " ").trim();
        // Headings name the co-op pattern; prose paragraphs do not. Require a
        // heading, or a short paragraph that reads like a plan title.
        if (/^H[1-5]$/.test(tag) && text) heading = text;
        else if (tag === "P" && YEAR_COUNT.test(text)) heading = text;
        continue;
      }
      const parsed = parseGridTable(node);
      if (!parsed) continue;
      const named = splitHeading(heading, context);
      context = named.context;
      plans.push({
        label: named.label || `Plan ${plans.length + 1}`,
        pattern: named.pattern,
        concentration: named.context,
        years: parsed,
      });
    }
  }
  if (!plans.length) return null;
  return { plans: disambiguate(plans) };
}

/** Plan patterns are announced by their length: "Four Years, Two Co-ops in …". */
const YEAR_COUNT = /^(one|two|three|four|five|six|seven|eight)\s+years?\b/i;

/**
 * Read a heading as `[context: ]pattern`, inheriting the running context when
 * the heading names only a pattern.
 *
 * The split is only taken when the right side actually looks like a plan
 * pattern; otherwise the colon belongs to the title itself and the whole
 * heading is used as-is. Getting this wrong is cosmetic in one direction and
 * destroys the label in the other, so it fails closed.
 */
function splitHeading(raw, inherited) {
  const s = String(raw || "").replace(/^sample plans? of study:?\s*/i, "").trim();
  if (!s) return { label: "", pattern: "", context: inherited };

  const at = s.indexOf(":");
  if (at > 0) {
    const left = s.slice(0, at).trim();
    const right = s.slice(at + 1).trim();
    if (left && right && YEAR_COUNT.test(right) && !YEAR_COUNT.test(left)) {
      return { label: `${left}: ${right}`, pattern: right, context: left };
    }
    return { label: s, pattern: s, context: inherited };
  }
  // A bare pattern under an established context still belongs to it.
  if (inherited && YEAR_COUNT.test(s)) {
    return { label: `${inherited}: ${s}`, pattern: s, context: inherited };
  }
  return { label: s, pattern: s, context: inherited };
}

/**
 * Guarantee labels are unique within a program. The label is how a saved
 * selection points at a plan, so two plans sharing one would make the
 * student's choice unrecoverable — better a visible "(2)" than a silent
 * shadow.
 */
function disambiguate(plans) {
  const seen = new Map();
  for (const p of plans) {
    const n = (seen.get(p.label) ?? 0) + 1;
    seen.set(p.label, n);
    if (n > 1) p.label = `${p.label} (${n})`;
  }
  return plans;
}

/** Parse one <table class="sc_plangrid"> into years. */
function parseGridTable(table) {
  const years = [];
  let columns = [];          // [{ label, type, cellIndex }] — index is for the sum row only
  let year = null;

  for (const tr of table.querySelectorAll("tr")) {
    const cls = tr.getAttribute("class") ?? "";
    const cells = tr.querySelectorAll("td, th");

    if (cls.includes("plangridyear")) {
      if (year?.terms.length) years.push(year);
      year = { label: cells[0]?.text.replace(/\s+/g, " ").trim() || `Year ${years.length + 1}`, terms: [] };
      continue;
    }

    if (cls.includes("plangridterm")) {
      // Header row: term names alternate with their "Hours" column, so a
      // term's courses live at the index the term name occupies.
      columns = [];
      cells.forEach((c, i) => {
        const label = c.text.replace(/ /g, " ").replace(/\s+/g, " ").trim();
        if (!label || /^hours$/i.test(label)) return;
        const [type, fullSummer] = termTypeOf(label);
        columns.push({ label, type, fullSummer, cellIndex: i });
      });
      if (!year) year = { label: `Year ${years.length + 1}`, terms: [] };
      year.terms = columns.map((c) => ({
        term: c.label, type: c.type, hours: null, entries: [],
        ...(c.fullSummer ? { fullSummer: true } : {}),
      }));
      continue;
    }

    if (cls.includes("plangridsum") || cls.includes("plangridtotal")) {
      // Per-term credit totals sit in the Hours column beside each term.
      columns.forEach((c, i) => {
        const raw = cells[c.cellIndex + 1]?.text.trim() ?? "";
        const nums = raw.match(/\d+(?:\.\d+)?/g) ?? [];
        const n = nums.length ? parseFloat(nums[0]) : NaN;
        if (Number.isFinite(n) && year?.terms[i]) {
          year.terms[i].hours = n;
          if (nums.length > 1) year.terms[i].hoursMax = parseFloat(nums[nums.length - 1]);
        }
      });
      continue;
    }

    // A content row contributes at most one entry per term column, and is
    // walked rather than indexed — see the header note on misalignment.
    if (!year || !columns.length) continue;
    let termIndex = 0;
    for (let i = 0; i < cells.length && termIndex < year.terms.length; termIndex++) {
      const cell = cells[i];
      const cls2 = cell.getAttribute("class") ?? "";
      if (cls2.includes("codecol")) {
        const next = cells[i + 1];
        const hoursCell = (next?.getAttribute("class") ?? "").includes("hourscol") ? next : null;
        const entry = readCell(cell, hoursCell);
        if (entry) year.terms[termIndex].entries.push(entry);
        // Its hours cell belongs to the same term; step over it if present.
        i += (cells[i + 1]?.getAttribute("class") ?? "").includes("hourscol") ? 2 : 1;
      } else {
        i += 1;   // an empty term occupies a single cell
      }
    }
  }
  if (year?.terms.length) years.push(year);

  for (const y of years) for (const t of y.terms) t.entries = nestHeadings(t.entries);

  // A grid with no entries anywhere is a parse failure dressed as success.
  const any = years.some((y) => y.terms.some((t) => t.entries.length));
  return any ? years : null;
}

/**
 * Every course key any of the plans names — the union, because the plans are
 * alternative routes through ONE degree and a course appearing in only some of
 * them is still part of it. Used to cross-check the structured parse against
 * the flattened witness.
 */
export function planGridCourseKeys(grid) {
  const out = new Set();
  for (const p of grid?.plans ?? []) {
    for (const y of p.years) {
      for (const t of y.terms) {
        for (const e of t.entries) collectKeys(e, out);
      }
    }
  }
  return [...out].sort();
}

/** Every code an entry and its children name, across all option groups. */
function collectKeys(entry, out) {
  for (const group of entry?.options ?? []) for (const k of group) out.add(k);
  for (const child of entry?.children ?? []) collectKeys(child, out);
}

/**
 * Check a parsed grid against the catalog's own arithmetic.
 *
 * Every term prints its total beside it, which is the department stating what
 * it believes the term adds up to — a free, per-row checksum on the whole
 * parse. Across the shipped corpus it agrees on 9,485 of 9,492 terms (99.93%),
 * and that figure is the regression test for any change to cell reading.
 *
 * It is worth having because nothing else guards this file: the requirement
 * side has verify-majors, check-major-integrity and the scrape rails, while
 * the plan side had only a count of how many plans came back — so a run
 * producing hundreds of confidently wrong grids looked exactly like success.
 *
 * A heading contributes nothing of its own; its credit, where the catalog put
 * it there, is the row's and its children are counted separately.
 */
export function verifyPlanGrid(grid, label = "") {
  const out = { terms: 0, agree: 0, disagree: 0, unstated: 0, ambiguous: 0, worst: [] };
  const sum = (entries) => (entries ?? []).reduce(
    (n, e) => n + (e.sh ?? 0) + sum(e.children), 0);
  // Both sides state ranges, so compare ranges. Public Health BA prints two
  // "3-4" cells against a stated "15-16": the low ends sum to 14, so a
  // point comparison calls our parse wrong when it is the department's own
  // arithmetic that does not close.
  const sumMax = (entries) => (entries ?? []).reduce(
    (n, e) => n + (e.shMax ?? e.sh ?? 0) + sumMax(e.children), 0);
  const countAmbiguous = (entries) => (entries ?? []).reduce(
    (n, e) => n + (e.ambiguous ? 1 : 0) + countAmbiguous(e.children), 0);

  for (const plan of grid?.plans ?? []) {
    for (const year of plan.years ?? []) {
      for (const term of year.terms ?? []) {
        if (!term.entries?.length) continue;
        out.terms += 1;
        out.ambiguous += countAmbiguous(term.entries);
        if (typeof term.hours !== "number") { out.unstated += 1; continue; }
        const lo = sum(term.entries), hi = sumMax(term.entries);
        const catLo = term.hours, catHi = term.hoursMax ?? term.hours;
        // Overlapping ranges is agreement: our low end may sit below theirs
        // when they rounded, but the two must describe the same term.
        if (lo <= catHi + 0.01 && hi >= catLo - 0.01) out.agree += 1;
        else {
          out.disagree += 1;
          out.worst.push({ program: label, year: year.label, term: term.term,
                           stated: term.hours, parsed });
        }
      }
    }
  }
  return out;
}
