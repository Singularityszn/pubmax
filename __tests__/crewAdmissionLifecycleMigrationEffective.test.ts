// Migration 0245 on a real PostgreSQL replay: the account lifecycle around crew
// admission. Account deletion, provisioning and suspension take the auth row and
// the account lock in one order with admission, so each race finishes. A
// moderator lifts one crew's removal through an audited, service-only call.
//
// The database starts with 0245 applied. Each case makes its own people.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresSkipReason } from "./helpers/postgres";
import {
  DIGEST,
  NOT_FOUND,
  type Person,
  REFUSED_BY_LOCKS,
  ROLLBACK_0245_ONLY,
  STAFF_ROLE,
  accountOf,
  admit,
  answerInvitation,
  block,
  bootCrewAdmissionDatabase,
  call,
  correct,
  correctCall,
  correctionLedgerExport,
  corrections,
  crewWith,
  db,
  decide,
  decideCall,
  deleteAccount,
  forwardOutcome,
  hold,
  holdRpc,
  invite,
  inviteCall,
  json,
  key,
  leaveCall,
  memberId,
  mutual,
  outcome,
  ownership,
  person,
  receipts,
  releaseCall,
  remove,
  request,
  requestCall,
  revision,
  rollbackOutcome,
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
let moderator: Person | null = null;
const staff = () => { if (!moderator) throw new Error("The moderator was not created."); return moderator; };
beforeAll(async () => { if (!skipReason) moderator = await bootCrewAdmissionDatabase("crew-lifecycle-0245", "after"); }, 600_000);
afterAll(async () => { await stopCrewAdmissionDatabase(); });

describe.skipIf(skipReason !== null)("after 0245: account deletion", () => {
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

describe.skipIf(skipReason !== null)("after 0245: moderator correction of a mistaken removal", () => {
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


describe.skipIf(skipReason !== null)("after 0245: Crew write receipts end with the account", () => {
  beforeAll(() => { if (running()) stageTo("after"); });

  it("deletion removes the deleted person's receipts and keeps everyone else's, a suspended person's and replays", () => {
    const host = person(), ana = person(), xav = person(), bea = person();
    const crew = crewWith(host, [ana, xav, bea]);
    const other = crewWith(host);
    request(xav, other);
    request(bea, other);
    expect(call(suspendCall(bea))).toMatchObject({ ok: true, code: "suspended" });
    const anaKey = key();
    const asking = () => call(`request_social_crew_join_atomic('${ana.account}','${other}','pending','${anaKey}','${DIGEST}')`);
    expect(asking()).toMatchObject({ ok: true, code: "requested" });
    const kept = [host, ana, bea].map(receipts);
    expect(Number(receipts(xav))).toBeGreaterThan(0);
    db().sql(deleteAccount(xav));
    expect(receipts(xav)).toBe("0");
    expect([host, ana, bea].map(receipts)).toEqual(kept);
    expect(asking()).toMatchObject({ ok: true, code: "replayed" });
    expect(state(crew, xav)).toBe("active");
  });

  it("a deletion waits for the person's own Crew write in flight, then removes the receipt it wrote", async () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana, xav]);
    const leaving = await holdRpc(leaveCall(crew, xav));
    expect(leaving.result).toMatchObject({ ok: true, code: "left" });
    let deletion: Promise<{ ok: boolean; said: string }> | null = null;
    try {
      deletion = outcome("delete_after_leave", deleteAccount(xav), "postgres");
      await expect.poll(() => waitsOnAnyLock("delete_after_leave")).toBe("t");
    } finally { await leaving.finish(); }
    const answer = await deletion;
    expect(answer?.said ?? "").not.toMatch(REFUSED_BY_LOCKS);
    expect(answer?.ok).toBe(true);
    expect(state(crew, xav)).toBe("left");
    expect(receipts(xav)).toBe("0");
  });

  it("a leave that starts while the person's deletion waits after writing the account row is undone whole", async () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana, xav]);
    const profileRow = await hold(`select id from public.profiles where id='${xav.profile}' for update`, "postgres");
    let deletion: Promise<{ ok: boolean; said: string }> | null = null;
    let leaving: Promise<{ ok: boolean; said: string }> | null = null;
    try {
      deletion = outcome("delete_waiting_on_profile", deleteAccount(xav), "postgres");
      await expect.poll(() => waitsOnAnyLock("delete_waiting_on_profile")).toBe("t");
      leaving = outcome("leave_during_delete", rpc(leaveCall(crew, xav)));
      await expect.poll(() => waitsOnAnyLock("leave_during_delete")).toBe("t");
    } finally { await profileRow.finish(); }
    const [deleted, left] = await Promise.all([deletion, leaving]);
    for (const answer of [deleted, left]) expect(answer?.said ?? "").not.toMatch(REFUSED_BY_LOCKS);
    expect(deleted?.ok).toBe(true);
    expect(left?.said).toContain("the account was deleted");
    expect(state(crew, xav)).toBe("active");
    expect(receipts(xav)).toBe("0");
  });

  it("a Crew write that meets the person's deletion in flight is undone whole, a refusal stays neutral, and neither leaves a receipt", async () => {
    const host = person(), ana = person(), xav = person(), yan = person();
    const crew = crewWith(host, [ana, xav]);
    const other = crewWith(host);
    const seatOf = (who: Person) => db().sql(`select coalesce(seat.membership_revoked_at::text,'open') from public.plan_crew_members seat
      join public.social_crew_members member on member.plan_member_id=seat.id where member.crew_id='${crew}' and member.social_account_id='${who.account}'`);
    for (const [who, label, statement] of [
      [xav, "leave", leaveCall(crew, xav)],
      [yan, "request", requestCall(yan, other)],
    ] as const) {
      const deletion = await hold(deleteAccount(who), "postgres");
      let writing: Promise<{ ok: boolean; said: string }> | null = null;
      try {
        writing = outcome(`${label}_after_delete`, rpc(statement));
        await expect.poll(() => waitsOnAnyLock(`${label}_after_delete`)).toBe("t");
      } finally { await deletion.finish(); }
      const answer = await writing;
      expect(answer?.said ?? "", label).not.toMatch(REFUSED_BY_LOCKS);
      if (label === "leave") {
        expect(answer?.ok, label).toBe(false);
        expect(answer?.said, label).toContain("the account was deleted");
      } else {
        expect(json(answer?.said.trim() ?? "{}"), label).toEqual(NOT_FOUND);
      }
      expect(receipts(who), label).toBe("0");
    }
    expect(state(crew, xav)).toBe("active");
    expect(seatOf(xav)).toBe("open");
    expect(db().sql(`select count(*) from public.social_crew_join_requests where requester_account_id='${yan.account}'`)).toBe("0");
  });
});

