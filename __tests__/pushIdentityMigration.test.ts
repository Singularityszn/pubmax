import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260720170000_0047_push_identity_join.sql"),
  "utf8",
);

describe("push identity migration", () => {
  it("is additive and keeps every identity table private", () => {
    expect(migration).toMatch(/add column if not exists account_user_id/);
    expect(migration).toMatch(/create table if not exists public\.push_token_plan_memberships/);
    expect(migration).toMatch(/create table if not exists public\.push_token_account_revocations/);
    expect(migration).toMatch(/create table if not exists public\.push_installation_account_revocations/);
    expect(migration).toMatch(/create table if not exists public\.push_token_plan_mutation_versions/);
    expect(migration).toMatch(/enable row level security/);
    expect(migration).toMatch(/revoke all on public\.push_token_plan_memberships from public, anon, authenticated/);
    expect(migration).not.toMatch(/grant (?:select|insert|update|delete|all).* to (?:anon|authenticated)/i);
  });

  it("pins every RPC search path and grants execution only to service_role", () => {
    const functions = migration.match(/create or replace function[\s\S]*?\$\$;/g) ?? [];
    expect(functions).toHaveLength(7);
    for (const fn of functions) {
      expect(fn).toMatch(/security invoker/);
      expect(fn).toMatch(/set search_path = public/);
    }
    expect(migration.match(/grant execute on function/g)).toHaveLength(7);
    expect(migration).not.toMatch(/grant execute on function[\s\S]*? to (?:public|anon|authenticated)/i);
  });

  it("atomically rejects cross-owner/member reassignment and cascades revocation", () => {
    expect(migration).toMatch(/account_user_id is not null and v_token\.account_user_id <> p_user_id then return 'conflict'/);
    expect(migration).toMatch(/primary key \(token, session_id\)/);
    expect(migration).toMatch(/p_mutation_version < v_version then return 'stale'/);
    expect(migration).toMatch(/v_link\.member_id = p_member_id/);
    expect(migration).toMatch(/return 'conflict'/);
    expect(migration).toMatch(/references public\.push_tokens\(token\) on delete cascade/);
    expect(migration).toMatch(/foreign key \(plan_id, member_id\)[\s\S]*references public\.plan_crew_members\(plan_id, id\)[\s\S]*on delete cascade/);
  });

  it("serializes Plan link and unlink with the same transaction lock", () => {
    const locks = migration.match(/pg_advisory_xact_lock\(hashtextextended\('push-plan:' \|\| p_token \|\| ':' \|\| p_installation_id::text \|\| ':' \|\| p_plan_id::text, 0\)\)/g) ?? [];
    expect(locks).toHaveLength(2);
  });

  it("bounds and prunes durable revocations and mutation watermarks", () => {
    expect(migration).toMatch(/interval '30 days'/);
    expect(migration).toMatch(/delete from public\.push_token_account_revocations where expires_at <= now\(\)/);
    expect(migration).toMatch(/delete from public\.push_token_plan_mutation_versions where expires_at <= now\(\)/);
    expect(migration).toMatch(/greatest\(public\.push_token_account_revocations\.revoked_version/);
    expect(migration).toMatch(/between 1 and 9007199254740991/);
    expect(migration.match(/p_mutation_version > 9007199254740991/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("makes reversed server acquisition order deterministic for account and Plan", () => {
    const accountLink = migration.slice(
      migration.indexOf("function public.link_push_token_account_atomic"),
      migration.indexOf("function public.unlink_push_token_account_atomic"),
    );
    const accountUnlink = migration.slice(
      migration.indexOf("function public.unlink_push_token_account_atomic"),
      migration.indexOf("function public.unlink_push_installation_account_atomic"),
    );
    const planLink = migration.slice(
      migration.indexOf("function public.link_push_token_plan_member_atomic"),
      migration.indexOf("function public.unlink_push_token_plan_member_atomic"),
    );
    const planUnlink = migration.slice(migration.indexOf("function public.unlink_push_token_plan_member_atomic"));
    expect(accountLink).toMatch(/push_token_account_revocations[\s\S]*return 'conflict'/);
    expect(accountLink).toMatch(/p_mutation_version < v_version then return 'stale'/);
    expect(accountUnlink).toMatch(/insert into public\.push_token_account_revocations/);
    expect(accountUnlink).toMatch(/insert into public\.push_token_account_mutation_versions/);
    expect(planLink).toMatch(/p_mutation_version < v_version then return 'stale'/);
    expect(planUnlink).toMatch(/insert into public\.push_token_plan_mutation_versions/);
  });

  it("makes verified revocation server-authoritative after a reset client counter", () => {
    const accountUnlink = migration.slice(
      migration.indexOf("function public.unlink_push_token_account_atomic"),
      migration.indexOf("function public.unlink_push_installation_account_atomic"),
    );
    const installationUnlink = migration.slice(
      migration.indexOf("function public.unlink_push_installation_account_atomic"),
      migration.indexOf("function public.unlink_all_push_tokens_for_account"),
    );
    const planUnlink = migration.slice(
      migration.indexOf("function public.unlink_push_token_plan_member_atomic"),
      migration.indexOf("revoke all on function"),
    );
    for (const fn of [accountUnlink, installationUnlink, planUnlink]) {
      expect(fn).toMatch(/returns bigint/);
      expect(fn).toMatch(/v_authoritative := greatest\(v_version \+ 1, p_mutation_version\)/);
      expect(fn).toMatch(/push mutation watermark exhausted/);
      expect(fn).toMatch(/return v_authoritative/);
    }
    expect(accountUnlink).not.toMatch(/if p_mutation_version >= v_version/);
    expect(installationUnlink).not.toMatch(/account_mutation_version, 0\) <= p_mutation_version/);
    expect(planUnlink).not.toMatch(/mutation_version <= p_mutation_version/);
  });
});
