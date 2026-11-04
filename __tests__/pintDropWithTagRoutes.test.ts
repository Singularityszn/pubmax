import { beforeEach, describe, expect, it, vi } from "vitest";

// The routes for "With" tags: the inbox and its actions ride the existing
// /api/social/tags door as `kind: "with"`, and proposals and drop summaries
// are /api/social/tags/with. Photo tags keep their exact contract.

const state = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown[] }>,
  signedIn: true,
  proposeError: null as null | "not_owner" | "invalid",
}));

vi.mock("@/lib/socialAccessServer", () => ({
  requireVerifiedSocialActor: async () =>
    state.signedIn
      ? { ok: true, actor: { accountId: "account-a", profileId: "profile-a", handle: "alice" }, authUserId: "auth-a" }
      : { ok: false, status: 401, code: "SOCIAL_SIGN_IN_REQUIRED", error: "Sign in to use Social." },
}));

vi.mock("@/lib/socialPostConsentStore", () => ({
  SocialPostConsentStoreError: class extends Error {},
  socialPostConsentStore: {
    tagInbox: async (...args: unknown[]) => {
      state.calls.push({ name: "photo.tagInbox", args });
      return { proposals: [], nextCursor: null };
    },
    actOnTag: async (...args: unknown[]) => {
      state.calls.push({ name: "photo.actOnTag", args });
    },
  },
}));

vi.mock("@/lib/pintDropWithTagsStore", () => {
  class WithTagError extends Error {
    constructor(message: string, readonly kind: string) {
      super(message);
    }
  }
  return {
    WithTagError,
    MAX_SUMMARY_DROPS: 60,
    pintDropWithTagsStore: () => ({
      inbox: async (...args: unknown[]) => {
        state.calls.push({ name: "with.inbox", args });
        return { proposals: [], nextCursor: null };
      },
      act: async (...args: unknown[]) => {
        state.calls.push({ name: "with.act", args });
      },
      propose: async (...args: unknown[]) => {
        state.calls.push({ name: "with.propose", args });
        if (state.proposeError) throw new WithTagError("refused", state.proposeError);
      },
      summaries: async (...args: unknown[]) => {
        state.calls.push({ name: "with.summaries", args });
        return new Map([["d1", { approved: ["sam"], pending: 1 }]]);
      },
    }),
  };
});

import { GET as tags, POST as act } from "@/app/api/social/tags/route";
import { GET as summaries, POST as propose } from "@/app/api/social/tags/with/route";

const proposalId = "11111111-1111-4111-8111-111111111111";
const dropId = "22222222-2222-4222-8222-222222222222";

function post(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.calls = [];
  state.signedIn = true;
  state.proposeError = null;
});

describe("the tag inbox reads a second kind", () => {
  it("keeps photo tags as the default and reads with tags on kind=with", async () => {
    expect((await tags(new Request("http://localhost/api/social/tags?lane=approved"))).status).toBe(200);
    expect((await tags(new Request("http://localhost/api/social/tags?kind=with&lane=proposed&limit=5"))).status).toBe(200);
    expect((await tags(new Request("http://localhost/api/social/tags?kind=other"))).status).toBe(400);
    expect(state.calls).toEqual([
      { name: "photo.tagInbox", args: [expect.objectContaining({ profileId: "profile-a" }), { lane: "approved", cursor: null, limit: 20 }] },
      { name: "with.inbox", args: [expect.objectContaining({ profileId: "profile-a" }), { lane: "proposed", cursor: null, limit: 5 }] },
    ]);
  });

  it("acts on a with tag with no audience revision and rejects extra fields", async () => {
    for (const action of ["approve", "decline", "withdraw", "cancel"]) {
      expect((await act(post("http://localhost/api/social/tags", { kind: "with", proposalId, action }))).status).toBe(200);
    }
    expect((await act(post("http://localhost/api/social/tags", { kind: "with", proposalId, action: "approve", actor: "forged" }))).status).toBe(400);
    expect(state.calls.map((call) => call.name)).toEqual(["with.act", "with.act", "with.act", "with.act"]);
    // The photo contract is unchanged: approve still needs its revision.
    expect((await act(post("http://localhost/api/social/tags", { proposalId, action: "approve" }))).status).toBe(400);
  });
});

describe("proposing and reading with tags", () => {
  it("proposes for the verified actor and answers the same whatever was written", async () => {
    const response = await propose(post("http://localhost/api/social/tags/with", { dropId, handles: ["sam"] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(state.calls[0]).toEqual({
      name: "with.propose",
      // Authorship reads the verified auth user id, never the Social record id.
      args: [{ profileId: "profile-a", handle: "alice", accountId: "auth-a" }, dropId, ["sam"]],
    });
  });

  it("refuses a caller who does not own the drop, and a signed-out caller", async () => {
    state.proposeError = "not_owner";
    expect((await propose(post("http://localhost/api/social/tags/with", { dropId, handles: ["sam"] }))).status).toBe(403);
    state.signedIn = false;
    expect((await propose(post("http://localhost/api/social/tags/with", { dropId, handles: ["sam"] }))).status).toBe(401);
  });

  it("rejects malformed proposals before the store", async () => {
    for (const body of [
      { dropId, handles: [] },
      { dropId, handles: ["a", "b", "c", "d", "e", "f", "g"] },
      { dropId, handles: ["sam"], extra: true },
      { dropId: 4, handles: ["sam"] },
    ]) {
      expect((await propose(post("http://localhost/api/social/tags/with", body))).status).toBe(400);
    }
    expect(state.calls).toEqual([]);
  });

  it("reads drop summaries, publicly and with the viewer when there is one", async () => {
    state.signedIn = false;
    const response = await summaries(new Request("http://localhost/api/social/tags/with?drops=d1,d2"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ drops: { d1: { approved: ["sam"], pending: 1 } } });
    expect(state.calls[0]).toEqual({ name: "with.summaries", args: [["d1", "d2"], null] });
    expect((await summaries(new Request("http://localhost/api/social/tags/with"))).status).toBe(400);
  });
});
