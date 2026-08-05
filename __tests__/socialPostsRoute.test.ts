import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const state = vi.hoisted(() => ({
  access: {
    ok: true,
    actor: { accountId: "account-a", profileId: "profile-a", handle: "alice" },
  } as unknown,
  calls: [] as Array<{ name: string; args: unknown[] }>,
  limitCalls: [] as unknown[][],
  read: null as unknown,
  limited: false,
  frozen: false,
  accessCalls: 0,
  venueLookup: {
    status: "found",
    canonicalId: "venue-canonical",
    venue: { id: "venue-canonical", name: "The Venue", borough: "Camden", lat: 0, lng: 0, kind: "pub" },
  } as unknown,
  removedObjects: [] as string[],
  createError: null as Error | null,
}));

vi.mock("@/lib/pintDrops", () => ({
  isLimited: async (...args: unknown[]) => {
    state.limitCalls.push(args);
    return state.limited;
  },
}));

vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/supabase")>(),
  hashActor: () => "salted-profile-digest",
}));

vi.mock("@/lib/opsFreeze", () => ({
  socialFreezeResponse: () => state.frozen
    ? Response.json({ code: "SOCIAL_FROZEN" }, { status: 503 })
    : null,
}));

vi.mock("@/lib/socialAccessServer", () => ({
  requireVerifiedSocialActor: async () => {
    state.accessCalls += 1;
    return state.access;
  },
}));

vi.mock("@/lib/venueIndex", () => ({
  lookupCanonicalVenue: async () => state.venueLookup,
}));

vi.mock("@/lib/socialPostMedia.server", () => ({
  prepareSocialPhoto: async () => ({
    bytes: Buffer.from("normalised"),
    contentType: "image/jpeg",
    width: 640,
    height: 480,
    byteSize: 10,
    sha256: "a".repeat(64),
  }),
  uploadPreparedSocialPhoto: async (_owner: string, prepared: Record<string, unknown>) => ({
    ...prepared,
    mediaId: "11111111-1111-4111-8111-111111111112",
    objectKey: "social/profile-a/11111111-1111-4111-8111-111111111112/image.jpg",
  }),
  removeSocialPhotoObject: async (key: string) => {
    state.removedObjects.push(key);
  },
  signSocialPhotoObject: async () => null,
  SocialPhotoError: class SocialPhotoError extends Error {
    code = "INVALID_TYPE";
  },
  SOCIAL_PHOTO_MAX_BYTES: 10 * 1024 * 1024,
}));

