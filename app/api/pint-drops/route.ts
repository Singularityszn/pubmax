import { isModerator } from "@/lib/adminAuth";
import { callerUserId } from "@/lib/authServer";

// Single write-path seam for community "Pint Drops".
//
// One PintDropStore interface, two implementations (lib/pintDropsStore):
// Supabase (pint_drops + Storage) when env keys exist, process-memory
// otherwise. pintDropsStore() below is the ONLY place the backend is chosen (M4 / PRD
// P2.7); every handler talks to the interface. Validation/provenance/rate-limit
// run before either backend. When Supabase is configured it is the source of
// truth: backend failures return a 503 instead of acknowledging data that
// would only live in process memory.

import { qualifyCheapPintForAccountId } from "@/lib/cheapPintPingQualify.server";
import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { enrichItemsWithAvatarUrls } from "@/lib/avatarResolve";
import { parseCityId } from "@/lib/cities";
import { RECEIPT_REQUIRED_LINE, priceNeedsReceipt } from "@/lib/pintDropReceipt";
import { resolveViewerContextFromRequest } from "@/lib/pintDropViewer";
import { log } from "@/lib/log";
import { LONDON_BOROUGH_NAMES } from "@/lib/londonBoroughNames.mjs";
import type { PintDropConfirmation } from "@/lib/pintDropConfirmationRecord";
import type { PintDropConfirmationOutcome } from "@/lib/pintDropSecondDrinker";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { pintDropReportIdentity } from "@/lib/pintDropReportActor.server";
import {
  isLimited,
  validatePintDrop,
  type PintDropReviewStatus,
  type PintDropStatus,
} from "@/lib/pintDrops";
import {
  isPintDropDailyCapError,
  PhotoRefusalError,
  pintDropsStore,
  type PintDropDTO,
  type PintDropPhotos,
} from "@/lib/pintDropsStore";
import {
  confirmPintDropByModerator,
  runSecondReporterPass,
} from "@/lib/pintDropConfirm.server";
import { gateHandleAction, gateHasVerifiedActor } from "@/lib/profileOwnership";
import { pintDropAuthorityKey } from "@/lib/pintDropAuthority.server";
import { signalPintDropLanded } from "@/lib/pintDropsBroadcast.server";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp, requiresSupabaseStore, isSupabaseConfigured } from "@/lib/supabase";
import { readString } from "@/lib/textClean";
import { loadVenueAliasResolver } from "@/lib/venueAliases";
import { storedVenueName, storedVenueRef } from "@/lib/storedVenueRef";
import { getVenueIndex, lookupCanonicalVenue, venueMapUrl } from "@/lib/venueIndex";
import { isPubVenueKind } from "@/lib/venueKindFilters";

// Fail fast at module load: a misconfigured production deploy (no Supabase)
// would silently fall back to the process-memory store and lose every write on
// the next cold start. In prod that is a FATAL condition — throw here, at import
// time, so the route never comes up half-broken. No-op outside production, where
// the in-memory store is the intended dev/demo backend.
assertServerEnv();

// The friendly label a card shows when an id has no resolvable pub name — kept
// in step with lib/feed.ts VENUE_FALLBACK_LABEL so server and client agree.
const VENUE_FALLBACK_LABEL = "A London pub";

// The daily cap has TWO enforcers and may say ONE thing. The soft pre-check
// reads the rule before the insert; the unique index behind it (migration 0141)
// catches the burst the pre-check cannot see. A drinker turned away by either
// did the same thing, so the sentence lives here once and both sites spend it.
const DAILY_PRICE_CAP_REFUSAL =
  "You've already logged a price here today. You can log one price per pub each day.";

