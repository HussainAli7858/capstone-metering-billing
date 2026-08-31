import { pool } from "../db/pool.js";
import { getMonthlyUsage } from "../services/meterService.js";
import { calculateMonthlyCost } from "../services/costService.js";

const MAX_ATTEMPTS = 3;

export async function runRollupJob() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const jobRun = await pool.query(
      `INSERT INTO job_runs (job_name, status, attempt)
       VALUES ('monthly_usage_rollup', 'running', $1)
       RETURNING id`,
      [attempt]
    );
    const jobRunId = jobRun.rows[0].id;

    try {
      await computeAllTenantRollups();

      await pool.query(
        `UPDATE job_runs SET status = 'succeeded', finished_at = now() WHERE id = $1`,
        [jobRunId]
      );

      console.log(`[rollupJob] Succeeded on attempt ${attempt}.`);
      return; 
    } catch (err) {
      console.error(`[rollupJob] Attempt ${attempt} failed:`, err.message);

      await pool.query(
        `UPDATE job_runs
         SET status = 'failed', error_message = $1, finished_at = now()
         WHERE id = $2`,
        [err.message, jobRunId]
      );

      if (attempt === MAX_ATTEMPTS) {
    
        console.error(
          `[rollupJob] ALERT: failed all ${MAX_ATTEMPTS} attempts. Manual investigation needed.`
        );
      } else {
        await sleep(1000 * attempt);
      }
    }
  }
}

async function computeAllTenantRollups() {
  const periodStart = new Date();
  periodStart.setDate(1);
  periodStart.setHours(0, 0, 0, 0);

  const tenants = await pool.query(`SELECT id FROM tenants`);

  for (const tenant of tenants.rows) {
    const usage = await getMonthlyUsage(tenant.id);
    const cost = calculateMonthlyCost(usage);

    await pool.query(
      `INSERT INTO usage_rollups
         (tenant_id, period_start, api_calls_used, ai_tokens_used, total_cost_cents)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, period_start)
       DO UPDATE SET
         api_calls_used = EXCLUDED.api_calls_used,
         ai_tokens_used = EXCLUDED.ai_tokens_used,
         total_cost_cents = EXCLUDED.total_cost_cents,
         computed_at = now()`,
      [
        tenant.id,
        periodStart,
        usage.api_call.total_quantity,
        usage.ai_tokens.total_quantity,
        cost.totalCents,
      ]
    );
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}