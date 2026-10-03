// Effective PostgreSQL proof for 0172.
//
// Before this migration a signed-in role can still write tables the app
// only writes through the service role, anon can write two messaging tables
// the later SELECT grant never revoked, and report_pint_drop is an invoker
// that a signed-in call cannot run after 0171. After 0172 those writes are
// refused, the kept reads still answer, a service-role call reports a drop,
// and the rollback puts the writes back.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20261003070000_0172_public_grant_sweep.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20261003070000_0172_public_grant_sweep_rollback.sql",
);
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

const READER = "11111111-0000-4000-8000-0000000000a1";
const PROFILE = "e1000000-0000-4000-8000-000000000001";
const DROP = "e2000000-0000-4000-8000-000000000009";

const WRITE_TABLES = [
  "check_ins",
  "conversation_members",
  "crawl_stories",
  "follows",
  "message_poll_votes",
  "night_profiles",
  "pub_pal_mastery_events",
  "pub_pal_memories",
  "pub_pals",
  "saved_list_follows",
  "saved_lists",
  "saved_pubs",
  "step_out_nudge_prefs",
  "wanteds",
] as const;

let database: PostgresSession | null = null;

function requireDatabase(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}

function lastLine(said: string): string {
  const lines = said
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== "BEGIN" && line !== "COMMIT");
  return lines[lines.length - 1] ?? "";
}

function tablePriv(role: string, table: string, privilege: string): string {
  return requireDatabase().sql(
    `select has_table_privilege('${role}', 'public.${table}', '${privilege}');`,
  );
}

function columnPriv(role: string, table: string, column: string): string {
  return requireDatabase().sql(
    `select has_column_privilege('${role}', 'public.${table}', '${column}', 'select');`,
  );
}

function functionPriv(role: string): string {
  return requireDatabase().sql(
    `select has_function_privilege('${role}', 'public.report_pint_drop(uuid, text, integer)', 'execute');`,
  );
}

function definer(): string {
  return requireDatabase().sql(
    `select p.prosecdef::text
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'report_pint_drop';`,
  );
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startPostgres({ label: "grant-sweep", database: "pubmax_grant_sweep" });
  const session = requireDatabase();
  session.applyFile(SESSION_FIXTURE);
  for (const path of PREREQUISITES) session.applyFile(path);
  session.sql(
    [
      `insert into auth.users (id) values ('${READER}');`,
      `insert into public.profiles (id, user_id, handle) values ('${PROFILE}', '${READER}', 'doorsweep');`,
      `insert into public.pint_drops (id, venue_id, handle, price_gbp, status, visibility, created_at)`,
      `values ('${DROP}', 'venue-sweep', 'doorsweep', 4.20, 'visible', 'public', '2026-10-03 06:00:00+01');`,
      `grant truncate on table public.wanteds to authenticated;`,
    ].join("\n"),
  );
}, 300_000);

afterAll(async () => {
  await database?.stop();
  database = null;
});

