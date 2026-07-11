// POST /api/identity/claim
// Wave L3 — link the chosen handle (device | auth) to the signed-in user.
// Body: { choice: "device" | "auth", deviceHandle? }
// Account handle is ALWAYS derived from the JWT email — never from the body.
// 409 when the chosen handle is already owned by someone else.

import { jsonNoStore } from "@/lib/apiResponses";
import { callerAuthIdentity } from "@/lib/authServer";
import {
  authHandleFromEmail,
  performClaim,
  type ClaimChoice,
} from "@/lib/identityClaim";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import {
  clientIp,
  hashIp,
  isSupabaseConfigured,
  requiresSupabaseStore,
} from "@/lib/supabase";
import { readString } from "@/lib/textClean";

assertServerEnv();

export async function POST(request: Request): Promise<Response> {
  const identity = await callerAuthIdentity(request);
  if (!identity) {
    return jsonNoStore({ error: "Sign in to claim a handle." }, { status: 401 });
  }

  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return jsonNoStore({ error: "Profile storage is not configured." }, { status: 503 });
  }

  const authHandle = authHandleFromEmail(identity.email);
  if (!authHandle) {
    return jsonNoStore(
      { error: "Your account needs an email before you can claim a handle." },
      { status: 400 },
    );
  }

  const ipHash = hashIp(clientIp(request));
  const rateKey = `identity-claim:${identity.id}:${ipHash}`;
  if (await isLimited(rateKey, rateKey, 20)) {
    return jsonNoStore({ error: "Too many claim attempts, slow down." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }

  const choiceRaw = readString(body.choice);
  if (choiceRaw !== "device" && choiceRaw !== "auth") {
    return jsonNoStore({ error: "Pick device or auth handle." }, { status: 400 });
  }
  const choice = choiceRaw as ClaimChoice;

  const result = await performClaim({
    choice,
    deviceHandle: readString(body.deviceHandle) ?? "",
    authHandle,
    callerUserId: identity.id,
  });

  if (!result.ok) {
    return jsonNoStore({ error: result.error }, { status: result.status });
  }

  return jsonNoStore({ handle: result.handle, linked: true }, { status: 200 });
}
