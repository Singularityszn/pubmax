// Migration 0246 on a real PostgreSQL replay, applied after 0245 by the migration
// role of the permission replica. The captain's rule for a deleted account: free
// their guest places, cancel the nights they own, keep the history. Account
// deletion holds the auth row and account locks, so the release runs afterwards,
// in its own transaction, under each crew's row lock: from the deletion service,
// from any later sweep, and from every admission into that crew.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresSkipReason } from "./helpers/postgres";
import {
  type Person,
  DIGEST,
  NOT_FOUND,
  REFUSED_BY_LOCKS,
  admit,
  bootCrewAdmissionDatabase,
  call,
  correctionLedgerExport,
  crewWith,
  db,
  decide,
  decideCall,
  deleteAccount,
  hold,
  holdRpc,
  invite,
  json,
  key,
  memberId,
  mutual,
  outcome,
  person,
  releaseCall,
  request,
  requestCall,
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
beforeAll(async () => { if (!skipReason) await bootCrewAdmissionDatabase("crew-departure-0246", "after"); }, 600_000);
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

describe.skipIf(skipReason !== null)("0246: a deleted account's crew places", () => {
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

  it.each([false, true])("cancelled-night requests stay not found across fresh keys, sweep first: %s", (sweepFirst) => {
    const host = person(), ana = person(), bea = person();
    const crew = crewWith(host, [ana]);
    db().sql(deleteAccount(host));
    if (sweepFirst) releaseAll();
    expect(request(bea, crew)).toEqual(NOT_FOUND);
    expect(request(bea, crew)).toEqual(NOT_FOUND);
    expect(planStatus(crew)).toBe("abandoned");
    expect(db().sql(`select count(*) from public.social_crew_join_requests where crew_id='${crew}' and requester_account_id='${bea.account}'`)).toBe("0");
  });

  it("a sweep skips a busy crew without waiting, and later cleanup keeps one place each", async () => {
    const host = person(), ana = person(), cal = person(), xav = person(), bea = person();
    const crew = crewWith(host, [ana, cal]);
    withCapacity(crew, 4);
    admit(host, crew, xav);
    const asked = request(bea, crew);
    db().sql(deleteAccount(xav));
    const approval = await holdRpc(decideCall(host, crew, asked.request_id as string));
    expect(approval.result).toMatchObject({ ok: true, code: "accepted" });
    try {
      const swept = await outcome("sweep_after_approval", `set lock_timeout='250ms'; ${rpc(releaseCall())}`);
      expect(swept.ok, swept.said).toBe(true);
      expect(swept.said).not.toMatch(REFUSED_BY_LOCKS);
    } finally { await approval.finish(); }
    releaseAll();
    expect([state(crew, xav), state(crew, bea)]).toEqual(["left", "active"]);
    expect(activeCount(crew)).toBe("4");
  });

  it("a batch sweep does not deadlock with creator deletion and admission in another crew", async () => {
    releaseAll();
    const creator = person(), departedOwner = person(), otherHost = person(), applicant = person();
    mutual(creator, departedOwner);
    mutual(creator, otherHost);
    const crews = [crewWith(creator, [departedOwner, otherHost]), crewWith(creator, [departedOwner, otherHost])].sort();
    const [first, second] = crews as [string, string];
    for (const [crew, owner] of [[first, departedOwner], [second, otherHost]] as const) {
      expect(call(`transfer_social_crew_owner_atomic('${creator.account}','${crew}',
        '${memberId(crew, owner)}','${key()}','${DIGEST}')`)).toMatchObject({ ok: true, code: "transferred" });
    }
    const plan = db().sql(`select plan_id from public.social_crews where id='${first}'`);
    expect(db().sql(`select owner_user_id from public.plans where id='${plan}'`)).toBe(creator.user);
    db().sql(deleteAccount(departedOwner));
    db().sql(`create function public.departure_test_barrier() returns trigger language plpgsql as $$
      begin
        if new.id='${plan}' and new.status='abandoned' then perform pg_advisory_xact_lock(246731); end if;
        return new;
      end; $$;
      create trigger departure_test_barrier before update on public.plans
        for each row execute function public.departure_test_barrier();`);
    const barrier = await hold("select pg_advisory_xact_lock(246731)", "postgres");
    const jobs: Array<Promise<{ ok: boolean; said: string }>> = [];
    let results: Array<{ ok: boolean; said: string }> = [];
    try {
      jobs.push(outcome("batch_departure_sweep", rpc(releaseCall(100))));
      await expect.poll(() => waitsOnAnyLock("batch_departure_sweep")).toBe("t");
      jobs.push(outcome("batch_creator_delete", deleteAccount(creator), "postgres"));
      await expect.poll(() => waitsOnAnyLock("batch_creator_delete")).toBe("t");
      jobs.push(outcome("batch_other_admission", rpc(requestCall(applicant, second))));
      await expect.poll(() => waitsOnAnyLock("batch_other_admission")).toBe("t");
    } finally {
      await barrier.finish();
      results = await Promise.all(jobs);
      db().sql("drop trigger departure_test_barrier on public.plans; drop function public.departure_test_barrier()");
    }
    for (const result of results) {
      expect(result.ok, result.said).toBe(true);
      expect(result.said).not.toMatch(REFUSED_BY_LOCKS);
    }
    expect(planStatus(first)).toBe("abandoned");
    expect(db().sql(`select count(*) from auth.users where id='${creator.user}'`)).toBe("0");
    releaseAll();
    expect(state(second, creator)).toBe("left");
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
    const ledger = correctionLedgerExport().acknowledgement;
    expect(await rollbackOutcome("rollback_0246", ledger)).toMatchObject({ ok: true });
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
