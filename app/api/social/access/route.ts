import { assertServerEnv } from "@/lib/serverEnv";
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
  const migration = await migrateSocialProductAccount(request);
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
