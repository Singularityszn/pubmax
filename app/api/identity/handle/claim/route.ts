import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { identityHandleStore, validateHandleForStore } from "@/lib/identityHandleStore";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp, isSupabaseConfigured, requiresSupabaseStore } from "@/lib/supabase";

assertServerEnv();

export async function POST(request: Request): Promise<Response> {
  const ownerId = await callerUserId(request);
  if (!ownerId) return jsonNoStore({ error: "Sign in to claim a PUBMAXX handle." }, { status: 401 });
  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return jsonNoStore({ error: "Profile storage is not configured." }, { status: 503 });
  }
  const rateKey = `handle-claim:${ownerId}:${hashIp(clientIp(request))}`;
  if (await isLimited(rateKey, rateKey, 20)) {
    return jsonNoStore({ error: "Too many handle attempts. Try again shortly." }, { status: 429 });
  }
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; }
  catch { return jsonNoStore({ error: "Malformed request body." }, { status: 400 }); }
  const assessed = validateHandleForStore(body?.handle);
  if (!assessed.ok) return jsonNoStore({ error: assessed.error, reason: assessed.reason }, { status: 400 });
  const result = await identityHandleStore().claim(ownerId, assessed.handle);
  if (!result.ok) {
    return jsonNoStore({ error: result.error, code: result.code }, { status: result.code === "storage" ? 503 : 409 });
  }
  return jsonNoStore(result, { status: 201 });
}
