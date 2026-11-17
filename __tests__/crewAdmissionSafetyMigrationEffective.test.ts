// Migration 0243 on a real PostgreSQL replay: admission, invitation, blocks,
// suspension and the host queue. A crew admits and invites nobody who has an
// active block, in either direction, with an accepted member, and nobody that
// crew removed. The refusal says only "not found".
//
// Each describe block moves the one database to the stage it needs in its own
// beforeAll, so every case runs alone. Each case makes its own people.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asServiceRole, postgresSkipReason } from "./helpers/postgres";
import {
  DIGEST,
  NOT_FOUND,
  NO_CREW,
  type Person,
  admit,
  answerInvitation,
  block,
  blockCall,
  bootCrewAdmissionDatabase,
  call,
  cancel,
  crewWith,
  db,
  decide,
  decideCall,
  holdRpc,
  invite,
  inviteCall,
  json,
  key,
  leave,
  makeCohost,
  memberId,
  mutual,
  ownership,
  person,
  queueCall,
  queued,
  remove,
  request,
  requestState,
  rpc,
  running,
  stageTo,
  state,
  stopCrewAdmissionDatabase,
  suspendCall,
  waiting,
  waitingRpcResult,
  waitsOnAccountLock,
} from "./helpers/crewAdmissionHarness";

const skipReason = postgresSkipReason();
beforeAll(async () => { if (!skipReason) await bootCrewAdmissionDatabase("crew-admission-0243", "before"); }, 600_000);
afterAll(async () => { await stopCrewAdmissionDatabase(); });

describe.skipIf(skipReason !== null)("before 0243", () => {
  beforeAll(() => { if (running()) stageTo("before"); });

  it("this cluster grants EXECUTE on a new function to every Supabase role, as Supabase does", () => {
    db().sql("create function public._default_grant_probe_0243() returns int language sql as 'select 1'");
    try {
      expect(db().sql(`select has_function_privilege('service_role','public._default_grant_probe_0243()','execute')
        and has_function_privilege('authenticated','public._default_grant_probe_0243()','execute')`)).toBe("t");
    } finally { db().sql("drop function public._default_grant_probe_0243()"); }
  });

  it("a block with an accepted guest and an earlier removal both leave the door open", () => {
    const host = person(), ana = person(), xav = person();
    const blocked = crewWith(host, [ana]);
    block(xav, ana);
    admit(host, blocked, xav);
    expect(state(blocked, ana)).toBe("active");

    const removed = crewWith(host, [ana]);
    admit(host, removed, xav);
    expect(remove(host, removed, xav)).toMatchObject({ ok: true, code: "removed" });
    admit(host, removed, xav);
  });
});

