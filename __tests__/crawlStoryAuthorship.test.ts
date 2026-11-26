import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Crawl-story authorship: attribution + author-gated edit/delete (story 35).
// FORCE the in-memory path (clear Supabase env) so these run offline everywhere,
// and reset the memory store between cases.
import {
  __resetCrawlStories,
  createCrawlStory,
  deleteCrawlStory,
  getCrawlStoryBySlug,
  getStoryAuthor,
  isAuthor,
  listAuthoredCrawlPage,
  listOwnUnlistedCrawlPage,
  updateCrawlStory,
} from "@/lib/crawlStoryStore";
import { __resetMemoryProfiles, memoryProfileStore, renameMemoryOwnedProfile } from "@/lib/profileStore";
import { __resetMemoryIdentityHandles, memoryIdentityHandleStore } from "@/lib/identityHandleStore";

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetCrawlStories();
  __resetMemoryProfiles();
  __resetMemoryIdentityHandles();
});

afterEach(() => vi.useRealTimers());

async function makeStory(authorHandle?: string, authorUserId?: string) {
  const res = await createCrawlStory({
    title: "The Bloomsbury Loop",
    ...(authorHandle ? { authorHandle } : {}),
    ...(authorUserId ? { authorUserId } : {}),
    stops: [{ venueId: "venue-a" }, { venueId: "venue-b" }],
  });
  if (!res) throw new Error("story did not save");
  return res;
}

describe("attribution", () => {
  it("attributes a story to the author's normalized handle", async () => {
    const { slug } = await makeStory("  Ken ");
    expect(await getStoryAuthor(slug)).toBe("ken");
    const story = await getCrawlStoryBySlug(slug);
    expect(story!.authorHandle).toBe("ken");
  });

  it("leaves an anonymous story with a null author", async () => {
    const { slug } = await makeStory();
    expect(await getStoryAuthor(slug)).toBeNull();
    const story = await getCrawlStoryBySlug(slug);
    expect(story!.authorHandle).toBeNull();
  });
});

