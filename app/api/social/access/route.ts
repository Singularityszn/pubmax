import { publicApiError } from "@/lib/apiError";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { verifyCallerAuth } from "@/lib/authServer";
import {
  isSocialInviteBetaEnabled,
  SOCIAL_BETA_DISABLED,
} from "@/lib/socialAccess";
import {
  migrateSocialProductAccount,
  resolveSocialAccess,
} from "@/lib/socialAccessServer";
import { socialDraftScope } from "@/lib/socialDraftScope.server";

assertServerEnv();

function privateJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store");
  return Response.json(body, { ...init, headers });
}

export async function GET(request: Request): Promise<Response> {
  const access = await resolveSocialAccess(request);
  if (!access.available) {
    return publicApiError(access.error, access.code, 503, {
      retryable: true,
      compatibilityFields: { available: false, state: access.state },
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  return privateJson({
    state: access.state,
    ...(access.state === "verified" ? {
      viewerHandle: access.actor.handle,
      draftScope: socialDraftScope(access.actor.profileId),
    } : {}),
    // Whether the one tap is this account's way through. Absent means no, so
    // the boundary shows the plain refusal rather than a button that would
    // change nothing.
    ...(access.state !== "verified" && access.adultPrompt
      ? { adultPrompt: true }
      : {}),
  });
}

export async function POST(request: Request): Promise<Response> {
  const limiterKey = `social-access-migrate:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  if (!isSocialInviteBetaEnabled(process.env.SOCIAL_INVITE_BETA_ENABLED)) {
    return publicApiError(SOCIAL_BETA_DISABLED.error, SOCIAL_BETA_DISABLED.code, SOCIAL_BETA_DISABLED.status, { headers: { "Cache-Control": "private, no-store" } });
  }
  // This route resolves the legacy account authority itself so write-surface
  // certification can see the boundary. The beta policy above runs before
  // either identity verifier. The protected server seam repeats it for direct
  // internal callers.
  const supabase = await verifyCallerAuth(request);
  const migration = await migrateSocialProductAccount(supabase);
  if (!migration.ok) {
    return publicApiError(migration.error, migration.code, migration.status, {
      retryable: migration.retryable === true,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  return privateJson({ migrated: migration.migrated });
}
