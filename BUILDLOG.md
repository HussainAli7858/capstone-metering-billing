# Build Log — AI Usage

This capstone was built with AI assistance (Claude) throughout. This is
an honest account of where AI helped, where it fell short, and what I
changed or debugged myself.

## Where AI helped

- **Scaffolding**: the initial project structure (Express app, routes,
  services, Docker/Postgres setup, Stripe integration) was AI-generated
  based on the capstone brief. I reviewed, ran, and tested every piece
  myself against a live server and a real Stripe sandbox account before
  accepting it as working.
- **Idempotency pattern**: the `UNIQUE (tenant_id, idempotency_key)` +
  `ON CONFLICT DO NOTHING` + fallback SELECT pattern in
  `meterService.js` was AI-suggested. I can explain why it's correct:
  the database constraint is the real safety net against duplicate
  usage events, not application-level checking, which matters under
  concurrent retries.
- **Stripe webhook boilerplate**: signature verification, raw-body
  middleware ordering, and the checkout/subscription event handlers
  were AI-drafted from Stripe's documented patterns. I did not trust
  this blindly — I set up a real Stripe sandbox account, ran the full
  Checkout flow with a test card, watched `stripe listen` forward real
  webhook events, and confirmed the tenant's plan actually flipped in
  the database.
- **Debugging environment issues**: AI helped diagnose problems I hit
  along the way — a missing `node_modules` after a bad install,
  PowerShell not supporting `<` file redirection (had to use
  `Get-Content | docker exec -i ...` instead), and Stripe not
  supporting Pakistan as an account country during signup.

## A real bug I caught and had fixed

Running `stripe trigger checkout.session.completed` (a Stripe CLI
command that generates a fixture event) exposed a real issue: the
webhook handler's `checkout.session.completed` case blindly ran an
UPDATE using `session.metadata?.tenantId` without checking whether that
value existed. The fixture event has no metadata, so the server logged
`"Tenant undefined upgraded to Pro via Checkout."` even though nothing
real happened. I caught this by actually running the trigger and
reading server log output carefully, then asked for a fix. The
corrected handler checks for a missing `tenantId` and checks
`result.rowCount` after the UPDATE, logging a warning instead of a
false success — I re-ran the same trigger afterward and confirmed the
fix worked (see EVIDENCE.md).

## What I understand and can explain

I can walk through and explain any part of this codebase, including:
- Why the idempotency key is enforced at the database level, not just
  checked in application code before insert.
- Why the quota boundary check is `current + requested <= limit`
  (inclusive) — a request landing exactly on the limit is allowed, the
  next one is rejected.
- Why reasoning tokens are priced as output tokens rather than as a
  separate category, and why cached input tokens get their own
  (cheaper) rate instead of being lumped in with fresh input tokens.
- Why the webhook route needs `express.raw()` and must be mounted
  before `express.json()` in `app.js` — otherwise Stripe's signature
  verification fails because the raw body has already been consumed
  and reserialized by the JSON parser.
- Why the background job records every run (including interrupted
  ones) in `job_runs`, rather than only logging on success.

## Honest limitations

- Retry logic in `rollupJob.js` (3 attempts with backoff) is
  implemented but I haven't forced a real failure to exercise the
  retry path end-to-end — verified by code inspection rather than a
  live failure test.
- No automated test suite; all verification was done manually against
  a running server, with Postman requests and terminal output captured
  in EVIDENCE.md.
- README.md was written by me directly, using AI guidance on structure
  and required content rather than AI-generated text.