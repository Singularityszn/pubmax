// Public read of one approved owned image, byte-for-byte out of the private
// bucket. Shared by /api/avatar/[profileId]/[generation] and
// /api/cover/[profileId]/[generation]: an unclaimed, tombstoned, pending,
// flagged, or hidden image is a 404, never a stale serve.

import { publicApiError } from "@/lib/apiError";
import { profileMayWearAvatar } from "@/lib/avatarResolve";
import { isLimited } from "@/lib/pintDrops";
import { downloadProfileImageObject } from "@/lib/profileImageMedia.server";
import {
  isProfileImageServingKey,
  type ProfileImageSlot,
} from "@/lib/profileImageSlots";
import {
  profileImageState,
  profileStore,
  type ProfileRecord,
} from "@/lib/profileStore";
import { clientIp, hashIp, isSupabaseConfigured } from "@/lib/supabase";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PROFILE_IMAGE_SERVE_CACHE_CONTROL = "public, max-age=300, s-maxage=3600";

export type ProfileImageServeDeps = {
  getProfileById: (id: string) => Promise<ProfileRecord | null>;
  downloadObject: (objectKey: string) => Promise<Awaited<ReturnType<typeof downloadProfileImageObject>>>;
};

export const defaultProfileImageServeDeps: ProfileImageServeDeps = {
  getProfileById: (id) => profileStore().getById(id),
  downloadObject: (objectKey) => downloadProfileImageObject(objectKey),
};

function notFound(): Response {
  return publicApiError("Photo not found.", "NOT_FOUND", 404, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

function servingKey(
  profile: ProfileRecord,
  slot: ProfileImageSlot,
  generation: string,
): string | null {
  if (!profileMayWearAvatar(profile)) return null;
  const state = profileImageState(profile, slot);
  if (state.moderationState !== "approved") return null;
  if (!state.objectKey || state.generation !== generation) return null;
  if (!isProfileImageServingKey(slot, profile.id, generation, state.objectKey)) return null;
  return state.objectKey;
}

export async function handleProfileImageServe(
  request: Request,
  slot: ProfileImageSlot,
  params: { profileId: string; generation: string },
  deps: ProfileImageServeDeps,
): Promise<Response> {
  const ipHash = hashIp(clientIp(request));
  if (
    await isLimited(`${slot}-serve:${ipHash}`, `${slot}-serve:${ipHash}`, 240, 60_000)
  ) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  if (!isSupabaseConfigured()) return notFound();

  const id = decodeURIComponent(params.profileId).trim();
  const gen = decodeURIComponent(params.generation).trim();
  if (!UUID.test(id) || !UUID.test(gen)) return notFound();

  const profile = await deps.getProfileById(id);
  if (!profile) return notFound();

  const objectKey = servingKey(profile, slot, gen);
  if (!objectKey) return notFound();

  const downloaded = await deps.downloadObject(objectKey);
  if (!downloaded) return notFound();

  return new Response(new Uint8Array(downloaded.bytes), {
    status: 200,
    headers: {
      "Content-Type": downloaded.contentType,
      "Cache-Control": PROFILE_IMAGE_SERVE_CACHE_CONTROL,
    },
  });
}
