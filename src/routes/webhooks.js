import { Router } from "express";
import express from "express";
import { pool } from "../db/pool.js";
import { stripe } from "../services/stripeService.js";
import dotenv from "dotenv";

dotenv.config();

const router = Router();

router.post(
  "/webhooks/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
  
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).json({ error: "Invalid signature." });
    }

    const existing = await pool.query(
      `SELECT stripe_event_id FROM processed_webhook_events WHERE stripe_event_id = $1`,
      [event.id]
    );

    if (existing.rows.length > 0) {
      
      return res.status(200).json({ received: true, duplicate: true });
    }

    try {
      await handleStripeEvent(event);

      await pool.query(
        `INSERT INTO processed_webhook_events (stripe_event_id, event_type)
         VALUES ($1, $2)`,
        [event.id, event.type]
      );

      return res.status(200).json({ received: true });
    } catch (err) {
      console.error(`Error handling webhook event ${event.type}:`, err);
      
      return res.status(500).json({ error: "Webhook handler failed." });
    }
  }
);

async function handleStripeEvent(event) {
  switch (event.type) {
    case "checkout.session.completed": {
    const session = event.data.object;
    const tenantId = session.metadata?.tenantId;

    if (!tenantId) {
        
        console.warn(
        `checkout.session.completed received with no tenantId in metadata (event ${event.id}). Skipping.`
        );
        break;
    }

    const result = await pool.query(
        `UPDATE tenants
        SET plan = 'pro',
            subscription_status = 'active',
            stripe_subscription_id = $1
        WHERE id = $2`,
        [session.subscription, tenantId]
    );

    if (result.rowCount === 0) {
        console.warn(`checkout.session.completed for unknown tenant ${tenantId}.`);
    } else {
        console.log(`Tenant ${tenantId} upgraded to Pro via Checkout.`);
    }
    break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object;
      const status = subscription.status; 

      await pool.query(
        `UPDATE tenants
         SET subscription_status = $1
         WHERE stripe_subscription_id = $2`,
        [status, subscription.id]
      );
      console.log(`Subscription ${subscription.id} status -> ${status}`);
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;

      await pool.query(
        `UPDATE tenants
         SET plan = 'free',
             subscription_status = 'canceled',
             stripe_subscription_id = NULL
         WHERE stripe_subscription_id = $1`,
        [subscription.id]
      );
      console.log(`Subscription ${subscription.id} canceled -> tenant reverted to Free.`);
      break;
    }

    default:
      console.log(`Ignoring unhandled event type: ${event.type}`);
  }
}

export default router;