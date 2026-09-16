# FORK.md

This document is for anyone considering forking NU Map to continue maintaining it or to build something similar. It exists because the project has some structure (legal, identity, infrastructural) that does not transfer cleanly with a fork, and because the values it was built around only survive if the person forking it understands them and agrees to them.

If you are reading this because I (Nathan) have asked you to consider taking over NU Map, read the whole thing before you decide. If you are reading this because you found the repo and are thinking about forking it independently, same. Read the whole thing.

Forking NU Map is not "clone and deploy." It requires real work upfront and an ongoing commitment. This document lays out both.

---

## Part 1: The rules

If you fork NU Map, you agree to run it under these three rules. They are not aspirational; they are conditions. If you cannot commit to them, do not fork this project under the NU Map name. Build something else.

### Rule 1: User data stays under the user's control

The core architectural commitment of NU Map is that a user's plan lives in their browser and does not leave it unless they explicitly, per-use, choose to send it somewhere. As of the fork date there are exactly three such paths: the optional Claude MCP integration; a share link, which encodes the plan into the link itself and touches no server of ours; and a share code, where the plan is held briefly on our relay so another browser can collect it once, encrypted in the browser first with a key derived from the code, which the server never receives. `/privacy` describes all three. If you add a fourth, it goes there too.

Concretely, this means:

- No backend that stores user plans by default. Accounts, cloud sync, "log in to save your work" all violate the rule.
- No analytics, tracking, ads, or third-party embeds that collect user behavior. Cloudflare's basic operational logs are acceptable; anything beyond that is not.
- Any feature that involves sending user data anywhere must be opt-in, off by default, scoped narrowly, and revocable.
- If you add a feature that requires server-side state, it must be opt-in and the default experience must remain fully local.

Three things in the code you are inheriting sit close to that "no analytics" line, and you should know what they are rather than discover them:

- `src/core/healthBeacon.js` sends one message per page load saying whether the app managed to start. It carries no identifier of any kind, so two messages cannot be recognized as coming from the same browser. It exists because with no accounts and no analytics an outage is found by accident, which is exactly what happened on 2026-08-20.
- `src/core/ratingStore.js` sends a course rating (the course, and two numbers) with nothing attached that could link two ratings to each other.
- Course translation sends the catalog's own public course title and description to an external translator when the browser has no built-in one. It carries nothing the user entered.

The first two are switched off today: no NU Map build has a receiving server configured. If you switch either on, the shape written on `/privacy` and enforced by `test/contract/health-beacon-privacy.test.js` is the commitment. The absence of an identifier is the whole reason they are compatible with this rule; keep it that way or leave them off.

The reason: students should not have to trust a stranger's tool with their academic planning data in order to use it. The architecture makes that trust unnecessary. Do not undermine that.

### Rule 2: The core tool stays free for students

The core planning functionality, meaning at minimum everything shipped in NU Map as of the fork date, must remain available to Northeastern students at no cost, with no ads, no upsell, no gated features, and no monetization of user data or behavior.

You may:

- Charge for additional features that were not in NU Map at the time of forking, as long as the original functionality remains free.
- Charge for your own work: hosting, support, integration, or software you wrote yourself alongside the fork.
- Accept donations. Note that the donate button you inherit pays me; see Part 3.

You may not:

- Add ads or sponsored content.
- Gate any originally-free functionality behind payment.
- Sell, share, or monetize user data or behavior in any form.
- Add a "premium tier" that meaningfully degrades the free experience by comparison.

There is one more thing you cannot do, and it is a legal limit rather than one of my rules. You cannot sell commercial licenses to this codebase. NU Map is dual-licensed (`LICENSING.md`): the commercial option exists because Matthew and I hold the rights to the whole of the work, including everything contributors grant us under `CONTRIBUTING.md` §3. A fork takes the open-source option. That gives you no power to relieve anyone of the AGPL's obligations over our code, however much of your own you add. If a company approaches you wanting a proprietary license to the parts we wrote, send them to us.

The reason: the tool exists to help students. Students at Northeastern are already paying enough. If you cannot sustain the project without extracting value from the users it exists to serve, something is wrong with your model.

