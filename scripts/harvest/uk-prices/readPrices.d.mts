import type { ChainPriceReading } from "@/lib/harvest/chainMenuPrices";
import type { TavilyPintPrice } from "@/lib/harvest/tavilyPintPrices";
import type { TavilyVenueDrinkPrice } from "@/lib/harvest/tavilyVenueDrinkPrices";
import type { UkPriceJudgedReading } from "@/lib/harvest/ukPriceJudgment.server";
import type { UkPriceReading, UkPriceSourceFormat } from "@/lib/harvest/ukPriceCrawl";

export function typesafeKeyConfigured(): boolean;

export function readVenueDrinkPricesForHarvest(
  html: string,
  ctx?: { pubName?: string; pageUrl?: string },
  sourceFormat?: UkPriceSourceFormat,
): Promise<{ reading: UkPriceReading; review: UkPriceJudgedReading["review"] }>;

export function readChainPintPricesForHarvest(
  html: string,
  ctx?: { pubName?: string; pageUrl?: string },
): Promise<{ reading: ChainPriceReading; review: UkPriceJudgedReading["review"] }>;

export function extractPintPricesForHarvest(
  markdown: string,
  ctx?: { pubName?: string; pageUrl?: string },
): Promise<{ prices: TavilyPintPrice[]; review: UkPriceJudgedReading["review"] }>;

export function extractVenueDrinkPricesForHarvest(
  markdown: string,
  ctx?: { pubName?: string; pageUrl?: string },
): Promise<{
  drinks: TavilyVenueDrinkPrice[];
  reading: UkPriceReading;
  review: UkPriceJudgedReading["review"];
}>;
