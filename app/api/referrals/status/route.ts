import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { referralStore } from "@/lib/referralStore";

export async function GET(request: Request): Promise<Response> {
  const userId = await callerUserId(request);
  if (!userId) {
    return publicApiError("Sign in to view referral progress.", "UNAUTHENTICATED", 401);
  }
  try {
    return jsonNoStore(await referralStore().privateStatus(userId));
  } catch {
    return publicApiError("Referral progress is unavailable right now.", "UNAVAILABLE", 503, { retryable: true });
  }
}
