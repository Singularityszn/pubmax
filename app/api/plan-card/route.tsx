import { ImageResponse } from "next/og";

import { ogCardRateLimitedResponse } from "@/lib/ogCardRateLimit";
import { CardShell, OG, OG_SIZE, Wordmark, loadOgFonts, loadPartyFont } from "@/lib/ogBrand";
import { clampOgText } from "@/lib/ogCardText";
import { planCollaborationStore } from "@/lib/planCollaborationStore";
import { buildPlanPrivacyPreview } from "@/lib/planPrivacy";
import { planStore } from "@/lib/planStore";
import { vibeTallyLine } from "@/lib/vibeTally";

export const runtime = "nodejs";

// Plan invite share card. This is the picture a mate sees in the group chat
// when the plan link lands, so it is drawn for the group chat first.
//
// THREE RULES.
//
// (1) IT IS THE SHARED BRAND KIT. The card opens on lib/ogBrand's shell, the
//     PUBMAXX wordmark and Space Grotesk, like every other share card. It used
//     to keep its own "printed guidebook" palette, a boxed mark that read as
//     another app's icon in a preview (lib/ogBrand.tsx, Wordmark), and a
//     system font on the unstamped card only, so the same plan changed face
//     when a vibe was added.
// (2) THE MIDDLE CARRIES THE INVITE. A chat app often shows only a small
//     square cut from the centre of the picture. So the headline and the dot
//     route sit on the centre line, and the brand and the address sit at the
//     edges, where a crop may lose them.
// (3) §4.10 STILL HOLDS. The card is crawler-visible and can never carry a
//     member capability, so it draws the privacy-safe preview only: the area,
//     the first pint's time, the stop count and the vibe. Never the user's
//     title, a venue name, the stop order or the crew size. The dot route is
//     one lit dot per stop on a straight line: a count, not a map.

// Vibe stamp (docs/VIBE_LAYER_SPEC_2026-07-19.md, surface 3). The ?vibe= param
// is validated against exactly the seven owner-locked chip slugs — an
// unrecognised value renders the base card, never an arbitrary string onto the
// image (user-controlled text on a shared OG card is an abuse surface). Labels
// are the chip labels verbatim, uppercased by the stamp itself.
const VIBE_STAMPS: Record<string, string> = {
  "on-a-bender": "Big one tonight",
  "get-lit": "Live and loud",
  "quiet-pint": "Quiet pint",
  "cheeky-one-after-work": "Cheeky one after work",
  "match-on": "Match on",
  "big-brain-energy": "Big brain energy",
  "date-night": "Date night",
};

// Stamp colours per spec: an amber shade under a coral face on the dark card.
// Coral is the app's Candle-Coral action accent (lib/ogBrand OG.coral).
const STAMP_CORAL = OG.coral;

/** The dot route: one lit amber dot per stop, small dim dots between them. */
function DotRoute({ stops }: { stops: number }) {
  const count = Math.max(1, Math.min(stops, 8));
  const stop = 34;
  const gap = count > 5 ? 74 : 104;
  const width = (count - 1) * gap + stop;
  const height = stop;
  const between = 4;
  const dots: Array<{ x: number; r: number; lit: boolean }> = [];
  for (let i = 0; i < count; i += 1) {
    const x = stop / 2 + i * gap;
    dots.push({ x, r: stop / 2, lit: true });
    if (i < count - 1) {
      for (let k = 1; k <= between; k += 1) {
        dots.push({ x: x + (gap * k) / (between + 1), r: 4, lit: false });
      }
    }
  }
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none">
      {dots.map((dot) => (
        <circle
          key={dot.x}
          cx={dot.x}
          cy={height / 2}
          r={dot.r}
          fill={dot.lit ? OG.amber : OG.muted}
          fillOpacity={dot.lit ? 1 : 0.5}
        />
      ))}
    </svg>
  );
}

