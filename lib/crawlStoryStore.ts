// Durable Crawl Story storage. A Crawl Story can already travel entirely inside a
// `?s=` URL param (lib/crawlStory.ts — anonymous, no DB). This module is the
// OTHER half: persist a story to Supabase so it earns a stable, slug-addressed
// permalink (/crawls/[slug]) that can be indexed, shared, and authored by
// a profile. ONE interface, TWO backends — Supabase (crawl_stories +
// crawl_story_stops) when env keys exist, an in-memory Map otherwise — chosen at
// the single seam below, mirroring lib/pintDropsStore.ts. Public reads distinguish
// unavailable storage from a hidden or missing story. The anonymous encoded path
// remains available for people who do not want a durable link.

import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  AUTHOR_CRAWL_LIST_DEFAULT_LIMIT,
  AUTHOR_CRAWL_LIST_MAX_LIMIT,
  clampAuthorCrawlListLimit,
} from "@/lib/authorCrawlList";
import { withdrawnHandles } from "@/lib/accountPublicAccess.server";
import { totalGbp, VIBE_TAGS, type CrawlStory } from "@/lib/crawlStory";
import { identityHandleStore } from "@/lib/identityHandleStore";
import { normalizeHandle } from "@/lib/profiles";
import { profileStore, type ProfileRecord } from "@/lib/profileStore";
import { admin } from "@/lib/storeBackend";
import { isSupabaseConfigured } from "@/lib/supabase";
import { storedVenueName } from "@/lib/storedVenueRef";
import { resolveStoredVenue, venueMapUrl } from "@/lib/venueIndex";

// ── Types ────────────────────────────────────────────────────────────────────

// A story's visibility. `draft` is private and never returned by the public read.
// `unlisted` is readable by anyone with the link but not surfaced in listings;
// `public` is the default.
export type StoryVisibility = "draft" | "public" | "unlisted";

const VISIBILITIES: ReadonlySet<string> = new Set<StoryVisibility>([
  "draft",
  "public",
  "unlisted",
]);

/** Normalise an untrusted visibility to the allowlist; default `public`. */
export function cleanVisibility(value: unknown): StoryVisibility {
  return typeof value === "string" && VISIBILITIES.has(value)
    ? (value as StoryVisibility)
    : "public";
}

const VIBE_TAG_SET: ReadonlySet<string> = new Set<string>(VIBE_TAGS);

// The input a caller hands to createCrawlStory. Deliberately small + storage-
// agnostic: a title, an ordered list of stops (venue id + optional note), some
// vibe tags, an optional summary/caption, and a visibility. Everything is
// re-clamped here (trust boundary — the API route already clamps, this is
// defence in depth so a direct caller can't smuggle junk into the DB).
export type CreateCrawlStoryInput = {
  title: string;
  summary?: string;
  visibility?: StoryVisibility;
  vibeTags?: string[];
  // A handle may be displayed without granting ownership. A verified user ID
  // links a save to its author's profile.
  authorHandle?: string;
  authorUserId?: string;
  requestKey?: string;
  stops: Array<{
    venueId: string;
    note?: string;
    priceGbp?: number | null;
  }>;
};

// One stop as read back for rendering: the raw venue id PLUS the server-resolved
// pub name and map link (venueIndex is server-only — the raw id must never be the
// label the poster shows, PRD §9).
type DurableStop = {
  venueId: string;
  venueName: string;
  venueMapUrl: string;
  note?: string;
  priceGbp?: number | null;
  position: number;
};

// The full durable story as returned to a server component / API GET.
export type DurableStory = {
  slug: string;
  title: string;
  summary: string;
  visibility: StoryVisibility;
  vibeTags: string[];
  // Proven ownership resolves to the profile's current handle. An unproved
  // attribution remains plain text rather than linking to a profile.
  authorHandle: string | null;
  authorOwned: boolean;
  stops: DurableStop[];
  totalGbp: number;
  createdAt: string;
};

