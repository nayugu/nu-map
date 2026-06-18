// McpServer factory — registers all 13 NU Map tools and the numap://plan resource.
// Import once; call createServer() per MCP request (stateless HTTP transport).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as planState from "./planState.js";
import { applyChangeset } from "./actions.js";
import { broadcast, clientCount } from "./events.js";
import {
  buildPlacedKeySet,
  allocateMajorWithElectives,
} from "../../src/core/gradRequirements.js";
import { evalPrereqTree } from "../../src/core/prereqEval.js";
import attributeSystem from "../../src/adapters/northeastern/attributeSystem.js";
import { normalizeProgramId } from "./data.js";

const NUPATH_CODES  = attributeSystem.getGridCodes();
const NUPATH_LABELS = Object.fromEntries(
  attributeSystem.getAttributes().map(a => [a.code, a.label])
);

// Zod schema for an arbitrary action object (type + any extra fields)
const ActionSchema = z.object({ type: z.string() }).passthrough();
// Shared changeset args
const ChangesetArgs = {
  actions:            z.array(ActionSchema),
  rationale:          z.string().optional().describe("Why — shown to the user in the review UI"),
  label:              z.string().optional().describe("Short headline, e.g. 'Restructure Fall 2025'"),
  confirmDestructive: z.boolean().optional()
    .describe("Must be true when the changeset includes a DELETE_PLAN action"),
};

/**
 * Create a new McpServer instance wired to the shared data + plan state.
 * @param {{ data: Awaited<ReturnType<import('./data.js').loadData>>, sessionId: string }} opts
 */
