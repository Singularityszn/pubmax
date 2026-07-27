// Server-safe first-party price source fetchers shared by the manual refresh
// script and Vercel cron route.
//
// Each source-specific parser belongs here once its official source contract is
// implemented. Until then, returning no rows is the only honest behavior.

/**
 * @param {{ id: string, label: string, kind: string, url: string }} source
 * @returns {Promise<unknown[]>}
 */
export async function fetchFromSource(source) {
  void source;
  return [];
}
