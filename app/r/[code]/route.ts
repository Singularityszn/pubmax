import { NextResponse } from "next/server";

import {
  readReferralJourneyCookie,
  setReferralJourneyCookie,
} from "@/lib/referralAttributionCookie";
import { publicApiError } from "@/lib/apiError";
import { isLimited } from "@/lib/pintDrops";
import { referralStore } from "@/lib/referralStore";
import { clientIp, hashIp } from "@/lib/supabase";

type RouteContext = {
  params: Promise<{ code: string }>;
};

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { code } = await context.params;
  const ipKey = `referral-journey:${hashIp(clientIp(request))}`;
  if (await isLimited(ipKey, ipKey, 120, 60 * 60 * 1_000)) {
    return publicApiError(
      "Too many visits to this invite link. Try again shortly.",
      "RATE_LIMITED",
      429,
      { retryable: true },
    );
  }
  const destination = new URL("/", request.url);
  const response = NextResponse.redirect(destination);
  let journey: Awaited<
    ReturnType<ReturnType<typeof referralStore>["startJourney"]>
  >;
  try {
    journey = await referralStore().startJourney(
      code,
      readReferralJourneyCookie(request),
    );
  } catch {
    return publicApiError(
      "This invite link is unavailable right now.",
      "REFERRAL_STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
  if (journey) {
    setReferralJourneyCookie(response, request, journey.token);
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}
