"use client";

import { useRef } from "react";

import { PubPalMascot, PubPalMascotMouth } from "@/components/pal/PubPalMascot";
import { usePalHead3D } from "@/components/pal/usePalHead3D";
import type { PalAnimationState, PubPalAppearance } from "@/lib/pubPal";
import type { PalVoiceSignal } from "@/lib/palVoiceSignal";
import { palGenomeStyle, type PalGenome } from "@/lib/palGenome";
import { pubPalMascotSlugFor, pubPalMascotModelSrc, pubPalMascotModelStyle } from "@/lib/pubPalMascot";

// The Pal's live head inside the voice panel. On a phone, starting voice chat
// scrolls the big portrait off screen, so the panel carries a small one that
// turns, leans and nods on the same levels. CSS shows it only at phone width;
// hidden, its loop sleeps like the big head's does off screen.
export default function PalVoiceFace({
  appearance,
  signal,
  state,
  genome,
}: {
  appearance: PubPalAppearance;
  signal?: PalVoiceSignal;
  state: PalAnimationState;
  genome?: PalGenome;
}) {
  const frameRef = useRef<HTMLSpanElement>(null);
  usePalHead3D(frameRef, { signal, state, temperament: genome?.temperament, modelUrl: pubPalMascotModelSrc(appearance.species), decorative: true });
  // A legacy species with no rendered master has no face to turn.
  if (!pubPalMascotSlugFor(appearance.species)) return null;
  return (
    <span
      ref={frameRef}
      className="palVoiceFace"
      aria-hidden="true"
      data-pal-state={state}
      {...(genome ? { "data-genome": "", style: palGenomeStyle(genome) as React.CSSProperties } : {})}
    >
      <span className="palVoiceFaceMask">
        <PubPalMascot species={appearance.species} size={56} circular decorative className="palVoiceFaceImg" />
        <PubPalMascotMouth species={appearance.species} size={56} circular className="palVoiceFaceImg" />
        <span className="palOriginalModelHost" data-pal-model-host="" aria-hidden="true" style={pubPalMascotModelStyle(appearance.species) as React.CSSProperties}>
          <span className="palOriginalModelFraming" data-pal-model-drawing="" aria-hidden="true" />
        </span>
      </span>
    </span>
  );
}