// ── Trust-boundary clamps ────────────────────────────────────────────────────
// Mirror lib/crawlStory.ts so a durable story can never hold more than the
// encoded one could. Kept generous — a normal crawl is well under them.
const MAX_TITLE = 120; // per schema/spec (the encoded path caps title at 80)
const MAX_SUMMARY = 280;
const MAX_NOTE = 160;
const MAX_VENUE_ID = 80;
const MAX_STOPS = 12;
const MAX_TAGS = VIBE_TAGS.length;

function clampText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value
    .replace(/[<>]/g, "") // no inline user HTML
    .replace(/[\u0000-\u001f\u007f]/g, " ") // strip control chars
    .replace(/\s+/g, " ")
    .trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * The stop price this store keeps for an untrusted value, or null for none.
 * `app/api/crawls` asks the same function whether a stop carries a price, so
 * the route gates exactly the figures the store would keep.
 */
export function cleanCrawlStopPrice(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function cleanVibeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().toLowerCase();
    if (VIBE_TAG_SET.has(tag) && !out.includes(tag)) {
      out.push(tag);
      if (out.length >= MAX_TAGS) break;
    }
  }
  return out;
}

function normaliseStops(raw: CreateCrawlStoryInput["stops"]): Array<{
  venueId: string;
  note?: string;
  priceGbp: number | null;
}> {
  if (!Array.isArray(raw)) return [];
  const stops: Array<{ venueId: string; note?: string; priceGbp: number | null }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const venueId = clampText(item.venueId, MAX_VENUE_ID);
    if (!venueId) continue; // a stop with no venue can't be resolved or planned
    const note = clampText(item.note, MAX_NOTE);
    stops.push({
      venueId,
      priceGbp: cleanCrawlStopPrice(item.priceGbp),
      ...(note ? { note } : {}),
    });
    if (stops.length >= MAX_STOPS) break;
  }
  return stops;
}

// ── Slug generation ──────────────────────────────────────────────────────────

const MAX_SLUG_BASE = 60;

/**
 * Generate a deterministic slug candidate. See createCrawlStory for collision
 * handling and request-key retry guarantees.
 */
