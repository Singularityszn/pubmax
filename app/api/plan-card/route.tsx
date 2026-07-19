import { ImageResponse } from "next/og";

import { ogCardRateLimitedResponse } from "@/lib/ogCardRateLimit";
import { CrossingMark, loadOgFonts, loadPartyFont } from "@/lib/ogBrand";
import { planCollaborationStore } from "@/lib/planCollaborationStore";
import { planStore } from "@/lib/planStore";
import { vibeTallyLine } from "@/lib/vibeTally";

export const runtime = "nodejs";

// Plan invite share card. This is the picture a mate sees in the group chat
// when the plan link lands, so it carries the same field-guide brand lockup as
// its sibling "A Crawl Story" card (app/api/crawl-card): the Crossing mark in a
// brass chip, the wordmark, the printed-guidebook palette. Before this it drew a
// bare "PUBMAXXING" wordmark on an off-brand cream field with no mark at all,
// the one share surface #382 left without the Crossing mark. Kept in lockstep
// with the crawl card so the two "your night" artifacts read as siblings.

// Brand palette (mirrors app/api/crawl-card/route.tsx — the "printed guidebook"
// look, brass on ink). satori only understands literal styles, so the hexes are
// declared here rather than pulled from a CSS variable.
const PAPER = "#12100c"; // deep charcoal-green paper
const CREAM = "#ece3d2"; // warm cream ink
const CREAM_DIM = "#a99f8b"; // secondary ink
const BRASS = "#d3a44a"; // single accent

const serif = 'Georgia, "Times New Roman", serif';
const sans = 'Helvetica, "Helvetica Neue", Arial, sans-serif';

// Vibe stamp (docs/VIBE_LAYER_SPEC_2026-07-19.md, surface 3). The ?vibe= param
// is validated against exactly the seven owner-locked chip slugs — an
// unrecognised value renders the base card, never an arbitrary string onto the
// image (user-controlled text on a shared OG card is an abuse surface). Labels
// are the chip labels verbatim, uppercased by the stamp itself.
const VIBE_STAMPS: Record<string, string> = {
  "on-a-bender": "On a bender",
  "get-lit": "Get lit",
  "quiet-pint": "Quiet pint",
  "cheeky-one-after-work": "Cheeky one after work",
  "match-on": "Match on",
  "big-brain-energy": "Big brain energy",
  "date-night": "Date night",
};

// Stamp colours per spec: brass shade under coral face on ink dark. Coral is
// the app's Candle-Coral action accent (lib/ogBrand OG.coral); the shade layer
// is this card's own field-guide brass so the stamp sits in the card's palette.
const STAMP_CORAL = "#ff5a5f";

