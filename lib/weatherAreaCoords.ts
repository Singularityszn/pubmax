import { LONDON_NIGHT_AREA_SLUGS, type LondonNightAreaSlug, type NightAreaSlug } from "@/lib/nightAreas";

// [lat, lng] centroids per LONDON night area: the established set the scheduled
// refresh has always polled (kept in lockstep with
// scripts/refresh_weather_snapshots.mjs). The snapshot this feeds is London's,
// so the table is keyed on London's own patches: an area in another city has no
// row here and reads as no weather rather than as somebody else's.
export const LONDON_NIGHT_AREA_COORDS: Record<LondonNightAreaSlug, readonly [number, number]> = {
  clapham: [51.462, -0.138],
  victoria: [51.496, -0.143],
  "piccadilly-soho": [51.511, -0.134],
  "canary-wharf": [51.505, -0.022],
  barnes: [51.474, -0.239],
  chiswick: [51.493, -0.255],
  shoreditch: [51.524, -0.079],
  camden: [51.539, -0.143],
  brixton: [51.461, -0.115],
  "bermondsey-london-bridge": [51.504, -0.082],
  "kings-cross": [51.531, -0.124],
  islington: [51.534, -0.104],
  dalston: [51.546, -0.075],
  peckham: [51.473, -0.069],
  greenwich: [51.482, -0.009],
  hammersmith: [51.492, -0.224],
  balham: [51.443, -0.152],
  marylebone: [51.522, -0.163],
  richmond: [51.461, -0.303],
  putney: [51.461, -0.216],
};

export function coordsForNightArea(slug: NightAreaSlug): [number, number] | null {
  if (!LONDON_NIGHT_AREA_SLUGS.includes(slug as LondonNightAreaSlug)) return null;
  return [...LONDON_NIGHT_AREA_COORDS[slug as LondonNightAreaSlug]];
}
