// The owner's "Share your Been card" tap.
//
// GET /api/profiles/[handle]/been-card -> 200 { path, pubs } (owner only)
//
// The server counts the owner's Been list itself, picks their cheapest public
// pint, signs both and returns the link to the page that shows them
// (lib/beenCardShare.server.ts). It stores nothing, so it is a read: the
// signature is the whole of the link. Below the unlock count it answers 409.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { mintOwnBeenCardShare } from "@/lib/beenCardMint.server";
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
  const key = `been-card-share:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key, PER_IP_LIMIT, WINDOW_MS)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }
  const result = await mintOwnBeenCardShare(request, (await params).handle ?? "");
  if (!result.ok) {
    return publicApiError(result.error, result.code, result.status, { retryable: result.status === 503 });
  }
  return jsonNoStore({ path: result.path, pubs: result.pubs }, { status: 200 });
}
