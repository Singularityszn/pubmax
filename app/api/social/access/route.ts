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

export async function GET(): Promise<Response> {
  const access = await resolveSocialAccess();
  if (!access.available) {
    return privateJson(access, { status: 503 });
  }
  return privateJson({
    state: access.state,
    ...(access.state === "verified" ? {
      viewerHandle: access.actor.handle,
      draftScope: socialDraftScope(access.actor.profileId),
    } : {}),
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!isSocialInviteBetaEnabled(process.env.SOCIAL_INVITE_BETA_ENABLED)) {
    return privateJson(
      {
        code: SOCIAL_BETA_DISABLED.code,
        error: SOCIAL_BETA_DISABLED.error,
      },
      { status: SOCIAL_BETA_DISABLED.status },
    );
  }
  // This route resolves the legacy account authority itself so write-surface
  // certification can see the boundary. The beta policy above runs before
  // either identity verifier. The protected server seam repeats it for direct
  // internal callers.
  const supabase = await verifyCallerAuth(request);
  const migration = await migrateSocialProductAccount(supabase);
  if (!migration.ok) {
    return privateJson(
      {
        code: migration.code,
        error: migration.error,
        ...(migration.retryable ? { retryable: true } : {}),
      },
      { status: migration.status },
    );
  }
  return privateJson({ migrated: migration.migrated });
}
