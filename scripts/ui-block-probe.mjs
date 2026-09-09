// ui-block-probe — how long is the MAIN THREAD blocked by a gesture?
//
//   node scripts/ui-block-probe.mjs
//
// Committed rather than thrown away, because it is the only instrument here that
// can answer "does this feel stuck", and it earned that in one sitting: three
// separate hypotheses about a reported freeze (React unmounting, stale program
// data, generation on a hidden section) were all wrong, and this settled it by
// measurement — 85.7 SECONDS of frozen main thread on a catalog-year change,
// which turned out to be `generatePlan`'s retry ladder running up to seventeen
// full generations, each starting a fresh 5,000 ms budget.
//
// ⚠ The trap that nearly hid it: an observation window shorter than the freeze
// reports ZERO stalls. Two of my measurements waited 6 seconds and printed a
// clean bill of health for an 85-second hang. Always wait on the CONDITION (here,
// CHART reporting ready/refused) rather than on a fixed sleep, and print what the
// condition ended as — the run that says `idle` is the run that proves nothing.
//
// A green Node suite says nothing about whether the app renders; this says
// nothing about whether it renders CORRECTLY, only about whether it responds.
import { ensureBuild, serveDist } from "../test/browser/helpers/serveDist.js";
import { chromium } from "playwright";

await ensureBuild();
const { server, port } = await serveDist();
const b = await chromium.launch();
const CS = (y) =>
  `../../data/northeastern/programs/undergraduate/${y}/computer-information-science/computer_science_bscs_(boston)/requirements.json`;

// A realistic plan: every named course the 2026 CS record requires, spread over
// eight semesters. An empty canvas is the cheapest possible audit and is not
// what a student changing their catalog year is holding.
import { readFileSync } from "node:fs";
function realPlacements() {
  const d = JSON.parse(readFileSync(
    new URL("../data/northeastern/programs/undergraduate/2026/computer-information-science/computer_science_bscs_(boston)/requirements.json", import.meta.url), "utf8"));
  const codes = new Set();
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.type === "COURSE" && n.subject && n.classId) codes.add(`${n.subject}${n.classId}`);
    for (const v of Object.values(n)) walk(v);
  };
  walk(d.requirementSections ?? []);
  const sems = ["fall2025","spring2026","fall2026","spring2027","fall2027","spring2028","fall2028","spring2029"];
  const out = {};
  [...codes].slice(0, 40).forEach((c, i) => { out[c] = sems[i % sems.length]; });
  return out;
}
const PLACEMENTS = realPlacements();
console.log(`seeding ${Object.keys(PLACEMENTS).length} placed courses\n`);

async function run(label, openSection) {
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
  await ctx.addInitScript(`(${((mj, ey, open, pl) => {
    const K = "ncp-";
    localStorage.setItem(K + "plan-index", JSON.stringify([
      { id: "default", name: "T", studentType: "undergrad", parentId: null, lastOpened: Date.now() }]));
    localStorage.setItem(K + "plan-data-default", JSON.stringify({
      version: 1, studentType: "undergrad", entSem: "fall", entYear: ey,
      gradSem: "spring", gradYear: ey + 4, currentSemId: "fall" + ey,
      major: mj, major2: "", minor1: "", placements: pl, specialTermPl: {},
      semOrders: {}, placedOut: [], substitutions: [] }));
    localStorage.setItem(K + "tour-seen", "true");
    localStorage.setItem("numap-grad-expand-sampleplan", String(open));
  }).toString()})(${JSON.stringify(CS(2026))},2025,${openSection},${JSON.stringify(PLACEMENTS)})`);

  const page = await ctx.newPage();
  page.on("pageerror", e => console.log("PAGEERROR:", String(e?.message ?? e)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load", timeout: 60_000 });
  const skip = page.getByRole("button", { name: /^Skip$/ }).first();
  const grad = page.getByRole("button", { name: /^Graduation$/ }).first();
  await grad.waitFor({ timeout: 60_000 });
  for (let i = 0; i < 40; i++) {
    if (await skip.isVisible().catch(() => false)) { await skip.click().catch(() => {}); continue; }
    if (await grad.click({ timeout: 500 }).then(() => 1).catch(() => 0)) break;
  }
  await page.locator('[data-claude-focus="major"] [data-edition-select]').first().waitFor({ timeout: 30_000 });
  await new Promise(r => setTimeout(r, 2000));   // let first paint settle

  await page.evaluate(() => {
    window.__g = []; let last = performance.now();
    setInterval(() => { const n = performance.now(); const d = n - last - 25; if (d > 50) window.__g.push(Math.round(d)); last = n; }, 25);
  });

  const t0 = Date.now();
  const sel = page.locator('[data-claude-focus="major"] [data-edition-select]').first();
  await sel.click();
  const row = page.locator('[role="listbox"] [role="option"]', { hasText: "2026-2027" }).first();
  await row.waitFor({ timeout: 15_000 });
  await row.click();
  // Wait for the audit to actually follow the edition.
  await page.locator("text=133 SH").first().waitFor({ timeout: 60_000 });
  const settled = Date.now() - t0;
  // Did generation actually still happen? A "fast" switch that silently stopped
  // generating is not a fix, and this is the assertion that separates them.
  let state = "never-appeared";
  for (let i = 0; i < 120; i++) {
    state = await page.evaluate(() =>
      document.querySelector('[data-testid="chart-status"]')?.getAttribute("data-state") ?? "no-element");
    if (state === "ready" || state === "refused") break;
    await new Promise(r => setTimeout(r, 250));
  }
  console.log(`   CHART finished as: ${state}`);
  await new Promise(r => setTimeout(r, 2000));
  const g = await page.evaluate(() => window.__g);
  const total = g.reduce((a, c) => a + c, 0);
  console.log(`${label}\n   time to new degree total: ${settled} ms`);
  console.log(`   blocking gaps >50ms: ${g.length}, longest ${Math.max(0, ...g)} ms, total blocked ${total} ms`);
  console.log(`   gaps: ${g.slice(0, 12).join(", ")}`);
  await ctx.close();
}

await run("catalog-year change, sample-plan section open", true);
await run("catalog-year change, section collapsed", false);
await b.close(); server.close(); process.exit(0);
