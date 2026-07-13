import type { Daypart, NightAreaSlug } from "@/lib/nightPlanning";

export type RecentSignal = {
  id: string; sourceUrl: string; publisher: string; publishedAt: string; claim: string;
  confidence: number; reviewStatus: "reviewed"; expiresAt: string;
};

export type NightArea = {
  slug: NightAreaSlug;
  name: string;
  aliases: string[];
  centre: { lat: number; lng: number };
  radiusKm: number;
  transportAnchors: string[];
  daypartGuidance: Record<Daypart, string>;
  recentSignals: RecentSignal[];
};

const guidance = (afterWork: string, lateNight: string): Record<Daypart, string> => ({
  daytime: "Start with food-friendly pubs and quieter rooms.", after_work: afterWork,
  evening: "Balance atmosphere, price and a walkable three-stop route.", late_night: lateNight,
  get_home: "Prioritise a simple route to a reliable transport anchor.",
});

export const NIGHT_AREAS: readonly NightArea[] = [
  { slug: "clapham", name: "Clapham", aliases: ["Clapham Common", "Clapham Junction"], centre: { lat: 51.462, lng: -0.138 }, radiusKm: 2.4, transportAnchors: ["Clapham Common", "Clapham Junction"], daypartGuidance: guidance("Begin near the station, then move toward the Common.", "Keep the ending close to food and Night Tube connections."), recentSignals: [] },
  { slug: "victoria", name: "Victoria", aliases: ["Pimlico"], centre: { lat: 51.496, lng: -0.143 }, radiusKm: 1.5, transportAnchors: ["Victoria"], daypartGuidance: guidance("Optimise for a quick post-office start and commuter access.", "Finish close to Victoria station and confirmed late transport."), recentSignals: [] },
  { slug: "piccadilly-soho", name: "Piccadilly & Soho", aliases: ["Piccadilly", "Soho"], centre: { lat: 51.511, lng: -0.134 }, radiusKm: 1.4, transportAnchors: ["Piccadilly Circus", "Oxford Circus", "Tottenham Court Road"], daypartGuidance: guidance("Avoid unnecessary crossings and favour bookable group space.", "Expect crowds; favour short walks and verified closing times."), recentSignals: [] },
  { slug: "canary-wharf", name: "Canary Wharf", aliases: ["Canary Wharf"], centre: { lat: 51.505, lng: -0.022 }, radiusKm: 1.8, transportAnchors: ["Canary Wharf", "West India Quay"], daypartGuidance: guidance("Start close to offices, then move toward waterside venues.", "Keep the final stop near the Elizabeth line or Jubilee line."), recentSignals: [] },
  { slug: "barnes", name: "Barnes", aliases: ["Barnes Bridge"], centre: { lat: 51.474, lng: -0.239 }, radiusKm: 1.8, transportAnchors: ["Barnes", "Barnes Bridge"], daypartGuidance: guidance("Lean into relaxed riverside and neighbourhood pubs.", "Plan the return early because late transport is less frequent."), recentSignals: [] },
  { slug: "chiswick", name: "Chiswick", aliases: ["Turnham Green"], centre: { lat: 51.493, lng: -0.255 }, radiusKm: 2, transportAnchors: ["Turnham Green", "Chiswick"], daypartGuidance: guidance("Build westward from Turnham Green with a compact route.", "End near a dependable bus or Tube connection."), recentSignals: [] },
] as const;

export function getNightArea(slug: NightAreaSlug): NightArea {
  return NIGHT_AREAS.find((area) => area.slug === slug)!;
}
