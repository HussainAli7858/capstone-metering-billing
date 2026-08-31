import { Router } from "express";
import { recordUsage } from "../services/meterService.js";
import { checkQuota } from "../services/quotaService.js";
import {
  calculateApiCallCost,
  calculateAiTokenCost,
} from "../services/costService.js";

const router = Router();

router.post("/generate", async (req, res) => {
  const { tenantId, usageType, quantity, idempotencyKey, tokenBreakdown } =
    req.body;

  if (!tenantId || !usageType || !quantity || !idempotencyKey) {
    return res.status(400).json({
      error:
        "tenantId, usageType, quantity, and idempotencyKey are all required.",
    });
  }
  if (!["api_call", "ai_tokens"].includes(usageType)) {
    return res.status(400).json({
      error: "usageType must be 'api_call' or 'ai_tokens'.",
    });
  }
  if (typeof quantity !== "number" || quantity <= 0) {
    return res.status(400).json({
      error: "quantity must be a positive number.",
    });
  }

  try {
    const quotaCheck = await checkQuota({ tenantId, usageType, quantity });

    if (!quotaCheck.allowed) {
      return res.status(quotaCheck.statusCode).json({
        error: quotaCheck.reason,
      });
    }

    const { event, wasDuplicate } = await recordUsage({
      tenantId,
      usageType,
      quantity,
      idempotencyKey,
      tokenBreakdown,
    });

    const cost =
      usageType === "api_call"
        ? { totalCents: calculateApiCallCost(quantity) }
        : calculateAiTokenCost({
            inputTokens: tokenBreakdown?.inputTokens ?? 0,
            cachedInputTokens: tokenBreakdown?.cachedInputTokens ?? 0,
            outputTokens: tokenBreakdown?.outputTokens ?? 0,
            reasoningTokens: tokenBreakdown?.reasoningTokens ?? 0,
          });

    return res.status(wasDuplicate ? 200 : 201).json({
      wasDuplicate,
      event,
      costCents: cost.totalCents,
    });
  } catch (err) {
    console.error("Error in POST /generate:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

export default router;