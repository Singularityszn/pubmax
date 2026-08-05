import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const state = vi.hoisted(() => ({
  access: {
    ok: true,
    actor: { accountId: "account-a", profileId: "profile-a", handle: "alice" },
  } as unknown,
  calls: [] as Array<{ name: string; args: unknown[] }>,
  read: null as unknown,
  limited: false,
}));

vi.mock("@/lib/pintDrops", () => ({
  isLimited: async () => state.limited,
}));

vi.mock("@/lib/socialAccessServer", () => ({
  requireVerifiedSocialActor: async () => state.access,
}));

vi.mock("@/lib/socialPostStore", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/socialPostStore")>();
  return {
    ...original,
    socialPostStore: () => ({
      create: async (...args: unknown[]) => {
        state.calls.push({ name: "create", args });
        return {
          id: "post-1", body: "Hello", moderationState: "pending",
          author: { handle: "alice" },
        };
      },
      feed: async (...args: unknown[]) => {
        state.calls.push({ name: "feed", args });
        return { posts: [], nextCursor: null };
      },
      read: async (...args: unknown[]) => {
        state.calls.push({ name: "read", args });
        return state.read;
      },
      edit: async (...args: unknown[]) => {
        state.calls.push({ name: "edit", args });
        return { id: "post-1", body: "Changed", revision: 1, moderationState: "pending" };
      },
      remove: async (...args: unknown[]) => {
        state.calls.push({ name: "remove", args });
        return true;
      },
    }),
  };
});

import { GET as list, POST } from "@/app/api/social/posts/route";
import { GET as read, PATCH } from "@/app/api/social/posts/[postId]/route";

const actor = { accountId: "account-a", profileId: "profile-a", handle: "alice" };

function request(path: string, method = "GET", body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    ...(body === undefined ? {} : {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
}

beforeEach(() => {
  state.access = { ok: true, actor };
  state.calls = [];
  state.read = null;
  state.limited = false;
});

describe("/api/social/posts", () => {
  it("requires verified Social access for every feed read", async () => {
    state.access = {
      ok: false,
      status: 403,
      code: "SOCIAL_ADULT_VERIFICATION_REQUIRED",
      error: "Adult verification is needed for Social.",
    };
    const response = await list(request("/api/social/posts?lane=discover"));
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(state.calls).toEqual([]);
  });

  it("passes only server actor and bounded lane inputs to the store", async () => {
    const response = await list(request("/api/social/posts?lane=nearby&area=camden&limit=20"));
    expect(response.status).toBe(200);
    expect(state.calls).toEqual([{
      name: "feed",
      args: [actor, { lane: "nearby", area: "camden", cursor: null, limit: 20 }],
    }]);
  });

  it("rejects an unlisted nearby area before storage", async () => {
    const response = await list(request("/api/social/posts?lane=nearby&area=not-a-place"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_AREA" });
    expect(state.calls).toEqual([]);
  });

  it("creates a pending post without accepting author or raw storage fields", async () => {
    const response = await POST(request("/api/social/posts", "POST", {
      kind: "standard",
      visibility: "public",
      body: "Hello",
      commentPolicy: "open",
      hashtags: [],
    }));
    expect(response.status).toBe(201);
    expect(JSON.stringify(await response.json())).not.toContain("account-a");
    expect(state.calls[0]?.name).toBe("create");
    expect(state.calls[0]?.args[0]).toEqual(actor);

    const forged = await POST(request("/api/social/posts", "POST", {
      kind: "standard", visibility: "public", body: "Hello", commentPolicy: "open",
      authorProfileId: "forged", status: "visible", storageObjectKey: "secret/key",
    }));
    expect(forged.status).toBe(400);
    expect(state.calls).toHaveLength(1);
  });

  it("reserves photo references until ownership-checked upload ships", async () => {
    const response = await POST(request("/api/social/posts", "POST", {
      kind: "standard",
      visibility: "friends",
      body: "",
      commentPolicy: "open",
      photo: {
        mediaId: "11111111-1111-4111-8111-111111111111",
        altText: "A pub sign",
      },
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "PHOTO_UPLOAD_NOT_AVAILABLE" });
  });

  it("rate-limits creation by stable profile authority", async () => {
    state.limited = true;
    const response = await POST(request("/api/social/posts", "POST", {
      kind: "standard", visibility: "public", body: "Hello",
      commentPolicy: "open", hashtags: [],
    }));
    expect(response.status).toBe(429);
    expect(state.calls).toEqual([]);
  });
});

describe("/api/social/posts/[postId]", () => {
  const postId = "11111111-1111-4111-8111-111111111111";
  const context = { params: Promise.resolve({ postId }) };

  it("rejects a non-UUID path before durable storage", async () => {
    const response = await read(request("/api/social/posts/not-a-uuid"), {
      params: Promise.resolve({ postId: "not-a-uuid" }),
    });
    expect(response.status).toBe(404);
    expect(state.calls).toEqual([]);
  });

  it("returns 404 for a post hidden by visibility or moderation", async () => {
    const response = await read(request("/api/social/posts/post-1"), context);
    expect(response.status).toBe(404);
    expect(state.calls[0]).toEqual({ name: "read", args: [postId, actor] });
  });

  it("edits through the stable internal actor and reuses strict validation", async () => {
    const response = await PATCH(request("/api/social/posts/post-1", "PATCH", {
      body: "Changed",
    }), context);
    expect(response.status).toBe(200);
    expect(state.calls[0]).toEqual({
      name: "edit",
      args: [postId, actor, { body: "Changed" }, true],
    });
  });

  it("removes recoverably without a DELETE route or client status", async () => {
    const response = await PATCH(request("/api/social/posts/post-1", "PATCH", {
      action: "remove",
    }), context);
    expect(response.status).toBe(200);
    expect(state.calls[0]).toEqual({ name: "remove", args: [postId, actor] });
  });

  it("rate-limits item changes by stable profile authority", async () => {
    state.limited = true;
    const response = await PATCH(request("/api/social/posts/post-1", "PATCH", {
      body: "Changed",
    }), context);
    expect(response.status).toBe(429);
    expect(state.calls).toEqual([]);
  });
});