### Rule 3: Everything is transparent

Any change to what the tool does, what it collects, or how it works must be reflected in the public documentation before or at the same time as the change goes live. Silent changes to user-affecting behavior are prohibited.

Specifically, the following must always be current and accurate:

- The privacy page (currently `/privacy`)
- The About modal
- The data page (currently `/data`)
- Anything in the source code that a user might reasonably check to understand behavior
- The README and any other project documentation

If you change the architecture, update the docs. If you add a new data source, update the /data page. If you change how the Claude integration works, update the privacy page. If you add server-side anything, update everything.

The reason: users have a right to know what a tool does with their data and their attention. The current level of documentation is a promise you inherit when you fork.

---

## Part 2: Additional expectations

These are not the three iron rules, but they are strong expectations. Violating them would be against the spirit of the project even if it does not violate a specific rule.

### No dark patterns

The interface should not use manipulative or attention-extracting design. No anxiety-inducing notifications to drive engagement. No hidden defaults that expand data collection. No growth-hack patterns that exploit user psychology. The tool serves the user's stated goals; it does not compete for their engagement.

### No lock-in

Users must be able to export their data in a portable format (currently a per-plan JSON, a whole-library zip, and a PDF) and take it elsewhere. Do not create switching costs beyond the intrinsic value the tool provides.

One switching cost is easy to create by accident. A program's identity is its folder path, and that exact string is stored inside every saved plan and share link. Reorganize the program tree and every plan and link a student already holds stops resolving. `docs/scalability.md` explains what that constrains.

### Institutional boundaries

The tool is not affiliated with Northeastern University. Do not represent it as endorsed or official. Continue directing users to authoritative sources (Banner, DegreeWorks, academic advisors) for verification. If Northeastern approaches you about official adoption, that is your choice to make, but the default posture is unaffiliated.

### Honest attribution

If you use AI to help build or maintain the tool, disclose it. If you inherit from prior projects (including this one), credit them.

This one is not only manners. `LICENSING.md` §4 is an additional term imposed under AGPL §7(b): the notice in `NOTICE` must be reproduced verbatim, must stay reachable from the interface rather than only from the source, and must sit at a prominence no less than that of NU Map's About surface as published on 31 July 2026. You may display your own attribution alongside it. You may not edit it, relocate it somewhere a user would not find it, or present the fork as an original creation. Non-compliance terminates your rights under the AGPL automatically, so this is the item on the list with actual teeth. Do not remove Matthew Gu's and my names from the historical copyright; add your own alongside.

---

## Part 3: What you inherit that you cannot use as-is

Some parts of the NU Map codebase reflect specific legal, business, or personal architecture that applies to Matthew and me specifically. These do not transfer with a fork. You must remove or replace them before deploying your fork publicly.

### Legal and business architecture (must remove or fully rewrite)

- **`COMMERCIAL.md`**. Describes commercial licensing terms specific to us, and terms you have no standing to offer (Rule 2). Delete it. If you write your own, write it from scratch; do not deploy with ours in place.
- **`LICENSING.md`**. Do not simply delete this one. §4 is the attribution term you remain bound by, and `NOTICE` cross-references it by section number, so deleting the file strands an obligation you still have. Keep §4 and §5 as they are, or reproduce them somewhere `NOTICE` can point to. Everything else in it is ours: the dual-license structure in §2, and the pricing it points to (IPEDS-based bands for institutions, a US$10,000 revenue Nil Band for companies) are our design choices, not yours to inherit.
- **`NOTICE`**. Do not edit it. The attribution notice inside it must be reproduced verbatim, per Honest attribution above. Add your own copyright and your own notice alongside; ours stays exactly as written.
- **`CONTRIBUTING.md`**. Ours in two ways. It describes a two-student project that is not accepting contributions, and its §3 grants contributor rights to "the Licensor", which means Matthew and me. Leave it in place and you are collecting license grants on our behalf from people who think they are contributing to your fork. Rewrite it for your team, or delete it.
- **`docs/co-ownership-agreement.md`**. A signed agreement between two named people about copyright and revenue splits. Delete it. It has nothing to do with your fork.
- **The "commercial licensing" link in the About footer**. Remove it, or point it at your own terms.
- **Any references to our commercial license pricing anywhere in the codebase or documentation**. Search for `IPEDS`, `US$10,000`, `Nil Band`, `self-certification`, `commercial licensing`, and `COMMERCIAL.md`, and remove or replace all of them.

