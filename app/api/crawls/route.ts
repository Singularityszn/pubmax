// Durable Crawl Story write/read endpoint. POST persists a story and returns a
// stable slug (/crawls/[slug]); GET ?slug= reads one back for a client that
// wants JSON. The anonymous `?s=` encoded path (lib/crawlStory.ts) is untouched
// and remains the no-DB fallback — this route is purely the "give me a permanent
// link" upgrade. Every field is a trust boundary: the store re-clamps too, but
// we cap lengths / clamp counts / allowlist here so junk never reaches it.

import {
  countStoriesByAuthor,
  createCrawlStory,
  getCrawlStoryBySlug,
  getStoryAuthor,
  cleanVisibility,
  type CreateCrawlStoryInput,
} from "@/lib/crawlStoryStore";
import { jsonNoStore } from "@/lib/apiResponses";
import { emitNotification } from "@/lib/notificationsStore";
import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import { gateHandleAction } from "@/lib/profileOwnership";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";

assertServerEnv();

const MAX_TITLE = 120;
const MAX_SUMMARY = 280;
const MAX_NOTE = 160;
const MAX_VENUE_ID = 80;
const MAX_STOPS = 12;
const MAX_HANDLE = 40;

function readString(value: unknown, cap: number): string {
  if (typeof value !== "string") return "";
  // Hold the same write-boundary invariant as lib/textClean.cleanText: strip angle
  // brackets + control chars (so a stored crawl title/summary/note never carries raw
  // markup), collapse whitespace, then cap. Defence-in-depth — every render path
  // already escapes, but no untrusted `<>` should be persisted in the first place.
  return value
    .replace(/[<>]/g, "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, cap)
    .trim();
}

// Coerce an untrusted stops array into the store's stop shape, clamped + capped.
// A stop with no venue id is dropped (nothing to resolve or plan back).
function readStops(value: unknown): CreateCrawlStoryInput["stops"] {
  if (!Array.isArray(value)) return [];
  const stops: CreateCrawlStoryInput["stops"] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    // Accept a few key spellings so a caller can pass either the crawl-story
    // stop shape or a leaner { venueId, note } object.
    const venueId = readString(record.venueId ?? record.id ?? record.venue_id, MAX_VENUE_ID);
    if (!venueId) continue;
    const note = readString(record.note ?? record.m, MAX_NOTE);
    const priceRaw = record.priceGbp ?? record.price ?? record.p;
    stops.push({
      venueId,
      ...(note ? { note } : {}),
      priceGbp:
        priceRaw === undefined || priceRaw === null || priceRaw === ""
          ? null
          : Number(priceRaw),
    });
    if (stops.length >= MAX_STOPS) break;
  }
  return stops;
}

function readVibeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  // The store re-filters to the VIBE_TAGS allowlist; here we just bound the raw
  // count and coerce to strings so a hostile array can't be huge.
  return value.slice(0, 32).filter((v): v is string => typeof v === "string");
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return jsonNoStore({ error: "Missing submission body." }, { status: 400 });
  }

  const title = readString(body.title, MAX_TITLE);
  if (!title) {
    return jsonNoStore({ error: "A crawl title is required." }, { status: 400 });
  }

  const stops = readStops(body.stops);
  if (stops.length === 0) {
    return jsonNoStore({ error: "A crawl needs at least one stop." }, { status: 400 });
  }

  // Rate-limit by hashed IP (no handle on a crawl story). Durable when Supabase
  // is configured, in-memory fallback otherwise — fail-open, mirroring pint-drops.
  const ipKey = hashIp(clientIp(request));
  if (await isLimited(`crawl:${ipKey}`, `crawl:${ipKey}`)) {
    return jsonNoStore({ error: "Too many crawls saved, slow down." }, { status: 429 });
  }

  // Author attribution (story 35): the self-asserted device handle. Optional —
  // an anonymous save leaves it null. Cleaned + normalized before it reaches the
  // store (which re-normalizes as defence in depth).
  const authorHandle = normalizeHandle(readString(body.authorHandle ?? body.handle, MAX_HANDLE));

  if (authorHandle) {
    const ownership = await gateHandleAction(request, authorHandle);
    if (!ownership.allowed) {
      return jsonNoStore({ error: ownership.error }, { status: ownership.status });
    }
  }

  const input: CreateCrawlStoryInput = {
    title,
    summary: readString(body.summary ?? body.caption, MAX_SUMMARY),
    visibility: cleanVisibility(body.visibility),
    vibeTags: readVibeTags(body.vibeTags),
    ...(authorHandle ? { authorHandle } : {}),
    stops,
  };

  const result = await createCrawlStory(input);
  if (!result) {
    return jsonNoStore({ error: "Could not save this crawl right now." }, { status: 503 });
  }

  // crawl_save emit seam (story 34, best-effort): when a viewer saves a crawl that
  // was ORIGINALLY authored by someone else (`savedFromSlug` points at the source
  // story), notify that source author their crawl was saved. On a plain first-time
  // save there is no source author, so nothing is emitted. Never awaited — a
  // notification failure must not fail the crawl save.
  const savedFromSlug = readString(body.savedFromSlug, 120);
  if (savedFromSlug && authorHandle) {
    void getStoryAuthor(savedFromSlug).then((sourceAuthor) => {
      if (!sourceAuthor) return;
      return emitNotification({
        recipientHandle: sourceAuthor,
        actorHandle: authorHandle,
        kind: "crawl_save",
        subjectRef: result.slug,
        subjectLabel: title,
      });
    });
  }

  return jsonNoStore({ slug: result.slug }, { status: 201 });
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  // ?author=<handle> — the published crawl-story count for a handle. Powers the
  // Pint Passport's "story posts" number on /u/[handle] (a client component that
  // can't import the server store directly). Fail-soft: an unknown/blank handle
  // resolves to 0, never an error, so the passport degrades to a clean zero.
  const author = params.get("author");
  if (author !== null) {
    const handle = normalizeHandle(readString(author, MAX_HANDLE));
    const count = handle ? await countStoriesByAuthor(handle) : 0;
    return jsonNoStore({ handle, count }, { status: 200 });
  }

  const slug = params.get("slug");
  if (!slug) {
    return jsonNoStore({ error: "A slug is required." }, { status: 400 });
  }
  const story = await getCrawlStoryBySlug(slug);
  if (!story) {
    return jsonNoStore({ error: "Crawl story not found." }, { status: 404 });
  }
  return jsonNoStore({ story }, { status: 200 });
}
