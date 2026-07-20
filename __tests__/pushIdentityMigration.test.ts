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
    expect(migration).toMatch(/enable row level security/);
    expect(migration).toMatch(/revoke all on public\.push_token_plan_memberships from public, anon, authenticated/);
    expect(migration).not.toMatch(/grant (?:select|insert|update|delete|all).* to (?:anon|authenticated)/i);
  });

  it("pins every RPC search path and grants execution only to service_role", () => {
    const functions = migration.match(/create or replace function[\s\S]*?\$\$;/g) ?? [];
    expect(functions).toHaveLength(5);
    for (const fn of functions) {
      expect(fn).toMatch(/security invoker/);
      expect(fn).toMatch(/set search_path = public/);
    }
    expect(migration.match(/grant execute on function/g)).toHaveLength(5);
    expect(migration).not.toMatch(/grant execute on function[\s\S]*? to (?:public|anon|authenticated)/i);
  });

  it("atomically rejects cross-owner/member reassignment and cascades revocation", () => {
    expect(migration).toMatch(/account_user_id is not null and v_token\.account_user_id <> p_user_id then return 'conflict'/);
    expect(migration).toMatch(/account_blocked_session_id = p_session_id then return 'conflict'/);
    expect(migration).toMatch(/v_link\.member_id = p_member_id then return 'replayed'/);
    expect(migration).toMatch(/return 'conflict'/);
    expect(migration).toMatch(/references public\.push_tokens\(token\) on delete cascade/);
    expect(migration).toMatch(/foreign key \(plan_id, member_id\)[\s\S]*references public\.plan_crew_members\(plan_id, id\)[\s\S]*on delete cascade/);
  });

  it("serializes Plan link and unlink with the same transaction lock", () => {
    const locks = migration.match(/pg_advisory_xact_lock\(hashtextextended\('push-plan:' \|\| p_token \|\| ':' \|\| p_plan_id::text, 0\)\)/g) ?? [];
    expect(locks).toHaveLength(2);
  });
});