### Identity and attribution (must update)

- **Copyright notices**, in `NOTICE`, `LICENSING.md`, the About modal footer, and the three source files that carry a header (`src/main.jsx`, `src/App.jsx`, `src/ui/RecoveryBoundary.jsx`). `LICENSE` is the unmodified AGPL text and carries no copyright of ours, so leave that file alone. Preserve the historical "© 2025-2026 Nathan Gu & Matthew Gu" and add your own alongside for post-fork work.
- **The Creator and Contributor labels** in the About modal (`src/ui/DisclaimerModal.jsx`). Replace with your own team's structure. Do not leave our names as if we are still the maintainers.
- **LinkedIn links** pointing to Matthew and me, in the same file. Remove or replace.
- **The "Built with Claude" credit**. Update to reflect how you build. If you use AI, say how. If you do not, remove.
- **The feedback link** in the header. It is a Google Form, not an email address, and its responses land in my Google account, so replacing it means replacing the URL in `src/ui/Header.jsx`.
- **The GitHub links**, in the About modal, the README, and `llms.txt`. All ours. Note that the repository link in the About modal is also what discharges the AGPL's obligation to offer source to users over a network, so it has to point at your own modified source, not merely at somewhere you can be contacted.
- **The donate button**. `src/core/donate.js` hardcodes my Stripe payment link, and `cloudflare/stripe-split/` is a Worker whose only job is to move 35% of each donation to the other author's connected account under our co-ownership agreement, whose live account id sits in its `wrangler.toml`. If you want donations, replace the link and either delete that Worker or rewrite it for whatever split you owe your own people. It is the only code in the project that can move money, and it runs on a Stripe credential of ours; do not leave it deployed.

### Story and documentation (must rewrite in your voice)

- **`/story` page**. This is our story, personally. It references us, our spreadsheet, our motivation. Rewrite it as your own story. Do not deploy with our biographical content in place.
- **`/privacy` page**. Must be updated to reflect your specific practices. If you change any part of the architecture (for example, adding a backend), the privacy page must be rewritten to accurately describe what your version does. If you change nothing architecturally, still update to reflect who "we" refers to now.
- **`/data` page**. Same. Reflects our pipeline. Update to reflect yours.
- **The README**. Update to reflect current maintainers and any changes in direction.
- **`llms.txt`**. References our canonical URLs. Update to yours.

### Infrastructure (must set up your own)

None of the following transfers with a fork. You need to stand up your own equivalents:

- **Domain**. `numap.app` is registered to and paid for by me. Whether it transfers to you is a separate decision (see Part 6). If it does not, you need your own domain.
- **Cloudflare account** for hosting. The site is a Cloudflare Pages project whose **build command is configured in the dashboard, not in `package.json`**, which is the first thing that surprises people. Two Pages environment variables gate features: `VITE_MCP_SERVER_URL` (without it neither the Claude integration nor share codes activate at all, per `src/config.js`) and `VITE_TRANSLATE_PROXY`. `cloudflare/README.md` is the setup guide.
- **Four Workers**, each a separate deployment: `cloudflare/mcp-server/` (the Claude connector, currently `mcp.numap.app`, which also carries the share-code relay), `cloudflare/translate-proxy.js` (currently `translate.numap.app`), `cloudflare/health-beacon/`, and `cloudflare/stripe-split/`. You only need the ones whose features you keep. Spin up your own and update the URLs everywhere they appear, including `nu-map.pages.dev` and the mirror below.
- **The Pages Function at `functions/index.js`**, which is what serves the maintenance 503. It deploys with the site, but it reads `public/maintenance.json`, so read `docs/maintenance.md` before you touch either.
- **GitHub Actions**. The scraper pipelines need no secrets of their own; they push with the automatic `GITHUB_TOKEN`. The one configured secret is `VITE_TRANSLATE_PROXY`, in `deploy-pages.yml`. What you do have to do is **enable the scheduled workflows**: GitHub disables schedules in a freshly forked repository, and disables them again after 60 days without activity in the repo. Failure notifications currently open issues on our repository, so re-point those at yours.
- **GitHub Pages mirror** (currently `nayugu.github.io/nu-map`). My deployment. Host your own mirror if you want redundancy.

