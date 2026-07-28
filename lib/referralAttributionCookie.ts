import { NextResponse } from "next/server";

import { REFERRAL_ATTRIBUTION_DAYS } from "@/lib/referrals";

export const REFERRAL_JOURNEY_COOKIE = "pubmaxx_referral_journey";
const COOKIE_MAX_AGE_SECONDS = REFERRAL_ATTRIBUTION_DAYS * 24 * 60 * 60;

export function readReferralJourneyCookie(request: Request): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName !== REFERRAL_JOURNEY_COOKIE) continue;
    const value = rawValue.join("=");
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

export function setReferralJourneyCookie(
  response: NextResponse,
  request: Request,
  token: string,
): void {
  response.cookies.set({
    name: REFERRAL_JOURNEY_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    secure: new URL(request.url).protocol === "https:",
  });
}

export function clearReferralJourneyCookie(
  response: NextResponse,
  request: Request,
): void {
  response.cookies.set({
    name: REFERRAL_JOURNEY_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    secure: new URL(request.url).protocol === "https:",
  });
}
