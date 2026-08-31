# Design Doc — Usage Metering & Billing Engine

## Problem
SaaS tenants need their usage metered accurately, billed correctly, and blocked
honestly once they exceed their plan's quota. The system must survive network
retries and duplicate webhook deliveries without double-counting usage or
double-processing billing events.

## Data model
- **tenants** — one row per customer org. Tracks current plan, Stripe customer/
  subscription IDs, and subscription status.
- **plans** — seeded reference table: `free` and `pro`, each with an API call
  limit, AI token limit, and monthly price (in cents).
- **usage_events** — the metering ledger. One row per billable action, tagged
  with an idempotency key. `UNIQUE (tenant_id, idempotency_key)` makes retries
  safe at the database layer, not just the application layer.
- **processed_webhook_events** — records every Stripe event ID we've handled,
  so a replayed webhook is a no-op.

## API surface
- `POST /generate` — the dummy billable endpoint. Body: `{ tenantId, type,
  quantity, idempotencyKey, tokenBreakdown? }`. Checks quota, records usage,
  returns current usage + cost.
- `GET /usage/:tenantId` — rollup: used, limit, cost for the current month.
- `POST /billing/checkout` — creates a Stripe Checkout session for a tenant
  upgrading to Pro.
- `POST /webhooks/stripe` — receives and verifies Stripe webhook events,
  updates tenant plan/status.

## Idempotency strategy
Every billable request carries a client-supplied `idempotencyKey`. The
`usage_events` table enforces `UNIQUE (tenant_id, idempotency_key)` at the
database level. On a duplicate key, the insert is caught and the service
returns the **original** recorded event's result rather than erroring —
so retries are transparent to the caller.

## Non-goal
This system does not implement proration, invoicing, or overage billing.
A request beyond quota is rejected outright (429/402); it is not billed
at an overage rate. These are documented stretch goals, not core scope.