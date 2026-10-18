// The crawl recap video: a Remotion composition, a React component of the
// frame number. Five beats: the Plan name, one beat per Stop, the Route drawn
// between the Stops, the Friends the crew published, and the PUBMAXX
// wordmark. Every word and figure comes from `lib/recapVideo.ts`, which takes
// them from the published recap and invents none. Colours are the design
// system's own variables, so the video wears the page's theme.

import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";

import { BRAND_NAME } from "@/lib/brandNaming";
import type { RecapVideoInput, RecapVideoStop } from "@/lib/recapVideo";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

function useFadeIn(delay = 0, length = 12) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [delay, delay + length], [0, 1], clamp);
  const lift = interpolate(frame, [delay, delay + length], [40, 0], clamp);
  return { opacity, transform: `translateY(${lift}px)` };
}

const page: React.CSSProperties = {
  background: "var(--paper)",
  color: "var(--ink)",
  fontFamily: "var(--font-body)",
  padding: 96,
  justifyContent: "center",
};

const eyebrow: React.CSSProperties = {
  fontFamily: "var(--font-data)",
  fontSize: 40,
  letterSpacing: 4,
  textTransform: "uppercase",
  color: "var(--brass)",
  margin: 0,
};

const display: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontWeight: 700,
  lineHeight: 1.12,
  margin: 0,
};

function Intro({ title }: { title: string }) {
  const first = useFadeIn(0);
  const second = useFadeIn(8);
  return (
    <AbsoluteFill style={page}>
      <p style={{ ...eyebrow, ...first }}>A night out</p>
      <h1 style={{ ...display, fontSize: 120, marginTop: 32, ...second }}>{title}</h1>
    </AbsoluteFill>
  );
}

function StopBeat({ stop, number }: { stop: RecapVideoStop; number: number }) {
  const badge = useFadeIn(0);
  const name = useFadeIn(6);
  const detail = useFadeIn(14);
  return (
    <AbsoluteFill style={page}>
      <span
        style={{
          ...badge,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 140,
          height: 140,
          borderRadius: 999,
          background: "var(--brass)",
          color: "var(--color-on-accent)",
          fontFamily: "var(--font-data)",
          fontSize: 72,
          fontWeight: 700,
        }}
      >
        {number}
      </span>
      <h2 style={{ ...display, fontSize: 104, marginTop: 48, ...name }}>{stop.venueName}</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, marginTop: 48, ...detail }}>
        {stop.timeLabel ? (
          <span style={{ fontFamily: "var(--font-data)", fontSize: 56, color: "var(--ink-soft)" }}>{stop.timeLabel}</span>
        ) : null}
        {stop.priceLabels.map((label, index) => (
          <span
            key={`${label}-${index}`}
            style={{
              fontFamily: "var(--font-data)",
              fontSize: 56,
              fontWeight: 700,
              padding: "8px 28px",
              borderRadius: 999,
              background: "var(--price-plaque-surface)",
              border: "3px solid var(--price-plaque-border)",
              color: "var(--accent-price-ink)",
            }}
          >
            {label}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
}

function RouteBeat({ stops, durationInFrames }: { stops: RecapVideoStop[]; durationInFrames: number }) {
  const frame = useCurrentFrame();
  const heading = useFadeIn(0);
  // Without coordinates for at least two Stops, the route is drawn as a ladder
  // in order: the shape is unknown, and a guessed one would be invented.
  const sketched = stops.every((stop) => stop.point !== null);
  const points = stops.map((stop, index) =>
    sketched && stop.point
      ? stop.point
      : { x: 0.5, y: stops.length === 1 ? 0.5 : 0.1 + (0.8 * index) / (stops.length - 1) },
  );
  const size = 880;
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x * size} ${point.y * size}`).join(" ");
  const length = points.reduce(
    (total, point, index) =>
      index === 0 ? total : total + Math.hypot((point.x - points[index - 1]!.x) * size, (point.y - points[index - 1]!.y) * size),
    0,
  );
  const drawn = interpolate(frame, [10, Math.max(11, durationInFrames - 20)], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ ...page, justifyContent: "flex-start", paddingTop: 160 }}>
      <p style={{ ...eyebrow, ...heading }}>The route</p>
      <svg width={size} height={size} viewBox={`-40 -40 ${size + 80} ${size + 80}`} style={{ marginTop: 64 }} aria-hidden>
        <path
          d={path}
          fill="none"
          stroke="var(--amber)"
          strokeWidth={14}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={length || 1}
          strokeDashoffset={(length || 1) * (1 - drawn)}
        />
        {points.map((point, index) => {
          const shown = drawn >= (points.length === 1 ? 0 : index / (points.length - 1)) - 0.001;
          return (
            <g key={index} opacity={shown ? 1 : 0.25}>
              <circle cx={point.x * size} cy={point.y * size} r={34} fill="var(--brass)" />
              <text
                x={point.x * size}
                y={point.y * size + 14}
                textAnchor="middle"
                fontSize={38}
                fontWeight={700}
                fontFamily="var(--font-data)"
                fill="var(--color-on-accent)"
              >
                {index + 1}
              </text>
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
}

function FriendsBeat({ friends }: { friends: string[] }) {
  const heading = useFadeIn(0);
  const list = useFadeIn(8);
  return (
    <AbsoluteFill style={page}>
      <p style={{ ...eyebrow, ...heading }}>The crew</p>
      <ul style={{ listStyle: "none", padding: 0, margin: "40px 0 0", ...list }}>
        {friends.map((friend) => (
          <li key={friend} style={{ ...display, fontSize: 88, marginTop: 16 }}>
            {friend}
          </li>
        ))}
      </ul>
    </AbsoluteFill>
  );
}

function Outro() {
  const mark = useFadeIn(0);
  const line = useFadeIn(10);
  return (
    <AbsoluteFill style={{ ...page, alignItems: "center", textAlign: "center" }}>
      <p style={{ ...display, fontSize: 132, letterSpacing: 6, color: "var(--brass)", ...mark }}>{BRAND_NAME}</p>
      <p style={{ fontSize: 48, marginTop: 32, color: "var(--ink-soft)", ...line }}>Night logged on {BRAND_NAME}.</p>
    </AbsoluteFill>
  );
}

export default function RecapVideo(props: RecapVideoInput) {
  const { timing } = props;
  const stopsStart = timing.introFrames;
  const routeStart = stopsStart + timing.stopFrames * props.stops.length;
  const friendsStart = routeStart + timing.routeFrames;
  const outroStart = friendsStart + timing.friendsFrames;
  return (
    <AbsoluteFill style={{ background: "var(--paper)" }}>
      <Sequence durationInFrames={timing.introFrames}>
        <Intro title={props.title} />
      </Sequence>
      {props.stops.map((stop, index) => (
        <Sequence key={index} from={stopsStart + index * timing.stopFrames} durationInFrames={timing.stopFrames}>
          <StopBeat stop={stop} number={index + 1} />
        </Sequence>
      ))}
      <Sequence from={routeStart} durationInFrames={timing.routeFrames}>
        <RouteBeat stops={props.stops} durationInFrames={timing.routeFrames} />
      </Sequence>
      {timing.friendsFrames > 0 ? (
        <Sequence from={friendsStart} durationInFrames={timing.friendsFrames}>
          <FriendsBeat friends={props.friends} />
        </Sequence>
      ) : null}
      <Sequence from={outroStart} durationInFrames={timing.outroFrames}>
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
}
