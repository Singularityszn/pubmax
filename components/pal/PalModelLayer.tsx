"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { PalAnimationState, PubPalSpecies } from "@/lib/pubPal";
import type { PalVoiceSignal } from "@/lib/palVoiceSignal";

const Model = dynamic(() => import("./PalModel3D"), { ssr: false });

/** Load the scene only when its portrait reaches the screen. */
export default function PalModelLayer(props: { species: PubPalSpecies; state: PalAnimationState; signal?: PalVoiceSignal }) {
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!host.current || typeof WebGL2RenderingContext !== "function" || typeof matchMedia !== "function" || typeof IntersectionObserver !== "function"
      || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) { setVisible(true); observer.disconnect(); }
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  return <span ref={host} className="palModelLayer">{visible ? <Model {...props} /> : null}</span>;
}