vi.mock("@/lib/socialPostStore", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/socialPostStore")>();
  return {
    ...original,
    socialPostStore: () => ({
      create: async (...args: unknown[]) => {
        state.calls.push({ name: "create", args });
        if (state.createError) throw state.createError;
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
  state.limitCalls = [];
  state.read = null;
  state.limited = false;
  state.frozen = false;
  state.accessCalls = 0;
  state.venueLookup = {
    status: "found",
    canonicalId: "venue-canonical",
    venue: { id: "venue-canonical", name: "The Venue", borough: "Camden", lat: 0, lng: 0, kind: "pub" },
  };
  state.removedObjects = [];
  state.createError = null;
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
    expect(state.limitCalls[0]).toEqual([
      "social-post-feed:salted-profile-digest:nearby:camden",
      "social-post-feed:salted-profile-digest:nearby:camden",
      60,
      60_000,
    ]);
  });

  it("rate-limits verified feed reads before storage", async () => {
    state.limited = true;
    const response = await list(request("/api/social/posts?lane=discover"));
    expect(response.status).toBe(429);
    expect(state.calls).toEqual([]);
    expect(state.limitCalls[0]?.[0]).toBe(
      "social-post-feed:salted-profile-digest:discover:all",
    );
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

  it("rejects caller-supplied media references", async () => {
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
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_POST" });
  });

  it("canonicalises a public pub Venue and rejects a non-pub Venue", async () => {
    const response = await POST(request("/api/social/posts", "POST", {
      kind: "standard",
      visibility: "public",
      body: "At the Venue",
      venueId: "venue-alias",
      commentPolicy: "open",
      hashtags: [],
    }));
    expect(response.status).toBe(201);
    expect(state.calls[0]?.args[1]).toMatchObject({ venueId: "venue-canonical" });

    state.calls = [];
    state.venueLookup = {
      status: "found",
      canonicalId: "bar-canonical",
      venue: { id: "bar-canonical", name: "A Bar", borough: "Camden", lat: 0, lng: 0, kind: "bar" },
    };
    const rejected = await POST(request("/api/social/posts", "POST", {
      kind: "standard",
      visibility: "friends",
      body: "At the bar",
      venueId: "bar-alias",
      commentPolicy: "open",
      hashtags: [],
    }));
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ code: "INVALID_VENUE" });
    expect(state.calls).toEqual([]);
  });

  it("accepts multipart photo create without caller media keys", async () => {
    const form = new FormData();
    form.set("post", JSON.stringify({
      kind: "standard",
      visibility: "friends",
      body: "",
      commentPolicy: "friends",
      photoAltText: "Friends outside a pub",
      tagHandles: ["bob"],
    }));
    form.set("photo", new File([Buffer.from([0xff, 0xd8, 0xff])], "night.jpg", { type: "image/jpeg" }));

    const response = await POST(new Request("http://localhost/api/social/posts", {
      method: "POST",
      body: form,
    }));

    expect(response.status).toBe(201);
    expect(state.calls[0]).toEqual({
      name: "create",
      args: [
        actor,
        expect.objectContaining({
          body: "",
          photo: {
            mediaId: "11111111-1111-4111-8111-111111111112",
            altText: "Friends outside a pub",
          },
        }),
        {
          media: {
            mediaId: "11111111-1111-4111-8111-111111111112",
            objectKey: "social/profile-a/11111111-1111-4111-8111-111111111112/image.jpg",
            sha256: "a".repeat(64),
            width: 640,
            height: 480,
            byteSize: 10,
          },
          tagHandles: ["bob"],
        },
      ],
    });
    expect(JSON.stringify(state.calls[0])).not.toContain("normalised");
  });

  it("removes an uploaded object when atomic create fails", async () => {
    state.createError = new Error("database unavailable");
    const form = new FormData();
    form.set("post", JSON.stringify({
      kind: "standard",
      visibility: "friends",
      body: "Photo",
      commentPolicy: "friends",
      photoAltText: "A pub sign",
    }));
    form.set("photo", new File([Buffer.from([0xff, 0xd8, 0xff])], "night.jpg", { type: "image/jpeg" }));

    const response = await POST(new Request("http://localhost/api/social/posts", { method: "POST", body: form }));

    expect(response.status).toBe(503);
    expect(state.removedObjects).toEqual([
      "social/profile-a/11111111-1111-4111-8111-111111111112/image.jpg",
    ]);
  });

  it("rate-limits creation by stable profile authority", async () => {
    state.limited = true;
    const response = await POST(request("/api/social/posts", "POST", {
      kind: "standard", visibility: "public", body: "Hello",
      commentPolicy: "open", hashtags: [],
    }));
    expect(response.status).toBe(429);
    expect(state.calls).toEqual([]);
    expect(JSON.stringify(state.limitCalls)).not.toContain("profile-a");
    expect(state.limitCalls[0]?.[0]).toBe("social-post-create:salted-profile-digest");
  });

  it("freezes creation before identity, limiting, or storage work", async () => {
    state.frozen = true;
    const response = await POST(request("/api/social/posts", "POST", {
      kind: "standard", visibility: "public", body: "Hello",
      commentPolicy: "open", hashtags: [],
    }));
    expect(response.status).toBe(503);
    expect(state.accessCalls).toBe(0);
    expect(state.limitCalls).toEqual([]);
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
      expectedRevision: 4,
      body: "Changed",
    }), context);
    expect(response.status).toBe(200);
    expect(state.calls[0]).toEqual({
      name: "edit",
      args: [postId, actor, 4, { body: "Changed" }, true],
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
      expectedRevision: 0,
      body: "Changed",
    }), context);
    expect(response.status).toBe(429);
    expect(state.calls).toEqual([]);
    expect(JSON.stringify(state.limitCalls)).not.toContain("profile-a");
    expect(state.limitCalls[0]?.[0]).toBe("social-post-edit:salted-profile-digest");
  });

  it("freezes edits and removals before identity, limiting, or storage work", async () => {
    state.frozen = true;
    const edited = await PATCH(request("/api/social/posts/post-1", "PATCH", {
      expectedRevision: 0,
      body: "Changed",
    }), context);
    const removed = await PATCH(request("/api/social/posts/post-1", "PATCH", {
      action: "remove",
    }), context);
    expect([edited.status, removed.status]).toEqual([503, 503]);
    expect(state.accessCalls).toBe(0);
    expect(state.limitCalls).toEqual([]);
    expect(state.calls).toEqual([]);
  });
});
