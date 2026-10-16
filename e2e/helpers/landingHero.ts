// The landing's one primary action, by name (captain 7 Sep 2026). It is the
// same door with or without a pub card behind the document: `/near` answers a
// stranger in one tap, and answers from a London patch when they refuse
// location, so the front door never ends at a wall. That is the RETURNING
// visitor's door (the seen mark set); a first-time visitor's tap opens the
// first-run journey first (e2e/web-first-run-journey.spec.ts).
export const LANDING_PRIMARY_NAME = "Cheapest pints near me";
export const LANDING_PRIMARY_HREF = "/near?locate=1";
export const LANDING_FIRST_RUN_HREF = "/onboarding?start=web";

// The first QUIET door, which used to be the primary. It reads "Log what you
// paid" either way (UX audit 16 Oct 2026): with a real pub behind the document
// it opens that pub's Pint Drop door, with no card it is the plain receipt door.
export const LANDING_RECEIPT_NAME = /^Log what you paid$/;
// #1462 — the door carries the figure the card printed, so the composer it
// opens holds it. The pattern, not the figure, because the figure is the
// dataset's and rots in a string.
export const LANDING_RECEIPT_HREF =
  /^\/map\?sel=[^&]+&log=1&price=\d+\.\d\d$|^\/near$/;