export function createServer({ data, sessionId }) {
  const server = new McpServer({
    name:        "NU Map",
    version:     "1.0.0",
    description: "Read and modify a Northeastern University course plan in NU Map",
  });

  // ── Resource: live plan ─────────────────────────────────────────
  server.resource(
    "plan",
    "numap://plan",
    { description: "Current NU Map plan state — placements, programs, work experience, violations, and more" },
    async (uri) => ({
      contents: [{
        uri:      uri.href,
        mimeType: "application/json",
        text:     JSON.stringify(planState.getPlan(sessionId) ?? null, null, 2),
      }],
    })
  );

  // ── Tool: search_courses ────────────────────────────────────────
  server.tool(
    "search_courses",
    "Search the course catalog. Returns up to `limit` courses matching all supplied filters.",
    {
      query:      z.string().optional()
        .describe("Free-text search across course code, title, and description (case-insensitive)"),
      subject:    z.string().optional()
        .describe("Subject code, e.g. 'CS', 'MATH'"),
      attributes: z.array(z.string()).optional()
        .describe("NUPath codes that must ALL be present, e.g. ['ND', 'FQ']"),
      minSH:      z.number().optional().describe("Minimum credit hours (inclusive)"),
      maxSH:      z.number().optional().describe("Maximum credit hours (inclusive)"),
      term:       z.string().optional()
        .describe("Semester type id: 'fall', 'spring', 'sumA', 'sumB'"),
      limit:      z.number().int().min(1).max(200).optional()
        .describe("Max results to return (default 20)"),
    },
    async (args) => {
      const courses = data.searchCourses(args);
      return { content: [{ type: "text", text: JSON.stringify(courses) }] };
    }
  );

  // ── Tool: get_course ────────────────────────────────────────────
  server.tool(
    "get_course",
    "Look up one course by its stable id (e.g. 'CS3500'). Returns the full catalog record or null.",
    { courseId: z.string().describe("Course id with no spaces, e.g. 'CS3500'") },
    async ({ courseId }) => {
      const id     = courseId.toUpperCase().replace(/\s+/g, "");
      const course = data.courseMap[id] ?? null;
      return { content: [{ type: "text", text: JSON.stringify(course) }] };
    }
  );

  // ── Tool: get_offered_in ────────────────────────────────────────
  server.tool(
    "get_offered_in",
    "Return the complete 'OFFERED IN' history for a course — every scraped semester with offered=true/false, newest-first. Covers confirmed-absent terms too (offered: false), so you can spot patterns.",
    { courseId: z.string() },
    async ({ courseId }) => {
      const id      = courseId.toUpperCase().replace(/\s+/g, "");
      const history = data.getOfferedIn(id);
      return { content: [{ type: "text", text: JSON.stringify(history) }] };
    }
  );

  // ── Tool: list_programs ─────────────────────────────────────────
  server.tool(
    "list_programs",
    "List all available majors and minors. Use the returned `id` with audit_requirements.",
    {
      type:  z.enum(["major", "minor", "all"]).optional()
        .describe("Filter by program type (default: all)"),
      query: z.string().optional()
        .describe("Filter by label substring, case-insensitive"),
    },
    async ({ type = "all", query } = {}) => {
      let programs = data.programs;
      if (type !== "all") programs = programs.filter(p => p.type === type);
      if (query) {
        const q = query.toLowerCase();
        programs = programs.filter(p => p.label.toLowerCase().includes(q));
      }
      return { content: [{ type: "text", text: JSON.stringify(programs) }] };
    }
  );

  // ── Tool: audit_requirements ────────────────────────────────────
  server.tool(
    "audit_requirements",
    "Audit a plan against a program's requirements. Returns the full requirement tree annotated with satisfaction status, credits done/needed at each node, and which courses fulfill each requirement.",
    {
      programId: z.string().describe("Program id from list_programs, e.g. '2026/khoury/computer_science_bs_(boston)'"),
      plan:      z.any().optional()
        .describe("PlanContext snapshot to audit — omit to use the live synced plan"),
    },
    async ({ programId, plan: planArg }) => {
      const plan = planArg ?? planState.getPlan(sessionId);
      if (!plan) {
        return noplan();
      }

      const majorJson = data.majorData.get(normalizeProgramId(programId));
      if (!majorJson) {
        return { content: [{ type: "text", text: JSON.stringify({
          error: `Program not found: ${programId}. Call list_programs to get valid ids.`,
        }) }] };
      }

      // Apply substitutions: placing fromId also satisfies toId requirements
      const { placements = {}, placedOut = [], substitutions = [] } = plan;
      const effectivePlacements = { ...placements };
      for (const { from, to } of substitutions) {
        if (effectivePlacements[from] && !effectivePlacements[to]) {
          effectivePlacements[to] = effectivePlacements[from];
        }
      }

      // placedSet includes virtual substitution targets (for requirement satisfaction).
      // realPlacedSet excludes them so GE only lists courses the student actually placed.
      const placedOut_ = new Set(placedOut);
      const placedSet     = buildPlacedKeySet(effectivePlacements, placedOut_, data.courseMap);
      const realPlacedSet = buildPlacedKeySet(placements,          placedOut_, data.courseMap);
      const result = allocateMajorWithElectives(majorJson, placedSet, data.courseMap, null, realPlacedSet);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  // ── Tool: get_plan ──────────────────────────────────────────────
  server.tool(
    "get_plan",
    "Return the complete live plan snapshot — placements, work experience, programs, offered overrides, violation counts, NUPath summary, and more.",
    {},
    async () => {
      const plan = planState.getPlan(sessionId);
      if (!plan) return noplan();
      return { content: [{ type: "text", text: JSON.stringify(plan) }] };
    }
  );

  // ── Tool: list_plans ────────────────────────────────────────────
  server.tool(
    "list_plans",
    "List all saved plans (id, name, active flag). Use SWITCH_PLAN in apply_changes to change the active plan.",
    {},
    async () => {
      const plan = planState.getPlan(sessionId);
      if (!plan) return { content: [{ type: "text", text: "[]" }] };
      // allPlans is an optional field the browser can include in sync
      const list = plan.allPlans ?? [{ id: plan.planId, name: plan.planName, active: true }];
      return { content: [{ type: "text", text: JSON.stringify(list) }] };
    }
  );

  // ── Tool: get_nupath_coverage ───────────────────────────────────
  server.tool(
    "get_nupath_coverage",
    "Return NUPath attribute coverage for a plan — which codes are satisfied, which courses satisfy each one, and which are still missing.",
    {
      plan: z.any().optional()
        .describe("PlanContext snapshot — omit to use the live plan"),
    },
    async ({ plan: planArg } = {}) => {
      const plan = planArg ?? planState.getPlan(sessionId);
      if (!plan) return noplan();

      const { placements = {}, workExperience = {} } = plan;

      // Co-ops grant Integration Experience (EX)
      const grantedAttrs = new Set();
      for (const wt of Object.values(workExperience)) {
        if (wt.typeId === "coop") grantedAttrs.add("EX");
      }

      const covered = attributeSystem.getCoverage(placements, data.courseMap, grantedAttrs);

      const coverage = NUPATH_CODES.map(code => ({
        code,
        label:       NUPATH_LABELS[code] ?? code,
        satisfied:   covered.has(code),
        satisfiedBy: [
          ...Object.entries(placements)
            .filter(([id]) => (data.courseMap[id]?.attributes ?? []).includes(code))
            .map(([id]) => id),
          // Add work-term instance ids if the attribute is co-op-granted
          ...(grantedAttrs.has(code)
            ? Object.entries(workExperience)
                .filter(([, wt]) => wt.typeId === "coop")
                .map(([id]) => id)
            : []),
        ],
      }));

      return { content: [{ type: "text", text: JSON.stringify(coverage) }] };
    }
  );

  // ── Tool: check_prereqs ─────────────────────────────────────────
  server.tool(
    "check_prereqs",
    "Check whether a course's prerequisites are satisfied given a list of completed course ids (placed, placed-out, or incoming). Returns satisfied, missing, and concurrent-eligible prereqs.",
    {
      courseId:     z.string().describe("Course to check, e.g. 'CS3500'"),
      completedIds: z.array(z.string())
        .describe("Course ids the student has already completed"),
    },
    async ({ courseId, completedIds }) => {
      const id     = courseId.toUpperCase().replace(/\s+/g, "");
      const course = data.courseMap[id];
      if (!course) {
        return { content: [{ type: "text", text: JSON.stringify({
          satisfied: false, missing: [], concurrent: [],
          error: `Course not found: ${id}`,
        }) }] };
      }

      if (!course.prereqs?.length) {
        return { content: [{ type: "text", text: JSON.stringify({
          satisfied: true, missing: [], concurrent: [],
        }) }] };
      }

      // Build fake placement map: completed courses at sem0, target at sem1
      const fakePlacements = {};
      for (const cid of completedIds) {
        fakePlacements[cid.toUpperCase().replace(/\s+/g, "")] = "s0";
      }
      fakePlacements[id] = "s1";
      const fakeSemIndex = { s0: 0, s1: 1 };

      const result = evalPrereqTree(course.prereqs, fakePlacements, fakeSemIndex, 1);

      const missing    = [];
      const concurrent = [];
      if (result !== "satisfied") {
        function collectMissing(tree) {
          if (!tree) return;
          for (const tok of tree) {
            if (Array.isArray(tok)) { collectMissing(tok); continue; }
            if (tok?.subject && tok?.number) {
              const cid = `${tok.subject.toUpperCase()}${tok.number}`;
              if (!fakePlacements[cid]) {
                if (tok.concurrent) concurrent.push(cid);
                else missing.push(cid);
              }
            }
          }
        }
        collectMissing(course.prereqs);
      }

      return { content: [{ type: "text", text: JSON.stringify({
        satisfied: result === "satisfied",
        missing:   [...new Set(missing)],
        concurrent: [...new Set(concurrent)],
      }) }] };
    }
  );

  // ── Tool: validate_changeset ────────────────────────────────────
  server.tool(
    "validate_changeset",
    "Dry-run a sequence of actions against the plan — returns the resulting plan state and any violations without touching real plan state. Use this before propose_changes or apply_changes to catch problems early.",
    {
      actions: z.array(ActionSchema).describe("Actions to apply in order"),
      plan:    z.any().optional()
        .describe("Starting plan — omit to use the live plan"),
    },
    async ({ actions, plan: planArg }) => {
      const plan = planArg ?? planState.getPlan(sessionId);
      if (!plan) return noplan();

      const { plan: resultingPlan, appliedCount, violations, error } =
        applyChangeset(plan, actions, data.courseMap);

      return { content: [{ type: "text", text: JSON.stringify({
        valid:        !error && violations.length === 0,
        violations,
        resultingPlan,
        appliedCount,
        totalCount:   actions.length,
        ...(error && { error }),
      }) }] };
    }
  );

  // ── Tool: propose_changes ───────────────────────────────────────
  server.tool(
    "propose_changes",
    "Queue a changeset for the user to review in the NU Map UI. The user sees the rationale and each action individually, and can approve or reject before anything changes. Use for substantive plan restructuring.",
    ChangesetArgs,
    async ({ actions, rationale, label, confirmDestructive }) => {
      const rejection = guardChangeset(actions, confirmDestructive);
      if (rejection) return rejection;

      const changeset  = { actions, rationale, label, confirmDestructive };
      const proposalId = planState.addProposal(sessionId, changeset);
      broadcast(sessionId, { type: "PROPOSAL", proposalId, changeset });

      return { content: [{ type: "text", text: JSON.stringify({
        status: "queued",
        proposalId,
      }) }] };
    }
  );

  // ── Tool: apply_changes ─────────────────────────────────────────
  server.tool(
    "apply_changes",
    "Apply a changeset immediately to the plan — exactly as if the user made each change by hand. The entire batch is one undo entry (Ctrl+Z reverses all). Use for unambiguous, clearly-intended actions.",
    ChangesetArgs,
    async ({ actions, rationale, label, confirmDestructive }) => {
      const rejection = guardChangeset(actions, confirmDestructive);
      if (rejection) return rejection;

      const plan = planState.getPlan(sessionId);
      const { appliedCount, violations, error } = plan
        ? applyChangeset(plan, actions, data.courseMap)
        : { appliedCount: actions.length, violations: [], error: null };

      broadcast(sessionId, { type: "APPLY", changeset: { actions, rationale, label, confirmDestructive } });

      return { content: [{ type: "text", text: JSON.stringify({
        status:       error ? "rejected" : violations.length > 0 ? "partial" : "applied",
        appliedCount,
        totalCount:   actions.length,
        violations,
        ...(error && { reason: error }),
      }) }] };
    }
  );

  // ── Tool: ui_command ────────────────────────────────────────────
  server.tool(
    "ui_command",
    "Fire an immediate UI-only action in NU Map: highlight a course, open the search bar, or switch the course bank tab. No plan data changes, no undo entry.",
    {
      command: z.object({ type: z.string() }).passthrough().describe(
        "UI command. type must be one of: FOCUS_COURSE (courseId: string|null), " +
        "OPEN_SEARCH (query: string), SET_BANK_TAB (tab: 'all'|'placed'|'starred')"
      ),
    },
    async ({ command }) => {
      if (clientCount(sessionId) === 0) {
        return { content: [{ type: "text", text: JSON.stringify({
          ok:     false,
          reason: "No NU Map browser tab is connected. Open NU Map and ensure the MCP integration is active.",
        }) }] };
      }
      broadcast(sessionId, { type: "COMMAND", command });
      return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
    }
  );

  return server;
}

// ── Shared helpers ────────────────────────────────────────────────

function noplan() {
  return { content: [{ type: "text", text: JSON.stringify({
    error: "No plan synced yet. Open NU Map — the plan syncs automatically on load.",
  }) }] };
}

function guardChangeset(actions, confirmDestructive) {
  if (actions.some(a => a.type === "DELETE_PLAN") && !confirmDestructive) {
    return { content: [{ type: "text", text: JSON.stringify({
      status: "rejected",
      reason: "DELETE_PLAN requires confirmDestructive: true on the changeset.",
    }) }] };
  }
  if (clientCount(sessionId) === 0) {
    return { content: [{ type: "text", text: JSON.stringify({
      status: "rejected",
      reason: "No NU Map browser tab is connected. Open NU Map and ensure the MCP integration is active.",
    }) }] };
  }
  return null;
}
