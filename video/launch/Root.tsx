// The Remotion root for the launch video: the full video, a silent cut, the
// thumbnail still, and each scene on its own for editing in Studio.

import type { ReactNode } from "react";
import { Composition, Folder, Still } from "remotion";

import { LaunchVideo } from "./LaunchVideo";
import { EndCard } from "./scenes/EndCard";
import { HookScene } from "./scenes/HookScene";
import { ProductStage } from "./scenes/ProductStage";
import { Thumbnail } from "./scenes/Thumbnail";
import { Backdrop } from "./scenes/Backdrop";
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
