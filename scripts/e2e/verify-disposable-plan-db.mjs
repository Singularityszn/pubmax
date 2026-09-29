/** Confirm the private Plan database is ready for listed-price browser tests. */
import assert from "node:assert/strict";

import { startDisposablePlanDb } from "./disposable-plan-db.mjs";

const db = await startDisposablePlanDb();
try {
  const stops = await fetch(
    `${db.restBaseUrl}/plan_stops?select=venue_id,selected_drink_price_evidence&limit=1`,
    { headers: { Authorization: `Bearer ${db.serviceRoleKey}` } },
  );
  assert.equal(stops.status, 200);
  assert.deepEqual(await stops.json(), []);
  assert.equal(db.sql("select count(*) from public.community_prices").out, "0");
  assert.equal(db.sql("select count(*) from pg_constraint where conname = 'plan_stops_selected_drink_price_evidence_check'").out, "1");
  console.log("Disposable Plan PostgREST ready with migration 0168 and no seeded prices");
} finally {
  await db.stop();
}
