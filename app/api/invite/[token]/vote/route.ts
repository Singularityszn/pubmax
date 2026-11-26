import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { resolveClassicInvitePlan } from "@/lib/planInviteResolve";
import { shortlistMutationResponse, shortlistWriteGate } from "@/lib/planShortlistHttp.server";
import { mutatePlanShortlist, readPlanShortlist } from "@/lib/planShortlistStore";
import { hashActor } from "@/lib/supabase";

type Context = { params: Promise<{ token: string }> };

function voterHash(request: Request): string | undefined {
  const id = request.headers.get("x-invite-voter");
  return id && /^[a-zA-Z0-9-]{16,100}$/.test(id) ? hashActor(id) : undefined;
}

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const token = (await params).token.toLowerCase();
  const invite = await resolveClassicInvitePlan(token);
  if ("response" in invite) return invite.response;
  const result = await readPlanShortlist(invite.planId, token, voterHash(request));
  if (result.status !== "found") return shortlistMutationResponse({ status: result.status });
  if (result.expired) return shortlistMutationResponse({ status: "expired" });
  return jsonNoStore({ shortlist: result.view });
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  const refusal = await shortlistWriteGate(request, "vote");
  if (refusal) return refusal;
  const token = (await params).token.toLowerCase();
  const invite = await resolveClassicInvitePlan(token);
  if ("response" in invite) return invite.response;
  const hash = voterHash(request);
  if (!hash) return publicApiError("Enable browser storage to save your vote.", "INVALID_REQUEST", 400);
  const body = await request.json().catch(() => null);
  if (typeof body?.venueId !== "string" || body.venueId.length > 120) {
    return publicApiError("Choose one of the shortlisted pubs.", "INVALID_REQUEST", 400);
  }
  return shortlistMutationResponse(await mutatePlanShortlist(invite.planId, {
    kind: "vote", venueId: body.venueId, voterHash: hash, token,
  }));
}