describe.skipIf(skipReason !== null)("after 0245: owner and invitee deletion", () => {
  beforeAll(() => { if (running()) stageTo("after"); });

  const acceptCall = (who: Person, crew: string, invitation: string) =>
    `accept_social_crew_invitation_atomic('${who.account}','${crew}','${invitation}','accepted','${key()}','${DIGEST}')`;

  it("an invitation acceptance waits for the owner's deletion in flight, then answers not found", async () => {
    const host = person(), ana = person(), xav = person();
    mutual(host, xav);
    const crew = crewWith(host, [ana]);
    const invitation = invite(host, crew, xav).invitation_id as string;
    const deletion = await hold(deleteAccount(host), "postgres");
    let accepting: Promise<{ ok: boolean; said: string }> | null = null;
    try {
      accepting = outcome("accept_after_owner_delete", rpc(acceptCall(xav, crew, invitation)));
      await expect.poll(() => waitsOnAnyLock("accept_after_owner_delete")).toBe("t");
    } finally { await deletion.finish(); }
    const answer = await accepting;
    expect(answer?.said ?? "").not.toMatch(REFUSED_BY_LOCKS);
    expect(json(answer?.said.trim() ?? "{}")).toEqual(NOT_FOUND);
    expect(seats(crew, xav)).toBe("0|0");
  });

  it("an owner's deletion waits for an invitation acceptance in flight, and both finish", async () => {
    const host = person(), ana = person(), xav = person();
    mutual(host, xav);
    const crew = crewWith(host, [ana]);
    const invitation = invite(host, crew, xav).invitation_id as string;
    const acceptance = await holdRpc(acceptCall(xav, crew, invitation));
    expect(acceptance.result).toMatchObject({ ok: true, code: "accepted" });
    let deletion: Promise<{ ok: boolean; said: string }> | null = null;
    try {
      deletion = outcome("owner_delete_after_accept", deleteAccount(host), "postgres");
      await expect.poll(() => waitsOnAccountLock("owner_delete_after_accept")).toBe("t");
    } finally { await acceptance.finish(); }
    expect((await deletion)?.ok).toBe(true);
    expect(state(crew, xav)).toBe("active");
    expect(ownership(host)).toBe("suspended");
  });

  it("an invitation waits for the invitee's deletion in flight, then answers not found and stores nothing", async () => {
    const host = person(), ana = person(), xav = person();
    mutual(host, xav);
    const crew = crewWith(host, [ana]);
    const deletion = await hold(deleteAccount(xav), "postgres");
    let inviting: Promise<{ ok: boolean; said: string }> | null = null;
    try {
      inviting = outcome("invite_after_invitee_delete", rpc(inviteCall(host, crew, xav)));
      await expect.poll(() => waitsOnAnyLock("invite_after_invitee_delete")).toBe("t");
    } finally { await deletion.finish(); }
    const answer = await inviting;
    expect(answer?.said ?? "").not.toMatch(REFUSED_BY_LOCKS);
    expect(json(answer?.said.trim() ?? "{}")).toEqual(NOT_FOUND);
    expect(db().sql(`select count(*) from public.social_crew_invitations where crew_id='${crew}'`)).toBe("0");
  });
});

