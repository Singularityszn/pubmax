import { beforeEach, describe, expect, it, vi } from "vitest";

// Handler-level coverage for app/api/crawls/[slug]/route.ts — author-gated
// edit/delete (story 35). In-memory path pinned at the @/lib/supabase seam
// (isSupabaseConfigured() === false) — NOT via a NODE_ENV stub, which Vite bakes
// at transform time (a runtime stub is a silent no-op under a production build;
// backend selection reads SUPABASE_*, never NODE_ENV). See profileOwnershipRoute /
// pintDrops for the house pattern.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

// The caller's VERIFIED uid, the one thing a body handle can never assert.
// Both destructive verbs now refuse without one (bugbot F1), so every case
// here states whether the request carries a session.
const caller: { userId: string | null } = { userId: null };
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return { ...actual, callerUserId: async () => caller.userId };
});

import { DELETE, GET, PATCH } from "@/app/api/crawls/[slug]/route";
import { __resetCrawlStories, createCrawlStory } from "@/lib/crawlStoryStore";
import { __resetMemoryProfiles, memoryProfileStore } from "@/lib/profileStore";

const URL_BASE = "http://localhost/api/crawls";

/** Sign the caller in as the owner of `handle`, the shape a real author has. */
async function signInAs(handle: string, userId: string): Promise<void> {
  await memoryProfileStore.createOwned(handle, userId);
  caller.userId = userId;
}

async function makeStory(authorHandle?: string): Promise<string> {
  const res = await createCrawlStory({
    title: "The Loop",
    ...(authorHandle ? { authorHandle } : {}),
    stops: [{ venueId: "venue-a" }],
  });
  if (!res) throw new Error("story did not save");
  return res.slug;
}

function params(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  caller.userId = null;
  __resetCrawlStories();
  __resetMemoryProfiles();
});

describe("PATCH /api/crawls/[slug]", () => {
  it("lets the signed-in author edit the title", async () => {
    const slug = await makeStory("ken");
    await signInAs("ken", "user-ken");
    const req = new Request(`${URL_BASE}/${slug}`, {
      method: "PATCH",
      body: JSON.stringify({ handle: "ken", title: "New Title" }),
    });
    const res = await PATCH(req, params(slug));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { story: { title: string } };
    expect(body.story.title).toBe("New Title");
  });

  it("403s a non-author edit", async () => {
    const slug = await makeStory("ken");
    await signInAs("intruder", "user-intruder");
    const req = new Request(`${URL_BASE}/${slug}`, {
      method: "PATCH",
      body: JSON.stringify({ handle: "intruder", title: "Hijack" }),
    });
    expect((await PATCH(req, params(slug))).status).toBe(403);
  });

  it("403s a missing handle", async () => {
    const slug = await makeStory("ken");
    const req = new Request(`${URL_BASE}/${slug}`, { method: "PATCH", body: JSON.stringify({}) });
    expect((await PATCH(req, params(slug))).status).toBe(403);
  });

  it("403s when the author handle is linked and the caller is anonymous", async () => {
    const slug = await makeStory("ken");
    await memoryProfileStore.createOwned("ken", "user-abc");
    const req = new Request(`${URL_BASE}/${slug}`, {
      method: "PATCH",
      body: JSON.stringify({ handle: "ken", title: "Hijack" }),
    });
    expect((await PATCH(req, params(slug))).status).toBe(403);
  });

  it("401s an anonymous edit of an UNLINKED author's story", async () => {
    // Bugbot F1: the author handle is public (GET below serves it), the demo
    // lane allowed the write, and isAuthor skipped its owner check because
    // nothing was linked - so a stranger could rewrite this story with no
    // token at all. A verified actor is now required whatever handle is sent.
    const slug = await makeStory("victimhandle");
    const req = new Request(`${URL_BASE}/${slug}`, {
      method: "PATCH",
      body: JSON.stringify({ handle: "victimhandle", title: "Hijack" }),
    });
    const res = await PATCH(req, params(slug));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

describe("DELETE /api/crawls/[slug]", () => {
  it("lets the signed-in author delete", async () => {
    const slug = await makeStory("ken");
    await signInAs("ken", "user-ken");
    const req = new Request(`${URL_BASE}/${slug}`, {
      method: "DELETE",
      body: JSON.stringify({ handle: "ken" }),
    });
    expect((await DELETE(req, params(slug))).status).toBe(200);
  });

  it("403s a non-author delete", async () => {
    const slug = await makeStory("ken");
    await signInAs("intruder", "user-intruder");
    const req = new Request(`${URL_BASE}/${slug}`, {
      method: "DELETE",
      body: JSON.stringify({ handle: "intruder" }),
    });
    expect((await DELETE(req, params(slug))).status).toBe(403);
  });

  it("401s an anonymous delete of an UNLINKED author's story, and keeps the row", async () => {
    // The permanent half of F1: the row is deleted rather than tombstoned, so
    // the loss was final for an author who had no account to defend it with.
    const slug = await makeStory("victimhandle");
    const res = await DELETE(
      new Request(`${URL_BASE}/${slug}`, {
        method: "DELETE",
        body: JSON.stringify({ handle: "victimhandle" }),
      }),
      params(slug),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    // The story is still there for its author to claim.
    const author = await GET(new Request(`${URL_BASE}/${slug}`), params(slug));
    expect(await author.json()).toEqual({ author: "victimhandle" });
  });

  it("401s the same handle sent as a query param, not just a body", async () => {
    const slug = await makeStory("victimhandle");
    const res = await DELETE(
      new Request(`${URL_BASE}/${slug}?handle=victimhandle`, { method: "DELETE" }),
      params(slug),
    );
    expect(res.status).toBe(401);
  });
});

describe("GET /api/crawls/[slug] — author", () => {
  it("reports the author handle", async () => {
    const slug = await makeStory("ken");
    const res = await GET(new Request(`${URL_BASE}/${slug}`), params(slug));
    expect(await res.json()).toEqual({ author: "ken" });
  });
});
