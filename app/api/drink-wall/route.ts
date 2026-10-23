// Drink Wall: city-wide photo read and write seam.
//
//   GET  ?category=&cursor=&limit=&scope=all|near&nearVenueIds=id,id
//   POST multipart { post: <json>, photo: <file> }
//
// Reports and author deletes go through /api/venue-photos, which takes any
// venue_photos row by id, city rows included.

import { assertServerEnv } from "@/lib/serverEnv";
import { accountIsAdult } from "@/lib/adultGate";
import { adultSelfAssertionStore } from "@/lib/adultSelfAssertionStore";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { boundedFormData } from "@/lib/boundedRequest.server";
import {
  contributionAdultRefusal,
  type ContributionAdultRefusal,
} from "@/lib/contributionGateStatus";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import {
  DRINK_WALL_CITY_CAP_PER_ACCOUNT,
  drinkWallCapLine,
  validateDrinkWallSubmission,
  type DrinkWallPage,
} from "@/lib/drinkWall";
import { log } from "@/lib/log";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isLimited } from "@/lib/pintDrops";
import { privateIdentityStore } from "@/lib/privateIdentityStore";
import {
  isSocialFriendsLaunchEnabled,
  needsAdultSelfAssertion,
  SOCIAL_FRIENDS_LAUNCH_ENV,
  socialSurfaceName,
} from "@/lib/socialLaunch";
import { hashActor } from "@/lib/supabase";
import { scanUploadedImage } from "@/lib/uploadedImageScan.server";
import {
  discardStagedVenuePhoto,
  prepareVenuePhoto,
  promoteStagedVenuePhoto,
  signVenuePhotoObject,
  stagePreparedWallPhoto,
  VENUE_PHOTO_MAX_BYTES,
  VenuePhotoError,
  type StagedVenuePhoto,
} from "@/lib/venuePhotoMedia.server";
import { resolveVenue } from "@/lib/venueIndex";
import { venuePhotoRouteDeps } from "@/lib/venuePhotoRouteDeps.server";
import { VENUE_PHOTO_CAP_PER_ACCOUNT, venuePhotoStore } from "@/lib/venuePhotoStore";
import {
  isDrinkWallCategory,
  isVenuePhotoVenueId,
  photoServePath,
  VENUE_PHOTO_REFUSED_LINE,
  venuePhotoCapLine,
} from "@/lib/venuePhotos";

assertServerEnv();

const UPLOAD_LIMIT = 12;
const UPLOAD_WINDOW_MS = 60 * 60 * 1000;

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

function wallAgeRefusalLine(refusal: ContributionAdultRefusal): string {
  if (refusal.status !== "adult_check_required") return refusal.error;
  const surface = socialSurfaceName(
    isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV]),
  );
  return `Photo walls are for over-18s. Confirm your age on ${surface}.`;
}

function parseNearVenueIds(raw: string | null): string[] | null | undefined {
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const ids = trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (ids.some((id) => !isVenuePhotoVenueId(id))) return null;
  return ids;
}

