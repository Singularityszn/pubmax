import { NextResponse } from "next/server";

import { publicApiError } from "@/lib/apiError";
import { callerAuthIdentity } from "@/lib/authServer";
import { isReferralCode } from "@/lib/referrals";
import { referralStore } from "@/lib/referralStore";

function reply(body: unknown, status = 200): Response {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  const identity = await callerAuthIdentity(request);
  if (!identity) {
    return reply({ error: "Sign in to record an invite." }, 401);
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return publicApiError(
      "This referral handoff is invalid.",
      "INVALID_REQUEST",
      400,
      { retryable: false },
    );
  }
  const body = await request.json().catch(() => null) as
    | { code?: unknown }
    | null;
  const code = body?.code;
  if (!isReferralCode(code)) {
    return publicApiError(
      "This referral handoff is invalid.",
      "INVALID_REQUEST",
      400,
      { retryable: false },
    );
  }
  if (!identity.createdAt) {
    return reply(
      { attributed: false, reason: "missing_account_creation_time" },
    );
  }

  let result: Awaited<
    ReturnType<ReturnType<typeof referralStore>["claimCode"]>
  >;
  try {
    result = await referralStore().claimCode({
      code,
      inviteeUserId: identity.id,
      inviteeCreatedAt: identity.createdAt,
    });
  } catch {
    return publicApiError(
      "This invite could not be recorded right now.",
      "REFERRAL_STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
  if (result.ok) {
    return reply({ attributed: true });
  }
  return reply({ attributed: false, reason: result.reason });
}
