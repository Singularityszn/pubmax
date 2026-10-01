import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false,
    clientIp: () => "203.0.113.9", hashIp: () => "a".repeat(64) };
});
const auth = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return { ...actual, callerUserId: async () => auth.userId };
});
const budget = vi.hoisted(() => ({ used: new Set<string>() }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async (key: string) => {
  const limited = budget.used.has(key);
  budget.used.add(key);
  return limited;
} }));

import { GET } from "@/app/api/messages/recipients/route";
import { GET as socialSearch } from "@/app/api/profiles/search/route";
import { __resetMemoryProfileWithdrawals, __setMemoryProfileWithdrawn } from "@/lib/accountPublicAccess.server";
import { __resetMemoryProfiles, __seedMemoryLegacyProfile, __seedMemoryOwnedProfile,
  __tombstoneMemoryProfile, memoryProfileStore } from "@/lib/profileStore";

function request(): Request { return new Request("http://localhost/api/messages/recipients?q=hari"); }

beforeEach(() => {
  __resetMemoryProfiles();
  __resetMemoryProfileWithdrawals();
  budget.used.clear();
  auth.userId = "user-ken";
  __seedMemoryOwnedProfile("ken", "user-ken");
  vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "0");
});
afterEach(() => vi.unstubAllEnvs());

describe("authenticated messaging recipient lookup", () => {
  it("keeps DMs searchable during Social rollback using only live public profile fields", async () => {
    const hari = __seedMemoryOwnedProfile("hari", "user-hari");
    await memoryProfileStore.update("hari", { displayName: "Hari", bio: "Private bio", homeCity: "london" });
    const withdrawn = __seedMemoryOwnedProfile("harish", "user-harish");
    __setMemoryProfileWithdrawn(withdrawn.id, true);
    __seedMemoryLegacyProfile("harini");
    __seedMemoryOwnedProfile("hariet", "user-hariet");
    __tombstoneMemoryProfile("hariet");
    expect((await socialSearch(request())).status).toBe(503);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ matches: [{ id: hari.id, handle: "hari", displayName: "Hari" }] });
  });

  it("refuses anonymous and unlinked accounts instead of trusting asserted handles", async () => {
    auth.userId = null;
    const anonymous = await GET(new Request(`${request().url}&handle=ken`));
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ code: "UNAUTHENTICATED", retryable: false });
    auth.userId = "user-unlinked";
    expect((await GET(new Request(`${request().url}&handle=ken`))).status).toBe(400);
    expect(budget.used.size).toBe(0);
  });

  it("shares the public search rate budget across Social and messaging routes", async () => {
    vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "1");
    expect((await socialSearch(request())).status).toBe(200);
    const limited = await GET(request());
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: "RATE_LIMITED", retryable: true });
    budget.used.clear();
    expect((await GET(request())).status).toBe(200);
    expect((await socialSearch(request())).status).toBe(429);
  });
});
