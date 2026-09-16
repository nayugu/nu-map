# Access inventory — what the project runs on

Everything NU Map needs an account or a key for, so a handover can be a
checklist rather than a memory test. Written for the handover we actually
expect: someone operates the project while ownership stays put (see FORK.md,
which covers the other case, where a fork replaces all of this with its own).

**This file contains no secrets and must never contain one.** It says where
each credential lives, not what it is. Keys live in Cloudflare Workers secrets,
GitHub Actions secrets, or the holder's password manager.

**Holder** is left as `Nathan` where that is currently true. Correct it at
handover rather than at the first incident.

## The short version

If you are taking over operations, you need: the Cloudflare account, admin on
the GitHub repository, and control of the domain. Everything else on this page
either follows from those three or is optional.

## 1. Domain

| | |
|---|---|
| **What** | `numap.app`, plus `mcp.numap.app` and `translate.numap.app` |
| **Where** | The registrar, and DNS on Cloudflare |
| **Holder** | Nathan (registered and paid for personally) |
| **If it lapses** | The site, the Claude connector, and every share link anyone has saved stop resolving. The GitHub Pages mirror keeps working. |

The name and the domain are deliberately *not* covered by the open-source
licence and do not transfer with a fork. Transferring them to a successor is a
separate decision; FORK.md Part 6 explains why.

## 2. Cloudflare

One account carries almost all of the infrastructure.

| Deployment | Name | What it does | Needed for |
|---|---|---|---|
| Pages | `nu-map` | The site itself, plus the Pages Function on `/` that serves the maintenance page | Everything |
| Worker | `numap-mcp` | The Claude connector at `mcp.numap.app`, and the share-code relay | Claude integration, share codes |
| Worker | `translate-proxy` | Reaches the translation API from regions that block it | Course translation in some regions |
| Worker | `numap-health` | Receives the start-up beacon | Nothing today (switched off) |
| Worker | `numap-stripe-split` | Splits donation income between the two authors | Donations |

Two things about the Pages project surprise people:

- **The build command is configured in the Cloudflare dashboard, not in
  `package.json`.** If a deploy starts producing a stale or empty site, check
  there first.
- **Two environment variables gate features**, set in Pages → Settings:
  `VITE_MCP_SERVER_URL` (without it, neither the Claude integration nor share
  codes activate at all) and `VITE_TRANSLATE_PROXY`.

There are also zone-level rules on `numap.app` exempting `/northeastern/` and
`/assets/` from bot verification. If the catalog suddenly returns errors to
real users, check those before anything else.

## 3. GitHub

| | |
|---|---|
| **Repository** | `github.com/nayugu/nu-map`, public |
| **Holder** | Nathan |
| **Needed for** | The scrapers, which run as scheduled Actions and push straight to `main` |

An operator needs write access at minimum, and admin to manage Actions and
schedules. Worth knowing:

- **The scrapers need no secrets of their own.** They push with the token
  GitHub provides automatically. The only configured Actions secret is
  `VITE_TRANSLATE_PROXY`, used by the deploy-to-Pages workflow.
- **Scheduled workflows are disabled automatically after 60 days without repo
  activity**, and are disabled by default in a fresh fork. Re-enabling is a
  button in the Actions tab. The weekly staleness watchdog exists to catch
  exactly this.
- **Never require pull requests on `main`.** The data workflows push to it
  directly and would break.
- The mirror at `nayugu.github.io/nu-map` is published from the `gh-pages`
  branch by a workflow. It needs no separate account.

## 4. Stripe (only if you keep donations)

| | |
|---|---|
| **What** | A payment link, and a restricted API key used by the `numap-stripe-split` worker |
| **Where** | The key is a Worker secret named `STRIPE_SECRET_KEY`. The receiving account id is in `cloudflare/stripe-split/wrangler.toml` and is not a secret. |
| **Holder** | Nathan (platform account), Matthew (connected account receiving the split) |

This is the only code in the project that can move money, which is why it has
its own deployment and its own credential and shares nothing with the other
workers. The key is restricted to creating transfers and reading balances; it
cannot do anything else. `cloudflare/stripe-split/README.md` has the setup and
the one mistake that burns the key.

## 5. Feedback form

| | |
|---|---|
| **What** | A Google Form, linked from the app header |
| **Holder** | Nathan's Google account |

Responses land in a personal Google account, so this one is invisible to
everyone else by default. Either share the form or replace the link; leaving it
means feedback keeps arriving somewhere the operator cannot see.

## 6. Maintenance access

Scheduling a maintenance window commits a file to the repository. There are
three ways to do it, and the first two are the normal ones:

1. **Locally**, through the dev portal while running the dev server. Needs
   nothing.
2. **From anywhere**, including a phone, by triggering the maintenance
   workflow. This needs a GitHub personal access token, which the dev portal
   stores in the browser it is used from. It is per-person: a new operator
   creates their own, and nothing needs to be handed over.
3. **By hand**, editing and committing `public/maintenance.json`.

All three depend on the Pages deploy being healthy. There is deliberately no
emergency override that bypasses it.

## What needs no account at all

Worth stating, because it is unusual and it is what makes the rest of this list
short. Northeastern's catalog, Banner, and the Registrar's Tableau dashboard are
all scraped from public pages with no login. There is no database, no
authentication provider, no error-tracking service, no analytics, and no
third-party API key anywhere in the app. Student plans live in the student's own
browser, so there is no user data to hand over, and no account holding any.

## At handover

1. Add the new operator to Cloudflare, and confirm they can see the Pages
   project and all four workers.
2. Give them admin on the GitHub repository, and have them confirm the
   scheduled workflows are enabled.
3. Decide the domain question explicitly. Transferred, or pointed at their
   deployment, or left with the current holder as a dependency they should know
   about.
4. Decide whether donations continue. If not, remove the donate button and
   delete the stripe-split worker rather than leaving it deployed.
5. Share or replace the feedback form.
6. Have them run one pipeline by hand, end to end, and read the result. That is
   the only real test that access is complete.
