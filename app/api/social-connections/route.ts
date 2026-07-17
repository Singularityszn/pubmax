import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { callerUserId } from "@/lib/authServer";
import { socialConnectionStore } from "@/lib/socialConnectionStore";
import { publicSocialConnection } from "@/lib/socialConnections";
import { assertServerEnv } from "@/lib/serverEnv";
import { socialProviderAvailability } from "@/lib/socialOAuth";

assertServerEnv();

export async function GET(request: Request): Promise<Response> {
  const ownerId = await callerUserId(request);
  if (!ownerId) return publicApiError("Sign in to manage connected accounts.", "AUTH_REQUIRED", 401);
  try {
    const rows = await socialConnectionStore().list(ownerId);
    return jsonNoStore({
      connections: rows.map(publicSocialConnection),
      providers: socialProviderAvailability(),
    });
  } catch {
    return publicApiError("Connected accounts are unavailable.", "SOCIAL_CONNECTIONS_UNAVAILABLE", 503, { retryable: true });
  }
}
