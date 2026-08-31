import { pool } from "../db/pool.js";

/**
 * Records a usage event exactly once per (tenantId, idempotencyKey).
 * If the same idempotencyKey is sent again, returns the ORIGINAL event
 * instead of inserting a duplicate or throwing an error to the caller.
 */
export async function recordUsage({
  tenantId,
  usageType,
  quantity,
  idempotencyKey,
  tokenBreakdown = {},
}) {
  const {
    inputTokens = 0,
    cachedInputTokens = 0,
    outputTokens = 0,
    reasoningTokens = 0,
  } = tokenBreakdown;

  const client = await pool.connect();
  try {
    // Try the insert first — the UNIQUE constraint is our real safety net.
    const insertResult = await client.query(
      `INSERT INTO usage_events
         (tenant_id, usage_type, quantity, input_tokens, cached_input_tokens,
          output_tokens, reasoning_tokens, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
       RETURNING *`,
      [
        tenantId,
        usageType,
        quantity,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningTokens,
        idempotencyKey,
      ]
    );

    if (insertResult.rows.length > 0) {
      // Fresh event — this is the first time we've seen this key.
      return { event: insertResult.rows[0], wasDuplicate: false };
    }

    // No row inserted → the idempotency key already existed.
    // Fetch and return the ORIGINAL event so the caller sees the same
    // result they got the first time, not an error.
    const existing = await client.query(
      `SELECT * FROM usage_events
       WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, idempotencyKey]
    );

    return { event: existing.rows[0], wasDuplicate: true };
  } finally {
    client.release();
  }
}

/**
 * Sums usage for a tenant for the current calendar month, split by type.
 */
export async function getMonthlyUsage(tenantId) {
  const result = await pool.query(
    `SELECT
       usage_type,
       COALESCE(SUM(quantity), 0)::int AS total_quantity,
       COALESCE(SUM(input_tokens), 0)::int AS total_input_tokens,
       COALESCE(SUM(cached_input_tokens), 0)::int AS total_cached_input_tokens,
       COALESCE(SUM(output_tokens), 0)::int AS total_output_tokens,
       COALESCE(SUM(reasoning_tokens), 0)::int AS total_reasoning_tokens
     FROM usage_events
     WHERE tenant_id = $1
       AND created_at >= date_trunc('month', now())
     GROUP BY usage_type`,
    [tenantId]
  );

  const usage = {
    api_call: { total_quantity: 0 },
    ai_tokens: {
      total_quantity: 0,
      total_input_tokens: 0,
      total_cached_input_tokens: 0,
      total_output_tokens: 0,
      total_reasoning_tokens: 0,
    },
  };

  for (const row of result.rows) {
    usage[row.usage_type] = row;
  }

  return usage;
}