export function slugify(title: string, stopIds: string[] = [], salt = 0): string {
  const base = String(title ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-") // non-alnum → hyphen
    .replace(/^-+|-+$/g, "") // trim leading/trailing hyphens
    .slice(0, MAX_SLUG_BASE)
    .replace(/-+$/g, ""); // no trailing hyphen after the slice
  const stem = base || "crawl"; // an emoji-only / blank title still gets a slug
  const material = `${title}|${stopIds.join("|")}|${salt}`;
  const suffix = createHash("sha256").update(material).digest("hex").slice(0, 6);
  return `${stem}-${suffix}`;
}

// ── In-memory backend ────────────────────────────────────────────────────────
// Process-memory store, resets on restart — right for dev/demo/tests. Keyed by
// slug. Holds the RAW venue ids; name resolution happens on read (getBySlug) so
// both backends share one enrichment path.

type StoredStory = {
  slug: string;
  title: string;
  summary: string;
  visibility: StoryVisibility;
  vibeTags: string[];
  authorHandle: string | null;
  authorId: string | null;
  requestKey: string;
  requestHash: string;
  stops: Array<{ venueId: string; note?: string; priceGbp: number | null; position: number }>;
  createdAt: string;
};

const memoryGlobal = globalThis as typeof globalThis & {
  __pubmaxCrawlStories?: Map<string, StoredStory>;
};
const memoryStories = memoryGlobal.__pubmaxCrawlStories ??= new Map<string, StoredStory>();

// Test-only: reset process state between cases.
export function __resetCrawlStories(): void {
  memoryStories.clear();
}

// ── Enrichment (shared read path) ─────────────────────────────────────────────
// Turn stored raw stops into render-ready DurableStops: resolve each venue id to
// a real pub name + map link (server-only). A stale id (dropped from the dataset)
// degrades to a friendly label rather than surfacing the raw id.
async function enrich(stored: StoredStory): Promise<DurableStory> {
  const stops: DurableStop[] = await Promise.all(
    stored.stops
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(async (stop) => {
        const ref = await resolveStoredVenue(stop.venueId);
        // A stop stored under a merged or superseded id links the id the
        // venue carries now, which is the one the map can open.
        const venueId = ref?.id ?? stop.venueId;
        return {
          venueId,
          venueName: ref ? storedVenueName(ref) : "A London pub",
          venueMapUrl: venueMapUrl(venueId),
          priceGbp: stop.priceGbp ?? null,
          ...(stop.note ? { note: stop.note } : {}),
          position: stop.position,
        };
      }),
  );
  const story: CrawlStory = {
    title: stored.title,
    caption: stored.summary,
    vibeTags: stored.vibeTags,
    stops: stops.map((s) => ({ venueId: s.venueId, name: s.venueName, priceGbp: s.priceGbp })),
  };
  return {
    slug: stored.slug,
    title: stored.title,
    summary: stored.summary,
    visibility: stored.visibility,
    vibeTags: stored.vibeTags,
    authorHandle: stored.authorHandle,
    authorOwned: stored.authorId !== null,
    stops,
    totalGbp: totalGbp(story),
    createdAt: stored.createdAt,
  };
}

// ── Supabase backend helpers ──────────────────────────────────────────────────

const STORIES_TABLE = "crawl_stories";
const STOPS_TABLE = "crawl_story_stops";

// A stored story → the crawl_stories row. The profile ID is set only when the
// verified account owns the author handle.
function toStoryRow(story: StoredStory) {
  return {
    id: randomUUID(),
    author_id: story.authorId,
    author_handle: story.authorHandle,
    title: story.title,
    slug: story.slug,
    summary: story.summary,
    visibility: story.visibility,
    cover_image_url: null as string | null,
    created_at: story.createdAt,
    updated_at: story.createdAt,
  };
}

function fromStoryRow(row: Record<string, unknown>): Omit<StoredStory, "stops"> {
  const author = normalizeHandle(String(row.author_handle ?? ""));
  return {
    slug: String(row.slug),
    title: String(row.title ?? ""),
    summary: String(row.summary ?? ""),
    visibility: cleanVisibility(row.visibility),
    vibeTags: [], // vibe tags are re-derived below; crawl_stories has no tags column
    authorHandle: author || null,
    authorId: typeof row.author_id === "string" ? row.author_id : null,
    requestKey: typeof row.save_key === "string" ? row.save_key : "",
    requestHash: typeof row.save_hash === "string" ? row.save_hash : "",
    createdAt: String(row.created_at ?? new Date(0).toISOString()),
  };
}

// A unique-violation on the slug column (Postgres 23505) — the only error
// createCrawlStory retries; every other insert error still throws.
function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return code === "23505" || message.includes("duplicate key") || message.includes("unique");
}

// ── Public API ────────────────────────────────────────────────────────────────

const MAX_SLUG_ATTEMPTS = 5;

/**
 * Persist a Crawl Story and its ordered stops atomically. Reusing a request key
 * with the same content and account returns the original slug. A handle rename
 * or first handle claim does not change a verified account's retry identity.
 * Slug collisions retry with an incrementing salt. Invalid input, conflicting
 * retries and storage failures return null.
 */
