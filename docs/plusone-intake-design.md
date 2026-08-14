# PlusOne intake — keeping ~75 pathways correct


> **This document is the reasoning behind a decision, not the reference.**
> For what PlusOne *is* — the rules, the sources, the measurements and the
> known gaps — see **[`plusone.md`](plusone.md)**, which is the single source
> of truth. This file is kept for the argument it records.

> **Superseded in part (2026-08-13).** This document's claim that the catalog
> carries no PlusOne data is **too strong**. The catalog's *dedicated* PlusOne
> pages are stubs, but 42 ordinary programme and department pages carry real
> PlusOne content — share tables, requirement waivers, substitutions and
> timing. See [`plusone.md`](plusone.md) §9.1 and §9.1a, which also record two
> defects in our own pipeline that discard it.

**Status: design + measured inventory. The discovery stage is prototyped and
works; nothing is committed as a script yet.** Third document in the set, after
`plusone-research.md` (what PlusOne is) and `plusone-design.md` (the engine).

Measurements were taken **2026-08-13** by running the prototype in
`docs/` companion form against all 13 college hosts.

---

## 1. What the measurement changed

`plusone-design.md` §4.1 argued for **hand curation over scraping**, because the
sources are marketing pages with no catalog authority. That reasoning was sound
for the ~100-pathway estimate it was based on, and it is now **partly wrong**,
for a reason only a systematic sweep could show:

**The pages are far more machine-discoverable than the research suggested.** A
sitemap sweep of 13 hosts found **44,371 URLs and 123 PlusOne candidates in
about 40 seconds**, including three sources I had failed to find by hand and had
recorded as gaps:

| Source | Status in `plusone-research.md` | Found by the sweep |
|---|---|---|
| CSSH college-level index | "no college-level index" | `cssh…/academics/majors-minors-programs/plusone-programs/` — **12 programs** |
| CAMD program list | "unconfirmed beyond 'CAMD has PlusOne'" | `camd…/programs-admissions/plusone/` — **8 programs** |
| COE pathway pages | found 4 by hand | **26 pathway pages** across 6 hosts |

So the revised position is: **discovery should be automated, extraction should
not.** Finding the pages is a solved, cheap, repeatable problem. Turning a
marketing page into 20 typed rules is not — §4 explains why, and the two bugs in
§3 are the evidence.

---

## 2. The inventory, measured

Sitemap sweep, `/sitemap_index.xml` on each host, robots.txt `Disallow` honoured.

| Host | URLs | Candidates | Pathway pages (news/events dropped) |
|---|---|---|---|
| khoury | 2,444 | 10 | **7** |
| coe | 9,882 | 36 | 12 (+ 7 policy/FAQ/apply/co-op pages) |
| cos | 2,445 | 13 | **8** |
| cssh | 5,668 | 3 | 1 index → **12 programs** |
| bouve | 1,176 | 6 | 4 (+ the 11-program PDF) |
| damore-mckim | 4,426 | 13 | **3** |
| camd | 3,708 | 1 | 1 index → **8 programs** |
| cps | 4,095 | 10 | 3 |
| ece | 3,442 | 11 | **6** |
| mie | 2,701 | 12 | **7** |
| cee | 2,277 | 7 | **5** |
| che | 2,286 | 6 | **2** |
| bioe | 1,831 | 5 | **1** |
| **total** | **44,371** | **123** | **~75 pathways** |

We currently ship **4**. The engine is ~5% populated.

Newly discovered pathway pages I had never read, by department:

