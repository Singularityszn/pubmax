// The owner's "Share your card" tap on borough bingo (launch review D8).
//
// GET /api/profiles/[handle]/borough-bingo -> 200 { path, mark } (owner only)
//
// Borough bingo is the owner's own card, so nothing reads it in public. This
// route counts the owner's borough stamps on the server, signs the highest
// mark reached (11, 22 or 33) and returns the link to the page that shows it
// (lib/boroughBingoShare.server.ts). It stores nothing, so it is a read: the
// signature is the whole of the link. Below 11 squares it answers 409.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { mintOwnBoroughBingoShare } from "@/lib/boroughBingoMint.server";
import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PER_IP_LIMIT = 20;
const WINDOW_MS = 60 * 60_000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const key = `borough-bingo-share:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key, PER_IP_LIMIT, WINDOW_MS)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }
  const result = await mintOwnBoroughBingoShare(request, (await params).handle ?? "");
  if (!result.ok) {
    return publicApiError(result.error, result.code, result.status, { retryable: result.status === 503 });
  }
  return jsonNoStore({ path: result.path, mark: result.mark }, { status: 200 });
}
