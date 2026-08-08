import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import {
  ReferralIdentityDeletedError,
  referralStore,
} from "@/lib/referralStore";
import { siteOrigin } from "@/lib/siteUrl";

export async function POST(request: Request): Promise<Response> {
  const userId = await callerUserId(request);
  if (!userId) {
    return publicApiError("Sign in to get your invite link.", "UNAUTHENTICATED", 401);
  }
  let code: string;
  try {
    ({ code } = await referralStore().getOrCreateInviteCode(userId));
  } catch (error) {
    if (error instanceof ReferralIdentityDeletedError) {
      return publicApiError(error.message, "CONFLICT", 409);
    }
    return publicApiError("Your invite link could not be made right now.", "UNAVAILABLE", 503, { retryable: true });
  }
  const url = new URL(
    `/r/${encodeURIComponent(code)}`,
    siteOrigin(request.url) ?? request.url,
  );
  return jsonNoStore({ url: url.toString() });
}