describe.skipIf(skipReason !== null)("0172 public grant sweep", () => {
  it("BEFORE: client writes and an invoker report are still open", () => {
    for (const table of WRITE_TABLES) {
      expect(tablePriv("authenticated", table, "insert"), table).toBe("t");
    }
    expect(tablePriv("anon", "conversation_members", "insert")).toBe("t");
    expect(tablePriv("anon", "message_poll_votes", "delete")).toBe("t");
    expect(tablePriv("authenticated", "wanteds", "truncate")).toBe("t");
    expect(tablePriv("authenticated", "profiles", "select")).toBe("t");
    expect(tablePriv("authenticated", "pint_drops", "select")).toBe("f");
    expect(columnPriv("authenticated", "plan_crew_members", "id")).toBe("t");
    expect(columnPriv("authenticated", "plan_crew_members", "token_hash")).toBe("f");
    expect(definer()).toBe("false");
    expect(functionPriv("authenticated")).toBe("t");

    const refusal = requireDatabase().expectRefusal(
      [
        "begin;",
        `set local request.jwt.claims = '{"sub":"${READER}","role":"authenticated"}';`,
        "set local role authenticated;",
        `select public.report_pint_drop('${DROP}', 'spam', 2);`,
        "commit;",
      ].join("\n"),
    );
    expect(refusal).toMatch(/permission denied/i);
  });

  it("closes client writes, keeps the reads, and lets the service role report", () => {
    const session = requireDatabase();
    session.applyFile(FORWARD);

    for (const table of WRITE_TABLES) {
      expect(tablePriv("authenticated", table, "insert"), table).toBe("f");
      expect(tablePriv("authenticated", table, "select"), table).toBe("t");
      expect(tablePriv("service_role", table, "insert"), table).toBe("t");
    }
    expect(tablePriv("authenticated", "notifications", "update")).toBe("f");
    expect(tablePriv("authenticated", "notifications", "select")).toBe("t");
    expect(tablePriv("anon", "conversation_members", "insert")).toBe("f");
    expect(tablePriv("anon", "conversation_members", "select")).toBe("f");
    expect(tablePriv("anon", "message_poll_votes", "select")).toBe("f");
    expect(tablePriv("anon", "crawl_stories", "insert")).toBe("f");
    expect(tablePriv("anon", "crawl_stories", "select")).toBe("t");
    expect(tablePriv("anon", "drinks", "select")).toBe("t");
    expect(tablePriv("authenticated", "wanteds", "truncate")).toBe("f");
    expect(tablePriv("authenticated", "wanteds", "references")).toBe("f");
    expect(tablePriv("authenticated", "wanteds", "trigger")).toBe("f");
    expect(tablePriv("authenticated", "profiles", "select")).toBe("t");
    expect(tablePriv("authenticated", "profiles", "update")).toBe("f");
    expect(tablePriv("authenticated", "pint_drops", "select")).toBe("f");
    expect(tablePriv("service_role", "pint_drops", "select")).toBe("t");
    expect(columnPriv("authenticated", "plan_crew_members", "id")).toBe("t");
    expect(columnPriv("authenticated", "plan_crew_members", "token_hash")).toBe("f");
    expect(columnPriv("authenticated", "plan_crew_members", "social_account_id")).toBe("f");
    expect(columnPriv("authenticated", "plans", "title")).toBe("t");
    expect(columnPriv("authenticated", "plans", "social_owner_account_id")).toBe("f");
    expect(columnPriv("authenticated", "community_prices", "price_pennies")).toBe("t");
    expect(columnPriv("authenticated", "community_prices", "contributor_handle")).toBe("f");
    expect(columnPriv("anon", "night_signal_claims", "claim")).toBe("t");

    const ownProfile = lastLine(
      session.sql(
        [
          "begin;",
          `set local request.jwt.claims = '{"sub":"${READER}","role":"authenticated"}';`,
          "set local role authenticated;",
          `select handle from public.profiles where id = '${PROFILE}';`,
          "commit;",
        ].join("\n"),
      ),
    );
    expect(ownProfile).toBe("doorsweep");

    const writeRefusal = session.expectRefusal(
      [
        "begin;",
        "set local role authenticated;",
        "insert into public.wanteds (owner_actor, venue_kind) values ('profile:x', 'pending');",
        "commit;",
      ].join("\n"),
    );
    expect(writeRefusal).toMatch(/permission denied/i);

    expect(definer()).toBe("true");
    expect(functionPriv("anon")).toBe("f");
    expect(functionPriv("authenticated")).toBe("f");
    expect(functionPriv("public")).toBe("f");
    expect(functionPriv("service_role")).toBe("t");

    const reported = lastLine(
      session.sql(
        [
          "begin;",
          "set local role service_role;",
          `select public.report_pint_drop('${DROP}', 'spam', 2);`,
          "commit;",
        ].join("\n"),
      ),
    );
    expect(reported).toBe("1");
    expect(session.sql(`select status from public.pint_drops where id = '${DROP}';`)).toBe("visible");

    const signedIn = session.expectRefusal(
      [
        "begin;",
        "set local role authenticated;",
        `select public.report_pint_drop('${DROP}', 'again', 2);`,
        "commit;",
      ].join("\n"),
    );
    expect(signedIn).toMatch(/permission denied/i);
  });

  it("rolls the writes and the invoker function back, and leaves truncate closed", () => {
    const session = requireDatabase();
    session.applyFile(ROLLBACK);

    expect(tablePriv("authenticated", "wanteds", "insert")).toBe("t");
    expect(tablePriv("authenticated", "saved_pubs", "update")).toBe("t");
    expect(tablePriv("anon", "conversation_members", "insert")).toBe("t");
    expect(tablePriv("authenticated", "profiles", "select")).toBe("t");
    expect(tablePriv("authenticated", "wanteds", "truncate")).toBe("f");
    expect(definer()).toBe("false");
    expect(functionPriv("authenticated")).toBe("t");
    expect(columnPriv("authenticated", "plan_crew_members", "token_hash")).toBe("f");
  });
});
