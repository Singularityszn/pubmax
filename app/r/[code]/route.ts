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
  const destination = new URL("/", request.url);
  destination.hash = new URLSearchParams({ referral: code }).toString();
  const response = NextResponse.redirect(destination);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return publicApiError(
      "This referral handoff is invalid.",
      "INVALID_REQUEST",
      400,
      { retryable: false },
    );
  }
  const body = await request.json().catch(() => null) as
    | { consent?: unknown }
    | null;
  if (body?.consent !== true) {
    return publicApiError(
      "Referral attribution needs your consent.",
      "CONSENT_REQUIRED",
      400,
      { retryable: false },
    );
  }

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
  const response = NextResponse.json(
    { captured: Boolean(journey) },
    { headers: { "Cache-Control": "no-store" } },
  );
  if (journey) {
    setReferralJourneyCookie(response, request, journey.token);
  }
  return response;
}
