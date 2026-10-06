// Real account qualification and preference routes over controlled DB ordering.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  row: null as Row | null,
  pauseRead: null as (() => Promise<void>) | null,
  writes: 0,
}));
vi.mock("@/lib/supabase", async (original) => ({
  ...(await original<typeof import("@/lib/supabase")>()),
  isSupabaseConfigured: () => true,
  requiresSupabaseStore: () => true,
  requireSupabaseAdmin: () => ({
    from(table: string) {
      expect(table).toBe("step_out_nudge_prefs");
      let operation = "read";
      let patch: Row = {};
      const filters: Array<[string, unknown]> = [];
      const query = {
        select: () => query,
        single: () => query,
        maybeSingle: () => query,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        upsert: (row: Row) => { operation = "upsert"; patch = row; return query; },
        update: (row: Row) => { operation = "update"; patch = row; return query; },
        then: async (resolve: (value: unknown) => unknown) => {
          if (operation === "read") {
            const snapshot = state.row ? { ...state.row } : null;
            const pause = state.pauseRead;
            state.pauseRead = null;
            if (pause) await pause();
            return resolve({ data: snapshot, error: null });
          }
          state.writes++;
          if (operation === "upsert") {
            const now = new Date().toISOString();
            state.row = {
              enabled: false, subscription_token: null, last_sent_at: null,
              created_at: now, updated_at: now, cheap_pint_qualified: false,
              cheap_pint_enabled: false, cheap_pint_declined: false, cheap_pint_sent_at: null,
              ...state.row, ...patch,
            };
          } else if (state.row && filters.every(([key, value]) => state.row?.[key] === value)) {
            state.row = { ...state.row, ...patch };
          }
          return resolve({ data: state.row ? { ...state.row } : null, error: null });
        },
      };
      return query;
    },
  }),
}));
vi.mock("@/lib/profileStore", () => ({
  profileStore: () => ({ getByUserId: async () => ({ id: "11111111-1111-4111-8111-111111111111" }) }),
}));
vi.mock("@/lib/contributionIdentity.server", () => ({
  resolveContributionIdentity: async () => ({
    ok: true, accountId: "account-ken", actor: "profile:11111111-1111-4111-8111-111111111111", handle: "ken",
  }),
}));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => false }));

import { GET, POST } from "@/app/api/cheap-pint-ping/route";
import { qualifyCheapPintForAccountId } from "@/lib/cheapPintPingQualify.server";
import { stepOutNudgeStore } from "@/lib/stepOutNudgeStore";
const ACTOR = "profile:11111111-1111-4111-8111-111111111111";
const URL = "http://localhost/api/cheap-pint-ping";
const SENT = "2026-09-08T16:00:00.000Z";
function post(action: string) {
  return POST(new Request(URL, { method: "POST", body: JSON.stringify({ action }) }));
}
function pauseQualificationRead() {
  let reached!: () => void;
  let resume!: () => void;
  const read = new Promise<void>((resolve) => { reached = resolve; });
  const release = new Promise<void>((resolve) => { resume = resolve; });
  state.pauseRead = async () => { reached(); await release; };
  return { read, resume };
}
beforeEach(() => {
  state.row = {
    owner_actor: ACTOR, enabled: false, subscription_token: "webpush:original",
    last_sent_at: "2026-08-01T12:00:00.000Z", created_at: "2026-08-01T11:00:00.000Z",
    updated_at: "2026-08-01T12:00:00.000Z", cheap_pint_qualified: true,
    cheap_pint_enabled: true, cheap_pint_declined: false, cheap_pint_sent_at: null,
  };
  state.pauseRead = null;
  state.writes = 0;
});

