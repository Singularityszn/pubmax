import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";
import { paydayActionPage, validPaydayToken } from "@/lib/paydayPintAction.server";
import { paydayFeatureEnabled } from "@/lib/paydayPintFlags.server";
import { paydayTokenHash } from "@/lib/paydayPintSignup.server";
import { paydayPintStore } from "@/lib/paydayPintStore";

export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");
  if (!paydayFeatureEnabled() || !validPaydayToken(token)) return paydayActionPage("Link unavailable", "This confirmation link is unavailable.");
  return paydayActionPage("Confirm your email", "Confirm that you want the weekly payday pint email.", `/payday-pint/confirm?token=${encodeURIComponent(token)}`, "Confirm email");
}
export async function POST(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");
  if (!paydayFeatureEnabled() || !validPaydayToken(token)) return paydayActionPage("Link unavailable", "This confirmation link is unavailable.");
  const key = `payday-action:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key, 500, 60_000, { failClosed: true }) || await isLimited("payday-action:global", "payday-action:global", 50_000, 60_000, { failClosed: true })) return new Response(null, { status: 429 });
  try {
    const confirmed = await paydayPintStore().confirm(paydayTokenHash(token), new Date().toISOString());
    return confirmed ? paydayActionPage("Email confirmed", "You are signed up for the weekly payday pint email.") : paydayActionPage("Link unavailable", "This link has expired or was already used.");
  } catch { return paydayActionPage("Please try again", "We could not confirm your email."); }
}
