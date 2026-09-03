import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const BASE =
  "supabase/migrations/20260830170000_0124_plan_invite_canonical_membership.sql";
const MIGRATION =
  "supabase/migrations/20260903130000_0137_plan_legacy_replay_capability.sql";
const ROLLBACK =
  "supabase/migrations/rollback/20260903130000_0137_plan_legacy_replay_capability_rollback.sql";

const read = (file: string): string => {
  const path = join(process.cwd(), file);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
};

const FUNCTIONS = [
  "_0075_join_plan_idempotent_atomic",
  "_0075_redeem_plan_invite_idempotent_atomic",
] as const;

function definition(script: string, name: string): string {
  const start = script.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} is not defined in this script`).toBeGreaterThan(-1);
  const end = script.indexOf("\n$$;", start);
  expect(end, `${name} has no closing $$;`).toBeGreaterThan(start);
  return script.slice(start, end + "\n$$;".length);
}

function removeActiveTokenGuard(body: string): string {
  return body.replace(
    /\n    if existing_member\.membership_revoked_at is null\n       and existing_member\.token_hash is distinct from p_(?:member_)?token_hash then\n      return 'conflict';\n    end if;/g,
    "",
  );
}

describe("0137 plan legacy replay capability migration", () => {
  const base = read(BASE);
  const sql = read(MIGRATION);
  const rollback = read(ROLLBACK);

  it("changes only private 0075 replay helpers", () => {
    expect(sql.match(/create or replace function public\._0075_/g)).toHaveLength(2);
    expect(sql).not.toMatch(/create or replace function public\.(?!_0075_)/);
    expect(sql).not.toMatch(/alter table|create index|drop index|drop function/i);
    expect(sql).not.toMatch(/create function public\.(?!_0075_)/);

    for (const name of FUNCTIONS) {
      expect(sql).toContain(`create or replace function public.${name}(`);
      expect(definition(sql, name)).toContain("language plpgsql security invoker set search_path = ''");
    }
  });

  it("keeps request and member checks, then rejects only stale tokens for active replay", () => {
    const join = definition(sql, FUNCTIONS[0]);
    const redeem = definition(sql, FUNCTIONS[1]);

    expect(join).toContain(
      "if existing_member.join_request_hash <> p_request_hash or existing_member.id <> p_member_id then",
    );
    expect(redeem).toContain(
      "if existing_member.join_request_hash <> p_request_hash or existing_member.id <> p_member_id then",
    );
    expect(join).toContain(
      "if existing_member.membership_revoked_at is null\n       and existing_member.token_hash is distinct from p_token_hash then",
    );
    expect(redeem).toContain(
      "if existing_member.membership_revoked_at is null\n       and existing_member.token_hash is distinct from p_member_token_hash then",
    );
    expect(join).toContain("if existing_member.membership_revoked_at is null then return 'replayed'; end if;");
    expect(redeem).toContain("if existing_member.membership_revoked_at is null then return 'replayed'; end if;");

    expect(removeActiveTokenGuard(join)).toBe(definition(base, FUNCTIONS[0]));
    expect(removeActiveTokenGuard(redeem)).toBe(definition(base, FUNCTIONS[1]));
  });

  it("retains both advisory locks and does not rewrite wrapper ACLs", () => {
    for (const [name, lockLabel] of [
      [FUNCTIONS[0], "plan:join:"],
      [FUNCTIONS[1], "plan:invite-join:"],
    ] as const) {
      const body = definition(sql, name);
      expect(body).toContain("pg_advisory_xact_lock(hashtextextended('plan:join:' || p_plan_id::text, 0));");
      expect(body).toContain(
        `hashtextextended('${lockLabel}' || p_plan_id::text || ':' || p_idempotency_key_hash, 0)`,
      );
    }
    expect(sql).not.toMatch(/revoke all|grant execute|public\.join_plan_idempotent_atomic\(/);
    expect(sql).not.toMatch(/public\.redeem_plan_invite_idempotent_atomic\(/);
  });

  it("restores exact 0124 private bodies and reopens stale replay on rollback", () => {
    for (const name of FUNCTIONS) {
      expect(definition(rollback, name)).toBe(definition(base, name));
    }
    expect(rollback).not.toMatch(/alter table|create index|drop index|drop function/i);
    expect(rollback).not.toMatch(/revoke all|grant execute|public\.join_plan_idempotent_atomic\(/);
    expect(rollback).not.toMatch(/public\.redeem_plan_invite_idempotent_atomic\(/);
  });

  it("runs each script in one transaction", () => {
    for (const script of [sql, rollback]) {
      expect(script).toMatch(/(?:^|\n)begin;\n/);
      expect(script.trimEnd().endsWith("commit;")).toBe(true);
    }
  });
});
