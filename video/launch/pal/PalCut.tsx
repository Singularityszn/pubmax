// The Pub Pal cut: 20 seconds for X.
//
// Every other app is built to sell you something. This one you hire: it
// knows the listed prices, shows its sources, can't be bought and costs you
// nothing. It does the admin. You do the night.
//
// The 3D Pal is the real model the app ships, rendered frame by frame. The
// interface is real captures. The words carry the story with the sound off.

import { AbsoluteFill, Html5Audio, Sequence, staticFile } from "remotion";

import { BrandLockup } from "../components/Brand";
import { loadBrandFonts } from "../fonts";
import { Backdrop } from "../scenes/Backdrop";
import { HANDOVER } from "../theme";
import { DUTY_FRAMES, JobAd, STAMP_FRAME } from "./JobAd";
import { OutOfOffice } from "./OutOfOffice";
import { PalActor } from "./PalActor";
import { PalEnd } from "./PalEnd";
import { PAL_SCENES } from "./palTheme";
import { PalWork, WORK } from "./PalWork";
import { Ticker } from "./Ticker";

export type PalCutProps = {
  /** True renders the cut with no audio track. */
  muted: boolean;
};

loadBrandFonts();

const { hire, chat, admin, out, end } = PAL_SCENES;
/** The first frame of a work slot's own sequence (it starts a push early). */
const slotStart = (slot: { from: number }, first = false) => chat.from + slot.from - (first ? 0 : HANDOVER);

const SOUND_CUES = [
  ...DUTY_FRAMES.map((frame, index) => ({ src: `audio/pop-${Math.min(index + 1, 3)}.wav`, frame, volume: 0.55 })),
  { src: "audio/whoosh.wav", frame: 36, volume: 0.6 },
  { src: "audio/stamp.wav", frame: STAMP_FRAME, volume: 0.9 },
  { src: "audio/whoosh.wav", frame: chat.from - 12, volume: 0.5 },
  { src: "audio/click.wav", frame: slotStart(WORK.typed, true) + 24, volume: 0.55 },
  { src: "audio/click.wav", frame: slotStart(WORK.cards) + 16, volume: 0.5 },
  { src: "audio/click.wav", frame: slotStart(WORK.cards) + 40, volume: 0.5 },
  { src: "audio/click.wav", frame: slotStart(WORK.kept) + 12, volume: 0.5 },
  { src: "audio/click.wav", frame: slotStart(WORK.kept) + 38, volume: 0.6 },
  ...[14, 28, 42].map((at) => ({ src: "audio/click.wav", frame: slotStart(WORK.route) + at, volume: 0.45 })),
  { src: "audio/click.wav", frame: slotStart(WORK.saved) + 18, volume: 0.6 },
  { src: "audio/whoosh.wav", frame: out.from - 4, volume: 0.6 },
  { src: "audio/pop-3.wav", frame: out.from + 12, volume: 0.7 },
  { src: "audio/chime.wav", frame: end.from, volume: 0.6 },
] as const;

export function PalCut({ muted }: PalCutProps) {
  return (
    <AbsoluteFill>
      <Backdrop />
      <Sequence from={0} durationInFrames={end.from} name="Lockup" layout="none">
        <BrandLockup size={36} style={{ position: "absolute", top: 62, left: 80 }} />
      </Sequence>
      <Sequence from={hire.from} durationInFrames={hire.durationInFrames + 4} name="Hire: the job advert">
        <JobAd />
      </Sequence>
      <Sequence from={chat.from} durationInFrames={out.from - chat.from + 16} name="Work: ask, sources, admin">
        <PalWork />
      </Sequence>
      <Ticker from={chat.from + WORK.picks.from} until={admin.from + admin.durationInFrames} />
      <Sequence from={out.from} durationInFrames={out.durationInFrames} name="Out of office">
        <OutOfOffice />
      </Sequence>
      <Sequence from={end.from} durationInFrames={end.durationInFrames} name="End card">
        <PalEnd />
      </Sequence>
      <PalActor />
      {muted ? null : (
        <>
          <Html5Audio src={staticFile("audio/pal-music-bed.wav")} volume={0.9} />
          {SOUND_CUES.map((cue) => (
            <Sequence key={`${cue.src}-${cue.frame}`} from={cue.frame} durationInFrames={75} layout="none" name={cue.src}>
              <Html5Audio src={staticFile(cue.src)} volume={cue.volume} />
            </Sequence>
          ))}
        </>
      )}
    </AbsoluteFill>
  );
}