export async function GET(request: Request): Promise<Response> {
  const limited = await ogCardRateLimitedResponse(request, "og-plan-card");
  if (limited) return limited;

  const params = new URL(request.url).searchParams;
  const id = params.get("id") ?? "";
  const state = id ? await planStore().get(id) : null;
  if (!state) return new Response("Plan not found", { status: 404 });
  // Validated vibe stamp or nothing; see VIBE_STAMPS above.
  const vibeLabel = VIBE_STAMPS[params.get("vibe") ?? ""] ?? null;
  // Crew vibe tally (share loop, surface 3). Additive: a line renders only when
  // the plan has votes. Reads fail-soft: a tally error just drops the line, the
  // card still renders. The line is house prose, never the party face (Bungee
  // is stamp-only).
  const tallyResult = await planCollaborationStore().vibeTally(id);
  const tallyLine = tallyResult.ok ? vibeTallyLine(tallyResult.tally) : null;
  // §4.10: the privacy-safe preview only (rule 3 above).
  const preview = buildPlanPrivacyPreview(state, tallyResult.ok ? tallyResult.tally : null);
  const safeHeadline = preview.areaName
    ? `A night out in ${preview.areaName}`
    : "A night out";
  const clampedHeadline = clampOgText(safeHeadline, 62, "", { collapseWhitespace: true });
  const start = preview.startLabel;
  const stopsLine = `${preview.stopCount} ${preview.stopCount === 1 ? "stop" : "stops"} · Join the crew to see the route`;

  return new ImageResponse(
    (
      <CardShell padding={60}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <Wordmark scale={0.9} />
          <div
            style={{
              // display:flex is load-bearing: satori rejects any div holding
              // more than one child node (text + expression counts) without an
              // explicit display, 500ing the whole card.
              display: "flex",
              color: OG.amber,
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            First pint · {start}
          </div>
        </div>

        {/* The centre line: stamp, headline, dot route, stop count. */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
          {vibeLabel ? (
            /* Vibe stamp: the crew's declared night, in the party face, an
               amber shade offset under the coral face, tilted so it reads as
               a stamp rather than a heading. */
            <div style={{ display: "flex", position: "relative", marginBottom: 18, transform: "rotate(-3deg)" }}>
              <div
                style={{
                  position: "absolute",
                  top: 4,
                  left: 4,
                  display: "flex",
                  fontFamily: "Bungee",
                  fontSize: vibeLabel.length > 12 ? 34 : 42,
                  lineHeight: 1.15,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  color: OG.amber,
                  opacity: 0.55,
                }}
              >
                {vibeLabel}
              </div>
              <div
                style={{
                  display: "flex",
                  fontFamily: "Bungee",
                  fontSize: vibeLabel.length > 12 ? 34 : 42,
                  lineHeight: 1.15,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  color: STAMP_CORAL,
                }}
              >
                {vibeLabel}
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                color: OG.muted,
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: 5,
                textTransform: "uppercase",
                marginBottom: 14,
              }}
            >
              Your night is sorted
            </div>
          )}
          <div
            style={{
              display: "flex",
              textAlign: "center",
              justifyContent: "center",
              color: OG.ink,
              fontSize: clampedHeadline.length > 30 ? 58 : 66,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: -1.5,
              maxWidth: 1040,
            }}
          >
            {clampedHeadline}
          </div>
          <div style={{ display: "flex", marginTop: 30 }}>
            <DotRoute stops={preview.stopCount} />
          </div>
          <div style={{ display: "flex", color: OG.inkSoft, fontSize: 26, marginTop: 18 }}>{stopsLine}</div>
          {tallyLine ? (
            <div style={{ display: "flex", color: OG.muted, fontSize: 22, marginTop: 10 }}>
              {clampOgText(tallyLine, 90, "", { collapseWhitespace: true })}
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <div style={{ display: "flex", color: OG.ink, fontSize: 26, fontWeight: 700 }}>
            Open the link · tap I&rsquo;m in
          </div>
          <div style={{ display: "flex", alignItems: "center", color: OG.coral, fontSize: 24, fontWeight: 700, letterSpacing: 1 }}>
            <div style={{ width: 40, height: 2, background: OG.coral, marginRight: 14 }} />
            pubmaxxing.com
          </div>
        </div>
      </CardShell>
    ),
    {
      ...OG_SIZE,
      headers: {
        "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
      },
      // satori resolves unknown family strings to the FIRST registered font,
      // so the Space Grotesk pair goes first (base typography lands on the
      // brand face) and Bungee last, only when a stamp renders, so only the
      // stamp asks for it.
      fonts: vibeLabel ? [...loadOgFonts(), loadPartyFont()] : loadOgFonts(),
    },
  );
}
