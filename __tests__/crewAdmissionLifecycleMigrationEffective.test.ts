// Migration 0243 on a real PostgreSQL replay: the account lifecycle around crew
// admission. Account deletion, provisioning and suspension take the auth row and
// the account lock in one order with admission, so each race finishes. A
// moderator lifts one crew's removal through an audited, service-only call.
//
// The database starts with 0243 applied. Each case makes its own people.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresSkipReason } from "./helpers/postgres";
import {
  DIGEST,
  NOT_FOUND,
  REFUSED_BY_LOCKS,
  STAFF_ROLE,
  admit,
  block,
  bootCrewAdmissionDatabase,
  call,
  correct,
  correctCall,
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
  ownership,
  person,
  remove,
  request,
  requestCall,
  rpc,
  running,
  seats,
  stageTo,
  state,
  stopCrewAdmissionDatabase,
  suspendCall,
  waiting,
  waitingRpc,
  waitingRpcResult,
  waitsOnAccountLock,
  waitsOnAnyLock,
} from "./helpers/crewAdmissionHarness";

const skipReason = postgresSkipReason();
beforeAll(async () => { if (!skipReason) await bootCrewAdmissionDatabase("crew-lifecycle-0243", "after"); }, 600_000);
afterAll(async () => { await stopCrewAdmissionDatabase(); });

