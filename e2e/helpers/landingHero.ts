// Plan is public until the reader saves or sends it.
// Public prices remain available through the quiet /near door.
// That price door answers from a London patch when location is refused.
// First-run price setup stays on /near as a chip, after the answer.
// The same public price path serves first-time and returning visitors
// (e2e/web-first-run-journey.spec.ts).
export const LANDING_PRIMARY_NAME = /^Plan a night$/;
export const LANDING_PRIMARY_HREF = "/plan";
export const LANDING_NEAR_NAME = "Cheapest pints near me";
export const LANDING_NEAR_HREF = "/near?locate=1";
export const LANDING_FIRST_RUN_HREF = "/onboarding?start=web";
export const NEAR_FIRST_RUN_CHIP_NAME = "New here? Set your budget and patch";

// The hero opens the map without starting a price contribution.
export const LANDING_MAP_NAME = /^Open the map$/;
export const LANDING_MAP_HREF = "/map";
