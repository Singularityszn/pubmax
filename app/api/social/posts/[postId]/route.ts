import { assertServerEnv } from "@/lib/serverEnv";
import { isLimited } from "@/lib/pintDrops";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { socialPostStore, SocialPostStoreError } from "@/lib/socialPostStore";
import { validateSocialPostEdit } from "@/lib/socialPosts";
import { hashActor } from "@/lib/supabase";

assertServerEnv();

type Context = { params: Promise<{ postId: string }> };

function privateJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store");
  return Response.json(body, { ...init, headers });
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
    const status = error.code === "FORBIDDEN" ? 403
      : error.code === "NOT_FOUND" ? 404
        : error.code === "EDIT_CONFLICT" ? 409
          : 400;
    return privateJson({ code: error.code, error: error.message }, { status });
  }
  return privateJson(
    { code: "SOCIAL_POSTS_UNAVAILABLE", error: "Social posts are unavailable right now.", retryable: true },
    { status: 503 },
  );
}

function validId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(_request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor();
  if (!access.ok) return accessError(access);
  const { postId } = await context.params;
  if (!validId(postId)) return privateJson({ code: "NOT_FOUND", error: "Post not found." }, { status: 404 });
  try {
    const post = await socialPostStore().read(postId, access.actor);
    return post
      ? privateJson({ post })
      : privateJson({ code: "NOT_FOUND", error: "Post not found." }, { status: 404 });
  } catch (error) {
    return storeError(error);
  }
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;
  const access = await requireVerifiedSocialActor();
  if (!access.ok) return accessError(access);
  const { postId } = await context.params;
  if (!validId(postId)) return privateJson({ code: "NOT_FOUND", error: "Post not found." }, { status: 404 });
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return privateJson({ code: "MALFORMED_REQUEST", error: "Request body is not valid JSON." }, { status: 400 });
  }
  if (input && typeof input === "object" && !Array.isArray(input) &&
    Object.keys(input).length === 1 && (input as { action?: unknown }).action === "remove") {
    const limitKey = `social-post-edit:${hashActor(access.actor.profileId)}`;
    if (await isLimited(limitKey, limitKey)) {
      return privateJson(
        { code: "RATE_LIMITED", error: "Too many Social post changes. Slow down.", retryable: true },
        { status: 429 },
      );
    }
    try {
      const removed = await socialPostStore().remove(postId, access.actor);
      return removed
        ? privateJson({ ok: true })
        : privateJson({ code: "NOT_FOUND", error: "Post not found." }, { status: 404 });
    } catch (error) {
      return storeError(error);
    }
  }
  const validation = validateSocialPostEdit(input);
  if (!validation.ok) {
    return privateJson({ code: validation.code, error: validation.error }, { status: 400 });
  }
  if (validation.value.photo) {
    return privateJson(
      { code: "PHOTO_UPLOAD_NOT_AVAILABLE", error: "Photo posts are not open yet." },
      { status: 409 },
    );
  }
  const limitKey = `social-post-edit:${hashActor(access.actor.profileId)}`;
  if (await isLimited(limitKey, limitKey)) {
    return privateJson(
      { code: "RATE_LIMITED", error: "Too many Social post changes. Slow down.", retryable: true },
      { status: 429 },
    );
  }
  try {
    const post = await socialPostStore().edit(
      postId,
      access.actor,
      validation.value,
      validation.contentChanged,
    );
    return privateJson({ post });
  } catch (error) {
    return storeError(error);
  }
}
