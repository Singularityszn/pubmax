import { jsonNoStore } from "@/lib/apiResponses";
import { identityHandleStore, validateHandleForStore } from "@/lib/identityHandleStore";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

export async function GET(request: Request): Promise<Response> {
  const assessed = validateHandleForStore(new URL(request.url).searchParams.get("handle"));
  if (!assessed.ok) return jsonNoStore({ error: "Profile not found." }, { status: 404 });
  try {
    const resolved = await identityHandleStore().resolve(assessed.handle);
    return resolved
      ? jsonNoStore(resolved)
      : jsonNoStore({ error: "Profile not found." }, { status: 404 });
  } catch {
    return jsonNoStore({ error: "Profile storage is unavailable." }, { status: 503 });
  }
}
