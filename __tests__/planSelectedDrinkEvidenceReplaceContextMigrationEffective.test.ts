import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const migrations = join(process.cwd(), "supabase/migrations");
const name = "20260929180000_0167_plan_replace_context_evidence.sql";
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
  expect(db().sql(`select public.create_plan_with_context_idempotent_atomic(
    '${planId(suffix)}'::uuid, 'Wine', '2026-09-30T19:00:00Z',
    '[{"venueId":"venue-x","venueName":"X"},{"venueId":"venue-y","venueName":"Y"},{"venueId":"venue-z","venueName":"Z"}]'::jsonb,
    '20000000-0000-4000-8000-00000000000${suffix}'::uuid, 'Host', '${suffix.repeat(64)}',
    '2026-09-29T12:00:00Z', '${suffix.repeat(64)}', '${suffix.repeat(64)}', null, null, null,
    '{"drinkCategory":"wine","zeroProof":false}'::jsonb)`)).toBe("created");
}
function changeToBeer(suffix: string): void {
  expect(db().sql(`select public.update_legacy_plan_status_context_atomic(
    '${planId(suffix)}'::uuid, '${suffix.repeat(64)}', null,
    '{"drinkCategory":"beer","zeroProof":false}'::jsonb)`)).toBe("ok");
}
function replace(suffix: string, context = "null"): void {
  expect(db().sql(`select public.replace_plan_route_atomic(
    '${planId(suffix)}'::uuid, '${suffix.repeat(64)}', 1, '${stops}'::jsonb,
    ${context}, false)`)).toBe("ok");
}
function saved(suffix: string): unknown {
  return JSON.parse(db().sql(`select coalesce(selected_drink_price_evidence::text, 'null')
    from public.plan_stops where plan_id = '${planId(suffix)}' and position = 1`));
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "plan-evidence-replace-context-0167", database: "pubmax_plan_evidence_replace_context" });
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

describe.skipIf(skipReason !== null)("0167 replacement uses locked drink intent", () => {
  it("reproduces a stale wine replacement after a context-only beer edit", () => {
    create("1");
    changeToBeer("1");
    replace("1");
    expect(saved("1")).toEqual(wine);
  });

  it("drops stale evidence and retains matching evidence under effective context", () => {
    db().applyFile(join(migrations, name));
    expect(db().sql(`select has_function_privilege('anon',
      'public.replace_plan_route_atomic(uuid,text,integer,jsonb,jsonb,boolean)', 'execute')::text || ':' ||
      has_function_privilege('authenticated',
      'public.replace_plan_route_atomic(uuid,text,integer,jsonb,jsonb,boolean)', 'execute')::text || ':' ||
      has_function_privilege('service_role',
      'public.replace_plan_route_atomic(uuid,text,integer,jsonb,jsonb,boolean)', 'execute')::text`)).toBe("false:false:true");
    create("2");
    changeToBeer("2");
    replace("2");
    expect(saved("2")).toBeNull();

    create("3");
    replace("3");
    expect(saved("3")).toEqual(wine);

    create("4");
    replace("4", "'{\"drinkCategory\":\"beer\",\"zeroProof\":false}'::jsonb");
    expect(saved("4")).toBeNull();

    create("6");
    replace("6", "'{\"drinkCategory\":\"wine\",\"zeroProof\":true}'::jsonb");
    expect(saved("6")).toBeNull();
  });

  it("rollback restores prior writes without changing already saved evidence", () => {
    db().applyFile(join(migrations, "rollback/20260929180000_0167_plan_replace_context_evidence_rollback.sql"));
    create("5");
    changeToBeer("5");
    replace("5");
    expect(saved("5")).toEqual(wine);
    expect(saved("3")).toEqual(wine);
  });
});
