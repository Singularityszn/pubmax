// Push-token registration for the Capacitor native shell (lib/nativePush.ts).
//
//   POST { token, platform }  →  { ok: true }
//
// The shell registers on boot, pre-auth, so the payload carries no identity —
// only "this device token can receive pushes". Validation and storage live in
// lib/pushTokenStore.ts (memory + Supabase dual backend); server-side push
// SENDING is a later wave and needs an APNs key (docs/CAPACITOR_WRAP.md).

import { jsonNoStore } from "@/lib/apiResponses";
import { pushTokenStore, validatePushToken } from "@/lib/pushTokenStore";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }

  const validation = validatePushToken(body);
  if (!validation.ok) {
    return jsonNoStore({ error: validation.error }, { status: 400 });
  }

  try {
    await pushTokenStore().save(validation.input);
  } catch {
    // Registration is best-effort on the client; a storage hiccup should read
    // as retry-later, not a broken app boot.
    return jsonNoStore({ error: "Could not save the token. Try again." }, { status: 503 });
  }
  return jsonNoStore({ ok: true }, { status: 200 });
}
