// The Pal stage as a Remotion composition: a video of a Pal's REAL artwork
// turning, breathing, blinking and talking. The drawing is the shared WebGL
// pass (components/pal/palStageGl.ts); this file only feeds it the loop's pose
// for each frame (palStagePose in lib/palStageRig.ts) and the voice line's
// mouth level. Every motion repeats over the composition's length, so a
// render loops without a jump.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AbsoluteFill, cancelRender, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

import type { PalMascotSpecies } from "@/lib/palMascotAssets.mjs";
import { PAL_STAGE_RIGS, palStageImages, palStagePose } from "@/lib/palStageRig";

import { createPalStageRenderer, type PalStageRenderer } from "./palStageGl";

/** @public The props the render entry passes (scripts/pubpal/render-pal-stage.mjs). */
export type PalStageProps = {
  slug: PalMascotSpecies;
  /** The mouth level for each frame, 0 (shut) to 1 (wide). Empty means silent. */
  voice?: number[];
};

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Cannot load ${src}`));
    image.src = src;
  });
}

/**
 * @public Rendered by the Remotion entry that scripts/pubpal/render-pal-stage.mjs
 * writes fresh on each run, so no committed file imports it.
 */
export default function PalStage({ slug, voice = [] }: PalStageProps) {
  const frame = useCurrentFrame();
  const { durationInFrames, width } = useVideoConfig();
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<PalStageRenderer | null>(null);
  const [images, setImages] = useState<[HTMLImageElement, HTMLImageElement] | null>(null);
  const [handle] = useState(() => delayRender(`Pal art for ${slug}`));

  useEffect(() => {
    const { master, talk } = palStageImages(slug);
    Promise.all([loadImage(staticFile(master)), loadImage(staticFile(talk))])
      .then((loaded) => {
        setImages(loaded);
        continueRender(handle);
      })
      .catch(cancelRender);
  }, [handle, slug]);

  useLayoutEffect(() => {
    if (!canvas.current || !images) return;
    renderer.current ??= createPalStageRenderer(canvas.current, PAL_STAGE_RIGS[slug], images, {
      preserveDrawingBuffer: true,
    });
    if (!renderer.current) {
      cancelRender(new Error("WebGL is not available"));
      return;
    }
    renderer.current.draw(palStagePose(frame / durationInFrames, voice[frame] ?? 0));
  }, [durationInFrames, frame, images, slug, voice]);

  return (
    <AbsoluteFill style={{ background: "#05070a" }}>
      <canvas ref={canvas} width={width} height={width} style={{ width: "100%", height: "100%" }} />
    </AbsoluteFill>
  );
}
