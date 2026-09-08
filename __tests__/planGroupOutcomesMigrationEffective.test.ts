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
const users = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
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
    expect(db().sql("select count(*) from public.plan_group_outcome_specifications")).toBe("0");
    expect(db().sql("select count(*) from public.plan_group_outcome_classifications")).toBe("0");
    db().sql("update public.plan_group_outcome_capture set started_at = '2000-01-01'");
    for (const user of users) db().sql(`insert into auth.users(id) values (${literal(user)})`);
  } catch (error) {
    await database?.stop();
    database = null;
    throw error;
  }
}, 180_000);
afterAll(async () => { await database?.stop(); });
beforeEach(() => {
  if (skip) return;
  db().sql(`truncate public.plans cascade;
    delete from public.plan_group_outcome_classifications;
    delete from public.plan_group_outcome_specifications;
    insert into public.plan_group_outcome_specifications
      (reference,authority_reference,approved_at,effective_from,effective_until,mixed_roster_policy,london_scope_rule)
      values ('fixture-reviewed','fixture-authority','1999-01-01','2000-01-01','2100-01-01','exclude_outing','all_stops_london');`);
  for (const user of users) classify(user);
});

// These are explicit synthetic policies. Neither is an approved production policy.
function classify(user: string, eligible = true) {
  db().sql(`insert into public.plan_group_outcome_classifications
    (specification_reference,user_id,eligible,evidence_reference,recorded_at,effective_from,effective_until)
    values ('fixture-reviewed',${literal(user)},${eligible},'fixture-evidence','1999-01-01','2000-01-01','2100-01-01')`);
}

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
function complete(p: Plan, at = "2020-02-04T12:00:00Z", environment = "production", overload: 8 | 9 | 14 = 14, scope = "london", scopeRevision = 1, scopeIds = ["fixture-pub"]) {
  const name = overload === 14 ? "complete_plan_with_group_outcome_atomic" : "complete_plan_atomic";
  const selection = overload === 8 ? "" : `,'{"kind":"get_home","optionId":"walk","evidenceSnapshot":{}}'::jsonb`;
  const attribution = overload === 14 ? `,${literal(environment)},'abcdef0',${literal(scope)},${scopeRevision},array[${scopeIds.map(literal).join(',')}]::text[]` : "";
  return `select public.${name}(${literal(p.id)},${literal(p.token)},1,${literal(randomUUID())},${literal(randomUUID())},
    'get_home',null${selection},${literal(at)}::timestamptz${attribution})`;
}
function outcome(reference: string | null = "fixture-reviewed", start = from, end = until) {
  return JSON.parse(db().sql(`set role service_role;
    select coalesce(jsonb_agg(to_jsonb(w)),'[]') from public.read_plan_group_outcomes(
      ${literal(start)},${literal(end)},${reference === null ? "null" : literal(reference)}) w;`)) as Array<Record<string, unknown>>;
}
function snapshot(p: Plan) {
  return db().sql(`select jsonb_build_object('metadata',to_jsonb(o),'members',
    (select jsonb_agg(to_jsonb(a) order by position) from public.plan_group_outcome_accounts a where a.completion_id=o.completion_id))
    from public.plan_group_outcomes o join public.plan_completions c on c.id=o.completion_id where c.plan_id=${literal(p.id)}`);
}

