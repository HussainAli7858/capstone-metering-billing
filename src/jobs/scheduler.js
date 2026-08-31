import { runRollupJob } from "./rollupJob.js";

const ROLLUP_INTERVAL_MS = 60 * 60 * 1000;

export function startScheduler() {
  console.log("[scheduler] Starting background job scheduler.");
  runRollupJob();
  setInterval(runRollupJob, ROLLUP_INTERVAL_MS);
}