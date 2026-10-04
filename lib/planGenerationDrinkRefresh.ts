import { bundleDrinkFieldsFromPrintedName } from "@/lib/bundleDrinkFields";
import { isDrinkCategory, type DrinkCategory } from "@/lib/drinks";
import type { SelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence";

/** Saved choice for generation only. No historical amount or source is authority. */
export type PlanGenerationDrinkRefresh = {
  category: DrinkCategory;
  serving: string | null;
  drinkLabel: string;
  drinkSubtype: string | null;
};

export function cleanPlanGenerationDrinkRefresh(value: unknown): PlanGenerationDrinkRefresh | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const keys = ["category", "serving", "drinkLabel", "drinkSubtype"];
  if (Object.keys(row).length !== keys.length || !Object.keys(row).every((key) => keys.includes(key))
    || !isDrinkCategory(row.category) || typeof row.drinkLabel !== "string"
    || /\p{Cc}/u.test(row.drinkLabel)
    || (row.serving !== null && (typeof row.serving !== "string" || !row.serving.trim()
      || row.serving !== row.serving.trim() || row.serving.length > 48 || /\p{Cc}/u.test(row.serving)))) return null;
  const identity = bundleDrinkFieldsFromPrintedName(row.drinkLabel, row.category);
  if (identity.drinkLabel !== row.drinkLabel || (identity.drinkSubtype ?? null) !== row.drinkSubtype
    || (row.category === "beer" && row.drinkSubtype !== "beer-cider")) return null;
  return { category: row.category, serving: row.serving, drinkLabel: row.drinkLabel,
    drinkSubtype: identity.drinkSubtype ?? null };
}

export function planGenerationDrinkRefreshFromEvidence(
  evidence: SelectedDrinkPriceEvidence | null,
): PlanGenerationDrinkRefresh | null {
  return evidence?.source === "listed" && "drinkLabel" in evidence
    ? { category: evidence.category, serving: evidence.serving,
      drinkLabel: evidence.drinkLabel, drinkSubtype: evidence.drinkSubtype }
    : null;
}
