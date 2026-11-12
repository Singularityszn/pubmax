// The owner's points and level.
//
// GET /api/profiles/[handle]/points -> 200 PointsBreakdown (owner only; 403 to anybody else)
//
// lib/points.ts owns the values; lib/points.server.ts reads the records.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { isLimited } from "@/lib/pintDrops";
import { readProfilePoints } from "@/lib/points.server";
import { clientIp, hashIp } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PER_IP_LIMIT = 30;
const WINDOW_MS = 60_000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const key = `profile-points:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key, PER_IP_LIMIT, WINDOW_MS)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }
  const result = await readProfilePoints(request, (await params).handle ?? "");
  if (!result.ok) {
    return publicApiError(result.error, result.code, result.status, { retryable: result.status === 503 });
  }
  return jsonNoStore(result.body, { status: 200 });
}