describe.skipIf(skipReason !== null)("after 0243: refusals", () => {
  beforeAll(() => { if (running()) stageTo("after"); });

  it("a request fails like an unknown crew when the requester and an accepted guest are blocked either way", () => {
    const host = person(), ana = person(), xav = person();
    expect(request(xav, NO_CREW)).toEqual(NOT_FOUND);
    for (const [blocker, blocked] of [[xav, ana], [ana, xav]] as const) {
      const crew = crewWith(host, [ana]);
      block(blocker, blocked);
      expect(request(xav, crew)).toEqual(NOT_FOUND);
      expect(db().sql(`select count(*) from public.social_crew_join_requests where crew_id='${crew}' and requester_account_id='${xav.account}'`)).toBe("0");
      expect(state(crew, ana)).toBe("active");
      db().sql(`delete from public.social_blocks where blocker_profile_id='${blocker.profile}'`);
    }
  });

  it("the host's acceptance fails neutrally once a block appears, replays the same answer, and the request can still be cancelled", () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    const asked = request(xav, crew);
    expect(asked).toMatchObject({ ok: true, code: "requested" });
    block(ana, xav);
    const decision = key();
    expect(decide(host, crew, asked.request_id as string, decision)).toEqual(NOT_FOUND);
    expect(decide(host, crew, asked.request_id as string, decision)).toEqual(NOT_FOUND);
    expect(state(crew, xav)).toBe("none");
    expect(state(crew, ana)).toBe("active");
    expect(requestState(asked.request_id as string)).toBe("pending");
    expect(cancel(xav, crew)).toMatchObject({ ok: true, code: "cancelled" });
    expect(requestState(asked.request_id as string)).toBe("cancelled");
  });

  it("a requester the host has since blocked can still cancel their own request, and cannot ask again", () => {
    const host = person(), xav = person();
    const crew = crewWith(host);
    const asked = request(xav, crew);
    expect(asked).toMatchObject({ ok: true, code: "requested" });
    block(host, xav);
    expect(cancel(xav, crew)).toMatchObject({ ok: true, code: "cancelled" });
    expect(requestState(asked.request_id as string)).toBe("cancelled");
    expect(request(xav, crew)).toEqual(NOT_FOUND);
    expect(cancel(xav, crew)).toEqual(NOT_FOUND);
  });

  it("the host's queue hides a request that acceptance would refuse, without saying why", () => {
    const host = person(), ana = person(), xav = person(), bea = person();
    const crew = crewWith(host, [ana]);
    request(xav, crew);
    request(bea, crew);
    expect(queued(host, crew)).toEqual([xav.handle, bea.handle]);
    block(xav, ana);
    expect(queued(host, crew)).toEqual([bea.handle]);
    expect(call(queueCall(host, crew))).toMatchObject({ hasMore: false });
  });

  it("an invitation cannot bring in a person who is blocked with an accepted guest, and a pending one can still be declined", () => {
    const host = person(), ana = person(), xav = person(), bea = person();
    mutual(host, xav);
    mutual(host, bea);
    const crew = crewWith(host, [ana]);
    const invitation = invite(host, crew, xav);
    expect(invitation).toMatchObject({ ok: true, code: "invited" });
    block(xav, ana);
    expect(answerInvitation(xav, crew, invitation.invitation_id as string, "accepted")).toEqual(NOT_FOUND);
    expect(state(crew, xav)).toBe("none");
    expect(answerInvitation(xav, crew, invitation.invitation_id as string, "declined")).toMatchObject({ ok: true, code: "declined" });

    block(ana, bea);
    expect(invite(host, crew, bea)).toEqual(NOT_FOUND);
    expect(db().sql(`select count(*) from public.social_crew_invitations where crew_id='${crew}' and target_account_id='${bea.account}'`)).toBe("0");
  });

  it("a block between two accepted guests changes no place and ends no seat", () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana, xav]);
    expect(block(ana, xav)).toBeTruthy();
    expect(state(crew, xav)).toBe("active");
    expect(state(crew, ana)).toBe("active");
    expect(db().sql(`select count(*) from public.plan_crew_members seat join public.social_crew_members member on member.plan_member_id=seat.id
      where member.crew_id='${crew}' and seat.membership_revoked_at is null`)).toBe("3");
  });

  it("removal bars that crew only, by request and by invitation, and a guest who left can come back", () => {
    const host = person(), ana = person(), xav = person();
    mutual(host, xav);
    const crew = crewWith(host, [ana, xav]);
    expect(remove(host, crew, xav)).toMatchObject({ ok: true, code: "removed" });
    expect(request(xav, crew)).toEqual(NOT_FOUND);
    expect(invite(host, crew, xav)).toEqual(NOT_FOUND);
    expect(state(crew, xav)).toBe("removed");

    crewWith(host, [xav]);

    const left = crewWith(host, [xav]);
    expect(leave(left, xav)).toMatchObject({ ok: true, code: "left" });
    admit(host, left, xav);
  });

  it("the lock, eligibility and admission helpers are not reachable by a browser role", () => {
    for (const role of ["anon", "authenticated"]) {
      expect(db().sql(`select has_function_privilege('${role}','public._lock_social_participant_accounts(uuid[])','execute')
        or has_function_privilege('${role}','public._social_crew_admission_refused(uuid,uuid)','execute')
        or has_function_privilege('${role}','public._social_crew_admission_ineligible(uuid,uuid)','execute')
        or has_function_privilege('${role}','public._lock_social_auth_user_accounts()','execute')`)).toBe("f");
    }
  });
});

