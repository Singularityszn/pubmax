// Migration 0225, proved against a real PostgreSQL replay of every migration:
// the share card read answers an open, upcoming crew with its capacity, its
// active seat count, the host's chosen meeting pub and its stop ids; it answers
// nothing for a crew 0115 would not describe; no browser role can call it; and
// the rollback removes it and lets the forward file apply again.

import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  asBrowserRole,
  asServiceRole,
  postgresSkipReason,
  startMigratedPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const FORWARD = join(MIGRATIONS, "20261108090000_0225_open_crawl_share_card.sql");
const ROLLBACK = join(MIGRATIONS, "rollback/20261108090000_0225_open_crawl_share_card_rollback.sql");

const HOST_USER = "aaaaaaaa-aaaa-4aaa-8aaa-222222220001";
const HOST_PROFILE = "aaaaaaaa-aaaa-4aaa-8aaa-222222220002";
const HOST_ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-222222220003";
const GUEST_USER = "bbbbbbbb-bbbb-4bbb-8bbb-222222220001";
const GUEST_PROFILE = "bbbbbbbb-bbbb-4bbb-8bbb-222222220002";
const GUEST_ACCOUNT = "bbbbbbbb-bbbb-4bbb-8bbb-222222220003";
const LEFT_USER = "cccccccc-cccc-4ccc-8ccc-222222220001";
const LEFT_PROFILE = "cccccccc-cccc-4ccc-8ccc-222222220002";
const LEFT_ACCOUNT = "cccccccc-cccc-4ccc-8ccc-222222220003";

const PLAN = "dddddddd-dddd-4ddd-8ddd-222222220001";
const CREW = "eeeeeeee-eeee-4eee-8eee-222222220001";
const HOST_SEAT = "ffffffff-ffff-4fff-8fff-222222220001";
const GUEST_SEAT = "ffffffff-ffff-4fff-8fff-222222220002";
const LEFT_SEAT = "ffffffff-ffff-4fff-8fff-222222220003";
const HOST_MEMBER = "99999999-9999-4999-8999-222222220001";
const GUEST_MEMBER = "99999999-9999-4999-8999-222222220002";
const LEFT_MEMBER = "99999999-9999-4999-8999-222222220003";

let session: PostgresSession | null = null;

function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL share card session did not start.");
  return session;
}

function shareCard(): Record<string, unknown> | null {
  const said = db().sql(asServiceRole(`select public.read_social_crew_share_card('${CREW}')`));
  const line = said.split("\n").pop() ?? "";
  return line.trim() ? (JSON.parse(line) as Record<string, unknown>) : null;
}

function seed(): void {
  db().sql(`
    delete from public.social_crew_members where crew_id='${CREW}';
    delete from public.social_crews where id='${CREW}';
    delete from public.plan_crew_members where plan_id='${PLAN}';
    delete from public.plan_stops where plan_id='${PLAN}';
    delete from public.plans where id='${PLAN}';
    update public.private_social_accounts set ownership_state='active' where id='${HOST_ACCOUNT}';

    insert into public.plans(id,title,start_time,owner_user_id,status,social_owner_account_id)
      values('${PLAN}','Thursday in Soho',now()+interval '2 days','${HOST_USER}','ready','${HOST_ACCOUNT}');
    insert into public.plan_stops(plan_id,venue_id,venue_name,position) values
      ('${PLAN}','venue-london-blue-posts','The Blue Posts',0),
      ('${PLAN}','venue-london-dog-and-duck','The Dog and Duck',1),
      ('${PLAN}','venue-london-coach-and-horses','The Coach and Horses',2);
    insert into public.plan_crew_members(
      id,plan_id,name,token_hash,status,user_id,joined_at,updated_at,can_collaborate,social_account_id
    ) values
      ('${HOST_SEAT}','${PLAN}','Host',md5('share-host')||md5('share-host-2'),'in',
        '${HOST_USER}',now(),now(),true,'${HOST_ACCOUNT}'),
      ('${GUEST_SEAT}','${PLAN}','Guest',md5('share-guest')||md5('share-guest-2'),'in',
        '${GUEST_USER}',now(),now(),true,'${GUEST_ACCOUNT}'),
      ('${LEFT_SEAT}','${PLAN}','Left',md5('share-left')||md5('share-left-2'),'in',
        '${LEFT_USER}',now(),now(),true,'${LEFT_ACCOUNT}');
    insert into public.social_crews(id,plan_id,owner_account_id,visibility,capacity,meeting_venue_id,description)
      values('${CREW}','${PLAN}','${HOST_ACCOUNT}','open',8,'venue-london-dog-and-duck','Cheap pints, short walks.');
    insert into public.social_crew_members(id,crew_id,social_account_id,plan_member_id,role,state) values
      ('${HOST_MEMBER}','${CREW}','${HOST_ACCOUNT}','${HOST_SEAT}','owner','active'),
      ('${GUEST_MEMBER}','${CREW}','${GUEST_ACCOUNT}','${GUEST_SEAT}','member','active');
    insert into public.social_crew_members(id,crew_id,social_account_id,plan_member_id,role,state,ended_at) values
      ('${LEFT_MEMBER}','${CREW}','${LEFT_ACCOUNT}','${LEFT_SEAT}','member','left',now());
  `);
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startMigratedPostgres({ label: "open-crawl-share-card-0225", database: "pubmax_share_card_0225" });
  session.sql(`
    insert into auth.users(id) values ('${HOST_USER}'),('${GUEST_USER}'),('${LEFT_USER}');
    insert into public.profiles(id,user_id,handle) values
      ('${HOST_PROFILE}','${HOST_USER}','sohohost'),
      ('${GUEST_PROFILE}','${GUEST_USER}','quietguest'),
      ('${LEFT_PROFILE}','${LEFT_USER}','leftguest');
    insert into public.private_social_accounts(id,clerk_user_id,supabase_user_id,profile_id,ownership_state) values
      ('${HOST_ACCOUNT}','clerk-share-host','${HOST_USER}','${HOST_PROFILE}','active'),
      ('${GUEST_ACCOUNT}','clerk-share-guest','${GUEST_USER}','${GUEST_PROFILE}','active'),
      ('${LEFT_ACCOUNT}','clerk-share-left','${LEFT_USER}','${LEFT_PROFILE}','active');
  `);
}, 300_000);

