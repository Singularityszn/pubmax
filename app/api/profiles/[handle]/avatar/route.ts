import { assertServerEnv } from "@/lib/serverEnv";
import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { boundedFormData, RequestBodyTooLargeError } from "@/lib/boundedRequest.server";
import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import { gateHandleAction } from "@/lib/profileOwnership";
import {
  discardStagedProfileAvatar,
  prepareProfileAvatar,
  PROFILE_AVATAR_MAX_BYTES,
  ProfileAvatarError,
  promoteStagedProfileAvatar,
  purgeProfileAvatarObjects,
  signProfileAvatarObject,
  stagePreparedProfileAvatar,
  type ProfileAvatarStorage,
  supabaseProfileAvatarStorage,
} from "@/lib/profileAvatarMedia.server";
import {
  OpenAIProfileAvatarModerationAdapter,
  ProfileAvatarModerationError,
  type ProfileAvatarModerationAdapter,
} from "@/lib/profileAvatarModeration";
import {
  isProfileTombstoned,
  profileStore,
  publicOwnedAvatarUrl,
  type ProfileRecord,
} from "@/lib/profileStore";
import {
  hashActor,
  isSupabaseConfigured,
  requiresSupabaseStore,
} from "@/lib/supabase";

assertServerEnv();

export const maxDuration = 15;

const AVATAR_RATE_LIMIT = 10;
const AVATAR_RATE_WINDOW_MS = 60 * 60 * 1000;

type AvatarDeps = {
  storage: ProfileAvatarStorage;
  moderation: () => ProfileAvatarModerationAdapter;
};

const defaultDeps: AvatarDeps = {
  storage: supabaseProfileAvatarStorage,
  moderation: () => new OpenAIProfileAvatarModerationAdapter(),
};

/** Test seam: production callers leave this unset. */
let testDeps: Partial<AvatarDeps> | null = null;

export function __setProfileAvatarRouteDepsForTest(deps: Partial<AvatarDeps> | null): void {
  testDeps = deps;
}

function deps(): AvatarDeps {
  return {
    storage: testDeps?.storage ?? defaultDeps.storage,
    moderation: testDeps?.moderation ?? defaultDeps.moderation,
  };
}

