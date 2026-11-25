// Durable Crawl Story write/read endpoint. POST persists a story and returns a
// stable slug (/crawls/[slug]); GET ?slug= reads one back for a client that
// wants JSON. The anonymous `?s=` encoded path (lib/crawlStory.ts) is untouched
// and remains the no-DB fallback — this route is purely the "give me a permanent
// link" upgrade. Every field is a trust boundary: the store re-clamps too, but
// we cap lengths / clamp counts / allowlist here so junk never reaches it.

import {
  clampAuthorCrawlListLimit,
  cleanCrawlStopPrice,
  listAuthoredCrawlPage,
  listOwnUnlistedCrawlPage,
  createCrawlStory,
  readCrawlStoryBySlug,
  getStoryAuthor,
  cleanVisibility,
  type CreateCrawlStoryInput,
  type AuthoredCrawlPage,
} from "@/lib/crawlStoryStore";
import { authUnavailableError, publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { AUTH_ACCOUNT_BANNED_MESSAGE } from "@/lib/authAccountBan";
import { callerUserId, verifyCallerAuth } from "@/lib/authServer";
import { jsonNoStore } from "@/lib/apiResponses";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { emitNotification } from "@/lib/notificationsStore";
import { isLimited } from "@/lib/pintDrops";
import { HANDLE_MAX } from "@/lib/handleNormalize";
import { normalizeHandle } from "@/lib/profiles";
import { gateHandleAction } from "@/lib/profileOwnership";
import { profileStore } from "@/lib/profileStore";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { lookupCanonicalVenue } from "@/lib/venueIndex";
import { isPubVenueKind } from "@/lib/venueKindFilters";

assertServerEnv();

const MAX_TITLE = 120;
const MAX_SUMMARY = 280;
const MAX_NOTE = 160;
const MAX_VENUE_ID = 80;
const MAX_STOPS = 12;

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
    stops.push({
      venueId,
      ...(note ? { note } : {}),
      // The store's own rule, so the age gate below sees exactly the prices
      // the store would keep: a figure it would drop is not a price submission.
      priceGbp: cleanCrawlStopPrice(record.priceGbp ?? record.price ?? record.p),
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

function crawlSaveAuthError(
  request: Request,
  verification: Awaited<ReturnType<typeof verifyCallerAuth>>,
): Response | null {
  if (verification.status === "unavailable") return authUnavailableError();
  if (verification.status === "banned") {
    return publicApiError(AUTH_ACCOUNT_BANNED_MESSAGE, "ACCOUNT_BANNED", 403);
  }
  if (
    verification.status === "invalid" ||
    (verification.status === "absent" && request.headers.has("authorization"))
  ) {
    return publicApiError("Sign in to save this crawl.", "UNAUTHENTICATED", 401);
  }
  return null;
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  if (!body || typeof body !== "object") {
    return publicApiError("Missing submission body.", "INVALID_REQUEST", 400);
  }

  const title = readString(body.title, MAX_TITLE);
  if (!title) {
    return publicApiError("Add a crawl title.", "INVALID_REQUEST", 400);
  }

  const stops = readStops(body.stops);
  if (stops.length === 0) {
    return publicApiError("A crawl needs at least one stop.", "INVALID_REQUEST", 400);
  }
  // A STOP PRICE IS A PRICE SUBMISSION. Privacy and Terms promise that a price
  // needs a signed-in account, a claimed handle and an 18+ answer, so a crawl
  // that carries one asks the price door's own question and spends its own
  // refusal body, which ContributionGateDialog already answers. Unpriced saves
  // still require the authentication checks below.
  if (stops.some((stop) => stop.priceGbp !== null)) {
    const contributor = await resolveContributionIdentity(request);
    if (!contributor.ok) {
      return jsonNoStore(contributor.body, { status: contributor.httpStatus });
    }
  }
  const venueLookups = await Promise.all(
    stops.map(async (stop) => ({ stop, lookup: await lookupCanonicalVenue(stop.venueId) })),
  );
  if (venueLookups.some(({ lookup }) => lookup.status === "unavailable")) {
    return publicApiError("Venue list is unavailable right now, try again shortly.", "UNAVAILABLE", 503, { retryable: true });
  }
  if (
    venueLookups.some(
      ({ lookup }) => lookup.status !== "found" || !isPubVenueKind(lookup.venue.kind),
    )
  ) {
    return publicApiError("Every crawl stop must be a pub from the map.", "INVALID_REQUEST", 400);
  }
  const canonicalStops = venueLookups.map(({ stop, lookup }) => ({
    ...stop,
    venueId: lookup.canonicalId,
  }));

  // Rate-limit by hashed IP (no handle on a crawl story). Durable when Supabase
  // is configured, in-memory fallback otherwise — fail-open, mirroring pint-drops.
  const ipKey = hashIp(clientIp(request));
  if (await isLimited(`crawl:${ipKey}`, `crawl:${ipKey}`)) {
    return publicApiError("Too many crawls saved, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  // The verified account supplies its current handle even when the body omits it.
  // Authentication failures must not silently turn its save into an anonymous one.
  const assertedAuthor = readString(body.authorHandle ?? body.handle, HANDLE_MAX);
  const verification = await verifyCallerAuth(request);
  const authError = crawlSaveAuthError(request, verification);
  if (authError) return authError;
  const caller = verification.status === "verified" ? verification.identity.id : null;
  let authorHandle = "";
  if (caller) {
    try {
      authorHandle = (await profileStore().getByUserId(caller))?.handle ?? "";
    } catch {
      return publicApiError("Could not check your handle. Try again.", "STORE_UNAVAILABLE", 503, { retryable: true });
    }
  }
  if (!authorHandle && assertedAuthor) {
    authorHandle = await resolveMessageHandle(request, assertedAuthor, caller);
    if (!authorHandle) {
      return publicApiError("Add a handle first.", "INVALID_REQUEST", 400);
    }
  }
  if (authorHandle) {
    const ownership = await gateHandleAction(request, authorHandle, caller);
    if (!ownership.allowed) {
      return publicApiErrorFromStatus(ownership.error, ownership.status);
    }
    authorHandle = ownership.handle;
  }

  const requestKey = request.headers.get("idempotency-key");
  if (requestKey && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestKey)) {
    return publicApiError("Invalid save key.", "INVALID_REQUEST", 400);
  }
  const input: CreateCrawlStoryInput = {
    title,
    summary: readString(body.summary ?? body.caption, MAX_SUMMARY),
    visibility: cleanVisibility(body.visibility),
    vibeTags: readVibeTags(body.vibeTags),
    ...(authorHandle ? { authorHandle } : {}),
    ...(caller ? { authorUserId: caller } : {}),
    ...(requestKey ? { requestKey } : {}),
    stops: canonicalStops,
  };

  const result = await createCrawlStory(input);
  if (!result) {
    return publicApiError("Could not save this crawl right now.", "UNAVAILABLE", 503, { retryable: true });
  }

  // crawl_save emit seam (story 34, best-effort): when a viewer saves a crawl that
  // was ORIGINALLY authored by someone else (`savedFromSlug` points at the source
  // story), notify that source author their crawl was saved. On a plain first-time
  // save there is no source author, so nothing is emitted. Never awaited — a
  // notification failure must not fail the crawl save.
  const savedFromSlug = readString(body.savedFromSlug, 120);
  if (savedFromSlug && authorHandle) {
    void getStoryAuthor(savedFromSlug)
      .then((sourceAuthor) => {
        if (!sourceAuthor) return;
        return emitNotification({
          recipientHandle: sourceAuthor,
          actorHandle: authorHandle,
          kind: "crawl_save",
          subjectRef: result.slug,
          subjectLabel: title,
        });
      })
      .catch(() => {});
  }

  return jsonNoStore({ slug: result.slug }, { status: 201 });
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  // ?author=<handle> — one page of a handle's PUBLIC crawls plus how many there
  // are in total, from ONE read so the two can never contradict each other.
  // Powers the Crawls tile and the section it opens on /u/[handle] (a client
  // component that can't import the server store directly).
  //
  // `count`/`total` are TRI-STATE by way of null and `status` says which answer
  // this is. `degraded` means the COUNT could not be measured, rows or no rows:
  // a query that returned its page without a count header is still an answer
  // about those rows. What may never happen is a confident 0 above a list of
  // crawls.
  //
  // `?scope=own` additionally answers the owner's UNLISTED crawls - the rows,
  // their whole total, whether the page is short of it, plus the published tally
  // the two lanes add up to. It is handed ONLY
  // to the verified owner of the handle, because an unlisted crawl is a
  // direct-link crawl and which ones somebody has is theirs to know. Rows
  // rather than a bare number, so the figure on their own passport opens
  // something.
  const author = params.get("author");
  if (author !== null) {
    const handle = normalizeHandle(readString(author, HANDLE_MAX));
    const limit = clampAuthorCrawlListLimit(params.get("limit"));
    const page: AuthoredCrawlPage = handle
      ? await listAuthoredCrawlPage(handle, limit)
      : { crawls: [], total: 0 };
    if (page.status === "unavailable") {
      return publicApiError("Crawls are unavailable right now.", "STORE_UNAVAILABLE", 503, { retryable: true });
    }
    const total = page.total;
    const hasMore = total === null ? false : total > page.crawls.length;
    const body: Record<string, unknown> = {
      handle,
      count: total,
      total,
      crawls: page.crawls,
      hasMore,
      status: total === null ? "degraded" : "ready",
    };

    if (handle && params.get("scope") === "own") {
      const userId = await callerUserId(request);
      const linked = userId ? await resolveMessageHandle(request, "", userId) : "";
      if (linked && linked === handle) {
        // Its OWN page bound: the public `?limit=` on this same reply is trimmed
        // by the profile to almost nothing (the cached public read owns those
        // rows), so one number could not size both lanes. Same clamp, so the
        // ceiling cannot drift between them.
        const unlisted = await listOwnUnlistedCrawlPage(
          handle,
          clampAuthorCrawlListLimit(params.get("unlistedLimit")),
        );
        if (unlisted.status === "unavailable") {
          return publicApiError("Crawls are unavailable right now.", "STORE_UNAVAILABLE", 503, { retryable: true });
        }
        body.unlisted = unlisted.crawls;
        body.unlistedTotal = unlisted.total;
        // Says the page is short WITHOUT making the reader compare two figures,
        // and never on the strength of a count that could not be measured.
        body.unlistedHasMore =
          unlisted.total === null ? false : unlisted.total > unlisted.crawls.length;
        // The published tally is DERIVED from the two lanes rather than counted
        // again: visibility is a closed set, so public plus unlisted is exactly
        // "not a draft", and a third query could only disagree with them.
        body.ownCount =
          total === null || unlisted.total === null ? null : total + unlisted.total;
      }
    }

    return jsonNoStore(body, { status: 200 });
  }

  const slug = params.get("slug");
  if (!slug) {
    return publicApiError("Add a slug.", "INVALID_REQUEST", 400);
  }
  const result = await readCrawlStoryBySlug(slug);
  if (result.status === "unavailable") {
    return publicApiError("Crawls are unavailable right now.", "STORE_UNAVAILABLE", 503, { retryable: true });
  }
  if (result.status === "absent") {
    return publicApiError("Crawl story not found.", "NOT_FOUND", 404);
  }
  return jsonNoStore({ story: result.story }, { status: 200 });
}
