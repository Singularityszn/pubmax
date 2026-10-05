export const PROMOTION_BATCH_CAP: number;

export function resolveBatchLimit(requested?: unknown): number;

export type OsmPubRecord = { osmId?: string; name?: string; [key: string]: unknown };
export type PromotionPick = { pub: OsmPubRecord; borough: string };

export function selectPromotions(
  osmPubs: OsmPubRecord[],
  appRows: Array<Record<string, unknown>>,
  options: {
    boundaries: unknown;
    isDuplicate: (osmId: string, name: string, lat: number, lng: number) => boolean;
    limit?: unknown;
  },
): { picked: PromotionPick[]; eligible: number; limit: number };
