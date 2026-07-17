// Push-token registration for the Capacitor native shell (lib/nativePush.ts).
//
//   POST { token, platform }  →  { ok: true }
//
// The shell registers on boot, pre-auth, so the payload carries no identity —
// only "this device token can receive pushes". Abuse boundary: per-IP durable
// rate limit (a device registers once per boot, so 10/hour is generous while
// capping table growth from a spammer). Errors use the flat public envelope
// (lib/apiError.ts). Validation and storage live in lib/pushTokenStore.ts
// (memory + Supabase dual backend); server-side push SENDING is a later wave
// and needs an APNs key (docs/CAPACITOR_WRAP.md).

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { isLimited } from "@/lib/pintDrops";
import { pushTokenStore, validatePushToken } from "@/lib/pushTokenStore";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";

assertServerEnv();

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const validation = validatePushToken(body);
  if (!validation.ok) {
    return publicApiError(validation.error, "INVALID_REQUEST", 400);
  }

  // Per-IP durable limit, same key derivation as the other public write paths
  // (plan-generate) — the raw IP is hashed before it becomes a limiter key.
  const limiterKey = `push-tokens:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
    return publicApiError("Too many registrations, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  try {
    await pushTokenStore().save(validation.input);
  } catch {
    // Registration is best-effort on the client; a storage hiccup should read
    // as retry-later, not a broken app boot.
    return publicApiError("Could not save the token. Try again.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
  return jsonNoStore({ ok: true }, { status: 200 });
}
