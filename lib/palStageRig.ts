// The rig for the Pal stage (components/pal/PalStage.tsx): where each Pal's
// head, body, eyes and mouth sit on its own 512 master, in that square's
// pixels. The stage moves the real artwork by these shapes; it draws nothing
// new. The mouth ovals are the ones scripts/pubpal/mouth-ovals.json cut the
// talking frames with, so the stage opens the mouth exactly where the talking
// frame differs from the master.

import { PAL_MASCOT_SLUGS, type PalMascotSpecies } from "@/lib/palMascotAssets.mjs";

/** The most depth shapes one rig may hold: the shader's fixed array length. */
export const PAL_STAGE_MAX_BUMPS = 8;

export type PalStageEllipse = { cx: number; cy: number; rx: number; ry: number };

/** A raised shape of the depth map: an ellipse lifted toward the viewer. */
type PalStageBump = PalStageEllipse & { lift: number };

export type PalStageRig = {
  /** The head: it turns, nods and tilts on its own, over the body. */
  head: PalStageEllipse;
  /** Where the head turns about (the neck), and how far its turn reaches down. */
  neck: { x: number; y: number };
  /** The shapes of the depth map, nearest first in importance. */
  bumps: PalStageBump[];
  eyes: [PalStageEllipse, PalStageEllipse];
  mouth: PalStageEllipse;
  /**
   * The talking frame shows the mouth OPEN, so the stage blends it in as the
   * voice rises. The corgi's master already smiles open-mouthed, so its talking
   * frame is the mouth closed and the stage blends it in as the voice falls.
   */
  mouthOpensWithVoice: boolean;
};

