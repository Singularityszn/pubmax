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

import { POST } from "@/app/api/identity/contribution-age/route";
import { __resetMemoryIdentityHandles } from "@/lib/identityHandleStore";
import {
  __resetMemoryPrivateIdentities,
  memoryPrivateIdentityStore,
} from "@/lib/privateIdentityStore";
import { __resetMemoryProfiles } from "@/lib/profileStore";

function request(dateOfBirth: string): Request {
  return new Request("http://localhost/api/identity/contribution-age", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dateOfBirth }),
  });
}

beforeEach(async () => {
  authState.userId = "user-1";
  __resetMemoryIdentityHandles();
  __resetMemoryPrivateIdentities();
  __resetMemoryProfiles();
  await memoryPrivateIdentityStore.completeOnboarding({
    userId: "user-1",
    handle: "night_owl",
  });
});

describe("POST /api/identity/contribution-age", () => {
  it("discards an adult date of birth and confirms eligibility", async () => {
    const response = await POST(request("1990-01-01"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "adult" });
    const stored = await memoryPrivateIdentityStore.read("user-1");
    expect(stored).toMatchObject({ adultConfirmed: true });
    expect(JSON.stringify(stored)).not.toContain("1990-01-01");
  });

  it("blocks an under-18 account without retaining date of birth", async () => {
    const response = await POST(request("2020-01-01"));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ status: "age_restricted" });
    const stored = await memoryPrivateIdentityStore.read("user-1");
    expect(stored).toMatchObject({ contributionEligibleFrom: "2038-01-01" });
    expect(JSON.stringify(stored)).not.toContain("2020-01-01");
  });

  it("rejects an invalid date without changing eligibility", async () => {
    const response = await POST(request("not-a-date"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Enter a valid date of birth.",
    });
    expect(await memoryPrivateIdentityStore.read("user-1")).not.toMatchObject({
      adultConfirmed: true,
    });
  });
});