- **Khoury (3 new):** MS Artificial Intelligence, MS Bioinformatics, MS Health Informatics
- **COE central (7):** `plusone-arti`, `plusone-prod`, `plusone-robo`, `plusone-daam`, `plusone-insy`, **`plusone-insy-bridge`**, `plusone-swes`
- **ECE (6):** `elce`, `extr`, `iot`, `robo`, `with-ms-in-robotics`, `wne`
- **MIE (7):** `aim`, `daae`, `enes`, `engm`, `inde`, `mece`, `robo`
- **CEE (5):** `cepp`, `cive`, `csae`, `envi`, `subs`
- **ChE (2):** `chme`, `phce` · **BioE (1):** `bion`
- **CoS (8):** applied-mathematics, bioinformatics, biotechnology, cell-gene-therapies, chemistry, environmental-science-and-policy, marine-biology, nanomedicine
- **CSSH (12):** Applied Quantitative Methods & Social Analysis, Criminology & CJ, Economics, English, History, International Affairs, Political Science, Public Administration, Public Policy, Resilience Studies, Urban Informatics, Urban Planning & Public Policy
- **CAMD (8):** Experience Design, Game Science & Design, Information Design & Data Visualization, Journalism (MA), Media Advocacy, Media Innovation & Data Communication, Media Technology & Ethics, **M.Arch (BS Architecture only)**

Note `plusone-robo` appears in **three** departments (COE, ECE, MIE) — the same
master's reached from different undergraduate homes. Pathways are a
many-to-many graph, not a list.

---

## 3. Two hazards the sweep exposed, both of which bit

### 3.1 Six hosts are unreachable from Node — and failed silently

`coe`, `ece`, `mie`, `cee`, `che`, `bioe` all fail in Node with
`UNABLE_TO_VERIFY_LEAF_SIGNATURE`, while `curl` on macOS succeeds. Diagnosed:

```
leaf   CN=binary.coe.neu.edu   issuer: InCommon RSA OV SSL CA 3
chain  the server presents:            InCommon RSA Server CA 2   ← wrong CA
```

The server sends the **wrong intermediate**, so the chain is broken rather than
merely incomplete — which is why `--use-system-ca` does not help either. `curl`
works only because macOS's keychain has the real intermediate cached.

Fix, verified: fetch the correct intermediate from the leaf's AIA extension
(`http://crt.sectigo.com/InCommonRSAOVSSLCA3.crt`), convert DER→PEM, and pass it
via `NODE_EXTRA_CA_CERTS`. All six then return 200.

**The worse half of this finding is how it presented.** My first sweep swallowed
fetch errors and reported "coe — 0 urls", which reads as *this host has no
PlusOne pages* rather than *we could not reach this host at all*. Six colleges —
including the largest — looked empty. On CI (Linux, no keychain) that would be
the permanent, silent state.

So the intake system's first rail: **a host that yields zero URLs is a failure,
never a result.** Same principle as `fetch-nupath`'s 5% rule and the scrape
rails in `scripts/lib/scrape-rails.js`.

### 3.2 The candidate regex is 39% noise

123 candidates included news articles, event pages, tag archives and
`cssh…/has-russias-timeline-in-ukraine-accelerated-heres-what-you-need-to-know/`.
Dropping `/(news|event|events|tag|resources|blog|stories|spotlight)/` leaves ~75.

That is not a regex to tune forever — it is the reason **classification is a
stage, not a filter**, and why a human confirms an inventory diff (§5).

---

## 4. The rule inventory grew from 73 to 84

`plusone-design.md` §2 catalogued 73 rules. Reading four newly-found pages added
**11 kinds**, which is the strongest available evidence that the inventory will
keep growing and that the registry was the right architecture.

| # | New rule | Source | Class |
|---|---|---|---|
| 74 | **Deadline as a week-of-term**, not a date — "end of the 7th week of Fall or Spring" | COE FAQ | info |
| 75 | **Sharing is MANDATORY** for some pathways, not optional | COE FAQ | computable |
| 76 | **Online-course cap**: a PlusOne undergraduate may take only **1 online course per semester** | COE FAQ | computable |
| 77 | **Modality restriction**: V35 video-streaming sections are for part-time graduate students only | COE FAQ | unknowable |
| 78 | **Program-change window**: may switch MS target before the final undergraduate term, never after matriculating | COE FAQ | computable |
| 79 | **Standard Petition** required for out-of-curriculum courses and all waivers | COE FAQ | unknowable |
| 80 | **Visa/OGS compliance** for international students | COE FAQ | unknowable |
| 81 | **Minimum GRADE in named courses** — "a B in INFO 5001, 5002 and 5100" for good standing | COE INSY Bridge | **computable** (we hold grades) |
| 82 | **Bridge pathway**: prescribed core courses for students without the background; eligible majors are deliberately *outside* the discipline (Music, Management, Interdisciplinary Studies) | COE INSY Bridge | computable |
| 83 | **Recommendation letters waived above a GPA** (3.300) — a conditional *application* requirement | CAMD | assertable |
| 84 | **"Earned or in-progress" credit gate** (64 SH) — softer than SCCJ's 64 *earned* | CAMD | computable |