function toPublicProfile(profile: ProfileRecord | null) {
  if (!profile) return null;
  const avatarUrl = publicOwnedAvatarUrl(profile);
  return {
    id: profile.id,
    handle: profile.handle,
    ...(profile.displayName ? { displayName: profile.displayName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(profile.homeCity ? { homeCity: profile.homeCity } : {}),
    ...(profile.bio ? { bio: profile.bio } : {}),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function photoError(error: unknown): Response {
  if (error instanceof ProfileAvatarError) {
    const status = error.code === "TOO_LARGE" ? 413
      : error.code === "STORAGE_UNAVAILABLE" ? 503
        : 400;
    return publicApiError(error.message, error.code, status, {
      retryable: error.code === "STORAGE_UNAVAILABLE",
    });
  }
  if (error instanceof RequestBodyTooLargeError) {
    return publicApiError("Photo must be 10 MB or smaller.", "TOO_LARGE", 413);
  }
  return publicApiError("Photo could not be processed.", "PROCESSING_FAILED", 400);
}

async function requireOwnedProfile(
  request: Request,
  handle: string,
): Promise<
  | { ok: true; profile: ProfileRecord; callerUserId: string }
  | { ok: false; response: Response }
> {
  const gate = await gateHandleAction(request, handle);
  if (!gate.allowed) {
    return { ok: false, response: publicApiErrorFromStatus(gate.error, gate.status) };
  }
  if (!gate.callerUserId) {
    return {
      ok: false,
      response: publicApiError(
        "Sign in with the account that owns this handle to continue.",
        "FORBIDDEN",
        403,
      ),
    };
  }

  const store = profileStore();
  const profile = await store.getByHandle(handle);
  if (!profile || isProfileTombstoned(profile)) {
    return {
      ok: false,
      response: publicApiError("Profile not found.", "NOT_FOUND", 404),
    };
  }
  if (!profile.userId || profile.userId !== gate.callerUserId) {
    return {
      ok: false,
      response: publicApiError(
        "Claim this handle before adding a photo.",
        "FORBIDDEN",
        403,
      ),
    };
  }
  return { ok: true, profile, callerUserId: gate.callerUserId };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const handle = normalizeHandle((await params).handle);
  if (!handle) {
    return publicApiError("Missing handle.", "INVALID_REQUEST", 400);
  }

  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return publicApiError("Profile storage is not configured.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }

  let owned: Awaited<ReturnType<typeof requireOwnedProfile>>;
  try {
    owned = await requireOwnedProfile(request, handle);
  } catch {
    return publicApiError("Profile storage is unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
  if (!owned.ok) return owned.response;

  const limiterKey = `profile-avatar:${hashActor(owned.callerUserId)}`;
  if (
    await isLimited(limiterKey, limiterKey, AVATAR_RATE_LIMIT, AVATAR_RATE_WINDOW_MS, {
      failClosed: true,
    })
  ) {
    return publicApiError("Too many photo uploads, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  let photo: File;
  try {
    const contentType = request.headers.get("Content-Type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return publicApiError("Send the photo as multipart form data.", "INVALID_REQUEST", 400);
    }
    const form = await boundedFormData(request, PROFILE_AVATAR_MAX_BYTES + 64 * 1024);
    const parts = form.getAll("photo");
    if (parts.length !== 1 || !(parts[0] instanceof File)) {
      return publicApiError("Attach one photo.", "INVALID_REQUEST", 400);
    }
    photo = parts[0];
  } catch (error) {
    return photoError(error);
  }

  const { storage, moderation } = deps();
  let staged: Awaited<ReturnType<typeof stagePreparedProfileAvatar>> | null = null;
  const previousKeys = [
    owned.profile.avatarObjectKey,
    owned.profile.avatarGeneration
      ? `avatars/${owned.profile.id}/${owned.profile.avatarGeneration}/staging.jpg`
      : null,
  ].filter((key): key is string => typeof key === "string" && key.length > 0);

  try {
    const prepared = await prepareProfileAvatar(photo);
    staged = await stagePreparedProfileAvatar(owned.profile.id, prepared, storage);

    const signedUrl = await signProfileAvatarObject(staged.stagingKey, storage);
    if (!signedUrl) {
      await discardStagedProfileAvatar(staged, storage);
      staged = null;
      return publicApiError(
        "We could not check this photo. Try again.",
        "MODERATION_UNAVAILABLE",
        503,
        { retryable: true },
      );
    }

    let adapter: ProfileAvatarModerationAdapter;
    try {
      adapter = moderation();
    } catch (error) {
      await discardStagedProfileAvatar(staged, storage);
      staged = null;
      if (error instanceof ProfileAvatarModerationError) {
        return publicApiError(
          "We could not check this photo. Try again.",
          "MODERATION_UNAVAILABLE",
          503,
          { retryable: true },
        );
      }
      throw error;
    }

    let decision: "approved" | "needs_review";
    try {
      ({ decision } = await adapter.moderate(signedUrl));
    } catch {
      await discardStagedProfileAvatar(staged, storage);
      staged = null;
      return publicApiError(
        "We could not check this photo. Try again.",
        "MODERATION_UNAVAILABLE",
        503,
        { retryable: true },
      );
    }

    if (decision !== "approved") {
      await discardStagedProfileAvatar(staged, storage);
      staged = null;
      return publicApiError(
        "That photo did not pass our checks. Choose another.",
        "PHOTO_REFUSED",
        400,
      );
    }

    const promoted = await promoteStagedProfileAvatar(staged, storage);
    staged = null;

    const updated = await profileStore().setOwnedAvatar(handle, {
      objectKey: promoted.objectKey,
      generation: promoted.generation,
      moderationState: "approved",
    });
    if (!updated) {
      await storage.remove([promoted.objectKey]);
      return publicApiError("Profile storage is unavailable.", "STORE_UNAVAILABLE", 503, {
        retryable: true,
      });
    }

    if (previousKeys.length > 0) {
      try {
        await storage.remove(previousKeys);
      } catch {
        // New avatar is live; old-generation cleanup is best-effort.
      }
    }

    return jsonNoStore({ profile: toPublicProfile(updated) }, { status: 200 });
  } catch (error) {
    if (staged) {
      try {
        await discardStagedProfileAvatar(staged, storage);
      } catch {
        // Swallow cleanup errors so the original failure is reported.
      }
    }
    if (error instanceof ProfileAvatarError || error instanceof RequestBodyTooLargeError) {
      return photoError(error);
    }
    return publicApiError("Profile storage is unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const handle = normalizeHandle((await params).handle);
  if (!handle) {
    return publicApiError("Missing handle.", "INVALID_REQUEST", 400);
  }

  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return publicApiError("Profile storage is not configured.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }

  let owned: Awaited<ReturnType<typeof requireOwnedProfile>>;
  try {
    owned = await requireOwnedProfile(request, handle);
  } catch {
    return publicApiError("Profile storage is unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
  if (!owned.ok) return owned.response;

  const limiterKey = `profile-avatar-delete:${hashActor(owned.callerUserId)}`;
  if (
    await isLimited(limiterKey, limiterKey, AVATAR_RATE_LIMIT, AVATAR_RATE_WINDOW_MS, {
      failClosed: true,
    })
  ) {
    return publicApiError("Too many edits, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  const { storage } = deps();
  const knownKeys = [
    owned.profile.avatarObjectKey,
    owned.profile.avatarGeneration
      ? `avatars/${owned.profile.id}/${owned.profile.avatarGeneration}/staging.jpg`
      : null,
  ].filter((key): key is string => typeof key === "string" && key.length > 0);

  try {
    await purgeProfileAvatarObjects(owned.profile.id, storage, knownKeys);
    const updated = await profileStore().setOwnedAvatar(handle, null);
    if (!updated) {
      return publicApiError("Profile storage is unavailable.", "STORE_UNAVAILABLE", 503, {
        retryable: true,
      });
    }
    return jsonNoStore({ profile: toPublicProfile(updated) }, { status: 200 });
  } catch (error) {
    if (error instanceof ProfileAvatarError) return photoError(error);
    return publicApiError("Profile storage is unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}
