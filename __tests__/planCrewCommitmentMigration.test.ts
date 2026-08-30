import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260830180000_0125_plan_crew_commitment.sql",
);
const ROLLBACK = join(
  process.cwd(),
  "supabase/migrations/rollback/20260830180000_0125_plan_crew_commitment_rollback.sql",
);

describe("Plan crew commitment migration", () => {
  it("stores one durable threshold occurrence on its canonical member", () => {
    expect(existsSync(MIGRATION)).toBe(true);
    if (!existsSync(MIGRATION)) return;
    const sql = readFileSync(MIGRATION, "utf8");

    expect(sql).toMatch(/alter table public\.plan_crew_members[\s\S]+add column if not exists crew_committed_at timestamptz[\s\S]+add column if not exists crew_committed_event_id uuid/i);
    expect(sql).toMatch(/create unique index[^;]+plan_crew_members[^;]+plan_id[^;]+where crew_committed_event_id is not null/is);
    expect(sql).toMatch(/create unique index[^;]+crew_committed_event_id[^;]+where crew_committed_event_id is not null/is);
    expect(sql).toContain("_plan_crew_commitment_for_member");
    expect(sql).toContain("p_allow_create boolean");
    expect(sql).toMatch(/membership_revoked_at is null[\s\S]+\) = 2/is);
    expect(sql).toContain("clock_timestamp()");
    expect(sql).toContain("gen_random_uuid()");
  });

  it("keeps old app RPC names compatible when migration lands before code", () => {
    expect(existsSync(MIGRATION)).toBe(true);
    if (!existsSync(MIGRATION)) return;
    const sql = readFileSync(MIGRATION, "utf8");

    expect(sql).toMatch(/alter function public\.join_plan_idempotent_atomic\([^)]+\) rename to _0125_join_plan_idempotent_atomic/i);
    expect(sql).toMatch(/alter function public\.redeem_plan_invite_idempotent_atomic\([^)]+\) rename to _0125_redeem_plan_invite_idempotent_atomic/i);
    expect(sql).toMatch(/alter function public\.upsert_plan_invite_rsvp_membership_atomic\([^)]+\) rename to _0125_upsert_plan_invite_rsvp_membership_atomic/i);
    expect(sql).toContain("function public.join_plan_idempotent_atomic");
    expect(sql).toContain("public._0125_join_plan_idempotent_atomic(");
    expect(sql).toContain("function public.redeem_plan_invite_idempotent_atomic");
    expect(sql).toContain("public._0125_redeem_plan_invite_idempotent_atomic(");
    expect(sql).toContain("function public.upsert_plan_invite_rsvp_membership_atomic");
    expect(sql).toContain("public._0125_upsert_plan_invite_rsvp_membership_atomic(");
    expect(sql).toContain("v_outcome = 'joined'");
    expect(sql).toContain("not v_was_active");
  });

  it("wraps every canonical membership entry point under the Plan join lock", () => {
    expect(existsSync(MIGRATION)).toBe(true);
    if (!existsSync(MIGRATION)) return;
    const sql = readFileSync(MIGRATION, "utf8");

    for (const name of [
      "join_plan_idempotent_with_crew_commitment_atomic",
      "redeem_plan_invite_idempotent_with_crew_commitment_atomic",
      "upsert_plan_invite_rsvp_membership_with_crew_commitment_atomic",
    ]) {
      expect(sql).toContain(`function public.${name}`);
    }
    expect(sql.match(/pg_advisory_xact_lock\(hashtextextended\('plan:join:' \|\| p_plan_id::text, 0\)\)/g)).toHaveLength(3);
    expect(sql).toContain("public.join_plan_idempotent_atomic(");
    expect(sql).toContain("public.redeem_plan_invite_idempotent_atomic(");
    expect(sql).toContain("public.upsert_plan_invite_rsvp_membership_atomic(");
    expect(sql).not.toContain("create or replace function public._0075_join_plan_idempotent_atomic");
    expect(sql).not.toContain("create or replace function public._0075_redeem_plan_invite_idempotent_atomic");
  });

  it("allows only crew commitment receipt digests to rotate", () => {
    expect(existsSync(MIGRATION)).toBe(true);
    if (!existsSync(MIGRATION)) return;
    const sql = readFileSync(MIGRATION, "utf8");

    expect(sql).toContain("create or replace function public.claim_analytics_event_receipt(");
    expect(sql).toMatch(/receipt\.event_name <> p_event_name[\s\S]+return 'conflict'/i);
    expect(sql).toMatch(/receipt\.token_hash <> p_token_hash[\s\S]+p_event_name <> 'crew_committed'[\s\S]+return 'conflict'/i);
    expect(sql).toMatch(/set token_hash = p_token_hash,[\s\S]+lease_until = p_lease_until/i);
  });

  it("keeps helper and wrappers service-role only", () => {
    expect(existsSync(MIGRATION)).toBe(true);
    if (!existsSync(MIGRATION)) return;
    const sql = readFileSync(MIGRATION, "utf8");

    expect(sql).toMatch(/revoke all on function public\._plan_crew_commitment_for_member[\s\S]+from public, anon, authenticated/i);
    for (const name of [
      "join_plan_idempotent_with_crew_commitment_atomic",
      "redeem_plan_invite_idempotent_with_crew_commitment_atomic",
      "upsert_plan_invite_rsvp_membership_with_crew_commitment_atomic",
    ]) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]*?\\) from public, anon, authenticated`, "i"));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]*?\\) to service_role`, "i"));
    }
  });

  it("ships a fail-closed rollback that cannot erase recorded occurrence state", () => {
    expect(existsSync(ROLLBACK)).toBe(true);
    if (!existsSync(ROLLBACK)) return;
    const rollback = readFileSync(ROLLBACK, "utf8");

    expect(rollback).toMatch(/crew_committed_at is not null[\s\S]+raise exception/i);
    expect(rollback).toContain("drop function if exists public.join_plan_idempotent_with_crew_commitment_atomic");
    expect(rollback).toContain("drop function if exists public.redeem_plan_invite_idempotent_with_crew_commitment_atomic");
    expect(rollback).toContain("drop function if exists public.upsert_plan_invite_rsvp_membership_with_crew_commitment_atomic");
    expect(rollback).toMatch(/alter table public\.plan_crew_members[\s\S]+drop column if exists crew_committed_at/i);
    expect(rollback).toContain("receipt.token_hash <> p_token_hash or receipt.event_name <> p_event_name");
  });
});
