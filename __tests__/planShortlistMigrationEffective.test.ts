import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const migrations = join(process.cwd(), "supabase/migrations");
const migration = "20261125100000_0275_plan_shortlist.sql";
const plan = "10000000-0000-4000-8000-000000000001";
const host = "20000000-0000-4000-8000-000000000002";
const other = "30000000-0000-4000-8000-000000000003";
const voter = "a".repeat(64);
const oldToken = "b".repeat(32);
const newToken = "c".repeat(32);
let session: PostgresSession | undefined;

function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL session unavailable");
  return session;
}

function mutate({ token = oldToken, pub = "a", member }: { token?: string; pub?: string; member?: string } = {}) {
  return JSON.parse(db().sql(`select public.mutate_plan_shortlist_atomic(
    '${plan}', '${token}', '${voter}', ${member ? `'${member}'` : "null"}, '${pub}',
    now() + interval '1 day', now() + interval '32 hours')`));
}

describe.skipIf(skipReason !== null)("0275 group night shortlist", () => {
  beforeAll(async () => {
    session = await startPostgres({ label: "plan-shortlist", database: "pubmax_plan_shortlist" });
    db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const name of readdirSync(migrations).filter((name) => name.endsWith(".sql") && name < migration).sort()) {
      db().applyFile(join(migrations, name));
    }
  }, 600_000);

  afterAll(async () => { await session?.stop(); });

  it("moves from missing support to one vote per device and one confirmed pub, then rolls back", () => {
    expect(db().sql("select to_regclass('public.plan_shortlists') is null")).toBe("t");
    db().applyFile(join(migrations, migration));
    const create = () => db().sql(`select public.create_plan_shortlist_atomic(
      '${plan}', 'Group night', now(), '${host}', 'Organiser', '${"d".repeat(64)}', now(),
      '${"e".repeat(64)}', '${"f".repeat(64)}', '[{"venueId":"a","venueName":"Pub A"},{"venueId":"b","venueName":"Pub B"}]', null)`);
    expect(create()).toBe("created");
    expect(create()).toBe("replayed");
    expect(db().sql(`select count(*) from public.plan_stops where plan_id = '${plan}'`)).toBe("0");
    expect(db().sql("select has_table_privilege('authenticated', 'plan_shortlists', 'select')")).toBe("f");
    expect(db().sql("select has_function_privilege('anon', 'public.mutate_plan_shortlist_atomic(uuid,text,text,uuid,text,timestamptz,timestamptz)', 'execute')")).toBe("f");

    db().sql(`update public.plans set invite_token = '${oldToken}' where id = '${plan}'`);
    expect(mutate().status).toBe("saved");
    expect(mutate().status).toBe("unchanged");
    expect(mutate({ pub: "b" }).shortlist.votes).toEqual({ [voter]: "b" });
    expect(mutate({ member: other }).status).toBe("forbidden");
    db().sql(`update public.plans set invite_token = '${newToken}' where id = '${plan}'`);
    expect(mutate().status).toBe("missing");
    db().sql(`update public.plan_shortlists set expires_at = now() - interval '1 second' where plan_id = '${plan}'`);
    expect(mutate({ token: newToken }).status).toBe("expired");
    db().sql(`update public.plan_shortlists set expires_at = now() + interval '1 day' where plan_id = '${plan}'`);
    expect(mutate({ member: host }).status).toBe("saved");
    expect(mutate({ token: newToken }).status).toBe("closed");
    expect(db().sql(`select venue_name from public.plan_stops where plan_id = '${plan}'`)).toBe("Pub A");

    db().applyFile(join(migrations, "rollback", migration.replace(".sql", "_rollback.sql")));
    expect(db().sql("select to_regclass('public.plan_shortlists') is null")).toBe("t");
    expect(db().sql(`select venue_name from public.plan_stops where plan_id = '${plan}'`)).toBe("Pub A");
  });
});
