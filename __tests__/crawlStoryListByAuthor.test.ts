import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression for L0-1: listStoriesByAuthor must not SELECT a non-existent
// `stops` column on crawl_stories (PostgREST 42703). Stop counts come from
// crawl_story_stops.

const storiesSelectCols = vi.hoisted(() => ({ value: "" }));
const db = vi.hoisted(() => ({
  stories: [] as Array<Record<string, unknown>>,
  stops: [] as Array<{ crawl_story_id: string }>,
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => true };
});

vi.mock("@/lib/storeBackend", () => ({
  admin: () => ({
    from: (table: string) => {
      if (table === "crawl_stories") return storiesQuery();
      if (table === "crawl_story_stops") return stopsQuery();
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

function storiesQuery() {
  const state = { author: "", limit: 25 };
  const q = {
    select(cols: string) {
      storiesSelectCols.value = cols;
      return q;
    },
    eq(col: string, value: unknown) {
      if (col === "author_handle") state.author = String(value);
      return q;
    },
    neq() {
      return q;
    },
    order() {
      return q;
    },
    limit(n: number) {
      state.limit = n;
      const rows = db.stories
        .filter((row) => row.author_handle === state.author)
        .slice(0, state.limit);
      return Promise.resolve({ data: rows, error: null });
    },
  };
  return q;
}

function stopsQuery() {
  const state = { ids: [] as string[] };
  const q = {
    select(_cols: string) {
      return q;
    },
    in(_col: string, ids: string[]) {
      state.ids = ids;
      const rows = db.stops.filter((row) => state.ids.includes(row.crawl_story_id));
      return Promise.resolve({ data: rows, error: null });
    },
  };
  return q;
}

import {
  __resetCrawlStories,
  listStoriesByAuthor,
} from "@/lib/crawlStoryStore";

beforeEach(() => {
  storiesSelectCols.value = "";
  db.stories.length = 0;
  db.stops.length = 0;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  __resetCrawlStories();
});

afterEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

describe("listStoriesByAuthor (Supabase)", () => {
  it("selects story columns without stops and counts crawl_story_stops rows", async () => {
    db.stories.push({
      id: "story-1",
      slug: "loop-one-abc123",
      title: "Loop One",
      created_at: "2026-08-01T12:00:00.000Z",
      author_handle: "ken",
      visibility: "public",
    });
    db.stops.push(
      { crawl_story_id: "story-1" },
      { crawl_story_id: "story-1" },
    );

    const listed = await listStoriesByAuthor("ken");
    expect(storiesSelectCols.value).not.toMatch(/\bstops\b/);
    expect(storiesSelectCols.value).toContain("slug");
    expect(listed).toEqual([
      {
        slug: "loop-one-abc123",
        title: "Loop One",
        stops: 2,
        createdAt: "2026-08-01T12:00:00.000Z",
      },
    ]);
  });
});
