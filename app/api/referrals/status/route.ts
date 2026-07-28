import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { referralStore } from "@/lib/referralStore";

export async function GET(request: Request): Promise<Response> {
  const userId = await callerUserId(request);
  if (!userId) {
    return jsonNoStore(
      { error: "Sign in to view referral progress." },
      { status: 401 },
    );
  }
  try {
    return jsonNoStore(await referralStore().privateStatus(userId));
  } catch {
    return jsonNoStore(
      { error: "Referral progress is unavailable right now." },
      { status: 503 },
    );
  }
}