describe.skipIf(skipReason !== null)("after 0243: duplicates, inviters and helpers", () => {
  beforeAll(() => { if (running()) stageTo("after"); });

  it("a second request on a new key after a block answers not found, while the first key replays and cancel still works", () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    const first = key();
    const asking = (idempotencyKey: string) =>
      call(`request_social_crew_join_atomic('${xav.account}','${crew}','pending','${idempotencyKey}','${DIGEST}')`);
    expect(asking(first)).toMatchObject({ ok: true, code: "requested" });
    block(ana, xav);
    expect(asking(key())).toEqual(NOT_FOUND);
    expect(asking(first)).toMatchObject({ ok: true, code: "replayed" });
    expect(cancel(xav, crew)).toMatchObject({ ok: true, code: "cancelled" });
  });

  it("a second invitation on a new key after a block answers not found, and the pending one can still be declined", () => {
    const host = person(), ana = person(), xav = person();
    mutual(host, xav);
    const crew = crewWith(host, [ana]);
    const invitation = invite(host, crew, xav);
    expect(invitation).toMatchObject({ ok: true, code: "invited" });
    block(xav, ana);
    expect(invite(host, crew, xav)).toEqual(NOT_FOUND);
    expect(answerInvitation(xav, crew, invitation.invitation_id as string, "declined")).toMatchObject({ ok: true, code: "declined" });
  });

  it("an invitation from a cohost who is later suspended can no longer be accepted", () => {
    const host = person(), bea = person(), xav = person();
    mutual(host, bea);
    mutual(host, xav);
    const crew = crewWith(host, [bea]);
    makeCohost(crew, bea);
    const invitation = invite(bea, crew, xav);
    expect(invitation).toMatchObject({ ok: true, code: "invited" });
    expect(call(suspendCall(bea))).toMatchObject({ ok: true, code: "suspended" });
    expect(answerInvitation(xav, crew, invitation.invitation_id as string, "accepted")).toEqual(NOT_FOUND);
    expect(state(crew, xav)).toBe("none");
  });

  it("an invitation loses its force when its cohost is removed, leaves or is made a member", () => {
    const changes: [string, (crew: string, bea: Person, host: Person) => unknown][] = [
      ["removed", (crew, bea, host) => remove(host, crew, bea)],
      ["left", (crew, bea) => leave(crew, bea)],
      ["made a member", (crew, bea, host) => call(`set_social_crew_role_atomic('${host.account}','${crew}','${memberId(crew, bea)}','member','${key()}','${DIGEST}')`)],
    ];
    for (const [change, apply] of changes) {
      const host = person(), bea = person(), xav = person();
      mutual(host, bea);
      mutual(host, xav);
      const crew = crewWith(host, [bea]);
      makeCohost(crew, bea);
      const invitation = invite(bea, crew, xav);
      expect(invitation, change).toMatchObject({ ok: true, code: "invited" });
      expect(apply(crew, bea, host), change).toMatchObject({ ok: true });
      expect(answerInvitation(xav, crew, invitation.invitation_id as string, "accepted"), change).toEqual(NOT_FOUND);
      expect(state(crew, xav), change).toBe("none");
    }
  });

  it("a cohost's invitation waits for that cohost's suspension in flight, then answers not found", async () => {
    const host = person(), bea = person(), xav = person();
    mutual(host, bea);
    mutual(host, xav);
    const crew = crewWith(host, [bea]);
    makeCohost(crew, bea);
    const suspension = await holdRpc(suspendCall(bea));
    try {
      const inviting = waitingRpcResult("invite_after_inviter_suspend", inviteCall(bea, crew, xav));
      await expect.poll(() => waitsOnAccountLock("invite_after_inviter_suspend")).toBe("t");
      await suspension.finish();
      expect(await inviting).toEqual(NOT_FOUND);
    } finally { await suspension.finish(); }
    expect(db().sql(`select count(*) from public.social_crew_invitations where crew_id='${crew}'`)).toBe("0");
  });

  it("an invitation acceptance waits for the owner's suspension in flight, then answers not found", async () => {
    const host = person(), ana = person(), xav = person();
    mutual(host, xav);
    const crew = crewWith(host, [ana]);
    const invitation = invite(host, crew, xav).invitation_id as string;
    const suspension = await holdRpc(suspendCall(host));
    try {
      const accepting = waitingRpcResult("accept_after_owner_suspend",
        `accept_social_crew_invitation_atomic('${xav.account}','${crew}','${invitation}','accepted','${key()}','${DIGEST}')`);
      await expect.poll(() => waitsOnAccountLock("accept_after_owner_suspend")).toBe("t");
      await suspension.finish();
      expect(await accepting).toEqual(NOT_FOUND);
    } finally { await suspension.finish(); }
    expect(state(crew, xav)).toBe("none");
  });

  it("an owner suspension waits for an invitation acceptance in flight, and the guest keeps the place", async () => {
    const host = person(), ana = person(), xav = person();
    mutual(host, xav);
    const crew = crewWith(host, [ana]);
    const invitation = invite(host, crew, xav).invitation_id as string;
    const acceptance = await holdRpc(
      `accept_social_crew_invitation_atomic('${xav.account}','${crew}','${invitation}','accepted','${key()}','${DIGEST}')`);
    expect(acceptance.result).toMatchObject({ ok: true, code: "accepted" });
    try {
      const suspending = waitingRpcResult("owner_suspend_after_accept", suspendCall(host));
      await expect.poll(() => waitsOnAccountLock("owner_suspend_after_accept")).toBe("t");
      await acceptance.finish();
      expect(await suspending).toMatchObject({ ok: true, code: "suspended" });
    } finally { await acceptance.finish(); }
    expect(state(crew, xav)).toBe("active");
  });

  it("no browser role and not the service role can call an internal lock, rule or trigger helper", () => {
    const helpers = ["_lock_social_participant_accounts(uuid[])", "_social_crew_admission_refused(uuid,uuid)",
      "_social_crew_admission_ineligible(uuid,uuid)", "_lock_social_block_participants()", "_lock_social_auth_user_accounts()"];
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const helper of helpers) {
        expect(db().sql(`select has_function_privilege('${role}','public.${helper}','execute')`), `${role} ${helper}`).toBe("f");
      }
    }
    for (const rpcName of ["decide_social_crew_join_request_atomic(uuid,uuid,uuid,text,text,text)",
      "provision_social_product_account(uuid)", "read_social_crew_join_requests(uuid,uuid,uuid)"]) {
      expect(db().sql(`select has_function_privilege('service_role','public.${rpcName}','execute')
        and not has_function_privilege('authenticated','public.${rpcName}','execute')`), rpcName).toBe("t");
    }
  });
});

