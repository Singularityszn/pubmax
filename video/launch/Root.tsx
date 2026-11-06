// The Remotion root for both launch videos. Each has the full video, a silent
// cut and a thumbnail still, and the launch video's scenes stand alone too.
//
//   PubmaxxLaunch*  15 s: find a pub, build the plan, send it to the group.
//   PubPalCut*      20 s: hire the Pub Pal; it does the admin, you do the night.

import type { ReactNode } from "react";
import { Composition, Folder, Still } from "remotion";

import { LaunchVideo } from "./LaunchVideo";
import { EndCard } from "./scenes/EndCard";
import { HookScene } from "./scenes/HookScene";
import { ProductStage } from "./scenes/ProductStage";
import { Thumbnail } from "./scenes/Thumbnail";
import { Backdrop } from "./scenes/Backdrop";
import { PalCut } from "./pal/PalCut";
import { PalThumbnail } from "./pal/PalThumbnail";
import { PAL_VIDEO } from "./pal/palTheme";
import { SCENES, VIDEO } from "./theme";

function OnNight({ children }: { children: ReactNode }) {
  return (
    <>
      <Backdrop />
      {children}
    </>
  );
}

const HookAlone = () => (
  <OnNight>
    <HookScene />
  </OnNight>
);
const ProductAlone = () => (
  <OnNight>
    <ProductStage />
  </OnNight>
);
const EndAlone = () => (
  <OnNight>
    <EndCard />
  </OnNight>
);

export function RemotionRoot() {
  return (
    <>
      <Composition id="PubmaxxLaunch" component={LaunchVideo} {...VIDEO} defaultProps={{ muted: false }} />
      <Composition id="PubmaxxLaunchSilent" component={LaunchVideo} {...VIDEO} defaultProps={{ muted: true }} />
      <Still id="PubmaxxLaunchThumbnail" component={Thumbnail} width={VIDEO.width} height={VIDEO.height} />
      <Composition id="PubPalCut" component={PalCut} {...PAL_VIDEO} defaultProps={{ muted: false }} />
      <Composition id="PubPalCutSilent" component={PalCut} {...PAL_VIDEO} defaultProps={{ muted: true }} />
      <Still id="PubPalCutThumbnail" component={PalThumbnail} width={PAL_VIDEO.width} height={PAL_VIDEO.height} />
      <Folder name="Scenes">
        <Composition id="Hook" component={HookAlone} {...VIDEO} durationInFrames={SCENES.hook.durationInFrames} />
        <Composition
          id="FindPlanShare"
          component={ProductAlone}
          {...VIDEO}
          durationInFrames={SCENES.end.from - SCENES.find.from}
        />
        <Composition id="EndCard" component={EndAlone} {...VIDEO} durationInFrames={SCENES.end.durationInFrames} />
      </Folder>
    </>
  );
}
