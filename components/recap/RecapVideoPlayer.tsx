"use client";

// The Remotion Player for the recap video. It never plays on its own: the
// person presses play, so a reader who prefers reduced motion is never shown
// motion they did not ask for.
//
// `acknowledgeRemotionLicense`: PUBMAXX uses Remotion under its Free License,
// which covers a for-profit organisation of up to three people, contractors
// included (captain's confirmation, 18 October 2026). A larger team needs a
// Remotion Company License before this flag is turned on in production.

import { Player } from "@remotion/player";

import RecapVideo from "@/components/recap/RecapVideo";
import { RECAP_VIDEO_FPS, RECAP_VIDEO_HEIGHT, RECAP_VIDEO_WIDTH, type RecapVideoInput } from "@/lib/recapVideo";

export default function RecapVideoPlayer({ input }: { input: RecapVideoInput }) {
  return (
    <Player
      component={RecapVideo}
      inputProps={input}
      durationInFrames={input.timing.durationInFrames}
      fps={RECAP_VIDEO_FPS}
      compositionWidth={RECAP_VIDEO_WIDTH}
      compositionHeight={RECAP_VIDEO_HEIGHT}
      controls
      clickToPlay
      autoPlay={false}
      acknowledgeRemotionLicense
      className="recapVideo__player"
      style={{ width: "100%", aspectRatio: `${RECAP_VIDEO_WIDTH} / ${RECAP_VIDEO_HEIGHT}` }}
    />
  );
}
