import { publicApiError } from "@/lib/apiError";
import {
  downloadProfileAvatarObject,
  isProfileAvatarServingKey,
} from "@/lib/profileAvatarMedia.server";
import { isLimited } from "@/lib/pintDrops";
import { profileMayWearAvatar } from "@/lib/avatarResolve";
import {
  profileStore,
  publicOwnedAvatarUrl,
  type ProfileRecord,
} from "@/lib/profileStore";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp, isSupabaseConfigured } from "@/lib/supabase";

assertServerEnv();

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const AVATAR_SERVE_CACHE_CONTROL = "public, max-age=300, s-maxage=3600";

type AvatarServeDeps = {
  getProfileById: (id: string) => Promise<ProfileRecord | null>;
  downloadObject: (objectKey: string) => Promise<Awaited<ReturnType<typeof downloadProfileAvatarObject>>>;
};

const defaultDeps: AvatarServeDeps = {
  getProfileById: (id) => profileStore().getById(id),
  downloadObject: (objectKey) => downloadProfileAvatarObject(objectKey),
};

let testDeps: Partial<AvatarServeDeps> | null = null;

export function __setAvatarServeRouteDepsForTest(deps: Partial<AvatarServeDeps> | null): void {
  testDeps = deps;
}

function deps(): AvatarServeDeps {
  return { ...defaultDeps, ...testDeps };
}

function notFound(): Response {
  return publicApiError("Photo not found.", "NOT_FOUND", 404, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

function canServe(profile: ProfileRecord, generation: string): string | null {
  if (!profileMayWearAvatar(profile)) return null;
  if (profile.avatarModerationState !== "approved") return null;
  if (!profile.avatarObjectKey || profile.avatarGeneration !== generation) return null;
  if (!isProfileAvatarServingKey(profile.id, generation, profile.avatarObjectKey)) return null;
  return publicOwnedAvatarUrl(profile) ?? null;
}

type RouteContext = { params: Promise<{ profileId: string; generation: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const ipHash = hashIp(clientIp(request));
  if (
    await isLimited(`avatar-serve:${ipHash}`, `avatar-serve:${ipHash}`, 240, 60_000)
  ) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  if (!isSupabaseConfigured()) return notFound();

  const { profileId, generation } = await context.params;
  const id = decodeURIComponent(profileId).trim();
  const gen = decodeURIComponent(generation).trim();
  if (!UUID.test(id) || !UUID.test(gen)) return notFound();

  const profile = await deps().getProfileById(id);
  if (!profile) return notFound();

  const servePath = canServe(profile, gen);
  if (!servePath) return notFound();

  const objectKey = profile.avatarObjectKey!;
  const downloaded = await deps().downloadObject(objectKey);
  if (!downloaded) return notFound();

  return new Response(new Uint8Array(downloaded.bytes), {
    status: 200,
    headers: {
      "Content-Type": downloaded.contentType,
      "Cache-Control": AVATAR_SERVE_CACHE_CONTROL,
    },
  });
}