Two things about the platform, because they are close to their ceilings and neither fails loudly: the build is at roughly 1,285 of Cloudflare Pages' 2,100 static redirect rules, and one shipped asset is 22.48 of the 25 MiB per-file limit. `docs/scalability.md` has the measurements. Read it before adding catalog editions or per-entity pages, and never solve a file-count problem by adding redirects.

### Data you cannot regenerate (must preserve)

Most of `data/` and `public/northeastern/` can be rebuilt by re-running the scrapers. The frozen catalog editions under `data/northeastern/catalog/editions/` cannot. Northeastern's archive skipped 2025-2026 entirely (it exists as PDF only), so our 2026 snapshot is the only machine-readable copy in existence, and an edition's data is only capturable while that edition is live. Those snapshots are what let a student's frozen degree requirements keep resolving to courses Northeastern has since retired. Do not delete them, and do not "re-scrape to be safe": a re-scrape writes today's catalog under an old year's label, which is worse than a gap.

---

## Part 4: Before you change anything

The single most valuable thing in this repository is not the code. It is `CLAUDE.md`, which records, rule by rule, what each design decision cost and which failure paid for it. Almost every rule in it exists because something shipped wrong to real students first. Read it before your first change, and re-read it when a decision looks obvious.

Alongside it: `docs/` holds the design of record for each subsystem (the plan engine, requirement credit, catalog editions, maintenance windows, the data surface), and `notes/` holds our working lists.

How the project is verified, since a green Node suite proves less here than you would think:

- `npm test` for the unit, contract, and invariant suites.
- `npm run test:boot`, which builds and mounts the app in headless Chromium. Nothing that runs in Node evaluates a React component body, so this is the only thing that catches "the app does not render." It takes about five seconds. Run it before pushing anything under `src/ui/` or `src/context/`.
- `node scripts/verify-chart.js` for a covering sample of degree plans, `--all` for the corpus verdict.
- `node scripts/mutation-probe.js`, which breaks the code on purpose to find out whether the tests notice.

Two habits worth inheriting. Measure before designing: most good calls in this project were made by a script that took two minutes, and several attractive ideas died on contact with the corpus. And degrade to less information rather than to wrong information, because a wrong number here reaches a student planning their degree.

---

## Part 5: The cleanup checklist

If you fork, do these in order before deploying publicly:

1. **Read `CLAUDE.md`, then every file in the repo.** Identify what is Northeastern-specific (may be relevant), Nathan-and-Matthew-specific (must remove or replace), and generic infrastructure (may keep).
2. **Delete or rewrite the legal and business architecture files** listed above (`COMMERCIAL.md`, `CONTRIBUTING.md`, `docs/co-ownership-agreement.md`, the reducible parts of `LICENSING.md`, and related references), keeping `NOTICE` and `LICENSING.md` §4 intact.
3. **Update all copyright and attribution.** Preserve historical, add current. Leave `NOTICE`'s attribution notice and the `LICENSE` file untouched.
4. **Rewrite the About modal, /story, /privacy, /data, and README** to reflect your team and your practices. Replace the feedback form, the GitHub links, and the donate link with your own.
5. **Stand up your own infrastructure.** Domain, Cloudflare Pages project (dashboard build command, both `VITE_` variables), whichever of the four Workers you keep, GitHub Pages mirror.
6. **Enable the scheduled workflows and re-point their failure notifications**, then confirm a run actually lands. A pipeline that silently never runs is the project's worst failure mode: the site keeps serving last month's data and looks perfectly healthy.
7. **Update `llms.txt` and all canonical URLs** to point to your deployment.
8. **Publish your own commitment to the three rules** somewhere visible in your fork, whether in the README, About modal, or a dedicated page. Users of the forked version should be able to see that you have inherited these commitments.
9. **Test that the scrapers still work**, and that the suites in Part 4 pass. Northeastern's systems may have changed since the last commit; you may need to update the adapters.
10. **Decide how you will fund it**, if at all. Donations and charging for your own work are open to you; selling licenses to our code is not.

