// McpServer factory — a thin transport over the planner ports.
//
// Every tool is a serialization of a method on the IPlannerQuery /
// IPlannerAction adapters (src/adapters/mcp/); no domain logic lives
// here. Every response is `{ _plan, data }`: `_plan` is the liveness
// envelope (revision, sync time, what the user changed since Claude's
// last call), `data` is the tool result.
//
// Plan-scoped tools are consent-gated: the in-app kill switch (POST
// /consent/:sid { enabled:false }) makes them all return
// "access disabled by user" until re-enabled. Catalog and program tools
// are public data and never gated.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  SUPPORTED_ACTIONS,
  SUPPORTED_UI_COMMANDS,
  ACTION_DOCS,
} from "../../src/adapters/mcp/plannerActionAdapter.js";

export const SYNC_PAYLOAD_VERSION = 1;

// Zod schema for an arbitrary action object (type + any extra fields)
const ActionSchema = z.object({ type: z.string() }).passthrough();
const ChangesetArgs = {
  actions:            z.array(ActionSchema),
  rationale:          z.string().optional().describe("Why — shown to the user in the review UI. Write it in the user's language (the plan's `locale` field)."),
  label:              z.string().optional().describe("Short headline, e.g. 'Restructure Fall 2025'. Write it in the user's language (the plan's `locale` field)."),
  confirmDestructive: z.boolean().optional()
    .describe("Must be true when the changeset includes a DELETE_PLAN action"),
};

const COURSE_INCLUDE = ["offerings", "patterns", "relationships", "links"];
const PLAN_INCLUDE   = ["schedule", "semesters", "violations", "nupath", "changes", "proposals"];

