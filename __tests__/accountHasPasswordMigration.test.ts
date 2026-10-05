import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = "supabase/migrations/20260810100000_0099_account_has_password.sql";
const ROLLBACK =
  "supabase/migrations/rollback/20260810100000_0099_account_has_password_rollback.sql";

const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
const rollback = readFileSync(join(process.cwd(), ROLLBACK), "utf8");

describe("0099 account_has_password", () => {
  it("returns a boolean and never the hash it looked at", () => {
    expect(sql).toMatch(/returns boolean/);
    expect(sql).toMatch(/select exists \(/);
    // `select exists` is the whole point: nothing about the password leaves.
    expect(sql).not.toMatch(/select\s+u\.encrypted_password/);
    expect(sql).not.toMatch(/returns\s+(text|record|setof)/i);
  });

  it("asks the one question it exists to answer", () => {
    expect(sql).toMatch(/from auth\.users u/);
    expect(sql).toMatch(/u\.encrypted_password is not null/);
    expect(sql).toMatch(/u\.encrypted_password <> ''/);
    expect(sql).toMatch(/where u\.id = p_user_id/);
  });

  it("is reachable by the service role alone", () => {
    // A browser-callable version would answer "which accounts have passwords"
    // for any id somebody cared to try.
    expect(sql).toMatch(/security definer/);
    for (const role of ["public", "anon", "authenticated"]) {
      expect(sql).toMatch(
        new RegExp(
          `revoke all on function public\\.account_has_password\\(uuid\\) from ${role};`,
        ),
      );
    }
    expect(sql).toMatch(
      /grant execute on function public\.account_has_password\(uuid\) to service_role;/,
    );
    expect(sql).not.toMatch(/to (anon|authenticated)\b/);
  });

  it("pins search_path, so definer rights cannot be borrowed", () => {
    expect(sql).toMatch(/set search_path = ''/);
  });

  it("applies and rolls back inside one transaction each", () => {
    for (const script of [sql, rollback]) {
      expect(script.trimStart().startsWith("begin;")).toBe(false);
      expect(script).toMatch(/\nbegin;/);
      expect(script.trimEnd().endsWith("commit;")).toBe(true);
    }
    expect(rollback).toMatch(
      /drop function if exists public\.account_has_password\(uuid\);/,
    );
  });

  it("is re-appliable, because a captain may run it twice", () => {
    expect(sql).toMatch(/create or replace function/);
  });
});

const OWNER_SET_MIGRATION =
  "supabase/migrations/20261005120000_0173_account_password_set.sql";
const OWNER_SET_ROLLBACK =
  "supabase/migrations/rollback/20261005120000_0173_account_password_set_rollback.sql";

const ownerSet = readFileSync(join(process.cwd(), OWNER_SET_MIGRATION), "utf8");
const ownerSetRollback = readFileSync(join(process.cwd(), OWNER_SET_ROLLBACK), "utf8");

describe("0173 a password counts once its owner set it", () => {
  it("records a set only when GoTrue changes the hash on an existing account", () => {
    // INSERT is the email-link sign-up writing a random hash, so it is not watched.
    expect(ownerSet).toMatch(/after update of encrypted_password on auth\.users/);
    expect(ownerSet).not.toMatch(/(before|after) insert/i);
    expect(ownerSet).toMatch(
      /new\.encrypted_password is distinct from old\.encrypted_password/,
    );
  });

  it("asks for the record and a hash that is still there", () => {
    expect(ownerSet).toMatch(
      /join pubmax_private\.account_password_set s on s\.user_id = u\.id/,
    );
    expect(ownerSet).toMatch(/u\.encrypted_password <> ''/);
    expect(ownerSet).toMatch(/select exists \(/);
  });

  it("backfills from the owner's own password updates in GoTrue's audit log", () => {
    expect(ownerSet).toMatch(/a\.payload ->> 'action' = 'user_updated_password'/);
    expect(ownerSet).toMatch(/a\.payload ->> 'actor_id' = u\.id::text/);
  });

  it("keeps the read service-role only and the record out of every client role", () => {
    for (const role of ["public", "anon", "authenticated"]) {
      expect(ownerSet).toMatch(
        new RegExp(`revoke all on function public\\.account_has_password\\(uuid\\) from ${role};`),
      );
      expect(ownerSet).toMatch(
        new RegExp(`revoke all on table pubmax_private\\.account_password_set from ${role};`),
      );
    }
    expect(ownerSet).toMatch(/enable row level security/);
    expect(ownerSet).not.toMatch(/to (anon|authenticated)\b/);
    expect(ownerSet.match(/set search_path = ''/g)).toHaveLength(2);
  });

  it("applies and rolls back inside one transaction each", () => {
    for (const script of [ownerSet, ownerSetRollback]) {
      expect(script).toMatch(/\nbegin;/);
      expect(script.trimEnd().endsWith("commit;")).toBe(true);
    }
    expect(ownerSetRollback).toMatch(
      /drop trigger if exists account_password_set_on_auth_user_update on auth\.users;/,
    );
    expect(ownerSetRollback).toMatch(/drop table if exists pubmax_private\.account_password_set;/);
  });
});
