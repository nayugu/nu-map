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
 * A row that LABELS other rows rather than reserving a place of its own.
 *
 * Fourteen plans nest their grid: Biomedical Sciences PhD prints "During the
 * first year of courses, students must complete one course for each
 * specialization:" and then, under it, an unpriced heading per specialization
 * with the courses beneath those. Read flat, every one of those headings
 * becomes a slot the student is told to fill, and the sentence itself becomes
 * a 3 SH reservation for a course that does not exist.
 *
 * A priced row is NEVER a heading, however it is worded. Business
 * Administration BSBA prints the hours on the heading and leaves the courses
 * beneath it blank, so discarding priced headings loses 8 SH from a term — the
 * one direction that must not happen, since it silently under-counts a degree.
 * "During the first year… one course for each specialization: 3-6" reads like
 * prose and IS a reservation: complete one course per area, worth 3-6 SH.
 *
 * So credit decides first, and wording only sorts the rows that carry none:
 * a colon, a bare connective, or a sentence too long to be a label. Note that
 * "Dialogue of Civilizations" and "Optional 4-month co-op" are also unpriced
 * and perfectly real, which is why absence of credit alone proves nothing.
 */
const HEADING = /:\s*$/;
const CONNECTIVE = /^(or|and|plus|then)$/i;
const PROSE_MIN = 60;

function isHeadingRow(text, sh) {
  if (sh != null) return false;
  return CONNECTIVE.test(text) || HEADING.test(text) || text.length > PROSE_MIN;
}

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
 * Classify one grid cell.
 * @param {object} cell node-html-parser element
 * @returns {object|null} entry, or null for an empty cell
 */
function readCell(cell, hoursCell) {
  // "4", "4-5", "1.5". A range takes its low end: a plan should never claim
  // more credit than the student is certain to earn.
  const rawHours = hoursCell?.text?.replace(/\s+/g, " ").trim() ?? "";
  const shMatch = /(\d+(?:\.\d+)?)/.exec(rawHours);
  const sh = shMatch ? parseFloat(shMatch[1]) : null;
  const withSh = (entry) => (sh == null ? entry : { ...entry, sh });

  const text = cell.text.replace(/ /g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;

  const codes = [];
  for (const a of cell.querySelectorAll("a.code, a.bubblelink")) {
    const k = keyOf(a.getAttribute("title") || a.text);
    if (k && !codes.includes(k)) codes.push(k);
  }

  if (!codes.length) {
    // Checked before the classifiers below, because a heading can begin with
    // any word at all — including "Co-op" or "Vacation".
    if (isHeadingRow(text, sh)) return { kind: "heading", text, ...(sh == null ? {} : { sh }) };
    if (VACATION.test(text)) return { kind: "vacation", text };
    if (COOP.test(text)) return withSh({ kind: "coop", text });
    return withSh({ kind: "placeholder", text });
  }
  // Every code being a co-op course means the cell IS a co-op, however it is
  // worded. Requiring all of them keeps a cell that merely mentions one
  // alongside real coursework from disappearing into a work term.
  if (codes.every((c) => COOP_COURSE.test(c))) return withSh({ kind: "coop", codes, text });
  if (codes.length === 1) return withSh({ kind: "course", codes, text });
  // Two or more codes: the connector decides whether the student takes all of
  // them or picks one. Default to "courses" (all) — assuming a choice where
  // the catalog meant a pair would drop a required course, which is the
  // direction that hurts.
  return withSh({ kind: /\bor\b/i.test(text) ? "choice" : "courses", codes, text });
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
        const n = parseFloat(cells[c.cellIndex + 1]?.text.trim() ?? "");
        if (Number.isFinite(n) && year?.terms[i]) year.terms[i].hours = n;
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
        for (const e of t.entries) for (const k of e.codes ?? []) out.add(k);
      }
    }
  }
  return [...out].sort();
}

/**
 * Check a parsed grid against the catalog's own arithmetic.
 *
 * The grid prints a total beside every term (`plangridsum`), which is the
 * department stating what it believes the term adds up to. That makes it a
 * free, per-row checksum on the whole parse: if our entries sum to it, we read
 * the row correctly, and if they stop doing so, a template change has broken
 * the parse. Across the shipped corpus this agrees on 9,485 of 9,492 terms.
 *
 * It is worth having because nothing else guards this file. The requirement
 * side has verify-majors, check-major-integrity and the scrape rails; the plan
 * side had only a count of how many plans came back, so a run that produced
 * 385 confidently wrong plans looked exactly like a run that worked.
 *
 * A term is only judged when the catalog stated a total, and hours ranges are
 * compared at their low end — the same end readCell takes, since a plan should
 * never claim more credit than the student is certain to earn.
 *
 * @returns {{terms:number, agree:number, disagree:number, unstated:number,
 *            worst:Array<{program?:string, year:string, term:string,
 *                         stated:number, parsed:number}>}}
 */
export function verifyPlanGrid(grid, label = "") {
  const out = { terms: 0, agree: 0, disagree: 0, unstated: 0, worst: [] };
  for (const plan of grid?.plans ?? []) {
    for (const year of plan.years ?? []) {
      for (const term of year.terms ?? []) {
        if (!term.entries?.length) continue;
        out.terms += 1;
        if (typeof term.hours !== "number") { out.unstated += 1; continue; }
        // A heading carries the hours of the rows beneath it, which are
        // counted in their own right — adding both would double-count.
        const parsed = term.entries.reduce(
          (n, e) => n + (e.kind === "heading" ? 0 : e.sh ?? 0), 0);
        if (Math.abs(parsed - term.hours) < 0.01) out.agree += 1;
        else {
          out.disagree += 1;
          out.worst.push({
            program: label, year: year.label, term: term.term,
            stated: term.hours, parsed,
          });
        }
      }
    }
  }
  return out;
}
