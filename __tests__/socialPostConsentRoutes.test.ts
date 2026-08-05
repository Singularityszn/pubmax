import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown[] }>,
}));

vi.mock("@/lib/socialAccessServer", () => ({
  requireVerifiedSocialActor: async () => ({
    ok: true,
    actor: { accountId: "account-a", profileId: "profile-a", handle: "alice" },
  }),
}));
vi.mock("@/lib/socialPostConsentStore", () => {
  class SocialPostConsentStoreError extends Error {}
  return {
    SocialPostConsentStoreError,
    socialPostConsentStore: {
      tagInbox: async (...args: unknown[]) => {
        state.calls.push({ name: "tagInbox", args });
        if ((args[1] as { cursor?: string | null }).cursor === "bad") {
          throw new SocialPostConsentStoreError("That Social page is not valid.");
        }
        return { proposals: [], nextCursor: null };
      },
      actOnTag: async (...args: unknown[]) => {
        state.calls.push({ name: "actOnTag", args });
      },
      outbox: async (...args: unknown[]) => {
        state.calls.push({ name: "outbox", args });
        if ((args[1] as { cursor?: string | null }).cursor === "bad") {
          throw new SocialPostConsentStoreError("That Social page is not valid.");
        }
        return { posts: [], nextCursor: null };
      },
      heldQueue: async () => [],
      moderateHeld: async (...args: unknown[]) => {
        state.calls.push({ name: "moderateHeld", args });
      },
    },
  };
});
vi.mock("@/lib/socialPostVenue.server", () => ({
  projectSocialVenueNames: async (posts: unknown[]) => posts,
}));

import { GET as tags, POST as act } from "@/app/api/social/tags/route";
import { GET as outbox } from "@/app/api/social/outbox/route";
import { POST as moderate } from "@/app/api/admin/social-posts/route";

const proposalId = "11111111-1111-4111-8111-111111111111";
const postId = "22222222-2222-4222-8222-222222222222";

beforeEach(() => { state.calls = []; });

describe("Social consent API contracts", () => {
  it("passes bounded lane pages and owner pages to stable actor stores", async () => {
    expect((await tags(new Request("http://localhost/api/social/tags?lane=approved&limit=12&cursor=opaque"))).status).toBe(200);
    expect((await outbox(new Request("http://localhost/api/social/outbox?limit=8"))).status).toBe(200);
    expect(state.calls).toEqual([
      { name: "tagInbox", args: [expect.objectContaining({ profileId: "profile-a" }), { lane: "approved", cursor: "opaque", limit: 12 }] },
      { name: "outbox", args: [expect.objectContaining({ profileId: "profile-a" }), { cursor: null, limit: 8 }] },
    ]);
  });

  it("maps invalid signed cursors to client errors", async () => {
    expect((await tags(new Request("http://localhost/api/social/tags?cursor=bad"))).status).toBe(400);
    expect((await outbox(new Request("http://localhost/api/social/outbox?cursor=bad"))).status).toBe(400);
  });

  it("requires reviewed audience revision for approval and rejects unknown mutation fields", async () => {
    const approved = await act(new Request("http://localhost/api/social/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId, action: "approve", expectedAudienceRevision: 7 }),
    }));
    expect(approved.status).toBe(200);
    expect(state.calls[0]).toEqual({
      name: "actOnTag",
      args: [expect.objectContaining({ profileId: "profile-a" }), proposalId, "approve", 7],
    });
    const staleShape = await act(new Request("http://localhost/api/social/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId, action: "approve", expectedAudienceRevision: 7, actor: "forged" }),
    }));
    expect(staleShape.status).toBe(400);
  });

  it("rejects unknown moderator fields before the store", async () => {
    const response = await moderate(new Request("http://localhost/api/admin/social-posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId, mediaId: null, action: "hide", role: "forged" }),
    }));
    expect(response.status).toBe(400);
    expect(state.calls).toEqual([]);
    const malformed = await moderate(new Request("http://localhost/api/admin/social-posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId: "-".repeat(36), mediaId: null, action: "hide" }),
    }));
    expect(malformed.status).toBe(400);
    expect(state.calls).toEqual([]);
  });

  it("rejects UUID-shaped punctuation before tag storage", async () => {
    const response = await act(new Request("http://localhost/api/social/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId: "-".repeat(36), action: "decline" }),
    }));
    expect(response.status).toBe(400);
    expect(state.calls).toEqual([]);
  });
});
