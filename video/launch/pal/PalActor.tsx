// The 3D Pal as one actor across the whole cut. One WebGL canvas draws it; the
// cut only moves and sizes that canvas between roles, and turns the model.
//
//   hire   it spins in beside the job advert and takes the job
//   chat   it sits by the headline and watches the screen it is working on
//   out    it takes the stage and spins once: the admin is done
//   end    it stands above the logo

import { useCallback } from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";

import { PalModel3D, type PalPose } from "../components/PalModel3D";
import { PAL_SCENES } from "./palTheme";

/** The canvas is drawn at this size and only ever scaled down. */
const CANVAS = 640;

const ease = Easing.bezier(0.65, 0, 0.35, 1);
const settle = Easing.bezier(0.16, 1, 0.3, 1);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const { chat, out, end } = PAL_SCENES;

/** Where the Pal stands (centre, in video pixels) and how big it is drawn. */
const PLACES = [
  { frame: 40, x: 1280, y: 640, size: 500 },
  { frame: 70, x: 852, y: 640, size: 500 },
  { frame: chat.from - 14, x: 852, y: 640, size: 500 },
  { frame: chat.from + 10, x: 942, y: 184, size: 236 },
  { frame: out.from + 2, x: 942, y: 184, size: 236 },
  { frame: out.from + 16, x: 540, y: 400, size: 560 },
  { frame: end.from - 2, x: 540, y: 400, size: 560 },
  { frame: end.from + 14, x: 540, y: 262, size: 380 },
] as const;

function along(frame: number, pick: (place: (typeof PLACES)[number]) => number) {
  return interpolate(
    frame,
    PLACES.map((place) => place.frame),
    PLACES.map(pick),
    { ...clamp, easing: ease },
  );
}

/** The model's pose for a frame of the whole cut. Pure, so renders repeat. */
function palPose(frame: number): PalPose {
  const t = frame / 30;
  const sway = Math.sin(t * 2.1) * 6;
  const bob = Math.sin(t * 3.2) * 0.012;
  // It arrives spinning and lands facing the job advert's reader.
  const arrive = interpolate(frame, [40, 74], [380, 14], { ...clamp, easing: settle });
  // On the job it looks left at the screen, with a small nod as it works.
  const work = interpolate(frame, [chat.from - 6, chat.from + 12], [0, 1], { ...clamp, easing: ease });
  const done = interpolate(frame, [out.from + 4, out.from + 18], [0, 1], { ...clamp, easing: ease });
  // Out of office: one full spin and a hop.
  const spin = interpolate(frame, [out.from + 10, out.from + 26], [0, 360], { ...clamp, easing: ease });
  const hop = Math.sin(Math.PI * interpolate(frame, [out.from + 10, out.from + 30], [0, 1], clamp)) * 0.09;
  const yawWork = -30 + Math.sin(t * 1.4) * 5;
  const yawRest = arrive + sway;
  const yaw = (yawRest * (1 - work) + yawWork * work) * (1 - done) + (sway * 0.6 + spin) * done;
  const pitch = work * (1 - done) * (6 + Math.sin(t * 5) * 2) + Math.sin(t * 1.7) * 2;
  return { yaw, pitch, roll: Math.sin(t * 1.3) * 2, lift: bob + hop, scale: 1 };
}

export function PalActor() {
  const frame = useCurrentFrame();
  const pose = useCallback((f: number) => palPose(f), []);
  const x = along(frame, (place) => place.x);
  const y = along(frame, (place) => place.y);
  const size = along(frame, (place) => place.size);
  const glow = size * 0.9;
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {/* A soft coral glow and a floor shadow, so the Pal stands in the frame. */}
      <div
        style={{
          position: "absolute",
          left: x - glow / 2,
          top: y - glow / 2,
          width: glow,
          height: glow,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255, 90, 95, 0.28), rgba(255, 90, 95, 0) 65%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: x - size * 0.28,
          top: y + size * 0.36,
          width: size * 0.56,
          height: size * 0.08,
          borderRadius: "50%",
          background: "radial-gradient(ellipse, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0) 70%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: x - CANVAS / 2,
          top: y - CANVAS / 2,
          width: CANVAS,
          height: CANVAS,
          scale: String(size / CANVAS),
        }}
      >
        <PalModel3D size={CANVAS} pose={pose} />
      </div>
    </div>
  );
}