describe.skipIf(skipReason !== null)("after 0245: provisioning and account-less suspension against deletion", () => {
  beforeAll(() => { if (running()) stageTo("after"); });

  /** Holds the profile row so two writers queue behind it in a chosen order. */
  async function raceBehindProfile(who: Person, first: [string, string, "service_role" | "postgres"],
    second: [string, string, "service_role" | "postgres"]) {
    const holder = await hold(`select id from public.profiles where id='${who.profile}' for update`, "postgres");
    let one: Promise<{ ok: boolean; said: string }> | null = null;
    let two: Promise<{ ok: boolean; said: string }> | null = null;
    try {
      one = outcome(first[0], first[1], first[2]);
      await expect.poll(() => waitsOnAnyLock(first[0])).toBe("t");
      two = outcome(second[0], second[1], second[2]);
      await expect.poll(() => waitsOnAnyLock(second[0])).toBe("t");
    } finally { await holder.finish(); }
    return Promise.all([one, two]);
  }

  it("a Social sign-in that provisions an existing account and a deletion of that person both finish", async () => {
    const xav = person();
    const [provisioned, deleted] = await raceBehindProfile(xav,
      ["provision_racing_delete", rpc(`provision_social_product_account('${xav.user}')`), "service_role"],
      ["delete_racing_provision", deleteAccount(xav), "postgres"]);
    for (const answer of [provisioned, deleted]) expect(answer?.said ?? "").not.toMatch(REFUSED_BY_LOCKS);
    expect(json(provisioned?.said.trim() ?? "{}")).toMatchObject({ ok: true, product_account_id: xav.account });
    expect(deleted?.ok).toBe(true);
    expect(accountOf(xav)).toBe(`${xav.account}|suspended|true`);
  });

  it("a moderator suspending a person with no Social account and that person's deletion both finish", async () => {
    const xav = person({ account: false });
    const [suspended, deleted] = await raceBehindProfile(xav,
      ["accountless_suspend_racing_delete", rpc(suspendCall(xav)), "service_role"],
      ["delete_racing_accountless_suspend", deleteAccount(xav), "postgres"]);
    for (const answer of [suspended, deleted]) expect(answer?.said ?? "").not.toMatch(REFUSED_BY_LOCKS);
    expect(json(suspended?.said.trim() ?? "{}")).toMatchObject({ ok: true, code: "suspended" });
    expect(deleted?.ok).toBe(true);
    expect(accountOf(xav)).toMatch(/\|suspended\|true$/);
  });

  it("provisioning and an account-less suspension that start during a deletion wait, then refuse without creating an account", async () => {
    const xav = person({ account: false });
    const deletion = await hold(deleteAccount(xav), "postgres");
    let provisioning: Promise<{ ok: boolean; said: string }> | null = null;
    let suspending: Promise<{ ok: boolean; said: string }> | null = null;
    try {
      provisioning = outcome("provision_after_delete", rpc(`provision_social_product_account('${xav.user}')`));
      await expect.poll(() => waitsOnAnyLock("provision_after_delete")).toBe("t");
      suspending = outcome("suspend_after_delete", rpc(suspendCall(xav)));
      await expect.poll(() => waitsOnAnyLock("suspend_after_delete")).toBe("t");
    } finally { await deletion.finish(); }
    for (const answer of [await provisioning, await suspending]) {
      expect(answer?.said ?? "").not.toMatch(REFUSED_BY_LOCKS);
      expect(json(answer?.said.trim() ?? "{}")).toMatchObject({ ok: false });
    }
    expect(accountOf(xav)).toBe("none");
  });
});