**One correction to `plusone-design.md`, and it is material.** I modelled the
16 SH cap as a limit on credit *shared with the bachelor's*. The COE FAQ says:

> Additional graduate coursework beyond 16 hours cannot transfer to MS, **even
> if not applied to BS**.

So there are **two** distinct 16 SH limits: how much may be *shared*, and how
much graduate credit taken as an undergraduate may *transfer to the master's at
all*. A student who takes 24 SH of graduate courses and shares only 12 still
loses 8 SH. `shareCap` currently models only the first. This is a real modelling
gap, not a wording quibble.

---

## 5. The intake system

Five stages, and **the human sits between three and four**, deliberately.

```
  ┌──────────┐   ┌──────────┐   ┌───────────┐   ┌────────┐   ┌────────┐
  │ DISCOVER │──▶│  FETCH   │──▶│ CLASSIFY  │──▶│ EXTRACT│──▶│ VERIFY │
  │ sitemaps │   │ + cache  │   │ + diff    │   │ HUMAN  │   │ rails  │
  └──────────┘   └──────────┘   └───────────┘   └────────┘   └────────┘
       auto            auto           auto        assisted       auto
```

### Stage 1 — DISCOVER (automate fully)

`scripts/discover-pathways.js`. Sitemap sweep of the 13 hosts, robots-respecting,
candidate regex, noise filter. Emits `data/northeastern/pathways/_inventory.json`:
every candidate URL with host, last-modified from the sitemap, and a
`status: new | known | gone` against what we already ship.

Rails: a host yielding 0 URLs **fails the run**; total candidates dropping more
than 20% from the committed inventory fails the run. Both are the
`fetch-nupath` 5% rule applied to a different collapse.

### Stage 2 — FETCH + CACHE (automate fully)

Fetch each candidate to `data/northeastern/pathways/_cache/<host>/<slug>.html`,
committed. Two reasons this cache is not optional:

- **Provenance.** Every pathway file claims a `source.url` and `retrievedAt`; the
  cache is what makes that claim checkable a year later, when the page has
  changed and the reviewer needs to see what we actually read.
- **Dead sources.** `plusone.northeastern.edu` was already gone before we
  started, and one COE policy page was only reachable on a staging host. The
  cache is the difference between a stale pathway and an unverifiable one.

Needs the TLS fix from §3.1: ship `scripts/lib/certs/incommon-rsa-ov-ssl-ca-3.pem`
and set `NODE_EXTRA_CA_CERTS` in the workflow, with a comment pointing at the
misconfiguration so nobody deletes it as mysterious.

### Stage 3 — CLASSIFY + DIFF (automate fully)

Per cached page, decide: pathway page / policy page / index / noise. Signals that
work on the pages read so far, none of which needs a model:

- a **course-code table** (`\b[A-Z]{2,6} ?\d{4}\b` in `<table>` or `<li>`) → pathway
- "PlusOne" in `<h1>` plus an eligible-majors list → pathway
- FAQ/policy vocabulary ("deadline", "scholarship", "petition") → policy page
- a list of links to other candidates → index
- a date in the URL or `/news/`, `/event/` → noise

Then **diff against the committed cache** and emit a report: pages added,
removed, and changed (with a text diff). This is the drift detector
`plusone-design.md` §4.1 promised, and it is the stage that makes curation
sustainable — the reviewer reads a diff, not 75 pages.

### Stage 4 — EXTRACT (assisted, never automatic)

**A human writes the pathway JSON. The system makes that cheap, not automatic.**

This is the part I am *not* reversing, and §3–4 are why. Turning a page into rules
requires judgement that a parser does not have:

