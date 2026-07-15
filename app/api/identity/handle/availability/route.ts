import { jsonNoStore } from "@/lib/apiResponses";
import { identityHandleStore, validateHandleForStore } from "@/lib/identityHandleStore";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";

assertServerEnv();

export async function GET(request: Request): Promise<Response> {
  const rateKey = `handle-availability:${hashIp(clientIp(request))}`;
  if (await isLimited(rateKey, rateKey, 40)) {
    return jsonNoStore({ error: "Too many handle checks. Try again shortly." }, { status: 429 });
  }
  const assessed = validateHandleForStore(new URL(request.url).searchParams.get("handle"));
  if (!assessed.ok) {
    return jsonNoStore({ available: false, reason: assessed.reason, error: assessed.error }, { status: 400 });
  }
  try {
    return jsonNoStore(await identityHandleStore().availability(assessed.handle));
  } catch {
    return jsonNoStore({ error: "Profile storage is unavailable." }, { status: 503 });
  }
}
