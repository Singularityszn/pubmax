// Pub photo walls: the single write/read seam.
//
//   POST multipart { post: <json>, photo: <file> }  -> 201 { photo, crosspost }
//   POST { action: "report", id, reason? }          -> 200 { ok }   (public)
//   POST { action: "hide" | "restore", id, note? }  -> 200 { ok }   (moderator)
//   GET  ?venueId=...&cursor=&limit=                -> 200 { status, photos, nextCursor }
//   GET  ?status=reported | hidden                  -> 200 { photos } (moderator)
//
// WHO MAY POST: a signed-in account with a claimed public handle that is 18 or
// over. The handle is the wall's byline and the date of birth is the bar's
// door, so both are checked from the SESSION - never from the body, which is
// what would let one origin post as anybody.
//
// WHAT A PHOTO COSTS: one safety scan, which is a paid call to a provider that
// can be spent by anyone with an upload button. So the per-account budget is
// `failClosed` (a limiter we cannot reach refuses rather than waves through),
// and nothing reaches the scan before the cap has been counted.
//
// WHAT THE CAP IS: 100 photos per account per venue, counted in the store
// against that account's own live rows. The composer hides its button at the
// cap as a courtesy; this is the fence.
//
// WHAT A CROSSPOST IS: a separate write to Social, behind Social's own verified
// gate, whose outcome is reported honestly and which can never fail the wall.

