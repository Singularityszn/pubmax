"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";

import type { PalMascotSpecies } from "@/lib/palMascotAssets.mjs";
import { PAL_STAGE_RIGS, palStageImages, palStageLiveFrame, type PalStageHead } from "@/lib/palStageRig";

import { createPalStageRenderer, type PalStageRenderer } from "./palStageGl";

// The Pal's live 3D head on /pal: the stage's WebGL pass
// (components/pal/palStageGl.ts) laid over the still photograph, driven by the
// head loop the portrait already runs (usePalHead3D), so the real artwork turns
// toward the pointer, blinks, and talks on the Pal's own voice.
//
// The photograph underneath stays the page's image: it is what the reader's
// first paint, the alt text and every fallback show. The canvas is
// decorative, asks for its two 512 WebP renditions only once the loop draws its
// first frame (so reduced motion, which never starts the loop, fetches
// nothing), and shows itself only after a frame is on it. Without WebGL it
// never shows, and the photograph turns by CSS as before.

export type PalStageHandle = { draw: (head: PalStageHead) => void };

const MAX_SIDE = 512;

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Cannot load ${src}`));
    image.src = src;
  });
}

export default function PalStageCanvas({
  species,
  className,
  ref,
}: {
  species: PalMascotSpecies;
  className?: string;
  ref?: Ref<PalStageHandle>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<PalStageRenderer | null>(null);
  const [wanted, setWanted] = useState(false);
  const [images, setImages] = useState<[HTMLImageElement, HTMLImageElement] | null>(null);
  const [live, setLive] = useState(false);

  // The first frame the loop asks for is what starts the download.
  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    const { master, talk } = palStageImages(species, "webp");
    Promise.all([loadImage(`/${master}`), loadImage(`/${talk}`)])
      .then((loaded) => {
        if (!cancelled) setImages(loaded);
      })
      .catch(() => {
        // No art, no stage: the photograph stays.
      });
    return () => {
      cancelled = true;
    };
  }, [species, wanted]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !images) return;
    try {
      renderer.current = createPalStageRenderer(canvas, PAL_STAGE_RIGS[species], images);
    } catch {
      renderer.current = null;
    }
    const sizeCanvas = () => {
      const box = canvas.getBoundingClientRect();
      const side = Math.min(MAX_SIDE, Math.max(1, Math.round(box.width * (window.devicePixelRatio || 1))));
      if (canvas.width !== side) {
        canvas.width = side;
        canvas.height = side;
      }
    };
    sizeCanvas();
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(sizeCanvas) : null;
    resize?.observe(canvas);
    return () => {
      resize?.disconnect();
      renderer.current?.dispose();
      renderer.current = null;
      setLive(false);
    };
  }, [images, species]);

  useImperativeHandle(
    ref,
    () => ({
      draw(head) {
        if (!renderer.current) {
          if (!wanted) setWanted(true);
          return;
        }
        renderer.current.draw(palStageLiveFrame(head));
        if (!live) setLive(true);
      },
    }),
    [live, wanted],
  );

  return (
    <canvas
      ref={canvasRef}
      className={className ? `palStageCanvas ${className}` : "palStageCanvas"}
      data-stage={live ? "live" : undefined}
      aria-hidden="true"
      width={1}
      height={1}
    />
  );
}
