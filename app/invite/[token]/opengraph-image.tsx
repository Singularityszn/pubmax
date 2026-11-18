import { ImageResponse } from "next/og";
import { planStateResult, resolvePlanIdByInviteToken } from "@/lib/planStore";
import { buildInvitePrivacyPreview } from "@/lib/invitePrivacyPreview";
import { CardShell, OG, OG_CACHE_HEADERS, OG_SIZE, Wordmark, loadOgFonts } from "@/lib/ogBrand";

export const runtime = "nodejs";
export const alt = "You're invited on PUBMAXX";
export const size = OG_SIZE;
export const contentType = "image/png";

async function loadCard(token: string) {
  try {
    const lookup = await resolvePlanIdByInviteToken(token);
    if (!lookup.ok || !lookup.planId) return null;
    const result = await planStateResult(lookup.planId);
    return result.ok && result.plan ? buildInvitePrivacyPreview(result.plan) : null;
  } catch { return null; }
}

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = await loadCard(token);
  return new ImageResponse(
    <CardShell>
      <Wordmark />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 60, fontWeight: 700, color: OG.ink }}>
          {preview?.areaName ?? "You’re invited"}
        </div>
        <div style={{ display: "flex", fontSize: 26, color: OG.muted, marginTop: 14 }}>
          {preview ? `${preview.stopCount} stops · First pint ${preview.startLabel}` : "A pub crawl planned on PUBMAXX."}
        </div>
        {preview ? (
          <div style={{ display: "flex", fontSize: 30, color: OG.ink, marginTop: 30 }}>
            Join the crew to see the route
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", color: OG.muted, fontSize: 24 }}>pubmaxxing.com</div>
    </CardShell>,
    { ...size, fonts: loadOgFonts(), headers: OG_CACHE_HEADERS },
  );
}
