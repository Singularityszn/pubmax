import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const migrations = join(process.cwd(), "supabase/migrations");
const name = "20260929170000_0166_plan_context_selected_drink_evidence.sql";
const forward = join(migrations, name);
const rollback = join(migrations, "rollback/20260929170000_0166_plan_context_selected_drink_evidence_rollback.sql");
const prerequisites = readdirSync(migrations)
  .filter((entry) => entry.endsWith(".sql") && entry < name)
  .sort()
  .map((entry) => join(migrations, entry));
const wine = { category: "wine", pence: 550, serving: null, source: "community", reportedAt: "2026-09-25T12:00:00.000Z" };
const stops = JSON.stringify([
  { venueId: "venue-a", venueName: "A", selectedDrinkPriceEvidence: wine },
  { venueId: "venue-b", venueName: "B" },
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
    '${planId(suffix)}'::uuid, 'Wine', '2026-09-30T19:00:00Z', '${stops}'::jsonb,
    '20000000-0000-4000-8000-00000000000${suffix}'::uuid, 'Host', '${suffix.repeat(64)}',
    '2026-09-29T12:00:00Z', '${suffix.repeat(64)}', '${suffix.repeat(64)}', null, null, null,
    '{"drinkCategory":"wine","zeroProof":false}'::jsonb)`)).toBe("created");
}
function changeContext(suffix: string, context: object): string {
  return db().sql(`select public.update_legacy_plan_status_context_atomic(
    '${planId(suffix)}'::uuid, '${suffix.repeat(64)}', null, '${JSON.stringify(context)}'::jsonb)`);
}
function saved(suffix: string): unknown {
  const value = db().sql(`select coalesce(selected_drink_price_evidence::text, 'null')
    from public.plan_stops where plan_id = '${planId(suffix)}' and position = 0`);
  return JSON.parse(value);
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "plan-evidence-context-0166", database: "pubmax_plan_evidence_context" });
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

describe.skipIf(skipReason !== null)("0166 Plan context evidence", () => {
  it("reproduces a context edit retaining wine evidence before migration", () => {
    create("0");
    expect(changeContext("0", { drinkCategory: "beer", zeroProof: false })).toBe("ok");
    expect(saved("0")).toEqual(wine);
  });

  it("clears evidence when saved wine intent becomes beer or zero-proof", () => {
    db().applyFile(forward);
    create("1");
    expect(saved("1")).toEqual(wine);
    expect(changeContext("1", { drinkCategory: "beer", zeroProof: false })).toBe("ok");
    expect(saved("1")).toBeNull();

    create("2");
    expect(changeContext("2", { drinkCategory: "wine", zeroProof: true })).toBe("ok");
    expect(saved("2")).toBeNull();
  });

  it("retains matching evidence when unrelated context changes", () => {
    create("3");
    expect(changeContext("3", { drinkCategory: "wine", zeroProof: false, budget: "treat" })).toBe("ok");
    expect(saved("3")).toEqual(wine);
  });

  it("rollback restores old update behavior without erasing already saved plans", () => {
    db().applyFile(rollback);
    create("4");
    expect(changeContext("4", { drinkCategory: "beer", zeroProof: false })).toBe("ok");
    expect(saved("4")).toEqual(wine);
    expect(saved("3")).toEqual(wine);
  });
});
