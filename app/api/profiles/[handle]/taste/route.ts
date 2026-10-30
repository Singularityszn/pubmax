// The owner's "Your taste, in facts" card.
//
// GET /api/profiles/[handle]/taste -> 200 { facts } (owner only; 403 to anybody else)
//
// Every line is a stored fact with its day: the drink logged most, the borough
// of the pub ranked first, the dates on the pubs in the top five, the fair pint
// from the Night Profile. No inference. An empty list means no card.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { isLimited } from "@/lib/pintDrops";
import { readPassportTaste } from "@/lib/profilePassport.server";
import { clientIp, hashIp } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PER_IP_LIMIT = 30;
const WINDOW_MS = 60_000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const key = `passport-taste:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key, PER_IP_LIMIT, WINDOW_MS)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }
  const result = await readPassportTaste(request, (await params).handle ?? "");
  if (!result.ok) {
    return publicApiError(result.error, result.code, result.status, { retryable: result.status === 503 });
  }
  return jsonNoStore(result.body, { status: 200 });
}