export async function createCrawlStory(
  input: CreateCrawlStoryInput,
): Promise<{ slug: string; authorHandle: string | null } | null> {
  const title = clampText(input.title, MAX_TITLE);
  if (!title) return null; // a story with no title has no name to slug or show
  const summary = clampText(input.summary, MAX_SUMMARY);
  const visibility = cleanVisibility(input.visibility);
  const vibeTags = cleanVibeTags(input.vibeTags);
  const stopsInput = normaliseStops(input.stops);
  if (stopsInput.length === 0) return null; // a crawl needs at least one stop

  const stopIds = stopsInput.map((s) => s.venueId);
  const createdAt = new Date().toISOString();
  const authorHandle = normalizeHandle(input.authorHandle ?? "") || null;
  let authorId: string | null = null;
  if (authorHandle && input.authorUserId) {
    try {
      const profile = await profileStore().getByHandle(authorHandle);
      if (!profile || profile.userId !== input.authorUserId) return null;
      authorId = profile.id;
    } catch { return null; }
  }
  const requestKey = input.requestKey ?? randomUUID();
  const requestHash = createHash("sha256").update(JSON.stringify({ title, summary, visibility, vibeTags, authorUserId: input.authorUserId ?? null, authorHandle: input.authorUserId ? null : authorHandle, stopsInput })).digest("hex");

  return isSupabaseConfigured()
    ? createInSupabase({ title, summary, visibility, vibeTags, authorHandle, authorId, requestKey, requestHash, stopsInput, stopIds, createdAt })
    : createInMemory({ title, summary, visibility, vibeTags, authorHandle, authorId, requestKey, requestHash, stopsInput, stopIds, createdAt });
}

type CreateParts = {
  title: string;
  summary: string;
  visibility: StoryVisibility;
  vibeTags: string[];
  authorHandle: string | null;
  authorId: string | null;
  requestKey: string;
  requestHash: string;
  stopsInput: Array<{ venueId: string; note?: string; priceGbp: number | null }>;
  stopIds: string[];
  createdAt: string;
};

function toStored(parts: CreateParts, slug: string): StoredStory {
  return {
    slug,
    title: parts.title,
    summary: parts.summary,
    visibility: parts.visibility,
    vibeTags: parts.vibeTags,
    authorHandle: parts.authorHandle,
    authorId: parts.authorId,
    requestKey: parts.requestKey,
    requestHash: parts.requestHash,
    stops: parts.stopsInput.map((stop, index) => ({
      venueId: stop.venueId,
      priceGbp: stop.priceGbp,
      ...(stop.note ? { note: stop.note } : {}),
      position: index,
    })),
    createdAt: parts.createdAt,
  };
}

function createInMemory(parts: CreateParts): { slug: string; authorHandle: string | null } | null {
  const existing = [...memoryStories.values()].find((story) => story.requestKey === parts.requestKey);
  if (existing) return existing.requestHash === parts.requestHash ? { slug: existing.slug, authorHandle: existing.authorHandle } : null;
  for (let salt = 0; salt < MAX_SLUG_ATTEMPTS; salt += 1) {
    const slug = slugify(parts.title, parts.stopIds, salt);
    if (!memoryStories.has(slug)) {
      memoryStories.set(slug, toStored(parts, slug));
      return { slug, authorHandle: parts.authorHandle };
    }
  }
  return null; // exhausted attempts — astronomically unlikely
}

