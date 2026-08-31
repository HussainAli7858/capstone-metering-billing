import { Router } from "express";
import { pool } from "../db/pool.js";
import { getMonthlyUsage } from "../services/meterService.js";
import { calculateMonthlyCost } from "../services/costService.js";

const router = Router();

router.get("/usage/:tenantId", async (req, res) => {
  const { tenantId } = req.params;

  try {
    const tenantResult = await pool.query(
      `SELECT t.plan, p.api_call_limit, p.ai_token_limit
       FROM tenants t
       JOIN plans p ON p.name = t.plan
       WHERE t.id = $1`,
      [tenantId]
    );

    if (tenantResult.rows.length === 0) {
      return res.status(404).json({ error: "Tenant not found." });
    }

    const { plan, api_call_limit, ai_token_limit } = tenantResult.rows[0];
    const usage = await getMonthlyUsage(tenantId);
    const cost = calculateMonthlyCost(usage);

    return res.status(200).json({
      tenantId,
      plan,
      apiCalls: {
        used: usage.api_call.total_quantity,
        limit: api_call_limit,
      },
      aiTokens: {
        used: usage.ai_tokens.total_quantity,
        limit: ai_token_limit,
        breakdown: {
          input: usage.ai_tokens.total_input_tokens,
          cachedInput: usage.ai_tokens.total_cached_input_tokens,
          output: usage.ai_tokens.total_output_tokens,
          reasoning: usage.ai_tokens.total_reasoning_tokens,
        },
      },
      costCents: cost.totalCents,
      costBreakdown: cost,
    });
  } catch (err) {
    console.error("Error in GET /usage/:tenantId:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

export default router;