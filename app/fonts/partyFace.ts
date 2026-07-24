import { Bungee } from "next/font/google";

// Party accent (docs/VIBE_LAYER_SPEC_2026-07-19.md): Bungee, the urban-signage
// face for the vibe layer. ROUTE-SCOPED — loaded only by the surfaces that
// consume var(--font-party) (Tonight vibe chips, Pal), so the global bundle no
// longer ships a display font every route pays for but only two use.
// Consumers already fall back with `var(--font-party, var(--font-display))`, so
// routes that don't apply this variable degrade cleanly to the display face.
// QUARANTINED by spec — this is a registered definition site in
// __tests__/fontPartyContainment.test.ts. Single 400 weight on purpose: no
// weight axis means no temptation to use it as a text face.
export const partyFace = Bungee({
  subsets: ["latin"],
  variable: "--font-party",
  display: "swap",
  weight: "400",
});
