import { beforeEach, describe, expect, it, vi } from "vitest";

// The owner's own mute and block list, read at
// GET /api/social/interactions?view=relationships. It answers what THIS account
// set and nothing else: never another account's list, never who blocked it.

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const ALICE = { accountId: "account-a", profileId: "profile-a", handle: "alice" };
const BOB = { accountId: "account-b", profileId: "profile-b", handle: "bob" };
const accessState = vi.hoisted(() => ({
  current: { ok: true, actor: { accountId: "account-a", profileId: "profile-a", handle: "alice" } } as Record<string, unknown>,
}));

vi.mock("@/lib/socialAccessServer", () => ({
  requireVerifiedSocialActor: vi.fn(async () => accessState.current),
}));

const HANDLES: Record<string, string> = {
  "profile-a": "alice",
  "profile-b": "bob",
  "profile-c": "carol",
  "profile-d": "dave",
};
vi.mock("@/lib/profileStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/profileStore")>()),
  profileStore: () => ({
    getById: vi.fn(async (id: string) => (HANDLES[id] ? { id, handle: HANDLES[id] } : null)),
  }),
}));

import { GET } from "@/app/api/social/interactions/route";
import {
  clearSocialMemoryBlocks,
  setSocialMemoryBlock,
  setSocialMemoryMute,
} from "@/lib/socialBlockMemory";
import { listOwnSocialRelationships } from "@/lib/socialRelationshipList.server";

const URL = "http://localhost/api/social/interactions?view=relationships";

beforeEach(() => {
  clearSocialMemoryBlocks();
  accessState.current = { ok: true, actor: ALICE };
  // Alice blocked Carol and muted Dave. Bob blocked Alice and muted Carol.
  setSocialMemoryBlock("profile-a", "profile-c", true);
  setSocialMemoryMute("profile-a", "profile-d", true);
  setSocialMemoryBlock("profile-b", "profile-a", true);
  setSocialMemoryMute("profile-b", "profile-c", true);
});

describe("the owner's own mute and block list", () => {
  it("lists what the owner set, one-way, and nothing set against them", async () => {
    expect(await listOwnSocialRelationships("profile-a")).toEqual({
      blocked: [{ handle: "carol", since: null }],
      muted: [{ handle: "dave", since: null }],
    });
  });

  it("answers the signed-in owner their own list at the route, privately", async () => {
    const res = await GET(new Request(URL));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body).toEqual({
      relationships: { blocked: [{ handle: "carol", since: null }], muted: [{ handle: "dave", since: null }] },
    });
    // Bob's block on Alice is his, so it is not on her list.
    expect(JSON.stringify(body)).not.toContain("bob");
  });

  it("ignores any handle or profile id in the request: another account reads only its own", async () => {
    accessState.current = { ok: true, actor: BOB };
    const res = await GET(new Request(`${URL}&handle=alice&profileId=profile-a`));
    const body = await res.json();
    expect(body).toEqual({
      relationships: { blocked: [{ handle: "alice", since: null }], muted: [{ handle: "carol", since: null }] },
    });
    expect(JSON.stringify(body)).not.toContain("dave");
  });

  it("refuses a caller Social does not admit, and discloses no list", async () => {
    accessState.current = { ok: false, error: "Sign in to use Social.", code: "SIGN_IN_REQUIRED", status: 401 };
    const res = await GET(new Request(URL));
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).not.toContain("carol");
    expect(text).not.toContain("dave");
  });
});
