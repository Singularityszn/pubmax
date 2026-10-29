import { currentAnalyticsAttribution } from "@/lib/analyticsAttribution.mjs";

// Kill switch for DEMO content (seeded pint drops, ambient presence counts).
//
// Demo seeds bootstrapped the product's surfaces while no real users existed,
// and every seeded row is labelled DEMO in the UI. But for a launch built on
// data honesty, seeded liveness ("2 spilling right now") is a credibility
// risk the moment real users arrive — so the seams below let the owner turn
// ALL demo content off with one env flip, without touching the seed data.
//
// Production defaults to no demo activity. The existing internal-test build
// attribution preserves automated browser fixtures. The off flag disables both.
// The public flag is a build-time value, so server and client agree.
export function demoContentEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_DEMO_CONTENT === "off") return false;
  if (process.env.VERCEL_ENV === "production") return false;
  return process.env.NODE_ENV !== "production"
    || currentAnalyticsAttribution().environment === "internal-test";
}

// Narrower gate for DEMO DRINK ROWS (seeded venue menus and the demo lane of
// the drink-price overlay). Nonproduction fixtures require an explicit opt-in.
//
// A demo pour used to render whenever the owner had not remembered to set
// NEXT_PUBLIC_DEMO_CONTENT=off, so a forgotten deployment setting put seeded
// examples beside a real public Pint Drop and made the whole menu wear a demo
// disclaimer (#1427). A menu that says what a drinker paid cannot be one
// deployment setting away from inventing rows, so demo drinks are now OPT-IN:
// they render only where a developer or an e2e fixture asks for them by name.
//
// The kill switch still kills: NEXT_PUBLIC_DEMO_CONTENT=off turns these off
// whatever this flag says.
export function demoDrinksEnabled(): boolean {
  return demoContentEnabled() && process.env.NEXT_PUBLIC_DEMO_DRINKS === "on";
}
