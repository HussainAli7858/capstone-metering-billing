-- Tenants: one row per customer organization
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    subscription_status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Plans: quota definitions (seeded, not user-editable at runtime)
CREATE TABLE IF NOT EXISTS plans (
    name TEXT PRIMARY KEY,
    api_call_limit INTEGER NOT NULL,
    ai_token_limit INTEGER NOT NULL,
    monthly_price_cents INTEGER NOT NULL
);

-- Usage events: the core metering ledger
CREATE TABLE IF NOT EXISTS usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    usage_type TEXT NOT NULL CHECK (usage_type IN ('api_call', 'ai_tokens')),
    quantity INTEGER NOT NULL,
    -- token breakdown, only populated when usage_type = 'ai_tokens'
    input_tokens INTEGER DEFAULT 0,
    cached_input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    reasoning_tokens INTEGER DEFAULT 0,
    idempotency_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- same tenant + same idempotency key can only ever insert once
    UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_created
    ON usage_events (tenant_id, created_at);

-- Processed Stripe webhook events, for replay-safety
CREATE TABLE IF NOT EXISTS processed_webhook_events (
    stripe_event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS usage_rollups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    period_start TIMESTAMPTZ NOT NULL,
    api_calls_used INTEGER NOT NULL DEFAULT 0,
    ai_tokens_used INTEGER NOT NULL DEFAULT 0,
    total_cost_cents INTEGER NOT NULL DEFAULT 0,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, period_start)
);

CREATE TABLE IF NOT EXISTS job_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
    attempt INTEGER NOT NULL DEFAULT 1,
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);

-- Seed the two plans
INSERT INTO plans (name, api_call_limit, ai_token_limit, monthly_price_cents)
VALUES
    ('free', 1000, 100000, 0),
    ('pro', 50000, 5000000, 2900)
ON CONFLICT (name) DO NOTHING;