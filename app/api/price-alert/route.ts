import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { contributionReadRefusalResponse } from "@/lib/contributionReadRefusal.server";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import { isLimited } from "@/lib/pintDrops";
import { isPriceAlertLocation, isPriceAlertThreshold } from "@/lib/priceAlert";
import { prepareListedPriceBaseline } from "@/lib/priceAlertListingsScan.server";
import { priceAlertStore } from "@/lib/priceAlertStore";
import { validatePushToken } from "@/lib/pushTokenStore";
import { decodeWebPushSubscription, encodeWebPushSubscription } from "@/lib/webPushSubscription";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const owner = await resolveContributionIdentity(request);
  if (!owner.ok) return contributionReadRefusalResponse(owner);
  try {
    const preference = await priceAlertStore().get(owner.accountId);
    return jsonNoStore(preference ? { enabled: true, thresholdPence: preference.thresholdPence } : { enabled: false });
  } catch {
    return publicApiError("Price alerts are unavailable. Try again.", "UNAVAILABLE", 503, { retryable: true });
  }
}

export async function POST(request: Request): Promise<Response> {
  const owner = await resolveContributionIdentity(request);
  if (!owner.ok) return jsonNoStore(owner.body, { status: owner.httpStatus });
  const key = `price-alert:${owner.accountId}`;
  if (await isLimited(key, key, 30, 60_000)) return publicApiError("Too many changes. Try again later.", "RATE_LIMITED", 429);
  let body: Record<string, unknown>;
  try {
    const input: unknown = await request.json();
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error();
    body = input as Record<string, unknown>;
  } catch {
    return publicApiError("Invalid request.", "INVALID_REQUEST", 400);
  }
  try {
    if (body.enabled === false) {
      await priceAlertStore().remove(owner.accountId);
      return jsonNoStore({ enabled: false });
    }
    const suppliedToken = typeof body.token === "string" ? body.token : "";
    const subscription = decodeWebPushSubscription(suppliedToken);
    const token = subscription ? encodeWebPushSubscription(subscription) : null;
    const { thresholdPence } = body;
    if (!isPriceAlertLocation(body) || !isPriceAlertThreshold(thresholdPence) || !token || !validatePushToken({ token, platform: "web" }).ok) {
      return publicApiError("Share your location and choose a price and a valid notification subscription.", "INVALID_REQUEST", 400);
    }
    await prepareListedPriceBaseline();
    await priceAlertStore().save(owner.accountId, { lat: body.lat, lng: body.lng, thresholdPence, token });
    return jsonNoStore({ enabled: true, thresholdPence });
  } catch {
    return publicApiError("Could not save the price alert. Try again.", "UNAVAILABLE", 503, { retryable: true });
  }
}
