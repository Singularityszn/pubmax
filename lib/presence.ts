// Browser-safe presence contract shared by client lenses and the server store.
// No Supabase, no venue index, no fs/path imports.

// Presence lives ~2h, matching the migration's `now() + interval '2 hours'`
// default so the memory fallback and Supabase agree on the window.
export const PRESENCE_TTL_MS = 2 * 60 * 60 * 1000;

// What a client sends us. Handle + venue are cleaned server-side; actorHash is
// derived by the route (never trusted from the body).
export type PresenceInput = {
  handle: string;
  venueId: string;
  actorHash: string;
};

// The PUBLIC presence shape. NO actor_hash — it never leaves the server. The
// venue is surfaced as a human name + a map link, never the raw id.
export type PresenceDTO = {
  handle: string;
  venueId: string;
  venueName: string;
  venueMapUrl: string;
  at: string;
};
