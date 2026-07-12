import { ImageResponse } from "next/og";

import { ogCardRateLimitedResponse } from "@/lib/ogCardRateLimit";
import { planStore } from "@/lib/planStore";

export const runtime = "nodejs";

function clamp(raw: string, max: number): string {
  const clean = Array.from(raw).filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join("").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export async function GET(request: Request): Promise<Response> {
  const limited = await ogCardRateLimitedResponse(request, "og-plan-card");
  if (limited) return limited;

  const id = new URL(request.url).searchParams.get("id") ?? "";
  const state = id ? await planStore().get(id) : null;
  if (!state) return new Response("Plan not found", { status: 404 });
  const stops = state.stops.slice().sort((a, b) => a.position - b.position).slice(0, 4);
  const start = new Date(state.plan.startTime).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", background: "#f7f1e8", color: "#18211d", padding: "54px 66px", fontFamily: "Arial, sans-serif", position: "relative" }}>
      <div style={{ position: "absolute", inset: 26, border: "2px solid #ef6c5b", borderRadius: 28, display: "flex" }} />
      <div style={{ width: "100%", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 22, letterSpacing: 3, textTransform: "uppercase", color: "#b33b2e" }}>
          <strong>PUBMAXXING</strong><span>First pint · {start}</span>
        </div>
        <div style={{ display: "flex", flex: 1, marginTop: 44 }}>
          <div style={{ width: "48%", display: "flex", flexDirection: "column", paddingRight: 48 }}>
            <span style={{ fontSize: 21, color: "#7b655e", marginBottom: 14 }}>Your night is sorted</span>
            <div style={{ fontFamily: "Georgia, serif", fontSize: 58, lineHeight: 1.03, fontWeight: 700 }}>{clamp(state.plan.title, 62)}</div>
            <div style={{ marginTop: "auto", fontSize: 22, color: "#7b655e" }}>{state.crew.length} in · Open the link · Tap I&rsquo;m in</div>
          </div>
          <div style={{ width: "52%", display: "flex", flexDirection: "column", borderLeft: "3px solid #ef6c5b", paddingLeft: 38, gap: 16 }}>
            {stops.map((stop, index) => (
              <div key={`${stop.position}-${stop.venueId}`} style={{ display: "flex", alignItems: "center", gap: 18 }}>
                <div style={{ width: 42, height: 42, borderRadius: 21, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", background: "#ef6c5b", fontSize: 20, fontWeight: 700 }}>{index + 1}</div>
                <div style={{ fontFamily: "Georgia, serif", fontSize: 29, fontWeight: 700 }}>{clamp(stop.venueName, 38)}</div>
              </div>
            ))}
            {state.stops.length > stops.length ? <div style={{ fontSize: 21, color: "#7b655e", paddingLeft: 60 }}>+ {state.stops.length - stops.length} more</div> : null}
          </div>
        </div>
      </div>
    </div>,
    { width: 1200, height: 630, headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
}