// PRD §9: enrich each public drop with a human `venueName` + a "/map?sel=…"
// `venueMapUrl`, resolved server-side from the bundled venue index, so no public
// feed/profile/permalink card ever surfaces the raw content-hashed `venue-…` id.
// The page shares one memoized index. A drop stored under a merged or
// superseded venue id is answered
// under the id that venue carries now, so its name, its map link and every
// client join on `venueId` find the pub. Never throws: an unreadable index
// yields the friendly fallback for every id, and the drops still render.
async function withVenueNames<T extends { venueId: string }>(
  drops: T[],
): Promise<(T & { venueName: string; venueMapUrl: string; borough?: string })[]> {
  const [index, aliases] = await Promise.all([getVenueIndex(), loadVenueAliasResolver()]);
  return drops.map((drop) => {
    const venueId = aliases.canonical(drop.venueId);
    const venue = storedVenueRef(index, aliases, venueId);
    const borough = index.get(venueId)?.borough;
    return {
      ...drop,
      venueId,
      venueName: venue ? storedVenueName(venue) : VENUE_FALLBACK_LABEL,
      venueMapUrl: venueMapUrl(venueId),
      ...(borough && LONDON_BOROUGH_NAMES.includes(borough) ? { borough } : {}),
    };
  });
}

// Resolve the requester's verified viewer identity for friends-gated reads
// (issue #29). JWT → profiles.user_id → handle is authoritative; ?viewer= is
// a dev/test fallback only (see resolveViewerContextFromRequest).
async function resolveViewer(request: Request): Promise<Awaited<ReturnType<typeof resolveViewerContextFromRequest>>> {
  const params = new URL(request.url).searchParams;
  try {
    return await resolveViewerContextFromRequest(
      request,
      params.get("viewer") ?? params.get("handle"),
    );
  } catch (err) {
    log("warn", "pint_drops.viewer_follow_lookup_failed", {
      route: "GET /api/pint-drops",
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

const STORAGE_UNCONFIGURED_ERROR =
  "Pint Drop production storage is not configured.";

function productionStorageUnavailable(): Response | null {
  return requiresSupabaseStore() && !isSupabaseConfigured()
    ? publicApiError(STORAGE_UNCONFIGURED_ERROR, "UNAVAILABLE", 503, { retryable: true })
    : null;
}

function storageUnavailable(): Response {
  return publicApiError("Pint Drop storage is unavailable.", "STORE_UNAVAILABLE", 503, { retryable: true });
}

function notFound(): Response {
  return publicApiError("Pint Drop not found.", "NOT_FOUND", 404);
}

function ok(): Response {
  return jsonNoStore({ ok: true }, { status: 200 });
}

function forbidden(): Response {
  return publicApiError("Not authorised.", "FORBIDDEN", 403);
}

// Parse either a JSON body or a multipart form. For multipart we pull the text
// fields into a plain object (validatePintDrop cleans them) and keep the photo
// Files aside. JSON bodies carry no photos. Returns null on a malformed body.
async function parseBody(
  request: Request,
): Promise<{ fields: Record<string, unknown>; photos: PintDropPhotos } | null> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    try {
      const form = await request.formData();
      const fields: Record<string, unknown> = {};
      const photos: PintDropPhotos = { pint: null, venue: null, receipt: null };
      // Vibe tags arrive as a form field: either repeated `vibe_tags` entries or
      // one comma-separated value. Collect into an array; validatePintDrop re-
      // filters against the server allowlist (the client value is never trusted).
      const vibeTags: string[] = [];
      for (const [k, v] of form.entries()) {
        if (k === "pint_photo" && v instanceof File && v.size > 0) photos.pint = v;
        else if (k === "venue_photo" && v instanceof File && v.size > 0) photos.venue = v;
        else if (k === "receipt_photo" && v instanceof File && v.size > 0) photos.receipt = v;
        else if (k === "vibe_tags" && typeof v === "string") {
          vibeTags.push(...v.split(",").map((t) => t.trim()).filter(Boolean));
        } else if (typeof v === "string") fields[k] = v;
      }
      if (vibeTags.length) fields.vibeTags = vibeTags;
      return { fields, photos };
    } catch (err) {
      // Malformed multipart body (bad/missing boundary, truncated body) — the
      // caller turns this into a 400, same as a malformed JSON body below.
      log("warn", "pint_drops.malformed_body", {
        route: "POST /api/pint-drops",
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
  try {
    return {
      fields: (await request.json()) as Record<string, unknown>,
      photos: { pint: null, venue: null, receipt: null },
    };
  } catch (err) {
    // Malformed JSON body — the caller turns this into a 400. Log the parse
    // failure (message only, never the raw body) so a spike in bad requests is
    // visible instead of silently swallowed.
    log("warn", "pint_drops.malformed_body", {
      route: "POST /api/pint-drops",
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function validateCanonicalPintDrop(fields: Record<string, unknown>) {
  const result = validatePintDrop(fields);
  if (!result.ok) {
    return {
      ok: false,
      response: publicApiError(result.error, "INVALID_REQUEST", 400),
    } as const;
  }

  const venueLookup = await lookupCanonicalVenue(result.value.venueId);
  if (venueLookup.status === "unavailable") {
    return {
      ok: false,
      response: publicApiError("Venue list is unavailable right now, try again shortly.", "UNAVAILABLE", 503, { retryable: true }),
    } as const;
  }
  if (venueLookup.status !== "found" || !isPubVenueKind(venueLookup.venue.kind)) {
    return {
      ok: false,
      response: publicApiError("Pick a pub from the map.", "INVALID_REQUEST", 400),
    } as const;
  }

  return {
    ok: true,
    value: {
      ...result.value,
      venueId: venueLookup.canonicalId,
    },
  } as const;
}

async function handleReportAction(
  request: Request,
  fields: Record<string, unknown>,
): Promise<Response> {
  const id = readString(fields.id);
  if (!id) return notFound();
  const identity = await pintDropReportIdentity(request);
  const reportPerActorLimit = 1;
  if (
    (await isLimited(`report:${id}`, `report:${id}`)) ||
    (await isLimited(
      `report:${id}:${identity.actorHash}`,
      `report:${id}:${identity.actorHash}`,
      reportPerActorLimit,
    ))
  ) {
    return publicApiError("Too many reports, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }
  const unavailable = productionStorageUnavailable();
  if (unavailable) return unavailable;
  try {
    return (await pintDropsStore().report(id, readString(fields.reason), identity))
      ? ok()
      : notFound();
  } catch (err) {
    log("error", "pint_drops.report_failed", {
      route: "POST /api/pint-drops",
      action: "report",
      error: err instanceof Error ? err.message : String(err),
    });
    return storageUnavailable();
  }
}

async function handleModeratorConfirmAction(
  request: Request,
  fields: Record<string, unknown>,
): Promise<Response> {
  if (!isModerator(request)) return forbidden();
  const id = readString(fields.id);
  if (!id) return notFound();
  const unavailable = productionStorageUnavailable();
  if (unavailable) return unavailable;
  try {
    const confirmation = await confirmPintDropByModerator(id);
    // Null is not an error: an unknown id and a drop that already carries a
    // live confirmation both mean the queue has nothing left to decide here.
    // Answering the confirmation on record keeps the moderator's view honest
    // rather than pretending this call minted it.
    if (confirmation) {
      return jsonNoStore({ ok: true, confirmation }, { status: 200 });
    }
    return publicApiError(
      "Nothing to confirm. We don't know this Pint Drop, or it's already confirmed.",
      "CONFLICT",
      409,
    );
  } catch (err) {
    log("error", "pint_drops.confirm_failed", {
      route: "POST /api/pint-drops",
      action: "confirm",
      error: err instanceof Error ? err.message : String(err),
    });
    return storageUnavailable();
  }
}

async function handleModeratorAction(
  request: Request,
  fields: Record<string, unknown>,
): Promise<Response> {
  if (!isModerator(request)) return forbidden();
  const id = readString(fields.id);
  if (!id) return notFound();
  const status: PintDropStatus = fields.action === "restore" ? "visible" : "hidden";
  const unavailable = productionStorageUnavailable();
  if (unavailable) return unavailable;
  try {
    return (await pintDropsStore().moderate(id, status, readString(fields.note)))
      ? ok()
      : notFound();
  } catch (err) {
    log("error", "pint_drops.moderate_failed", {
      route: "POST /api/pint-drops",
      action: fields.action === "restore" ? "restore" : "keep_hidden",
      error: err instanceof Error ? err.message : String(err),
    });
    return storageUnavailable();
  }
}

/**
 * The second-reporter pass after a drop lands, awaited so the drinker's own
 * answer carries the standing their report just earned. It never throws and
 * never fails the drop. The answer NAMES what the pass found
 * (lib/pintDropSecondDrinker.ts), so a drinker repeating their own report is
 * told so, and a retry after a mint reads the confirmation on file rather than
 * minting a second. That `same_reporter` answer is a sentence about THIS
 * caller, so their own authority key rides in with it (battle test D08):
 * without it the reading was venue-wide and named the outcome over anybody's
 * repeated pair, whoever had just written. Only a priced drop can complete a pair. The row was read
 * back before the pass ran, so when this drop is one of the pair its own
 * answer is stamped with the record it just earned.
 */
async function settleConfirmation(
  drop: PintDropDTO,
  priceGbp: number | null,
  callerAuthorityKey: string | undefined,
): Promise<{
  confirmation: PintDropConfirmation | null;
  confirmationOutcome: PintDropConfirmationOutcome | null;
}> {
  if (priceGbp === null) return { confirmation: null, confirmationOutcome: null };
  const confirmationOutcome = await runSecondReporterPass(
    drop.venueId,
    Date.now(),
    callerAuthorityKey,
  );
  if (confirmationOutcome.status !== "confirmed") {
    return { confirmation: null, confirmationOutcome };
  }
  if (confirmationOutcome.dropIds.includes(drop.id)) {
    drop.confirmation = confirmationOutcome.confirmation;
  }
  return { confirmation: confirmationOutcome.confirmation, confirmationOutcome };
}

export async function POST(request: Request): Promise<Response> {
  const parsed = await parseBody(request);
  if (!parsed) {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  const { fields, photos } = parsed;

  // Public moderation: every report is recorded. Only verified account reports
  // count toward REPORT_HIDE_THRESHOLD; anonymous reports go to moderation
  // without auto-hiding the drop.
  if (fields.action === "report") {
    // Rate-limit reports on two axes as FLOOD PROTECTION only:
    //   • per-drop  (`report:<id>`)                — caps total report volume;
    //   • per-actor (`report:<id>:<actorHash>`)    — the SAME actor gets EXACTLY
    //     ONE report per drop per window, so a duplicate is rejected cheaply
    //     here before it touches storage.
    // DURABLE per-account uniqueness lives in the store/RPC layer
    // (report_pint_drop_v2 + the pint_drop_verified_reports unique (pint_drop_id,
    // actor_hash) pair; the in-memory store mirrors it): a same-actor repeat
    // that slips past this window (new window, limiter cold-start/outage) is an
    // idempotent no-op in the store. Anonymous IP hashes record reports and key
    // flood control, but never enter the auto-hide count. The client `actor`
    // field decides nothing.
    return handleReportAction(request, fields);
  }

  // Moderator decisions: restore (→ visible) or keep_hidden (stay hidden). Both
  // stamp moderated_at so the drop leaves the review queue. 403 without a token.
  if (fields.action === "restore" || fields.action === "keep_hidden") {
    return handleModeratorAction(request, fields);
  }

  // A moderator's own confirmation: the second way a Pint Drop earns a green
  // standing when no second reporter has turned up. 403 without a token, and
  // never a route a drinker can reach - a confirmation a reader could mint for
  // their own price is not a confirmation.
  if (fields.action === "confirm") {
    return handleModeratorConfirmAction(request, fields);
  }

  // Solo-operator emergency freeze (U15): dropping a pint is a social write. The
  // `report` and moderator (`restore`/`keep_hidden`) branches return above, so
  // reporting and moderation stay OPEN under a freeze — only creation is paused.
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const unavailable = productionStorageUnavailable();
  if (unavailable) return unavailable;

  const verifiedUserId = await callerUserId(request);
  if (requiresSupabaseStore() && !verifiedUserId) {
    return publicApiError(
      "Sign in to post a Pint Drop.",
      "UNAUTHENTICATED",
      401,
    );
  }

  const canonicalResult = await validateCanonicalPintDrop(fields);
  if (!canonicalResult.ok) return canonicalResult.response;
  const canonicalDrop = canonicalResult.value;

  // JWT-linked handle wins over a self-asserted body handle when signed in.
  // Signed-in users must finish handle onboarding. Signed-out requests keep
  // the self-asserted handle only in the keyless local demo path.
  const actorHandle = await resolveMessageHandle(
    request,
    canonicalDrop.handle,
    verifiedUserId,
    { requireLinked: Boolean(verifiedUserId) },
  );
  if (!actorHandle) {
    return verifiedUserId
      ? publicApiError(
          "Choose a PUBMAXX handle before posting.",
          "ONBOARDING_REQUIRED",
          409,
          { compatibilityFields: { status: "onboarding_required" } },
        )
      : publicApiError("Add a handle.", "INVALID_REQUEST", 400);
  }
  const ownership = await gateHandleAction(request, actorHandle, verifiedUserId);
  if (!ownership.allowed) {
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }
  // A PRICE NEEDS A VERIFIED ACTOR. The unlinked demo handle path (profile
  // ownership's `unlinked` lane) allows a write with no signed-in caller, and a
  // priced drop stored through it carries no authority key, so it can never
  // corroborate another drinker's figure at any age however many arrive - a
  // price that cannot earn its standing. Drafting stays open and the invitation
  // is the one the price door already makes; only POSTING the figure is gated.
  // An unpriced note or memory keeps the demo path, because no price lane reads
  // it: every lane in lib/venues.ts filters on a numeric `priceGbp` first.
  if (canonicalDrop.priceGbp !== null && !gateHasVerifiedActor(ownership)) {
    return publicApiError(
      "Sign in to post a price under your name.",
      "UNAUTHENTICATED",
      401,
    );
  }
  // AND A PRICE COMES WITH THE BILL (captain 7 Sept 2026). Asked before the
  // rate limit and the daily cap, so a refusal spends neither. An unpriced
  // drop - a note, a memory, a photo of the pub - is asked for nothing, for
  // the same reason it keeps the demo path: no price lane reads it.
  if (priceNeedsReceipt(canonicalDrop.priceGbp) && !photos.receipt) {
    return publicApiError(RECEIPT_REQUIRED_LINE, "RECEIPT_REQUIRED", 400);
  }
  const dropPayload = {
    ...canonicalDrop,
    handle: ownership.handle,
    // ANONYMITY IS DISPLAY, NOT ATTRIBUTION (#1436). The key is derived from
    // the signed-in account whatever lane the drinker chose to post in, so an
    // anonymous price can corroborate and be corroborated like any other. Two
    // anonymous drops from ONE account still carry ONE key and count once.
    // Hiding the drinker is the public DTO's job (toDTO), not the key's.
    authorityKey: pintDropAuthorityKey(
      canonicalDrop.venueId,
      ownership.callerUserId,
    ),
  };

  // Durable key = handle + hashed IP (PRD P3.9); in-memory fallback stays
  // keyed on handle alone, exactly as before.
  const submitKey = `drop:${ownership.handle.toLowerCase()}:${hashIp(clientIp(request))}`;
  if (await isLimited(ownership.handle, submitKey)) {
    return publicApiError("Too many submissions, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  // Duplicate guard (feat/price-drops-v2): one PRICED observation per
  // venue+identity+London-day. A second priced drop at the same pub the same day
  // is a 409, not a silent overwrite — the first observation is kept, and one
  // actor can't stack rows to skew a venue's median. Note-only anecdotes are
  // exempt (a passed-down memory isn't a price observation).
  //
  // This is the SOFT pre-check, and it is deliberately fail-open: a store hiccup
  // here must not block an otherwise-good drop. It cannot be the whole rule,
  // because it cannot see a burst: concurrent requests all read "no price yet"
  // before any row lands, which is exactly how the cap was walked through. The
  // HARD guard is the store's own (pint_drops_priced_day_unique_idx, migration
  // 0141), and its refusal lands in the catch below wearing this same sentence.
  if (dropPayload.priceGbp !== null) {
    try {
      if (await pintDropsStore().hasPricedDropToday(dropPayload.venueId, ownership.handle)) {
        return publicApiError(DAILY_PRICE_CAP_REFUSAL, "CONFLICT", 409);
      }
    } catch (err) {
      log("warn", "pint_drops.dedupe_check_failed", {
        route: "POST /api/pint-drops",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  try {
    // This lane is the one that STATES the daily cap, so it is the one that
    // opts into it: the store then claims the London day for this drop and the
    // unique index behind it (0141) refuses the burst the pre-check above
    // cannot see. The community-price pairing lane writes without this and
    // keeps its own rule.
    const drop = await pintDropsStore().create(dropPayload, photos, {
      underDailyPriceCap: true,
    });
    signalPintDropLanded();
    // The second-reporter pass, awaited so the drinker's own answer carries the
    // standing their report just earned. It never throws and never fails the
    // drop: when it cannot read or write, the pill stays grey and the drop
    // stands. Only a priced drop can complete a pair.
    const { confirmation, confirmationOutcome } = await settleConfirmation(
      drop,
      dropPayload.priceGbp,
      dropPayload.authorityKey,
    );
    if (ownership.callerUserId) {
      void qualifyCheapPintForAccountId(ownership.callerUserId);
    }
    return jsonNoStore(
      {
        drop,
        ...(confirmation ? { confirmation } : {}),
        ...(confirmationOutcome ? { confirmationOutcome } : {}),
      },
      { status: 201 },
    );
  } catch (err) {
    // The daily cap, refused by the database (migration 0141). A drinker who
    // hits the hard guard and one who hits the pre-check above did the same
    // thing, so they are told the same thing: one sentence, one status, no way
    // to tell which enforcer answered.
    if (isPintDropDailyCapError(err)) {
      return publicApiError(DAILY_PRICE_CAP_REFUSAL, "CONFLICT", 409);
    }
    // A REFUSED FILE IS THE DRINKER'S TO FIX, and the CLASS says which one it
    // is. This asked whether the message started with "Photo must", so the one
    // refusal worded differently, the image the normaliser cannot open, fell
    // through to the 503 below and told a drinker to retry bytes that can never
    // work. The store has already cleaned up anything it uploaded (no orphans).
    // We do not log this as an error: it is expected client input, and the
    // store already logged any processing failure (§7.2) at its own boundary.
    if (err instanceof PhotoRefusalError) {
      return publicApiError(err.message, "INVALID_REQUEST", 400);
    }
    // A genuine storage/insert failure — the user gets a 503. Log it (message
    // only) so the outage is observable instead of a silent 503.
    log("error", "pint_drops.create_failed", {
      route: "POST /api/pint-drops",
      error: err instanceof Error ? err.message : String(err),
    });
    return storageUnavailable();
  }
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  // Moderator read: ?status=reported|hidden|pending → the review queue, WITH
  // metadata. `reported` contains visible rows with an unreviewed report.
  const status = params.get("status");
  if (
    status === "reported" ||
    status === "hidden" ||
    status === "pending" ||
    status === "confirmed"
  ) {
    if (!isModerator(request)) return forbidden();
    const unavailable = productionStorageUnavailable();
    if (unavailable) return unavailable;
    try {
      return jsonNoStore({ drops: await pintDropsStore().listForReview(status as PintDropReviewStatus) }, { status: 200 });
    } catch (err) {
      log("error", "pint_drops.list_review_failed", {
        route: "GET /api/pint-drops",
        status,
        error: err instanceof Error ? err.message : String(err),
      });
      return storageUnavailable();
    }
  }

  // Public read: visible drops only, newest-first, hard-capped (MAX_PUBLIC_DROPS),
  // with per-drop VISIBILITY applied server-side (issue #29). The viewer is
  // resolved from a verified JWT when present; ?viewer= is ignored in production.
  const unavailable = productionStorageUnavailable();
  if (unavailable) return unavailable;
  try {
    const viewer = await resolveViewer(request);
    const params = new URL(request.url).searchParams;
    // ?author= scopes the public feed to one handle (passport / profile). Distinct
    // from ?viewer=, which only unlocks the friends visibility lane.
    // ?city= scopes unscoped demo seeds (and organic rows by venue id prefix)
    // so Manchester demo drops never noise the London feed/landing. Defaults
    // to London when omitted or unrecognised.
    const author = params.get("author") ?? undefined;
    const cityId = parseCityId(params.get("city")) ?? undefined;
    const drops = await pintDropsStore().listVisible(
      params.get("venueId") ?? undefined,
      viewer,
      author,
      cityId,
    );
    const enriched = await enrichItemsWithAvatarUrls(await withVenueNames(drops));
    return jsonNoStore({ drops: enriched }, { status: 200 });
  } catch (err) {
    log("error", "pint_drops.list_visible_failed", {
      route: "GET /api/pint-drops",
      error: err instanceof Error ? err.message : String(err),
    });
    return storageUnavailable();
  }
}