Expect this to take one to two weeks of focused work for a competent developer or small team. If it is going faster than that, you are probably missing something.

---

## Part 6: The name and the domain

The name "NU Map" and the domain `numap.app` are separate from the AGPL-licensed code. Forking the code does not automatically give you rights to the name or the domain; `LICENSING.md` §5 reserves both explicitly, and a derivative work is required to carry a distinct name and branding.

If you want to use the NU Map name or the numap.app domain, that is a separate conversation with Matthew and me (or, after we graduate, with whoever we designate). NU Map is jointly owned, so it is not mine alone to hand over. The default assumption is that a fork operates under a different name.

If we decide to transfer the name and domain to a successor, that transfer will likely come with a written agreement including a revocation clause: if the successor violates any of the three rules or misrepresents the tool's independence from Northeastern, the license to use the name and domain is revoked and the successor must rebrand.

What will not transfer in any version of this is the copyright. That is deliberate, and it is not about control: the copyright is what makes the commercial option in `LICENSING.md` possible, and assigning it away would collapse that option permanently. The thing being handed over is operations, not ownership. A club or a department can maintain this indefinitely without needing to own it.

This is not adversarial. It is because the name has come to represent a specific set of commitments to users, and I want to make sure those commitments survive even if the person maintaining the tool changes.

---

## Part 7: If you are a club or organization

If you are considering adopting NU Map as an ongoing organizational project (for example, Sandbox at Northeastern), a few additional things:

- **Read the three rules carefully and confirm your organization can commit to them across leadership turnover.** Norms in charters get renegotiated. If your organizational culture is likely to drift toward "well, we could add accounts, users are asking for it," this project is not a good fit.
- **Assign a specific maintainer, not "the organization."** Projects that belong to everyone belong to no one.
- **Plan for how you will handle your own succession.** If your current members graduate and no one else picks it up, what happens? Ideally you have an answer before you take on the project.
- **Consider whether you actually want this or whether you are being polite.** It is better to say no now than to accept and let it degrade.

If you take it on as an operator rather than as a fork, most of Part 3 does not apply: the identity, the legal files and the copyright stay where they are, and what you need is access to the infrastructure and the pipelines. That is the lighter path and usually the right one.

If you accept, I would like to do a supervised handoff over several months rather than a single transfer. This means I stay available to answer questions and review changes for a period after you take over, so you can build the mental model of the codebase with support. It also means I can course-correct if I see the fork drifting from the rules early.

---

## Part 8: If no one takes it over

The project may be archived rather than transferred. If that happens, the responsible archive procedure is:

1. Announce a sunset date publicly (in the About modal, the README, and any active user channels). The maintenance system is the mechanism for the in-app half of this: `public/maintenance.json` drives every surface, every time in it is absolute, and `docs/maintenance.md` is the runbook. Note that the reason shown to students comes from a closed vocabulary with eight hand-written locales, so a new one is a code change, not a config change.
2. Encourage users to export their plans as PDFs or JSON before that date.
3. On the sunset date, update the About modal and site header to display "Archived. Data frozen as of [date], not maintained, do not use for planning."
4. Leave the repository public but mark it archived on GitHub, and disable the scheduled workflows so the data stops moving under a site that says it is frozen.
5. Keep the domain live as long as reasonably possible, so existing users' saved links continue to work in read-only mode.

An honest archive is a legitimate ending. It is much better than silent decay into wrongness. If you are inheriting a version of NU Map that has been unmaintained for a while, check when the last data update was and consider whether the responsible move is to run it or to close it.

---

## Final note

I built this with my brother Matthew because we needed it. We made it public because we thought it might help others. The three rules and the additional expectations reflect what I believe good software owes its users, and the whole reason I am writing this document is that I want those commitments to survive me if the project does.

If you fork this and honor these rules, you have my thanks and my support. If you fork this and violate them, please at least have the decency to change the name.

Sincerely,\
Nathan Gu