describe.skipIf(skipReason !== null)("after 0245: departed members", () => {
  beforeAll(() => { if (running()) stageTo("after"); });

  it("a guest who deleted their account no longer bars the people they blocked, and their place is freed", () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    block(ana, xav);
    expect(request(xav, crew)).toEqual(NOT_FOUND);
    db().sql(deleteAccount(ana));
    admit(host, crew, xav);
    expect(state(crew, ana)).toBe("left");
    expect(db().sql(`select count(*) from public.social_crew_members where crew_id='${crew}' and state='active'`)).toBe("2");
  });

  it("a suspended guest who still has an account keeps barring the people they blocked", () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    block(xav, ana);
    expect(call(suspendCall(ana))).toMatchObject({ ok: true, code: "suspended" });
    expect(request(xav, crew)).toEqual(NOT_FOUND);
  });
});

describe.skipIf(skipReason !== null)("after 0245: correction bookkeeping", () => {
  beforeAll(() => { if (running()) stageTo("after"); });

  it("a correction moves the crew's authority revision like every other membership change", () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana, xav]);
    const removedMember = memberId(crew, xav);
    remove(host, crew, xav);
    const before = Number(revision(crew));
    expect(correct(crew, removedMember)).toMatchObject({ ok: true, code: "corrected" });
    expect(Number(revision(crew))).toBe(before + 1);
  });

  it("a moderator cannot correct their own removal", () => {
    const host = person(), ana = person();
    const crew = crewWith(host, [ana, staff()]);
    const removedMember = memberId(crew, staff());
    remove(host, crew, staff());
    expect(correct(crew, removedMember)).toEqual({ ok: false, code: "forbidden" });
    expect(state(crew, staff())).toBe("removed");
    expect(db().sql(`select count(*) from public.social_crew_removal_corrections where crew_id='${crew}'`)).toBe("0");
  });

  it("the subject's account deletion erases their correction row with the account, and a deleted subject cannot be corrected", () => {
    const host = person(), ana = person(), xav = person(), bea = person();
    const crew = crewWith(host, [ana, xav, bea]);
    const xavMember = memberId(crew, xav);
    const beaMember = memberId(crew, bea);
    remove(host, crew, xav);
    remove(host, crew, bea);
    expect(correct(crew, xavMember)).toMatchObject({ ok: true, code: "corrected" });
    expect(corrections(crew)).toBe("1");
    db().sql(deleteAccount(xav));
    expect(corrections(crew)).toBe("0");
    db().sql(deleteAccount(bea));
    expect(correct(crew, beaMember)).toEqual({ ok: false, code: "gone" });
    expect(state(crew, bea)).toBe("removed");
    expect(corrections(crew)).toBe("0");
  });

  it("a correction waits for its subject's deletion in flight, then answers gone and changes nothing", async () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana, xav]);
    const removedMember = memberId(crew, xav);
    remove(host, crew, xav);
    const revisionBefore = revision(crew);
    const deletion = await hold(deleteAccount(xav), "postgres");
    let correcting: Promise<{ ok: boolean; said: string }> | null = null;
    try {
      correcting = outcome("correct_after_delete", rpc(correctCall(crew, removedMember)));
      await expect.poll(() => waitsOnAnyLock("correct_after_delete")).toBe("t");
    } finally { await deletion.finish(); }
    const answer = await correcting;
    expect(answer?.said ?? "").not.toMatch(REFUSED_BY_LOCKS);
    expect(json(answer?.said.trim() ?? "{}")).toEqual({ ok: false, code: "gone" });
    expect(state(crew, xav)).toBe("removed");
    expect(revision(crew)).toBe(revisionBefore);
    expect(corrections(crew)).toBe("0");
  });

  it("a subject's deletion waits for a correction in flight, then erases the row it wrote", async () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana, xav]);
    const removedMember = memberId(crew, xav);
    remove(host, crew, xav);
    const correction = await holdRpc(correctCall(crew, removedMember));
    expect(correction.result).toMatchObject({ ok: true, code: "corrected" });
    let deletion: Promise<{ ok: boolean; said: string }> | null = null;
    try {
      deletion = outcome("delete_after_correct", deleteAccount(xav), "postgres");
      await expect.poll(() => waitsOnAnyLock("delete_after_correct")).toBe("t");
      expect(await waitsOnAccountLock("delete_after_correct")).toBe("f");
    } finally { await correction.finish(); }
    const answer = await deletion;
    expect(answer?.said ?? "").not.toMatch(REFUSED_BY_LOCKS);
    expect(answer?.ok).toBe(true);
    expect(state(crew, xav)).toBe("left");
    expect(corrections(crew)).toBe("0");
  });
});

