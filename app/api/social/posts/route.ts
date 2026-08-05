import { assertServerEnv } from "@/lib/serverEnv";
import { isLimited } from "@/lib/pintDrops";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { socialPostStore, SocialPostStoreError } from "@/lib/socialPostStore";
import { isSocialPostArea, validateSocialPostCreate } from "@/lib/socialPosts";

assertServerEnv();

function privateJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store");
  return Response.json(body, { ...init, headers });
}

async function body(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function accessError(access: Exclude<Awaited<ReturnType<typeof requireVerifiedSocialActor>>, { ok: true }>): Response {
  return privateJson({
    code: access.code,
    error: access.error,
    ...(access.retryable ? { retryable: true } : {}),
  }, { status: access.status });
}

function storeError(error: unknown): Response {
  if (error instanceof SocialPostStoreError) {
    const status = error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : 400;
    return privateJson({ code: error.code, error: error.message }, { status });
  }
  return privateJson(
    { code: "SOCIAL_POSTS_UNAVAILABLE", error: "Social posts are unavailable right now.", retryable: true },
    { status: 503 },
  );
}

export async function GET(request: Request): Promise<Response> {
  const access = await requireVerifiedSocialActor();
  if (!access.ok) return accessError(access);
  const params = new URL(request.url).searchParams;
  const lane = params.get("lane") ?? "discover";
  if (lane !== "discover" && lane !== "nearby" && lane !== "following") {
    return privateJson({ code: "INVALID_LANE", error: "Choose a Social feed." }, { status: 400 });
  }
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return privateJson({ code: "INVALID_LIMIT", error: "Feed size must be between 1 and 50." }, { status: 400 });
  }
  const area = params.get("area");
  if (lane === "nearby" && !isSocialPostArea(area)) {
    return privateJson({ code: "INVALID_AREA", error: "Choose a listed area." }, { status: 400 });
  }
  try {
    const page = await socialPostStore().feed(access.actor, {
      lane,
      area: area ?? undefined,
      cursor: params.get("cursor"),
      limit,
    });
    return privateJson(page);
  } catch (error) {
    return storeError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireVerifiedSocialActor();
  if (!access.ok) return accessError(access);
  const input = await body(request);
  if (input === null) {
    return privateJson({ code: "MALFORMED_REQUEST", error: "Request body is not valid JSON." }, { status: 400 });
  }
  const validation = validateSocialPostCreate(input);
  if (!validation.ok) {
    return privateJson({ code: validation.code, error: validation.error }, { status: 400 });
  }
  if (validation.value.photo) {
    return privateJson(
      { code: "PHOTO_UPLOAD_NOT_AVAILABLE", error: "Photo posts are not open yet." },
      { status: 409 },
    );
  }
  const limitKey = `social-post-create:${access.actor.profileId}`;
  if (await isLimited(limitKey, limitKey)) {
    return privateJson(
      { code: "RATE_LIMITED", error: "Too many Social posts. Slow down.", retryable: true },
      { status: 429 },
    );
  }
  try {
    const post = await socialPostStore().create(access.actor, validation.value);
    return privateJson({ post }, { status: 201 });
  } catch (error) {
    return storeError(error);
  }
}
