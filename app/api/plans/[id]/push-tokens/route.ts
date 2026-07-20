// Plan-member join for an existing anonymous push registration.
//
// The member id is never accepted from the client. The existing Plan bearer or
// path-scoped HttpOnly session is verified and resolved to its canonical member
// before the push store is touched. This route only establishes/revokes the
// private query join; it never sends a targeted notification.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { isPlanId } from "@/lib/plan";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { planMemberIdentityResult } from "@/lib/planStore";
import { pushTokenStore, validatePushToken } from "@/lib/pushTokenStore";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();
type Context = { params: Promise<{ id: string }> };

async function bodyOf(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function verifiedMember(
  request: Request,
  planId: string,
  body: Record<string, unknown>,
): Promise<
  | { ok: true; memberId: string }
  | { ok: false; response: Response }
> {
  const capability = planMemberCapability(request, body.memberToken);
  if (!capability) {
    return {
      ok: false,
      response: publicApiError("Add a valid Plan member capability.", "PUSH_PLAN_AUTH_REQUIRED", 401),
    };
  }
  const result = await planMemberIdentityResult(planId, capability);
  if (!result.ok) {
    return {
      ok: false,
      response: publicApiError("Plan membership is temporarily unavailable.", "PUSH_PLAN_IDENTITY_UNAVAILABLE", 503, { retryable: true }),
    };
  }
  if (!result.identity) {
    return {
      ok: false,
      response: publicApiError("That Plan member capability is not active.", "PUSH_PLAN_AUTH_FORBIDDEN", 403),
    };
  }
  return { ok: true, memberId: result.identity.memberId };
}

async function requestParts(request: Request, context: Context): Promise<
  | { ok: true; planId: string; body: Record<string, unknown> }
  | { ok: false; response: Response }
> {
  const { id } = await context.params;
  if (!isPlanId(id)) {
    return { ok: false, response: publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404) };
  }
  const body = await bodyOf(request);
  if (!body) return { ok: false, response: publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400) };
  return { ok: true, planId: id, body };
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const parts = await requestParts(request, context);
  if (!parts.ok) return parts.response;
  const authority = await verifiedMember(request, parts.planId, parts.body);
  if (!authority.ok) return authority.response;
  const validation = validatePushToken(parts.body);
  if (!validation.ok) return publicApiError(validation.error, "INVALID_REQUEST", 400);

  const result = await pushTokenStore().linkPlan(
    validation.input.token,
    parts.planId,
    authority.memberId,
  );
  if (result === "linked" || result === "replayed") {
    return jsonNoStore({ ok: true, linked: true }, { status: 200 });
  }
  if (result === "error") {
    return publicApiError("Could not link Plan notifications. Try again.", "PUSH_PLAN_LINK_UNAVAILABLE", 503, { retryable: true });
  }
  // Missing and another member's existing link deliberately collapse.
  return publicApiError("That notification registration cannot be linked.", "PUSH_PLAN_LINK_CONFLICT", 409);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const parts = await requestParts(request, context);
  if (!parts.ok) return parts.response;
  const authority = await verifiedMember(request, parts.planId, parts.body);
  if (!authority.ok) return authority.response;
  const validation = validatePushToken(parts.body);
  if (!validation.ok) return publicApiError(validation.error, "INVALID_REQUEST", 400);

  try {
    await pushTokenStore().unlinkPlan(
      validation.input.token,
      parts.planId,
      authority.memberId,
    );
  } catch {
    return publicApiError("Could not unlink Plan notifications. Try again.", "PUSH_PLAN_UNLINK_UNAVAILABLE", 503, { retryable: true });
  }
  return jsonNoStore({ ok: true, linked: false }, { status: 200 });
}