describe.skipIf(skipReason !== null)("after 0243: account deletion", () => {
  beforeAll(() => { if (running()) stageTo("after"); });

  it("a deletion waits for an admission that holds a guest's account lock, then completes", async () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    const asked = request(xav, crew);
    const approval = await holdRpc(decideCall(host, crew, asked.request_id as string));
    expect(approval.result).toMatchObject({ ok: true, code: "accepted" });
    try {
      const deletion = waiting("delete_after_admission", deleteAccount(ana), "postgres");
      await expect.poll(() => waitsOnAccountLock("delete_after_admission")).toBe("t");
      const authRow = await db().attempt(`select 1 from auth.users where id='${ana.user}' for key share nowait`);
      expect(authRow.said).toContain("55P03");
      await approval.finish();
      expect(await deletion).toMatchObject({ ok: true });
    } finally { await approval.finish(); }
    expect(state(crew, xav)).toBe("active");
    expect(ownership(ana)).toBe("suspended");
  });

  it("an approval waits for the requester's deletion in flight on the auth row, then refuses neutrally and leaves no seat", async () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    const asked = request(xav, crew);
    const deletion = await hold(deleteAccount(xav), "postgres");
    let approval: Promise<{ ok: boolean; said: string }> | null = null;
    try {
      approval = outcome("approve_after_delete", rpc(decideCall(host, crew, asked.request_id as string)));
      await expect.poll(() => waitsOnAnyLock("approve_after_delete")).toBe("t");
    } finally { await deletion.finish(); }
    const answer = await approval;
    expect(answer?.said ?? "").not.toMatch(REFUSED_BY_LOCKS);
    expect(answer?.ok).toBe(true);
    expect(json(answer?.said.trim() ?? "{}")).toEqual(NOT_FOUND);
    expect(seats(crew, xav)).toBe("0|0");
    expect(ownership(xav)).toBe("suspended");
  });

  it("an invitation acceptance waits for the invitee's own deletion in flight, then refuses and leaves no seat", async () => {
    const host = person(), ana = person(), xav = person();
    mutual(host, xav);
    const crew = crewWith(host, [ana]);
    const invitation = invite(host, crew, xav).invitation_id as string;
    const deletion = await hold(deleteAccount(xav), "postgres");
    let acceptance: Promise<{ ok: boolean; said: string }> | null = null;
    try {
      acceptance = outcome("accept_invite_after_delete",
        rpc(`accept_social_crew_invitation_atomic('${xav.account}','${crew}','${invitation}','accepted','${key()}','${DIGEST}')`));
      await expect.poll(() => waitsOnAnyLock("accept_invite_after_delete")).toBe("t");
    } finally { await deletion.finish(); }
    const answer = await acceptance;
    expect(answer?.said ?? "").not.toMatch(REFUSED_BY_LOCKS);
    expect(answer?.ok).toBe(true);
    expect(json(answer?.said.trim() ?? "{}")).toEqual(NOT_FOUND);
    expect(seats(crew, xav)).toBe("0|0");
  });

  it("a deletion and a suspension of the same person both finish when the moderator reaches the profile first", async () => {
    const xav = person();
    const profileHolder = await hold(`select id from public.profiles where id='${xav.profile}' for update`, "postgres");
    let suspension: Promise<{ ok: boolean; said: string }> | null = null;
    let deletion: Promise<{ ok: boolean; said: string }> | null = null;
    try {
      suspension = waitingRpc("suspend_racing_delete", suspendCall(xav));
      await expect.poll(() => waitsOnAnyLock("suspend_racing_delete")).toBe("t");
      deletion = waiting("delete_racing_suspend", deleteAccount(xav), "postgres");
      await expect.poll(() => waitsOnAnyLock("delete_racing_suspend")).toBe("t");
    } finally { await profileHolder.finish(); }
    const answers = await Promise.allSettled([suspension, deletion]);
    expect(answers.map((answer) => answer.status === "fulfilled" ? answer.value?.ok || answer.value?.said : String(answer.reason)))
      .toEqual([true, true]);
    expect(ownership(xav)).toBe("suspended");
    expect(db().sql(`select supabase_user_id is null from public.private_social_accounts where id='${xav.account}'`)).toBe("t");
  });

  it("a suspension after a deletion answers gone, and the person's crew seat stays closed", async () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    const asked = request(xav, crew);
    db().sql(deleteAccount(xav));
    expect(call(suspendCall(xav))).toMatchObject({ ok: false, code: "gone" });
    expect(decide(host, crew, asked.request_id as string)).toEqual(NOT_FOUND);
    expect(state(crew, xav)).toBe("none");
  });

  it("a requester's own deletion that starts while their new seat is being made waits, and both finish", async () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    const asked = request(xav, crew);
    const plan = db().sql(`select plan_id from public.social_crews where id='${crew}'`);
    const seatLock = await hold(`select pg_advisory_xact_lock(hashtextextended('plan:join-account:${plan}:${xav.user}',0))`, "postgres");
    let approval: Promise<{ ok: boolean; said: string }> | null = null;
    let deletion: Promise<{ ok: boolean; said: string }> | null = null;
    try {
      approval = outcome("seat_then_delete_approve", rpc(decideCall(host, crew, asked.request_id as string)));
      await expect.poll(() => waitsOnAccountLock("seat_then_delete_approve")).toBe("t");
      deletion = outcome("seat_then_delete_delete", deleteAccount(xav), "postgres");
      await expect.poll(() => waitsOnAnyLock("seat_then_delete_delete")).toBe("t");
      expect(await waitsOnAccountLock("seat_then_delete_delete")).toBe("f");
    } finally { await seatLock.finish(); }
    const [approved, deleted] = await Promise.all([approval, deletion]);
    for (const answer of [approved, deleted]) expect(answer?.said ?? "").not.toMatch(REFUSED_BY_LOCKS);
    expect(deleted?.ok).toBe(true);
    expect(approved?.ok).toBe(true);
    expect(json(approved?.said.trim() ?? "{}")).toMatchObject({ ok: true, code: "accepted" });
    expect(state(crew, xav)).toBe("active");
    expect(ownership(xav)).toBe("suspended");
    expect(db().sql(`select count(*) from public.plan_crew_members seat join public.social_crew_members member on member.plan_member_id=seat.id
      where member.crew_id='${crew}' and member.social_account_id='${xav.account}' and seat.user_id is null`)).toBe("1");
  });
});