describe.skipIf(skipReason !== null)("after 0243: races", () => {
  beforeAll(() => { if (running()) stageTo("after"); });

  it("two acceptances racing for the last place still admit exactly one", async () => {
    const host = person(), ana = person(), cal = person(), xav = person(), bea = person();
    const crew = crewWith(host, [ana]);
    db().sql(`update public.social_crews set capacity=4, meeting_venue_id='venue-one', description='One more place' where id='${crew}'`);
    admit(host, crew, cal);
    const first = request(xav, crew).request_id as string;
    const second = request(bea, crew).request_id as string;
    const answers = (await db().concurrentResults([
      asServiceRole(rpc(decideCall(host, crew, first))),
      asServiceRole(rpc(decideCall(host, crew, second))),
    ])).map((answer) => json(answer).code).sort();
    expect(answers).toEqual(["accepted", "full"]);
    expect(db().sql(`select count(*) from public.social_crew_members where crew_id='${crew}' and state='active'`)).toBe("4");
  });

  it("an acceptance waits for a block in flight, then refuses once it commits", async () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    const asked = request(xav, crew);
    const blocker = await holdRpc(blockCall(ana, xav));
    try {
      const acceptance = waitingRpcResult("accept_after_block", decideCall(host, crew, asked.request_id as string));
      await expect.poll(() => waitsOnAccountLock("accept_after_block")).toBe("t");
      await blocker.finish();
      expect(await acceptance).toEqual(NOT_FOUND);
    } finally { await blocker.finish(); }
    expect(state(crew, xav)).toBe("none");
    expect(state(crew, ana)).toBe("active");
  });

  it("a block waits for an acceptance in flight, then lands without removing anyone", async () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    const asked = request(xav, crew);
    const acceptance = await holdRpc(decideCall(host, crew, asked.request_id as string));
    expect(acceptance.result).toMatchObject({ ok: true, code: "accepted" });
    try {
      const blocking = waitingRpcResult("block_after_accept", blockCall(ana, xav));
      await expect.poll(() => waitsOnAccountLock("block_after_accept")).toBe("t");
      await acceptance.finish();
      expect(await blocking).toBe(true);
    } finally { await acceptance.finish(); }
    expect(state(crew, xav)).toBe("active");
    expect(state(crew, ana)).toBe("active");
  });

  it("a block row moved onto a new person waits for an acceptance in flight like a new block", async () => {
    const host = person(), ana = person(), xav = person(), bea = person(), cal = person();
    const crew = crewWith(host, [ana]);
    block(bea, cal);
    const asked = request(xav, crew);
    const acceptance = await holdRpc(decideCall(host, crew, asked.request_id as string));
    expect(acceptance.result).toMatchObject({ ok: true, code: "accepted" });
    try {
      const moving = waiting("block_moved_after_accept", `update public.social_blocks
        set blocker_profile_id='${ana.profile}', blocked_profile_id='${xav.profile}'
        where blocker_profile_id='${bea.profile}' and blocked_profile_id='${cal.profile}'`);
      await expect.poll(() => waitsOnAccountLock("block_moved_after_accept")).toBe("t");
      await acceptance.finish();
      expect(await moving).toMatchObject({ ok: true });
    } finally { await acceptance.finish(); }
    expect(state(crew, xav)).toBe("active");
  });

  it("an invitation waits for a block in flight, then refuses once it commits", async () => {
    const host = person(), ana = person(), xav = person();
    mutual(host, xav);
    const crew = crewWith(host, [ana]);
    const blocker = await holdRpc(blockCall(xav, ana));
    try {
      const inviting = waitingRpcResult("invite_after_block", inviteCall(host, crew, xav));
      await expect.poll(() => waitsOnAccountLock("invite_after_block")).toBe("t");
      await blocker.finish();
      expect(await inviting).toEqual(NOT_FOUND);
    } finally { await blocker.finish(); }
    expect(db().sql(`select count(*) from public.social_crew_invitations where crew_id='${crew}'`)).toBe("0");
  });

  it("a suspension and an acceptance take the account lock first, in either order, without deadlock", async () => {
    const host = person(), ana = person(), xav = person();
    const refused = crewWith(host, [ana]);
    const first = request(xav, refused);
    const suspension = await holdRpc(suspendCall(xav));
    expect(suspension.result).toMatchObject({ ok: true, code: "suspended" });
    try {
      const acceptance = waitingRpcResult("accept_after_suspend", decideCall(host, refused, first.request_id as string));
      await expect.poll(() => waitsOnAccountLock("accept_after_suspend")).toBe("t");
      await suspension.finish();
      expect(await acceptance).toEqual(NOT_FOUND);
    } finally { await suspension.finish(); }
    expect(state(refused, xav)).toBe("none");

    const bea = person();
    const accepted = crewWith(host, [ana]);
    const second = request(bea, accepted);
    const acceptance = await holdRpc(decideCall(host, accepted, second.request_id as string));
    expect(acceptance.result).toMatchObject({ ok: true, code: "accepted" });
    try {
      const suspending = waitingRpcResult("suspend_after_accept", suspendCall(bea));
      await expect.poll(() => waitsOnAccountLock("suspend_after_accept")).toBe("t");
      await acceptance.finish();
      expect(await suspending).toMatchObject({ ok: true, code: "suspended" });
    } finally { await acceptance.finish(); }
    expect(state(accepted, bea)).toBe("active");
  });

  it("a host whose suspension commits while their approval waits admits nobody, and the refusal replays", async () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    const asked = request(xav, crew);
    const decision = key();
    const suspension = await holdRpc(suspendCall(host));
    expect(suspension.result).toMatchObject({ ok: true, code: "suspended" });
    try {
      const approval = waitingRpcResult("approve_after_host_suspend", decideCall(host, crew, asked.request_id as string, decision));
      await expect.poll(() => waitsOnAccountLock("approve_after_host_suspend")).toBe("t");
      await suspension.finish();
      expect(await approval).toEqual(NOT_FOUND);
    } finally { await suspension.finish(); }
    expect(state(crew, xav)).toBe("none");
    expect(requestState(asked.request_id as string)).toBe("pending");
    db().sql(`update public.private_social_accounts set ownership_state='active' where id='${host.account}'`);
    expect(decide(host, crew, asked.request_id as string, decision)).toEqual(NOT_FOUND);
    expect(state(crew, xav)).toBe("none");
  });

  it("a host suspension waits for an approval in flight, and the guest it admitted keeps the place", async () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    const asked = request(xav, crew);
    const approval = await holdRpc(decideCall(host, crew, asked.request_id as string));
    expect(approval.result).toMatchObject({ ok: true, code: "accepted" });
    try {
      const suspending = waitingRpcResult("host_suspend_after_approve", suspendCall(host));
      await expect.poll(() => waitsOnAccountLock("host_suspend_after_approve")).toBe("t");
      await approval.finish();
      expect(await suspending).toMatchObject({ ok: true, code: "suspended" });
    } finally { await approval.finish(); }
    expect(state(crew, xav)).toBe("active");
    expect(ownership(host)).toBe("suspended");
  });

  it("admissions to two crews that share guests wait their turn on the shared locks and both land", async () => {
    const host = person(), ana = person(), bea = person(), xav = person(), yan = person();
    const first = crewWith(host, [ana, bea]);
    const second = crewWith(host, [bea, ana]);
    const askedFirst = request(xav, first);
    const askedSecond = request(yan, second);
    const firstApproval = await holdRpc(decideCall(host, first, askedFirst.request_id as string));
    expect(firstApproval.result).toMatchObject({ ok: true, code: "accepted" });
    try {
      const secondApproval = waitingRpcResult("overlap_second", decideCall(host, second, askedSecond.request_id as string));
      await expect.poll(() => waitsOnAccountLock("overlap_second")).toBe("t");
      await firstApproval.finish();
      expect(await secondApproval).toMatchObject({ ok: true, code: "accepted" });
    } finally { await firstApproval.finish(); }
    expect(state(first, xav)).toBe("active");
    expect(state(second, yan)).toBe("active");
  });

  it("the host's queue never waits on the account locks a write holds", async () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    request(xav, crew);
    const blocker = await holdRpc(blockCall(ana, xav));
    try {
      expect(queued(host, crew)).toEqual([xav.handle]);
    } finally { await blocker.finish(); }
    expect(queued(host, crew)).toEqual([]);
  });
});

