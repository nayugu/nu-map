# NU Map MCP Server

Gives Claude direct access to your Northeastern course plan — read data, check requirements, and propose or apply changes — all without leaving the chat.

## What Claude can do

| Category | Capability |
|---|---|
| **Course catalog** | Search courses, look up a course by id, check offered-in history |
| **Programs** | List majors/minors, audit a plan against any program's requirements |
| **Plan reads** | Get full plan state (placements, work experience, programs, credits, violations), list saved plans, get NUPath coverage |
| **Validation** | Check prereqs for any course, dry-run a changeset before applying |
| **Plan writes** | Propose changes for you to review, or apply changes immediately |
| **UI commands** | Highlight a course, open the search bar, switch the bank tab |

## Requirements

- Node.js 18 or newer
- NU Map project cloned locally (the MCP server reads from `public/northeastern/` and `data/northeastern/programs/majors/`)

## Setup

### 1. Install dependencies

```bash
cd mcp-server
npm install
```

### 2. Start the server

```bash
npm start
# or for auto-reload during development:
npm run dev
```

The server starts on **port 27182** by default. Set `PORT` to override.

```
NU Map MCP server listening on http://localhost:27182
  MCP endpoint:  http://localhost:27182/mcp
  WS → browser:  ws://localhost:27182/ws
  SSE → browser: http://localhost:27182/events (legacy)
  Plan sync:     POST http://localhost:27182/sync-plan
```

### 3. Connect Claude Code (CLI / VS Code extension)

Add to your `~/.claude/mcp_config.json` (or open Claude Code settings → MCP):

```json
{
  "mcpServers": {
    "nu-map": {
      "url": "http://localhost:27182/mcp"
    }
  }
}
```

Restart Claude Code. You should see **NU Map** appear in the tool list.

### 4. Connect Claude.ai (web)

> Available to users on Claude Pro / Teams / Enterprise.

1. Go to **claude.ai → Settings → Integrations → Add integration**
2. Enter `http://localhost:27182/mcp`
3. Click **Save**

If claude.ai can't reach localhost, use a tunnelling tool:

```bash
npx localtunnel --port 27182
# or
ngrok http 27182
```

Then use the tunnel URL instead of localhost.

### 5. Connect NU Map to the server (browser ↔ server sync)

The MCP server needs a live plan snapshot to answer plan-related questions and to push proposals/apply events to the browser. This is done by the **IAIAssistant** adapter in NU Map.

> The browser adapter (`src/adapters/northeastern/aiAssistant.js`) is a separate piece to implement — it POSTs the plan to `/sync-plan` on every meaningful change and listens on the `/ws` WebSocket for incoming proposals and apply events.

Until that adapter is wired up you can still use all **read-only** tools (`search_courses`, `get_course`, `get_offered_in`, `list_programs`, `check_prereqs`). Plan-dependent tools (`get_plan`, `audit_requirements`, `validate_changeset`, etc.) will return an error asking you to open NU Map.

## HTTP endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET/POST` | `/mcp` | MCP Streamable HTTP transport |
| `GET` | `/ws` | WebSocket — browser subscribes here (one JSON event per message; `ping`→`pong` keepalive) |
| `GET` | `/events` | SSE stream — legacy transport, same events in `data:` frames |
| `POST` | `/sync-plan` | Browser POSTs `PlanContext` JSON on every plan change |
| `POST` | `/confirm-proposal/:id` | Browser confirms (`{ accepted: true }`) or rejects a proposal |

## MCP tools reference

| Tool | Description |
|------|-------------|
| `search_courses` | Search catalog by query, subject, NUPath, credit range, or term |
| `get_course` | Full record for one course by id (e.g. `CS3500`) |
| `get_offered_in` | Complete offered-in history (true/false per scraped term) |
| `list_programs` | All majors and minors; filter by type or label |
| `audit_requirements` | Requirement tree for any program, annotated with satisfaction status |
| `get_plan` | Full live plan snapshot |
| `list_plans` | All saved plans with active flag |
| `get_nupath_coverage` | NUPath codes satisfied/missing, with satisfying course ids |
| `check_prereqs` | Check prereqs for a course given a completed-course list |
| `validate_changeset` | Dry-run actions and return resulting plan + violations |
| `propose_changes` | Queue a changeset for the user to review in the UI |
| `apply_changes` | Apply a changeset immediately (one undo entry) |
| `ui_command` | Fire `FOCUS_COURSE`, `OPEN_SEARCH`, or `SET_BANK_TAB` |

## MCP resource

| URI | Description |
|-----|-------------|
| `numap://plan` | Current plan state (JSON) — always reflects the latest `/sync-plan` POST |

## Port

Default: **27182** (`e` is the 5th prime — a small nod to NU).  
Override: `PORT=3000 npm start`
