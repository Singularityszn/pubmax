// The real PUBMAXX logo, drawn by the app's own components from the master
// geometry in lib/brandMark.mjs. Nothing here redraws or restyles the mark:
// the lockup is the mark plus the wordmark, as the app's nav sets it.

import type { CSSProperties } from "react";

import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";

import { COLOURS, FONTS } from "../theme";

/** The token values the brand components read, set for the night ground. */
const BRAND_TOKENS = {
  "--brass": COLOURS.coral,
  "--brass-bright": "#ff7a55",
  "--ink-deep": "#060607",
} as CSSProperties;

type LockupProps = {
  /** Wordmark cap size in pixels; the mark is sized from it. */
  size: number;
  colour?: string;
  style?: CSSProperties;
};

export function BrandLockup({ size, colour = COLOURS.paper, style }: LockupProps) {
  return (
    <div
      style={{
        ...BRAND_TOKENS,
        display: "inline-flex",
        alignItems: "center",
        fontFamily: FONTS.headline,
        fontSize: size,
        color: colour,
        ...style,
      }}
    >
      <PubmaxxWordmark withMark markVariant="duo" markSize={Math.round(size * 1.15)} />
    </div>
  );
}
