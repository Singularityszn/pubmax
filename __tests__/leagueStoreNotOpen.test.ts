// Before migration 0239 is applied, a deploy must keep working: every league
// call says "not open yet" instead of failing as an outage or keeping a league
// in memory that the next cold start forgets.

import { describe, expect, it, vi } from "vitest";

const missing = {
  table: { code: "PGRST205", message: "Could not find the table 'public.league_members' in the schema cache" },
  fn: { code: "PGRST202", message: "Could not find the function public.create_league(p_invite_code, p_name, p_profile_id, p_user_id) in the schema cache" },
};

vi.mock("@/lib/supabase", async (importOriginal) => {
  const query = () => {
    const q: Record<string, unknown> = {};
    for (const step of ["select", "eq", "order", "limit", "delete", "update"]) q[step] = () => q;
    q.maybeSingle = () => Promise.resolve({ data: null, error: missing.table });
    q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: missing.table }).then(resolve);
    return q;
  };
  return {
    ...(await importOriginal<typeof import("@/lib/supabase")>()),
    isSupabaseConfigured: () => true,
    requiresSupabaseStore: () => true,
    requireSupabaseAdmin: () => ({
      rpc: () => Promise.resolve({ data: null, error: missing.fn }),
      from: () => query(),
    }),
  };
});

import { leagueFailure } from "@/lib/leagueHttp.server";
import { LeagueStoreError, leagueStore } from "@/lib/leagueStore";

describe("leagues before migration 0239", () => {
  it("says not open for every read and write, and keeps nothing in memory", async () => {
    const store = leagueStore();
    const member = { userId: "u-1", profileId: "p-1" };
    const calls = [
      () => store.create(member, "Regulars", "ABCDEFGH"),
      () => store.join(member, "ABCDEFGH"),
      () => store.listFor("u-1"),
      () => store.exportFor("u-1"),
      () => store.read("00000000-0000-4000-8000-000000000001", "u-1"),
      () => store.leave("00000000-0000-4000-8000-000000000001", "u-1"),
      () => store.remove("00000000-0000-4000-8000-000000000001", "u-1"),
      () => store.setInviteCode("00000000-0000-4000-8000-000000000001", "u-1", "HGFEDCBA"),
    ];
    for (const call of calls) await expect(call()).rejects.toBeInstanceOf(LeagueStoreError);
  });

  it("answers 503 LEAGUES_NOT_OPEN, not retryable, and an outage as LEAGUES_UNAVAILABLE", async () => {
    const notOpen = leagueFailure(new LeagueStoreError("NOT_OPEN"), "GET /api/leagues");
    expect(notOpen.status).toBe(503);
    expect(await notOpen.json()).toMatchObject({ code: "LEAGUES_NOT_OPEN", retryable: false });

    const outage = leagueFailure(new Error("connection reset"), "GET /api/leagues");
    expect(outage.status).toBe(503);
    expect(await outage.json()).toMatchObject({ code: "LEAGUES_UNAVAILABLE", retryable: true });
  });
});