describe("cheap-pint qualification races", () => {
  it("preserves a decline committed while account qualification holds an old read", async () => {
    const gate = pauseQualificationRead();
    const qualification = qualifyCheapPintForAccountId("account-ken");
    await gate.read;
    const declined = await post("decline");
    expect(declined.status).toBe(200);
    expect(await declined.json()).toMatchObject({ declined: true, enabled: false, canPrompt: false });
    gate.resume();
    await qualification;
    expect(state.row).toMatchObject({ cheap_pint_declined: true, cheap_pint_enabled: false, subscription_token: null });
    expect(await (await GET(new Request(URL))).json()).toMatchObject({ declined: true, enabled: false, canPrompt: false });
  });
  it("preserves a send stamp committed while account qualification holds an old read", async () => {
    const gate = pauseQualificationRead();
    const qualification = qualifyCheapPintForAccountId("account-ken");
    await gate.read;
    await stepOutNudgeStore().markCheapPintSent(ACTOR, SENT);
    gate.resume();
    await qualification;
    expect(state.row?.cheap_pint_sent_at).toBe(SENT);
    expect(await (await GET(new Request(URL))).json()).toMatchObject({ sentAt: SENT, canPrompt: false, canSend: false });
  });
  it("does not overwrite a decline row created after qualification read no row", async () => {
    state.row = null;
    const gate = pauseQualificationRead();
    const qualification = qualifyCheapPintForAccountId("account-ken");
    await gate.read;
    expect((await post("decline")).status).toBe(200);
    const createdAt = (await stepOutNudgeStore().get(ACTOR))!.createdAt;
    gate.resume();
    await qualification;
    expect(state.row).toMatchObject({ cheap_pint_declined: true, cheap_pint_enabled: false, subscription_token: null, created_at: createdAt });
  });
  it("creates a qualified default-off preference for a new owner", async () => {
    state.row = null;
    const response = await post("qualify");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ qualified: true, enabled: false, declined: false, sentAt: null, canPrompt: true });
    expect(state.row).toMatchObject({ owner_actor: ACTOR, enabled: false, subscription_token: null, last_sent_at: null });
    expect((await stepOutNudgeStore().get(ACTOR))?.createdAt).toEqual(expect.any(String));
  });
  it("qualifies an existing Step Out subscription without changing its other fields", async () => {
    Object.assign(state.row!, { enabled: true, cheap_pint_qualified: false, cheap_pint_enabled: false });
    const before = { ...state.row };
    const response = await post("qualify");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ qualified: true, enabled: false, canPrompt: true });
    expect(state.row).toEqual({ ...before, cheap_pint_qualified: true, updated_at: expect.any(String) });
  });
  it.each(["cheap_pint_declined", "cheap_pint_sent_at"])("leaves terminal %s rows unchanged on repeated qualification", async (field) => {
    state.row![field] = field === "cheap_pint_declined" ? true : SENT;
    const before = { ...state.row };
    await qualifyCheapPintForAccountId("account-ken");
    await qualifyCheapPintForAccountId("account-ken");
    expect(state.row).toEqual(before);
    expect(state.writes).toBe(0);
  });
});

async function interleaveDuringRead<T>(operation: () => Promise<T>, interleave: () => Promise<unknown>) {
  const gate = pauseQualificationRead();
  const pending = operation();
  await Promise.race([gate.read, pending]);
  state.pauseRead = null;
  await interleave();
  gate.resume();
  return pending;
}

describe("sibling preference writes do not replay an old read", () => {
  it("keeps a cheap-pint send stamp committed while the Step Out toggle holds an old read", async () => {
    await interleaveDuringRead(
      () => stepOutNudgeStore().put(ACTOR, { enabled: true }),
      () => stepOutNudgeStore().markCheapPintSent(ACTOR, SENT),
    );
    expect(state.row).toMatchObject({ enabled: true, subscription_token: "webpush:original", cheap_pint_sent_at: SENT });
  });
  it("keeps a decline committed while the Step Out toggle holds an old read", async () => {
    await interleaveDuringRead(
      () => stepOutNudgeStore().put(ACTOR, { enabled: false }),
      () => post("decline"),
    );
    expect(state.row).toMatchObject({ enabled: false, cheap_pint_declined: true, cheap_pint_enabled: false, subscription_token: null });
    expect(await (await GET(new Request(URL))).json()).toMatchObject({ declined: true, enabled: false, canPrompt: false });
  });
  it("keeps Step Out and cheap-pint send stamps committed during an opt-in", async () => {
    state.row!.enabled = true;
    await interleaveDuringRead(
      () => stepOutNudgeStore().optInCheapPint(ACTOR, "webpush:fresh"),
      async () => {
        await stepOutNudgeStore().markSent(ACTOR, SENT);
        await stepOutNudgeStore().markCheapPintSent(ACTOR, SENT);
      },
    );
    expect(state.row).toMatchObject({
      enabled: true, subscription_token: "webpush:fresh", last_sent_at: SENT,
      cheap_pint_enabled: true, cheap_pint_sent_at: SENT,
    });
  });
  it("keeps a qualification and send stamp committed while a decline holds an old read", async () => {
    Object.assign(state.row!, { enabled: true, cheap_pint_qualified: false });
    await interleaveDuringRead(
      () => stepOutNudgeStore().declineCheapPint(ACTOR),
      async () => {
        await qualifyCheapPintForAccountId("account-ken");
        await stepOutNudgeStore().markCheapPintSent(ACTOR, SENT);
      },
    );
    expect(state.row).toMatchObject({
      enabled: true, subscription_token: "webpush:original", cheap_pint_qualified: true,
      cheap_pint_enabled: false, cheap_pint_declined: true, cheap_pint_sent_at: SENT,
    });
  });
  it("opts a new owner in with Step Out off and no stamps", async () => {
    state.row = null;
    await stepOutNudgeStore().optInCheapPint(ACTOR, "webpush:fresh");
    expect(state.row).toMatchObject({
      owner_actor: ACTOR, enabled: false, subscription_token: "webpush:fresh", last_sent_at: null,
      cheap_pint_qualified: true, cheap_pint_enabled: true, cheap_pint_declined: false, cheap_pint_sent_at: null,
    });
  });
});
