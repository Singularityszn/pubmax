import { publicApiError } from "@/lib/apiError";
import { paydayPintEmail, selectPaydayPints } from "@/lib/paydayPint";
import { paydayStations, paydayVenues } from "@/lib/paydayPintData.server";

export async function GET(request: Request) {
  if (process.env.PAYDAY_PINT_PREVIEW !== "1") return publicApiError("Not found.", "not_found", 404);
  const name = new URL(request.url).searchParams.get("station") ?? "Oxford Circus";
  const stations = await paydayStations();
  const station = stations.find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (!station) return publicApiError("Station not found.", "not_found", 404);
  const venues = await paydayVenues();
  const message = paydayPintEmail(station, selectPaydayPints(station, venues), { to: "preview@example.invalid", unsubscribeUrl: "https://example.invalid/unsubscribe", postalAddress: "EXAMPLE ONLY" });
  return new Response(`<p>Preview only. No email has been sent. The unsubscribe link and sender address are examples.</p>${message.html}`, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
