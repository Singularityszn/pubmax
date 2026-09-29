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

  it("keeps membership fixed after roster changes but erases links on account or Plan deletion", () => {
    const pg = database();
    plan(account("b1"), account("c1"), [
      { id: account("d2"), user: account("a1") },
      { id: account("d3"), user: account("a2") },
      { id: account("d4") },
      { id: account("d5"), user: account("a3"), revoked: true },
    ]);
    const read = () => pg.sql(`select array_to_string(account_keys, ',')
      from pubmax_private.plan_completion_group_snapshots where completion_id='${account("c1")}'`);
    expect(read()).toBe(`auth:${account("a1")},auth:${account("a2")}`);
    expect(pg.sql(`select groups_completed from pubmax_private.completion_group_week('2026-09-01')`)).toBe("1");
    pg.sql(`update public.plan_crew_members set user_id='${account("a4")}' where id='${account("d4")}';
      update public.plan_crew_members set membership_revoked_at=now() where id='${account("d3")}';
      update public.plan_crew_members set membership_revoked_at=null where id='${account("d5")}';`);
    expect(read()).toBe(`auth:${account("a1")},auth:${account("a2")}`);
    pg.sql(`delete from auth.users where id='${account("a2")}'`);
    expect(pg.sql(`select count(*) from pubmax_private.plan_completion_group_snapshots
      where completion_id='${account("c1")}'`)).toBe("0");
    expect(pg.sql(`select groups_completed from pubmax_private.completion_group_week('2026-09-01')`)).toBe("0");
    pg.sql(`delete from public.plans where id='${account("b1")}'`);
    expect(pg.sql(`select count(*) from pubmax_private.plan_completion_group_snapshots
      where completion_id='${account("c1")}'`)).toBe("0");
  });

  it("records solo and anonymous completions as measured non-groups", () => {
    const pg = database();
    plan(account("b2"), account("c2"), [{ id: account("d6"), user: account("a1") }]);
    plan(account("b3"), account("c3"), [{ id: account("d7") }]);
    expect(pg.sql(`select cardinality(account_keys) from pubmax_private.plan_completion_group_snapshots
      where completion_id='${account("c2")}'`)).toBe("1");
    expect(pg.sql(`select cardinality(account_keys) from pubmax_private.plan_completion_group_snapshots
      where completion_id='${account("c3")}'`)).toBe("0");
  });

  it("counts active Social Crew accounts and excludes removed members", () => {
    const pg = database();
    pg.sql(`insert into public.profiles(id,user_id,handle) values
      ('${account("e1")}','${account("a1")}','group-proof-linked'),
      ('${account("e2")}',null,'group-proof-clerk'),
      ('${account("e3")}',null,'group-proof-removed');
      insert into public.private_social_accounts(id,clerk_user_id,supabase_user_id,profile_id) values
      ('${account("f1")}','group-proof-linked','${account("a1")}','${account("e1")}'),
      ('${account("f2")}','group-proof-clerk',null,'${account("e2")}'),
      ('${account("f3")}','group-proof-removed',null,'${account("e3")}');
      insert into public.plans(id,title,start_time,status)
      values('${account("b4")}','Social night','2026-09-01 20:00:00+00','completed');`);
    for (const [member, social, user] of ([
      ["d8", "f1", "a1"], ["d9", "f2", null], ["da", "f3", null],
    ] as const)) {
      pg.sql(`insert into public.plan_crew_members
        (id,plan_id,name,token_hash,user_id,social_account_id,joined_at,updated_at)
        values('${account(member)}','${account("b4")}','Social member',
          md5('${member}')||md5('${member}2'),
          ${user ? `'${account(user)}'` : "null"},'${account(social)}',
          '2026-09-01 19:00:00+00','2026-09-01 19:00:00+00')`);
    }
    pg.sql(`insert into public.social_crews(id,plan_id,owner_account_id)
      values('${account("e4")}','${account("b4")}','${account("f1")}');
      insert into public.social_crew_members
        (id,crew_id,social_account_id,plan_member_id,role,state,ended_at) values
        ('${account("e5")}','${account("e4")}','${account("f1")}','${account("d8")}','owner','active',null),
        ('${account("e6")}','${account("e4")}','${account("f2")}','${account("d9")}','member','active',null),
        ('${account("e7")}','${account("e4")}','${account("f3")}','${account("da")}','member','removed','2026-09-01 19:30:00+00');
      update public.plans set social_owner_account_id='${account("f1")}' where id='${account("b4")}';
      insert into public.plan_completions
        (id,plan_id,ending,actor_member_id,route_revision,route_snapshot,completed_at)
      values('${account("c4")}','${account("b4")}','get_home','${account("d8")}',1,'[]',
        '2026-09-01 21:00:00+00')`);
    const read = () => pg.sql(`select array_to_string(account_keys, ',')
      from pubmax_private.plan_completion_group_snapshots where completion_id='${account("c4")}'`);
    expect(read()).toBe(`social:${account("f1")},social:${account("f2")}`);
    pg.sql(`update public.social_crew_members set state='active',ended_at=null
      where id='${account("e7")}'`);
    expect(read()).toBe(`social:${account("f1")},social:${account("f2")}`);
    pg.sql(`delete from auth.users where id='${account("a1")}'`);
    expect(pg.sql(`select count(*) from pubmax_private.plan_completion_group_snapshots
      where completion_id='${account("c4")}'`)).toBe("0");
  });

  it("reports only aggregate ISO-week group completions and 28-day repeats", () => {
    const pg = database();
    const keys = (members: string[]) => `array[${members.map((member) => `'auth:${account(member)}'`).join(",")}]`;
    for (const [completion, planId, date, members] of ([
      ["c5", "b5", "2027-09-01 20:00:00+00", ["a1", "a2"]],
      ["c6", "b6", "2027-09-08 20:00:00+00", ["a1", "a2"]],
      ["c7", "b7", "2027-09-08 21:00:00+00", ["a1"]],
      ["c8", "b8", "2027-09-09 20:00:00+00", ["a1", "a3"]],
      ["c9", "b9", "2027-10-08 20:00:00+00", ["a1", "a2"]],
    ] as const)) {
      pg.sql(`insert into public.plans(id,title,start_time,status)
        values('${account(planId)}','Aggregate fixture','${date}','completed')`);
      pg.sql(`insert into pubmax_private.plan_completion_group_snapshots
        (completion_id,plan_id,completed_at,account_keys)
        values('${account(completion)}','${account(planId)}','${date}',${keys([...members])})`);
    }
    const read = (week: string) => pg.sql(`select week_start::text || ':' ||
      groups_completed || ':' || groups_repeated || ':' || coalesce(repeat_rate::float8::text, 'undefined')
      from pubmax_private.completion_group_week('${week}')`);
    expect(read("2027-09-02")).toBe("2027-08-30:1:0:0");
    expect(read("2027-09-07")).toBe("2027-09-06:2:1:0.5");
    expect(read("2027-10-05")).toBe("2027-10-04:1:0:0");
    expect(read("2027-09-21")).toBe("2027-09-20:0:0:undefined");
    expect(pg.sql(`set role service_role;
      select groups_completed || ':' || groups_repeated
      from pubmax_private.completion_group_week('2027-09-07');
      reset role;`)).toBe("2:1");
    expect(pg.expectRefusal(`set role authenticated;
      select * from pubmax_private.completion_group_week('2027-09-07');
      reset role;`)).toMatch(/permission denied/i);
    pg.sql(`delete from public.plans where id='${account("b5")}'`);
    expect(read("2027-09-02")).toBe("2027-08-30:0:0:undefined");
    expect(read("2027-09-07")).toBe("2027-09-06:2:0:0");
  });

  it("matches a repeat after two account members acquire Social identities", () => {
    const pg = database();
    const firstDate = "2028-02-01 21:00:00+00";
    const secondDate = "2028-02-08 21:00:00+00";
    pg.sql(`insert into public.plans(id,title,start_time,status) values
      ('${account("ba")}','Before linking','${firstDate}','completed'),
      ('${account("bb")}','After linking','${secondDate}','completed');
      insert into public.plan_crew_members
        (id,plan_id,name,token_hash,user_id,joined_at,updated_at) values
        ('${account("fa")}','${account("ba")}','Host',md5('fa')||md5('fa2'),
          '${account("a3")}','2028-02-01 19:00:00+00','2028-02-01 19:00:00+00'),
        ('${account("fb")}','${account("ba")}','Guest',md5('fb')||md5('fb2'),
          '${account("a4")}','2028-02-01 19:00:00+00','2028-02-01 19:00:00+00');
      insert into public.plan_completions
        (id,plan_id,ending,actor_member_id,route_revision,route_snapshot,completed_at)
      values('${account("ca")}','${account("ba")}','get_home','${account("fa")}',1,'[]','${firstDate}')`);
    expect(pg.sql(`select array_to_string(account_keys, ',')
      from pubmax_private.plan_completion_group_snapshots
      where completion_id='${account("ca")}'`)).toBe(`auth:${account("a3")},auth:${account("a4")}`);

    pg.sql(`insert into public.profiles(id,user_id,handle) values
      ('${account("e8")}','${account("a3")}','repeat-link-host'),
      ('${account("e9")}','${account("a4")}','repeat-link-guest');
      insert into public.private_social_accounts(id,clerk_user_id,supabase_user_id,profile_id) values
      ('${account("f4")}','repeat-link-host','${account("a3")}','${account("e8")}'),
      ('${account("f5")}','repeat-link-guest','${account("a4")}','${account("e9")}');
      insert into public.plan_crew_members
        (id,plan_id,name,token_hash,user_id,social_account_id,joined_at,updated_at) values
        ('${account("fc")}','${account("bb")}','Host',md5('fc')||md5('fc2'),
          '${account("a3")}','${account("f4")}','2028-02-08 19:00:00+00','2028-02-08 19:00:00+00'),
        ('${account("fd")}','${account("bb")}','Guest',md5('fd')||md5('fd2'),
          '${account("a4")}','${account("f5")}','2028-02-08 19:00:00+00','2028-02-08 19:00:00+00');
      insert into public.social_crews(id,plan_id,owner_account_id)
      values('${account("ea")}','${account("bb")}','${account("f4")}');
      insert into public.social_crew_members
        (id,crew_id,social_account_id,plan_member_id,role,state,ended_at) values
        ('${account("eb")}','${account("ea")}','${account("f4")}','${account("fc")}','owner','active',null),
        ('${account("ec")}','${account("ea")}','${account("f5")}','${account("fd")}','member','active',null);
      update public.plans set social_owner_account_id='${account("f4")}'
      where id='${account("bb")}';
      insert into public.plan_completions
        (id,plan_id,ending,actor_member_id,route_revision,route_snapshot,completed_at)
      values('${account("cb")}','${account("bb")}','get_home','${account("fc")}',1,'[]','${secondDate}')`);
    expect(pg.sql(`select groups_completed || ':' || groups_repeated
      from pubmax_private.completion_group_week('2028-02-08')`)).toBe("1:1");
    pg.sql(`insert into public.plans(id,title,start_time,status)
      values('${account("bc")}','One person with two keys','2029-02-08 20:00:00+00','completed');
      insert into pubmax_private.plan_completion_group_snapshots
        (completion_id,plan_id,completed_at,account_keys)
      values('${account("cc")}','${account("bc")}','2029-02-08 21:00:00+00',
        array['auth:${account("a3")}', 'social:${account("f4")}'])`);
    expect(pg.sql(`select groups_completed || ':' || groups_repeated
      from pubmax_private.completion_group_week('2029-02-08')`)).toBe("0:0");
  });

  it("denies client roles and removes snapshot machinery on rollback", () => {
    const pg = database();
    expect(pg.expectRefusal(`set role authenticated;
      select * from pubmax_private.plan_completion_group_snapshots;
      reset role;`)).toMatch(/permission denied|row-level security/i);
    expect(pg.expectRefusal(`set role authenticated;
      select pubmax_private.erase_plan_completion_groups_on_account_delete();
      reset role;`)).toMatch(/permission denied/i);
    pg.applyFile(rollback);
    expect(pg.sql(`select to_regclass('pubmax_private.plan_completion_group_snapshots') is null`)).toBe("t");
    expect(pg.sql(`select to_regprocedure('pubmax_private.erase_plan_completion_groups_on_account_delete()') is null`)).toBe("t");
    pg.applyFile(forward);
  });
});
