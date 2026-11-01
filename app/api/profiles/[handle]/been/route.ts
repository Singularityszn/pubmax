// The passport's Been read: how many pubs this account has been to, and which.
//
// GET /api/profiles/[handle]/been -> 200 { access, status, count, venues, wantToTryCount, cover }
//
// The owner reads every source: the diary, their Pint Drops and the plans they
// finished. A mate, or any reader of a public account, reads only the Pint
// Drops the drop store already lets them read, because the diary and a plan
// are private. A private account answers 403 to everybody else. The rules are
// lib/profilePassport.ts; the reads are lib/profilePassport.server.ts.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { isLimited } from "@/lib/pintDrops";
import { readPassportBeen } from "@/lib/profilePassport.server";
import { clientIp, hashIp } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PER_IP_LIMIT = 60;
const WINDOW_MS = 60_000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const key = `passport-been:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key, PER_IP_LIMIT, WINDOW_MS)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }
  const result = await readPassportBeen(request, (await params).handle ?? "");
  if (!result.ok) {
    return publicApiError(result.error, result.code, result.status, { retryable: result.status === 503 });
  }
  return jsonNoStore(result.body, { status: 200 });
}
