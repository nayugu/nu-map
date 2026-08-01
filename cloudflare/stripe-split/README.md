# Author revenue split

Automates §3 of [`docs/co-ownership-agreement.md`](../../docs/co-ownership-agreement.md):
of what NU Map brings in, net of the payment processor's cut, the recipient gets
35% and the platform keeps the rest.

A donation succeeds → this worker reads the charge's **net** → transfers 35% of
it to the recipient's connected account → Stripe pays that out to their bank on
their own schedule. The platform's 65% needs no transfer; it just stays put.

Its own worker on purpose. This is the only code in the project that can move
money, so it gets its own credential and its own deploy, and shares nothing with
the MCP server.

## Setup

**1. Create a restricted API key.** Stripe → Developers → API keys → *Create
restricted key*. Grant **write** on:

- `Transfers` — to create transfers and reversals
- `Balance transactions` — **read**, to get the net of each charge

Nothing else. A full secret key here would let a compromised worker do anything;
this one can only move money to the one account named in `wrangler.toml`.

**2. Set the connected account** in `wrangler.toml` → `CONNECTED_ACCOUNT_ID`
(`acct_…`, from the recipient's connected account page).

**3. Deploy**, to get a URL to point Stripe at.

```sh
cd cloudflare/stripe-split
npx wrangler secret put STRIPE_SECRET_KEY   # paste the rk_… AT THE PROMPT
npx wrangler deploy
```

⚠ The secret's **name** is the literal `STRIPE_SECRET_KEY`. Running
`wrangler secret put rk_live_…` stores the key *as the name*, and names are not
encrypted — they show in the dashboard and in `wrangler secret list`. If that
happens, delete the entry and roll the key; it is burned.

**4. Register the webhook.** Stripe → Developers → Webhooks → *Add destination*:

- Scope: **Your account** (not connected accounts)
- Payload style: **Snapshot** — thin payloads omit `data.object` and nothing works
- Events: **`charge.succeeded`** and **`charge.refunded`**
- URL: the deployed worker URL + `/stripe/webhook`

Then store the signing secret it shows you:

```sh
npx wrangler secret put STRIPE_WEBHOOK_SECRET   # paste the whsec_… at the prompt
```

Secrets take effect immediately — no redeploy needed. Check with
`npx wrangler secret list`: you should see those two names and no key material.

**5. Set the recipient's payout schedule to monthly.** Transfers between Stripe
balances are free, but each payout to their bank costs 0.25% + $0.25, and Stripe
charges $2 for any month in which a connected account receives a payout. Monthly
payouts mean those fees land once a month instead of daily. They set this in
their Express Dashboard.

## Checking it works

```sh
curl https://<worker-url>/health
```

Returns the destination account, the share in basis points, and whether both
secrets are present.

Then test properly in **test mode** before trusting it live: make a test
donation with card `4242 4242 4242 4242`, and confirm a transfer appears against
the recipient account. Stripe's webhook UI shows the worker's response body,
which says exactly what it did — including why it skipped an event.

## Notes on the things that could bite

**Idempotency.** Stripe retries on any non-2xx and can deliver an event twice.
Transfers are keyed on the charge id, so a retry is a no-op rather than a second
payment. This is why the worker returns 500 on failure instead of swallowing it:
a retry is safe, and silence is not.

**Unsettled funds.** Transfers use `source_transaction`, tying each to its
originating charge, so they settle when the charge does. Without it, transfers
fail with "insufficient available balance" because donation money has not
cleared.

**`charge.balance_transaction` is null on the event.** Stripe fires
`charge.succeeded` *before* attaching the balance transaction, so the id is
routinely absent from the payload — the normal case for a live donation, not an
edge case. The worker falls back to `/v1/balance_transactions?source=…`, which
finds the record anyway, and throws (rather than skipping) if it genuinely is
not there yet, so Stripe retries. Treating null as "nothing to do" silently
skips every payment, which is what the first version of this worker did.

**No API version is pinned.** Stripe then uses the account's default, which is
also the version the webhook payload arrives in, so the request and the event
stay consistent. A hardcoded version is worse than none: a wrong string fails
every call outright, and the few fields read here have been stable for years.

**Refunds.** The platform is liable for refunds under the Connect agreement, so
a refund after a transfer would otherwise leave the platform absorbing the whole
amount having already paid out a share. `charge.refunded` reverses the
recipient's share proportionally.

**Disputes are not handled.** `charge.dispute.created` is ignored, so a
chargeback leaves the recipient's share paid out. Rare enough at donation size
to accept knowingly; add it to the switch if it ever happens.

**Currency.** The transfer uses the balance transaction's currency, which is the
account's settlement currency — so a donation in another currency still splits
correctly.

**`MAX_TRANSFER_MINOR`** is a sanity ceiling (default $500). A bug that computes
an absurd share fails loudly and stays visible in Stripe's webhook log rather
than quietly moving money. Raise it before taking a large commercial licence
payment through this path.

## Changing the split

`SHARE_BPS` in `wrangler.toml` — 3500 is 35%. §3 of the agreement requires both
authors to agree, so change it there as an amendment and here in the same breath,
or the two disagree and the document stops being the source of truth.
