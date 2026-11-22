// The Regulars: PubMaxxing's own pixel family. Three glasses, five poses.
// Each pose is a 16 by 16 grid, one character per pixel. The component
// (components/brand/PixelMascot.tsx) paints each letter from a theme token, so
// a pose is data and never a file to fetch.
//
//   k line and legs     a lager          d lager in shade    c head
//   w gleam             e ink            s stout             g empty glass
//   h heart             . nothing

export const MASCOT_GRID = 16;

export const MASCOT_SPRITES = {
  /** The lager, saying hello. A first meeting. */
  hello: [
    "................",
    "...kkkkkkkkkk...",
    "..kcccccccccck..",
    "..kcccccccccck..",
    "...kcaaaaaaak...",
    "...kaeeaaeeak...",
    "...kaeeaaeeak...",
    "...kaaaeeaaak...",
    "...kwaaaaaaak...",
    "....kwaaaadk....",
    "....kaaaaadk....",
    "....kaaaaddk....",
    "....kkkkkkkk....",
    ".....kk..kk.....",
    "....kkk..kkk....",
    "................",
  ],
  /** The stout, eyes shut under headphones. A wait. */
  tunes: [
    "....hhhhhhhh....",
    "..hkkkkkkkkkkh..",
    ".hkcccccccccckh.",
    ".hkcccccccccckh.",
    ".hhkcssssssskhh.",
    ".hhksssssssskhh.",
    ".hhkswwsswwskhh.",
    ".hhksssssssskhh.",
    "...kssswwsssk...",
    "....kssssssk....",
    "....kssssssk....",
    "....kssssssk....",
    "....kkkkkkkk....",
    ".....kk..kk.....",
    "....kkk..kkk....",
    "................",
  ],
  /** The lager in shades. A thing went right. */
  shades: [
    "................",
    "...kkkkkkkkkk...",
    "..kcccccccccck..",
    "..kcccccccccck..",
    "..eeeeeeeeeeee..",
    "...kweeaaweek...",
    "...keeeaaeeek...",
    "...kaaaaaaaak...",
    "...kwaaaeeaak...",
    "....kwaaaadk....",
    "....kaaaaadk....",
    "....kaaaaddk....",
    "....kkkkkkkk....",
    ".....kk..kk.....",
    "....kkk..kkk....",
    "................",
  ],
  /** The half, holding a heart up. A thank you. */
  heart: [
    "................",
    "................",
    "................",
    "................",
    "...........hh.hh",
    "..kkkkkkkk.hhhhh",
    ".kcccccccck.hhh.",
    ".kcccccccck..h..",
    "..kaaaaaak..k...",
    "..kaeaaeak.k....",
    "..kaaeeaakk.....",
    "..kaaaaadk......",
    "..kaaaaddk......",
    "..kkkkkkkk......",
    "...kk..kk.......",
    "................",
  ],
  /** An empty glass, asleep. Nothing here yet. */
  empty: [
    "............kkkk",
    "..............k.",
    ".............k..",
    "............kkkk",
    "................",
    "...kkkkkkkkkk...",
    "...kwgggggggk...",
    "...kgkkggkkgk...",
    "...kggggggggk...",
    "...kgggkkgggk...",
    "....kggggggk....",
    "....kddddddk....",
    "....kkkkkkkk....",
    ".....kk..kk.....",
    "....kkk..kkk....",
    "................",
  ],
} as const satisfies Record<string, readonly string[]>;

export type MascotPose = keyof typeof MASCOT_SPRITES;

export type MascotInk = "k" | "a" | "d" | "c" | "w" | "e" | "s" | "g" | "h";

/**
 * One path per ink: each run of equal pixels in a row becomes a rectangle.
 * Whole-pixel coordinates only, so the picture stays sharp at every multiple
 * of the grid.
 */
export function mascotPaths(pose: MascotPose): { ink: MascotInk; d: string }[] {
  const paths = new Map<MascotInk, string>();
  MASCOT_SPRITES[pose].forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ink = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === ink) end += 1;
      if (ink !== ".") {
        const key = ink as MascotInk;
        paths.set(key, `${paths.get(key) ?? ""}M${x} ${y}h${end - x}v1h${x - end}z`);
      }
      x = end;
    }
  });
  return [...paths].map(([ink, d]) => ({ ink, d }));
}

/** How many columns are empty to the left of a pose's first pixel. */
export function mascotInset(pose: MascotPose): number {
  return Math.min(...MASCOT_SPRITES[pose].map((row) => row.search(/[^.]/)).filter((column) => column >= 0));
}
