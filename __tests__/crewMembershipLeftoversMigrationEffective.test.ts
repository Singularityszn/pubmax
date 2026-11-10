// Migration 0232 on a real PostgreSQL replay: a crew membership change closes
// what it leaves behind. Activation closes the member's pending invitation,
// leave and removal end their Plan seat, and an active member keeps Here when
// an old invitation would have reset it.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const directory = join(process.cwd(), "supabase/migrations");
const name = "20261110140000_0232_crew_membership_closes_leftovers.sql";
const rollback = "rollback/20261110140000_0232_crew_membership_closes_leftovers_rollback.sql";

const PLAN = "a2320000-0000-4000-8000-000000000001";
const HOST_SEAT = "a2320000-0000-4000-8000-000000000002";
const HOST_HASH = "1".repeat(64);
const ALICE_USER = "a2320000-0000-4000-8000-000000000011";
const BOB_USER = "a2320000-0000-4000-8000-000000000012";
const ALICE_PROFILE = "a2320000-0000-4000-8000-000000000021";
const BOB_PROFILE = "a2320000-0000-4000-8000-000000000022";
const ALICE = "a2320000-0000-4000-8000-000000000031";
const BOB = "a2320000-0000-4000-8000-000000000032";
const DIGEST = "a".repeat(64);

let session: PostgresSession | null = null;
function db() { if (!session) throw new Error("The test database is not running."); return session; }
const json = (value: string) => JSON.parse(value) as Record<string, unknown>;

let crew = "";
let keys = 0;
const key = (label: string) => `${label}-key-0232-${String(++keys).padStart(8, "0")}`;

function invite(): string {
  const answer = json(db().sql(`select public.invite_social_crew_member_atomic('${ALICE}','${crew}','${BOB_PROFILE}','${key("invite")}','${DIGEST}')::text`));
  expect(answer).toMatchObject({ ok: true, code: "invited" });
  return answer.invitation_id as string;
}
const accept = (invitation: string) => json(db().sql(`select public.accept_social_crew_invitation_atomic('${BOB}','${crew}','${invitation}','accepted','${key("accept")}','${DIGEST}')::text`));
const activate = () => db().sql(`select public._activate_social_crew_member('${crew}','${BOB}')`);
const bobMember = () => db().sql(`select id from public.social_crew_members where crew_id='${crew}' and social_account_id='${BOB}'`);
const bobSeat = () => db().sql(`select status || ':' || (membership_revoked_at is not null) from public.plan_crew_members where id=(select plan_member_id from public.social_crew_members where crew_id='${crew}' and social_account_id='${BOB}')`);
const markHere = () => db().sql(`update public.plan_crew_members set status='here' where id=(select plan_member_id from public.social_crew_members where crew_id='${crew}' and social_account_id='${BOB}')`);
const remove = () => json(db().sql(`select public.remove_social_crew_member_atomic('${ALICE}','${crew}','${bobMember()}','${key("remove")}','${DIGEST}')::text`));
const leave = () => json(db().sql(`select public.leave_social_crew_atomic('${BOB}','${crew}','${key("leave")}','${DIGEST}')::text`));
const invitationState = (id: string) => db().sql(`select state from public.social_crew_invitations where id='${id}'`);

