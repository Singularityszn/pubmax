import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const configured = vi.hoisted(() => ({ value: false }));
const caller = vi.hoisted(() => ({ id: null as string | null }));

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return {
    ...actual,
    callerUserId: () => Promise.resolve(caller.id),
  };
});
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => configured.value,
    requiresSupabaseStore: () => false,
  };
});
vi.mock("@/lib/profileStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/profileStore")>();
  return {
    ...actual,
    profileStore: () => actual.memoryProfileStore,
    // messageAuth picks supabaseProfileStore itself once the durable seam is on.
    // Point that binding at the memory store so the test can see the owned row.
    supabaseProfileStore: actual.memoryProfileStore,
  };
});

import { POST as postSaved } from "@/app/api/saved-pubs/route";
import { POST as postFollow } from "@/app/api/saved-pubs/list-follows/route";
import { __resetMemoryProfiles, memoryProfileStore } from "@/lib/profileStore";
import { __resetMemorySavedPubs } from "@/lib/savedPubsStore";
import { getVenueIndex } from "@/lib/venueIndex";

let venueId = "";

beforeAll(async () => {
  const index = await getVenueIndex();
  venueId = [...index.keys()][0] ?? "";
});

beforeEach(() => {
  configured.value = false;
  caller.id = null;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH;
  __resetMemoryProfiles();
  __resetMemorySavedPubs();
});

function save(handle: string): Promise<Response> {
  return postSaved(
    new Request("http://localhost/api/saved-pubs", {
      method: "POST",
      body: JSON.stringify({ handle, venueId, listType: "Historic" }),
    }),
  );
}

function follow(follower: string, owner: string): Promise<Response> {
  return postFollow(
    new Request("http://localhost/api/saved-pubs/list-follows", {
      method: "POST",
      body: JSON.stringify({ follower, owner, listType: "Date Night" }),
    }),
  );
}

describe("keyless saved-pub demo", () => {
  it("keeps a save for a handle that has no profile row", async () => {
    const res = await save("keylessmint");
    expect(res.status).toBe(200);
    expect((await res.json()).saved).toHaveLength(1);
    expect(await memoryProfileStore.getByHandle("keylessmint")).toBeNull();
  });

  it("keeps a list follow without minting either handle", async () => {
    const res = await follow("keylessken", "keylesssam");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ following: true });
    expect(await memoryProfileStore.getByHandle("keylessken")).toBeNull();
    expect(await memoryProfileStore.getByHandle("keylesssam")).toBeNull();
  });
});

describe("durable anonymous saved-pub writes", () => {
  it("still saves against a profile row that already exists", async () => {
    configured.value = true;
    await memoryProfileStore.ensure("legacymint");
    const res = await save("legacymint");
    expect(res.status).toBe(200);
    expect((await memoryProfileStore.getByHandle("legacymint"))?.userId).toBeUndefined();
  });

  it("refuses a save when the handle has no profile", async () => {
    configured.value = true;
    const res = await save("durablemint");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "Profile not found.",
      code: "NOT_FOUND",
      retryable: false,
    });
    expect(await memoryProfileStore.getByHandle("durablemint")).toBeNull();
  });

  it("refuses a list follow that would mint the follower or the named owner", async () => {
    configured.value = true;
    const missingFollower = await follow("durableken", "durablesam");
    expect(missingFollower.status).toBe(404);

    await memoryProfileStore.ensure("durableken");
    const missingOwner = await follow("durableken", "durablesam");
    expect(missingOwner.status).toBe(404);
    expect(await memoryProfileStore.getByHandle("durablesam")).toBeNull();
  });

  it("does not refuse a signed-in save whose gate already owns the handle", async () => {
    configured.value = true;
    caller.id = "user-mint";
    const res = await save("signedmint");
    expect(res.status).toBe(200);
    expect(await memoryProfileStore.getByHandle("signedmint")).toMatchObject({
      userId: "user-mint",
    });
  });
});
