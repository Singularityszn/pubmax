import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asServiceRole, postgresSkipReason, startMigratedPostgres, type PostgresSession } from "./helpers/postgres";

const actor = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const profile = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const moderator = "40000000-0000-4000-8000-000000000001";
const forward = "supabase/migrations/20261029100000_0202_hosted_outings.sql";
const rollback = "supabase/migrations/rollback/20261029100000_0202_hosted_outings_rollback.sql";
const skip = postgresSkipReason();
let db: PostgresSession;
let outing: string;
const quoted = (value: unknown) => `'${(JSON.stringify(value) ?? "null").replaceAll("'", "''")}'::jsonb`;
function command(n: number, action: string, input: Record<string, unknown> = {}, revision: number | null = null, enabled = true) {
  return asServiceRole(`select public.change_hosted_outing('${actor(n)}','${outing}','${action}',${quoted(input)},${revision ?? "null"},${enabled})`);
}
function read(n: number): Record<string, unknown> {
  return JSON.parse(db.sql(asServiceRole(`select public.read_hosted_outings('${actor(n)}','${outing}')`))).outings[0];
}
function revision(): number { return Number(read(1).revision); }
function join(n: number) { db.sql(command(n, "join", { pace: "easy", budgetPence: 2000 })); }
function approve(ids: number[]) { db.sql(command(1, "approve", { profileIds: ids.map(profile), explanation: "Earlier compatible signups come first." }, revision())); }
function publish() { db.sql(command(1, "publish", { confirmation: "Venue booking confirmed by fixture operator" }, revision())); }

beforeAll(async () => {
  if (skip) return;
  db = await startMigratedPostgres({ label: "hosted-outing" });
  for (let n = 1; n <= 7; n += 1) db.sql(`
    insert into auth.users(id) values('${user(n)}');
    insert into public.profiles(id,user_id,handle) values('${profile(n)}','${user(n)}','hosted_person_${n}');
    insert into public.private_social_accounts(id,clerk_user_id,supabase_user_id,profile_id)
      values('${actor(n)}','hosted-${n}','${user(n)}','${profile(n)}');`);
  db.sql(`insert into public.private_social_staff_roles(id,profile_id,display_name,role) values('${moderator}','${profile(1)}','Named host','moderator')`);
});
afterAll(async () => { await db?.stop(); });
beforeEach(() => {
  if (skip) return;
  db.sql("delete from public.hosted_outings; delete from public.social_blocks;");
  db.sql(`update public.private_social_staff_roles set active=true,revoked_at=null where id='${moderator}'`);
  outing = db.sql(asServiceRole(`select public.create_hosted_outing('${actor(1)}','Hosted fixture','venue-fixture','Fixture public pub',now()+interval '1 day',2,'${moderator}')`));
});

