import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skip = postgresSkipReason();
const migration = "20260908120000_0158_plan_group_outcomes.sql";
const root = join(process.cwd(), "supabase/migrations");
let database: PostgresSession | null = null;
function db() {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
const users = [randomUUID(), randomUUID(), randomUUID()];
const from = "2020-02-03T00:00:00Z";
const until = "2020-02-10T00:00:00Z";
const test = it.skipIf(skip !== null);

beforeAll(async () => {
  if (skip) return;
  try {
    database = await startPostgres({ label: "group-outcomes-0158", database: "pubmax_group_outcomes", maxConnections: 6 });
    db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const name of readdirSync(root).filter(name => name.endsWith(".sql") && name < migration).sort()) {
      db().applyFile(join(root, name));
    }
    db().applyFile(join(root, migration));
    db().sql("update public.plan_group_outcome_capture set started_at = '2000-01-01'");
    for (const user of users) db().sql(`insert into auth.users(id) values (${literal(user)})`);
  } catch (error) {
    await database?.stop();
    database = null;
    throw error;
  }
}, 180_000);
afterAll(async () => { await database?.stop(); });
beforeEach(() => { if (!skip) db().sql("truncate public.plans cascade"); });

function plan(accounts: Array<string | null> = users.slice(0, 2)) {
  const id = randomUUID();
  const token = randomUUID().replace(/-/g, "").repeat(2);
  db().sql(`insert into public.plans(id,title,start_time,status) values (${literal(id)},'Fixture','2020-01-01','active');
    insert into public.plan_stops(plan_id,venue_id,venue_name,position) values (${literal(id)},'fixture-pub','Fixture pub',0);`);
  accounts.forEach((user, index) => {
    const hash = index === 0 ? token : randomUUID().replace(/-/g, "").repeat(2);
    db().sql(`insert into public.plan_crew_members(id,plan_id,name,token_hash,user_id,joined_at,updated_at)
      values (${literal(randomUUID())},${literal(id)},'Member',${literal(hash)},${user ? literal(user) : "null"},
        '2020-01-01'::timestamptz + ${index} * interval '1 second','2020-01-01');`);
  });
  db().sql(`insert into public.plan_actions(id,plan_id,type,stop_position,created_at)
    values (${literal(randomUUID())},${literal(id)},'arrived',0,'2020-01-01');`);
  return { id, token };
}
type Plan = ReturnType<typeof plan>;
function complete(p: Plan, at = "2020-02-04T12:00:00Z", environment = "production", overload: 8 | 9 | 11 = 11) {
  const name = overload === 11 ? "complete_plan_with_group_outcome_atomic" : "complete_plan_atomic";
  const selection = overload === 8 ? "" : `,'{"kind":"get_home","optionId":"walk","evidenceSnapshot":{}}'::jsonb`;
  const attribution = overload === 11 ? `,${literal(environment)},'abcdef0'` : "";
  return `select public.${name}(${literal(p.id)},${literal(p.token)},1,${literal(randomUUID())},${literal(randomUUID())},
    'get_home',null${selection},${literal(at)}::timestamptz${attribution})`;
}
function outcome(excluded: string[] | null = [], specification: string | null = "fixture-reviewed-exclusions", start = from, end = until) {
  const ids = excluded === null ? "null" : `array[${excluded.map(literal).join(",")}]::uuid[]`;
  return JSON.parse(db().sql(`set role service_role;
    select coalesce(jsonb_agg(to_jsonb(w)),'[]') from public.read_plan_group_outcomes(
      ${literal(start)},${literal(end)},${ids},${specification === null ? "null" : literal(specification)}) w;`)) as Array<Record<string, unknown>>;
}
function snapshot(p: Plan) {
  return db().sql(`select jsonb_build_object('metadata',to_jsonb(o),'members',
    (select jsonb_agg(to_jsonb(a) order by position) from public.plan_group_outcome_accounts a where a.completion_id=o.completion_id))
    from public.plan_group_outcomes o join public.plan_completions c on c.id=o.completion_id where c.plan_id=${literal(p.id)}`);
}

test("counts one repeated outing despite several earlier matching groups", () => {
  db().sql(complete(plan(), "2020-01-20T12:00:00Z"));
  db().sql(complete(plan(), "2020-01-27T12:00:00Z"));
  db().sql(complete(plan(users), "2020-02-04T12:00:00Z"));
  expect(outcome()[0]).toMatchObject({ status: "ready", groups_completed: 1, groups_repeated: 1, repeat_rate: 1 });
});

