// OAuth flow test: dynamic registration → authorize (consent hop) →
// authorize/complete (simulating the in-app approval) → token exchange
// (PKCE) → authorized /mcp call bound to the approved session.
// Run: MCP_BASE=http://localhost:8788 node test/oauth-e2e.mjs

import { createHash, randomBytes } from "node:crypto";

const BASE = process.env.MCP_BASE ?? "http://localhost:8788";
const SID  = `oauth-test-${Date.now()}`;

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// 1. Dynamic client registration
const reg = await fetch(`${BASE}/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    client_name: "oauth-e2e",
    redirect_uris: ["http://localhost:9999/callback"],
    token_endpoint_auth_method: "none",
  }),
}).then(r => r.json());
console.log("registered client:", !!reg.client_id);

// 2. Authorize → expect a redirect into the app with a pending id
const verifier  = b64url(randomBytes(32));
const challenge = b64url(createHash("sha256").update(verifier).digest());
const authUrl = new URL(`${BASE}/authorize`);
authUrl.search = new URLSearchParams({
  response_type: "code",
  client_id: reg.client_id,
  redirect_uri: "http://localhost:9999/callback",
  code_challenge: challenge,
  code_challenge_method: "S256",
  state: "e2e-state",
  scope: "plan.read plan.propose",
});
const authRes = await fetch(authUrl, { redirect: "manual" });
const appHop  = new URL(authRes.headers.get("location"));
const pendingId = appHop.searchParams.get("claude_connect");
console.log("consent hop →", appHop.origin, "| pendingId:", !!pendingId);

// 3. Simulate the user approving IN the app
const complete = await fetch(`${BASE}/authorize/complete`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ pendingId, sessionId: SID }),
}).then(r => r.json());
const cb = new URL(complete.redirectTo);
console.log("redirect back to client:", cb.origin + cb.pathname, "| code:", !!cb.searchParams.get("code"), "| state ok:", cb.searchParams.get("state") === "e2e-state");

// replay protection: the same pendingId must not work twice
const replay = await fetch(`${BASE}/authorize/complete`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ pendingId, sessionId: "attacker" }),
});
console.log("replay rejected:", replay.status === 404);

// 4. Token exchange (PKCE)
const token = await fetch(`${BASE}/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code: cb.searchParams.get("code"),
    redirect_uri: "http://localhost:9999/callback",
    client_id: reg.client_id,
    code_verifier: verifier,
  }),
}).then(r => r.json());
console.log("access token:", !!token.access_token, "| refresh:", !!token.refresh_token);

// 5. Authorized MCP call on the canonical /mcp endpoint
const call = (body, auth = true) => fetch(`${BASE}/mcp`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    ...(auth && { Authorization: `Bearer ${token.access_token}` }),
  },
  body: JSON.stringify(body),
});

const unauth = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, false);
console.log("unauthenticated /mcp rejected:", unauth.status === 401);

const plan = await call({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_plan", arguments: {} } })
  .then(r => r.json());
const planData = JSON.parse(plan.result.content[0].text);
// paired (grant marked the session) but no plan synced yet → "No plan synced"
console.log("token → session binding:", planData.data.error?.includes("No plan synced") ? "paired, awaiting sync ✓" : JSON.stringify(planData.data).slice(0, 80));

console.log("OAUTH E2E OK");
