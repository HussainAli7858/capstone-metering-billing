# Usage Metering & Billing Engine

A backend service that answers the three questions every SaaS product needs
answered: **how much has this customer used, what does it cost, and have
they hit their limit?**

Built for the FlyRank Internship Backend Track capstone — Node.js (ESM) +
Express 5 + PostgreSQL, with Stripe in test mode. $0 stack, no credit card.

## What it does

- **Idempotent metering** — `POST /generate` records a billable action
  exactly once per `idempotencyKey`, even if the same request is retried.
  Enforced at the database layer via `UNIQUE (tenant_id, idempotency_key)`
  on `usage_events`, not just application logic — a duplicate insert is
  caught and the original recorded result is returned instead of erroring.
- **Quota enforcement** — a request is allowed if
  `current_usage + requested <= limit`; the request that would push a
  tenant over its plan's monthly quota is rejected with a `429` (usage
  limit) that names the exact numbers involved. A lapsed/unpaid
  subscription is rejected separately with a `402`.
- **Cost calculation** — API call usage is covered by the flat monthly
  plan price. AI token usage is priced per category — fresh input, cached
  input (cheaper), and output (which reasoning tokens are folded into,
  not billed separately) — using pinned constants, always in integer
  cents.
- **Stripe subscription sync (test mode)** — `POST /billing/checkout`
  starts a Checkout session for a Free → Pro upgrade; `POST
  /webhooks/stripe` verifies the signature and deduplicates by Stripe
  event ID (tracked in `processed_webhook_events`) before updating the
  tenant's plan/status.
- **A real background job** — `monthly_usage_rollup` recomputes
  per-tenant usage/cost rollups off the request path, running on server
  boot and hourly via `src/jobs/scheduler.js`. Every run (success,
  failure, or interruption) is recorded in `job_runs` with status,
  attempt number, and timing — retried up to `MAX_ATTEMPTS` with backoff
  before a final failure is logged as an alert.

## Architecture

```
Client ── POST /generate ──────────► meterService.recordUsage()
                                        │
                                        │ 1. idempotency check
                                        │    (duplicate key? → return the
                                        │     ORIGINAL response, no new row)
                                        │ 2. subscription check
                                        │    (past_due/unpaid → 402)
                                        │ 3. quota check
                                        │    (current + requested <= limit ?
                                        │     allow : 429)
                                        │ 4. cost calculation
                                        │    (token pricing rules)
                                        │ 5. INSERT usage_events
                                        │    (UNIQUE tenant_id+idempotencyKey
                                        │     is the real safety net)
                                        ▼
                              201 { quantity, costCents, usage }

Client ── GET /usage/:tenantId ─────► rollup(usage_events) →
                                        { used, limit, costBreakdown }

Client ── POST /billing/checkout ───► Stripe Checkout Session (test mode)
                                        │
Stripe ── signed webhook ───────────► POST /webhooks/stripe
                                        │ 1. verify signature (forged → 400)
                                        │ 2. dedupe via
                                        │    processed_webhook_events
                                        │    (replay → no-op, 200)
                                        │ 3. update tenant plan/status
                                        ▼
                              tenant.plan flips free → pro

                    ┌───────────────────────────────────────┐
                    │  src/jobs/scheduler.js                  │
                    │  runs monthly_usage_rollup on boot +    │
                    │  hourly. src/jobs/rollupJob.js:         │
                    │  try attempt → success/fail → record    │
                    │  in job_runs (status, attempt, timing)  │
                    │  retries (MAX_ATTEMPTS, backoff),        │
                    │  logs ALERT on exhausted retries         │
                    └───────────────────────────────────────┘
                       inspected via: GET /jobs/runs
                       manually triggered via: POST /jobs/rollup/run
```

**Layers:** routes → services (metering, quota, cost, Stripe, rollups) →
`src/db` (schema + queries, no business logic). Validation happens at the
HTTP boundary before any service code runs, so bad input is always a clean
4xx, never a 500.

## Data model

- **plans** — seeded reference table: `free` and `pro`, each with an API
  call limit, AI token limit, and monthly price in cents.
- **tenants** — one row per customer org; current `plan_id`, Stripe
  customer/subscription IDs, subscription status.
- **usage_events** — the metering ledger. One row per billable action,
  tagged with an idempotency key. `UNIQUE (tenant_id, idempotency_key)` is
  what actually makes retries safe — enforced by Postgres, not just
  checked in code.
- **processed_webhook_events** — every Stripe event ID this service has
  handled. A replayed event ID is a no-op before any tenant mutation runs.
- **job_runs** — one row per background job execution: status (`running` /
  `succeeded` / `failed`), attempt number, error message, timing. An
  interrupted run (e.g. a dev-server restart mid-job) stays visible as
  `running` with `finished_at: null` rather than disappearing silently.

