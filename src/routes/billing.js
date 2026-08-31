import { Router } from "express";
import { pool } from "../db/pool.js";
import { createCheckoutSession } from "../services/stripeService.js";

const router = Router();

router.post("/billing/checkout", async (req, res) => {
  const { tenantId } = req.body;

  if (!tenantId) {
    return res.status(400).json({ error: "tenantId is required." });
  }

  try {
    const tenantResult = await pool.query(
      `SELECT id, name, stripe_customer_id FROM tenants WHERE id = $1`,
      [tenantId]
    );

    if (tenantResult.rows.length === 0) {
      return res.status(404).json({ error: "Tenant not found." });
    }

    const tenant = tenantResult.rows[0];

    const { session, stripeCustomerId } = await createCheckoutSession({
      tenant,
      successUrl: "http://localhost:3000/billing/success",
      cancelUrl: "http://localhost:3000/billing/cancel",
    });

    await pool.query(
      `UPDATE tenants SET stripe_customer_id = $1 WHERE id = $2`,
      [stripeCustomerId, tenantId]
    );

    return res.status(200).json({ checkoutUrl: session.url });
  } catch (err) {
    console.error("Error in POST /billing/checkout:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

export default router;