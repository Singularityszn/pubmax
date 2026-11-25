import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  story: null as Record<string, unknown> | null,
  profile: { id: "profile-id", handle: "newname", userId: "user-id" as string | undefined },
  aliases: [] as Array<Record<string, unknown>>,
  aliasReadFails: false,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", async (original) => {
  const { admin } = await import("@/lib/storeBackend");
  return { ...await original<typeof import("@/lib/supabase")>(), isSupabaseConfigured: () => true, requireSupabaseAdmin: admin };
});
vi.mock("@/lib/accountPublicAccess.server", () => ({ withdrawnHandles: async () => new Set() }));
vi.mock("@/lib/profileStore", () => ({ profileStore: () => ({
  getById: async (id: string) => id === fixture.profile.id ? fixture.profile : null,
  getByHandle: async (handle: string) => handle === fixture.profile.handle ? fixture.profile : null,
}) }));
vi.mock("@/lib/storeBackend", () => ({
  selectStore: <T,>(_memory: T, durable: T) => durable,
  admin: () => ({ from: (table: string) => {
    let action = "read";
    let patch: Record<string, unknown> = {};
    let bounded = Infinity;
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    const result = () => {
      const source = table === "profile_handle_aliases" ? fixture.aliases
        : table === "crawl_story_stops" ? [{ crawl_story_id: "story-id", venue_id: "venue-a", position: 0 }]
          : fixture.story ? [fixture.story] : [];
      const rows = source.filter((row) => filters.every((filter) => filter(row)));
      return { data: rows.slice(0, bounded), count: rows.length, error: table === "profile_handle_aliases" && fixture.aliasReadFails ? { message: "alias storage unavailable" } : null };
    };
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
      order: () => query,
      or: (condition: string) => { filters.push((row) => splitFilters(condition).some((part) => matchesFilter(row, part))); return query; },
      limit: (limit: number) => { bounded = limit; return query; },
      maybeSingle: async () => { const value = result(); return { ...value, data: value.data[0] ?? null }; },
      update: (value: Record<string, unknown>) => { action = "update"; patch = value; return query; },
      delete: () => { action = "delete"; return query; },
      then: (resolve: (value: unknown) => void) => {
        const value = result();
        if (value.data.length && action === "update" && fixture.story) Object.assign(fixture.story, patch);
        if (value.data.length && action === "delete") fixture.story = null;
        resolve(value);
      },
      in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
    };
    return query;
  } }),
}));

