import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const migrations = join(process.cwd(), "supabase/migrations");
const name = "20260929160000_0165_plan_completion_selected_drink_evidence.sql";
const forward = join(migrations, name);
const rollback = join(migrations, "rollback/20260929160000_0165_plan_completion_selected_drink_evidence_rollback.sql");
const prerequisites = readdirSync(migrations)
  .filter((entry) => entry.endsWith(".sql") && entry < name)
  .sort()
  .map((entry) => join(migrations, entry));
const wine = { category: "wine", pence: 550, serving: null, source: "community", reportedAt: "2026-09-25T12:00:00.000Z" };
const cocktail = { category: "cocktail", pence: 850, serving: null, source: "community", reportedAt: "2026-09-26T12:00:00.000Z" };
const stops = JSON.stringify([
  { venueId: "venue-a", venueName: "A", selectedDrinkPriceEvidence: wine },
  { venueId: "venue-b", venueName: "B", selectedDrinkPriceEvidence: cocktail },
  { venueId: "venue-c", venueName: "C" },
]);

let session: PostgresSession | null = null;
function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL session unavailable");
  return session;
}
function id(prefix: string, suffix: string): string {
  return `${prefix}0000000-0000-4000-8000-00000000000${suffix}`;
}
function createAndComplete(suffix: string): Array<Record<string, unknown>> {
  const plan = id("1", suffix);
  const member = id("2", suffix);
  const token = suffix.repeat(64);
  expect(db().sql(`select public.create_plan_idempotent_atomic(
    '${plan}'::uuid, 'Wine and cocktails', '2026-09-30T19:00:00Z', '${stops}'::jsonb,
    '${member}'::uuid, 'Host', '${token}', '2026-09-29T12:00:00Z',
    '${token}', '${token}', null, null, null)`)).toBe("created");
  db().sql(`insert into public.plan_actions (id, plan_id, actor_member_id, type, stop_position, created_at)
    values ('${id("3", suffix)}'::uuid, '${plan}'::uuid, '${member}'::uuid, 'arrived', 0, '2026-09-29T12:10:00Z')`);
  expect(db().sql(`select public.complete_plan_atomic(
    '${plan}'::uuid, '${token}', 1, '${id("4", suffix)}'::uuid, '${id("5", suffix)}'::uuid,
    'get_home', null, '{"kind":"get_home","optionId":"transport:nearest-station","evidenceSnapshot":{"label":"Station"}}'::jsonb,
    '2026-09-29T13:00:00Z')`)).toBe("completed");
  return JSON.parse(db().sql(`select route_snapshot::text from public.plan_completions where plan_id = '${plan}'`));
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "plan-evidence-completion-0165", database: "pubmax_plan_evidence_completion" });
  try {
    db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const path of prerequisites) db().applyFile(path);
  } catch (error) {
    await session.stop();
    session = null;
    throw error;
  }
}, 600_000);

afterAll(async () => {
  await session?.stop();
  session = null;
});

describe.skipIf(skipReason !== null)("0165 Plan completion evidence", () => {
  it("reproduces the completion RPC omitting saved evidence", () => {
    const snapshot = createAndComplete("1");
    expect(snapshot.map((stop) => stop.selectedDrinkPriceEvidence)).toEqual([undefined, undefined, undefined]);
  });

  it("captures wine and cocktail evidence as immutable completion history", () => {
    db().applyFile(forward);
    const snapshot = createAndComplete("2");
    expect(snapshot.map((stop) => stop.selectedDrinkPriceEvidence)).toEqual([wine, cocktail, undefined]);
    db().sql(`update public.plan_stops set selected_drink_price_evidence = null
      where plan_id = '${id("1", "2")}'`);
    expect(JSON.parse(db().sql(`select route_snapshot::text from public.plan_completions
      where plan_id = '${id("1", "2")}'`))).toEqual(snapshot);
  });

  it("rollback restores prior completion writes without erasing saved history", () => {
    db().applyFile(rollback);
    const snapshot = createAndComplete("3");
    expect(snapshot.map((stop) => stop.selectedDrinkPriceEvidence)).toEqual([undefined, undefined, undefined]);
    const prior = JSON.parse(db().sql(`select route_snapshot::text from public.plan_completions
      where plan_id = '${id("1", "2")}'`)) as Array<Record<string, unknown>>;
    expect(prior.map((stop) => stop.selectedDrinkPriceEvidence)).toEqual([wine, cocktail, undefined]);
  });
});