import { assertServerEnv } from "@/lib/serverEnv";
import { isModerator } from "@/lib/adminAuth";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { boundedFormData } from "@/lib/boundedRequest.server";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import { log } from "@/lib/log";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isLimited } from "@/lib/pintDrops";
import { privateIdentityStore } from "@/lib/privateIdentityStore";
import { isAdultDateOfBirth } from "@/lib/socialLaunch";
import { clientIp, hashActor, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";
import { crosspostVenuePhotoToFeed } from "@/lib/venuePhotoCrosspost.server";
import {
  createProfileAvatarModerationAdapter,
  ProfileAvatarModerationError,
  type ProfileAvatarModerationAdapter,
} from "@/lib/profileAvatarModeration";
import {
  discardStagedVenuePhoto,
  prepareVenuePhoto,
  promoteStagedVenuePhoto,
  signVenuePhotoObject,
  stagePreparedVenuePhoto,
  supabaseVenuePhotoStorage,
  VENUE_PHOTO_MAX_BYTES,
  VenuePhotoError,
  type StagedVenuePhoto,
  type VenuePhotoStorage,
} from "@/lib/venuePhotoMedia.server";
import {
  VENUE_PHOTO_CAP_PER_ACCOUNT,
  venuePhotoStore,
} from "@/lib/venuePhotoStore";
import {
  validateVenuePhotoSubmission,
  VENUE_PHOTO_REFUSED_LINE,
  venuePhotoServePath,
  type VenuePhotoCrosspost,
} from "@/lib/venuePhotos";

assertServerEnv();

// The three impure things this route reaches for, behind one seam so a test can
// walk the real journey without a bucket, a moderation provider or a feed.
export type VenuePhotoRouteDeps = {
  storage: VenuePhotoStorage;
  moderation: () => ProfileAvatarModerationAdapter;
  crosspost: typeof crosspostVenuePhotoToFeed;
};

export const defaultVenuePhotoRouteDeps: VenuePhotoRouteDeps = {
  storage: supabaseVenuePhotoStorage,
  moderation: () => createProfileAvatarModerationAdapter(),
  crosspost: crosspostVenuePhotoToFeed,
};

let testDeps: Partial<VenuePhotoRouteDeps> | null = null;

export function __setVenuePhotoRouteDepsForTest(
  deps: Partial<VenuePhotoRouteDeps> | null,
): void {
  testDeps = deps;
}

function routeDeps(): VenuePhotoRouteDeps {
  return { ...defaultVenuePhotoRouteDeps, ...testDeps };
}

/** A genuine drinker posts a few photos in a session; more is abuse. */
const UPLOAD_LIMIT = 12;
const UPLOAD_WINDOW_MS = 60 * 60 * 1000;
const REPORT_PER_ACTOR_LIMIT = 1;

function photoError(error: unknown): Response {
  if (error instanceof VenuePhotoError) {
    const status =
      error.code === "TOO_LARGE" ? 413 : error.code === "STORAGE_UNAVAILABLE" ? 503 : 400;
    return publicApiError(error.message, error.code, status, {
      retryable: error.code === "STORAGE_UNAVAILABLE",
    });
  }
  return publicApiError("Photo could not be processed.", "PROCESSING_FAILED", 400);
}

async function parseJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The multipart body a composer sends: one JSON part and one file. */
async function parseUpload(
  request: Request,
): Promise<{ input: unknown; photo: File } | null> {
  try {
    const form = await boundedFormData(request, VENUE_PHOTO_MAX_BYTES + 64 * 1024);
    if ([...form.keys()].some((key) => key !== "post" && key !== "photo")) return null;
    const postParts = form.getAll("post");
    const photoParts = form.getAll("photo");
    if (postParts.length !== 1 || typeof postParts[0] !== "string") return null;
    if (photoParts.length !== 1 || !(photoParts[0] instanceof File)) return null;
    return { input: JSON.parse(postParts[0]), photo: photoParts[0] };
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const contentType = (request.headers.get("Content-Type") ?? "").toLowerCase();

  // ── Reader flag and moderator decisions (JSON) ─────────────────────────────
  if (!contentType.startsWith("multipart/form-data")) {
    const body = await parseJson(request);
    if (!body) return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);

    if (body.action === "report") {
      const id = readString(body.id);
      if (!id) return publicApiError("Photo not found.", "NOT_FOUND", 404);
      // Server-derived reporter, exactly like community prices and Visit
      // Reports: a body token would let one origin mint many reporters.
      const actorHash = hashActor(`venue-photo:${hashIp(clientIp(request))}`);
      const flagKey = `venue-photo-report:${id}`;
      const actorKey = `${flagKey}:${actorHash}`;
      if (
        (await isLimited(flagKey, flagKey)) ||
        (await isLimited(actorKey, actorKey, REPORT_PER_ACTOR_LIMIT))
      ) {
        return publicApiError("Too many reports, slow down.", "RATE_LIMITED", 429, {
          retryable: true,
        });
      }
      try {
        const done = await venuePhotoStore().report(id, readString(body.reason), actorHash);
        return done
          ? jsonNoStore({ ok: true }, { status: 200 })
          : publicApiError("Photo not found.", "NOT_FOUND", 404);
      } catch (err) {
        log("error", "venue_photo.report_failed", {
          route: "POST /api/venue-photos",
          error: err instanceof Error ? err.message : String(err),
        });
        return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, {
          retryable: true,
        });
      }
    }

    if (body.action === "hide" || body.action === "restore") {
      if (!isModerator(request)) return publicApiError("Not authorised.", "FORBIDDEN", 403);
      const id = readString(body.id);
      if (!id) return publicApiError("Photo not found.", "NOT_FOUND", 404);
      try {
        // Hiding never deletes: the row, its bytes and its report trail stay,
        // so the decision is reversible from the surface that made it.
        const done = await venuePhotoStore().moderate(
          id,
          body.action === "hide" ? "hidden" : "approved",
          readString(body.note),
        );
        return done
          ? jsonNoStore({ ok: true }, { status: 200 })
          : publicApiError("Photo not found.", "NOT_FOUND", 404);
      } catch (err) {
        log("error", "venue_photo.moderate_failed", {
          route: "POST /api/venue-photos",
          error: err instanceof Error ? err.message : String(err),
        });
        return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, {
          retryable: true,
        });
      }
    }

    return publicApiError("Send the photo as multipart form data.", "INVALID_REQUEST", 400);
  }

  // ── Post a photo to a wall ─────────────────────────────────────────────────
  const contributor = await resolveContributionIdentity(request);
  if (!contributor.ok) {
    return jsonNoStore(contributor.body, { status: contributor.httpStatus });
  }

  // The bar's door. The handle came from the session above; the age comes from
  // the private identity the same account already gave at onboarding, and it is
  // re-checked here rather than trusted from any earlier surface.
  let adult = false;
  try {
    const identity = await privateIdentityStore().read(contributor.accountId);
    adult = Boolean(identity?.dateOfBirth) && isAdultDateOfBirth(identity!.dateOfBirth!);
  } catch {
    return publicApiError(
      "We could not check your account just now. Try again.",
      "IDENTITY_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
  if (!adult) {
    return publicApiError(
      "Photo walls are for over-18s. Add your date of birth to your account to join in.",
      "ADULT_REQUIRED",
      403,
    );
  }

  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const submitted = await parseUpload(request);
  if (!submitted) {
    return publicApiError("Attach one photo and its details.", "INVALID_REQUEST", 400);
  }
  const validation = validateVenuePhotoSubmission(submitted.input);
  if (!validation.ok) {
    return publicApiError(validation.error, "INVALID_PHOTO", 400);
  }
  const submission = validation.value;

  // Every upload costs a safety scan, so the budget fails CLOSED: a limiter we
  // cannot reach refuses rather than handing the provider bill to whoever asks.
  const limiterKey = `venue-photo:${hashActor(contributor.actor)}`;
  if (
    await isLimited(limiterKey, limiterKey, UPLOAD_LIMIT, UPLOAD_WINDOW_MS, {
      failClosed: true,
    })
  ) {
    return publicApiError("Too many photos, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  const store = venuePhotoStore();
  const profileId = contributor.actor.replace(/^profile:/, "");
  let held: number;
  try {
    held = await store.countForAuthorAtVenue(profileId, submission.venueId);
  } catch (err) {
    log("error", "venue_photo.count_failed", {
      route: "POST /api/venue-photos",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
  if (held >= VENUE_PHOTO_CAP_PER_ACCOUNT) {
    return publicApiError(
      `You already have ${VENUE_PHOTO_CAP_PER_ACCOUNT} photos on this pub's wall. Remove one to add another.`,
      "PHOTO_CAP_REACHED",
      409,
    );
  }

  const photoId = crypto.randomUUID();
  const { storage, moderation, crosspost: crosspostToFeed } = routeDeps();
  let staged: StagedVenuePhoto | null = null;
  try {
    const prepared = await prepareVenuePhoto(submitted.photo);
    staged = await stagePreparedVenuePhoto(submission.venueId, photoId, prepared, storage);

    const signedUrl = await signVenuePhotoObject(staged.stagingKey, storage);
    if (!signedUrl) {
      await discardStagedVenuePhoto(staged, storage);
      staged = null;
      return publicApiError("We could not check this photo. Try again.", "MODERATION_UNAVAILABLE", 503, {
        retryable: true,
      });
    }

    let decision: "approved" | "needs_review";
    try {
      const adapter = moderation();
      ({ decision } = await adapter.moderate(signedUrl));
    } catch (error) {
      await discardStagedVenuePhoto(staged, storage);
      staged = null;
      if (error instanceof ProfileAvatarModerationError || error instanceof Error) {
        return publicApiError(
          "We could not check this photo. Try again.",
          "MODERATION_UNAVAILABLE",
          503,
          { retryable: true },
        );
      }
      throw error;
    }

    if (decision !== "approved") {
      // Refused bytes never reach the serving key, so nothing public was ever
      // one request away from existing.
      await discardStagedVenuePhoto(staged, storage);
      staged = null;
      return publicApiError(VENUE_PHOTO_REFUSED_LINE, "PHOTO_REFUSED", 400);
    }

    const promoted = await promoteStagedVenuePhoto(staged, storage);
    staged = null;

    const created = await store.create({
      venueId: submission.venueId,
      authorActor: contributor.actor,
      authorProfileId: profileId,
      objectKey: promoted.objectKey,
      drinkCategory: submission.drinkCategory,
      caption: submission.caption,
      width: promoted.width,
      height: promoted.height,
    });

    // The feed is a SECOND write behind its own gate, and it can never take the
    // wall down with it. `off` is the honest answer when nobody asked.
    let crosspost: VenuePhotoCrosspost = { state: "off" };
    if (submission.shareToFeed) {
      crosspost = await crosspostToFeed(request, {
        caption: submission.caption,
        venueId: submission.venueId,
        photo: submitted.photo,
        idempotencyKey: `venue-photo-${created.id}`,
        authorProfileId: profileId,
      });
    }

    return jsonNoStore(
      {
        photo: {
          id: created.id,
          venueId: created.venueId,
          url: venuePhotoServePath(created.venueId, created.id),
          drinkCategory: created.drinkCategory,
          caption: created.caption,
          width: created.width,
          height: created.height,
          createdAt: created.createdAt,
          author: { handle: contributor.handle },
          ownedByViewer: true,
        },
        crosspost,
      },
      { status: 201 },
    );
  } catch (error) {
    if (staged) {
      try {
        await discardStagedVenuePhoto(staged, storage);
      } catch {
        // Swallow cleanup errors so the original failure is what is reported.
      }
    }
    if (error instanceof VenuePhotoError) return photoError(error);
    log("error", "venue_photo.create_failed", {
      route: "POST /api/venue-photos",
      error: error instanceof Error ? error.message : String(error),
    });
    return publicApiError("Storage is unavailable. Try again shortly.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  const status = params.get("status");
  if (status === "reported" || status === "hidden") {
    if (!isModerator(request)) return publicApiError("Not authorised.", "FORBIDDEN", 403);
    const store = venuePhotoStore();
    try {
      const photos = status === "hidden" ? await store.listHidden() : await store.listForReview();
      return jsonNoStore({ photos }, { status: 200 });
    } catch (err) {
      log("error", "venue_photo.list_review_failed", {
        route: "GET /api/venue-photos",
        error: err instanceof Error ? err.message : String(err),
      });
      return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, {
        retryable: true,
      });
    }
  }

  const venueId = readString(params.get("venueId"));
  if (!venueId) return publicApiError("Choose a venue.", "INVALID_REQUEST", 400);

  // A wall is public, so the read needs no session. The viewer's own id is
  // resolved only when a session is present, purely so a tile can say "yours".
  let viewerProfileId: string | null = null;
  try {
    const viewer = await resolveContributionIdentity(request);
    viewerProfileId = viewer.ok ? viewer.actor.replace(/^profile:/, "") : null;
  } catch {
    viewerProfileId = null;
  }

  const rawLimit = params.get("limit");
  const page = await venuePhotoStore().listForVenue(venueId, {
    cursor: params.get("cursor"),
    limit: rawLimit === null ? undefined : Number(rawLimit),
    viewerProfileId,
  });
  return jsonNoStore(page, { status: 200 });
}
