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

import { GET, PATCH, POST } from "@/app/api/identity/onboarding/route";
import { __resetMemoryIdentityHandles } from "@/lib/identityHandleStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import { __resetMemoryPrivateIdentities } from "@/lib/privateIdentityStore";
import {
  __resetMemoryProfiles,
  memoryProfileStore,
} from "@/lib/profileStore";

function request(method = "GET", body?: unknown): Request {
  return new Request("http://localhost/api/identity/onboarding", {
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
  __resetPintDrops();
});

describe("/api/identity/onboarding", () => {
  it("requires a verified account", async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await POST(request("POST", { handle: "night_owl" }))).status).toBe(401);
  });

  it("reports incomplete state without inventing an email-derived handle", async () => {
    authState.userId = "user-1";
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ complete: false });
  });

  it("requires date of birth before claiming a handle", async () => {
    authState.userId = "user-1";
    const missing = await POST(request("POST", { handle: "night_owl" }));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({
      code: "invalid",
      error: "Enter a valid date of birth.",
    });
    expect(await memoryProfileStore.getByHandle("night_owl")).toBeNull();

    const response = await POST(
      request("POST", {
        handle: "night_owl",
        dateOfBirth: "2015-02-03",
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      complete: true,
      handle: "night_owl",
    });
  });

  it("distinguishes reserved handles from taken handles", async () => {
    authState.userId = "user-1";
    let response = await POST(
      request("POST", { handle: "karan", dateOfBirth: "1990-01-01" }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "reserved",
      error: "That handle is not available.",
    });

    await memoryProfileStore.linkUser("night_owl", "user-other");
    response = await POST(
      request("POST", {
        handle: "night_owl",
        dateOfBirth: "1990-01-01",
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "taken",
      error: "That handle is already taken.",
    });
  });

  it("limits the canonical handle claim mutation to 20 attempts", async () => {
    authState.userId = "user-1";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await POST(
        new Request("http://localhost/api/identity/onboarding", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "198.51.100.4",
          },
          body: "{",
        }),
      );
      expect(response.status).toBe(400);
    }

    const response = await POST(
      new Request("http://localhost/api/identity/onboarding", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.4",
        },
        body: "{",
      }),
    );
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "Too many handle attempts. Try again shortly.",
    });
  });

  it("claims a legacy handle in place and keeps optional details private", async () => {
    authState.userId = "user-1";
    const legacy = await memoryProfileStore.ensure("old_timer");

    const response = await POST(
      request("POST", {
        handle: "old_timer",
        dateOfBirth: "1991-04-12",
        fullName: "Nina Example",
        sex: "female",
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      complete: true,
      handle: "old_timer",
      fullName: "Nina Example",
      sex: "female",
    });
    expect(await memoryProfileStore.getByUserId("user-1")).toMatchObject({
      id: legacy.id,
    });

    const status = await GET(request());
    expect(await status.json()).toEqual({
      complete: true,
      handle: "old_timer",
      fullName: "Nina Example",
      sex: "female",
    });
  });

  it("lets the account owner edit and clear private optional details", async () => {
    authState.userId = "user-1";
    await POST(
      request("POST", {
        handle: "night_person",
        dateOfBirth: "1990-01-01",
        fullName: "Old Name",
        sex: "female",
      }),
    );

    const response = await PATCH(
      request("PATCH", {
        fullName: "New Name",
        sex: "",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      complete: true,
      handle: "night_person",
      fullName: "New Name",
    });
  });

  it("stores an under-18 date without blocking signup", async () => {
    authState.userId = "user-young";
    const response = await POST(
      request("POST", {
        handle: "young_person",
        dateOfBirth: "2015-02-03",
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      complete: true,
      handle: "young_person",
    });
  });
});
