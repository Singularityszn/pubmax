import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { contributionReadRefusalResponse } from "@/lib/contributionReadRefusal.server";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import { isNightAreaSlug } from "@/lib/nightAreaSlugs";
import { isLimited } from "@/lib/pintDrops";
import { isPriceAlertThreshold } from "@/lib/priceAlert";
import { priceAlertStore } from "@/lib/priceAlertStore";
import { priceAlertSnapshotVersion } from "@/lib/priceAlertSnapshotJob.server";
import { validatePushToken } from "@/lib/pushTokenStore";
import { decodeWebPushSubscription, encodeWebPushSubscription } from "@/lib/webPushSubscription";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const owner = await resolveContributionIdentity(request);
  if (!owner.ok) return contributionReadRefusalResponse(owner);
  try {
    const preference = await priceAlertStore().get(owner.accountId);
    return jsonNoStore(preference ? { enabled: true, area: preference.area, thresholdPence: preference.thresholdPence, status: preference.status } : { enabled: false });
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
    if (!isNightAreaSlug(body.area) || !isPriceAlertThreshold(body.thresholdPence) || !token || !validatePushToken({ token, platform: "web" }).ok) {
      return publicApiError("Choose an area and a valid notification subscription. Price alerts use a fixed £5 threshold.", "INVALID_REQUEST", 400);
    }
    await priceAlertStore().save(owner.accountId, { area: body.area, thresholdPence: body.thresholdPence, token }, priceAlertSnapshotVersion());
    const preference = await priceAlertStore().get(owner.accountId);
    if (!preference) throw new Error("Saved price alert is unavailable");
    return jsonNoStore({ enabled: true, area: preference.area, thresholdPence: preference.thresholdPence, status: preference.status });
  } catch {
    return publicApiError("Could not save the price alert. Try again.", "UNAVAILABLE", 503, { retryable: true });
  }
}
