import { beforeEach, describe, expect, it, vi } from "vitest";

import { NEW_RESERVED_CONTRIBUTOR_HANDLE_INPUTS } from "@/__tests__/fixtures/reservedContributorHandles";

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
  return { ...actual, callerUserId: async () => authState.userId };
});

import { GET as availability } from "@/app/api/identity/handle/availability/route";
import { POST as claim } from "@/app/api/identity/handle/claim/route";
import { POST as rename } from "@/app/api/identity/handle/rename/route";
import { GET as resolve } from "@/app/api/identity/handle/resolve/route";
import { GET as current } from "@/app/api/identity/handle/current/route";
import { __resetMemoryIdentityHandles } from "@/lib/identityHandleStore";
import { __resetMemoryProfiles } from "@/lib/profileStore";
import { __resetPintDrops } from "@/lib/pintDrops";

function request(path: string, method = "GET", body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  authState.userId = null;
  __resetMemoryProfiles();
  __resetMemoryIdentityHandles();
  __resetPintDrops();
});

describe("PUBMAXX handle APIs", () => {
  it("checks availability case-insensitively and requires auth to claim", async () => {
    let response = await availability(request("/api/identity/handle/availability?handle=Night_Owl"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ handle: "night_owl", available: true });

    response = await claim(request("/api/identity/handle/claim", "POST", { handle: "night_owl" }));
    expect(response.status).toBe(401);

    authState.userId = "user-1";
    response = await claim(request("/api/identity/handle/claim", "POST", { handle: "Night_Owl" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ handle: "night_owl", claimed: true });

    response = await current(request("/api/identity/handle/current"));
    expect(await response.json()).toEqual({ handle: "night_owl" });

    response = await availability(request("/api/identity/handle/availability?handle=NIGHT_OWL"));
    expect(await response.json()).toEqual({ handle: "night_owl", available: false, reason: "taken" });
  });

  it.each(NEW_RESERVED_CONTRIBUTOR_HANDLE_INPUTS)(
    "refuses reserved contributor handle %j at the claim route",
    async (handle) => {
      authState.userId = "user-1";
      const response = await claim(
        request("/api/identity/handle/claim", "POST", { handle }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        reason: "reserved",
        error: "That handle is not available.",
      });
    },
  );

  it("renames an owned handle and keeps the old alias resolving to the immutable profile", async () => {
    authState.userId = "user-1";
    const claimed = await claim(request("/api/identity/handle/claim", "POST", { handle: "night_owl" }));
    const original = await claimed.json();

    const renamed = await rename(request("/api/identity/handle/rename", "POST", { handle: "dawn_owl" }));
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({
      profileId: original.profileId,
      previousHandle: "night_owl",
      handle: "dawn_owl",
    });

    const resolved = await resolve(request("/api/identity/handle/resolve?handle=night_owl"));
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toMatchObject({
      profileId: original.profileId,
      requestedHandle: "night_owl",
      currentHandle: "dawn_owl",
      redirect: true,
    });
    expect(
      await (await current(request("/api/identity/handle/current"))).json(),
    ).toEqual({ handle: "dawn_owl" });
  });

  it.each(NEW_RESERVED_CONTRIBUTOR_HANDLE_INPUTS)(
    "refuses rename into reserved contributor handle %j",
    async (handle) => {
      authState.userId = "user-1";
      expect(
        (
          await claim(
            request("/api/identity/handle/claim", "POST", {
              handle: "night_owl",
            }),
          )
        ).status,
      ).toBe(201);

      const response = await rename(
        request("/api/identity/handle/rename", "POST", { handle }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        reason: "reserved",
        error: "That handle is not available.",
      });
      expect(
        await (await current(request("/api/identity/handle/current"))).json(),
      ).toEqual({ handle: "night_owl" });
    },
  );
});
