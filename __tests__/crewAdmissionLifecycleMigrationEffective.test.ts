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
  type Person,
  REFUSED_BY_LOCKS,
  STAFF_ROLE,
  accountOf,
  admit,
  block,
  blockCall,
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
  inviteCall,
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
beforeAll(async () => { if (!skipReason) moderator = await bootCrewAdmissionDatabase("crew-lifecycle-0243", "after"); }, 600_000);
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


describe.skipIf(skipReason !== null)("after 0243: owner and invitee deletion", () => {
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

describe.skipIf(skipReason !== null)("after 0243: provisioning and account-less suspension against deletion", () => {
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

describe.skipIf(skipReason !== null)("after 0243: departed members", () => {
  beforeAll(() => { if (running()) stageTo("after"); });

  it("a guest who deleted their account no longer bars the people they blocked, and still holds their counted place", () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    block(ana, xav);
    expect(request(xav, crew)).toEqual(NOT_FOUND);
    db().sql(deleteAccount(ana));
    expect(state(crew, ana)).toBe("active");
    admit(host, crew, xav);
    expect(db().sql(`select count(*) from public.social_crew_members where crew_id='${crew}' and state='active'`)).toBe("3");
  });

  it("a suspended guest who still has an account keeps barring the people they blocked", () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    block(xav, ana);
    expect(call(suspendCall(ana))).toMatchObject({ ok: true, code: "suspended" });
    expect(request(xav, crew)).toEqual(NOT_FOUND);
  });
});

describe.skipIf(skipReason !== null)("after 0243: correction bookkeeping", () => {
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

  it("the correction ledger keeps its row through the person's deletion and goes with its crew", () => {
    const host = person(), xav = person();
    const crew = crewWith(host);
    db().sql(`select public._activate_social_crew_member('${crew}','${xav.account}')`);
    const removedMember = memberId(crew, xav);
    remove(host, crew, xav);
    correct(crew, removedMember);
    db().sql(deleteAccount(xav));
    expect(db().sql(`select count(*) from public.social_crew_removal_corrections where crew_id='${crew}'`)).toBe("1");
    db().sql(`delete from public.social_crews where id='${crew}'`);
    expect(db().sql(`select count(*) from public.social_crew_removal_corrections where crew_id='${crew}'`)).toBe("0");
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

  it("rollback waits for a correction in flight, counts it, and needs the export count to name every row", async () => {
    const first = removedAndCorrected();
    expect(correct(first.crew, first.removedMember)).toMatchObject({ ok: true, code: "corrected" });
    const second = removedAndCorrected();
    const correction = await holdRpc(correctCall(second.crew, second.removedMember));
    let rolling: Promise<{ ok: boolean; said: string }> | null = null;
    try {
      rolling = rollbackOutcome("rollback_after_correction", "1");
      await expect.poll(() => waitsOnAnyLock("rollback_after_correction")).toBe("t");
    } finally { await correction.finish(); }
    const refused = await rolling;
    expect(refused?.ok).toBe(false);
    expect(refused?.said).toMatch(/would drop 2 crew removal corrections/);
    expect(ledgerRows()).toBe("2");

    const unacknowledged = await rollbackOutcome("rollback_without_export");
    expect(unacknowledged.ok).toBe(false);
    expect(ledgerRows()).toBe("2");

    expect(await rollbackOutcome("rollback_with_export", "2")).toMatchObject({ ok: true });
    expect(db().sql("select to_regclass('public.social_crew_removal_corrections') is null")).toBe("t");
    stageTo("after");
    const bea = person();
    admit(first.host, first.crew, bea);
    remove(first.host, first.crew, bea);
    expect(request(bea, first.crew)).toEqual(NOT_FOUND);
    expect(request(first.xav, first.crew)).toMatchObject({ ok: true, code: "requested" });
  });

  it("a correction that reaches the ledger after the rollback counted it fails, and no row is dropped unseen", async () => {
    const pending = removedAndCorrected();
    const ana = person(), cal = person();
    const blockInFlight = await holdRpc(blockCall(ana, cal));
    let rolling: Promise<{ ok: boolean; said: string }> | null = null;
    let correcting: Promise<{ ok: boolean; said: string }> | null = null;
    try {
      rolling = rollbackOutcome("rollback_behind_block");
      await expect.poll(() => waitsOnAnyLock("rollback_behind_block")).toBe("t");
      correcting = outcome("correction_during_rollback", rpc(correctCall(pending.crew, pending.removedMember)));
      await expect.poll(() => waitsOnAnyLock("correction_during_rollback")).toBe("t");
    } finally { await blockInFlight.finish(); }
    expect(await rolling).toMatchObject({ ok: true });
    expect((await correcting)?.ok).toBe(false);
    expect(state(pending.crew, pending.xav)).toBe("removed");
    expect(db().sql("select to_regclass('public.social_crew_removal_corrections') is null")).toBe("t");
    stageTo("after");
  });
});
