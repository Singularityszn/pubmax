// The landing's one primary action, by name (captain 7 Sep 2026). It is the
// same door with or without a pub card behind the document: `/near` answers a
// stranger in one tap, and answers from a London patch when they refuse
// location, so the front door never ends at a wall. It is the same door for a
// first-time visitor (owner decision 16 Oct 2026): the first-run setup is
// offered on /near as a chip, never in front of the answer
// (e2e/web-first-run-journey.spec.ts).
export const LANDING_PRIMARY_NAME = "Cheapest pints near me";
export const LANDING_PRIMARY_HREF = "/near?locate=1";
export const LANDING_FIRST_RUN_HREF = "/onboarding?start=web";
export const NEAR_FIRST_RUN_CHIP_NAME = "New here? Set your budget and patch";

// The general price door asks the reader to choose a pub before a blank form.
export const LANDING_RECEIPT_NAME = /^Log what you paid$/;
export const LANDING_RECEIPT_HREF = "/map?log=1";
