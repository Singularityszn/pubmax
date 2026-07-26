export type PromotionPub = {
  osmId: string;
  name: string;
  lat: number;
  lng: number;
  curatedRef?: { source?: string; id?: string };
};

export type CuratedPromotionRow = {
  id: string;
  name: string;
  lat: number;
  lng: number;
};

export function buildUkBasePromotionPlan(
  pubs: PromotionPub[],
  curatedRowsBySource: Map<string, CuratedPromotionRow[]>,
): {
  aliases: Record<string, string>;
  promotedOsmIds: Set<string>;
};