export const PAL_STAGE_RIGS = {
  fox: {
    head: { cx: 248, cy: 190, rx: 128, ry: 112 },
    neck: { x: 252, y: 280 },
    bumps: [
      { cx: 248, cy: 200, rx: 112, ry: 82, lift: 0.75 },
      { cx: 246, cy: 238, rx: 34, ry: 26, lift: 1 },
      { cx: 190, cy: 92, rx: 30, ry: 50, lift: 0.45 },
      { cx: 368, cy: 136, rx: 36, ry: 40, lift: 0.45 },
      { cx: 255, cy: 345, rx: 100, ry: 95, lift: 0.55 },
      { cx: 262, cy: 408, rx: 118, ry: 42, lift: 0.4 },
    ],
    eyes: [
      { cx: 210, cy: 190, rx: 18, ry: 17 },
      { cx: 299, cy: 222, rx: 18, ry: 17 },
    ],
    mouth: { cx: 241, cy: 251, rx: 26, ry: 21 },
    mouthOpensWithVoice: true,
  },
  badger: {
    head: { cx: 256, cy: 172, rx: 132, ry: 112 },
    neck: { x: 262, y: 268 },
    bumps: [
      { cx: 256, cy: 175, rx: 118, ry: 92, lift: 0.75 },
      { cx: 272, cy: 240, rx: 32, ry: 24, lift: 1 },
      { cx: 155, cy: 105, rx: 26, ry: 26, lift: 0.45 },
      { cx: 340, cy: 90, rx: 26, ry: 26, lift: 0.45 },
      { cx: 262, cy: 330, rx: 135, ry: 88, lift: 0.55 },
      { cx: 340, cy: 312, rx: 24, ry: 36, lift: 0.7 },
    ],
    eyes: [
      { cx: 213, cy: 205, rx: 15, ry: 14 },
      { cx: 311, cy: 187, rx: 15, ry: 14 },
    ],
    mouth: { cx: 270, cy: 256, rx: 24, ry: 16 },
    mouthOpensWithVoice: true,
  },
  cat: {
    head: { cx: 250, cy: 165, rx: 140, ry: 115 },
    neck: { x: 240, y: 252 },
    bumps: [
      { cx: 250, cy: 172, rx: 125, ry: 90, lift: 0.75 },
      { cx: 224, cy: 198, rx: 30, ry: 22, lift: 1 },
      { cx: 145, cy: 90, rx: 28, ry: 45, lift: 0.45 },
      { cx: 335, cy: 85, rx: 28, ry: 45, lift: 0.45 },
      { cx: 240, cy: 320, rx: 128, ry: 96, lift: 0.55 },
      { cx: 226, cy: 330, rx: 70, ry: 70, lift: 0.7 },
      { cx: 440, cy: 300, rx: 35, ry: 80, lift: 0.35 },
    ],
    eyes: [
      { cx: 176, cy: 175, rx: 22, ry: 18 },
      { cx: 283, cy: 175, rx: 22, ry: 18 },
    ],
    mouth: { cx: 226, cy: 212, rx: 28, ry: 15 },
    mouthOpensWithVoice: true,
  },
  corgi: {
    head: { cx: 258, cy: 190, rx: 125, ry: 110 },
    neck: { x: 256, y: 268 },
    bumps: [
      { cx: 258, cy: 200, rx: 106, ry: 84, lift: 0.75 },
      { cx: 260, cy: 238, rx: 40, ry: 30, lift: 1 },
      { cx: 160, cy: 100, rx: 35, ry: 60, lift: 0.4 },
      { cx: 360, cy: 95, rx: 35, ry: 60, lift: 0.4 },
      { cx: 256, cy: 340, rx: 122, ry: 82, lift: 0.55 },
    ],
    eyes: [
      { cx: 213, cy: 202, rx: 16, ry: 15 },
      { cx: 305, cy: 203, rx: 16, ry: 15 },
    ],
    mouth: { cx: 268, cy: 262, rx: 40, ry: 26 },
    mouthOpensWithVoice: false,
  },
  greyhound: {
    head: { cx: 228, cy: 135, rx: 120, ry: 95 },
    neck: { x: 250, y: 235 },
    bumps: [
      { cx: 228, cy: 135, rx: 85, ry: 72, lift: 0.75 },
      { cx: 178, cy: 182, rx: 36, ry: 24, lift: 1 },
      { cx: 160, cy: 88, rx: 36, ry: 26, lift: 0.4 },
      { cx: 330, cy: 78, rx: 46, ry: 30, lift: 0.4 },
      { cx: 250, cy: 240, rx: 45, ry: 50, lift: 0.55 },
      { cx: 265, cy: 345, rx: 115, ry: 100, lift: 0.55 },
    ],
    eyes: [
      { cx: 183, cy: 126, rx: 12, ry: 12 },
      { cx: 247, cy: 125, rx: 14, ry: 13 },
    ],
    mouth: { cx: 192, cy: 195, rx: 44, ry: 26 },
    mouthOpensWithVoice: true,
  },
  pigeon: {
    head: { cx: 238, cy: 140, rx: 110, ry: 100 },
    neck: { x: 245, y: 220 },
    bumps: [
      { cx: 238, cy: 140, rx: 92, ry: 90, lift: 0.75 },
      { cx: 214, cy: 172, rx: 20, ry: 18, lift: 1 },
      { cx: 250, cy: 300, rx: 140, ry: 110, lift: 0.55 },
      { cx: 226, cy: 312, rx: 66, ry: 62, lift: 0.7 },
    ],
    eyes: [
      { cx: 183, cy: 140, rx: 12, ry: 14 },
      { cx: 272, cy: 148, rx: 18, ry: 16 },
    ],
    mouth: { cx: 229, cy: 173, rx: 32, ry: 22 },
    mouthOpensWithVoice: true,
  },
  robin: {
    head: { cx: 270, cy: 160, rx: 150, ry: 95 },
    neck: { x: 270, y: 240 },
    bumps: [
      { cx: 270, cy: 230, rx: 160, ry: 150, lift: 0.6 },
      { cx: 270, cy: 280, rx: 95, ry: 85, lift: 0.75 },
      { cx: 278, cy: 186, rx: 22, ry: 16, lift: 1 },
    ],
    eyes: [
      { cx: 224, cy: 175, rx: 18, ry: 17 },
      { cx: 321, cy: 175, rx: 18, ry: 17 },
    ],
    mouth: { cx: 277, cy: 190, rx: 30, ry: 22 },
    mouthOpensWithVoice: true,
  },
} as const satisfies Record<PalMascotSpecies, PalStageRig>;

/** The 512 master and its talking frame, the only two images the stage draws. */
export function palStageImages(species: PalMascotSpecies) {
  const slug = PAL_MASCOT_SLUGS[species];
  return { master: `pal/${slug}-512.png`, talk: `pal/${slug}-talk-512.webp` };
}