Schema lives in `src/db/schema.sql` and is loaded automatically into the
Postgres container on first boot via
`docker-entrypoint-initdb.d` (see `docker-compose.yml`) — there is no
separate migrate step to run.

## Plans

| Plan | API calls / month | AI tokens / month | Price |
|------|-------------------|--------------------|-------|
| Free | 1,000 | 100,000 | $0 |
| Pro  | 50,000 | 5,000,000 | $29.00/mo |

## AI token pricing (pinned constants)

| Category | Price per 1,000 tokens |
|---|---|
| Fresh input | 15¢ |
| Cached input | 3¢ (cheaper than fresh input) |
| Output (reasoning tokens are folded into this bucket, not billed separately) | 60¢ |

Worked example from `EVIDENCE.md`: 10,000 input + 5,000 cached input +
2,000 output + 1,000 reasoning tokens → `costCents: 345` (150¢ input +
15¢ cached + 180¢ output-and-reasoning). Confirmed both from the raw
`/generate` response and the `costBreakdown` on `GET /usage/:tenantId`.

## Setup (clean machine)

Requires: Node.js 18+, Docker.

```bash
git clone https://github.com/HussainAli7858/capstone-metering-billing.git
cd capstone-metering-billing
cp .env.example .env               # fill in your Stripe test keys — see below
npm install
docker compose up -d               # starts Postgres + auto-loads schema.sql
npm run seed                       # creates demo tenants, prints their ids
npm run dev                        # http://localhost:3000 (node --watch)
```

### Stripe test mode setup

1. Create a free [Stripe account](https://dashboard.stripe.com/register) —
   no card required for test mode.
2. Dashboard → Developers → API keys → copy the **test** secret and
   publishable keys into `.env` (`STRIPE_SECRET_KEY`,
   `STRIPE_PUBLISHABLE_KEY`).
3. Dashboard → Product catalog → create a recurring Price for the Pro plan
   → copy its `price_...` id into `STRIPE_PRICE_ID_PRO`.
4. Install the [Stripe CLI](https://stripe.com/docs/stripe-cli), then:
   ```bash
   stripe login
   stripe listen --forward-to localhost:3000/webhooks/stripe
   ```
   This prints a `whsec_...` value — put it in `STRIPE_WEBHOOK_SECRET`.
5. Test card: `4242 4242 4242 4242`, any future expiry, any CVC.

### Try it

```bash
# Record a billable API call (idempotent — same key = same result, no double count)
curl -X POST localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"<TENANT_ID>","usageType":"api_call","quantity":1,"idempotencyKey":"demo-1"}'

# Record AI token usage
curl -X POST localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"<TENANT_ID>","usageType":"ai_tokens","idempotencyKey":"demo-2","tokenBreakdown":{"inputTokens":10000,"cachedInputTokens":5000,"outputTokens":2000,"reasoningTokens":1000}}'

# Check usage + cost rollup
curl localhost:3000/usage/<TENANT_ID>

# Start a Pro upgrade via Stripe Checkout (test mode)
curl -X POST localhost:3000/billing/checkout \
  -H "Content-Type: application/json" -d '{"tenantId":"<TENANT_ID>"}'
# open the returned URL, pay with 4242 4242 4242 4242

# Replay a webhook event locally without clicking through Checkout
stripe trigger checkout.session.completed

# Inspect / manually trigger the background rollup job
curl -X POST localhost:3000/jobs/rollup/run
curl localhost:3000/jobs/runs
```

## Testing

`npm test` runs Node's built-in test runner. Most verification for this
capstone was done as live, manual acceptance testing against a running
server (Postman + curl + the Stripe CLI) rather than an automated suite —
see `EVIDENCE.md` for full transcripts of each probe, and
`src/db/testQuota.js` for the script used to drive a tenant to its exact
quota boundary.

## Known limitations

- No invoicing, proration, or usage-based overage billing — out of core
  scope per the brief. A request beyond quota is rejected outright
  (429/402), never billed at an overage rate.
- AI token counts are simulated inputs to `/generate`, not measured from a
  real model call — this is a metering exercise, not an AI integration one.
- The background job's retry-then-alert path (`MAX_ATTEMPTS` with backoff,
  final `ALERT` log) is implemented in `rollupJob.js` but has only been
  verified by code inspection, not by forcing a real failure — the job
  hasn't organically failed during development.
- One `job_runs` row is stuck at `status: "running"` with
  `finished_at: null` from a `node --watch` dev-server restart that
  interrupted a rollup mid-execution. Left as-is intentionally — it's
  evidence the job-tracking table surfaces an interrupted run rather than
  silently losing it, which is the visibility a failure-alerting design is
  supposed to provide.
- See `BUILDLOG.md` for an honest account of where AI assistance helped,
  where it introduced a real bug, and what was changed as a result.