describe.skipIf(skip !== null)("durable hosted outing workflow", () => {
  it("keeps draft signup closed and denies browser table and RPC access", () => {
    expect(db.expectRefusal(command(2, "join", { pace: "easy", budgetPence: 2000 }))).toContain("HOSTED_NOT_FOUND");
    for (const role of ["anon", "authenticated"]) {
      expect(db.expectRefusal(`set role ${role}; select * from public.hosted_outing_attendees`)).toContain("42501");
      expect(db.expectRefusal(`set role ${role}; select public.read_hosted_outings('${actor(2)}','${outing}')`)).toContain("42501");
    }
    db.sql(command(1, "publish", { confirmation: "Confirmed venue" }, revision(), false));
    expect(db.expectRefusal(command(2, "join", { pace: "easy", budgetPence: 2000 }))).toContain("HOSTED_CLOSED");
    publish();
    join(2);
    expect((read(2).attendance as { state: string }).state).toBe("waiting");
  });

  it("requires a named active moderator for publication and enrollment", () => {
    const separateModerator = "40000000-0000-4000-8000-000000000005";
    db.sql(`insert into public.private_social_staff_roles(id,profile_id,display_name,role)
      values('${separateModerator}','${profile(5)}','Separate named moderator','moderator')`);
    db.sql(`update public.hosted_outings set moderator_staff_id='${separateModerator}' where id='${outing}'`);
    const current = revision();
    db.sql(`update public.private_social_staff_roles set active=false where id='${separateModerator}'`);
    expect(db.expectRefusal(command(1, "publish", { confirmation: "Confirmed venue" }, current))).toContain("HOSTED_MODERATOR_REQUIRED");
    db.sql(`update public.private_social_staff_roles set active=true where id='${separateModerator}'`);
    publish();
    db.sql(`update public.private_social_staff_roles set active=false where id='${separateModerator}'`);
    expect(db.expectRefusal(command(2, "join", { pace: "easy", budgetPence: 2000 }))).toContain("HOSTED_MODERATOR_REQUIRED");
  });

  it("reserves approved places atomically when two groups race for capacity", async () => {
    publish();
    [2, 3, 4, 5].forEach(join);
    const current = revision();
    const results = await Promise.all([
      db.attempt(command(1, "approve", { profileIds: [profile(2), profile(3)], explanation: "First group" }, current)),
      db.attempt(command(1, "approve", { profileIds: [profile(4), profile(5)], explanation: "Second group" }, current)),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)?.said).toContain("HOSTED_STALE");
    const states = [2, 3, 4, 5].map((n) => (read(n).attendance as { state: string }).state);
    expect(states.filter((state) => state === "approved")).toHaveLength(2);
    expect(states.filter((state) => state === "waiting")).toHaveLength(2);
  });

  it("checks a block before approval and again before confirmation", () => {
    publish(); join(2); join(3);
    db.sql(`insert into public.social_blocks(blocker_profile_id,blocked_profile_id) values('${profile(3)}','${profile(2)}')`);
    expect(db.expectRefusal(command(1, "approve", { profileIds: [profile(2), profile(3)] }, revision()))).toContain("HOSTED_BLOCKED");
    db.sql("delete from public.social_blocks"); approve([2, 3]);
    db.sql(`insert into public.social_blocks(blocker_profile_id,blocked_profile_id) values('${profile(3)}','${profile(2)}')`);
    expect(db.expectRefusal(command(2, "confirm"))).toContain("HOSTED_BLOCKED");
  });

  it("lets an attendee cancel, preserves the waitlist and keeps reports private", () => {
    publish(); join(2); join(3); join(4); approve([2, 3]);
    db.sql(command(2, "confirm"));
    db.sql(command(2, "cancel"));
    expect((read(2).attendance as { state: string }).state).toBe("cancelled");
    expect((read(4).attendance as { state: string }).state).toBe("waiting");
    approve([3, 4]);
    expect((read(4).attendance as { state: string }).state).toBe("approved");
    db.sql(command(2, "report", { body: "A private report for the named host." }));
    expect(JSON.stringify(read(3))).not.toContain("A private report");
    expect(JSON.stringify(read(1))).toContain("A private report for the named host.");
    db.sql(command(1, "cancel_outing", {}, revision()));
    expect((read(3).attendance as { state: string }).state).toBe("cancelled");
    expect(db.expectRefusal(command(3, "confirm"))).toContain("HOSTED_CLOSED");
  });

  it("accepts feedback only from a confirmed attendee after completion", () => {
    publish(); join(2); join(3); approve([2, 3]);
    db.sql(command(2, "confirm"));
    expect(db.expectRefusal(command(2, "feedback", { rating: 4 }))).toContain("HOSTED_FORBIDDEN");
    db.sql(`update public.hosted_outings set starts_at=now()-interval '1 hour' where id='${outing}'`);
    db.sql(command(1, "complete", {}, revision()));
    db.sql(command(2, "feedback", { rating: 4 }));
    expect(read(2).feedback).toBe(4);
    expect(read(1).feedbackSummary).toEqual({ count: 1, average: 4 });
    expect(db.expectRefusal(command(4, "feedback", { rating: 5 }))).toContain("HOSTED_FORBIDDEN");
    expect(db.expectRefusal(command(2, "cancel"))).toContain("HOSTED_CLOSED");
  });

  it("removes moderator reads when the assigned person loses the moderator role", () => {
    const otherModerator = "40000000-0000-4000-8000-000000000006";
    db.sql(`insert into public.private_social_staff_roles(id,profile_id,display_name,role)
      values('${otherModerator}','${profile(6)}','Separate moderator','moderator')`);
    db.sql(`update public.hosted_outings set moderator_staff_id='${otherModerator}' where id='${outing}'`);
    expect(read(6).id).toBe(outing);
    db.sql(`update public.private_social_staff_roles set role='product_staff' where id='${otherModerator}'`);
    expect(JSON.parse(db.sql(asServiceRole(`select public.read_hosted_outings('${actor(6)}','${outing}')`))).outings).toEqual([]);
    db.sql(`delete from public.private_social_staff_roles where id='${otherModerator}'`);
  });

  it("closes enrollment after the named moderator deletes their account", () => {
    const otherModerator = "40000000-0000-4000-8000-000000000006";
    db.sql(`insert into public.private_social_staff_roles(id,profile_id,display_name,role)
      values('${otherModerator}','${profile(6)}','Separate moderator','moderator')`);
    db.sql(`update public.hosted_outings set moderator_staff_id='${otherModerator}' where id='${outing}'`);
    publish();
    db.sql(`delete from auth.users where id='${user(6)}'`);
    expect(read(2).moderatorActive).toBe(false);
    expect(db.expectRefusal(command(2, "join", { pace: "easy", budgetPence: 2000 }))).toContain("HOSTED_MODERATOR_REQUIRED");
  });

  it("restores the schema after a rollback without touching existing crews", () => {
    const crewsBefore = db.sql("select count(*) from public.social_crews");
    db.applyFile(rollback);
    expect(db.sql("select to_regclass('public.hosted_outings') is null")).toBe("t");
    expect(db.sql("select count(*) from public.social_crews")).toBe(crewsBefore);
    db.applyFile(forward);
  });
  it.each(["role_removed", "account_deleted"])("closes new signup after separate operator departure: %s", async (departure) => {
    const operatorStaff = "40000000-0000-4000-8000-000000000007";
    db.sql(`insert into public.private_social_staff_roles(id,profile_id,display_name,role)
      values('${operatorStaff}','${profile(7)}','Separate operator','product_staff')
      on conflict(id) do update set active=true,revoked_at=null`);
    db.sql(`update public.hosted_outings set operator_profile_id='${profile(7)}' where id='${outing}'`);
    db.sql(command(7, "publish", { confirmation: "Confirmed venue with separate moderator" }, revision()));
    join(2); join(3);
    db.sql(command(7, "approve", { profileIds: [profile(2), profile(3)], explanation: "Approved before operator departure." }, revision()));
    db.sql(command(2, "confirm"));
    if (departure === "role_removed") {
      db.sql(`update public.private_social_staff_roles set active=false,revoked_at=now() where id='${operatorStaff}'`);
    } else {
      db.sql(`delete from auth.users where id='${user(7)}'`);
    }
    expect(read(2).attendance).toMatchObject({ state: "confirmed" });
    expect(read(3).attendance).toMatchObject({ state: "approved" });
    expect(read(2)).toMatchObject({ signupAllowed: false, confirmationAllowed: true, enrollmentEnabled: true, moderatorActive: true });
    const attempted = await db.attempt(command(4, "join", { pace: "easy", budgetPence: 2000 }));
    expect({ admitted: attempted.ok, attendance: read(4).attendance }).toEqual({ admitted: false, attendance: null });
    expect(attempted.said).toContain("HOSTED_OPERATOR_REQUIRED");
  });

});
