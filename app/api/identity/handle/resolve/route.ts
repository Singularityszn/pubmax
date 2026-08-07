import { jsonNoStore } from "@/lib/apiResponses";
import { identityHandleStore, validateHandleForStore } from "@/lib/identityHandleStore";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

export async function GET(request: Request): Promise<Response> {
  const assessed = validateHandleForStore(new URL(request.url).searchParams.get("handle"));
  if (!assessed.ok) return jsonNoStore({ error: "Profile not found." }, { status: 404 });
  try {
    const resolved = await identityHandleStore().resolve(assessed.handle);
    if (!resolved) {
      return jsonNoStore({ error: "Profile not found." }, { status: 404 });
    }
    // Tombstone: handle remains reserved; public surface answers gone, not live.
    if (resolved.status === "gone") {
      return jsonNoStore({
        status: "gone",
        handle: resolved.requestedHandle,
        profileId: resolved.profileId,
      });
    }
    return jsonNoStore(resolved);
  } catch {
    return jsonNoStore({ error: "Profile storage is unavailable." }, { status: 503 });
  }
}
