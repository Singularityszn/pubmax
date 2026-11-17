import { after } from "next/server";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { isCrossSiteRequest } from "@/lib/crossSiteRequest";
import { parseEmail } from "@/lib/emailAddress";
import { PASSWORD_RECOVERY_MESSAGE } from "@/lib/passwordRecovery";
import { sendPasswordRecoveryEmail } from "@/lib/passwordRecovery.server";
import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (isCrossSiteRequest(request)) {
    return publicApiError("Cross-site requests are not accepted.", "FORBIDDEN", 403);
  }
  const ipKey = `password-recovery:ip:${hashIp(clientIp(request))}`;
  const limited = await isLimited(ipKey, ipKey, 6, 15 * 60_000, { failClosed: true });
  const body: unknown = await request.json().catch(() => null);
  const email = parseEmail(body && typeof body === "object" && "email" in body ? body.email : null);
  if (!email) return publicApiError("Enter a valid email address.", "INVALID_INPUT", 400);

  // Account checks and delivery happen after the response, so neither can change its timing.
  if (!limited) after(async () => {
    try {
      const key = `password-recovery:account:${hashIp(email)}`;
      if (await isLimited(key, key, 3, 60 * 60_000, { failClosed: true })) return;
      await sendPasswordRecoveryEmail(email, request.url);
    } catch {
      console.warn("[password-recovery] Email delivery did not finish.");
    }
  });
  return jsonNoStore({ message: PASSWORD_RECOVERY_MESSAGE });
}