// Strip control chars and cap length. Plan title + venue names are user-entered,
// so they are never rendered unbounded onto the card.
function clamp(raw: string, max: number): string {
  const clean = Array.from(raw)
    .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
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
  // the plan has votes, so the no-votes render path stays byte-identical. Reads
  // fail-soft — a tally error just drops the line, the card still renders. The
  // line is house prose (serif), never the party face (Bungee is stamp-only).
  const tallyResult = await planCollaborationStore().vibeTally(id);
  const tallyLine = tallyResult.ok ? vibeTallyLine(tallyResult.tally) : null;
  const stops = state.stops
    .slice()
    .sort((a, b) => a.position - b.position)
    .slice(0, 4);
  const start = new Date(state.plan.startTime).toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  });
  const crewLine =
    state.crew.length === 1 ? "1 in" : `${state.crew.length} in`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: PAPER,
          color: CREAM,
          padding: 68,
          fontFamily: sans,
          position: "relative",
        }}
      >
        {/* Hairline field-guide border */}
        <div
          style={{
            position: "absolute",
            top: 28,
            left: 28,
            right: 28,
            bottom: 28,
            border: `2px solid rgba(211,164,74,0.42)`,
            borderRadius: 6,
            display: "flex",
          }}
        />

        {/* Header: Crossing-mark lockup + edition line */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            zIndex: 1,
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                width: 76,
                height: 76,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 14,
                background: BRASS,
                marginRight: 26,
              }}
            >
              <CrossingMark ink={PAPER} size={52} />
            </div>
            <div
              style={{
                fontFamily: serif,
                fontSize: 42,
                fontWeight: 700,
                letterSpacing: 0.5,
              }}
            >
              PUBMAXXING
            </div>
          </div>
          <div
            style={{
              // display:flex is load-bearing: satori rejects any div holding
              // more than one child node (text + expression counts) without an
              // explicit display, 500ing the whole card.
              display: "flex",
              fontFamily: serif,
              fontStyle: "italic",
              color: BRASS,
              fontSize: 24,
              letterSpacing: 2,
            }}
          >
            First pint · {start}
          </div>
        </div>

        {/* Body: title on the left, numbered route on the right */}
        <div style={{ display: "flex", flex: 1, marginTop: 40, zIndex: 1 }}>
          <div
            style={{
              width: "48%",
              display: "flex",
              flexDirection: "column",
              paddingRight: 48,
            }}
          >
            {vibeLabel ? (
              /* Vibe stamp: the crew's declared night, in the party face.
                 Layered per spec — brass shade offset under the coral face —
                 with a slight tilt so it reads as a stamp, not a heading. */
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  marginBottom: 20,
                  transform: "rotate(-3deg)",
                  transformOrigin: "left bottom",
                }}
              >
                <div
                  style={{
                    color: BRASS,
                    fontSize: 20,
                    fontWeight: 700,
                    letterSpacing: 6,
                    textTransform: "uppercase",
                    marginBottom: 10,
                    display: "flex",
                  }}
                >
                  Tonight
                </div>
                <div style={{ display: "flex", position: "relative" }}>
                  <div
                    style={{
                      position: "absolute",
                      top: 4,
                      left: 4,
                      display: "flex",
                      fontFamily: "Bungee",
                      fontSize: vibeLabel.length > 12 ? 34 : 46,
                      lineHeight: 1.15,
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      color: BRASS,
                      opacity: 0.55,
                    }}
                  >
                    {vibeLabel}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      fontFamily: "Bungee",
                      fontSize: vibeLabel.length > 12 ? 34 : 46,
                      lineHeight: 1.15,
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      color: STAMP_CORAL,
                    }}
                  >
                    {vibeLabel}
                  </div>
                </div>
              </div>
            ) : (
              <div
                style={{
                  color: BRASS,
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: 6,
                  textTransform: "uppercase",
                  marginBottom: 18,
                  display: "flex",
                }}
              >
                Your night is sorted
              </div>
            )}
            <div
              style={{
                display: "flex",
                fontFamily: serif,
                fontSize: clamp(state.plan.title, 62).length > 30 ? 52 : 62,
                lineHeight: 1.03,
                fontWeight: 700,
              }}
            >
              {clamp(state.plan.title, 62)}
            </div>
            {tallyLine ? (
              /* Crew vibe tally: house prose under the title, never the party
                 face. Only rendered when the plan has votes. */
              <div
                style={{
                  display: "flex",
                  marginTop: 22,
                  fontFamily: serif,
                  fontStyle: "italic",
                  fontSize: 25,
                  lineHeight: 1.25,
                  color: CREAM_DIM,
                }}
              >
                {clamp(tallyLine, 90)}
              </div>
            ) : null}
          </div>
          <div
            style={{
              width: "52%",
              display: "flex",
              flexDirection: "column",
              borderLeft: `3px solid ${BRASS}`,
              paddingLeft: 38,
              gap: 16,
            }}
          >
            {stops.map((stop, index) => (
              <div
                key={`${stop.position}-${stop.venueId}`}
                style={{ display: "flex", alignItems: "center", gap: 18 }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: PAPER,
                    background: BRASS,
                    fontSize: 21,
                    fontWeight: 700,
                  }}
                >
                  {index + 1}
                </div>
                <div
                  style={{
                    display: "flex",
                    fontFamily: serif,
                    fontSize: 29,
                    fontWeight: 700,
                  }}
                >
                  {clamp(stop.venueName, 38)}
                </div>
              </div>
            ))}
            {state.stops.length > stops.length ? (
              <div
                style={{
                  display: "flex",
                  fontSize: 21,
                  color: CREAM_DIM,
                  paddingLeft: 62,
                }}
              >
                + {state.stops.length - stops.length} more
              </div>
            ) : null}
          </div>
        </div>

        {/* Footer: crew + call to action on the left, URL on the right */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 36,
            zIndex: 1,
          }}
        >
          <div
            style={{
              display: "flex",
              fontFamily: serif,
              fontStyle: "italic",
              color: CREAM,
              fontSize: 28,
            }}
          >
            {crewLine} · open the link · tap I&rsquo;m in
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              color: BRASS,
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            <div
              style={{
                width: 46,
                height: 2,
                background: BRASS,
                marginRight: 18,
              }}
            />
            pubmaxxing.com
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
      },
      // Fonts only when a stamp renders: satori resolves unknown family
      // strings (this card's Georgia/Helvetica) to the FIRST registered font,
      // so the Space Grotesk pair goes first (base typography lands on the
      // brand face) and Bungee last (only nodes that ask for it get it). The
      // unstamped card keeps its zero-font fast path exactly as before.
      ...(vibeLabel ? { fonts: [...loadOgFonts(), loadPartyFont()] } : {}),
    },
  );
}
