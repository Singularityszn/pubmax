import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { callerUserId } from "@/lib/authServer";
import { socialConnectionStore } from "@/lib/socialConnectionStore";
import {
  isSocialProvider,
  publicSocialConnection,
  validateManualSocialProfile,
} from "@/lib/socialConnections";
import { createSocialOAuthStart, socialProviderAvailability } from "@/lib/socialOAuth";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";

assertServerEnv();

type Context = { params: Promise<{ provider: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const ownerId = await callerUserId(request);
  if (!ownerId) return publicApiError("Sign in to connect an account.", "AUTH_REQUIRED", 401);
  const provider = (await context.params).provider;
  if (!isSocialProvider(provider)) return publicApiError("Unsupported social provider.", "SOCIAL_PROVIDER_NOT_FOUND", 404);
  let body: Record<string, unknown> = {};
  try { body = (await request.json()) as Record<string, unknown>; }
  catch { return publicApiError("Malformed request body.", "INVALID_JSON", 400); }

  if (body.mode === "manual") {
    const validated = validateManualSocialProfile({
      provider,
      accountKind: body.accountKind === "professional" ? "professional" : "personal",
      profileUrl: body.profileUrl,
    });
    if (!socialProviderAvailability()[provider].manual) {
      return publicApiError("Manual connection is unavailable for this provider.", "SOCIAL_PROVIDER_MODE_UNAVAILABLE", 400);
    }
    if (!validated.ok) return publicApiError(validated.error, "INVALID_SOCIAL_PROFILE", 400);
    try {
      const row = await socialConnectionStore().saveManual(ownerId, {
        provider: "instagram",
        username: validated.username,
        profileUrl: validated.profileUrl,
      });
      return jsonNoStore({ connection: publicSocialConnection(row) }, { status: 201 });
    } catch {
      return publicApiError("Connected accounts are unavailable.", "SOCIAL_CONNECTIONS_UNAVAILABLE", 503, { retryable: true });
    }
  }

  try {
    if (!socialProviderAvailability()[provider].oauth) {
      return publicApiError("That social connection is not configured.", "SOCIAL_PROVIDER_UNAVAILABLE", 503, { retryable: false });
    }
    const rateKey = `social-oauth:${ownerId}:${hashIp(clientIp(request))}`;
    if (await isLimited(rateKey, rateKey, 10, 10 * 60_000)) {
      return publicApiError("Too many connection attempts. Try again shortly.", "SOCIAL_CONNECTION_RATE_LIMITED", 429, { retryable: true });
    }
    const origin = process.env.NODE_ENV === "production"
      ? new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://pubmaxxing.com").origin
      : new URL(request.url).origin;
    return jsonNoStore(await createSocialOAuthStart({ ownerId, provider, origin }));
  } catch (error) {
    return publicApiError(error instanceof Error ? error.message : "OAuth is unavailable.", "SOCIAL_PROVIDER_UNAVAILABLE", 503, { retryable: true });
  }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const ownerId = await callerUserId(request);
  if (!ownerId) return publicApiError("Sign in to disconnect an account.", "AUTH_REQUIRED", 401);
  const provider = (await context.params).provider;
  if (!isSocialProvider(provider)) return publicApiError("Unsupported social provider.", "SOCIAL_PROVIDER_NOT_FOUND", 404);
  try {
    await socialConnectionStore().disconnect(ownerId, provider);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch {
    return publicApiError("Connected accounts are unavailable.", "SOCIAL_CONNECTIONS_UNAVAILABLE", 503, { retryable: true });
  }
}
