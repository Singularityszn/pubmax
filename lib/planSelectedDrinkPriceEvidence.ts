import { isDrinkCategory, type DrinkCategory } from "@/lib/drinks";

export type SelectedDrinkPriceEvidence = {
  category: DrinkCategory;
  pence: number;
  serving: null;
  source: "community";
  reportedAt: string;
};

export function cleanSelectedDrinkPriceEvidence(value: unknown): SelectedDrinkPriceEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!isDrinkCategory(row.category) || row.category === "beer" || row.source !== "community"
    || row.serving !== null || !Number.isSafeInteger(row.pence) || (row.pence as number) <= 0
    || (row.pence as number) > 100_000 || typeof row.reportedAt !== "string") return null;
  const time = Date.parse(row.reportedAt);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== row.reportedAt) return null;
  return {
    category: row.category,
    pence: row.pence as number,
    serving: null,
    source: "community",
    reportedAt: row.reportedAt,
  };
}
