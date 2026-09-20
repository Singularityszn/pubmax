import type { UkPriceJudgmentReviewRow } from "@/lib/harvest/ukPriceJudgment.server";
import type { UkPriceReading } from "@/lib/harvest/ukPriceCrawl";

export function typesafeKeyConfigured(): boolean;

export function readVenueDrinkPricesForHarvest(
  html: string,
  ctx?: { pubName?: string; pageUrl?: string },
): Promise<{ reading: UkPriceReading; review: UkPriceJudgmentReviewRow[] }>;