export async function POST(request: Request): Promise<Response> {
  const contentType = (request.headers.get("Content-Type") ?? "").toLowerCase();

  if (!contentType.startsWith("multipart/form-data")) {
    return publicApiError("Send the photo as multipart form data.", "INVALID_REQUEST", 400);
  }

  const contributor = await resolveContributionIdentity(request);
  if (!contributor.ok) {
    return jsonNoStore(contributor.body, { status: contributor.httpStatus });
  }

  let adultRefusal: ContributionAdultRefusal | null = null;
  try {
    const [identity, assertedAt] = await Promise.all([
      privateIdentityStore().read(contributor.accountId),
      adultSelfAssertionStore().read(contributor.accountId),
    ]);
    const evidence = {
      dateOfBirth: identity?.dateOfBirth ?? null,
      adultSelfAssertedAt: assertedAt,
    };
    adultRefusal = contributionAdultRefusal({
      isAdult: accountIsAdult(evidence),
      needsSelfAssertion: needsAdultSelfAssertion(evidence),
    });
  } catch {
    return publicApiError(
      "We could not check your account just now. Try again.",
      "IDENTITY_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
  if (adultRefusal) {
    return publicApiError(
      wallAgeRefusalLine(adultRefusal),
      "ADULT_REQUIRED",
      403,
      { compatibilityFields: { status: adultRefusal.status } },
    );
  }

  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const submitted = await parseUpload(request);
  if (!submitted) {
    return publicApiError("Attach one photo and its details.", "INVALID_REQUEST", 400);
  }
  const validation = validateDrinkWallSubmission(submitted.input);
  if (!validation.ok) {
    return publicApiError(validation.error, "INVALID_PHOTO", 400);
  }
  const submission = validation.value;

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
  const venueId = submission.venueId;
  let held: number;
  try {
    held =
      venueId === null
        ? await store.countCityPhotosForAuthor(profileId)
        : await store.countForAuthorAtVenue(profileId, venueId);
  } catch (err) {
    log("error", "drink_wall.count_failed", {
      route: "POST /api/drink-wall",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
  if (venueId === null && held >= DRINK_WALL_CITY_CAP_PER_ACCOUNT) {
    return publicApiError(drinkWallCapLine(), "PHOTO_CAP_REACHED", 409);
  }
  if (venueId !== null && held >= VENUE_PHOTO_CAP_PER_ACCOUNT) {
    return publicApiError(venuePhotoCapLine(), "PHOTO_CAP_REACHED", 409);
  }

  const photoId = crypto.randomUUID();
  const { storage, moderation } = venuePhotoRouteDeps();
  let staged: StagedVenuePhoto | null = null;
  try {
    const prepared = await prepareVenuePhoto(submitted.photo);
    staged = await stagePreparedWallPhoto(submission.venueId, photoId, prepared, storage);

    const signedUrl = await signVenuePhotoObject(staged.stagingKey, storage);
    const scan = await scanUploadedImage({
      surface: "drink-wall",
      signedUrl,
      adapter: moderation,
    });

    if (scan.verdict === "refused") {
      await discardStagedVenuePhoto(staged, storage);
      staged = null;
      return publicApiError(VENUE_PHOTO_REFUSED_LINE, "PHOTO_REFUSED", 400);
    }

    const promoted = await promoteStagedVenuePhoto(staged, storage);
    staged = null;

    const created = await store.create({
      id: photoId,
      venueId: submission.venueId,
      wallCategory: submission.wallCategory,
      placeLabel: submission.placeLabel,
      authorActor: contributor.actor,
      authorProfileId: profileId,
      objectKey: promoted.objectKey,
      drinkCategory: submission.drinkCategory,
      caption: submission.caption,
      width: promoted.width,
      height: promoted.height,
    });

    return jsonNoStore(
      {
        photo: {
          id: created.id,
          venueId: created.venueId,
          wallCategory: created.wallCategory,
          placeLabel: created.placeLabel ? created.placeLabel : null,
          url: photoServePath(created),
          drinkCategory: created.drinkCategory,
          caption: created.caption,
          width: created.width,
          height: created.height,
          createdAt: created.createdAt,
          author: { handle: contributor.handle },
          ownedByViewer: true,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (staged) {
      try {
        await discardStagedVenuePhoto(staged, storage);
      } catch {
        /* swallow cleanup errors */
      }
    }
    if (error instanceof VenuePhotoError) return photoError(error);
    log("error", "drink_wall.create_failed", {
      route: "POST /api/drink-wall",
      error: error instanceof Error ? error.message : String(error),
    });
    return publicApiError("Storage is unavailable. Try again shortly.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const scope = params.get("scope") === "near" ? "near" : "all";
  const categoryRaw = params.get("category");
  const category =
    categoryRaw && categoryRaw.length > 0
      ? isDrinkWallCategory(categoryRaw)
        ? categoryRaw
        : null
      : undefined;
  if (category === null) {
    return publicApiError("Choose a wall category.", "INVALID_REQUEST", 400);
  }

  const nearParsed = scope === "near" ? parseNearVenueIds(params.get("nearVenueIds")) : undefined;
  if (nearParsed === null) {
    return publicApiError("Those nearby pubs aren't valid.", "INVALID_REQUEST", 400);
  }

  let viewerProfileId: string | null = null;
  try {
    const viewer = await resolveContributionIdentity(request);
    viewerProfileId = viewer.ok ? viewer.actor.replace(/^profile:/, "") : null;
  } catch {
    viewerProfileId = null;
  }

  const rawLimit = params.get("limit");
  const page = await venuePhotoStore().listDrinkWall({
    category,
    cursor: params.get("cursor"),
    limit: rawLimit === null ? undefined : Number(rawLimit),
    viewerProfileId,
    nearVenueIds: nearParsed,
  });
  const body: DrinkWallPage = {
    ...page,
    photos: await Promise.all(
      page.photos.map(async (photo) => ({
        ...photo,
        venueName: photo.venueId
          ? ((await resolveVenue(photo.venueId).catch(() => null))?.name ?? null)
          : null,
      })),
    ),
  };
  return jsonNoStore(body, { status: 200 });
}
