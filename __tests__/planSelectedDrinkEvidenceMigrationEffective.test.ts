import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const migrations = join(process.cwd(), "supabase/migrations");
const name = "20260929120000_0161_plan_selected_drink_evidence.sql";
const forward = join(migrations, name);
const rollback = join(migrations, "rollback/20260929120000_0161_plan_selected_drink_evidence_rollback.sql");
const prerequisites = readdirSync(migrations)
  .filter((entry) => entry.endsWith(".sql") && entry < name)
  .sort()
  .map((entry) => join(migrations, entry));
const planId = "10000000-0000-4000-8000-000000000161";
const memberId = "20000000-0000-4000-8000-000000000161";
const evidence = JSON.stringify({
  category: "wine",
  pence: 550,
  serving: null,
  source: "community",
  reportedAt: "2026-09-25T12:00:00.000Z",
});

let session: PostgresSession | null = null;
let policiesBefore = "";

function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL session unavailable");
  return session;
}

function columnExists(): boolean {
  return db().sql(`select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'plan_stops'
      and column_name = 'selected_drink_price_evidence'`) === "1";
}

function policies(): string {
  return db().sql(`select coalesce(string_agg(policyname || ':' || cmd || ':' || coalesce(qual, ''), ',' order by policyname), '')
    from pg_policies where schemaname = 'public' and tablename = 'plan_stops'`);
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "plan-evidence-0161", database: "pubmax_plan_evidence" });
  try {
    db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const path of prerequisites) db().applyFile(path);
    db().sql(`insert into public.plans (id, title, start_time)
      values ('${planId}', 'Wine night', '2026-09-30T19:00:00Z');
      insert into public.plan_stops (plan_id, venue_id, venue_name, position)
      values ('${planId}', 'venue-a', 'A', 0);
      insert into auth.users (id) values ('${memberId}');
      insert into public.plan_crew_members (plan_id, name, token_hash, user_id)
      values ('${planId}', 'Member', '${"a".repeat(64)}', '${memberId}');`);
    policiesBefore = policies();
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

describe.skipIf(skipReason !== null)("0161 selected drink evidence storage", () => {
  it("reproduces the missing per-stop column before migration", () => {
    expect(columnExists()).toBe(false);
    expect(db().expectRefusal(`update public.plan_stops
      set selected_drink_price_evidence = '${evidence}'::jsonb
      where plan_id = '${planId}'`)).toContain("selected_drink_price_evidence");
  });

  it("adds nullable, bounded evidence without changing existing stops or access policy", () => {
    db().applyFile(forward);
    expect(columnExists()).toBe(true);
    expect(db().sql(`select venue_id || ':' || venue_name || ':' || position || ':' ||
      (selected_drink_price_evidence is null)::text from public.plan_stops where plan_id = '${planId}'`))
      .toBe("venue-a:A:0:true");
    expect(policies()).toBe(policiesBefore);
    expect(db().sql("select has_column_privilege('anon', 'public.plan_stops', 'selected_drink_price_evidence', 'select')"))
      .toBe("f");
    expect(db().sql("select has_column_privilege('authenticated', 'public.plan_stops', 'selected_drink_price_evidence', 'update')"))
      .toBe("f");
  });

  it("round trips wine evidence and rejects oversized, extra, or wrong-shaped data", () => {
    db().sql(`update public.plan_stops set selected_drink_price_evidence = '${evidence}'::jsonb
      where plan_id = '${planId}'`);
    expect(JSON.parse(db().sql(`select selected_drink_price_evidence::text
      from public.plan_stops where plan_id = '${planId}'`))).toEqual(JSON.parse(evidence));
    for (const invalid of [
      JSON.stringify({ ...JSON.parse(evidence), contributorHandle: "private" }),
      JSON.stringify({ ...JSON.parse(evidence), reportedAt: "x".repeat(600) }),
      JSON.stringify([JSON.parse(evidence)]),
    ]) {
      expect(db().expectRefusal(`update public.plan_stops
        set selected_drink_price_evidence = '${invalid}'::jsonb where plan_id = '${planId}'`))
        .toContain("plan_stops_selected_drink_price_evidence_check");
    }
  });

  it("keeps linked-member table reads within the closed display-value contract", () => {
    expect(JSON.parse(db().sql(`begin;
      set local request.jwt.claims = '{"sub":"${memberId}","role":"authenticated"}';
      set local role authenticated;
      select selected_drink_price_evidence::text from public.plan_stops where plan_id = '${planId}';
      commit;`))).toEqual(JSON.parse(evidence));

    for (const invalid of [
      { ...JSON.parse(evidence), category: "beer" },
      { ...JSON.parse(evidence), category: "cocktails" },
      { ...JSON.parse(evidence), category: null },
      { ...JSON.parse(evidence), pence: { amount: 550, contributorHandle: "private" } },
      { ...JSON.parse(evidence), pence: null },
      { ...JSON.parse(evidence), pence: 0 },
      { ...JSON.parse(evidence), pence: 100_001 },
      { ...JSON.parse(evidence), pence: 550.5 },
      { ...JSON.parse(evidence), serving: { contributorId: "private" } },
      { ...JSON.parse(evidence), source: { contributorHandle: "private" } },
      { ...JSON.parse(evidence), source: null },
      { ...JSON.parse(evidence), reportedAt: { contributorHandle: "private" } },
      { ...JSON.parse(evidence), reportedAt: null },
      { ...JSON.parse(evidence), reportedAt: "2026-09-25T12:00:00Z" },
      { ...JSON.parse(evidence), reportedAt: "2026-09-25T12:00:00.000+00:00" },
      { ...JSON.parse(evidence), reportedAt: "2026-02-30T12:00:00.000Z" },
    ]) {
      expect(db().expectRefusal(`update public.plan_stops
        set selected_drink_price_evidence = '${JSON.stringify(invalid)}'::jsonb
        where plan_id = '${planId}'`)).toMatch(/plan_stops_selected_drink_price_evidence_check|date\/time field value out of range/);
    }
  });

  it("rollback drops only evidence storage and preserves the route", () => {
    db().applyFile(rollback);
    expect(columnExists()).toBe(false);
    expect(db().sql(`select venue_id || ':' || venue_name || ':' || position
      from public.plan_stops where plan_id = '${planId}'`)).toBe("venue-a:A:0");
    expect(policies()).toBe(policiesBefore);
  });
});
