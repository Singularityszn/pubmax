import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression for L0-1: every crawl_stories read AND write must name columns the
// table really has. crawl_stories has no `stops` column (stop counts come from
// crawl_story_stops) and no `started_at` column; PostgREST refuses either, so
// the fake below refuses them too.

// The shipped schema: migration 0006 creates both tables, 0010 adds
// crawl_stories.author_handle.
const STORY_COLUMNS = new Set([
  "id",
  "author_id",
  "author_handle",
  "title",
  "slug",
  "summary",
  "visibility",
  "cover_image_url",
  "created_at",
  "updated_at",
]);
const STOP_COLUMNS = new Set([
  "id",
  "crawl_story_id",
  "venue_id",
  "position",
  "note",
  "pint_drop_id",
  "arrived_at",
  "created_at",
]);

const db = vi.hoisted(() => ({
  stories: [] as Array<Record<string, unknown>>,
  stops: [] as Array<Record<string, unknown>>,
  stopsReadFails: false,
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

// PostgREST answers 42703 / PGRST204 for a column the table does not have,
// whether it was selected or inserted.
function unknownColumn(table: string, column: string) {
  return {
    code: "42703",
    message: `column ${table}.${column} does not exist`,
  };
}

function checkSelect(table: string, columns: Set<string>, cols: string) {
  if (cols.trim() === "*") return null;
  for (const raw of cols.split(",")) {
    const name = raw.trim().split("(")[0]?.trim() ?? "";
    if (!name) continue;
    if (!columns.has(name)) return unknownColumn(table, name);
  }
  return null;
}

function checkInsert(table: string, columns: Set<string>, rows: unknown) {
  const list = Array.isArray(rows) ? rows : [rows];
  for (const row of list) {
    for (const name of Object.keys((row ?? {}) as Record<string, unknown>)) {
      if (!columns.has(name)) return unknownColumn(table, name);
    }
  }
  return null;
}

function storiesQuery() {
  const state = {
    author: "",
    limit: 25,
    selectError: null as { code: string; message: string } | null,
  };
  const rows = () =>
    db.stories
      .filter((row) => row.author_handle === state.author)
      .slice(0, state.limit);
  const q = {
    select(cols: string) {
      state.selectError = checkSelect("crawl_stories", STORY_COLUMNS, cols);
      return q;
    },
    insert(payload: unknown) {
      const error = checkInsert("crawl_stories", STORY_COLUMNS, payload);
      if (!error) {
        for (const row of Array.isArray(payload) ? payload : [payload]) {
          db.stories.push({ ...(row as Record<string, unknown>) });
        }
      }
      return Promise.resolve({ data: null, error });
    },
    delete() {
      return {
        eq(col: string, value: unknown) {
          const index = db.stories.findIndex((row) => row[col] === value);
          if (index >= 0) db.stories.splice(index, 1);
          return Promise.resolve({ data: null, error: null });
        },
      };
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
      if (state.selectError) return Promise.resolve({ data: null, error: state.selectError });
      return Promise.resolve({ data: rows(), error: null });
    },
  };
  return q;
}

function stopsQuery() {
  const state = { selectError: null as { code: string; message: string } | null };
  const q = {
    select(cols: string) {
      state.selectError = checkSelect("crawl_story_stops", STOP_COLUMNS, cols);
      return q;
    },
    insert(payload: unknown) {
      const error = checkInsert("crawl_story_stops", STOP_COLUMNS, payload);
      if (!error) {
        for (const row of Array.isArray(payload) ? payload : [payload]) {
          db.stops.push({ ...(row as Record<string, unknown>) });
        }
      }
      return Promise.resolve({ data: null, error });
    },
    in(_col: string, ids: string[]) {
      if (state.selectError) return Promise.resolve({ data: null, error: state.selectError });
      if (db.stopsReadFails) {
        return Promise.resolve({
          data: null,
          error: { code: "57014", message: "statement timeout" },
        });
      }
      const rows = db.stops.filter((row) => ids.includes(String(row.crawl_story_id)));
      return Promise.resolve({ data: rows, error: null });
    },
  };
  return q;
}

import {
  __resetCrawlStories,
  createCrawlStory,
  listStoriesByAuthor,
} from "@/lib/crawlStoryStore";

beforeEach(() => {
  db.stories.length = 0;
  db.stops.length = 0;
  db.stopsReadFails = false;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  __resetCrawlStories();
});

afterEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  vi.restoreAllMocks();
});

describe("listStoriesByAuthor (Supabase)", () => {
  it("counts crawl_story_stops rows rather than reading a stops column", async () => {
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

    expect(await listStoriesByAuthor("ken")).toEqual([
      {
        slug: "loop-one-abc123",
        title: "Loop One",
        stops: 2,
        createdAt: "2026-08-01T12:00:00.000Z",
      },
    ]);
  });

  it("keeps the crawls and leaves the count unknown when the stops read fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    db.stories.push({
      id: "story-1",
      slug: "loop-one-abc123",
      title: "Loop One",
      created_at: "2026-08-01T12:00:00.000Z",
      author_handle: "ken",
      visibility: "public",
    });
    db.stopsReadFails = true;

    expect(await listStoriesByAuthor("ken")).toEqual([
      {
        slug: "loop-one-abc123",
        title: "Loop One",
        stops: null,
        createdAt: "2026-08-01T12:00:00.000Z",
      },
    ]);
  });
});

describe("createCrawlStory (Supabase)", () => {
  it("persists a story the schema accepts, and it lists back", async () => {
    const created = await createCrawlStory({
      title: "Loop One",
      summary: "Three pubs.",
      visibility: "public",
      vibeTags: [],
      authorHandle: "ken",
      stops: [
        { venueId: "venue-a", priceGbp: 5 },
        { venueId: "venue-b", priceGbp: 6 },
      ],
    });

    expect(created?.slug).toBeTruthy();
    expect(created?.authorHandle).toBe("ken");
    expect(await listStoriesByAuthor("ken")).toEqual([
      expect.objectContaining({ slug: created?.slug, title: "Loop One", stops: 2 }),
    ]);
  });
});
