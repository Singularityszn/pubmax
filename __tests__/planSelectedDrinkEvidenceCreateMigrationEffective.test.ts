import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const migrations = join(process.cwd(), "supabase/migrations");
const name = "20260929130000_0162_plan_create_selected_drink_evidence.sql";
const forward = join(migrations, name);
const rollback = join(migrations, "rollback/20260929130000_0162_plan_create_selected_drink_evidence_rollback.sql");
const prerequisites = readdirSync(migrations)
  .filter((entry) => entry.endsWith(".sql") && entry < name)
  .sort()
  .map((entry) => join(migrations, entry));
const wine = { category: "wine", pence: 550, serving: null, source: "community", reportedAt: "2026-09-25T12:00:00.000Z" };
const cocktail = { category: "cocktails", pence: 850, serving: null, source: "community", reportedAt: "2026-09-26T12:00:00.000Z" };
const stops = JSON.stringify([
  { venueId: "venue-a", venueName: "A", selectedDrinkPriceEvidence: wine },
  { venueId: "venue-b", venueName: "B", selectedDrinkPriceEvidence: cocktail },
  { venueId: "venue-c", venueName: "C" },
]);

let session: PostgresSession | null = null;
let executeGrantsBefore = "";

function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL session unavailable");
  return session;
}

function create(suffix: string): string {
  return db().sql(`select public.create_plan_idempotent_atomic(
    '10000000-0000-4000-8000-00000000000${suffix}'::uuid,
    'Wine and cocktails', '2026-09-30T19:00:00Z', '${stops}'::jsonb,
    '20000000-0000-4000-8000-00000000000${suffix}'::uuid,
    'Host', '${suffix.repeat(64)}', '2026-09-29T12:00:00Z',
    '${suffix.repeat(64)}', '${suffix.repeat(64)}', null, null, null)`);
}

function createWithContext(suffix: string): string {
  return db().sql(`select public.create_plan_with_context_idempotent_atomic(
    '10000000-0000-4000-8000-00000000000${suffix}'::uuid,
    'Wine and cocktails', '2026-09-30T19:00:00Z', '${stops}'::jsonb,
    '20000000-0000-4000-8000-00000000000${suffix}'::uuid,
    'Host', '${suffix.repeat(64)}', '2026-09-29T12:00:00Z',
    '${suffix.repeat(64)}', '${suffix.repeat(64)}', null, null, null,
    '{"drinkCategory":"wine"}'::jsonb)`);
}

function saved(suffix: string): Array<unknown> {
  return JSON.parse(db().sql(`select jsonb_agg(selected_drink_price_evidence order by position)::text
    from public.plan_stops where plan_id = '10000000-0000-4000-8000-00000000000${suffix}'`));
}

function executeGrants(): string {
  return db().sql(`select has_function_privilege('anon',
    'public.create_plan_idempotent_atomic(uuid,text,timestamptz,jsonb,uuid,text,text,timestamptz,text,text,text,text,text)',
    'execute')::text || ':' || has_function_privilege('authenticated',
    'public.create_plan_idempotent_atomic(uuid,text,timestamptz,jsonb,uuid,text,text,timestamptz,text,text,text,text,text)',
    'execute')::text || ':' || has_function_privilege('service_role',
    'public.create_plan_idempotent_atomic(uuid,text,timestamptz,jsonb,uuid,text,text,timestamptz,text,text,text,text,text)',
    'execute')::text`);
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "plan-evidence-create-0162", database: "pubmax_plan_evidence_create" });
  try {
    db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const path of prerequisites) db().applyFile(path);
    executeGrantsBefore = executeGrants();
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

describe.skipIf(skipReason !== null)("0162 Plan creation evidence", () => {
  it("reproduces the pre-migration create RPC discarding selected evidence", () => {
    expect(executeGrantsBefore).toBe("false:false:true");
    expect(create("1")).toBe("created");
    expect(saved("1")).toEqual([null, null, null]);
  });

  it("persists wine and cocktail evidence through creation and idempotent replay", () => {
    db().applyFile(forward);
    expect(executeGrants()).toBe(executeGrantsBefore);
    expect(create("2")).toBe("created");
    expect(saved("2")).toEqual([wine, cocktail, null]);
    expect(create("2")).toBe("replayed");
    expect(saved("2")).toEqual([wine, cocktail, null]);
    expect(createWithContext("4")).toBe("created");
    expect(saved("4")).toEqual([wine, cocktail, null]);
    expect(db().sql("select night_context->>'drinkCategory' from public.plans where id = '10000000-0000-4000-8000-000000000004'"))
      .toBe("wine");
  });

  it("rollback restores old writes without removing previously saved evidence", () => {
    db().applyFile(rollback);
    expect(executeGrants()).toBe(executeGrantsBefore);
    expect(create("3")).toBe("created");
    expect(saved("3")).toEqual([null, null, null]);
    expect(saved("2")).toEqual([wine, cocktail, null]);
  });
});
