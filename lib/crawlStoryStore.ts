// Durable Crawl Story storage. A Crawl Story can already travel entirely inside a
// `?s=` URL param (lib/crawlStory.ts — anonymous, no DB). This module is the
// OTHER half: persist a story to Supabase so it earns a stable, slug-addressed
// permalink (/crawls/[slug]) that can be indexed, shared, and (later) authored by
// a profile. ONE interface, TWO backends — Supabase (crawl_stories +
// crawl_story_stops) when env keys exist, an in-memory Map otherwise — chosen at
// the single seam below, mirroring lib/pintDropsStore.ts. Reads never throw: a
// storage hiccup degrades to null (→ notFound / friendly empty state), never a
// 500. The anonymous encoded path stays the untouched fallback for people who
// don't want a durable link.

import { createHash, randomUUID } from "node:crypto";

import { totalGbp, VIBE_TAGS, type CrawlStory } from "@/lib/crawlStory";
import { normalizeHandle } from "@/lib/profiles";
import { profileStore } from "@/lib/profileStore";
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";
import { resolveVenue, venueMapUrl } from "@/lib/venueIndex";

// ── Types ────────────────────────────────────────────────────────────────────

// A story's visibility. `draft` is private (there is no auth yet, so a draft has
// no owner who could view it — it is simply never returned by the public read).
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
  // The self-asserted device handle of the author (story 35). Optional — an
  // anonymous save leaves it null. Attribution links to /u/[handle]; edit/delete
  // are gated on this handle at the API seam. TRUE ownership enforcement lands
  // when auth ownership merges (see the seam comment in app/api/crawls/route.ts).
  authorHandle?: string;
  stops: Array<{
    venueId: string;
    note?: string;
    priceGbp?: number | null;
  }>;
};

// One stop as read back for rendering: the raw venue id PLUS the server-resolved
// pub name and map link (venueIndex is server-only — the raw id must never be the
// label the poster shows, PRD §9).
export type DurableStop = {
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
  // The author's self-asserted handle (normalized), or null for an anonymous
  // story. The story page renders it as an attribution linking to /u/[handle].
  authorHandle: string | null;
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

function coercePrice(value: unknown): number | null {
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
      priceGbp: coercePrice(item.priceGbp),
      ...(note ? { note } : {}),
    });
    if (stops.length >= MAX_STOPS) break;
  }
  return stops;
}

// ── Slug generation ──────────────────────────────────────────────────────────

const MAX_SLUG_BASE = 60;

/**
 * Turn a title into a URL-safe, lowercase-kebab slug with a short deterministic
 * suffix for uniqueness. The suffix is derived from a sha256 of the title + the
 * ordered stop venue ids (+ an optional collision "salt"), NOT from Date.now /
 * Math.random — those are unavailable/non-deterministic in some runtimes and
 * would make the slug untestable. Same input → same slug (idempotent), which
 * also makes an accidental double-submit converge on the same permalink; a real
 * collision with different content is handled by createCrawlStory retrying with
 * an incrementing salt.
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
  stops: Array<{ venueId: string; note?: string; priceGbp: number | null; position: number }>;
  createdAt: string;
};

const memoryStories = new Map<string, StoredStory>();

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
        const ref = await resolveVenue(stop.venueId);
        return {
          venueId: stop.venueId,
          venueName: ref?.name ?? "A London pub",
          venueMapUrl: venueMapUrl(stop.venueId),
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
    stops,
    totalGbp: totalGbp(story),
    createdAt: stored.createdAt,
  };
}

// ── Supabase backend helpers ──────────────────────────────────────────────────

const STORIES_TABLE = "crawl_stories";
const STOPS_TABLE = "crawl_story_stops";

function admin() {
  return requireSupabaseAdmin();
}

// A stored story → the crawl_stories row. `author_id` stays NULL until a Supabase
// Auth link exists (a profile-linked author will go here — same reservation as
// profiles.user_id in migration 0006). `author_handle` (migration 0010) carries
// the self-asserted device-handle author today — attribution + the edit/delete
// gate key until real auth ownership merges.
function toStoryRow(story: StoredStory) {
  return {
    id: randomUUID(),
    author_id: null as string | null, // TODO: profile-linked author once auth lands
    author_handle: story.authorHandle,
    title: story.title,
    slug: story.slug,
    summary: story.summary,
    visibility: story.visibility,
    cover_image_url: null as string | null,
    started_at: null as string | null,
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
 * Persist a new Crawl Story and return its slug. Inserts the story row plus its
 * ordered stops. On a slug collision (same stem+hash — rare, but two different
 * stories could hash-collide, or a retry after a partial insert) it regenerates
 * the slug with an incrementing salt and retries. Returns null on a hard failure
 * (bad input, storage down) so the caller can 400/503 rather than crash.
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

  return isSupabaseConfigured()
    ? createInSupabase({ title, summary, visibility, vibeTags, authorHandle, stopsInput, stopIds, createdAt })
    : createInMemory({ title, summary, visibility, vibeTags, authorHandle, stopsInput, stopIds, createdAt });
}

type CreateParts = {
  title: string;
  summary: string;
  visibility: StoryVisibility;
  vibeTags: string[];
  authorHandle: string | null;
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
      const { error } = await admin().from(STORIES_TABLE).insert(storyRow);
      if (error) {
        if (isUniqueViolation(error)) continue; // slug taken — try the next salt
        throw new Error(error.message);
      }
      // Story row landed; insert its ordered stops. A stop insert failure leaves
      // a story with no stops — best-effort cleanup so we don't strand a headless
      // story, then surface the failure as null (route → 503).
      const stopRows = stored.stops.map((stop) => ({
        id: randomUUID(),
        crawl_story_id: storyRow.id,
        venue_id: stop.venueId,
        position: stop.position,
        note: stop.note ?? null,
        pint_drop_id: null as string | null,
        arrived_at: null as string | null,
      }));
      const { error: stopsError } = await admin().from(STOPS_TABLE).insert(stopRows);
      if (stopsError) {
        await admin().from(STORIES_TABLE).delete().eq("id", storyRow.id);
        throw new Error(stopsError.message);
      }
      return { slug, authorHandle: parts.authorHandle };
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
 * Read a durable story by slug, enriched with pub names + map links, or null.
 * A `draft` is treated as private (no auth → no owner who could see it) and
 * returns null, exactly like an unknown slug — so the metadata/route can never
 * leak an unpublished story. Never throws: a storage error resolves to null.
 */