function splitFilters(expression: string): string[] {
  let depth = 0;
  let start = 0;
  const parts: string[] = [];
  for (let index = 0; index < expression.length; index += 1) {
    if (expression[index] === "(") depth += 1;
    if (expression[index] === ")") depth -= 1;
    if (expression[index] === "," && depth === 0) {
      parts.push(expression.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(expression.slice(start));
  return parts;
}

function matchesFilter(row: Record<string, unknown>, expression: string): boolean {
  if (expression.startsWith("and(")) return splitFilters(expression.slice(4, -1)).every((part) => matchesFilter(row, part));
  const match = /^([^.]+)\.(eq|is|gte|lt)\.(.*)$/.exec(expression);
  if (!match) throw new Error(`Unsupported filter: ${expression}`);
  const key = match[1]!;
  const operator = match[2]!;
  const value = match[3]!;
  if (operator === "eq") return row[key] === value;
  if (operator === "is") return value === "null" && row[key] == null;
  const canonical = (stamp: string) => new Date(stamp).toISOString()
    .replace(/\.\d{3}Z$/, `.${(/\.(\d+)/.exec(stamp)?.[1] ?? "").padEnd(6, "0")}Z`);
  const stored = canonical(String(row[key]));
  return operator === "gte" ? stored >= canonical(value) : stored < canonical(value);
}

import { deleteCrawlStory, getCrawlStoryBySlug, getStoryAuthor, isAuthor, listAuthoredCrawlPage, listOwnUnlistedCrawlPage, readCrawlStoryBySlug, updateCrawlStory } from "@/lib/crawlStoryStore";

beforeEach(() => {
  fixture.story = { id: "story-id", slug: "night", title: "Night", summary: "", visibility: "public", author_id: "profile-id", author_handle: "oldname", created_at: "2026-01-01T00:00:00Z" };
  fixture.profile.userId = "user-id";
  fixture.aliases = [];
  fixture.aliasReadFails = false;
});

it.each(["public", "unlisted"])("keeps stable-ID %s crawls with the same profile after rename", async (visibility) => {
  fixture.story!.visibility = visibility;
  const page = visibility === "public" ? await listAuthoredCrawlPage("newname") : await listOwnUnlistedCrawlPage("newname");
  expect(page).toMatchObject({ total: 1, crawls: [{ slug: "night" }] });
  expect(await getStoryAuthor("night")).toBe("newname");
  expect(await isAuthor("night", "newname", "stranger")).toBe(false);
  expect((await updateCrawlStory("night", "newname", { title: "Changed" }, "user-id"))?.title).toBe("Changed");
  expect(await deleteCrawlStory("night", "newname", "user-id")).toBe(true);
});

it.each(["public", "unlisted"])("keeps a %s rollout crawl through its proven alias window", async (visibility) => {
  fixture.story!.author_id = null;
  fixture.story!.visibility = visibility;
  fixture.aliases = [{ profile_id: "profile-id", handle: "oldname", claimed_at: "2025-12-01T00:00:00Z", retired_at: "2026-02-01T00:00:00Z" }];
  const page = visibility === "public" ? await listAuthoredCrawlPage("newname") : await listOwnUnlistedCrawlPage("newname");
  expect(page).toMatchObject({ total: 1, crawls: [{ slug: "night", stops: 1 }] });
  expect(await getStoryAuthor("night")).toBe("newname");
  expect(await getCrawlStoryBySlug("night")).toMatchObject({ authorHandle: "newname", authorOwned: true });
  expect(await isAuthor("night", "oldname", "user-id")).toBe(false);
  expect(await isAuthor("night", "newname", "stranger")).toBe(false);
  expect(await updateCrawlStory("night", "newname", { title: "Hijacked" }, "stranger")).toBeNull();
  expect(await deleteCrawlStory("night", "newname", "stranger")).toBe(false);
  expect((await updateCrawlStory("night", "newname", { title: "Changed" }, "user-id"))?.title).toBe("Changed");
  expect(await deleteCrawlStory("night", "newname", "user-id")).toBe(true);
});

it.each([
  ["2025-12-31T23:59:59Z", false],
  ["2026-01-01T00:00:00Z", true],
  ["2026-01-31T23:59:59Z", true],
  ["2026-02-01T00:00:00Z", false],
])("applies the same claim boundary to reads and listings at %s", async (createdAt, owned) => {
  fixture.story!.author_id = null;
  fixture.story!.created_at = createdAt;
  fixture.aliases = [{ profile_id: "profile-id", handle: "oldname", claimed_at: "2026-01-01T00:00:00Z", retired_at: "2026-02-01T00:00:00Z" }];
  expect(await getCrawlStoryBySlug("night")).toMatchObject({ authorHandle: owned ? "newname" : "oldname", authorOwned: owned });
  expect(await isAuthor("night", "newname", "user-id")).toBe(owned);
  expect((await listAuthoredCrawlPage("newname")).total).toBe(owned ? 1 : 0);
});

it("keeps current-handle controls but refuses an unproved retired handle", async () => {
  fixture.story!.author_id = null;
  expect(await isAuthor("night", "newname", "user-id")).toBe(false);
  expect(await getCrawlStoryBySlug("night")).toMatchObject({ authorOwned: false });
  fixture.story!.author_handle = "newname";
  expect(await getCrawlStoryBySlug("night")).toMatchObject({ authorHandle: "newname", authorOwned: true });
  expect((await listAuthoredCrawlPage("newname")).total).toBe(1);
  expect((await updateCrawlStory("night", "newname", { title: "Changed" }, "user-id"))?.title).toBe("Changed");
  expect(await deleteCrawlStory("night", "newname", "user-id")).toBe(true);
});

it.each([
  ["2026-01-01T00:00:00.000100Z", false],
  ["2026-01-01T00:00:00.000200Z", true],
  ["2026-01-01T00:00:00.000299Z", true],
  ["2026-01-01T00:00:00.000300Z", false],
])("preserves database precision at %s", async (createdAt, owned) => {
  fixture.story!.author_id = null;
  fixture.story!.created_at = createdAt;
  fixture.aliases = [{ profile_id: "profile-id", handle: "oldname", claimed_at: "2026-01-01T00:00:00.000200Z", retired_at: "2026-01-01T00:00:00.000300Z" }];
  expect(await isAuthor("night", "newname", "user-id")).toBe(owned);
  expect((await listAuthoredCrawlPage("newname")).total).toBe(owned ? 1 : 0);
});

it("does not assign a historical crawl to an unlinked profile", async () => {
  fixture.story!.author_id = null;
  fixture.profile.userId = undefined;
  fixture.aliases = [{ profile_id: "profile-id", handle: "oldname", claimed_at: "2025-12-01T00:00:00Z", retired_at: null }];
  expect(await getCrawlStoryBySlug("night")).toMatchObject({ authorHandle: "oldname", authorOwned: false });
  expect(await isAuthor("night", "newname", "user-id")).toBe(false);
  expect((await listAuthoredCrawlPage("newname")).total).toBe(0);
});

it("reports unavailable ownership evidence without granting controls", async () => {
  fixture.story!.author_id = null;
  fixture.aliasReadFails = true;
  expect(await readCrawlStoryBySlug("night")).toEqual({ status: "unavailable" });
  expect(await isAuthor("night", "newname", "user-id")).toBe(false);
  expect(await listAuthoredCrawlPage("newname")).toEqual({ status: "unavailable", crawls: [], total: null });
});
