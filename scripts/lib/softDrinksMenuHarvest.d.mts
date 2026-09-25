export type SoftDrinkHarvestRow = {
  drinkLabel: string;
  category: "soft-drink";
  priceGbp: number;
};

export function parseMbplcSoftDrinkLines(markdown: string): SoftDrinkHarvestRow[];
export function parseGkSoftDrinkLines(markdown: string): SoftDrinkHarvestRow[];
export function isTapWaterLabel(label: unknown): boolean;
export function filterSoftDrinkHarvestRows(rows: SoftDrinkHarvestRow[]): SoftDrinkHarvestRow[];
export function softDrinkRowsFromPageText(text: string): SoftDrinkHarvestRow[];
export function classifySoftDrinkSubtypeId(drinkLabel: string): string | null;
export function softDrinkRowsFromMenuPdfLinks(
  pageText: string,
  options: {
    pageUrl: string;
    sourceId: string;
    associatedHosts?: readonly string[];
    fetchImpl?: typeof fetch;
    robotsChecker?: import("../../lib/harvest/robots.ts").RobotsChecker;
    waitForCrawlSpacing?: () => Promise<void>;
    markRequestCompleted?: () => void;
    onPdfEvent?: (event: { url: string; status: string; code?: string }) => void;
  },
): Promise<SoftDrinkHarvestRow[]>;
