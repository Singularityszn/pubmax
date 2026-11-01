// BROWSER-SAFE LEAF. The one number that means "no pint price cap".
//
// It lives apart from lib/venues.ts so a control that only needs to know what
// "Any" is (the phone shell, onboarding, a crawl link) can read it without
// pulling the venue index into the root shell's eager import graph
// (__tests__/rootShellImportGraph.test.ts). lib/venues.ts re-exports it, so
// every existing reader keeps its import.

/**
 * The OFF value for the pint price cap. See the note beside the re-export in
 * lib/venues.ts: it is what a fresh visitor starts on, every price control
 * offers it as "Any", and it sits above every priced pub so it caps nothing.
 */
export const NO_PINT_PRICE_CAP = 10;
