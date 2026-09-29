import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const migrations = join(process.cwd(), "supabase/migrations");
const name = "20260929230000_0172_plan_proposal_current_context_evidence.sql";
const forward = join(migrations, name);
const rollback = join(migrations, "rollback/20260929230000_0172_plan_proposal_current_context_evidence_rollback.sql");
const prerequisites = readdirSync(migrations)
  .filter((entry) => entry.endsWith(".sql") && entry < name)
  .sort()
  .map((entry) => join(migrations, entry));
const wine = { category: "wine", pence: 550, serving: null, source: "community", reportedAt: "2026-09-25T12:00:00.000Z" };

let session: PostgresSession | null = null;
function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL session unavailable");
  return session;
}
function planId(suffix: string): string { return `10000000-0000-4000-8000-00000000000${suffix}`; }
function memberId(suffix: string): string { return `20000000-0000-4000-8000-00000000000${suffix}`; }
function proposalId(suffix: string): string { return `30000000-0000-4000-8000-00000000000${suffix}`; }
function create(suffix: string): void {
  expect(db().sql(`select public.create_plan_with_context_idempotent_atomic(
    '${planId(suffix)}'::uuid, 'Wine', '2026-09-30T19:00:00Z',
    '[{"venueId":"venue-x","venueName":"X"},{"venueId":"venue-y","venueName":"Y"},{"venueId":"venue-z","venueName":"Z"}]'::jsonb,
    '${memberId(suffix)}'::uuid, 'Host', '${suffix.repeat(64)}',
    '2026-09-29T12:00:00Z', '${suffix.repeat(64)}', '${suffix.repeat(64)}', null, null, null,
    '{"drinkCategory":"wine","zeroProof":false}'::jsonb)`)).toBe("created");
  db().sql(`insert into public.plan_route_proposals
    (id,plan_id,proposed_by_member_id,expected_route_revision,stops,reason,resolved_constraint_ids,unresolved_constraint_ids,status,idempotency_key,created_at)
    values ('${proposalId(suffix)}','${planId(suffix)}','${memberId(suffix)}',1,
    '[{"venueId":"venue-a","venueName":"A","position":0},{"venueId":"venue-b","venueName":"B","position":1,"selectedDrinkPriceEvidence":${JSON.stringify(wine)}},{"venueId":"venue-c","venueName":"C","position":2}]'::jsonb,
    'Route','[]'::jsonb,'[]'::jsonb,'pending','proposal-${suffix}',now())`);
}
function changeContext(suffix: string, context: object): void {
  expect(db().sql(`select public.update_legacy_plan_status_context_atomic(
    '${planId(suffix)}'::uuid, '${suffix.repeat(64)}', null, '${JSON.stringify(context)}'::jsonb)`)).toBe("ok");
}
function decide(suffix: string): string {
  return db().sql(`select public.decide_plan_route_proposal_atomic('${planId(suffix)}'::uuid,'${proposalId(suffix)}'::uuid,
    '${suffix.repeat(64)}','accepted','decision-${suffix}',now())`);
}
function saved(suffix: string): unknown {
  return JSON.parse(db().sql(`select coalesce(selected_drink_price_evidence::text, 'null')
    from public.plan_stops where plan_id='${planId(suffix)}' and position=1`));
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "proposal-context-0172", database: "pubmax_proposal_context" });
  try {
    db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const path of prerequisites) db().applyFile(path);
  } catch (error) {
    await session.stop(); session = null; throw error;
  }
}, 600_000);
afterAll(async () => { await session?.stop(); session = null; });

describe.skipIf(skipReason !== null)("0172 proposal evidence follows locked Plan context", () => {
  it("reproduces stale proposal evidence after wine intent becomes beer", () => {
    create("0");
    changeContext("0", { drinkCategory: "beer", zeroProof: false });
    expect(decide("0")).toBe("decided");
    expect(saved("0")).toEqual(wine);
  });

  it("uses current context when accepting an old proposal", () => {
    db().applyFile(forward);
    create("1");
    changeContext("1", { drinkCategory: "beer", zeroProof: false });
    expect(decide("1")).toBe("decided");
    expect(saved("1")).toBeNull();

    create("2");
    changeContext("2", { drinkCategory: "wine", zeroProof: true });
    expect(decide("2")).toBe("decided");
    expect(saved("2")).toBeNull();

    create("3");
    changeContext("3", { drinkCategory: null, zeroProof: false });
    expect(decide("3")).toBe("decided");
    expect(saved("3")).toBeNull();

    create("4");
    expect(decide("4")).toBe("decided");
    expect(saved("4")).toEqual(wine);
  });

  it("waits for a concurrent context edit before choosing proposal evidence", async () => {
    create("6");
    const edit = db().sqlAsync(`begin;
      update public.plans set night_context='{"drinkCategory":"beer","zeroProof":false}'::jsonb
      where id='${planId("6")}'::uuid;
      select pg_sleep(1.5);
      commit;`);
    let locked = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      locked = db().sql(`select exists(select 1 from pg_locks
        where relation='public.plans'::regclass and mode='RowExclusiveLock' and granted)::text`) === "true";
      if (locked) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(locked).toBe(true);
    const decision = db().sqlAsync(`select public.decide_plan_route_proposal_atomic(
      '${planId("6")}'::uuid,'${proposalId("6")}'::uuid,'${"6".repeat(64)}','accepted','decision-6',now())`);
    expect((await Promise.all([edit, decision]))[1]).toBe("decided");
    expect(saved("6")).toBeNull();
  });

  it("rollback restores old future writes without changing accepted stops", () => {
    db().applyFile(rollback);
    create("5");
    changeContext("5", { drinkCategory: "beer", zeroProof: false });
    expect(decide("5")).toBe("decided");
    expect(saved("5")).toEqual(wine);
    expect(saved("4")).toEqual(wine);
  });
});
