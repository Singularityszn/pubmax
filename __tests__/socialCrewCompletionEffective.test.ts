import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const migrations = join(process.cwd(), "supabase/migrations");
const name = "20260930090000_0170_social_crew_completion.sql";
const forward = join(migrations, name);
const prerequisites = readdirSync(migrations).filter((file) => file.endsWith(".sql") && file < name).sort();
const id = (suffix: string) => `00000000-0000-4000-8000-0000000000${suffix}`;
let db: PostgresSession | null = null;

function pg(): PostgresSession {
  if (!db) throw new Error("PostgreSQL session unavailable");
  return db;
}

const crewId = id("e0");
const planId = id("b0");
const host = id("f1");
const member = id("f2");
const removed = id("f3");
const stranger = id("f4");

function complete(actor: string, revision = 1, arrival = 0): string {
  return pg().sql(`select public.complete_social_crew_plan_atomic(
    '${actor}', '${crewId}', ${revision}, '${id("c0")}', '${id("d0")}', '${id("d1")}',
    ${arrival}, 'get_home', null,
    '{"kind":"get_home","optionId":"transport:home","evidenceSnapshot":{}}'::jsonb,
    '2030-03-06 21:00:00+00'::timestamptz)`);
}

beforeAll(async () => {
  if (skipReason) return;
  db = await startPostgres({ label: "social-complete-0170", database: "pubmax_social_complete" });
  db.applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
  for (const file of prerequisites) db.applyFile(join(migrations, file));
  for (const [account, auth, profile, planMember] of ([
    ["f1", "a1", "e1", "a5"],
    ["f2", "a2", "e2", "a6"],
    ["f3", "a3", "e3", "a7"],
    ["f4", "a4", "e4", null],
  ] as const)) {
    db.sql(`insert into auth.users(id) values('${id(auth)}');
      insert into public.profiles(id,user_id,handle) values('${id(profile)}','${id(auth)}','social-complete-${account}');
      insert into public.private_social_accounts(id,clerk_user_id,supabase_user_id,profile_id)
      values('${id(account)}','social-complete-${account}','${id(auth)}','${id(profile)}');`);
    if (planMember) {
      db.sql(`insert into public.plans(id,title,start_time,status)
        values('${planId}','Social completion night','2030-03-06 20:00:00+00','active')
        on conflict (id) do nothing;
        insert into public.plan_crew_members
          (id,plan_id,name,token_hash,user_id,social_account_id,joined_at,updated_at)
        values('${id(planMember)}','${planId}','Member',md5('${planMember}')||md5('${planMember}2'),
          '${id(auth)}','${id(account)}','2030-03-06 19:00:00+00','2030-03-06 19:00:00+00');`);
    }
  }
  db.sql(`insert into public.plan_stops(plan_id,venue_id,venue_name,position)
    values('${planId}','social-pub','Social Pub',0);
    insert into public.social_crews(id,plan_id,owner_account_id)
    values('${crewId}','${planId}','${host}');
    insert into public.social_crew_members
      (id,crew_id,social_account_id,plan_member_id,role,state,ended_at) values
      ('${id("e5")}','${crewId}','${host}','${id("a5")}','owner','active',null),
      ('${id("e6")}','${crewId}','${member}','${id("a6")}','member','active',null),
      ('${id("e7")}','${crewId}','${removed}','${id("a7")}','member','removed','2030-03-06 19:30:00+00');
    update public.plans set social_owner_account_id='${host}' where id='${planId}';`);
}, 300_000);

afterAll(async () => {
  if (db) await db.stop();
  db = null;
});

describe.skipIf(skipReason !== null)("Social Crew completion through authorized RPC", () => {
  it("refuses nonowners and stale revisions without a side effect", () => {
    pg().applyFile(forward);
    for (const actor of [member, removed, stranger]) expect(complete(actor)).toBe("not_found");
    expect(complete(host, 2)).toBe("conflict");
    expect(complete(host, 1, 7)).toBe("invalid");
    expect(pg().sql(`select count(*) from public.plan_completions where plan_id='${planId}'`)).toBe("0");
    expect(pg().sql(`select count(*) from public.plan_actions where plan_id='${planId}'`)).toBe("0");
  });

  it("serializes two service-role owner completions into one private group snapshot", async () => {
    const startsAt = new Date(Date.now() + 1200).toISOString();
    const finish = (suffix: string) => `begin;
      set local role service_role;
      set local statement_timeout = '10s';
      select pg_sleep(greatest(0, extract(epoch from timestamptz '${startsAt}' - clock_timestamp())));
      select public.complete_social_crew_plan_atomic(
        '${host}','${crewId}',1,'${id(`c${suffix}`)}','${id(`d${suffix}`)}','${id(`e${suffix}`)}',
        0,'get_home',null,
        '{"kind":"get_home","optionId":"transport:home","evidenceSnapshot":{}}'::jsonb,
        '2030-03-06 21:00:00+00'::timestamptz);
      commit;`;
    const results = await Promise.all([
      pg().sqlAsync(finish("2")),
      pg().sqlAsync(finish("3")),
    ]);
    expect(results.sort()).toEqual(["already_completed", "completed"]);
    expect(complete(host)).toBe("already_completed");
    expect(pg().sql(`select status || ':' || ending from public.plans where id='${planId}'`)).toBe("completed:get_home");
    expect(pg().sql(`select count(*) from public.plan_completions where plan_id='${planId}'`)).toBe("1");
    expect(pg().sql(`select string_agg(type, ',' order by type) from public.plan_actions where plan_id='${planId}'`)).toBe("arrived,ending");
    expect(pg().sql(`select array_to_string(account_keys, ',')
      from pubmax_private.plan_completion_group_snapshots where plan_id='${planId}'`))
      .toBe(`social:${host},social:${member}`);
    expect(pg().sql(`select groups_completed || ':' || groups_repeated
      from pubmax_private.completion_group_week('2030-03-06')`)).toBe("1:0");
  });

  it("does not grant clients direct completion access", () => {
    expect(pg().expectRefusal(`set role authenticated;
      select public.complete_social_crew_plan_atomic('${host}','${crewId}',1,
        '${id("c1")}','${id("d2")}','${id("d3")}',0,'get_home',null,'{}'::jsonb,now());
      reset role;`)).toMatch(/permission denied/i);
  });

  it("removes the write path on rollback without erasing completed records", () => {
    pg().applyFile(join(migrations, "rollback/20260930090000_0170_social_crew_completion_rollback.sql"));
    expect(pg().sql(`select to_regprocedure('public.complete_social_crew_plan_atomic(uuid,uuid,integer,uuid,uuid,uuid,integer,text,text,jsonb,timestamptz)') is null`)).toBe("t");
    expect(pg().sql(`select count(*) from public.plan_completions where plan_id='${planId}'`)).toBe("1");
  });
});
