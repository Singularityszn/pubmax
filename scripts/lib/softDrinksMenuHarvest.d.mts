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