test("requires two shared accounts rather than a shared seat name or one member", () => {
  db().sql(complete(plan(users.slice(0, 2)), "2020-01-20T12:00:00Z"));
  db().sql(complete(plan(users.slice(1)), "2020-02-04T12:00:00Z"));
  expect(outcome()[0]).toMatchObject({ groups_completed: 1, groups_repeated: 0, repeat_rate: 0 });
});

test.each([8, 9] as const)("preserves completion overload %s but never infers its environment", (overload) => {
  const p = plan();
  expect(db().sql(complete(p, undefined, undefined, overload))).toBe("completed");
  expect(JSON.parse(snapshot(p)).metadata).toMatchObject({ environment: null, participant_count: 2 });
  expect(outcome()[0]).toMatchObject({ status: "partial", unresolved_completions: 1, repeat_rate: null });
});

test("keeps completion snapshots immutable across retry, later claim and revocation", () => {
  const p = plan([users[0], null]);
  expect(db().sql(complete(p))).toBe("completed");
  const before = snapshot(p);
  db().sql(`update public.plan_crew_members set user_id=${literal(users[1])} where plan_id=${literal(p.id)} and user_id is null;
    update public.plan_crew_members set membership_revoked_at=now() where plan_id=${literal(p.id)} and user_id=${literal(users[0])};`);
  expect(db().sql(complete(p))).toBe("already_completed");
  expect(snapshot(p)).toBe(before);
  expect(outcome()[0]).toMatchObject({ groups_completed: 0, repeat_rate: null });
});

test("excludes revoked accounts, guest-only Plans, and Plans without endings", () => {
  const revoked = plan();
  db().sql(`update public.plan_crew_members set membership_revoked_at='2020-01-15' where plan_id=${literal(revoked.id)} and user_id=${literal(users[1])}`);
  db().sql(complete(revoked));
  db().sql(complete(plan([null, null])));
  plan();
  expect(outcome()[0]).toMatchObject({ groups_completed: 0, groups_repeated: 0, repeat_rate: null });
});

test("requires the explicit production test-account specification", () => {
  db().sql(complete(plan()));
  expect(outcome(null, null)[0]).toMatchObject({ status: "cohort_unresolved", groups_completed: null, repeat_rate: null });
  expect(outcome([users[1]])[0]).toMatchObject({ groups_completed: 0 });
  expect(outcome([])[0]).toMatchObject({ groups_completed: 1 });
});

test("excludes non-production observations from current and prior cohorts", () => {
  db().sql(complete(plan(), "2020-01-20T12:00:00Z", "preview"));
  db().sql(complete(plan(), "2020-02-04T12:00:00Z"));
  db().sql(complete(plan(), "2020-02-05T12:00:00Z", "internal-test"));
  expect(outcome()[0]).toMatchObject({ groups_completed: 1, groups_repeated: 0 });
});

test("clears deleted account identity and marks the affected cohort unresolved", () => {
  const deleted = randomUUID();
  db().sql(`insert into auth.users(id) values (${literal(deleted)})`);
  const p = plan([users[0], deleted]);
  db().sql(complete(p));
  db().sql(`delete from auth.users where id=${literal(deleted)}`);
  expect(snapshot(p)).not.toContain(deleted);
  expect(JSON.parse(snapshot(p)).metadata.participant_count).toBe(2);
  expect(outcome()[0]).toMatchObject({ status: "partial", unresolved_completions: 1, repeat_rate: null });
});

test("rolls the ending back if snapshot insertion fails", () => {
  const p = plan();
  // The snapshot constraint fails after the existing RPC has saved the ending.
  expect(db().expectRefusal(complete(p, undefined, "not-an-environment"))).toMatch(/check constraint/i);
  expect(db().sql(`select count(*) from public.plan_completions where plan_id=${literal(p.id)}`)).toBe("0");
  expect(db().sql(`select status from public.plans where id=${literal(p.id)}`)).toBe("active");
  expect(db().sql(`select count(*) from public.plan_actions where plan_id=${literal(p.id)} and type='ending'`)).toBe("0");
});

test("preserves host, arrival and Social completion guards", () => {
  const p = plan();
  expect(db().sql(complete({ ...p, token: "0".repeat(64) }))).toBe("forbidden");
  db().sql(`delete from public.plan_actions where plan_id=${literal(p.id)}`);
  expect(db().sql(complete(p))).toBe("arrival_required");
  const profile = randomUUID();
  const social = randomUUID();
  db().sql(`insert into public.profiles(id,handle) values (${literal(profile)},${literal(`fixture${profile.slice(0, 8)}`)});
    insert into public.private_social_accounts(id,clerk_user_id,profile_id) values (${literal(social)},${literal(social)},${literal(profile)});
    update public.plans set social_owner_account_id=${literal(social)} where id=${literal(p.id)};`);
  for (const overload of [8, 9, 11] as const) {
    expect(db().sql(complete(p, undefined, undefined, overload))).toBe("not_found");
  }
  expect(db().sql("select count(*) from public.plan_group_outcomes")).toBe("0");
});

