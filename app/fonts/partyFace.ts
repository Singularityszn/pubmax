import { Bungee } from "next/font/google";

// Party accent (docs/VIBE_LAYER_SPEC_2026-07-19.md): Bungee, the urban-signage
// face for the vibe layer. ROUTE-SCOPED - applied only by /tonight and /pal, so
// the global bundle no longer ships a display font every route pays for.
// NO CSS CONSUMES var(--font-party) TODAY: the vibe chips were its last
// consumer and left the face on 2026-08-18 (Bungee is cap-height only, so a
// sentence-case chip label still read as ALL CAPS - see
// components/vibe/vibeChips.css). The token stays defined and quarantined for
// the vibe stamp lane; the two route wrappers can go with it if nothing adopts
// it. Consumers fall back with `var(--font-party, var(--font-display))`, so a
// route that doesn't apply this variable degrades cleanly to the display face.
// QUARANTINED by spec — this is a registered definition site in
// __tests__/fontPartyContainment.test.ts. Single 400 weight on purpose: no
// weight axis means no temptation to use it as a text face.
export const partyFace = Bungee({
  subsets: ["latin"],
  variable: "--font-party",
  display: "swap",
  weight: "400",
});
