import express from "express";
import dotenv from "dotenv";
import generateRoutes from "./routes/generate.js";
import usageRoutes from "./routes/usage.js";
import billingRoutes from "./routes/billing.js";
import webhookRoutes from "./routes/webhooks.js";

dotenv.config();

const app = express();

app.use(webhookRoutes);

app.use(express.json());

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use(generateRoutes);
app.use(usageRoutes);
app.use(billingRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Billing engine listening on http://localhost:${PORT}`);
});