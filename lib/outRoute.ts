// Where Out went. A LEAF, importing nothing, because `proxy.ts` reads both
// strings to 308 the old address at the edge, the same shape as
// lib/cityPickerRoute.ts.
//
// Product owner, Oct 2026 UX audit: the primary row is Explore (the map),
// Tonight, Plan, Social, You,
// and Tonight carries what the Out tab listed. /out stays an address (old links,
// bookmarks, shared `?day=` links) by answering a permanent redirect here.

/** The folded tab's former address. proxy.ts 308s it to TONIGHT_PATH. */
export const OUT_PATH = "/out";

/** Where Out lives now. */
export const TONIGHT_PATH = "/tonight";
