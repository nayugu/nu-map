# Tests

One tree, four layers, one rule each. A failing job name should tell you *which
layer* broke before you read a single line of output.

```
test/
├── unit/         Pure logic. No network, clock, or filesystem. Milliseconds.
├── contract/     A transform vs a captured fixture — "does our parser still
│                 turn real input into the right shape?"
├── invariant/    Properties asserted over the committed data set (catalog,
│                 locales, action surface). Catches silent drift.
├── live/         Hits the real NEU catalog. NON-deterministic. Never in `npm test`.
├── fixtures/     Captured inputs for contract tests (banner/*.raw.json,
│                catalog/*.html — trimmed program pages, refresh with
│                scripts/capture-fixture.js).
└── helpers/      Shared loaders (paths.js). Dependency-free.
```

Every test is `node:test` (built into Node — no framework dependency). Test files
end in `.test.js`; name tests `subject › condition › expected`.

## Running

| Command | Runs | When |
|---|---|---|
| `npm test` | unit + contract + invariant | every change; **must stay deterministic & offline** |
| `npm run test:unit` / `:contract` / `:invariant` | one layer | while working in that layer |
| `npm run test:mcp` | the MCP server suite (`mcp-server/test`) | needs `npm install` in `mcp-server/` |
| `npm run test:live` | live scrape smoke tests | manually, or CI's scheduled job |
| `npm run test:all` | everything above | before a release / big data change |
| `npm run test:baseline:update` | regenerate invariant baselines | after an *intended* data change |

## The layers, concretely

**unit/** — the pure logic where a silent bug would mislead a student about
their degree or corrupt a saved plan:
- `prereq-eval` — the 3-valued verdict (satisfied/order/missing), precedence,
  the dangling-operator regression guard, and adversarial malformed trees.
- `substitutions` — `applySubstitutions` composed with prereq + grad checks:
  a substitute satisfies its target, wrong-order still fires, credits count
  once, removal reverts, one substitution fills at most one requirement.
- `grad-requirements` — every Major2 type (COURSE/AND/OR/XOM/RANGE/SECTION)
  and the allocation rule that a course counts once (shared cross-count,
  coreq absorption, general electives).
- `sem-grid` — the timeline structure + the co-op/summer `termSpans` spill rule.
- `plan-share` — the share-link codec round-trips every non-default field
  (empties are dropped by design), URL-safe, v1 passthrough.
- `scrape-catalog-merge` — rotate-mode catalog merge/diff logic mirrored from
  `scrape-catalog.js`.

> **Dependency note.** unit and invariant import only `src/` + Node builtins —
> CI enforces this by omitting the install step, and it is what lets
> `scripts/lib/major-verify.js` be a pure function the invariant suite can
> import. **contract is the one exception**: `major-parser.test.js` parses
> saved catalog HTML, which needs `node-html-parser`, so that job alone runs
> `npm ci`. Don't add an install to the other two.

**contract/** — `courseNorm.normalizeCourse` / `mergeHistoryAndOffering`, the one
transform the browser app, the Node MCP server, and the Cloudflare worker all
import. If its output shape drifts, all three break together, so it's pinned to a
captured raw record in `fixtures/banner/`.

**invariant/** — properties over `public/northeastern/catalog-courses.json`,
`src/locales/*`, and the MCP action surface:
- `locale-completeness` — no orphan keys; full coverage vs English (baselined);
  plus content rules (CLAUDE stays untranslated; summer terms are A/B, not 1/2).
- `catalog-prereq-resolution` — every prereq/coreq reference resolves (baselined).
- `mcp-actions` — `SUPPORTED_ACTIONS` ↔ `ACTION_DOCS` parity; action set locked.
- `major-integrity` — no new impossible-to-satisfy requirement sections.
- `engine-time-budget` — `timeBudgetMs` is a bound the engine honours: the injected
  clock is read by every generation that searches, and a clock past the deadline
  stops one. It also pins the deliberate converse — a **constant** clock disables
  the budget, which is why the determinism and neutrality suites freeze it and
  accept being node-bounded. Read that file before "speeding up" a frozen clock.

### Baselines (the drift pattern)

Some invariants have a *known, accepted* set of exceptions committed alongside
them (`*-baseline.json`, and `scripts/major-integrity-baseline.json`). The test
fails only when something **new** appears — a scraper regression, a new locale
gap. When a change is intentional, regenerate: `npm run test:baseline:update`
(or `node scripts/check-major-integrity.js --update` for majors), then review the
diff before committing. A surprising baseline change *is* the signal.

## Why the MCP server has its own `test/`

`mcp-server/` is a separate package with the MCP SDK installed, so its
tool-registration/schema tests live there. The **tool set can't drift** between
the Node and Cloudflare servers because both compose the same `createServer`
(`cloudflare/mcp-server/src/sessionDO.js` imports it from `mcp-server/src/server.js`);
what could drift — the advertised action docs — is covered by `invariant/mcp-actions`.

## Adding a test

1. Pick the layer by what the test *touches* (pure → unit, fixture → contract,
   whole dataset → invariant, network → live).
2. Name the file `<subject>.test.js`, mirror the source path where sensible.
3. If it needs committed data or a locale, use `helpers/paths.js`.
4. No network or clock reads outside `live/`. If you need "now", inject it.