beforeEach(() => {
  if (session) seed();
});

afterAll(async () => {
  await session?.stop();
});

describe.skipIf(skipReason !== null)("0225 open crawl share card applied to PostgreSQL", () => {
  it("answers the host, the cap, the active seats, the host's meeting pub and the stop ids", () => {
    const card = shareCard();
    expect(card).toEqual({
      crewId: CREW,
      title: "Thursday in Soho",
      hostHandle: "sohohost",
      startsAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
      capacity: 8,
      memberCount: 2,
      meetingVenueId: "venue-london-dog-and-duck",
      meetingVenueName: "The Dog and Duck",
      stopVenueIds: [
        "venue-london-blue-posts",
        "venue-london-dog-and-duck",
        "venue-london-coach-and-horses",
      ],
    });
    const serialized = JSON.stringify(card);
    expect(serialized).not.toContain("quietguest");
    expect(serialized).not.toContain("leftguest");
    expect(serialized).not.toContain(HOST_ACCOUNT);
    expect(serialized).not.toContain("Cheap pints");
  });

  it("falls back to Stop 1 and no cap on an open crew without open crawl facts", () => {
    db().sql(`update public.social_crews
      set capacity=null, meeting_venue_id=null, description=null where id='${CREW}'`);
    expect(shareCard()).toMatchObject({
      capacity: null,
      meetingVenueId: "venue-london-blue-posts",
      meetingVenueName: "The Blue Posts",
    });
  });

  it.each([
    ["a friends-only crew", `update public.social_crews set visibility='friends' where id='${CREW}'`],
    ["a finished night", `update public.plans set status='completed' where id='${PLAN}'`],
    ["a night that ended over eight hours ago", `update public.plans set start_time=now()-interval '9 hours' where id='${PLAN}'`],
    ["a suspended host account", `update public.private_social_accounts set ownership_state='suspended' where id='${HOST_ACCOUNT}'`],
    ["a blank Stop 1", `update public.plan_stops set venue_name=' ' where plan_id='${PLAN}' and position=0`],
  ])("answers nothing for %s", (_label, change) => {
    db().sql(change);
    expect(shareCard()).toBeNull();
  });

  it("refuses every browser role", () => {
    for (const role of ["anon", "authenticated"] as const) {
      expect(
        db().expectRefusal(
          asBrowserRole(role, role === "anon" ? null : GUEST_USER, `select public.read_social_crew_share_card('${CREW}')`),
        ),
      ).toMatch(/permission denied/i);
    }
  });

  it("rolls back to no function, and the forward file applies again", () => {
    db().applyFile(ROLLBACK);
    expect(
      db().sql(`select count(*) from pg_proc where proname='read_social_crew_share_card'`).split("\n").pop(),
    ).toBe("0");
    db().applyFile(FORWARD);
    expect(shareCard()).toMatchObject({ capacity: 8, memberCount: 2 });
  });
});