test("creates only one snapshot during concurrent completion retries", async () => {
  const p = plan();
  const replies = await db().concurrentResults([complete(p), complete(p)]);
  expect(replies.sort()).toEqual(["already_completed", "completed"]);
  expect(db().sql("select count(*) from public.plan_group_outcomes")).toBe("1");
  expect(db().sql("select count(*) from public.plan_group_outcome_accounts")).toBe("2");
});

test("keeps a completion snapshot stable when an account claim races completion", async () => {
  const p = plan([users[0], null]);
  const seat = db().sql(`select id from public.plan_crew_members where plan_id=${literal(p.id)} and user_id is null`);
  const results = await db().concurrentResults([
    `select public.claim_plan_membership('${p.id}','${seat}','${users[1]}')`,
    complete(p),
  ]);
  expect(results).toEqual(["claimed", "completed"]);
  const before = snapshot(p);
  const saved = JSON.parse(before);
  expect([1, 2]).toContain(saved.metadata.participant_count);
  expect(saved.members).toHaveLength(saved.metadata.participant_count);
  db().sql(complete(p));
  expect(snapshot(p)).toBe(before);
});

test.each(["2020-01-07T12:00:00Z", "2020-01-07T11:59:59Z", "2020-02-04T12:00:00Z"])("holds the 28-day and strict-earlier boundary at %s", (earlier) => {
  db().sql(complete(plan(), earlier));
  db().sql(complete(plan(), "2020-02-04T12:00:00Z"));
  expect(outcome()[0].groups_repeated).toBe(earlier === "2020-01-07T12:00:00Z" ? 1 : 0);
});

test("uses London ISO weeks across the summer clock boundary", () => {
  db().sql(complete(plan(), "2020-03-29T23:30:00Z"));
  const weeks = outcome([], "fixture-reviewed-exclusions", "2020-03-23T00:00:00Z", "2020-04-05T23:00:00Z");
  expect(weeks.map(w => [w.week_start, w.groups_completed])).toEqual([["2020-03-23", 0], ["2020-03-30", 1]]);
});

test("reports incomplete capture coverage without inventing an empty history", () => {
  db().sql("update public.plan_group_outcome_capture set started_at='2020-02-01'");
  try {
    expect(outcome()[0]).toMatchObject({ status: "partial", repeat_rate: null });
  } finally {
    db().sql("update public.plan_group_outcome_capture set started_at='2000-01-01'");
  }
});

test("refuses browser reads, writes and execution, including private helper calls", () => {
  const p = plan();
  db().sql(complete(p));
  for (const role of ["anon", "authenticated"]) {
    for (const table of ["plan_group_outcomes", "plan_group_outcome_accounts", "plan_group_outcome_capture"]) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        expect(db().sql(`select has_table_privilege('${role}','public.${table}','${privilege}')`)).toBe("f");
      }
      for (const statement of [`select * from public.${table}`, `delete from public.${table}`]) {
        expect(db().expectRefusal(`set role ${role}; ${statement}`)).toMatch(/permission denied/i);
      }
    }
    expect(db().expectRefusal(`set role ${role}; select * from public.read_plan_group_outcomes('${from}','${until}')`)).toMatch(/permission denied/i);
    expect(db().expectRefusal(`set role ${role}; ${complete(p)}`)).toMatch(/permission denied/i);
  }
  expect(db().expectRefusal(`set role service_role; select public._0158_capture_plan_group_outcome('${p.id}',null,null)`)).toMatch(/permission denied/i);
  expect(db().expectRefusal("set role service_role; update public.plan_group_outcomes set participant_count=20")).toMatch(/permission denied/i);
  expect(JSON.stringify(outcome())).not.toMatch(new RegExp([p.id, ...users].join("|")));
});

test("rolls back both overloads without changing completed Plans", () => {
  const p = plan();
  db().sql(complete(p));
  const before = db().sql("select jsonb_agg(to_jsonb(c)) from public.plan_completions c");
  db().applyFile(join(root, "rollback/20260908120000_0158_plan_group_outcomes_rollback.sql"));
  expect(db().sql("select jsonb_agg(to_jsonb(c)) from public.plan_completions c")).toBe(before);
  expect(db().sql(complete(p, undefined, undefined, 9))).toBe("already_completed");
  expect(db().sql(complete(plan(), undefined, undefined, 8))).toBe("completed");
  expect(db().sql("select to_regclass('public.plan_group_outcomes') is null")).toBe("t");
});