export async function getCrawlStoryBySlug(slug: string): Promise<DurableStory | null> {
  const key = typeof slug === "string" ? slug.trim() : "";
  if (!key) return null;
  const stored = isSupabaseConfigured()
    ? await getFromSupabase(key)
    : memoryStories.get(key) ?? null;
  if (!stored) return null;
  // Drafts are never publicly returned (no auth yet). unlisted + public are.
  if (stored.visibility === "draft") return null;
  return enrich(stored);
}

async function getFromSupabase(slug: string): Promise<StoredStory | null> {
  try {
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
  } catch (err) {
    console.error(
      "[crawl-stories] could not read story by slug:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// ── Authorship: attribution + edit/delete (story 35) ──────────────────────────
//
// AUTHORSHIP ENFORCEMENT SEAM. Today identity is a self-asserted device handle
// (no auth), so `author_handle` is the ONLY thing an edit/delete can be gated on.
// isAuthor(slug, handle) below is that gate; the API route (app/api/crawls/[slug])
// rejects a mismatch with 403. This is a HONEST but WEAK gate — anyone can claim
// any handle until auth ownership merges. When it does: add a recipient/author
// user-id link and change isAuthor to compare auth.uid() ownership (the store
// method signature stays the same, only the comparison hardens). Do NOT loosen
// this to "anyone can edit" — the handle gate is the placeholder for real auth.

/** The author handle registered on a story, or null (anonymous / unknown slug).
 *  Reads a draft's author too (the gate must work before a story is published).
 *  Never throws — a storage miss resolves to null. */
export async function getStoryAuthor(slug: string): Promise<string | null> {
  const key = typeof slug === "string" ? slug.trim() : "";
  if (!key) return null;
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await admin()
        .from(STORIES_TABLE)
        .select("author_handle")
        .eq("slug", key)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return normalizeHandle(String((data as { author_handle?: unknown }).author_handle ?? "")) || null;
    } catch {
      return null;
    }
  }
  return memoryStories.get(key)?.authorHandle ?? null;
}

/** Count the PUBLISHED (public/unlisted — never draft) stories a handle has
 *  authored. Powers the Pint Passport's "story posts" number on /u/[handle]:
 *  attribution is by the self-asserted `author_handle` (story 35), so this is the
 *  same weak-but-honest identity the rest of authorship uses. Never throws — a
 *  storage miss / bad handle resolves to 0 so the passport degrades to a clean
 *  zero rather than a 500. Draft stories don't count (they aren't public posts). */
export async function countStoriesByAuthor(handle: string): Promise<number> {
  const author = normalizeHandle(handle ?? "");
  if (!author) return 0;
  if (isSupabaseConfigured()) {
    try {
      const { count, error } = await admin()
        .from(STORIES_TABLE)
        .select("id", { count: "exact", head: true })
        .eq("author_handle", author)
        .neq("visibility", "draft");
      if (error) throw new Error(error.message);
      return typeof count === "number" && count > 0 ? count : 0;
    } catch (err) {
      console.error(
        "[crawl-stories] could not count stories by author:",
        err instanceof Error ? err.message : err,
      );
      return 0;
    }
  }
  let total = 0;
  for (const story of memoryStories.values()) {
    if (story.authorHandle === author && story.visibility !== "draft") total += 1;
  }
  return total;
}

/** Is `handle` the author of `slug`? False for an anonymous story (no author to
 *  match), an unknown slug, or a mismatch. When the author's handle is linked to
 *  an auth account, `callerUserId` must match that owner (defense in depth —
 *  the API route runs gateHandleAction first). THE edit/delete gate. */
export async function isAuthor(
  slug: string,
  handle: string,
  callerUserId?: string | null,
): Promise<boolean> {
  const claimant = normalizeHandle(handle ?? "");
  if (!claimant) return false;
  const author = await getStoryAuthor(slug);
  if (author === null || author !== claimant) return false;

  try {
    const profile = await profileStore().getByHandle(author);
    const linkedTo = profile?.userId ?? null;
    if (linkedTo) {
      const caller =
        typeof callerUserId === "string" && callerUserId ? callerUserId : null;
      if (!caller || caller !== linkedTo) return false;
    }
  } catch {
    return false;
  }

  return true;
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