/** Hold the first transaction after its write, then prove the second waits on a lock. */
async function orderedWrites(firstSql: string, secondSql: string) {
  const label = `m1-${randomUUID()}`;
  const names = ["gate", "first", "second"].map(part => `${label}-${part}`);
  const key = `hashtextextended(${literal(label)},0)`;
  const pending: Array<ReturnType<PostgresSession["attempt"]>> = [];
  async function waitFor(name: string, event: string) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await db().sqlAsync(`select exists(select 1 from pg_stat_activity where datname=current_database()
        and application_name=${literal(name)} and ${event})`) === "t") return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Expected lock state for ${name}`);
  }
  try {
    pending.push(db().attempt(`set application_name=${literal(names[0])}; set statement_timeout='10s';
      select pg_advisory_lock(${key}); select pg_sleep(9)`));
    await waitFor(names[0], "wait_event='PgSleep'");
    pending.push(db().attempt(`begin; set local application_name=${literal(names[1])}; set local statement_timeout='8s';
      ${firstSql}; select pg_advisory_xact_lock(${key}); commit`));
    await waitFor(names[1], "wait_event_type='Lock'");
    pending.push(db().attempt(`begin; set local application_name=${literal(names[2])}; set local statement_timeout='8s';
      ${secondSql}; commit`));
    await waitFor(names[2], "wait_event_type='Lock'");
    db().sql(`select pg_terminate_backend(pid) from pg_stat_activity
      where datname=current_database() and application_name=${literal(names[0])}`);
    const results = await Promise.all(pending);
    expect(results[1]).toEqual({ ok: true, said: "" });
    expect(results[2]).toEqual({ ok: true, said: "" });
  } finally {
    db().sql(`select pg_terminate_backend(pid) from pg_stat_activity where datname=current_database()
      and application_name in (${names.map(literal).join(",")})`);
    await Promise.all(pending);
  }
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

test.each([8, 9] as const)("excludes known one-account legacy %s targets and priors before attribution checks", (overload) => {
  db().sql(complete(plan([users[0]]), "2020-01-20T12:00:00Z", undefined, overload));
  db().sql(complete(plan([users[1]]), "2020-02-04T12:00:00Z", undefined, overload));
  db().sql(complete(plan()));
  expect(outcome()[0]).toMatchObject({ status: "ready", groups_completed: 1, groups_repeated: 0, repeat_rate: 0, unresolved_completions: 0 });
});

test.each([8, 9] as const)("keeps a legacy %s two-account prior unresolved", (overload) => {
  db().sql(complete(plan(), "2020-01-20T12:00:00Z", undefined, overload));
  db().sql(complete(plan()));
  expect(outcome()[0]).toMatchObject({ status: "partial", groups_completed: 1, groups_repeated: 0, repeat_rate: null });
});

test("does not backfill unknown classification after later evidence arrives", () => {
  db().sql(`delete from public.plan_group_outcome_classifications where user_id=${literal(users[1])}`);
  const prior = plan();
  db().sql(complete(prior, "2020-01-20T12:00:00Z"));
  const before = snapshot(prior);
  classify(users[1]);
  db().sql(complete(plan()));
  expect(snapshot(prior)).toBe(before);
  expect(outcome()[0]).toMatchObject({ status: "partial", groups_completed: 1, groups_repeated: 0, repeat_rate: null });
});

test("requires approval, explicit policy, and applicable account evidence", () => {
  expect(db().expectRefusal("update public.plan_group_outcome_specifications set mixed_roster_policy=null")).toMatch(/not-null constraint/i);
  expect(db().expectRefusal("update public.plan_group_outcome_specifications set mixed_roster_policy='unspecified'")).toMatch(/check constraint/i);
  expect(db().expectRefusal("update public.plan_group_outcome_specifications set approved_at='2020-01-01'")).toMatch(/check constraint/i);
  expect(db().expectRefusal("update public.plan_group_outcome_classifications set recorded_at='2020-01-01'")).toMatch(/check constraint/i);
  db().sql(`update public.plan_group_outcome_classifications set effective_until='2020-02-01' where user_id=${literal(users[1])}`);
  db().sql(complete(plan()));
  expect(outcome()[0]).toMatchObject({ status: "partial", groups_completed: 0, repeat_rate: null });
});

test("treats overlapping classification as unknown even if both rows say eligible", () => {
  classify(users[1]);
  db().sql(complete(plan()));
  expect(outcome()[0]).toMatchObject({ status: "partial", groups_completed: 0, repeat_rate: null });
});

test("prevents a policy change after a completion has captured its specification", () => {
  db().sql(complete(plan()));
  expect(db().expectRefusal("update public.plan_group_outcome_specifications set mixed_roster_policy='eligible_accounts_only'"))
    .toMatch(/captured cohort specification cannot change/i);
});

test("does not mix different specification versions across prior history", () => {
  db().sql("update public.plan_group_outcome_specifications set effective_until='2020-02-01'");
  db().sql(complete(plan(), "2020-01-20T12:00:00Z"));
  db().sql(`insert into public.plan_group_outcome_specifications
    (reference,authority_reference,approved_at,effective_from,effective_until,mixed_roster_policy,london_scope_rule)
    values ('fixture-v2','fixture-authority','2020-01-01','2020-02-01','2100-01-01','exclude_outing','all_stops_london');
    insert into public.plan_group_outcome_classifications
    (specification_reference,user_id,eligible,evidence_reference,recorded_at,effective_from,effective_until)
    select 'fixture-v2',user_id,eligible,'fixture-v2-evidence','2020-01-01','2020-02-01','2100-01-01'
    from public.plan_group_outcome_classifications`);
  db().sql(complete(plan()));
  expect(outcome("fixture-v2")[0]).toMatchObject({ status: "partial", groups_completed: 1, groups_repeated: 0, repeat_rate: null });
});

test("requires classification coverage even for an empty interval", () => {
  db().sql("update public.plan_group_outcome_specifications set effective_from='2020-02-01'");
  expect(outcome()[0]).toMatchObject({ status: "partial", groups_completed: 0, repeat_rate: null });
});

test.each(["unknown", "mixed", "other_city"])("keeps %s route evidence separate from known London", (scope) => {
  db().sql(complete(plan(), "2020-01-20T12:00:00Z", undefined, 14, scope));
  db().sql(complete(plan()));
  db().sql(complete(plan(), "2020-02-05T12:00:00Z", undefined, 14, scope));
  expect(outcome()[0]).toMatchObject({ status: scope === "other_city" ? "ready" : "partial", groups_completed: 1, groups_repeated: 0,
    repeat_rate: scope === "other_city" ? 0 : null });
});

test("refuses stale revision or Stop evidence without refusing the saved ending", () => {
  for (const [revision, ids] of [[2, ["fixture-pub"]], [1, ["another-pub"]]] as const) {
    const p = plan();
    expect(db().sql(complete(p, undefined, undefined, 14, "london", revision, [...ids]))).toBe("completed");
    expect(JSON.parse(snapshot(p)).metadata).toMatchObject({ route_scope: "unknown", cohort_eligibility: "unknown" });
  }
  expect(outcome()[0]).toMatchObject({ status: "partial", groups_completed: 0, repeat_rate: null });
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

test("a reference cannot invent an approved population or account classification", () => {
  db().sql(complete(plan()));
  for (const reference of [null, "unregistered-reference"]) {
    expect(outcome(reference)[0]).toMatchObject({ status: "cohort_unresolved", groups_completed: null, repeat_rate: null });
  }
  db().sql(`delete from public.plan_group_outcome_classifications where user_id=${literal(users[1])}`);
  db().sql(complete(plan(), "2020-02-05T12:00:00Z"));
  expect(outcome()[0]).toMatchObject({ status: "partial", groups_completed: 1, repeat_rate: null });
});

test.each(["exclude_outing", "eligible_accounts_only"])("applies the explicit fixture policy %s to both repeat sides", (policy) => {
  db().sql(`update public.plan_group_outcome_specifications set mixed_roster_policy=${literal(policy)};
    update public.plan_group_outcome_classifications set eligible=false where user_id=${literal(users[2])}`);
  db().sql(complete(plan(users.slice(0, 3)), "2020-01-20T12:00:00Z"));
  db().sql(complete(plan(users.slice(0, 3))));
  expect(outcome()[0]).toMatchObject(policy === "exclude_outing"
    ? { groups_completed: 0, groups_repeated: 0, repeat_rate: null }
    : { groups_completed: 1, groups_repeated: 1, repeat_rate: 1 });
});

test("never uses test-account overlap under the eligible-accounts fixture policy", () => {
  db().sql(`update public.plan_group_outcome_specifications set mixed_roster_policy='eligible_accounts_only';
    update public.plan_group_outcome_classifications set eligible=false where user_id=${literal(users[2])}`);
  db().sql(complete(plan(users.slice(0, 3)), "2020-01-20T12:00:00Z"));
  db().sql(complete(plan([users[0], users[2], users[3]])));
  expect(outcome()[0]).toMatchObject({ groups_completed: 1, groups_repeated: 0, repeat_rate: 0 });
});

test("excludes non-production observations from current and prior cohorts", () => {
  db().sql(complete(plan(), "2020-01-20T12:00:00Z", "preview"));
  db().sql(complete(plan(), "2020-02-04T12:00:00Z"));
  db().sql(complete(plan(), "2020-02-05T12:00:00Z", "internal-test"));
  expect(outcome()[0]).toMatchObject({ groups_completed: 1, groups_repeated: 0 });
});

test("preserves a known completion count after deletion when no prior outing exists", () => {
  const deleted = randomUUID();
  db().sql(`insert into auth.users(id) values (${literal(deleted)})`);
  classify(deleted);
  const p = plan([users[0], deleted]);
  db().sql(complete(p));
  db().sql(`delete from auth.users where id=${literal(deleted)}`);
  expect(snapshot(p)).not.toContain(deleted);
  expect(JSON.parse(snapshot(p)).metadata).toMatchObject({ participant_count: 2, eligible_account_count: 2, cohort_eligibility: "qualified" });
  expect(db().sql("select count(*) from public.plan_group_outcome_accounts where user_id is null and eligible")).toBe("1");
  expect(db().sql("select jsonb_agg(to_jsonb(c)) from public.plan_group_outcome_classifications c")).not.toContain(deleted);
  expect(outcome()[0]).toMatchObject({ status: "ready", groups_completed: 1, groups_repeated: 0, repeat_rate: 0 });
});

test("preserves the proven A/B repeat after prior A/B/C loses C", () => {
  const deleted = randomUUID();
  db().sql(`insert into auth.users(id) values (${literal(deleted)})`);
  classify(deleted);
  const prior = plan([users[0], users[1], deleted]);
  db().sql(complete(prior, "2020-01-20T12:00:00Z"));
  db().sql(complete(plan([users[0], users[1], users[3]])));
  db().sql(`delete from auth.users where id=${literal(deleted)}`);
  expect(JSON.parse(snapshot(prior)).metadata).toMatchObject({ eligible_account_count: 3, cohort_eligibility: "qualified" });
  expect(outcome()[0]).toMatchObject({ status: "ready", groups_completed: 1, groups_repeated: 1, repeat_rate: 1 });
});

test("retains completion counts but refuses an exact negative when shared identity clears", () => {
  const deleted = randomUUID();
  db().sql(`insert into auth.users(id) values (${literal(deleted)})`);
  classify(deleted);
  db().sql(complete(plan([users[0], deleted]), "2020-01-20T12:00:00Z"));
  db().sql(complete(plan([users[0], deleted])));
  db().sql(`delete from auth.users where id=${literal(deleted)}`);
  expect(outcome()[0]).toMatchObject({ status: "partial", groups_completed: 1, groups_repeated: 0, repeat_rate: null, unresolved_completions: 1 });
});

test("proves a negative when even the missing identity cannot produce two shared accounts", () => {
  const deleted = randomUUID();
  db().sql(`insert into auth.users(id) values (${literal(deleted)})`);
  classify(deleted);
  db().sql(complete(plan([users[0], deleted]), "2020-01-20T12:00:00Z"));
  db().sql(complete(plan(users.slice(1, 3))));
  db().sql(`delete from auth.users where id=${literal(deleted)}`);
  expect(outcome()[0]).toMatchObject({ status: "ready", groups_completed: 1, groups_repeated: 0, repeat_rate: 0 });
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
  for (const overload of [8, 9, 14] as const) {
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

test.each([true, false])("holds the snapshot across join ordering, join first=%s", async (joinFirst) => {
  const p = plan([users[0]]);
  const seat = randomUUID();
  const joinSql = `select public.join_plan_atomic('${p.id}','${seat}','Guest','${"a".repeat(64)}','2020-01-02',true);
    select public.claim_plan_membership('${p.id}','${seat}','${users[1]}')`;
  await orderedWrites(joinFirst ? joinSql : complete(p), joinFirst ? complete(p) : joinSql);
  expect(JSON.parse(snapshot(p)).metadata.participant_count).toBe(joinFirst ? 2 : 1);
}, 20_000);

test.each([true, false])("holds the snapshot across reactivation ordering, reactivate first=%s", async (reactivateFirst) => {
  const p = plan();
  const seat = db().sql(`select id from public.plan_crew_members where plan_id='${p.id}' and user_id='${users[1]}'`);
  db().sql(`update public.plan_crew_members set membership_revoked_at='2020-01-02',
    join_key_hash='${"a".repeat(64)}',join_request_hash='${"b".repeat(64)}' where id='${seat}'`);
  const reactivate = `select public.join_plan_idempotent_atomic('${p.id}','${seat}','Guest','${"c".repeat(64)}',
    '2020-01-03',true,'${"a".repeat(64)}','${"b".repeat(64)}')`;
  await orderedWrites(reactivateFirst ? reactivate : complete(p), reactivateFirst ? complete(p) : reactivate);
  expect(JSON.parse(snapshot(p)).metadata.participant_count).toBe(reactivateFirst ? 2 : 1);
}, 20_000);

test.each([true, false])("holds the snapshot across revocation ordering, revoke first=%s", async (revokeFirst) => {
  const p = plan();
  // Use the canonical Plan-then-seat lock order to isolate snapshot behavior.
  const revoke = `select id from public.plans where id='${p.id}' for update;
    update public.plan_crew_members set membership_revoked_at='2020-01-02' where plan_id='${p.id}' and user_id='${users[1]}'`;
  await orderedWrites(revokeFirst ? revoke : complete(p), revokeFirst ? complete(p) : revoke);
  expect(JSON.parse(snapshot(p)).metadata.participant_count).toBe(revokeFirst ? 1 : 2);
}, 20_000);

test.each([true, false])("preserves deletion semantics in controlled order, delete first=%s", async (deleteFirst) => {
  const deleted = randomUUID();
  db().sql(`insert into auth.users(id) values ('${deleted}')`);
  classify(deleted);
  const p = plan([users[0], deleted]);
  const remove = `delete from auth.users where id='${deleted}'`;
  await orderedWrites(deleteFirst ? remove : complete(p), deleteFirst ? complete(p) : remove);
  expect(snapshot(p)).not.toContain(deleted);
  expect(JSON.parse(snapshot(p)).metadata.eligible_account_count).toBe(deleteFirst ? 1 : 2);
  expect(outcome()[0]).toMatchObject({ status: "ready", groups_completed: deleteFirst ? 0 : 1, groups_repeated: 0 });
}, 20_000);

test.each(["2020-01-07T12:00:00Z", "2020-01-07T11:59:59Z", "2020-02-04T12:00:00Z"])("holds the 28-day and strict-earlier boundary at %s", (earlier) => {
  db().sql(complete(plan(), earlier));
  db().sql(complete(plan(), "2020-02-04T12:00:00Z"));
  expect(outcome()[0].groups_repeated).toBe(earlier === "2020-01-07T12:00:00Z" ? 1 : 0);
});

test("uses London ISO weeks across the summer clock boundary", () => {
  db().sql(complete(plan(), "2020-03-29T23:30:00Z"));
  const weeks = outcome("fixture-reviewed", "2020-03-23T00:00:00Z", "2020-04-05T23:00:00Z");
  expect(weeks.map(w => [w.week_start, w.groups_completed])).toEqual([["2020-03-23", 0], ["2020-03-30", 1]]);
});

test.each([
  ["2020-03-30T12:00:00Z", "2020-03-02T12:00:00Z", 1],
  ["2020-03-30T12:00:00Z", "2020-03-02T11:59:59Z", 0],
  ["2020-10-26T12:00:00Z", "2020-09-28T12:00:00Z", 1],
  ["2020-10-26T12:00:00Z", "2020-09-28T11:59:59Z", 0],
] as const)("uses exactly 672 elapsed hours from %s to %s in London session time", (current, prior, repeats) => {
  db().sql(`set timezone='Europe/London'; ${complete(plan(), prior)}; ${complete(plan(), current)}`);
  const end = new Date(Date.parse(current) + 3_600_000).toISOString();
  const result = JSON.parse(db().sql(`set role service_role; set timezone='Europe/London';
    select jsonb_agg(to_jsonb(w)) from public.read_plan_group_outcomes('${current}','${end}','fixture-reviewed') w`));
  expect(result[0]).toMatchObject({ status: "ready", groups_completed: 1, groups_repeated: repeats, repeat_rate: repeats });
});

test("uses ISO weeks across the calendar year boundary", () => {
  db().sql(complete(plan(), "2020-01-01T12:00:00Z"));
  expect(outcome("fixture-reviewed", "2019-12-30T00:00:00Z", "2020-01-06T00:00:00Z")[0])
    .toMatchObject({ week_start: "2019-12-30", groups_completed: 1 });
});

test("keeps missing historical snapshots visible in prior coverage", () => {
  const prior = plan();
  db().sql(complete(prior, "2020-01-20T12:00:00Z"));
  db().sql(`delete from public.plan_group_outcomes where completion_id in (select id from public.plan_completions where plan_id=${literal(prior.id)})`);
  db().sql(complete(plan()));
  expect(outcome()[0]).toMatchObject({ status: "partial", groups_completed: 1, groups_repeated: 0, repeat_rate: null });
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
    for (const table of ["plan_group_outcomes", "plan_group_outcome_accounts", "plan_group_outcome_capture", "plan_group_outcome_specifications", "plan_group_outcome_classifications"]) {
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
  expect(db().expectRefusal(`set role service_role; select public._0158_capture_plan_group_outcome('${p.id}',null,null,'unknown')`)).toMatch(/permission denied/i);
  expect(db().expectRefusal("set role service_role; update public.plan_group_outcomes set participant_count=20")).toMatch(/permission denied/i);
  expect(db().expectRefusal("set role service_role; update public.plan_group_outcome_specifications set mixed_roster_policy='eligible_accounts_only'")).toMatch(/permission denied/i);
  expect(db().expectRefusal("set role service_role; select * from public.plan_group_outcome_classifications")).toMatch(/permission denied/i);
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
  expect(db().sql("select to_regclass('public.plan_group_outcome_specifications') is null")).toBe("t");
  for (const signature of ["uuid,text,integer,uuid,uuid,text,text,timestamptz", "uuid,text,integer,uuid,uuid,text,text,jsonb,timestamptz"]) {
    expect(db().sql(`select has_function_privilege('service_role','public.complete_plan_atomic(${signature})','EXECUTE')`)).toBe("t");
    for (const role of ["anon", "authenticated"]) {
      expect(db().sql(`select has_function_privilege('${role}','public.complete_plan_atomic(${signature})','EXECUTE')`)).toBe("f");
    }
  }
});
