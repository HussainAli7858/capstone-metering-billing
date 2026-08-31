const tenantId = process.argv[2];
if (!tenantId) {
  console.error("Usage: node src/db/testQuota.js <tenantId>");
  process.exit(1);
}

const BASE_URL = "http://localhost:3000";

async function callGenerate(qty, key) {
  const res = await fetch(`${BASE_URL}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenantId,
      usageType: "api_call",
      quantity: qty,
      idempotencyKey: key,
    }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function run() {

  const r1 = await callGenerate(999, "boundary-bulk-1");
  console.log("Bring to 999/1000:", r1.status, r1.body);

  const r2 = await callGenerate(1, "boundary-exact-1000");
  console.log("Request to hit exactly 1000:", r2.status, r2.body);

  const r3 = await callGenerate(1, "boundary-over-1001");
  console.log("Request that exceeds limit:", r3.status, r3.body);
}

run();