// A REVOKED seat does not block the account-join boundary either (#1294).
//
// 0135 taught `claim_plan_membership` that `membership_revoked_at is null` is
// what ACTIVE means. Both account entry points still refused before reaching
// it: their prechecks looked for ANY row carrying the account's `user_id` and
// answered `account_conflict`, so an account whose only prior seat on that Plan
// was revoked could not take a new one and the inner fix was unreachable.
//
// What this file pins is the SHAPE of 0136, because the danger in a
// `create or replace function` migration is not the change you meant - it is
// everything you did not mean to carry. The structural check below rebuilds
// both function bodies from 0134 and asserts the ONLY difference is the two
// predicate lines, so a stray edit, a dropped SET clause or a silently
// reverted body fails here rather than in production.
//
// The BEHAVIOUR - that a revoked prior seat now joins and redeems - is driven
// against real PostgreSQL in planJoinRevokedPrecheckEffective.test.ts, which
// skips loudly when the binaries are absent rather than passing quietly.
//
// REVIEW DISPOSITION: This source check is intentional. The banned shape is
// grepping component source to infer runtime behaviour, which is why
// momentPhotoEditorWiring was retired. A migration's SQL text is the shipped
// artefact, not a proxy for it. This repo already uses the same byte-identity
// check for 0099 in accountHasPassword migration coverage. The effective test
// beside this file proves behaviour against PostgreSQL, while this check catches
// what PostgreSQL cannot report: create-or-replace carrying an unintended
// change, such as a dropped SET clause.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BASE = "supabase/migrations/20260901100000_0134_plan_join_account_transition.sql";
const MIGRATION = "supabase/migrations/20260903090000_0136_plan_join_revoked_precheck.sql";
const ROLLBACK =
  "supabase/migrations/rollback/20260903090000_0136_plan_join_revoked_precheck_rollback.sql";

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

const base = read(BASE);
const sql = read(MIGRATION);
const rollback = read(ROLLBACK);

const FUNCTIONS = [
  "join_plan_account_idempotent_atomic",
  "redeem_plan_invite_account_idempotent_atomic",
] as const;

/** One function's definition, from its `create or replace` to its closing `$$;`. */
function definition(script: string, name: string): string {
  const start = script.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} is not defined in this script`).toBeGreaterThan(-1);
  const end = script.indexOf("\n$$;", start);
  expect(end, `${name} has no closing $$;`).toBeGreaterThan(start);
  return script.slice(start, end + "\n$$;".length);
}

const PRECHECK_PREDICATE = "      and membership_revoked_at is null";

describe("0136 plan account-join revoked precheck", () => {
  it("adds the active predicate to BOTH prechecks, not just the one that was noticed", () => {
    for (const name of FUNCTIONS) {
      expect(definition(sql, name), `${name} still prechecks any seat, revoked or not`).toMatch(
        /and user_id = p_user_id\n\s+and membership_revoked_at is null\n\s*\) then\n\s*return 'account_conflict';/,
      );
    }
  });

  it("changes NOTHING else in either body", () => {
    // The real hazard of `create or replace function` is what silently rides
    // along. Remove the one intended line and require an exact match with 0134.
    for (const name of FUNCTIONS) {
      const before = definition(base, name).split("\n");
      const after = definition(sql, name).split("\n");
      const added = after.filter((line) => line === PRECHECK_PREDICATE).length;
      const alreadyThere = before.filter((line) => line === PRECHECK_PREDICATE).length;
      expect(added, `${name} should add exactly one predicate line`).toBe(alreadyThere + 1);

      // Drop the FIRST predicate line 0134 did not have, then compare wholesale.
      const rebuilt: string[] = [];
      let dropped = false;
      for (const line of after) {
        if (!dropped && line === PRECHECK_PREDICATE && rebuilt.length < before.length) {
          if (before[rebuilt.length] !== PRECHECK_PREDICATE) {
            dropped = true;
            continue;
          }
        }
        rebuilt.push(line);
      }
      expect(dropped, `${name} did not add the predicate where expected`).toBe(true);
      expect(rebuilt.join("\n"), `${name} carries an unintended change`).toBe(before.join("\n"));
    }
  });

  it("restates security definer and search_path, which create-or-replace drops", () => {
    for (const name of FUNCTIONS) {
      const body = definition(sql, name);
      expect(body, `${name} lost security definer`).toMatch(/security definer/);
      expect(body, `${name} lost its pinned search_path`).toMatch(/set search_path = ''/);
    }
  });

  it("keeps the functions reachable by the service role alone", () => {
    for (const name of FUNCTIONS) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\(`));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\(`));
    }
    expect(sql).toContain("from public, anon, authenticated;");
    expect(sql).toContain("to service_role;");
    expect(sql).not.toMatch(/\) to (anon|authenticated);/);
  });

  it("applies and rolls back inside one transaction each", () => {
    for (const script of [sql, rollback]) {
      expect(script).toMatch(/\nbegin;/);
      expect(script.trimEnd().endsWith("commit;")).toBe(true);
    }
  });

  it("rolls back to 0134's bodies exactly, reopening the gap on purpose", () => {
    for (const name of FUNCTIONS) {
      expect(definition(rollback, name)).toBe(definition(base, name));
    }
  });

  it("needs no index change, because 0135 already narrowed the unique one", () => {
    // A claim this migration now allows must not then take a unique_violation
    // from a revoked row. 0135 made that index partial on active rows, so this
    // migration touching it would be a second owner of the same rule.
    expect(sql).not.toMatch(/create unique index|drop index/);
  });
});