describe.skipIf(skipReason !== null)("after 0245: deleting a crew-bound Plan", () => {
  beforeAll(() => { if (running()) stageTo("after"); });

  /** The operator transaction from the runbook: the crew row, then the Plan row, then the delete. */
  const operatorDelete = (plan: string) => `select id from public.social_crews where plan_id='${plan}' for update;
    select id from public.plans where id='${plan}' for update;
    delete from public.plans where id='${plan}'`;
  const history = (crew: string) => db().sql(`select
    (select count(*) from public.social_crews where id='${crew}')||'|'||
    (select count(*) from public.social_crew_members where crew_id='${crew}')||'|'||
    (select count(*) from public.social_crew_join_requests where crew_id='${crew}')||'|'||
    (select count(*) from public.social_crew_invitations where crew_id='${crew}')`);
  const planOf = (crew: string) => db().sql(`select plan_id from public.social_crews where id='${crew}'`);

  it("deleting a Plan removes its crew, members, decided requests and accepted invitations", async () => {
    const host = person(), ana = person(), xav = person(), bea = person();
    mutual(host, xav);
    const crew = crewWith(host, [ana]);
    const invitation = invite(host, crew, xav).invitation_id as string;
    expect(answerInvitation(xav, crew, invitation, "accepted")).toMatchObject({ ok: true, code: "accepted" });
    request(bea, crew);
    expect(history(crew)).toBe("1|3|2|1");
    const deleted = await outcome("operator_plan_delete", operatorDelete(planOf(crew)), "postgres");
    expect(deleted.said).not.toMatch(REFUSED_BY_LOCKS);
    expect(deleted.ok).toBe(true);
    expect(history(crew)).toBe("0|0|0|0");
  });

  it("a lone member delete that others reference fails at once, and a lone seat delete fails at commit", async () => {
    const host = person(), ana = person();
    const crew = crewWith(host, [ana]);
    await expect(hold(`delete from public.social_crew_members where id='${memberId(crew, host)}'`, "postgres"))
      .rejects.toThrow(/violates foreign key constraint "social_crew_join_requests_decided_by_member_id_fkey"/);
    const seatRow = db().sql(`select plan_member_id from public.social_crew_members where crew_id='${crew}' and social_account_id='${ana.account}'`);
    const seatDelete = await hold(`delete from public.plan_crew_members where id='${seatRow}'`, "postgres");
    await expect(seatDelete.finish()).rejects.toThrow(/violates foreign key constraint "social_crew_members_plan_member_id_fkey"/);
    expect(state(crew, ana)).toBe("active");
    expect(db().sql(`select count(*) from public.plan_crew_members where id='${seatRow}'`)).toBe("1");
  });

  it("the operator delete waits for an admission in flight, then both finish and the Plan is gone", async () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    const asked = request(xav, crew);
    const plan = planOf(crew);
    const seatLock = await hold(`select pg_advisory_xact_lock(hashtextextended('plan:join-account:${plan}:${xav.user}',0))`, "postgres");
    let approval: Promise<{ ok: boolean; said: string }> | null = null;
    let deletion: Promise<{ ok: boolean; said: string }> | null = null;
    try {
      approval = outcome("approve_before_plan_delete", rpc(decideCall(host, crew, asked.request_id as string)));
      await expect.poll(() => waitsOnAccountLock("approve_before_plan_delete")).toBe("t");
      deletion = outcome("plan_delete_after_approve", operatorDelete(plan), "postgres");
      await expect.poll(() => waitsOnAnyLock("plan_delete_after_approve")).toBe("t");
    } finally { await seatLock.finish(); }
    const [approved, deleted] = await Promise.all([approval, deletion]);
    for (const answer of [approved, deleted]) expect(answer?.said ?? "").not.toMatch(REFUSED_BY_LOCKS);
    expect(json(approved?.said.trim() ?? "{}")).toMatchObject({ ok: true, code: "accepted" });
    expect(deleted?.ok).toBe(true);
    expect(history(crew)).toBe("0|0|0|0");
  });
});

