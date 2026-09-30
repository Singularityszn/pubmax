import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const migrations = join(process.cwd(), "supabase/migrations");
const name = "20260929140000_0163_plan_replace_selected_drink_evidence.sql";
const forward = join(migrations, name);
const rollback = join(migrations, "rollback/20260929140000_0163_plan_replace_selected_drink_evidence_rollback.sql");
const prerequisites = readdirSync(migrations)
  .filter((entry) => entry.endsWith(".sql") && entry < name)
  .sort()
  .map((entry) => join(migrations, entry));
const wine = { category: "wine", pence: 550, serving: null, source: "community", reportedAt: "2026-09-25T12:00:00.000Z" };
const stops = JSON.stringify([
  { venueId: "venue-a", venueName: "A" },
  { venueId: "venue-b", venueName: "B", selectedDrinkPriceEvidence: wine },
  { venueId: "venue-c", venueName: "C" },
]);

let session: PostgresSession | null = null;
function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL session unavailable");
  return session;
}
function planId(suffix: string): string {
  return `10000000-0000-4000-8000-00000000000${suffix}`;
}
function create(suffix: string): void {
  expect(db().sql(`select public.create_plan_idempotent_atomic(
    '${planId(suffix)}'::uuid, 'Route', '2026-09-30T19:00:00Z',
    '[{"venueId":"venue-x","venueName":"X"},{"venueId":"venue-y","venueName":"Y"},{"venueId":"venue-z","venueName":"Z"}]'::jsonb,
    '20000000-0000-4000-8000-00000000000${suffix}'::uuid, 'Host', '${suffix.repeat(64)}',
    '2026-09-29T12:00:00Z', '${suffix.repeat(64)}', '${suffix.repeat(64)}', null, null, null)`)).toBe("created");
}
function replace(suffix: string): string {
  return db().sql(`select public.replace_plan_route_atomic(
    '${planId(suffix)}'::uuid, '${suffix.repeat(64)}', 1, '${stops}'::jsonb, null, false)`);
}
function saved(suffix: string): Array<unknown> {
  return JSON.parse(db().sql(`select jsonb_agg(selected_drink_price_evidence order by position)::text
    from public.plan_stops where plan_id = '${planId(suffix)}'`));
}
function executeGrants(): string {
  return db().sql(`select has_function_privilege('anon',
    'public.replace_plan_route_atomic(uuid,text,integer,jsonb,jsonb,boolean)', 'execute')::text || ':' ||
    has_function_privilege('authenticated',
    'public.replace_plan_route_atomic(uuid,text,integer,jsonb,jsonb,boolean)', 'execute')::text || ':' ||
    has_function_privilege('service_role',
    'public.replace_plan_route_atomic(uuid,text,integer,jsonb,jsonb,boolean)', 'execute')::text`);
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "plan-evidence-replace-0163", database: "pubmax_plan_evidence_replace" });
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

describe.skipIf(skipReason !== null)("0163 Plan replacement evidence", () => {
  it("reproduces route replacement discarding evidence before migration", () => {
    expect(executeGrants()).toBe("false:false:true");
    create("1");
    expect(replace("1")).toBe("ok");
    expect(saved("1")).toEqual([null, null, null]);
  });

  it("persists selected evidence without widening execution grants", () => {
    db().applyFile(forward);
    expect(executeGrants()).toBe("false:false:true");
    create("2");
    expect(replace("2")).toBe("ok");
    expect(saved("2")).toEqual([null, wine, null]);
  });

  it("rollback restores old replacement writes and preserves existing rows", () => {
    db().applyFile(rollback);
    expect(executeGrants()).toBe("false:false:true");
    create("3");
    expect(replace("3")).toBe("ok");
    expect(saved("3")).toEqual([null, null, null]);
    expect(saved("2")).toEqual([null, wine, null]);
  });
});
