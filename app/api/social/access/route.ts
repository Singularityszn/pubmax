import { assertServerEnv } from "@/lib/serverEnv";
import { verifyCallerAuth } from "@/lib/authServer";
import {
  migrateSocialProductAccount,
  resolveSocialAccess,
} from "@/lib/socialAccessServer";

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
  return privateJson({ state: access.state });
}

export async function POST(request: Request): Promise<Response> {
  // This route resolves the legacy account authority itself so write-surface
  // certification can see the boundary. The protected server seam separately
  // verifies Clerk and applies the beta policy before any migration write.
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
