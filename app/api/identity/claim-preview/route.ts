// GET /api/identity/claim-preview?deviceHandle=
// Wave L3 — preview whether first sign-in should open "Claim your night".
// Requires a verified JWT. The account handle is ALWAYS derived from the JWT
// email local-part — never trust a client-supplied authHandle.

import { jsonNoStore } from "@/lib/apiResponses";
import { callerAuthIdentity } from "@/lib/authServer";
import {
  authHandleFromEmail,
  buildClaimPreview,
  decideClaimNeed,
} from "@/lib/identityClaim";
import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import { assertServerEnv } from "@/lib/serverEnv";
import {
  clientIp,
  hashIp,
  isSupabaseConfigured,
  requiresSupabaseStore,
} from "@/lib/supabase";

assertServerEnv();

export async function GET(request: Request): Promise<Response> {
  const identity = await callerAuthIdentity(request);
  if (!identity) {
    return jsonNoStore({ error: "Sign in to preview a handle claim." }, { status: 401 });
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
  const rateKey = `identity-claim-preview:${identity.id}:${ipHash}`;
  if (await isLimited(rateKey, rateKey, 30)) {
    return jsonNoStore({ error: "Too many claim previews, slow down." }, { status: 429 });
  }

  const params = new URL(request.url).searchParams;
  const deviceHandle = normalizeHandle(params.get("deviceHandle") ?? "");

  try {
    const preview = await buildClaimPreview({
      deviceHandle,
      authHandle,
      callerUserId: identity.id,
    });
    return jsonNoStore(
      { ...preview, needsClaim: decideClaimNeed(preview) },
      { status: 200 },
    );
  } catch {
    return jsonNoStore({ error: "Profile storage is unavailable." }, { status: 503 });
  }
}