/** The three references into member and seat rows, as PostgreSQL prints them. */
const memberReferences = () => db().sql(`select pg_get_constraintdef(oid) from pg_constraint
  where conname in ('social_crew_members_plan_member_id_fkey','social_crew_invitations_invited_by_member_id_fkey',
    'social_crew_join_requests_decided_by_member_id_fkey') order by 1`);

describe.skipIf(skipReason !== null)("rollback and reapply", () => {
  beforeAll(() => { if (running()) stageTo("after"); });

  it("rollback restores the old admission answers and drops the locks, and reapplying restores the refusals", () => {
    stageTo("before");
    expect(db().sql(`select to_regprocedure('public._lock_social_participant_accounts(uuid[])') is null
      and to_regprocedure('public._social_crew_admission_refused(uuid,uuid)') is null
      and to_regprocedure('public._social_crew_admission_ineligible(uuid,uuid)') is null
      and to_regprocedure('public._lock_social_auth_user_accounts()') is null
      and to_regprocedure('public.correct_social_crew_removal_admin(uuid,uuid,uuid,text)') is null
      and to_regclass('public.social_crew_removal_corrections') is null
      and not exists(select 1 from pg_trigger where tgname in ('social_blocks_lock_participant_accounts','lock_social_accounts_on_auth_user_delete'))`)).toBe("t");
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    block(xav, ana);
    admit(host, crew, xav);
    expect(remove(host, crew, xav)).toMatchObject({ ok: true, code: "removed" });
    admit(host, crew, xav);
    expect(call(suspendCall(xav))).toMatchObject({ ok: true, code: "suspended" });
    expect(memberReferences()).toBe([
      "FOREIGN KEY (decided_by_member_id) REFERENCES social_crew_members(id) ON DELETE RESTRICT",
      "FOREIGN KEY (invited_by_member_id) REFERENCES social_crew_members(id) ON DELETE RESTRICT",
      "FOREIGN KEY (plan_member_id) REFERENCES plan_crew_members(id) ON DELETE RESTRICT",
    ].join("\n"));

    stageTo("after");
    expect(memberReferences()).toBe([
      "FOREIGN KEY (decided_by_member_id) REFERENCES social_crew_members(id) ON DELETE RESTRICT",
      "FOREIGN KEY (invited_by_member_id) REFERENCES social_crew_members(id) ON DELETE RESTRICT",
      "FOREIGN KEY (plan_member_id) REFERENCES plan_crew_members(id) DEFERRABLE INITIALLY DEFERRED",
    ].join("\n"));
    const bea = person();
    const again = crewWith(host, [ana]);
    block(bea, ana);
    expect(request(bea, again)).toEqual(NOT_FOUND);
  });
});
