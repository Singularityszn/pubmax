// Client-safe map deep-link helper. Keep this free of Node imports so client
// components can link to selected venues without pulling in server-only indexes.
export function venueMapUrl(id: string): string {
  return `/map?sel=${encodeURIComponent(id)}`;
}
