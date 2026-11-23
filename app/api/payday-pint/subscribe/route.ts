import { publicApiError } from "@/lib/apiError";
import { parseEmail } from "@/lib/emailAddress";
import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";
import { paydayStationsWithPints } from "@/lib/paydayPint";
import { paydayStations, paydayVenues } from "@/lib/paydayPintData.server";
import { paydayDeliveryReady } from "@/lib/paydayPintFlags.server";
import { requestPaydayPint } from "@/lib/paydayPintSignup.server";

export async function POST(request: Request): Promise<Response> {
  if (!paydayDeliveryReady()) return publicApiError("Email signup is not available yet.", "UNAVAILABLE", 503);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return publicApiError("Invalid request.", "INVALID_REQUEST", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return publicApiError("Invalid request.", "INVALID_REQUEST", 400);
  const email = parseEmail(body.email);
  const station = typeof body.station === "string" ? paydayStationsWithPints(await paydayStations(), await paydayVenues()).find((item) => item.name === body.station) : undefined;
  if (!email || !station || body.consent !== true || body.adult !== true) return publicApiError("Enter an email, select a station and confirm both choices.", "INVALID_REQUEST", 400);
  const ip = `payday-pint:${hashIp(clientIp(request))}`;
  if (await isLimited(ip, ip, 5, 60_000, { failClosed: true }) || await isLimited("payday-pint:global", "payday-pint:global", 100, 60_000, { failClosed: true })) return publicApiError("Too many requests. Try again later.", "RATE_LIMITED", 429);
  try {
    if (await requestPaydayPint(email, station.name)) return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {}
  return publicApiError("Could not send a confirmation. Try again later.", "UNAVAILABLE", 503);
}
