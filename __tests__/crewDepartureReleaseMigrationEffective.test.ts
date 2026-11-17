// Migration 0244 on a real PostgreSQL replay, applied after 0243 by the migration
// role of the permission replica. The captain's rule for a deleted account: free
// their guest places, cancel the nights they own, keep the history. Account
// deletion holds the auth row and account locks, so the release runs afterwards,
// in its own transaction, under each crew's row lock: from the deletion service,
// from any later sweep, and from every admission into that crew.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresSkipReason } from "./helpers/postgres";
import {
  type Person,
  NOT_FOUND,
  REFUSED_BY_LOCKS,
  admit,
  bootCrewAdmissionDatabase,
  call,
  crewWith,
  db,
  decide,
  decideCall,
  deleteAccount,
  holdRpc,
  invite,
  json,
  mutual,
  outcome,
  person,
  releaseCall,
  request,
  revision,
  rollbackOutcome,
  rpc,
  running,
  stageTo,
  state,
  stopCrewAdmissionDatabase,
  suspendCall,
  waitsOnAnyLock,
} from "./helpers/crewAdmissionHarness";

const skipReason = postgresSkipReason();
beforeAll(async () => { if (!skipReason) await bootCrewAdmissionDatabase("crew-departure-0244", "after"); }, 600_000);
afterAll(async () => { await stopCrewAdmissionDatabase(); });

const release = (limit?: number) => call(releaseCall(limit));
const releaseAll = () => { while ((release(100).crews as number) > 0); };
const planStatus = (crew: string) =>
  db().sql(`select plan.status from public.social_crews crew join public.plans plan on plan.id=crew.plan_id where crew.id='${crew}'`);
const seatOpen = (crew: string, who: Person) => db().sql(`select coalesce((select (seat.membership_revoked_at is null)::text
  from public.plan_crew_members seat join public.social_crew_members member on member.plan_member_id=seat.id
  where member.crew_id='${crew}' and member.social_account_id='${who.account}'),'none')`);
const activeCount = (crew: string) =>
  db().sql(`select count(*) from public.social_crew_members where crew_id='${crew}' and state='active'`);
const withCapacity = (crew: string, capacity: number) => db().sql(`update public.social_crews
  set capacity=${capacity}, meeting_venue_id='venue-one', description='A night out' where id='${crew}'`);

