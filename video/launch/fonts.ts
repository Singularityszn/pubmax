// Loads the two brand faces before the first frame renders.
//
// These are the exact latin files the app serves for its display face (Space
// Grotesk) and its body face (Inter), both variable and both under the SIL
// Open Font Licence. They are copied into video/launch/public/fonts so the
// video renders the same on any machine, with no network.

import { continueRender, delayRender, staticFile } from "remotion";

const FACES = [
  { family: "Space Grotesk", file: "fonts/SpaceGrotesk-latin-wght.woff2", weight: "300 700" },
  { family: "Inter", file: "fonts/Inter-latin-wght.woff2", weight: "100 900" },
] as const;

let loading: Promise<void> | null = null;

/** Adds every face to the document once; later calls share the same wait. */
export function loadBrandFonts(): void {
  if (loading || typeof document === "undefined") return;
  const handle = delayRender("Brand fonts");
  loading = Promise.all(
    FACES.map(async ({ family, file, weight }) => {
      const face = new FontFace(family, `url(${staticFile(file)}) format("woff2")`, { weight });
      document.fonts.add(await face.load());
    }),
  ).then(() => continueRender(handle));
}
