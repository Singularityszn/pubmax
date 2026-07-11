/**
 * Loader for the Firecrawl-sourced J D Wetherspoon pub directory.
 * Data: public/data/wetherspoons/pubs.json (see data/wetherspoons/README.md).
 *
 * Honest: this directory has venue identity + hours/facilities, NOT per-item
 * food/drink prices (those are not on the first-party website).
 */

export type WetherspoonsPub = {
  wpId: number;
  jdwPubId: string | null;
  slug: string;
  name: string;
  pageUrl: string;
  menuUrl: string | null;
  phone: string | null;
  fullAddress: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  townCity: string | null;
  county: string | null;
  postcode: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  bookATableLink: string | null;
  regularOpeningTimes: Array<{
    day_of_the_week?: string;
    opening_time?: string;
    closing_time?: string;
  }>;
  facilities: string[];
  regions: string[];
  statuses: string[];
  menuPricesAvailableOnWeb: boolean;
};

export type WetherspoonsDirectory = {
  generatedAt: string;
  count: number;
  notes: string[];
  pubs: WetherspoonsPub[];
};

export const WETHERSPOONS_DIRECTORY_URL = "/data/wetherspoons/pubs.json";
export const WETHERSPOONS_GEOJSON_URL = "/data/wetherspoons/pubs.geojson";

export async function loadWetherspoonsDirectory(
  signal?: AbortSignal,
): Promise<WetherspoonsDirectory> {
  const res = await fetch(WETHERSPOONS_DIRECTORY_URL, { signal });
  if (!res.ok) {
    throw new Error(`Failed to load Wetherspoon directory (${res.status})`);
  }
  return (await res.json()) as WetherspoonsDirectory;
}