describe.skipIf(skipReason !== null)("0244: a deleted account's crew places", () => {
  beforeAll(() => { if (running()) stageTo("after"); });

  it("a deleted guest's place is freed with the leave transition, the revision moves once and the row stays as history", () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana, xav]);
    db().sql(deleteAccount(xav));
    releaseAll();
    expect(state(crew, xav)).toBe("left");
    expect(seatOpen(crew, xav)).toBe("false");
    expect(state(crew, ana)).toBe("active");
    expect(activeCount(crew)).toBe("2");
    const after = revision(crew);
    releaseAll();
    expect(revision(crew)).toBe(after);
    expect(state(crew, xav)).toBe("left");
  });

  it("a deleted owner's night is cancelled, pending requests and invitations expire, and guests keep their history", () => {
    const host = person(), ana = person(), xav = person(), bea = person();
    mutual(host, bea);
    const crew = crewWith(host, [ana]);
    request(xav, crew);
    invite(host, crew, bea);
    const before = Number(revision(crew));
    db().sql(deleteAccount(host));
    releaseAll();
    expect(planStatus(crew)).toBe("abandoned");
    expect(Number(revision(crew))).toBe(before + 1);
    expect(state(crew, ana)).toBe("active");
    expect(db().sql(`select string_agg(state, ',' order by state) from (
      select state from public.social_crew_join_requests where crew_id='${crew}' and requester_account_id='${xav.account}'
      union all select state from public.social_crew_invitations where crew_id='${crew}' and target_account_id='${bea.account}') rows`))
      .toBe("expired,expired");
    releaseAll();
    expect(Number(revision(crew))).toBe(before + 1);
  });

  it("a suspended guest and an unbound legacy guest keep their places", () => {
    const host = person(), sue = person(), leo = person();
    const crew = crewWith(host, [sue, leo]);
    expect(call(suspendCall(sue))).toMatchObject({ ok: true, code: "suspended" });
    db().sql(`update public.private_social_accounts set supabase_user_id=null where id='${leo.account}'`);
    releaseAll();
    expect([state(crew, sue), state(crew, leo)]).toEqual(["active", "active"]);
  });

  it("a full crew admits a new guest once a deleted guest's place is freed, with no sweep first", () => {
    const host = person(), ana = person(), cal = person(), xav = person(), bea = person();
    const crew = crewWith(host, [ana]);
    withCapacity(crew, 4);
    admit(host, crew, cal);
    admit(host, crew, xav);
    expect(activeCount(crew)).toBe("4");
    db().sql(deleteAccount(xav));
    const asked = request(bea, crew);
    expect(asked).toMatchObject({ ok: true, code: "requested" });
    expect(decide(host, crew, asked.request_id as string)).toMatchObject({ ok: true, code: "accepted" });
    expect(state(crew, xav)).toBe("left");
    expect(activeCount(crew)).toBe("4");
  });

  it("a request into a night whose owner was deleted answers not found and stores nothing", () => {
    const host = person(), ana = person(), bea = person();
    const crew = crewWith(host, [ana]);
    db().sql(deleteAccount(host));
    expect(request(bea, crew)).toEqual(NOT_FOUND);
    expect(planStatus(crew)).toBe("abandoned");
    expect(db().sql(`select count(*) from public.social_crew_join_requests where crew_id='${crew}' and requester_account_id='${bea.account}'`)).toBe("0");
  });

  it("a sweep waits for an admission in the same crew, and both finish with one place each", async () => {
    const host = person(), ana = person(), cal = person(), xav = person(), bea = person();
    const crew = crewWith(host, [ana, cal]);
    withCapacity(crew, 4);
    admit(host, crew, xav);
    const asked = request(bea, crew);
    db().sql(deleteAccount(xav));
    const approval = await holdRpc(decideCall(host, crew, asked.request_id as string));
    expect(approval.result).toMatchObject({ ok: true, code: "accepted" });
    let sweeping: Promise<{ ok: boolean; said: string }> | null = null;
    try {
      sweeping = outcome("sweep_after_approval", rpc(releaseCall()));
      await expect.poll(() => waitsOnAnyLock("sweep_after_approval")).toBe("t");
    } finally { await approval.finish(); }
    const swept = await sweeping;
    expect(swept?.said ?? "").not.toMatch(REFUSED_BY_LOCKS);
    expect(swept?.ok).toBe(true);
    expect([state(crew, xav), state(crew, bea)]).toEqual(["left", "active"]);
    expect(activeCount(crew)).toBe("4");
  });

  it("only the service role can run the sweep, and no role can call the per-crew step", () => {
    for (const role of ["anon", "authenticated"]) {
      expect(db().sql(`select has_function_privilege('${role}','public.release_departed_social_crew_places(integer)','execute')`), role).toBe("f");
    }
    expect(db().sql("select has_function_privilege('service_role','public.release_departed_social_crew_places(integer)','execute')")).toBe("t");
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(db().sql(`select has_function_privilege('${role}','public._release_departed_crew_places(uuid)','execute')`), role).toBe("f");
    }
  });

  it("rollback keeps freed places and cancelled nights, stops releasing, and reapplying releases again", async () => {
    const host = person(), ana = person(), xav = person(), yan = person();
    const crew = crewWith(host, [ana, xav, yan]);
    db().sql(deleteAccount(xav));
    releaseAll();
    const ledger = db().sql("select count(*) from public.social_crew_removal_corrections");
    expect(await rollbackOutcome("rollback_0244", ledger)).toMatchObject({ ok: true });
    expect(db().sql("select to_regprocedure('public.release_departed_social_crew_places(integer)') is null")).toBe("t");
    expect(state(crew, xav)).toBe("left");
    db().sql(deleteAccount(yan));
    expect(state(crew, yan)).toBe("active");
    stageTo("after");
    releaseAll();
    expect(state(crew, yan)).toBe("left");
    expect(json(db().sql(`select public.${releaseCall()}::text`))).toMatchObject({ ok: true, crews: 0 });
  });
});