// Tool annotations (title + read-only/destructive hints) — required by the
// Anthropic directory review and used by clients to gate confirmations.
// openWorldHint is false everywhere: the tools act on a closed domain
// (one catalog, one plan).
const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const TOOL_ANNOTATIONS = {
  request_pairing:     { title: "Link to NU Map",                 ...RW },
  search_courses:      { title: "Search courses",                 ...RO },
  get_course:          { title: "Get course details",             ...RO },
  get_offered_in:      { title: "Get offering history",           ...RO },
  list_programs:       { title: "List degree programs",           ...RO },
  get_program:         { title: "Get program requirements",       ...RO },
  audit_requirements:  { title: "Audit degree requirements",      ...RO },
  get_plan:            { title: "Get the live plan",              ...RO },
  list_plans:          { title: "List saved plans",               ...RO },
  get_plan_contents:   { title: "Read a saved plan",              ...RO },
  get_nupath_coverage: { title: "Get NUPath coverage",            ...RO },
  check_prereqs:       { title: "Check prerequisites",            ...RO },
  validate_changeset:  { title: "Dry-run plan changes",           ...RO },
  propose_changes:     { title: "Propose plan changes (user reviews)", ...RW },
  apply_changes:       { title: "Apply plan changes directly",    readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  ui_command:          { title: "Nudge the NU Map UI",            ...RW },
  get_meta:            { title: "Get data freshness & capabilities", ...RO },
};

/**
 * Environment-agnostic McpServer factory. The session state store and the
 * server→browser channel are INJECTED so the same tool definitions run on
 * the Node dev server (module singletons) and on Cloudflare Workers
 * (a per-session Durable Object).
 *
 * @param {object} opts
 * @param {ReturnType<import('../../src/adapters/mcp/plannerQueryAdapter.js').createPlannerQuery>} opts.query
 * @param {string} opts.sessionId
 * @param {object} opts.state    planState-shaped API (getPlan, setPlan, consent, pairing, proposals, envelope)
 * @param {object} opts.channel  { broadcast(sessionId, event), clientCount(sessionId) }
 */
export function createServer({ query, sessionId, state, channel }) {
  const server = new McpServer({
    name:        "NU Map",
    version:     "2.0.0",
    description: "Read and modify a Northeastern University course plan in NU Map",
  }, {
    // Delivered to the model at initialize — the ground rules it needs
    // BEFORE composing a changeset, so restrictions aren't discovered
    // through rejections.
    instructions: [
      "NU Map's primary purpose is READING: understand the user's plan and Northeastern's catalog so you can discuss them accurately. Changing the plan is secondary and always user-controlled.",
      "",
      "Etiquette:",
      "- Catalog tools always work; plan tools require the user to pair and enable access on the NU Map side. If a plan tool is denied, mention once how to connect (the Claude button in the NU Map header) and keep helping with catalog data — never nag, never call request_pairing unprompted.",
      "- Every plan tool response carries a _plan envelope. If it shows changedSinceLastRead, re-read (get_plan) before composing changes — proposals built on a stale view get flagged to the user.",
      "- Actions that move things on the user's screen (SWITCH_PLAN, ui_command) only in direct response to what the user asked.",
      "- Offering and seat data comes from scheduled scrapes (get_meta shows freshness), not live registration. Summers are 'Summer A' and 'Summer B'. Requirement audits are a best-effort guide; the user's academic advisor is the authority.",
      "- When a response includes a `note` field, work its point into your answer as one short line. This is non-negotiable for seat counts and instructor data — during registration, students will read snapshots as live availability unless told otherwise.",
      "",
      "Making changes:",
      "- Default to propose_changes — the user reviews a live preview and approves or rejects. Use apply_changes only when the _plan envelope shows autoApplyEnabled: true.",
      "- Changesets are atomic: one invalid action rejects the whole batch, with a per-action reason saying what to fix.",
      "- The complete action reference (arguments + restrictions) is in get_meta capabilities.actionDocs. validate_changes dry-runs a changeset without touching anything — use it when unsure.",
      "- Never guess ids. Verify courseIds via search_courses/get_course and programIds via list_programs before composing a changeset.",
      "",
      "Broad catalog surveys ('all upper-level MATH', 'courses about X'): one search_courses call with filters — subject + minNumber/maxNumber for level ranges, anyOf with several synonyms for concepts, prereqsMetBy with the plan's completed + placed-out ids for 'what can the user take', unlockedBy for 'what does course X open up', instructor for 'what does Prof. X teach' (3-year history; combine with term for a season), includeInstructors: true when the user wants to know who teaches the results, sortBy: 'enrollment' for popularity — and limit up to 200. Then get_course on the narrowed shortlist for descriptions, prereqs, and offering history. Predicting who teaches a course next: read the per-term instructor history (get_offered_in or instructorMatch.taught) for REGULARITY — shares say whose course it is, term lists say when they teach it. The full catalog lives server-side; you never need to fetch external pages.",
      "",
      "Restrictions that most often reject changesets:",
      "- SET_SH_OVERRIDE: most courses have FIXED credits and cannot be overridden. Only valid when get_course shows a credit range (shMin < shMax).",
      "- Waiver vs equivalence: ADD_PLACED_OUT waives a course (satisfies prereqs, NO credit); ADD_SUBSTITUTION declares one real course fills another's requirement slot. They are not interchangeable.",
      "- semId format: 'fall2026', 'spr2027', 'sumA2027', 'sumB2027', or 'incoming'.",
      "- SET_STUDENT_TYPE clears major/major2/concentration — put SET_MAJOR (and SET_CONCENTRATION) after it in the same changeset.",
      "- SET_OFFERED_OVERRIDE status and SET_BONUS_SH amount must be real booleans/numbers, not strings.",
      "- DELETE_PLAN requires confirmDestructive: true on the changeset.",
    ].join("\n"),
  });

  // ── Response helpers ────────────────────────────────────────────

  const respond = (data, note) => ({
    content: [{ type: "text", text: JSON.stringify({
      _plan: state.planEnvelope(sessionId),
      ...(note && { note }),
      data,
    }) }],
  });

  // Rides every response that carries seat or instructor data. The model is
  // instructed to relay it in one line — students WILL read scraped seat
  // counts as live availability during registration unless told otherwise.
  const HISTORICAL_NOTE =
    `Based on historical NU Map data (updated ${query.meta?.lastUpdated ?? "monthly"}), not live registration — ` +
    `current seat counts and instructor assignments may differ; verify in the Student Hub before registering.`;

  const NO_PLAN  = { error: "No plan synced yet. Open NU Map — the plan syncs automatically on load." };
  const DISABLED = { error: "Access paused by user. Plan tools are off until Claude access is re-enabled in NU Map settings. Catalog and program tools still work." };
  const UNPAIRED = { error: "Not linked to the user's NU Map. Call request_pairing to get a 6-character code, show it to the user, and ask them to enter it in NU Map → Claude panel → Connect. Catalog and program tools work without linking." };

  /** Live plan for plan-scoped tools; deny reason when unavailable. */
  const livePlan = () => {
    const consent = state.getConsent(sessionId);
    if (!consent.paired)  return { deny: UNPAIRED };
    if (!consent.enabled) return { deny: DISABLED };
    const plan = state.getPlan(sessionId);
    if (!plan) return { deny: NO_PLAN };
    return { plan };
  };

  const guardChangeset = (actions, confirmDestructive, { needsAutoApply = false } = {}) => {
    if (!state.getConsent(sessionId).paired)
      return { status: "rejected", reason: UNPAIRED.error };
    if (!state.getConsent(sessionId).enabled)
      return { status: "rejected", reason: DISABLED.error };
    if (needsAutoApply && !state.getConsent(sessionId).autoApply)
      return { status: "rejected", reason: "Automatic apply is off (the default). Use propose_changes so the user can review and approve, or the user can enable auto-apply in NU Map settings." };
    if (actions.some(a => a.type === "DELETE_PLAN") && !confirmDestructive)
      return { status: "rejected", reason: "DELETE_PLAN requires confirmDestructive: true on the changeset." };
    if (channel.clientCount(sessionId) === 0)
      return { status: "rejected", reason: "No NU Map browser tab is connected. Open NU Map and ensure the MCP integration is active." };
    // Changesets are atomic: any invalid or unknown action rejects the
    // whole batch WITH the per-action reasons, so the model can fix its
    // composition and retry instead of the user approving a half-broken
    // proposal. (See get_meta capabilities.actionDocs for the reference.)
    const plan = state.getPlan(sessionId);
    if (plan) {
      const v = query.validateChangeset(actions, plan);
      if (v.unsupported.length || v.invalid.length) {
        return {
          status: "rejected",
          reason: "The changeset contains invalid actions. Fix them and retry; action reference is in get_meta capabilities.actionDocs.",
          unsupported: v.unsupported,
          invalid: v.invalid,
        };
      }
    }
    return null;
  };

  /** Resolve program labels for the plan snapshot (browser sends nulls). */
  const withLabels = (plan) => {
    const label = (id) => (id ? query.getProgram(id, [])?.label ?? null : null);
    return {
      ...plan,
      majorLabel:  plan.majorLabel  ?? label(plan.major),
      major2Label: plan.major2Label ?? label(plan.major2),
      minor1Label: plan.minor1Label ?? label(plan.minor1),
      minor2Label: plan.minor2Label ?? label(plan.minor2),
    };
  };

  // ── Prompts ─────────────────────────────────────────────────────
  // ONE entry point, deliberately: a palette of task prompts would read as
  // "this is everything NU Map does" and shrink it. /numap is a trigger,
  // not a menu — it engages the full toolkit and says so, both to the
  // model and to the user reading the injected message.

  const promptText = (text) => ({ messages: [{ role: "user", content: { type: "text", text } }] });

  server.registerPrompt("numap", {
    title:       "Use NU Map",
    description: "Bring NU Map into the conversation — the full Northeastern catalog, instructors, offering history, programs and degree audits, and (once connected) your own plan",
    argsSchema:  { request: z.string().optional().describe("What you want, in your own words — e.g. 'review my plan', 'what can I take in the fall?', 'courses about robotics', 'who teaches CS 3000?'") },
  }, ({ request }) => promptText(
    (request
      ? `Use NU Map to help with this: ${request}\n\n`
      : "I want to work with NU Map. Briefly check what's available (is my plan connected, or catalog only?), tell me in a few lines what you can help with, and ask what I'd like to do.\n\n") +
    "Note: NU Map's full toolkit is available here — searching the catalog by topic, level, schedule, NUPath, instructor, or eligibility; course details with offering history, seat statistics, and who typically teaches each semester; program requirements and degree audits; and, when my plan is connected, reading it, checking prerequisites against it, and proposing changes I approve in the app. Pick whichever tools fit; don't limit yourself to what I mentioned."
  ));

  // ── Resources ───────────────────────────────────────────────────

  server.resource(
    "plan", "numap://plan",
    { description: "Current NU Map plan state — placements, programs, work experience, violations, and more" },
    async (uri) => ({
      contents: [{
        uri: uri.href, mimeType: "application/json",
        text: JSON.stringify(
          state.getConsent(sessionId).enabled ? state.getPlan(sessionId) : DISABLED,
          null, 2
        ),
      }],
    })
  );

  server.resource(
    "meta", "numap://meta",
    { description: "Data freshness, sources, and server capabilities" },
    async (uri) => ({
      contents: [{
        uri: uri.href, mimeType: "application/json",
        text: JSON.stringify(buildMeta(), null, 2),
      }],
    })
  );

  function buildMeta() {
    return {
      data: query.meta,
      sources: query.getSources(),
      capabilities: {
        syncPayloadVersion: SYNC_PAYLOAD_VERSION,
        actions:     SUPPORTED_ACTIONS,
        actionDocs:  ACTION_DOCS,
        uiCommands:  SUPPORTED_UI_COMMANDS,
        courseInclude: COURSE_INCLUDE,
        planInclude:   PLAN_INCLUDE,
      },
      session: {
        browserConnected: channel.clientCount(sessionId) > 0,
        consent: state.getConsent(sessionId),
      },
    };
  }

  // ── Pairing ─────────────────────────────────────────────────────

  server.tool(
    "request_pairing",
    "Link this conversation to the user's NU Map plan. Returns a 6-character code — show it to the user and ask them to enter it in NU Map (Claude button → enter code → Connect). Plan tools stay locked until they do. Codes expire after 10 minutes. Only call this when the user wants plan access and a plan tool was denied as not paired — never proactively; catalog tools work without pairing.",
    {},
    async () => {
      if (state.getConsent(sessionId).paired) {
        return respond({ status: "already_paired" });
      }
      const { code, expiresInMinutes } = state.createPairingCode(sessionId);
      return respond({
        status: "pending_user_confirmation",
        code,
        expiresInMinutes,
        instructions: "Show the user this code and ask them to open NU Map, click the Claude button in the header, enter the code, and press Connect. Then retry the plan tool.",
      });
    }
  );

  // ── Catalog tools (public data — never consent-gated) ───────────

  server.tool(
    "search_courses",
    "Search the course catalog. Returns compact records; use get_course for full detail. All filters combine (AND); anyOf is OR across its terms. For broad surveys ('all upper-level MATH', 'anything about sustainability') combine filters with limit up to 200, then get_course on the shortlist.",
    {
      query:      z.string().optional().describe("Free-text search across code, title, description (single term)"),
      anyOf:      z.array(z.string()).optional()
        .describe("OR search: match courses containing ANY of these terms — use synonym fan-out for concept searches, e.g. ['building','construction','architecture']. Overrides query."),
      subject:    z.string().optional().describe("Subject code, e.g. 'CS'"),
      minNumber:  z.number().int().optional().describe("Minimum course number, e.g. 3000 for upper-level"),
      maxNumber:  z.number().int().optional().describe("Maximum course number"),
      noPrereqs:  z.boolean().optional().describe("Only courses with no prerequisites"),
      unlockedBy: z.string().optional().describe("Courses whose prerequisites reference this course id — 'what does CS2000 unlock'"),
      prereqsMetBy: z.array(z.string()).optional()
        .describe("Completed course ids — keep only courses whose full prerequisite tree these satisfy. Pass the plan's completed + placed-out ids to answer 'what is the user eligible to take'."),
      scheduleType: z.string().optional().describe("Schedule type substring: 'Lecture', 'Lab', 'Seminar', 'Studio', 'Recitation'"),
      instructor: z.string().optional()
        .describe("Instructor name substring (case/accent-insensitive) — courses this person has taught as primary instructor in the last 3 years. Combine with term ('fall') for 'what do they teach in the fall'. Results gain instructorMatch: {name: {share: {semesterType: avg % of enrolment}, taught: ['Spring 2026', …]}} — `taught` is the actual term list, the evidence for predicting when they'll teach it again. Historical record, not future staffing."),
      includeInstructors: z.boolean().optional()
        .describe("Attach each result's per-semester-type instructor shares ({semType: [[name, avg %], …]}). Use when the question involves who teaches; leave off for broad surveys to keep results compact."),
      excludeIds: z.array(z.string()).optional().describe("Course ids to leave out (e.g. already placed or already suggested)"),
      sortBy:     z.enum(["relevance", "number", "enrollment"]).optional()
        .describe("'enrollment' = most-taken first (recent enrolment) — good for 'popular electives'; default is relevance/catalog order"),
      attributes: z.array(z.string()).optional().describe("NUPath codes that must ALL be present, e.g. ['ND','FQ']"),
      level:      z.enum(["undergrad", "grad"]).optional().describe("Course level (grad = 5000+)"),
      college:    z.string().optional().describe("Banner college code, e.g. 'CS' — see subject-colleges"),
      campus:     z.string().optional().describe("Campus substring, e.g. 'Boston', 'Oakland', 'Online'"),
      format:     z.string().optional().describe("Instructional format substring, e.g. 'Online', 'Traditional'"),
      meetsOn:    z.array(z.string()).optional()
        .describe("Day letters (M,T,W,R,F) — keep courses whose dominant meeting pattern fits these days (async always fits)"),
      term:       z.string().optional().describe("Semester type id: 'fall', 'spring', 'sumA', 'sumB'"),
      minSH:      z.number().optional(),
      maxSH:      z.number().optional(),
      limit:      z.number().int().min(1).max(200).optional().describe("Max results (default 20)"),
    },
    async (args) => respond(
      query.searchCourses(args),
      args.instructor || args.includeInstructors ? HISTORICAL_NOTE : undefined
    )
  );

  server.tool(
    "get_course",
    "Full course record(s) by id. Facets via include: 'offerings' (per-term enrolment/capacity/fill/open-seats, per-semester-type offering probability honoring the user's overrides, and primary instructors per completed term — historical record, not a promise of future staffing), 'patterns' (weekday distribution, enrolment-weighted meeting patterns, formats, campuses, per-term detail), 'relationships' (what this course unlocks; coreq partners), 'links' (official catalog URL).",
    {
      ids:     z.array(z.string()).min(1).max(10).describe("Course ids, e.g. ['CS3650']"),
      include: z.array(z.enum(COURSE_INCLUDE)).optional().describe("Facets to attach"),
    },
    async ({ ids, include = [] }) => {
      const plan = state.getConsent(sessionId).enabled ? state.getPlan(sessionId) : null;
      return respond(
        Object.fromEntries(ids.map(id => [id, query.getCourse(id, include, plan)])),
        include.includes("offerings") || include.includes("patterns") ? HISTORICAL_NOTE : undefined
      );
    }
  );

  server.tool(
    "get_offered_in",
    "Complete offering history for a course, newest-first: offered true/false per scraped term, with seat stats (enrolled, capacity, sections, fill %, open seats per section) and primary instructors [name, enrolled] for completed terms. LIMITATION: scheduled-scrape data, NOT live registration — seat counts reflect the last scrape (see get_meta freshness), and future terms are inferred from history, never guaranteed.",
    { courseId: z.string() },
    async ({ courseId }) => respond(query.getOfferedIn(courseId), HISTORICAL_NOTE)
  );

  // ── Program tools (public data) ─────────────────────────────────

  server.tool(
    "list_programs",
    "List programs: undergrad + graduate, majors + minors. Records include verified flag, total credits required, concentration count, and newer-catalog-year signal. Use the id with get_program / audit_requirements.",
    {
      type:    z.enum(["major", "minor", "all"]).optional(),
      level:   z.enum(["undergrad", "grad", "all"]).optional(),
      college: z.string().optional().describe("College slug, e.g. 'computer-information-science'"),
      year:    z.number().int().optional().describe("Catalog year, e.g. 2026"),
      query:   z.string().optional().describe("Label substring, case-insensitive"),
      campus:  z.string().optional().describe("Campus substring for campus-specific variants, e.g. 'boston', 'oakland'"),
    },
    async (args) => respond(query.listPrograms(args))
  );

  server.tool(
    "get_program",
    "One program with its full requirement tree and concentration options. Stale ids resolve to the newest catalog year automatically.",
    {
      programId: z.string().describe("Program id from list_programs, e.g. '2026/computer-information-science/computer_science_bscs_(boston)'"),
      include:   z.array(z.enum(["tree", "concentrations"])).optional(),
    },
    async ({ programId, include }) => {
      const program = query.getProgram(programId, include ?? ["tree", "concentrations"]);
      return respond(program ?? { error: `Program not found: ${programId}. Call list_programs for valid ids.` });
    }
  );

  server.tool(
    "audit_requirements",
    "Audit a plan against a program's requirements: full tree annotated with satisfaction, credits done/needed, and per-course status completed/planned/missing. Applies substitutions, the one-course-used-once rule, General Electives, and the selected concentration. Defaults: the live plan and its selected major/concentration. Programs without the verified flag (see list_programs) may have scraping imperfections — present those audits as a best-effort guide, and remind the user their academic advisor is the authority on degree progress.",
    {
      programId:     z.string().optional().describe("Program id — omit to audit the live plan's major"),
      concentration: z.string().optional().describe("Concentration title — omit to use the plan's selection"),
      plan:          z.any().optional().describe("PlanContext snapshot — omit to use the live synced plan"),
    },
    async ({ programId, concentration, plan: planArg }) => {
      let plan = planArg;
      if (!plan) {
        const live = livePlan();
        if (live.deny) return respond(live.deny);
        plan = live.plan;
      }
      const target = programId ?? plan.major;
      if (!target) return respond({ error: "No programId given and the plan has no major selected." });
      return respond(query.auditRequirements(target, plan, { concentration }));
    }
  );

  // ── Plan tools (consent-gated) ──────────────────────────────────

  server.tool(
    "get_plan",
    "The live plan snapshot: cohort (incl. studentType), program selections with resolved labels, placements, work experience, overrides, scratch pad, starred courses, totals, violation counts. Facets via include: 'schedule' (per-semester view exactly as rendered, with credit-load flags and co-op blocks), 'semesters' (every valid semester id with status and capacity), 'violations' (per-course prereq/coreq detail), 'nupath' (coverage grid), 'changes' (recent user edits).",
    { include: z.array(z.enum(PLAN_INCLUDE)).optional() },
    async ({ include = [] } = {}) => {
      const live = livePlan();
      if (live.deny) return respond(live.deny);
      const plan = live.plan;

      const out = withLabels(plan);
      if (include.includes("semesters"))  out._semesters  = query.getSemesters(plan);
      if (include.includes("schedule"))   out._schedule   = query.getSchedule(plan);
      if (include.includes("violations")) out._violations = query.validateChangeset([], plan).violations;
      if (include.includes("nupath"))     out._nupath     = query.getNUPathCoverage(plan);
      if (include.includes("changes"))    out._changes    = state.getChanges(sessionId);
      if (include.includes("proposals"))  out._proposals  = state.listProposals(sessionId);
      return respond(out);
    }
  );

  server.tool(
    "list_plans",
    "All saved plans (id, name, studentType, active flag). Use get_plan_contents to read a non-active plan without switching the user's screen; use SWITCH_PLAN to actually switch.",
    {},
    async () => {
      const live = livePlan();
      if (live.deny) return respond(live.deny);
      const plan = live.plan;
      return respond(plan.allPlans ?? [{ id: plan.planId, name: plan.planName, active: true }]);
    }
  );

  server.tool(
    "get_plan_contents",
    "Read the contents of a saved (non-active) plan by id, fetched live from the browser. Does not change which plan is active on the user's screen. Requires an open NU Map tab and may time out if the browser doesn't respond — on timeout, ask the user to check the tab is open rather than retrying repeatedly.",
    { planId: z.string().describe("Plan id from list_plans") },
    async ({ planId }) => {
      const live = livePlan();
      if (live.deny) return respond(live.deny);
      if (channel.clientCount(sessionId) === 0)
        return respond({ error: "No NU Map browser tab is connected." });

      const { requestId, promise } = state.createPlanRequest(sessionId);
      channel.broadcast(sessionId, { type: "REQUEST_PLAN", requestId, planId });
      const contents = await promise;
      return respond(contents ?? { error: `Browser did not return plan ${planId} (timeout). It may not exist.` });
    }
  );

  server.tool(
    "get_nupath_coverage",
    "NUPath attribute coverage for a plan: each grid code with satisfied flag and the courses (or co-op terms) satisfying it. Undergrad only — graduate programs have no NUPath requirements.",
    { plan: z.any().optional().describe("PlanContext snapshot — omit to use the live plan") },
    async ({ plan: planArg } = {}) => {
      let plan = planArg;
      if (!plan) {
        const live = livePlan();
        if (live.deny) return respond(live.deny);
        plan = live.plan;
      }
      return respond(query.getNUPathCoverage(plan));
    }
  );

  server.tool(
    "check_prereqs",
    "Check whether a course's prerequisites are satisfied. Omit completedIds to use the live plan's completed courses (incoming credit + semesters before the current one + placed-out).",
    {
      courseId:     z.string().describe("Course to check, e.g. 'CS3650'"),
      completedIds: z.array(z.string()).optional()
        .describe("Explicit completed course ids — omit to derive from the live plan"),
    },
    async ({ courseId, completedIds }) => {
      let plan = null;
      if (!completedIds) {
        const live = livePlan();
        if (live.deny) return respond(live.deny);
        plan = live.plan;
      }
      return respond(query.checkPrereqs(courseId, completedIds ?? null, plan));
    }
  );

  // ── Write tools (consent-gated) ─────────────────────────────────

  server.tool(
    "validate_changeset",
    "Dry-run a sequence of actions against the plan: returns the resulting plan, violations, unsupported action types, and invalid actions with reasons — without touching real state. ALWAYS use this before propose_changes or apply_changes; compose actions from get_meta capabilities.actionDocs (exact argument shapes and when to use each).",
    {
      actions: z.array(ActionSchema).describe("Actions to apply in order"),
      plan:    z.any().optional().describe("Starting plan — omit to use the live plan"),
    },
    async ({ actions, plan: planArg }) => {
      let plan = planArg;
      if (!plan) {
        const live = livePlan();
        if (live.deny) return respond(live.deny);
        plan = live.plan;
      }
      return respond(query.validateChangeset(actions, plan));
    }
  );

  server.tool(
    "propose_changes",
    "The standard way to change a plan: queue a changeset for the user to review in the NU Map UI. The user sees the rationale, each action, and a live preview, then approves or rejects — nothing is modified without their approval. Their decision appears in the _plan envelope of your next tool call (and in get_plan include:'proposals'). EXCEPTION: when the _plan envelope shows autoApplyEnabled: true, the user has opted into direct edits — use apply_changes instead for clearly-intended changes. Compose actions from get_meta capabilities.actionDocs (exact shapes + restrictions) and pre-flight with validate_changeset: one invalid action rejects the whole changeset.",
    ChangesetArgs,
    async ({ actions, rationale, label, confirmDestructive }) => {
      const rejection = guardChangeset(actions, confirmDestructive);
      if (rejection) return respond(rejection);

      // Dry-run at propose time: the violations delta and any unsupported
      // actions ride along with the proposal so the review card can show
      // consequences without re-computing.
      const plan = state.getPlan(sessionId);
      let meta = {};
      if (plan) {
        const before = query.validateChangeset([], plan).violations.length;
        const v      = query.validateChangeset(actions, plan);
        meta = {
          violationsBefore: before,
          violationsAfter:  v.violations.length,
          ...(v.unsupported.length && { unsupported: v.unsupported }),
        };
      }

      const changeset  = { actions, rationale, label, confirmDestructive };
      const proposalId = state.addProposal(sessionId, changeset, meta);
      channel.broadcast(sessionId, { type: "PROPOSAL", proposalId, changeset, meta });
      return respond({
        status: "queued",
        proposalId,
        ...meta,
        note: "The user's approve/reject decision will appear in the _plan envelope of your next tool call.",
      });
    }
  );

  server.tool(
    "apply_changes",
    "Apply a changeset immediately WITHOUT per-change review — only works when the user has enabled auto-apply in NU Map settings (check for autoApplyEnabled: true in the _plan envelope; rejected otherwise). When auto-apply is on, use this for clearly-intended changes instead of propose_changes. Applies as one undo entry; server state updates optimistically. Compose actions from get_meta capabilities.actionDocs and pre-flight with validate_changeset: one invalid action rejects the whole changeset.",
    ChangesetArgs,
    async ({ actions, rationale, label, confirmDestructive }) => {
      const rejection = guardChangeset(actions, confirmDestructive, { needsAutoApply: true });
      if (rejection) return respond(rejection);

      const plan = state.getPlan(sessionId);
      let result = { appliedCount: actions.length, unsupported: [], violations: [] };
      if (plan) {
        const v = query.validateChangeset(actions, plan);
        result = { appliedCount: v.appliedCount, unsupported: v.unsupported, violations: v.violations };
        // Optimistic update: the browser's confirming re-sync (~0.5 s)
        // reconciles this snapshot; until then reads see the applied state.
        state.setPlan(sessionId, v.resultingPlan, "claude");
      }

      channel.broadcast(sessionId, { type: "APPLY", changeset: { actions, rationale, label, confirmDestructive } });
      return respond({
        status: result.unsupported.length === actions.length ? "rejected"
              : result.unsupported.length > 0 ? "partial" : "applied",
        ...result,
      });
    }
  );

  server.tool(
    "ui_command",
    `Fire an immediate UI-only action in the open NU Map tab (no plan change, no undo entry). Supported: ${SUPPORTED_UI_COMMANDS.join(", ")}. FOCUS_COURSE {courseId}, OPEN_SEARCH {query}, SET_BANK_TAB {tab: all|placed|starred}, EXPORT_PDF, EXPORT_JSON, COPY_SHARE_LINK. This moves things on the user's screen — use it only in direct response to what the user is doing (e.g. highlight the course you're discussing), never to make plan changes and never unprompted.`,
    { command: z.object({ type: z.string() }).passthrough() },
    async ({ command }) => {
      if (!state.getConsent(sessionId).enabled) return respond(DISABLED);
      if (channel.clientCount(sessionId) === 0) {
        return respond({ ok: false, reason: "No NU Map browser tab is connected. Open NU Map and ensure the MCP integration is active." });
      }
      channel.broadcast(sessionId, { type: "COMMAND", command });
      return respond({ ok: true });
    }
  );

  // ── Meta ────────────────────────────────────────────────────────

  server.tool(
    "get_meta",
    "Data freshness (per-file scrape timestamps, recent scrape runs), data sources, and server capabilities (supported actions, ui commands, include facets, payload version). Check capabilities instead of assuming.",
    {},
    async () => respond(buildMeta())
  );

  // Attach annotations post-registration. Reads the SDK's registered-tool
  // records directly (the 5-arg tool() overload would mean rewriting every
  // registration); test/unit.test.mjs verifies the annotations actually
  // surface through tools/list, so an SDK internals change fails loudly.
  for (const [name, annotations] of Object.entries(TOOL_ANNOTATIONS)) {
    const reg = server._registeredTools?.[name];
    if (reg) reg.annotations = annotations;
  }

  return server;
}
