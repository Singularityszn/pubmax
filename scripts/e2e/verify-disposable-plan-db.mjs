/** Confirm the private Plan database is ready for listed-price browser tests. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { startDisposablePlanDb } from "./disposable-plan-db.mjs";

const db = await startDisposablePlanDb();
try {
  const stops = await fetch(
    `${db.restBaseUrl}/plan_stops?select=venue_id,selected_drink_price_evidence&limit=1`,
    { headers: { Authorization: `Bearer ${db.serviceRoleKey}` } },
  );
  assert.equal(stops.status, 200);
  assert.deepEqual(await stops.json(), []);
  assert.equal(db.sql("select count(*) from public.community_prices").out, String(db.fixtures.length * 2));
  assert.equal(db.sql("select count(*) from pg_constraint where conname = 'plan_stops_selected_drink_price_evidence_check'").out, "1");
  for (const count of [1, 2]) {
    const planId = randomUUID();
    const memberId = randomUUID();
    const proposalId = randomUUID();
    const tokenHash = String(count).repeat(64);
    const route = Array.from({ length: 3 }, (_, position) => ({
      venueId: `fixture-stop-${position}`, venueName: `Fixture stop ${position}`,
    }));
    const shortRoute = route.slice(0, count);
    const proposedRoute = shortRoute.map((stop, position) => ({ ...stop, position }));
    const create = db.sql(`select public.create_plan_idempotent_atomic(
      '${planId}'::uuid, 'Disposable short route', '2026-10-02T19:00:00Z', '${JSON.stringify(route)}'::jsonb,
      '${memberId}'::uuid, 'Fixture host', '${tokenHash}', '2026-10-02T12:00:00Z',
      '${tokenHash}', '${tokenHash}', null, null, null)`);
    assert.equal(create.ok, true);
    assert.equal(create.out, "created");
    const replace = db.sql(`select public.replace_plan_route_atomic(
      '${planId}'::uuid, '${tokenHash}', 1, '${JSON.stringify(shortRoute)}'::jsonb, null, false)`);
    assert.equal(replace.ok, true);
    assert.equal(replace.out, "ok", `Disposable fixture must support ${count}-stop saved edits`);
    assert.equal(db.sql(`select count(*) from public.plan_stops where plan_id = '${planId}'`).out, String(count));
    const proposal = db.sql(`insert into public.plan_route_proposals
      (id, plan_id, proposed_by_member_id, expected_route_revision, stops, reason,
       resolved_constraint_ids, unresolved_constraint_ids, status, idempotency_key, created_at)
      values ('${proposalId}'::uuid, '${planId}'::uuid, '${memberId}'::uuid, 2,
        '${JSON.stringify(proposedRoute)}'::jsonb, 'Keep the shorter route', '[]'::jsonb, '[]'::jsonb,
        'pending', 'fixture-proposal-${count}', '2026-10-02T12:10:00Z')`);
    assert.equal(proposal.ok, true);
    const decision = db.sql(`select public.decide_plan_route_proposal_atomic(
      '${planId}'::uuid, '${proposalId}'::uuid, '${tokenHash}', 'accepted',
      'fixture-decision-${count}', '2026-10-02T12:20:00Z')`);
    assert.equal(decision.ok, true);
    assert.equal(decision.out, "decided", `Disposable fixture must accept ${count}-stop proposals`);
    assert.equal(db.sql(`select route_revision from public.plans where id = '${planId}'`).out, "3");
    assert.equal(db.sql(`select count(*) from public.plan_stops where plan_id = '${planId}'`).out, String(count));
  }
  console.log(`Disposable Plan PostgREST ready through ${db.lastMigration} with corroborated local fixture prices`);
} finally {
  await db.stop();
}
