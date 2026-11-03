// The 15-second launch video: find a pub, build a plan, send it to the group.
//
// The story is carried by the words on screen, so it reads with the sound off.
// The sound is optional: pass `muted` to render with no audio at all. Every
// sound is original and synthesised by make-audio.mjs.

import { AbsoluteFill, Html5Audio, Sequence, staticFile } from "remotion";

import { Backdrop } from "./scenes/Backdrop";
import { EndCard } from "./scenes/EndCard";
import { BUBBLE_FRAMES, HookScene } from "./scenes/HookScene";
import { BLOCKS, FIND, ProductStage } from "./scenes/ProductStage";
import { loadBrandFonts } from "./fonts";
import { HANDOVER, SCENES } from "./theme";

export type LaunchVideoProps = {
  /** True renders the video with no audio track. */
  muted: boolean;
};

loadBrandFonts();

const stage = SCENES.find.from;

/** Where each short sound plays, in frames of the whole video. */
const SOUND_CUES = [
  ...BUBBLE_FRAMES.map((frame, index) => ({ src: `audio/pop-${index + 1}.wav`, frame: Math.max(0, frame), volume: 0.9 })),
  { src: "audio/whoosh.wav", frame: stage - 8, volume: 0.6 },
  // The ring lands on Feeley's pin, then on its price.
  { src: "audio/click.wav", frame: stage + FIND.pin + 2, volume: 0.55 },
  { src: "audio/click.wav", frame: stage + FIND.price, volume: 0.55 },
  { src: "audio/whoosh.wav", frame: stage + BLOCKS.plan.from - HANDOVER - 6, volume: 0.5 },
  // The ring walks the three stops.
  ...[44, 63, 82].map((at) => ({ src: "audio/click.wav", frame: stage + BLOCKS.plan.from - HANDOVER + at, volume: 0.45 })),
  { src: "audio/whoosh.wav", frame: stage + BLOCKS.share.from - HANDOVER - 6, volume: 0.5 },
  { src: "audio/click.wav", frame: stage + BLOCKS.share.from - HANDOVER + 28, volume: 0.6 },
  { src: "audio/chime.wav", frame: SCENES.end.from, volume: 0.6 },
] as const;

export function LaunchVideo({ muted }: LaunchVideoProps) {
  return (
    <AbsoluteFill>
      <Backdrop />
      {/* The hook runs two frames past its slot, while its bubbles finish leaving. */}
      <Sequence from={SCENES.hook.from} durationInFrames={SCENES.hook.durationInFrames + 2} name="Hook">
        <HookScene />
      </Sequence>
      <Sequence
        from={SCENES.find.from}
        durationInFrames={SCENES.end.from - SCENES.find.from}
        name="Product: find, plan, share"
      >
        <ProductStage />
      </Sequence>
      <Sequence from={SCENES.end.from} durationInFrames={SCENES.end.durationInFrames} name="End card">
        <EndCard />
      </Sequence>
      {muted ? null : (
        <>
          <Html5Audio src={staticFile("audio/music-bed.wav")} volume={0.9} />
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
