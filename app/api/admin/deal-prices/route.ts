import { isModerator } from "@/lib/adminAuth";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { boundedJson } from "@/lib/boundedRequest.server";
import { dealPriceStore } from "@/lib/dealPriceStore";
import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";

async function refusal(request: Request): Promise<Response | null> {
  if (!isModerator(request)) return publicApiError("Not authorised.", "FORBIDDEN", 403);
  const key = `admin-deals:${hashIp(clientIp(request))}`;
  return await isLimited(key, key, 60, 60_000) ? publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true }) : null;
}

export async function GET(request: Request): Promise<Response> {
  const denied = await refusal(request);
  if (denied) return denied;
  try { return jsonNoStore({ deals: await dealPriceStore().review() }); }
  catch { return publicApiError("Could not load reported deals.", "UNAVAILABLE", 503, { retryable: true }); }
}

export async function POST(request: Request): Promise<Response> {
  const denied = await refusal(request);
  if (denied) return denied;
  let body: unknown;
  try { body = await boundedJson(request, 2048); } catch { return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400); }
  if (!body || typeof body !== "object" || !("id" in body) || typeof body.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id) || !("action" in body) || (body.action !== "hide" && body.action !== "restore" && body.action !== "keep")) return publicApiError("Choose a deal and an action.", "INVALID_REQUEST", 400);
  if (!("revision" in body) || typeof body.revision !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.revision)) return publicApiError("Choose a deal version.", "INVALID_REQUEST", 400);
  try {
    if (!await dealPriceStore().moderate(body.id, body.action === "hide", body.revision)) return publicApiError("The deal changed. Refresh and review it again.", "CONFLICT", 409);
    return jsonNoStore({ ok: true });
  } catch { return publicApiError("Could not update the deal.", "UNAVAILABLE", 503, { retryable: true }); }
}
