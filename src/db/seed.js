import { pool } from "./pool.js";

async function seed() {
  const result = await pool.query(
    `INSERT INTO tenants (name, plan)
     VALUES ($1, $2)
     RETURNING id, name, plan`,
    ["Acme Test Co", "free"]
  );

  console.log("Seeded tenant:");
  console.log(result.rows[0]);

  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});