describe("isAuthor — the edit/delete gate", () => {
  it.each(["public", "unlisted"] as const)("resolves a legacy %s crawl through its proven claim window", async (visibility) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    expect((await memoryIdentityHandleStore.claim("user-abc", "oldken")).ok).toBe(true);
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    const created = await createCrawlStory({ title: "Legacy night", authorHandle: "oldken", visibility, stops: [{ venueId: "venue-a" }] });
    vi.setSystemTime(new Date("2026-01-03T00:00:00Z"));
    expect((await memoryIdentityHandleStore.rename("user-abc", "newken")).ok).toBe(true);
    const slug = created!.slug;
    const page = visibility === "public" ? await listAuthoredCrawlPage("newken") : await listOwnUnlistedCrawlPage("newken");
    expect(page).toMatchObject({ total: 1, crawls: [{ slug }] });
    expect(await getStoryAuthor(slug)).toBe("newken");
    expect(await getCrawlStoryBySlug(slug)).toMatchObject({ authorHandle: "newken", authorOwned: true });
    expect(await isAuthor(slug, "newken", "stranger")).toBe(false);
    expect((await updateCrawlStory(slug, "newken", { title: "Changed" }, "user-abc"))?.title).toBe("Changed");
    expect(await deleteCrawlStory(slug, "newken", "user-abc")).toBe(true);
  });

  it("preserves the current-handle fallback without following an unproved rename", async () => {
    const { slug } = await makeStory("future_owner");
    const profile = await memoryProfileStore.createOwned("future_owner", "later-user");
    expect(await isAuthor(slug, "future_owner", "later-user")).toBe(true);
    expect((await listAuthoredCrawlPage("future_owner")).crawls.map((row) => row.slug)).toContain(slug);
    expect(await getCrawlStoryBySlug(slug)).toMatchObject({ authorHandle: "future_owner", authorOwned: true });
    expect(await updateCrawlStory(slug, "future_owner", { visibility: "unlisted" }, "later-user")).not.toBeNull();
    expect((await listOwnUnlistedCrawlPage("future_owner")).crawls.map((row) => row.slug)).toContain(slug);
    renameMemoryOwnedProfile(profile.id, "later-user", "new_owner");
    expect(await isAuthor(slug, "new_owner", "later-user")).toBe(false);
    expect((await listAuthoredCrawlPage("new_owner")).crawls).toEqual([]);
    expect((await listOwnUnlistedCrawlPage("new_owner")).crawls).toEqual([]);
    expect(await getCrawlStoryBySlug(slug)).toMatchObject({ authorHandle: "future_owner", authorOwned: false });
  });
  it("preserves author control after the account changes handle", async () => {
    const profile = await memoryProfileStore.createOwned("ken", "user-abc");
    const created = await createCrawlStory({ title: "A night", authorHandle: "ken", authorUserId: "user-abc", stops: [{ venueId: "venue-a" }] });
    renameMemoryOwnedProfile(profile.id, "user-abc", "newken");
    expect(await getStoryAuthor(created!.slug)).toBe("newken");
    expect((await listAuthoredCrawlPage("newken")).crawls.map((crawl) => crawl.slug)).toContain(created!.slug);
    expect(await isAuthor(created!.slug, "newken", "user-abc")).toBe(true);
    expect(await isAuthor(created!.slug, "newken", "other-user")).toBe(false);
    expect(await updateCrawlStory(created!.slug, "newken", { title: "Renamed" }, "user-abc")).not.toBeNull();
    expect(await deleteCrawlStory(created!.slug, "newken", "user-abc")).toBe(true);
  });
  it("is true only for the exact author handle", async () => {
    await memoryProfileStore.createOwned("ken", "user-ken");
    const { slug } = await makeStory("ken", "user-ken");
    expect(await isAuthor(slug, "ken", "user-ken")).toBe(true);
    expect(await isAuthor(slug, "KEN", "user-ken")).toBe(true);
    expect(await isAuthor(slug, "someone_else", "user-ken")).toBe(false);
  });

  it("is false for an anonymous story (no author to match)", async () => {
    const { slug } = await makeStory();
    expect(await isAuthor(slug, "ken")).toBe(false);
    expect(await isAuthor(slug, "")).toBe(false);
  });

  it("is false for an unknown slug", async () => {
    expect(await isAuthor("no-such-slug", "ken")).toBe(false);
  });

  it("requires matching JWT owner when the author handle is linked", async () => {
    await memoryProfileStore.createOwned("ken", "user-abc");
    const { slug } = await makeStory("ken", "user-abc");
    expect(await isAuthor(slug, "ken")).toBe(false);
    expect(await isAuthor(slug, "ken", "user-xyz")).toBe(false);
    expect(await isAuthor(slug, "ken", "user-abc")).toBe(true);
  });
});

describe("updateCrawlStory — author only", () => {
  it("lets the author edit head fields", async () => {
    await memoryProfileStore.createOwned("ken", "user-ken");
    const { slug } = await makeStory("ken", "user-ken");
    const updated = await updateCrawlStory(slug, "ken", { title: "A Better Title" }, "user-ken");
    expect(updated!.title).toBe("A Better Title");
  });

  it("refuses a non-author edit (returns null, no change)", async () => {
    const { slug } = await makeStory("ken");
    const attempt = await updateCrawlStory(slug, "intruder", { title: "Hijacked" });
    expect(attempt).toBeNull();
    // The story is unchanged.
    expect((await getCrawlStoryBySlug(slug))!.title).toBe("The Bloomsbury Loop");
  });
});

describe("deleteCrawlStory — author only", () => {
  it("lets the author delete their story", async () => {
    await memoryProfileStore.createOwned("ken", "user-ken");
    const { slug } = await makeStory("ken", "user-ken");
    expect(await deleteCrawlStory(slug, "ken", "user-ken")).toBe(true);
    expect(await getCrawlStoryBySlug(slug)).toBeNull();
  });

  it("refuses a non-author delete (story survives)", async () => {
    const { slug } = await makeStory("ken");
    expect(await deleteCrawlStory(slug, "intruder")).toBe(false);
    expect(await getCrawlStoryBySlug(slug)).not.toBeNull();
  });

  it("refuses to delete an anonymous story (no owner)", async () => {
    const { slug } = await makeStory();
    expect(await deleteCrawlStory(slug, "ken")).toBe(false);
    expect(await getCrawlStoryBySlug(slug)).not.toBeNull();
  });
});
