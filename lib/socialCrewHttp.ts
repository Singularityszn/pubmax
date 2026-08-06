import { boundedJson } from "@/lib/boundedRequest.server";
import { isLimited } from "@/lib/pintDrops";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { SocialCrewStoreError } from "@/lib/socialCrewStore";
import type { SocialPostActor } from "@/lib/socialPostStore";
import { hashActor } from "@/lib/supabase";

const SOCIAL_CREW_BODY_MAX_BYTES = 8 * 1024;
const SOCIAL_CREW_WRITE_LIMIT = 30;
const SOCIAL_CREW_WRITE_WINDOW_MS = 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SocialCrewActorResult =
  | { ok: true; actor: SocialPostActor }
  | { ok: false; response: Response };

type SocialCrewBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response };

export function socialCrewPrivateJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store");
  return Response.json(body, { ...init, headers });
}

export function socialCrewInvalidResponse(): Response {
  return socialCrewPrivateJson(
    {
      code: "INVALID_SOCIAL_CREW_REQUEST",
      error: "Social Crew request is not valid.",
    },
    { status: 422 },
  );
}

export function socialCrewNotFoundResponse(): Response {
  return socialCrewPrivateJson(
    { code: "SOCIAL_CREW_NOT_FOUND", error: "Social Crew not found." },
    { status: 404 },
  );
}

export function socialCrewUnavailableResponse(): Response {
  return socialCrewPrivateJson(
    {
      code: "SOCIAL_CREW_UNAVAILABLE",
      error: "Social Crew is unavailable right now.",
      retryable: true,
    },
    { status: 503 },
  );
}

function accessError(
  access: Exclude<Awaited<ReturnType<typeof requireVerifiedSocialActor>>, { ok: true }>,
): Response {
  return socialCrewPrivateJson(
    {
      code: access.code,
      error: access.error,
      ...(access.retryable ? { retryable: true } : {}),
    },
    { status: access.status },
  );
}

export async function socialCrewActor(
  access: Awaited<ReturnType<typeof requireVerifiedSocialActor>>,
  write = false,
): Promise<SocialCrewActorResult> {
  if (!access.ok) return { ok: false, response: accessError(access) };
  if (!write) return { ok: true, actor: access.actor };

  const key = `social-crew:${hashActor(access.actor.profileId)}`;
  try {
    if (await isLimited(
      key,
      key,
      SOCIAL_CREW_WRITE_LIMIT,
      SOCIAL_CREW_WRITE_WINDOW_MS,
    )) {
      return {
        ok: false,
        response: socialCrewPrivateJson(
          {
            code: "SOCIAL_CREW_RATE_LIMITED",
            error: "Too many Social Crew changes. Slow down.",
            retryable: true,
          },
          { status: 429 },
        ),
      };
    }
  } catch {
    return { ok: false, response: socialCrewUnavailableResponse() };
  }
  return { ok: true, actor: access.actor };
}

export async function socialCrewBody(
  request: Request,
  allowEmpty = false,
): Promise<SocialCrewBodyResult> {
  if (request.body === null) {
    return allowEmpty
      ? { ok: true, body: {} }
      : { ok: false, response: socialCrewInvalidResponse() };
  }
  try {
    const value = await boundedJson(request, SOCIAL_CREW_BODY_MAX_BYTES);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, response: socialCrewInvalidResponse() };
    }
    return { ok: true, body: value as Record<string, unknown> };
  } catch {
    return { ok: false, response: socialCrewInvalidResponse() };
  }
}

export function socialCrewExactKeys(
  body: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const expected = new Set(keys);
  return Object.keys(body).length === expected.size &&
    Object.keys(body).every((key) => expected.has(key));
}

export function socialCrewEmptyBody(body: Record<string, unknown>): boolean {
  return Object.keys(body).length === 0;
}

export function socialCrewIdempotencyKey(request: Request): string | null {
  const value = request.headers.get("idempotency-key")?.trim();
  return value && value.length >= 16 && value.length <= 128 ? value : null;
}

export function socialCrewHostCapability(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  const capability = match?.[1];
  return capability && capability.length <= 512 ? capability : null;
}

export function isSocialCrewId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function socialCrewErrorResponse(error: unknown): Response {
  if (error instanceof SocialCrewStoreError) {
    if (error.code === "INVALID") return socialCrewInvalidResponse();
    if (error.code === "NOT_FOUND") return socialCrewNotFoundResponse();
    if (error.code === "CONFLICT") {
      return socialCrewPrivateJson(
        {
          code: "SOCIAL_CREW_CONFLICT",
          error: "Social Crew changed before this request.",
        },
        { status: 409 },
      );
    }
  }
  return socialCrewUnavailableResponse();
}

export async function socialCrewMutation(
  operation: () => Promise<unknown>,
  status = 200,
): Promise<Response> {
  try {
    return socialCrewPrivateJson(await operation(), { status });
  } catch (error) {
    return socialCrewErrorResponse(error);
  }
}
