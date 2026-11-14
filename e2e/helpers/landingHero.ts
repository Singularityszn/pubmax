// Pal is the landing's one primary action, with sign-in required for guests.
// The sign-in door retains chat through login and account claiming.
// Public prices remain available through the quiet /near door.
// That price door answers from a London patch when location is refused.
// First-run price setup stays on /near as a chip, after the answer.
// The same public price path serves first-time and returning visitors
// (e2e/web-first-run-journey.spec.ts).
export const LANDING_PRIMARY_NAME = /^(?:Ask your Pub Pal|Sign in for Pub Pal)$/;
export const LANDING_PRIMARY_HREF = "/login?from=%2Fpal%2Fchat";
export const LANDING_NEAR_NAME = "Cheapest pints near me";
export const LANDING_NEAR_HREF = "/near?locate=1";
export const LANDING_FIRST_RUN_HREF = "/onboarding?start=web";
export const NEAR_FIRST_RUN_CHIP_NAME = "New here? Set your budget and patch";

// The general price door asks the reader to choose a pub before a blank form.
export const LANDING_RECEIPT_NAME = /^Log what you paid$/;
export const LANDING_RECEIPT_HREF = "/map?log=1";