function reset() {
  db().sql(`delete from public.social_crew_invitations;
    update public.social_crew_members set state='removed', ended_at=now(), updated_at=now() where social_account_id='${BOB}' and state='active';
    update public.plan_crew_members set membership_revoked_at=null, status='in' where plan_id='${PLAN}';`);
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "crew-leftovers-0232", database: "crew_leftovers_0232" });
  try {
    db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const file of readdirSync(directory).filter((entry) => entry.endsWith(".sql") && entry < name).sort()) db().applyFile(join(directory, file));
    db().sql(`insert into auth.users(id) values ('${ALICE_USER}'),('${BOB_USER}');
      insert into public.profiles(id,user_id,handle) values ('${ALICE_PROFILE}','${ALICE_USER}','alice'),('${BOB_PROFILE}','${BOB_USER}','bob');
      insert into public.private_social_accounts(id,clerk_user_id,supabase_user_id,profile_id) values
        ('${ALICE}','clerk-alice','${ALICE_USER}','${ALICE_PROFILE}'),('${BOB}','clerk-bob','${BOB_USER}','${BOB_PROFILE}');
      insert into public.follows(follower_id,followee_id) values ('${ALICE_PROFILE}','${BOB_PROFILE}'),('${BOB_PROFILE}','${ALICE_PROFILE}');
      insert into public.plans(id,title,start_time,status,owner_user_id) values ('${PLAN}','Crew night',now()+interval '1 day','ready','${ALICE_USER}');
      insert into public.plan_stops(plan_id,venue_id,venue_name,position) values ('${PLAN}','venue-one','Venue One',0);
      insert into public.plan_crew_members(id,plan_id,name,token_hash,status,joined_at,updated_at,can_collaborate,user_id)
        values ('${HOST_SEAT}','${PLAN}','Alice','${HOST_HASH}','in',now()-interval '1 minute',now(),true,'${ALICE_USER}');`);
    const created = json(db().sql(`select public.create_social_crew_atomic('${ALICE}','${PLAN}','${HOST_HASH}','friends','create-crew-0232','${DIGEST}')::text`));
    crew = created.crew_id as string;
    if (!crew) throw new Error(`The crew was not created: ${JSON.stringify(created)}`);
  } catch (error) { await session.stop(); session = null; throw error; }
}, 600_000);
beforeEach(() => { if (session) reset(); });
afterAll(async () => { await session?.stop(); session = null; });

describe.skipIf(skipReason !== null)("0232 crew membership closes its leftovers", () => {
  it("before 0232: a removed member returns through an old invitation, and an old invitation wipes Here", () => {
    const first = invite();
    activate();
    markHere();
    expect(invitationState(first)).toBe("pending");
    expect(accept(first)).toMatchObject({ ok: true, code: "accepted" });
    expect(bobSeat()).toBe("in:false");

    reset();
    const second = invite();
    activate();
    expect(remove()).toMatchObject({ ok: true, code: "removed" });
    expect(bobSeat()).toBe("in:false");
    expect(accept(second)).toMatchObject({ ok: true, code: "accepted" });
  });

  it("after 0232: activation closes the pending invitation and Here survives", () => {
    db().applyFile(join(directory, name));
    const invitation = invite();
    activate();
    expect(invitationState(invitation)).toBe("accepted");
    markHere();
    expect(accept(invitation)).toMatchObject({ ok: false, code: "already_decided" });
    activate();
    expect(bobSeat()).toBe("here:false");
  });

  it("after 0232: removal ends the seat and a removed member cannot come back through an old invitation", () => {
    activate();
    markHere();
    db().sql(`insert into public.social_crew_invitations(crew_id,target_account_id,invited_by_member_id,expires_at)
      select '${crew}','${BOB}',id,now()+interval '1 hour' from public.social_crew_members where crew_id='${crew}' and social_account_id='${ALICE}'`);
    const stale = db().sql(`select id from public.social_crew_invitations where crew_id='${crew}' and state='pending'`);
    expect(remove()).toMatchObject({ ok: true, code: "removed" });
    expect(invitationState(stale)).toBe("revoked");
    expect(bobSeat()).toBe("here:true");
    expect(accept(stale)).toMatchObject({ ok: false, code: "already_decided" });
    expect(db().sql(`select state from public.social_crew_members where crew_id='${crew}' and social_account_id='${BOB}'`)).toBe("removed");
  });

  it("after 0232: leaving ends the seat, and a fresh invitation brings the member back with a clean seat", () => {
    activate();
    markHere();
    expect(leave()).toMatchObject({ ok: true, code: "left" });
    expect(bobSeat()).toBe("here:true");
    expect(accept(invite())).toMatchObject({ ok: true, code: "accepted" });
    expect(bobSeat()).toBe("in:false");
  });

  it("rollback keeps ended seats until fresh acceptance and restores the old answers", () => {
    activate();
    markHere();
    expect(leave()).toMatchObject({ ok: true, code: "left" });
    expect(bobSeat()).toBe("here:true");
    db().applyFile(join(directory, rollback));
    expect(bobSeat()).toBe("here:true");
    const invitation = invite();
    expect(accept(invitation)).toMatchObject({ ok: true, code: "accepted" });
    expect(bobSeat()).toBe("in:false");

    reset();
    const stale = invite();
    activate();
    markHere();
    expect(invitationState(stale)).toBe("pending");
    expect(accept(stale)).toMatchObject({ ok: true, code: "accepted" });
    expect(bobSeat()).toBe("in:false");
  });
});
