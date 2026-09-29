import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const migrations = join(process.cwd(), "supabase/migrations");
const name = "20260929235900_0169_completion_group_snapshot.sql";
const forward = join(migrations, name);
const rollback = join(migrations, "rollback/20260929235900_0169_completion_group_snapshot_rollback.sql");
const prerequisites = readdirSync(migrations)
  .filter((file) => file.endsWith(".sql") && file < name)
  .sort()
  .map((file) => join(migrations, file));

const account = (suffix: string) => `00000000-0000-4000-8000-0000000000${suffix}`;
let db: PostgresSession | null = null;

function database(): PostgresSession {
  if (!db) throw new Error("PostgreSQL session unavailable");
  return db;
}

function plan(id: string, completion: string, members: Array<{ id: string; user?: string; revoked?: boolean }>): void {
  const pg = database();
  pg.sql(`insert into public.plans(id,title,start_time,status)
    values('${id}','Measured night','2026-09-01 20:00:00+00','completed')`);
  for (const member of members) {
    pg.sql(`insert into public.plan_crew_members
      (id,plan_id,name,token_hash,user_id,joined_at,updated_at,membership_revoked_at)
      values('${member.id}','${id}','Member',md5('${member.id}')||md5('${member.id}2'),
        ${member.user ? `'${member.user}'` : "null"},
        '2026-09-01 19:00:00+00','2026-09-01 19:00:00+00',
        ${member.revoked ? "'2026-09-01 19:30:00+00'" : "null"})`);
  }
  pg.sql(`insert into public.plan_completions
    (id,plan_id,ending,actor_member_id,route_revision,route_snapshot,completed_at)
    values('${completion}','${id}','get_home','${members[0]?.id ?? id}',1,'[]',
      '2026-09-01 21:00:00+00')`);
}

beforeAll(async () => {
  if (skipReason) return;
  db = await startPostgres({ label: "group-0169", database: "pubmax_group_0169" });
  db.applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
  for (const file of prerequisites) db.applyFile(file);
  db.sql(`insert into auth.users(id) values
    ('${account("a1")}'),('${account("a2")}'),('${account("a3")}'),('${account("a4")}')`);
  plan(account("b0"), account("c0"), [{ id: account("d0"), user: account("a1") }]);
  db.applyFile(forward);
}, 300_000);

afterAll(async () => {
  if (db) await db.stop();
  db = null;
});

describe.skipIf(skipReason !== null)("0169 private completion membership snapshot", () => {
  it("leaves older completions unmeasured even when their roster changes", () => {
    const pg = database();
    pg.sql(`insert into public.plan_crew_members
      (id,plan_id,name,token_hash,user_id,joined_at,updated_at)
      values('${account("d1")}','${account("b0")}','Late',
        md5('late')||md5('late2'),'${account("a2")}',now(),now())`);
    expect(pg.sql(`select count(*) from pubmax_private.plan_completion_group_snapshots
      where completion_id='${account("c0")}'`)).toBe("0");
  });

  it("keeps distinct active accounts fixed after claim, revoke and deletion", () => {
    const pg = database();
    plan(account("b1"), account("c1"), [
      { id: account("d2"), user: account("a1") },
      { id: account("d3"), user: account("a2") },
      { id: account("d4") },
      { id: account("d5"), user: account("a3"), revoked: true },
    ]);
    const read = () => pg.sql(`select array_to_string(account_ids, ',')
      from pubmax_private.plan_completion_group_snapshots where completion_id='${account("c1")}'`);
    expect(read()).toBe(`${account("a1")},${account("a2")}`);
    pg.sql(`update public.plan_crew_members set user_id='${account("a4")}' where id='${account("d4")}';
      update public.plan_crew_members set membership_revoked_at=now() where id='${account("d3")}';
      update public.plan_crew_members set membership_revoked_at=null where id='${account("d5")}';
      delete from auth.users where id='${account("a2")}';`);
    expect(read()).toBe(`${account("a1")},${account("a2")}`);
    pg.sql(`delete from public.plans where id='${account("b1")}'`);
    expect(read()).toBe(`${account("a1")},${account("a2")}`);
  });

  it("records solo and anonymous completions as measured non-groups", () => {
    const pg = database();
    plan(account("b2"), account("c2"), [{ id: account("d6"), user: account("a1") }]);
    plan(account("b3"), account("c3"), [{ id: account("d7") }]);
    expect(pg.sql(`select cardinality(account_ids) from pubmax_private.plan_completion_group_snapshots
      where completion_id='${account("c2")}'`)).toBe("1");
    expect(pg.sql(`select cardinality(account_ids) from pubmax_private.plan_completion_group_snapshots
      where completion_id='${account("c3")}'`)).toBe("0");
  });

  it("denies client roles and removes snapshot machinery on rollback", () => {
    const pg = database();
    expect(pg.expectRefusal(`set role authenticated;
      select * from pubmax_private.plan_completion_group_snapshots;
      reset role;`)).toMatch(/permission denied|row-level security/i);
    pg.applyFile(rollback);
    expect(pg.sql(`select to_regclass('pubmax_private.plan_completion_group_snapshots') is null`)).toBe("t");
    pg.applyFile(forward);
  });
});