describe.skipIf(skipReason !== null)("rollback with a correction ledger", () => {
  beforeAll(() => { if (running()) stageTo("after"); });

  const removedAndCorrected = () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana, xav]);
    const removedMember = memberId(crew, xav);
    remove(host, crew, xav);
    return { host, crew, xav, removedMember };
  };
  const ledgerRows = () => db().sql("select count(*) from public.social_crew_removal_corrections");

  it.each(["count", "snapshot"] as const)("rejects an equal-count row substitution acknowledged by %s", async (mode) => {
    const first = removedAndCorrected();
    expect(correct(first.crew, first.removedMember)).toMatchObject({ ok: true, code: "corrected" });
    const exported = correctionLedgerExport();
    const count = ledgerRows();
    db().sql(deleteAccount(first.xav));
    const second = removedAndCorrected();
    expect(correct(second.crew, second.removedMember)).toMatchObject({ ok: true, code: "corrected" });
    expect(ledgerRows()).toBe(count);
    const rolled = await rollbackOutcome(`rollback_substitution_${mode}`, mode === "count" ? count : exported.acknowledgement);
    try {
      expect(rolled.ok).toBe(false);
      expect(corrections(second.crew)).toBe("1");
    } finally { if (rolled.ok) stageTo("after"); }
  });

  it("rollback waits for a correction in flight and requires the current exported snapshot", async () => {
    const first = removedAndCorrected();
    expect(correct(first.crew, first.removedMember)).toMatchObject({ ok: true, code: "corrected" });
    const exported = Number(ledgerRows());
    const acknowledgement = correctionLedgerExport().acknowledgement;
    const second = removedAndCorrected();
    const correction = await holdRpc(correctCall(second.crew, second.removedMember));
    let rolling: Promise<{ ok: boolean; said: string }> | null = null;
    try {
      rolling = rollbackOutcome("rollback_after_correction", acknowledgement);
      await expect.poll(() => waitsOnAnyLock("rollback_after_correction")).toBe("t");
    } finally { await correction.finish(); }
    const stale = await rolling;
    expect(stale?.ok).toBe(false);
    expect(stale?.said).toContain(`would drop ${exported + 1} crew removal corrections`);
    expect((await rollbackOutcome("rollback_without_export")).ok).toBe(false);
    expect(ledgerRows()).toBe(String(exported + 1));

    expect(await rollbackOutcome("rollback_with_export", correctionLedgerExport().acknowledgement)).toMatchObject({ ok: true });
    expect(db().sql("select to_regclass('public.social_crew_removal_corrections') is null")).toBe("t");
    stageTo("after");
    const bea = person();
    admit(first.host, first.crew, bea);
    remove(first.host, first.crew, bea);
    expect(request(bea, first.crew)).toEqual(NOT_FOUND);
    expect(request(first.xav, first.crew)).toMatchObject({ ok: true, code: "requested" });
  });

  it("rollback waits for an account deletion or a plan join in flight, then completes", async () => {
    for (const [label, statement] of [
      ["deletion", (who: Person) => deleteAccount(who)],
      ["seat", (who: Person) => `insert into public.plan_crew_members(plan_id,name,token_hash,status,user_id)
        values ((select plan_id from public.social_crews where id='${crewWith(person())}'),'Guest','${"d".repeat(64)}','in','${who.user}')`],
    ] as const) {
      const xav = person();
      const inFlight = await hold(statement(xav), "postgres");
      let rolling: Promise<{ ok: boolean; said: string }> | null = null;
      try {
        rolling = rollbackOutcome(`rollback_after_${label}`, correctionLedgerExport().acknowledgement);
        await expect.poll(() => waitsOnAnyLock(`rollback_after_${label}`)).toBe("t");
      } finally { await inFlight.finish(); }
      const rolled = await rolling;
      expect(rolled?.said ?? "", label).not.toMatch(REFUSED_BY_LOCKS);
      expect(rolled?.ok, label).toBe(true);
      stageTo("after");
    }
  });

  it("rollback stops at once, holding nothing, when a crew row is held without its auth row", async () => {
    const host = person();
    const crew = crewWith(host);
    const crewRow = await hold(`select id from public.social_crews where id='${crew}' for update`, "postgres");
    try {
      const busy = await rollbackOutcome("rollback_beside_crew_row", correctionLedgerExport().acknowledgement);
      expect(busy.ok).toBe(false);
      expect(busy.said).toContain("could not obtain lock");
    } finally { await crewRow.finish(); }
    expect(db().sql("select to_regclass('public.social_crew_removal_corrections') is not null")).toBe("t");
  });

  it("rollback leaves the auth.users trigger in place but inert, and reapplying makes it lock again", async () => {
    expect(await rollbackOutcome("rollback_for_inert_trigger", correctionLedgerExport().acknowledgement)).toMatchObject({ ok: true });
    expect(db().sql(`select count(*) from pg_trigger where tgname='lock_social_accounts_on_auth_user_delete'`)).toBe("1");
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(db().sql(`select has_function_privilege('${role}','public._lock_social_auth_user_accounts()','execute')`), role).toBe("f");
    }
    const xav = person();
    const heldAccount = await hold(`select pg_advisory_xact_lock(hashtextextended('social-account:${xav.account}',0))`, "postgres");
    try {
      expect(await db().attempt(deleteAccount(xav))).toMatchObject({ ok: true });
    } finally { await heldAccount.finish(); }

    stageTo("after");
    expect(db().sql(`select count(*) from pg_trigger where tgname='lock_social_accounts_on_auth_user_delete'`)).toBe("1");
    const bea = person();
    const heldAgain = await hold(`select pg_advisory_xact_lock(hashtextextended('social-account:${bea.account}',0))`, "postgres");
    let deletion: Promise<{ ok: boolean; said: string }> | null = null;
    try {
      deletion = outcome("delete_after_reapply", deleteAccount(bea), "postgres");
      await expect.poll(() => waitsOnAccountLock("delete_after_reapply")).toBe("t");
    } finally { await heldAgain.finish(); }
    expect((await deletion)?.ok).toBe(true);
  });

  it("reapplying stops when a different trigger already has that name on auth.users", async () => {
    expect(await rollbackOutcome("rollback_for_foreign_trigger", correctionLedgerExport().acknowledgement)).toMatchObject({ ok: true });
    db().sql(`drop trigger lock_social_accounts_on_auth_user_delete on auth.users;
      create trigger lock_social_accounts_on_auth_user_delete after delete on auth.users
      for each row execute function public._lock_social_auth_user_accounts();`);
    const refused = forwardOutcome();
    expect(refused.ok).toBe(false);
    expect(refused.said).toContain("lock_social_accounts_on_auth_user_delete");
    expect(db().sql("select to_regclass('public.social_crew_removal_corrections') is null")).toBe("t");
    db().sql(`drop trigger lock_social_accounts_on_auth_user_delete on auth.users;
      create trigger lock_social_accounts_on_auth_user_delete before delete on auth.users
      for each row execute function public._lock_social_auth_user_accounts();`);
    expect(forwardOutcome()).toMatchObject({ ok: true });
  });

  it("rollback of 0245 alone refuses while 0246 is applied and changes nothing, and 0246 first, 0245 next and reapply still work", async () => {
    const schema = () => db().sql(`select md5(string_agg(item, '|' order by item)) from (
      select p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) as item from pg_proc p
        join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','pubmax_private') and p.prokind='f'
      union all select c.oid::regclass::text || ':' || c.relkind::text from pg_class c
        join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','pubmax_private')
      union all select t.tgrelid::regclass::text || ':' || t.tgname || ':' || t.tgenabled::text from pg_trigger t where not t.tgisinternal
      union all select r.conrelid::regclass::text || ':' || r.conname || ':' || pg_get_constraintdef(r.oid) from pg_constraint r
        join pg_namespace n on n.oid=r.connamespace where n.nspname='public'
    ) objects`);
    const first = removedAndCorrected();
    expect(correct(first.crew, first.removedMember)).toMatchObject({ ok: true, code: "corrected" });
    const before = schema();
    const rows = ledgerRows();

    const refused = await rollbackOutcome("rollback_0245_alone", correctionLedgerExport().acknowledgement, ROLLBACK_0245_ONLY);
    expect(refused.ok).toBe(false);
    expect(refused.said).toContain("0246");
    expect(schema()).toBe(before);
    expect(ledgerRows()).toBe(rows);

    expect(await rollbackOutcome("rollback_in_order", correctionLedgerExport().acknowledgement)).toMatchObject({ ok: true });
    expect(db().sql("select to_regprocedure('public.release_departed_social_crew_places(integer)') is null")).toBe("t");
    expect(db().sql("select to_regclass('public.social_crew_removal_corrections') is null")).toBe("t");

    stageTo("after");
    const host = person(), ana = person(), bea = person();
    const crew = crewWith(host, [ana]);
    db().sql(deleteAccount(ana));
    expect(call(releaseCall(100))).toMatchObject({ ok: true });
    expect(state(crew, ana)).toBe("left");
    admit(host, crew, bea);
    expect(state(crew, bea)).toBe("active");
  });
});