describe.skipIf(skipReason !== null)("after 0243: moderator correction of a mistaken removal", () => {
  beforeAll(() => { if (running()) stageTo("after"); });

  it("a removed person stays barred with the neutral answer until a moderator corrects that crew's removal, then asks again under the usual checks", () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana, xav]);
    const removedMember = memberId(crew, xav);
    expect(remove(host, crew, xav)).toMatchObject({ ok: true, code: "removed" });
    expect(request(xav, crew)).toEqual(NOT_FOUND);
    expect(correct(crew, removedMember)).toMatchObject({ ok: true, code: "corrected", state: "left" });
    expect(state(crew, xav)).toBe("left");
    expect(db().sql(`select count(*)||'|'||min(staff_display_name)||'|'||min(social_account_id::text)||'|'||min(reason)
      from public.social_crew_removal_corrections where crew_id='${crew}'`)).toBe(`1|Moderator|${xav.account}|Removed by mistake`);
    admit(host, crew, xav);
  });

  it("a correction admits nobody by itself, so a block with a guest still refuses the next request", () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana, xav]);
    const removedMember = memberId(crew, xav);
    remove(host, crew, xav);
    block(ana, xav);
    expect(correct(crew, removedMember)).toMatchObject({ ok: true, code: "corrected" });
    expect(db().sql(`select count(*) from public.social_crew_members where crew_id='${crew}' and state='active'`)).toBe("2");
    expect(request(xav, crew)).toEqual(NOT_FOUND);
  });

  it("only an active moderator corrects, with a reason, the named crew's removed member, and a repeat changes nothing", () => {
    const host = person(), ana = person(), xav = person(), clerk = person();
    const inactive = "a2438888-0000-4000-8000-000000000042";
    db().sql(`insert into public.private_social_staff_roles(id,profile_id,display_name,role,active) values ('${inactive}','${clerk.profile}','Former','moderator',false)`);
    const crew = crewWith(host, [ana, xav]);
    const other = crewWith(host, [ana]);
    const removedMember = memberId(crew, xav);
    remove(host, crew, xav);
    expect(() => correct(crew, removedMember, inactive)).toThrow(/staff required/);
    expect(correct(crew, removedMember, STAFF_ROLE, "x")).toEqual({ ok: false, code: "invalid" });
    expect(correct(other, removedMember)).toEqual({ ok: false, code: "not_found" });
    expect(correct(crew, memberId(crew, ana))).toEqual({ ok: true, code: "unchanged", state: "active" });
    expect(state(crew, xav)).toBe("removed");
    expect(db().sql(`select count(*) from public.social_crew_removal_corrections where crew_id in ('${crew}','${other}')`)).toBe("0");
    expect(correct(crew, removedMember)).toMatchObject({ ok: true, code: "corrected" });
    expect(correct(crew, removedMember)).toEqual({ ok: true, code: "unchanged", state: "left" });
    expect(db().sql(`select count(*) from public.social_crew_removal_corrections where crew_id='${crew}'`)).toBe("1");
  });

  it("a request from the removed person waits for a correction in flight, then lands", async () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana, xav]);
    const removedMember = memberId(crew, xav);
    remove(host, crew, xav);
    const correction = await holdRpc(correctCall(crew, removedMember));
    expect(correction.result).toMatchObject({ ok: true, code: "corrected" });
    try {
      const asking = waitingRpcResult("request_after_correction", requestCall(xav, crew));
      await expect.poll(() => waitsOnAnyLock("request_after_correction")).toBe("t");
      await correction.finish();
      expect(await asking).toMatchObject({ ok: true, code: "requested" });
    } finally { await correction.finish(); }
  });

  it("browser roles cannot run the correction or read its ledger, and the ledger only grows", () => {
    for (const role of ["anon", "authenticated"]) {
      expect(db().sql(`select has_function_privilege('${role}','public.correct_social_crew_removal_admin(uuid,uuid,uuid,text)','execute')
        or has_table_privilege('${role}','public.social_crew_removal_corrections','select,insert,update,delete')`)).toBe("f");
    }
    expect(db().sql(`select has_function_privilege('service_role','public.correct_social_crew_removal_admin(uuid,uuid,uuid,text)','execute')
      and has_table_privilege('service_role','public.social_crew_removal_corrections','select,insert')
      and not has_table_privilege('service_role','public.social_crew_removal_corrections','update,delete')`)).toBe("t");
  });
});

