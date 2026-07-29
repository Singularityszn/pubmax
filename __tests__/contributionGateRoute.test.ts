import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return {
    ...actual,
    callerUserId: async () => authState.userId,
  };
});

import { GET, POST } from "@/app/api/identity/contribution-gate/route";
import { __resetMemoryIdentityHandles } from "@/lib/identityHandleStore";
import {
  __resetMemoryPrivateIdentities,
  memoryPrivateIdentityStore,
} from "@/lib/privateIdentityStore";
import { __resetMemoryProfiles } from "@/lib/profileStore";

function request(method = "GET", body?: unknown): Request {
  return new Request("http://localhost/api/identity/contribution-gate", {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  authState.userId = null;
  __resetMemoryProfiles();
  __resetMemoryIdentityHandles();
  __resetMemoryPrivateIdentities();
  vi.useRealTimers();
});

describe("/api/identity/contribution-gate", () => {
  it("requires a verified account", async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await POST(request("POST", { dateOfBirth: "2000-01-01" }))).status).toBe(401);
  });

  it("requires onboarding before asking for age", async () => {
    authState.userId = "user-1";
    const response = await GET(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      status: "onboarding_required",
      error: "Choose your public handle before contributing.",
    });
  });

  it("asks for age after handle claim and verifies an adult once", async () => {
    authState.userId = "user-1";
    await memoryPrivateIdentityStore.completeOnboarding({
      userId: "user-1",
      handle: "night_owl",
    });

    let response = await GET(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      status: "age_required",
      error:
        "Confirm you are 18 or over before your first gated contribution.",
    });

    response = await POST(
      request("POST", { dateOfBirth: "2000-01-01" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "eligible" });

    response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "eligible" });
  });

  it("plainly blocks an under-18 without returning or storing date of birth", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));
    authState.userId = "user-1";
    await memoryPrivateIdentityStore.completeOnboarding({
      userId: "user-1",
      handle: "young_person",
    });

    const response = await POST(
      request("POST", { dateOfBirth: "2010-07-30" }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      status: "underage",
      eligibleOn: "2028-07-30",
      error:
        "You must be 18 or over to contribute. PUBMAXX is about buying alcohol.",
    });
    const stored = await memoryPrivateIdentityStore.read("user-1");
    expect(stored).not.toHaveProperty("dateOfBirth");
    expect(stored).toMatchObject({ contributionEligibleOn: "2028-07-30" });
  });
});
