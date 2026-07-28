import { NextResponse } from "next/server";

import { callerAuthIdentity } from "@/lib/authServer";
import {
  clearReferralJourneyCookie,
  readReferralJourneyCookie,
} from "@/lib/referralAttributionCookie";
import { referralStore } from "@/lib/referralStore";

function reply(
  request: Request,
  body: unknown,
  status = 200,
  clearCookie = false,
): Response {
  const response = NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
  if (clearCookie) clearReferralJourneyCookie(response, request);
  return response;
}

export async function POST(request: Request): Promise<Response> {
  const identity = await callerAuthIdentity(request);
  if (!identity) {
    return reply(request, { error: "Sign in to record an invite." }, 401);
  }
  const token = readReferralJourneyCookie(request);
  if (!token) {
    return reply(request, { attributed: false, reason: "no_journey" });
  }
  if (!identity.createdAt) {
    return reply(
      request,
      { attributed: false, reason: "missing_account_creation_time" },
      200,
      true,
    );
  }

  let result: Awaited<
    ReturnType<ReturnType<typeof referralStore>["claimJourney"]>
  >;
  try {
    result = await referralStore().claimJourney({
      token,
      inviteeUserId: identity.id,
      inviteeCreatedAt: identity.createdAt,
    });
  } catch {
    return reply(
      request,
      { attributed: false, reason: "storage_unavailable" },
      503,
    );
  }
  if (result.ok) {
    return reply(request, { attributed: true }, 200, true);
  }
  return reply(
    request,
    { attributed: false, reason: result.reason },
    200,
    true,
  );
}

export async function DELETE(request: Request): Promise<Response> {
  return reply(request, { revoked: true }, 200, true);
}
