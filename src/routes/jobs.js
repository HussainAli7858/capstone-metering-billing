import { Router } from "express";
import { runRollupJob } from "../jobs/rollupJob.js";
import { pool } from "../db/pool.js";

const router = Router();

router.post("/jobs/rollup/run", async (req, res) => {
  await runRollupJob();
  res.status(200).json({ triggered: true });
});

router.get("/jobs/runs", async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM job_runs ORDER BY started_at DESC LIMIT 20`
  );
  res.status(200).json(result.rows);
});

export default router;