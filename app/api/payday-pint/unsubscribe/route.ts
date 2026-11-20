import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";
import { paydayActionPage, validPaydayToken } from "@/lib/paydayPintAction.server";
import { paydayPintStore } from "@/lib/paydayPintStore";

export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");
  if (!validPaydayToken(token)) return paydayActionPage("Link unavailable", "This unsubscribe link is unavailable.");
  return paydayActionPage("Unsubscribe", "Stop the weekly payday pint email.", `/api/payday-pint/unsubscribe?token=${encodeURIComponent(token)}`, "Unsubscribe");
}
export async function POST(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");
  if (!validPaydayToken(token)) return new Response(null, { status: 400 });
  const key = `payday-action:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key, 500, 60_000, { failClosed: true }) || await isLimited("payday-action:global", "payday-action:global", 50_000, 60_000, { failClosed: true })) return new Response(null, { status: 429 });
  try {
    await paydayPintStore().unsubscribe(token, new Date().toISOString());
    const oneClick = (request.headers.get("content-type") ?? "").startsWith("application/x-www-form-urlencoded") && (await request.clone().text()).includes("List-Unsubscribe=One-Click");
    return oneClick ? new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } }) : paydayActionPage("Unsubscribed", "You will not receive the weekly payday pint email.");
  } catch { return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
