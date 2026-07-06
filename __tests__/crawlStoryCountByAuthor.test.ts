import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Published crawl-story count by author — the number the Pint Passport shows for
// a handle on /u/[handle]. Covers both the store helper and the GET ?author=
// route branch. In-memory path (Supabase env cleared) so it runs offline.

import { GET } from "@/app/api/crawls/route";
import {
  __resetCrawlStories,
  countStoriesByAuthor,
  createCrawlStory,
  updateCrawlStory,
} from "@/lib/crawlStoryStore";

const URL_BASE = "http://localhost/api/crawls";

async function makeStory(authorHandle?: string, title = "The Loop"): Promise<string> {
  const res = await createCrawlStory({
    title,
    ...(authorHandle ? { authorHandle } : {}),
    stops: [{ venueId: "venue-a" }],
  });
  if (!res) throw new Error("story did not save");
  return res.slug;
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetCrawlStories();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("countStoriesByAuthor", () => {
  it("counts a handle's published stories, normalizing the handle", async () => {
    await makeStory("ken", "Loop One");
    await makeStory("ken", "Loop Two");
    await makeStory("someone_else", "Their Loop");
    expect(await countStoriesByAuthor("ken")).toBe(2);
    expect(await countStoriesByAuthor("  KEN ")).toBe(2); // normalized
    expect(await countStoriesByAuthor("someone_else")).toBe(1);
  });

  it("is 0 for a handle with no stories, an anonymous author, or a blank handle", async () => {
    await makeStory(undefined, "Anon Loop"); // anonymous — no author
    expect(await countStoriesByAuthor("nobody")).toBe(0);
    expect(await countStoriesByAuthor("")).toBe(0);
  });

  it("excludes draft stories (only public/unlisted count as posts)", async () => {
    const slug = await makeStory("ken", "Loop One");
    await makeStory("ken", "Loop Two");
    expect(await countStoriesByAuthor("ken")).toBe(2);
    await updateCrawlStory(slug, "ken", { visibility: "draft" });
    expect(await countStoriesByAuthor("ken")).toBe(1);
  });
});

describe("GET /api/crawls?author=", () => {
  it("returns the normalized handle and its published story count", async () => {
    await makeStory("ken", "Loop One");
    await makeStory("ken", "Loop Two");
    const res = await GET(new Request(`${URL_BASE}?author=${encodeURIComponent("  Ken ")}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ handle: "ken", count: 2 });
  });

  it("returns count 0 for a handle with no stories", async () => {
    const res = await GET(new Request(`${URL_BASE}?author=nobody`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ handle: "nobody", count: 0 });
  });

  it("returns handle '' and count 0 for a blank author param", async () => {
    const res = await GET(new Request(`${URL_BASE}?author=`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ handle: "", count: 0 });
  });
});
