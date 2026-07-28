import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { referralStore } from "@/lib/referralStore";
import { siteOrigin } from "@/lib/siteUrl";

export async function POST(request: Request): Promise<Response> {
  const userId = await callerUserId(request);
  if (!userId) {
    return jsonNoStore(
      { error: "Sign in to get your invite link." },
      { status: 401 },
    );
  }
  let code: string;
  try {
    ({ code } = await referralStore().getOrCreateInviteCode(userId));
  } catch {
    return jsonNoStore(
      { error: "Your invite link could not be made right now." },
      { status: 503 },
    );
  }
  const url = new URL(
    `/r/${encodeURIComponent(code)}`,
    siteOrigin(request.url) ?? request.url,
  );
  return jsonNoStore({ url: url.toString() });
}