async function createInSupabase(parts: CreateParts): Promise<{ slug: string; authorHandle: string | null } | null> {
  try {
    for (let salt = 0; salt < MAX_SLUG_ATTEMPTS; salt += 1) {
      const slug = slugify(parts.title, parts.stopIds, salt);
      const stored = toStored(parts, slug);
      const storyRow = toStoryRow(stored);
      const stopRows = stored.stops.map((stop) => ({
        id: randomUUID(),
        crawl_story_id: storyRow.id,
        venue_id: stop.venueId,
        position: stop.position,
        note: stop.note ?? null,
        pint_drop_id: null as string | null,
        arrived_at: null as string | null,
      }));
      const { data, error } = await admin().rpc("save_crawl_story", {
        p_story: { ...storyRow, save_key: parts.requestKey, save_hash: parts.requestHash },
        p_stops: stopRows,
      });
      if (error) {
        if (isUniqueViolation(error)) continue;
        throw new Error(error.message);
      }
      if (typeof data !== "string") throw new Error("Save did not return a slug");
      return { slug: data, authorHandle: parts.authorHandle };
    }
    return null; // exhausted salts
  } catch (err) {
    console.error(
      "[crawl-stories] could not persist story:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Nullable convenience read for metadata and optional content. Use
 * readCrawlStoryBySlug when an unavailable read must remain distinct from a
 * hidden or unknown story. Drafts never leave the public read.
 */
export async function getCrawlStoryBySlug(slug: string): Promise<DurableStory | null> {
  const result = await readCrawlStoryBySlug(slug);
  return result.status === "found" ? result.story : null;
}

type StoryAuthorship = Pick<StoredStory, "authorId" | "authorHandle" | "createdAt">;

function timestampMicros(value: string): number {
  const fraction = /\.(\d+)/.exec(value)?.[1] ?? "";
  return Date.parse(value.replace(/\.\d+/, "")) * 1000 + Number(fraction.padEnd(6, "0").slice(0, 6));
}

async function crawlAuthorScope(profile: ProfileRecord) {
  const windows = (await identityHandleStore().claimWindows(profile.id))
    .filter((window) => window.handle !== profile.handle)
    .map((window) => ({
      handle: normalizeHandle(window.handle),
      claimedAt: window.claimedAt,
      retiredAt: window.retiredAt,
    }));
  return {
    filter: [
      `author_id.eq.${profile.id}`,
      `and(author_id.is.null,author_handle.eq.${profile.handle})`,
      ...windows.map((window) => `and(author_id.is.null,author_handle.eq.${window.handle},created_at.gte.${window.claimedAt}${window.retiredAt === null ? "" : `,created_at.lt.${window.retiredAt}`})`),
    ].join(","),
    owns(story: StoryAuthorship) {
      if (story.authorId) return story.authorId === profile.id;
      if (story.authorHandle === profile.handle) return true;
      const createdAt = timestampMicros(story.createdAt);
      return windows.some((window) => story.authorHandle === window.handle
        && createdAt >= timestampMicros(window.claimedAt)
        && (window.retiredAt === null || createdAt < timestampMicros(window.retiredAt)));
    },
  };
}

async function storyAuthorProfile(story: StoryAuthorship) {
  if (story.authorId) return profileStore().getById(story.authorId);
  if (!story.authorHandle) return null;
  const current = await profileStore().getByHandle(story.authorHandle);
  if (current) return current;
  const profileId = await identityHandleStore().aliasProfileId(story.authorHandle);
  if (!profileId) return null;
  const profile = await profileStore().getById(profileId);
  if (!profile?.userId) return null;
  return (await crawlAuthorScope(profile)).owns(story) ? profile : null;
}

export async function readCrawlStoryBySlug(slug: string): Promise<
  { status: "found"; story: DurableStory } | { status: "absent" } | { status: "unavailable" }
> {
  const key = typeof slug === "string" ? slug.trim() : "";
  if (!key) return { status: "absent" };
  try {
    const stored = isSupabaseConfigured()
      ? await getFromSupabase(key)
      : memoryStories.get(key) ?? null;
    if (!stored || stored.visibility === "draft") return { status: "absent" };
    const profile = await storyAuthorProfile(stored);
    if (stored.authorId && !profile) return { status: "absent" };
    const authorHandle = profile?.handle ?? stored.authorHandle;
    if (authorHandle && (await withdrawnHandles([authorHandle])).size > 0) {
      return { status: "absent" };
    }
    return { status: "found", story: await enrich({ ...stored, authorHandle, authorId: profile?.userId ? profile.id : null }) };
  } catch (err) {
    console.error("[crawl-stories] could not read story by slug:", err instanceof Error ? err.message : err);
    return { status: "unavailable" };
  }
}

/** Stop counts for crawl_story rows — stops live in crawl_story_stops, not on
 *  stories. A read that could not run answers null (an unknown count), never an
 *  empty map: a zero here would be a false claim about a crawl that has stops,
 *  and dropping the crawls the story read already returned would be worse. */
async function stopCountsForStoryIds(storyIds: string[]): Promise<Map<string, number> | null> {
  const counts = new Map<string, number>();
  if (storyIds.length === 0) return counts;
  try {
    const { data, error } = await admin()
      .from(STOPS_TABLE)
      .select("crawl_story_id")
      .in("crawl_story_id", storyIds);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const record = row as { crawl_story_id?: unknown };
      const id = String(record.crawl_story_id ?? "");
      if (!id) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  } catch (err) {
    console.warn(
      "[crawl-stories] could not count stops for author crawls:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

async function getFromSupabase(slug: string): Promise<StoredStory | null> {
  const { data, error } = await admin()
    .from(STORIES_TABLE)
    .select("*")
    .eq("slug", slug)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const head = fromStoryRow(data as Record<string, unknown>);
  // A draft is private — don't even fetch its stops.
  if (head.visibility === "draft") {
    return { ...head, stops: [] };
  }
  const { data: stopRows, error: stopsError } = await admin()
    .from(STOPS_TABLE)
    .select("*")
    .eq("crawl_story_id", (data as { id: string }).id)
    .order("position", { ascending: true });
  if (stopsError) throw new Error(stopsError.message);
  const stops = (stopRows ?? []).map((row, index) => {
    const r = row as Record<string, unknown>;
    return {
      venueId: String(r.venue_id ?? ""),
      note: r.note ? String(r.note) : undefined,
      priceGbp: null as number | null, // price lives on the linked pint_drop, not the stop
      position: r.position === null || r.position === undefined ? index : Number(r.position),
    };
  });
  return { ...head, stops };
}

// ── Authorship: attribution + edit/delete (story 35) ──────────────────────────

/** The author's current handle when ownership resolves, otherwise its stored
 *  attribution or null. A missing profile for an author ID returns null.
 *  Reads a draft's author too (the gate must work before a story is published).
 *  Never throws — a storage miss resolves to null. */
export async function getStoryAuthor(slug: string): Promise<string | null> {
  const key = typeof slug === "string" ? slug.trim() : "";
  if (!key) return null;
  try {
    let stored: StoryAuthorship | null;
    if (isSupabaseConfigured()) {
      const { data, error } = await admin()
        .from(STORIES_TABLE)
        .select("author_id,author_handle,created_at")
        .eq("slug", key)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      stored = fromStoryRow(data as Record<string, unknown>);
    } else {
      stored = memoryStories.get(key) ?? null;
    }
    if (!stored) return null;
    const profile = await storyAuthorProfile(stored);
    return profile?.handle ?? (stored.authorId ? null : stored.authorHandle);
  } catch { return null; }
}

// The page bounds live in one import-free leaf module so the route parsing
// `?limit=`, the query applying it and the browser paging through it cannot
// drift; re-exported here because the store is where a server caller looks.
export {
  clampAuthorCrawlListLimit,
};

/** One public crawl by a handle, in the shape a profile row needs. `stops` is
 *  TRI-STATE by way of null: a stop count we could not read is unknown, so the
 *  row still opens and simply prints no number. */
type AuthoredCrawlSummary = {
  slug: string;
  title: string;
  stops: number | null;
  createdAt: string;
};

/**
 * Rows and their total come from one query so they cannot disagree about the
 * author's crawls under the requested visibility.
 *
 * `status: "unavailable"` marks a failed read. Its empty rows and null total do
 * not confirm that the author has no crawls.
 */
export type AuthoredCrawlPage = {
  status?: "unavailable";
  crawls: AuthoredCrawlSummary[];
  total: number | null;
};

/**
 * ONE query behind every author lane, keyed on the visibility it is allowed to
 * name. The public listing and the owner's unlisted listing differ by that one
 * value and nothing else, so the row shape, the stop counts, the ordering and
 * the tri-state total cannot drift between them.
 */
async function listCrawlPageByVisibility(
  handle: string,
  visibility: StoryVisibility,
  limit: number,
): Promise<AuthoredCrawlPage> {
  const author = normalizeHandle(handle ?? "");
  if (!author) return { crawls: [], total: 0 };
  const bounded = clampAuthorCrawlListLimit(limit);
  if (isSupabaseConfigured()) {
    try {
      const profile = await profileStore().getByHandle(author);
      if (!profile?.userId) return { crawls: [], total: 0 };
      const scope = await crawlAuthorScope(profile);
      const query = admin()
        .from(STORIES_TABLE)
        .select("id,slug,title,created_at", { count: "exact" })
        .or(scope.filter);
      const { data, count, error } = await query
        .eq("visibility", visibility)
        .order("created_at", { ascending: false })
        .limit(bounded);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      const storyIds = rows
        .map((row) => String(row.id ?? ""))
        .filter((id) => id.length > 0);
      const stopCounts = await stopCountsForStoryIds(storyIds);
      const crawls = rows
        .map((record) => {
          const id = String(record.id ?? "");
          return {
            slug: String(record.slug ?? ""),
            title: String(record.title ?? ""),
            stops: stopCounts ? stopCounts.get(id) ?? 0 : null,
            createdAt: String(record.created_at ?? ""),
          };
        })
        .filter((row) => row.slug && row.title);
      // A page that came back full but carried no count is still an answer about
      // the rows; the total alone is what could not be measured.
      const total = typeof count === "number" && count >= 0 ? count : null;
      return { crawls, total };
    } catch (err) {
      console.error(
        "[crawl-stories] could not list stories by author:",
        err instanceof Error ? err.message : err,
      );
      return { status: "unavailable", crawls: [], total: null };
    }
  }
  const profile = await profileStore().getByHandle(author);
  if (!profile?.userId) return { crawls: [], total: 0 };
  const scope = await crawlAuthorScope(profile);
  const matching = [...memoryStories.values()]
    .filter((story) => scope.owns(story) && story.visibility === visibility)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return {
    total: matching.length,
    crawls: matching.slice(0, bounded).map((story) => ({
      slug: story.slug,
      title: story.title,
      stops: Array.isArray(story.stops) ? story.stops.length : 0,
      createdAt: String(story.createdAt ?? ""),
    })),
  };
}

/**
 * The PUBLIC crawls a handle wrote — visibility `public` only. `unlisted` is a
 * direct-link crawl and never joins a public author listing; `draft` never
 * leaves the author's own hands. The profile's Crawls tile links to the section
 * this list renders, so the number beside it comes back on this same read.
 */
export async function listAuthoredCrawlPage(
  handle: string,
  limit: number = AUTHOR_CRAWL_LIST_DEFAULT_LIMIT,
): Promise<AuthoredCrawlPage> {
  try {
    if ((await withdrawnHandles([handle])).size > 0) return { crawls: [], total: 0 };
  } catch {
    return { status: "unavailable", crawls: [], total: null };
  }
  return listCrawlPageByVisibility(handle, "public", limit);
}

/**
 * The UNLISTED crawls a handle wrote, which only its owner may see. An unlisted
 * crawl is published, so it belongs in the owner's own tally; it is a direct
 * link, so it may never join the public listing. The route hands this lane to
 * the verified owner alone, and it returns ROWS rather than a bare number
 * because a figure an owner cannot open is a dead end wearing a count.
 */
export async function listOwnUnlistedCrawlPage(
  handle: string,
  limit: number = AUTHOR_CRAWL_LIST_MAX_LIMIT,
): Promise<AuthoredCrawlPage> {
  return listCrawlPageByVisibility(handle, "unlisted", limit);
}

export async function isAuthor(
  slug: string,
  handle: string,
  callerUserId?: string | null,
): Promise<boolean> {
  const claimant = normalizeHandle(handle ?? "");
  if (!claimant) return false;
  try {
    let stored: StoryAuthorship | null;
    if (isSupabaseConfigured()) {
      const { data, error } = await admin().from(STORIES_TABLE).select("author_id,author_handle,created_at").eq("slug", slug).limit(1).maybeSingle();
      if (error || !data) return false;
      stored = fromStoryRow(data as Record<string, unknown>);
    } else {
      stored = memoryStories.get(slug) ?? null;
    }
    if (!stored) return false;
    const profile = await storyAuthorProfile(stored);
    return Boolean(profile && profile.handle === claimant && callerUserId && profile.userId === callerUserId);
  } catch { return false; }
}

/** Delete a story (and its stops via ON DELETE CASCADE) IFF `handle` is the
 *  author. Returns true when a row was removed; false on a not-author / unknown
 *  slug. The route has already 403'd a non-author; this re-checks as defence in
 *  depth so the store method is safe called directly. */
export async function deleteCrawlStory(
  slug: string,
  handle: string,
  callerUserId?: string | null,
): Promise<boolean> {
  const key = typeof slug === "string" ? slug.trim() : "";
  if (!key) return false;
  if (!(await isAuthor(key, handle, callerUserId))) return false;
  if (isSupabaseConfigured()) {
    try {
      const { error } = await admin().from(STORIES_TABLE).delete().eq("slug", key);
      if (error) throw new Error(error.message);
      return true;
    } catch (err) {
      console.error(
        "[crawl-stories] could not delete story:",
        err instanceof Error ? err.message : err,
      );
      return false;
    }
  }
  return memoryStories.delete(key);
}

/** The patch an author may apply to a story's head fields. Stops are immutable
 *  here (editing the route is a bigger operation left for later). */
export type CrawlStoryPatch = {
  title?: string;
  summary?: string;
  visibility?: StoryVisibility;
};

/** Update a story's head fields IFF `handle` is the author. Returns the fresh
 *  DurableStory (or null on not-author / unknown slug / failure). */
export async function updateCrawlStory(
  slug: string,
  handle: string,
  patch: CrawlStoryPatch,
  callerUserId?: string | null,
): Promise<DurableStory | null> {
  const key = typeof slug === "string" ? slug.trim() : "";
  if (!key) return null;
  if (!(await isAuthor(key, handle, callerUserId))) return null;

  const next: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const title = clampText(patch.title, MAX_TITLE);
    if (!title) return null; // a title can't be cleared
    next.title = title;
  }
  if (patch.summary !== undefined) next.summary = clampText(patch.summary, MAX_SUMMARY);
  if (patch.visibility !== undefined) next.visibility = cleanVisibility(patch.visibility);
  if (Object.keys(next).length === 0) return getCrawlStoryBySlug(key);

  if (isSupabaseConfigured()) {
    try {
      const { error } = await admin()
        .from(STORIES_TABLE)
        .update({ ...next, updated_at: new Date().toISOString() })
        .eq("slug", key);
      if (error) throw new Error(error.message);
    } catch (err) {
      console.error(
        "[crawl-stories] could not update story:",
        err instanceof Error ? err.message : err,
      );
      return null;
    }
    return getCrawlStoryBySlug(key);
  }

  const stored = memoryStories.get(key);
  if (!stored) return null;
  if (typeof next.title === "string") stored.title = next.title;
  if (typeof next.summary === "string") stored.summary = next.summary;
  if (typeof next.visibility === "string") stored.visibility = next.visibility as StoryVisibility;
  memoryStories.set(key, stored);
  return getCrawlStoryBySlug(key);
}
