## Requirement: Quota boundary — 429 at exact limit

Tenant `42bb2240-2985-430f-bd67-7d68b72c5ee4` (Free plan, 1,000 API call limit),
driven via `node src/db/testQuota.js <tenantId>`:

**Call 1 — bring usage to 999/1000:**
- Status: 201
- `quantity: 999`, `costCents: 500`

**Call 2 — request that brings usage to exactly 1000/1000:**
- Status: 201 (ALLOWED — boundary is inclusive: current + requested <= limit)
- `quantity: 1`, `costCents: 1`

**Call 3 — request that would bring usage to 1001/1000:**
- Status: 429
- Response: `"error": "API call quota exceeded: 1000/1000 used this month. This
  request would bring it to 1001."`

**Rule demonstrated:** a request is allowed if `current_usage + requested <= limit`.
At exactly 1,000/1,000 the tenant is still within quota; the request that would
push past it is rejected with a clear, machine-readable reason. Quota enforcement
sums *all* usage events for the tenant (cumulative, not per-session), confirmed
by an earlier run against a tenant with pre-existing usage, where the rejection
correctly accounted for prior history.

## Requirement: Webhook security — forged signature rejected, replay deduplicated

**Forged signature test:**
Sent `POST /webhooks/stripe` directly via Postman with a fabricated
`Stripe-Signature` header and arbitrary JSON body.
- Response: `400 { "error": "Invalid signature." }`
- Confirmed via server log: "Webhook signature verification failed:
  No signatures found matching the expected signature for payload."

**Replay deduplication test:**
Triggered a real `checkout.session.completed` event (`evt_1UAWEkGSQBPHm7VxhnSLGKcR`)
via `stripe trigger`, then explicitly replayed the identical event ID via
`stripe events resend evt_1UAWEkGSQBPHm7VxhnSLGKcR`.
- `stripe listen` terminal shows the event forwarded a second time,
  server responded `200`.
- Server logs show NO second "upgraded to Pro" or processing log for
  this event ID on replay — confirmed via the `processed_webhook_events`
  table check in the webhook handler, which short-circuits on a known
  `stripe_event_id` before any tenant mutation runs.

  ## Requirement: Cost calculation — token pricing rules

Sent `POST /generate` with a known token mix:
- inputTokens: 10,000 → 150¢ (@ 15¢/1000)
- cachedInputTokens: 5,000 → 15¢ (@ 3¢/1000, cheaper than fresh input)
- outputTokens: 2,000 + reasoningTokens: 1,000 = 3,000 billed as output → 180¢ (@ 60¢/1000)
- **Expected total: 345¢**

Response from `/generate`: `"costCents": 345` ✅

Confirmed via `GET /usage/:tenantId`:
```json
"costBreakdown": {
    "apiCallCostCents": 0,
    "aiTokenCostCents": 345,
    "totalCents": 345,
    "breakdown": {
        "inputCost": 150,
        "cachedInputCost": 15,
        "outputCost": 180,
        "totalCents": 345
    }
}
```
Confirms: reasoning tokens are correctly folded into output pricing, cached
input tokens are billed at the cheaper rate, and categories are priced
separately rather than summed at a single rate.