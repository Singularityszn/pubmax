import { beforeEach, describe, expect, it, vi } from "vitest";

// Wave L3 claim-preview + claim API routes — memory stores, mocked JWT.
// Account handle is ALWAYS derived from the JWT email (never from query/body).

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const authState = vi.hoisted(() => ({
  userId: null as string | null,
  email: null as string | null,
}));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return {
    ...actual,
    callerUserId: async () => authState.userId,
    callerAuthIdentity: async () =>
      authState.userId
        ? { id: authState.userId, email: authState.email }
        : null,
  };
});

import { GET as claimPreview } from "@/app/api/identity/claim-preview/route";
import { POST as claim } from "@/app/api/identity/claim/route";
import { __resetMemoryFollows } from "@/lib/followStore";
import { __resetPintDrops, addPintDrop, type PintDrop } from "@/lib/pintDrops";
import { memoryProfileStore, __resetMemoryProfiles } from "@/lib/profileStore";
import { __resetMemorySavedPubs } from "@/lib/savedPubsStore";

const PREVIEW_URL = "http://localhost/api/identity/claim-preview";
const CLAIM_URL = "http://localhost/api/identity/claim";

function makeDrop(overrides: Partial<PintDrop> = {}): PintDrop {
  return {
    id: "drop-1",
    venueId: "venue-1",
    handle: "@device_ken",
    drink: "Bitter",
    priceGbp: 5.2,
    passedDownNote: "A note",
    era: "",
    provenance: "contributor",
    status: "visible",
    visibility: "public",
    createdAt: "2026-07-07T12:00:00.000Z",
    ...overrides,
  };
}

function expectNoStore(res: Response): void {
  expect(res.headers.get("Cache-Control")).toBe("no-store");
}

function asUser(userId: string | null, email: string | null = null): void {
  authState.userId = userId;
  authState.email = email;
}

function preview(query: Record<string, string>): Promise<Response> {
  const qs = new URLSearchParams(query);
  return claimPreview(new Request(`${PREVIEW_URL}?${qs.toString()}`));
}

function postClaim(body: unknown): Promise<Response> {
  return claim(
    new Request(CLAIM_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  authState.userId = null;
  authState.email = null;
  __resetMemoryProfiles();
  __resetMemoryFollows();
  __resetMemorySavedPubs();
  __resetPintDrops();
});

describe("GET /api/identity/claim-preview", () => {
  it("401s without a JWT", async () => {
    const res = await preview({ deviceHandle: "ken" });
    expect(res.status).toBe(401);
    expectNoStore(res);
  });

  it("400s when the JWT has no email", async () => {
    asUser("user-1", null);
    const res = await preview({ deviceHandle: "ken" });
    expect(res.status).toBe(400);
    expectNoStore(res);
  });

  it("derives authHandle from JWT email and ignores client authHandle", async () => {
    asUser("user-1", "ken@example.com");
    const res = await preview({ deviceHandle: "ken", authHandle: "attacker" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authHandle).toBe("ken");
    expect(body.sameHandle).toBe(true);
    expect(body.needsClaim).toBe(false);
  });

  it("returns needsClaim=true when handles differ", async () => {
    asUser("user-1", "google_ken@example.com");
    addPintDrop(makeDrop());
    const res = await preview({ deviceHandle: "device_ken" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.needsClaim).toBe(true);
    expect(body.sameHandle).toBe(false);
    expect(body.authHandle).toBe("google_ken");
    expect(body.deviceActivity.drops).toBe(1);
  });

  it("flags conflict when device handle is owned by another user", async () => {
    asUser("user-1", "google_ken@example.com");
    await memoryProfileStore.linkUser("device_ken", "user-other");
    const res = await preview({ deviceHandle: "device_ken" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deviceAlreadyLinkedToOther).toBe(true);
    expect(body.needsClaim).toBe(true);
  });
});

describe("POST /api/identity/claim", () => {
  it("401s without a JWT", async () => {
    const res = await postClaim({
      choice: "device",
      deviceHandle: "ken",
    });
    expect(res.status).toBe(401);
    expectNoStore(res);
  });

  it("links the device handle on choice=device when it has activity", async () => {
    asUser("user-1", "google_ken@example.com");
    addPintDrop(makeDrop());
    const res = await postClaim({
      choice: "device",
      deviceHandle: "device_ken",
      authHandle: "attacker", // ignored — JWT email wins
    });
    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(await res.json()).toEqual({ handle: "device_ken", linked: true });
    expect((await memoryProfileStore.getByHandle("device_ken"))?.userId).toBe("user-1");
  });

  it("400s claiming an empty different device handle (no activity)", async () => {
    asUser("user-1", "google_ken@example.com");
    const res = await postClaim({
      choice: "device",
      deviceHandle: "empty_fisher",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no pubs/i);
  });

  it("links the auth handle on choice=auth from JWT email", async () => {
    asUser("user-1", "google_ken@example.com");
    const res = await postClaim({
      choice: "auth",
      deviceHandle: "device_ken",
      authHandle: "attacker",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ handle: "google_ken", linked: true });
  });

  it("409s when claiming a device handle owned by another user", async () => {
    asUser("user-1", "google_ken@example.com");
    addPintDrop(makeDrop());
    await memoryProfileStore.linkUser("device_ken", "user-other");
    const res = await postClaim({
      choice: "device",
      deviceHandle: "device_ken",
    });
    expect(res.status).toBe(409);
    expectNoStore(res);
    const body = await res.json();
    expect(body.error).toMatch(/another account/i);
  });

  it("409s when claiming an auth handle owned by another user", async () => {
    asUser("user-1", "google_ken@example.com");
    await memoryProfileStore.linkUser("google_ken", "user-other");
    const res = await postClaim({
      choice: "auth",
      deviceHandle: "device_ken",
    });
    expect(res.status).toBe(409);
  });

  it("is idempotent when already linked to this user", async () => {
    asUser("user-1", "google_ken@example.com");
    addPintDrop(makeDrop());
    await memoryProfileStore.linkUser("device_ken", "user-1");
    const res = await postClaim({
      choice: "device",
      deviceHandle: "device_ken",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ handle: "device_ken", linked: true });
  });

  it("400s on a bad choice", async () => {
    asUser("user-1", "sam@example.com");
    const res = await postClaim({
      choice: "neither",
      deviceHandle: "ken",
    });
    expect(res.status).toBe(400);
  });
});