- CE→MSCS's "choose two" is genuinely ambiguous about whether it includes the
  mandatory courses — the correct output is `counts: "unknown"`, which no
  extractor would produce;
- `CS 5500 → CS 4500 / CS 4530` is an *alternation*, and reading it as two
  independent rows is exactly the bug in §3 of the commit log — the page does not
  say which it is;
- Bouvé's official PDF contradicts itself (a copy-pasted block, two different
  titles for `CAEP 6328`), so a faithful extractor would faithfully encode an
  error;
- the 16 SH cap has **two** meanings (§4) that the same number is used for.

What the tooling should provide instead:

1. **A scaffold generator** — `--scaffold <url>` writes a skeleton pathway file
   with `source` pre-filled, program ids guessed from the page's course codes,
   and every rule slot commented with the vocabulary. The author edits and deletes.
2. **Course-code extraction** with the codes' catalog titles inlined as comments,
   so a transcription error is visible while typing rather than at verify time.
3. **A confidence field per pathway** (`published` / `derived` / `partial`) and a
   `todo[]` for what the author could not resolve — surfaced in the UI as
   "verify with your advisor" rather than hidden.

### Stage 5 — VERIFY (automate fully)

`scripts/verify-pathways.js`, already built and already catching things. Extend
with what §3–4 taught:

- every rule kind is in the vocabulary **and** registered (already)
- every named course exists; `grad` ≥5000, course targets <5000 (already)
- every share satisfies something in the MS requirement tree (already — the check
  that catches a plausible wrong code)
- **new:** no graduate course may map to more than one target *without* the
  pathway acknowledging the alternation (the §3 bug, caught at data time)
- **new:** `_inventory.json` coverage — every classified pathway page either has a
  pathway file or an explicit `skipped` entry with a reason, so a page cannot be
  quietly ignored
- **new:** every `source.url` is present in the committed cache

---

## 6. Ordering, and what I would do first

1. **Fix the two-caps modelling gap** (§4). It is a correctness bug in shipped
   code, small, and independent of everything else.
2. **DISCOVER + FETCH + the TLS fix.** Highest value per line: it turns "we know
   of 4 pathways" into a checkable inventory of 75, and its rails mean a broken
   host can never again look like an empty one.
3. **CLASSIFY + DIFF.** Makes step 2 repeatable and turns 75 pages into a
   reviewable diff.
4. **Extract by college, cheapest-shape first** — Khoury's remaining 3, then CoS
   (8 pages, one URL pattern, explicit tables), then CSSH (12, one index), then
   engineering (26, needs `subBudget` and the bridge/grade kinds), then Bouvé
   (needs `partition`, the PDF, and the two-for-one note), then CPS/CAMD.
5. **The new rule kinds**, added as the pathways that need them land — not before.
   A kind with no instance is speculation.

**What I would not do:** write an extractor that turns pages into rules
automatically. The measurement that would change my mind is a corpus one — take
20 hand-written pathway files and check what fraction of their rules are
recoverable from the page by a deterministic parser. If it is high, extraction is
worth automating; if it is the alternation and ambiguity cases that dominate, it
is not. That measurement is cheap and should come before any extractor.

---

## 7. Open, and honest about it

1. **The two-caps gap (§4)** — shipped code models one of two 16 SH limits.
2. **Bouvé's 11 master's targets have only 4 pages**; the rest live in a PDF that
   states its own expiry and contains known contradictions. PDF intake is a
   separate problem from HTML intake and is not designed here.
3. **CPS is barely mapped** — 3 pathway pages found against a page that lists
   dozens of pairings inline, so its real shape is unknown.
4. **`plusone-robo` in three departments** — we have no id convention for one
   master's reached from several undergraduate homes. Probably one pathway file
   with several `eligibility` entries, but unverified against the three pages.
5. **`KB000020031` is read** (ServiceNow Knowledge API — see plusone-research.md
   §8a), and adds a universal rule we do not model: a minimum of 14 graduate
   semester hours AFTER the bachelor's. It is silent on registration mechanics
   and billing, which remain unsourced.
6. **Banner visibility** — never checked. If a PlusOne share is invisible to
   Banner, everything here is the student's assertion and the UI must keep saying
   so.
