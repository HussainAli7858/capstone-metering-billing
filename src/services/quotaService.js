import { pool } from "../db/pool.js";
import { getMonthlyUsage } from "./meterService.js";

/**
 * Checks whether a tenant can perform a billable action of a given
 * type and quantity, without exceeding their plan's quota.
 *
 * Returns { allowed: true } or
 *         { allowed: false, statusCode, reason }
 */
export async function checkQuota({ tenantId, usageType, quantity }) {
  const tenantResult = await pool.query(
    `SELECT plan, subscription_status FROM tenants WHERE id = $1`,
    [tenantId]
  );

  if (tenantResult.rows.length === 0) {
    return { allowed: false, statusCode: 404, reason: "Tenant not found." };
  }

  const { plan, subscription_status } = tenantResult.rows[0];

  // A lapsed/unpaid subscription blocks access outright — this is the
  // 402 case, distinct from "you used up your quota" (429).
  if (subscription_status !== "active") {
    return {
      allowed: false,
      statusCode: 402,
      reason: `Subscription status is '${subscription_status}'. Payment required to continue.`,
    };
  }

  const planResult = await pool.query(
    `SELECT api_call_limit, ai_token_limit FROM plans WHERE name = $1`,
    [plan]
  );
  const { api_call_limit, ai_token_limit } = planResult.rows[0];

  const usage = await getMonthlyUsage(tenantId);

  if (usageType === "api_call") {
    const currentUsed = usage.api_call.total_quantity;
    const projected = currentUsed + quantity;

    if (projected > api_call_limit) {
      return {
        allowed: false,
        statusCode: 429,
        reason: `API call quota exceeded: ${currentUsed}/${api_call_limit} used this month. This request would bring it to ${projected}.`,
      };
    }
  }

  if (usageType === "ai_tokens") {
    const currentUsed = usage.ai_tokens.total_quantity;
    const projected = currentUsed + quantity;

    if (projected > ai_token_limit) {
      return {
        allowed: false,
        statusCode: 429,
        reason: `AI token quota exceeded: ${currentUsed}/${ai_token_limit} used this month. This request would bring it to ${projected}.`,
      };
    }
  }

  return { allowed: true };
}